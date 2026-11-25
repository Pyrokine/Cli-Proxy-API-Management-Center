import {createOAuthAttempts} from '@/components/credentials/oauthAttempts'
import {getConfigRestartFields} from '@/hooks/visualConfigCodec'
import {ConfigEditorRevisionState} from '@/pages/configEditorRevision'
import {accountInspectionApi} from '@/services/api/accountInspection'
import {apiClient, mutationReceiptError} from '@/services/api/client'
import {configApi} from '@/services/api/config'
import {configFileApi} from '@/services/api/configFile'
import {oauthApi} from '@/services/api/oauth'
import type {ApiError, ManagementMutationReceipt, ManagementMutationResult} from '@/types/api'
import {safeExternalUrl} from '@/utils/validation'
import {AxiosError, type AxiosInstance, type InternalAxiosRequestConfig} from 'axios'
import {afterEach, expect, mock, spyOn, test} from 'bun:test'
import {parseDocument} from 'yaml'
import {sourceCallback, sourceInitializer} from './sourceCallbacks'

const instance        = (apiClient as unknown as { instance: AxiosInstance }).instance
const originalAdapter = instance.defaults.adapter
const response        = (config: InternalAxiosRequestConfig, data: unknown, headers = {}, status = 200) => ({
    config,
    data,
    headers,
    status,
    statusText: String(status),
})
const state           = 'synthetic-oauth-state'
const nonce           = 'synthetic-oauth-nonce'
const startBody       = { url: 'https://login.synthetic.invalid/authorize', state }
const providers       = [
    'anthropic',
    'codex',
    'gemini-cli',
    'antigravity',
    'qwen',
    'kimi',
    'kimi-ai',
    'xai',
    'meta',
    'devin',
    'iflow',
]

afterEach(() => {
    instance.defaults.adapter = originalAdapter
    apiClient.setConfig({ apiBase: '', sessionToken: '' })
})

function transport(outcome: ManagementMutationResult['outcome'], {
    body = startBody as unknown,
    resource = { status: 'wait', phase: 'pending' } as unknown,
    effect = 'task.created', status = 200, legacy = false,
}: { body?: unknown; resource?: unknown; effect?: string; status?: number; legacy?: boolean } = {}) {
    const calls: InternalAxiosRequestConfig[] = []
    let identity                              = ''
    const result                              = (): ManagementMutationResult => ({
        mutation_id: identity, request_id: 'synthetic-oauth-request', outcome,
        confirmed_effect: outcome === 'succeeded' || outcome === 'partial',
        effects: outcome === 'succeeded' || outcome === 'partial' ?
            [{ kind: effect, target: effect.startsWith('configuration.') ? 'configuration' : 'task' }] :
            [],
        audit_available: true,
    })
    instance.defaults.adapter                 = async (config) => {
        calls.push(config)
        if (config.url?.startsWith('/mutations/')) {
            return response(config, result())
        }
        if (config.method ===
            'get' &&
            ['/get-auth-status', '/auth-files', '/config', '/account-inspection/status'].includes(config.url ?? '')) {
            expect(config.headers['X-CPA-Mutation-ID']).toBeUndefined()
            return response(config, resource)
        }
        if (config.method === 'get' && config.url === '/config.yaml') {
            return response(config, 'debug: true\n', { etag: 'readback-etag' })
        }
        identity      = String(config.headers['X-CPA-Mutation-ID'])
        const headers = legacy ? {} : { 'X-CPA-Mutation-Result': JSON.stringify(result()) }
        const reply   = response(config, body, headers, status)
        if (status >= 400) {
            throw new AxiosError('synthetic operation failure', 'ERR_BAD_RESPONSE', config, undefined, reply)
        }
        return reply
    }
    return { calls, result }
}

for (const provider of providers) {
    test(`${provider} GET creates a task with one mutation identity and a nonce-bound readback`, async () => {
        const wire = transport('succeeded')
        expect(await oauthApi.startAuth(provider, { nonce })).toEqual(startBody)
        expect(wire.calls.map((c) => `${c.method} ${c.url}`)).toEqual([
                                                                          `get /${provider}-auth-url`,
                                                                          'get /get-auth-status',
                                                                      ])
        expect(wire.calls[0].headers['X-CPA-Mutation-ID']).toMatch(/^[0-9a-f-]{36}$/)
        expect(wire.calls[1].params).toEqual({ state, nonce })
        expect(wire.result().effects).toEqual([{ kind: 'task.created', target: 'task' }])
    })
}

for (const path of
    [
        '/get-auth-status',
        '/mutations/synthetic',
        '/config',
        '/unknown-auth-url',
        '/plugins/example-auth-url',
        '/prefix/codex-auth-url',
        '/codex-auth-url-extra',
    ]) {
    test(`${path} stays read-only even when the server includes mutation metadata`, async () => {
        const calls: InternalAxiosRequestConfig[] = []
        instance.defaults.adapter                 = async (config) => {
            calls.push(config)
            expect(config.headers['X-CPA-Mutation-ID']).toBeUndefined()
            return response(config, { ordinary: true }, { 'X-CPA-Mutation-Result': '{}' })
        }
        expect(await apiClient.get<{ ordinary: boolean }>(path)).toEqual({ ordinary: true })
        expect(calls).toHaveLength(1)
    })
}

test('legacy OAuth creation remains one GET with its original body', async () => {
    const wire = transport('succeeded', { legacy: true })
    expect(await oauthApi.startAuth('codex', { nonce })).toEqual(startBody)
    expect(wire.calls).toHaveLength(1)
})

test('uncertain creation preserves the receipt after the precise task is observed', async () => {
    const original                              = apiClient.reconcileMutation.bind(apiClient)
    const receipts: ManagementMutationReceipt[] = []
    const observe                               = spyOn(apiClient, 'reconcileMutation')
        .mockImplementation(async (receipt) => {
            const current = await original(receipt)
            receipts.push(current)
            return current
        })
    try {
        const wire = transport('uncertain')
        expect(await oauthApi.startAuth('codex', { nonce })).toEqual(startBody)
        expect(receipts[0].result).toEqual(wire.result())
        expect(receipts[0].result).toMatchObject({ outcome: 'uncertain', confirmed_effect: false, effects: [] })
        expect(wire.calls.map((c) => c.url)).toEqual([
                                                         '/codex-auth-url',
                                                         `/mutations/${wire.result().mutation_id}`,
                                                         '/get-auth-status',
                                                     ])
    } finally {
        observe.mockRestore()
    }
})

for (const resource of
    [
        {},
        { status: 'wait' },
        { status: 'error', phase: 'expired' },
        { status: 'error', phase: 'error', error: 'cancelled' },
    ]) {
    test(`ordinary or unavailable task data cannot confirm creation: ${JSON.stringify(resource)}`, async () => {
        const wire = transport('uncertain', { resource })
        expect(oauthApi.startAuth('codex', { nonce })).rejects.toHaveProperty(
            'mutation.result.outcome',
            'uncertain',
        )
        expect(wire.calls.filter((c) => c.url === '/codex-auth-url')).toHaveLength(1)
    })
}

for (const outcome of ['rejected', 'partial'] as const) {
    test(`${outcome} task creation does not become successful after a normal status GET`, async () => {
        const wire = transport(outcome)
        expect(oauthApi.startAuth('codex', { nonce })).rejects.toHaveProperty('mutation.result.outcome', outcome)
        expect(wire.calls.filter((c) => c.url === '/codex-auth-url')).toHaveLength(1)
    })
}

test('duplicate identity HTTP 409 keeps both identities and never repeats creation', async () => {
    const wire = transport('rejected', { status: 409, body: { error: 'duplicate mutation identity' } })
    try {
        await oauthApi.startAuth('codex', { nonce });
        // noinspection ExceptionCaughtLocallyJS
        throw new Error('Expected rejection')
    } catch (error) {
        expect(error).toMatchObject({
                                        status: 409,
                                        mutation: {
                                            mutation_id: wire.result().mutation_id,
                                            request_id: 'synthetic-oauth-request',
                                            result: { outcome: 'rejected' },
                                        },
                                    })
    }
    expect(wire.calls).toHaveLength(1)
})

test('a false cancellation with no effect remains uncertain and is never replayed', async () => {
    const wire = transport(
        'uncertain',
        { body: { status: 'ok', cancelled: false }, resource: { status: 'error', phase: 'expired' } },
    )
    expect(oauthApi.cancelSession(state, nonce)).rejects.toHaveProperty('mutation.result.outcome', 'uncertain')
    expect(wire.calls.filter((c) => c.method === 'delete')).toHaveLength(1)
})

test('true cancellation consumes only the acknowledged runtime task effect', async () => {
    const wire = transport(
        'succeeded',
        {
            body: { status: 'ok', cancelled: true },
            resource: { status: 'error', phase: 'expired' },
            effect: 'task.runtime_applied',
        },
    )
    expect(await oauthApi.cancelSession(state, nonce)).toEqual({ status: 'ok', cancelled: true })
    expect(wire.calls.filter((c) => c.method === 'delete')).toHaveLength(1)
})

test('actual OAuth start callback waits after task.created and does not announce credential success', async () => {
    transport('succeeded')
    const attempts           = createOAuthAttempts({
                                                       getGeneration: () => apiClient.getAuthGeneration(),
                                                       setTimeout: () => 0,
                                                       clearTimeout: () => {
                                                       },
                                                   })
    const statuses: string[] = []
    const startPolling       = mock(() => {
    })
    const onSuccess          = mock(() => {
    })
    const start              = sourceInitializer<() => Promise<void>>(
        'components/credentials/OAuthLoginAction.tsx',
        'startAuth',
        {
            useCallback: (value: unknown) => value,
            attemptsRef: { current: attempts },
            provider: 'codex',
            plugin: false,
            projectId: '',
            needsProjectId: false,
            generateNonce: () => nonce,
            nonceRef: { current: '' },
            oauthApi,
            safeExternalUrl,
            setCallbackAccepted: mock(),
            setPhase: mock(),
            setCancelSubmitting: mock(),
            setOauthState: mock(),
            setUserCode: mock(),
            setStatus: (value: string) => statuses.push(value),
            setError: mock(),
            setUrl: mock(),
            window: { open: mock() },
            startPolling,
            onSuccess,
            t: (key: string) => key,
        },
    )
    await start()
    expect(statuses).toEqual(['starting', 'waiting'])
    expect(startPolling).toHaveBeenCalledTimes(1)
    expect(onSuccess).not.toHaveBeenCalled()
    attempts.invalidateAll()
})

for (const callbackProvider of ['codex', 'synthetic-plugin']) {
    test(
        `actual ${callbackProvider} callback accepts task.persisted without treating it as authorization success`,
        async () => {
            const wire      = transport(
                'succeeded',
                { body: { status: 'ok' }, resource: { files: [] }, effect: 'task.persisted' },
            )
            const polling   = mock(() => {
            })
            const accepted  = mock()
            const onSuccess = mock()
            const submit    = sourceInitializer<() => Promise<void>>(
                'components/credentials/OAuthLoginAction.tsx',
                'submitCallback',
                {
                    useCallback: (value: unknown) => value,
                    attemptsRef: {
                        current: {
                            get: () => ({
                                isCurrent: () => true,
                                isPolling: () => false,
                            }),
                        },
                    },
                    provider: callbackProvider,
                    plugin: true,
                    callbackUrl: `http://127.0.0.1/callback?code=synthetic&state=${state}`,
                    oauthState: state,
                    nonceRef: { current: nonce },
                    oauthApi,
                    setError: mock(),
                    setCallbackSubmitting: mock(),
                    setCallbackAccepted: accepted,
                    setStatus: mock(),
                    startPolling: polling,
                    onSuccess,
                    t: (key: string) => key,
                },
            )
            await submit()
            expect(accepted).toHaveBeenCalledWith(true)
            expect(polling).toHaveBeenCalledTimes(1)
            expect(onSuccess).not.toHaveBeenCalled()
            expect(wire.calls.map((c) => `${c.method} ${c.url}`)).toEqual(['post /oauth-callback', 'get /auth-files'])
            expect(JSON.parse(String(wire.calls[0].data))).toHaveProperty('provider', callbackProvider)
        },
    )
}

function editor() {
    const generation = apiClient.getAuthGeneration()
    const revisions  = new ConfigEditorRevisionState(() => apiClient.getAuthGeneration())
    revisions.acceptServerRevision()
    revisions.resetSource('debug: false\n')
    revisions.editSource('debug: true\n')
    const data: Record<string, unknown> = { dirty: true, content: 'debug: true\n' }
    const setter                        = (key: string) => (value: unknown) => {
        data[key] = value
    }
    const prepared                      = {
        revision: revisions.snapshot(),
        origin: 'source',
        content: 'debug: true\n',
        serverYaml: 'debug: false\n',
        serverEtag: 'synthetic-etag',
        validationPassed: true,
    }
    const preparedSaveRef               = { current: prepared as typeof prepared | null }
    const scope                         = {
        isCurrentConnection: () => generation === apiClient.getAuthGeneration(),
        apiClient,
        configFileApi,
        revisionStateRef: { current: revisions },
        preparedSaveRef,
        isDirtyRef: { current: true },
        disableControls: false,
        saveNeedsReload: false,
        activeTab: 'source',
        visualParseError: null,
        parseDocument,
        getConfigRestartFields,
        loadRuntimeInfo: mock(async () => {
        }),
        apiErrorStatus: sourceCallback('pages/ConfigPage.tsx', 'apiErrorStatus', {}),
        // noinspection JSUnusedGlobalSymbols
        'mutationReceiptError': mutationReceiptError,
        setSaving: setter('saving'),
        setLoading: setter('loading'),
        setDirty: setter('dirty'),
        setContent: setter('content'),
        setError: setter('error'),
        setDiffModalOpen: setter('diffModalOpen'),
        setDiffOriginalYaml: setter('diffOriginalYaml'),
        setMergedYaml: setter('mergedYaml'),
        setValidationErrors: setter('errors'),
        setValidationWarnings: setter('warnings'),
        setSaveNeedsReload: setter('saveNeedsReload'),
        loadVisualValuesFromYaml: mock(),
        allowNextNavigation: mock(),
        clearConfigCache: mock(),
        fetchConfig: mock(async () => {
        }),
        showNotification: mock(),
        t: (key: string) => key,
        clearPreparedSave: () => {
            preparedSaveRef.current = null
        },
        applyVisualChangesToYaml: (value: string) => value,
    }
    return { scope, data }
}

for (const outcome of ['partial', 'uncertain'] as const) {
    test(
        `actual ConfigPage preserves a ${outcome} save instead of treating YAML GET as runtime confirmation`,
        async () => {
            const body            = outcome === 'partial' ?
                { ok: true, cleanup_error: 'synthetic cleanup failure' } :
                { ok: true }
            const wire            = transport(outcome, { body, effect: 'configuration.persisted' })
            const { scope, data } = editor()
            await sourceInitializer<() => Promise<void>>('pages/ConfigPage.tsx', 'handleConfirmSave', scope)()
            expect(wire.calls.filter((c) => c.method === 'put')).toHaveLength(1)
            expect(wire.calls[0].headers['If-Match']).toBe('synthetic-etag')
            expect(data.dirty).toBe(true)
            expect(data.saveNeedsReload).toBe(true)
            expect(scope.showNotification.mock.calls.some(([message]) => message === 'config_management.save_success'))
                .toBe(false)
            if (outcome === 'partial') {
                expect(scope.showNotification).toHaveBeenCalledWith('config_management.cleanup_warning', 'warning')
            }
        },
    )
}

test('actual configuration validation preserves rejected HTTP 200 field feedback without saving', async () => {
    const errors          = [{ field: 'port', message: 'synthetic invalid port' }]
    const wire            = transport('rejected', { body: { valid: false, errors, warnings: [] } })
    const { scope, data } = editor()
    scope.configFileApi   =
        { ...configFileApi, fetchConfigYaml: async () => ({ content: 'debug: false\n', etag: 'synthetic-etag' }) }
    await sourceInitializer<() => Promise<void>>('pages/ConfigPage.tsx', 'handleSave', scope)()
    expect(data.errors).toEqual(errors)
    expect(data.diffModalOpen).toBe(true)
    expect(scope.preparedSaveRef.current).toHaveProperty('validationPassed', false)
    await sourceInitializer<() => Promise<void>>('pages/ConfigPage.tsx', 'handleConfirmSave', scope)()
    expect(wire.calls.map((c) => `${c.method} ${c.url}`)).toEqual(['post /config.yaml/validate'])
})

test('ordinary settings keep uncertain runtime receipt despite a matching config object', async () => {
    const wire = transport('uncertain', { body: { status: 'ok' }, resource: { debug: true } })
    expect(configApi.updateDebug(true)).rejects.toHaveProperty('mutation.result.outcome', 'uncertain')
    expect(wire.calls.filter((c) => c.method === 'put')).toHaveLength(1)
})

test('inspection persistence HTTP 503 reports failure before changing the schedule', async () => {
    const wire = transport('uncertain', {
        status: 503,
        body: { error: 'inspection persistence failed' },
        resource: { status: 'idle' },
    })
    try {
        await accountInspectionApi.updateSchedule({
                                                      enabled: true,
                                                      interval_seconds: 60,
                                                      providers: [],
                                                      max_concurrency: 1,
                                                      timeout_seconds: 30,
                                                      retention_runs: 10,
                                                  })
        // noinspection ExceptionCaughtLocallyJS
        throw new Error('Expected schedule save failure')
    } catch (error) {
        const failure = error as ApiError
        expect(failure.status).toBe(503)
        expect(failure.data).toEqual({ error: 'inspection persistence failed' })
        expect(failure.mutation?.result).toMatchObject({ outcome: 'uncertain', confirmed_effect: false, effects: [] })
    }
    expect(wire.calls.filter((c) => c.method === 'put')).toHaveLength(1)
})

test('unknown plugin GET without an operation callback stays read-only', async () => {
    const calls: InternalAxiosRequestConfig[] = []
    instance.defaults.adapter                 = async (config) => {
        calls.push(config)
        expect(config.headers['X-CPA-Mutation-ID']).toBeUndefined()
        return response(config, startBody, { 'X-CPA-Mutation-Result': '{}' })
    }
    expect(await apiClient.get<typeof startBody>('/custom-provider-auth-url')).toEqual(startBody)
    expect(calls).toHaveLength(1)
})

for (const outcome of ['rejected', 'partial', 'uncertain'] as const) {
    test(`direct OAuth creation GET consumes ${outcome} even without an SDK resource callback`, async () => {
        const wire = transport(outcome)
        expect(apiClient.get('/codex-auth-url')).rejects.toHaveProperty('mutation.result.outcome', outcome)
        expect(wire.calls.filter((c) => c.url === '/codex-auth-url')).toHaveLength(1)
    })
}

for (const outcome of ['rejected', 'partial', 'uncertain'] as const) {
    test(`dynamic plugin creation explicitly consumes ${outcome} and never replays its GET`, async () => {
        const wire = transport(outcome, { resource: {} })
        expect(oauthApi.startAuth('synthetic-plugin', { plugin: true, nonce })).rejects.toHaveProperty(
            'mutation.result.outcome',
            outcome,
        )
        expect(wire.calls.filter((call) => call.url === '/synthetic-plugin-auth-url')).toHaveLength(1)
    })
}

test('dynamic plugin creation carries one UUID, nonce and signal while status remains read-only', async () => {
    const wire       = transport('succeeded')
    const controller = new AbortController()
    expect(await oauthApi.startAuth(
        'synthetic-plugin',
        { plugin: true, nonce, signal: controller.signal, projectId: 'unused-project' },
    )).toEqual(startBody)
    expect(wire.calls.map((call) => `${call.method} ${call.url}`)).toEqual([
                                                                               'get /synthetic-plugin-auth-url',
                                                                               'get /get-auth-status',
                                                                           ])
    expect(wire.calls[0].params).toEqual({ is_webui: true, nonce })
    expect(wire.calls[0].headers['X-CPA-Mutation-ID']).toMatch(/^[0-9a-f-]{36}$/)
    expect(wire.calls[1].headers['X-CPA-Mutation-ID']).toBeUndefined()
    expect(wire.calls[1].params).toEqual({ state, nonce })
    expect(wire.calls[1].signal).toBe(controller.signal)
})

test('legacy dynamic plugin creation retains one GET and its original body', async () => {
    const wire = transport('succeeded', { legacy: true })
    expect(await oauthApi.startAuth('synthetic-plugin', { plugin: true, nonce })).toEqual(startBody)
    expect(wire.calls).toHaveLength(1)
    expect(wire.calls[0].headers['X-CPA-Mutation-ID']).toMatch(/^[0-9a-f-]{36}$/)
})

test('dynamic plugin duplicate identity preserves HTTP 409 and does not restart login', async () => {
    const wire = transport('rejected', { status: 409, body: { error: 'duplicate mutation identity' } })
    try {
        await oauthApi.startAuth('synthetic-plugin', { plugin: true, nonce });
        // noinspection ExceptionCaughtLocallyJS
        throw new Error('Expected rejection')
    } catch (error) {
        expect(error).toMatchObject({
                                        status: 409,
                                        mutation: {
                                            mutation_id: wire.result().mutation_id,
                                            request_id: 'synthetic-oauth-request',
                                            result: { outcome: 'rejected' },
                                        },
                                    })
    }
    expect(wire.calls).toHaveLength(1)
})

test('dynamic plugin precise pending state leaves the original uncertain receipt intact', async () => {
    const original                              = apiClient.reconcileMutation.bind(apiClient)
    const receipts: ManagementMutationReceipt[] = []
    const observe                               = spyOn(apiClient, 'reconcileMutation')
        .mockImplementation(async (receipt) => {
            const current = await original(receipt)
            receipts.push(current)
            return current
        })
    try {
        const wire = transport('uncertain')
        expect(await oauthApi.startAuth('synthetic-plugin', { plugin: true, nonce })).toEqual(startBody)
        expect(receipts[0]?.result).toEqual(wire.result())
        expect(receipts[0]?.result).toMatchObject({ outcome: 'uncertain', confirmed_effect: false, effects: [] })
        expect(wire.calls.map((call) => call.url)).toEqual([
                                                               '/synthetic-plugin-auth-url',
                                                               `/mutations/${wire.result().mutation_id}`,
                                                               '/get-auth-status',
                                                           ])
    } finally {
        observe.mockRestore()
    }
})

test(
    'actual dynamic plugin start callback waits after task.created instead of announcing credential success',
    async () => {
        const wire               = transport('succeeded')
        const attempts           = createOAuthAttempts({
                                                           getGeneration: () => apiClient.getAuthGeneration(),
                                                           setTimeout: () => 0,
                                                           clearTimeout: () => {
                                                           },
                                                       })
        const statuses: string[] = []
        const onSuccess          = mock()
        const startPolling       = mock()
        const start              = sourceInitializer<() => Promise<void>>(
            'components/credentials/OAuthLoginAction.tsx',
            'startAuth',
            {
                useCallback: (callback: unknown) => callback,
                attemptsRef: { current: attempts },
                provider: 'synthetic-plugin',
                plugin: true,
                projectId: '',
                needsProjectId: false,
                generateNonce: () => nonce,
                nonceRef: { current: '' },
                oauthApi,
                safeExternalUrl,
                setCallbackAccepted: mock(),
                setPhase: mock(),
                setCancelSubmitting: mock(),
                setOauthState: mock(),
                setUserCode: mock(),
                setStatus: (status: string) => statuses.push(status),
                setError: mock(),
                setUrl: mock(),
                window: { open: mock() },
                startPolling,
                onSuccess,
                t: (key: string) => key,
            },
        )
        await start()
        expect(statuses).toEqual(['starting', 'waiting'])
        expect(startPolling).toHaveBeenCalledTimes(1)
        expect(onSuccess).not.toHaveBeenCalled()
        expect(wire.calls[0].headers['X-CPA-Mutation-ID']).toMatch(/^[0-9a-f-]{36}$/)
        attempts.invalidateAll()
    },
)

test(
    'actual plugin polling reads state and succeeds only after the reported terminal authorization status',
    async () => {
        const resource     = { status: 'wait', phase: 'saving' }
        const wire         = transport('succeeded', { resource })
        let read!: () => Promise<unknown>
        let consume!: (value: unknown) => boolean
        const onSuccess    = mock()
        const attempt      = {
            signal: new AbortController().signal,
            invalidate: mock(),
            poll: (request: typeof read, callback: typeof consume) => {
                read    = request;
                consume = callback
            },
        }
        const startPolling = sourceInitializer<(state: string, nonce: string, attempt: unknown) => void>(
            'components/credentials/OAuthLoginAction.tsx',
            'startPolling',
            {
                useCallback: (callback: unknown) => callback,
                oauthApi,
                setPhase: mock(),
                setStatus: mock(),
                setError: mock(),
                setOauthState: mock(),
                setUserCode: mock(),
                nonceRef: { current: nonce },
                onSuccess,
                POLL_INTERVAL: 2000,
                t: (key: string) => key,
                shouldFinalizeOAuthAttempt: () => true,
            },
        )
        startPolling(state, nonce, attempt)
        expect(consume(await read())).toBe(true)
        expect(onSuccess).not.toHaveBeenCalled()
        resource.status = 'ok'
        resource.phase  = 'success'
        expect(consume(await read())).toBe(false)
        expect(onSuccess).toHaveBeenCalledTimes(1)
        expect(attempt.invalidate).toHaveBeenCalledTimes(1)
        expect(wire.calls.map((call) => call.url)).toEqual(['/get-auth-status', '/get-auth-status'])
        expect(wire.calls.every((call) => call.headers['X-CPA-Mutation-ID'] === undefined)).toBe(true)
    },
)

for (const stale of ['cancelled', 'new connection']) {
    test(`actual dynamic plugin creation discards delivery after ${stale}`, async () => {
        let deliver!: (data: unknown) => void
        const pending                             = new Promise<unknown>((resolve) => {
            deliver = resolve
        })
        const calls: InternalAxiosRequestConfig[] = []
        instance.defaults.adapter                 = async (config) => {
            calls.push(config);
            return response(config, await pending)
        }
        const attempts                            = createOAuthAttempts(
            {
                getGeneration: () => apiClient.getAuthGeneration(),
                setTimeout: () => 0,
                clearTimeout: () => {
                },
            })
        const open                                = mock()
        const polling                             = mock()
        const onSuccess                           = mock()
        const statuses: string[]                  = []
        const start                               = sourceInitializer<() => Promise<void>>(
            'components/credentials/OAuthLoginAction.tsx',
            'startAuth',
            {
                useCallback: (callback: unknown) => callback,
                attemptsRef: { current: attempts },
                provider: 'synthetic-plugin',
                plugin: true,
                projectId: '',
                needsProjectId: false,
                generateNonce: () => nonce,
                nonceRef: { current: '' },
                oauthApi,
                safeExternalUrl,
                setCallbackAccepted: mock(),
                setPhase: mock(),
                setCancelSubmitting: mock(),
                setOauthState: mock(),
                setUserCode: mock(),
                setStatus: (status: string) => statuses.push(status),
                setError: mock(),
                setUrl: mock(),
                window: { open },
                startPolling: polling,
                onSuccess,
                t: (key: string) => key,
            },
        )
        const request                             = start()
        await new Promise<void>((resolve) => setImmediate(resolve))
        if (stale === 'cancelled') {
            attempts.invalidateAll()
        } else {
            apiClient.setConfig({ apiBase: 'https://new.synthetic.invalid', sessionToken: '' })
        }
        deliver(startBody)
        await request
        expect(statuses).toEqual(['starting'])
        expect(open).not.toHaveBeenCalled()
        expect(polling).not.toHaveBeenCalled()
        expect(onSuccess).not.toHaveBeenCalled()
        expect(calls.filter((call) => call.url === '/synthetic-plugin-auth-url')).toHaveLength(1)
        expect(calls.some((call) => call.url === '/get-auth-status')).toBe(false)
        attempts.invalidateAll()
    })
}

test('actual plugin cancellation retains uncertain false/no-op and resumes polling without replay', async () => {
    const wire     = transport(
        'uncertain',
        { body: { status: 'ok', cancelled: false }, resource: { status: 'wait', phase: 'pending' } },
    )
    const provider = 'synthetic-plugin'
    const attempts = createOAuthAttempts({
                                             getGeneration: () => apiClient.getAuthGeneration(),
                                             setTimeout: () => 0,
                                             clearTimeout: () => {
                                             },
                                         })
    attempts.begin(provider)
    const nonceRef     = { current: nonce }
    const onCancel     = mock()
    const startPolling = mock()
    const setError     = mock()
    const cancel       = sourceInitializer<() => Promise<void>>(
        'components/credentials/OAuthLoginAction.tsx',
        'handleCancel',
        {
            useCallback: (callback: unknown) => callback,
            oauthState: state,
            nonceRef,
            attemptsRef: { current: attempts },
            provider,
            plugin: true,
            oauthApi,
            setCallbackSubmitting: mock(),
            setCancelSubmitting: mock(),
            setStatus: mock(),
            setError,
            setOauthState: mock(),
            setUserCode: mock(),
            onCancel,
            startPolling,
            t: (key: string) => key,
        },
    )
    await cancel()
    expect(onCancel).not.toHaveBeenCalled()
    expect(nonceRef.current).toBe(nonce)
    expect(setError).toHaveBeenCalledTimes(2)
    expect(startPolling).toHaveBeenCalledWith(state, nonce, expect.anything())
    expect(wire.calls.filter((call) => call.method === 'delete')).toHaveLength(1)
    attempts.invalidateAll()
})
