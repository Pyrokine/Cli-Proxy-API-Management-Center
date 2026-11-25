import {Button} from '@/components/ui/Button'
import {Input} from '@/components/ui/Input'
import {ToggleSwitch} from '@/components/ui/ToggleSwitch'
import {decodeVisualConfigYaml, encodeVisualConfigYaml} from '@/hooks/visualConfigCodec'
import {authFilesApi} from '@/services/api/authFiles'
import {apiClient} from '@/services/api/client'
import {formatDateTime, formatFileSize} from '@/utils/format'
import {buildKimiQuotaRows} from '@/utils/quota/builders'
import {resolveCodexResetCredits} from '@/utils/quota/codexResetCredits'
import {normalizeCodexAccountCredits} from '@/utils/quota/parsers'
import {parseOffsetSecondsToMs, resolveResetMs} from '@/utils/quota/resetInstants'
import {expect, spyOn, test} from 'bun:test'
import i18n, {createInstance} from 'i18next'
import {readFileSync} from 'node:fs'
import React from 'react'
import {parse} from 'yaml'
import {sourceCallback, sourceExpression, sourceInitializer} from './sourceCallbacks'

const mapperPath          = 'components/credentials/hooks/useBackendQuotaRegistration.ts'
const asRecord            = sourceCallback<(value: unknown) => Record<string, unknown> | null>(
    mapperPath,
    'asRecord',
    {},
)
const numberValue         = sourceCallback<(value: unknown) => number | null>(mapperPath, 'numberValue', { asRecord })
const invalidQuotaPayload = (provider: string) => new Error(`Invalid ${provider} fixture`)
const mapCodex            = sourceCallback<(value: unknown, observed?: number | null) => {
    windows: Array<{ resetAtMs: number | null }>
}>(mapperPath, 'mapCodex', {
    asRecord,
    numberValue,
    invalidQuotaPayload,
    i18n,
    normalizeCodexAccountCredits,
    resolveCodexResetCredits,
    resolveResetMs,
    parseOffsetSecondsToMs,
    formatDateTime,
})
const mapKimi             = sourceCallback<(value: unknown, observed?: number | null) => {
    rows: Array<{ resetAtMs: number | null }>
}>(mapperPath, 'mapKimi', {
// noinspection JSUnusedGlobalSymbols
    'buildKimiQuotaRows': buildKimiQuotaRows, invalidQuotaPayload,
})
const mapPayload          = sourceCallback<(type: string, data: unknown, observed?: string | null) => {
    value: { windows?: Array<{ resetAtMs: number | null }>; rows?: Array<{ resetAtMs: number | null }> }
}>(mapperPath, 'mapQuotaPayload', { mapCodex, mapKimi })

for (const provider of ['codex', 'kimi']) {
    test(`${provider} cache mapping anchors relative resets to the observation rather than each UI poll`, () => {
        const raw      = provider === 'codex'
                         ? { rate_limit: { primary_window: { used_percent: 20, reset_after_seconds: 60 } } }
                         : { limits: [{ name: 'Hourly', limit: 100, used: 20, reset_in: 60 }] }
        const observed = '2026-11-05T20:00:00Z'
        const now      = spyOn(Date, 'now').mockReturnValue(Date.parse(observed))
        try {
            const first = mapPayload(provider, raw, observed).value
            now.mockReturnValue(Date.parse(observed) + 300_000)
            const later = mapPayload(provider, raw, observed).value
            const read  = (value: typeof first) => (value.windows ?? value.rows ?? [])[0].resetAtMs
            expect(read(first)).toBe(Date.parse(observed) + 60_000)
            expect(read(later)).toBe(read(first))
            expect(read(mapPayload(provider, raw, null).value)).toBeNull()
        } finally {
            now.mockRestore()
        }
    })
}

function releaseLoader(reply: (page: number) => Promise<unknown>, generation = () => 1) {
    return sourceInitializer<() => Promise<Array<{ tag_name: string }> | null>>(
        'components/system/VersionHistoryModal.tsx',
        'loadReleases',
        {
            releasesApi: { list: reply },
            cancelled: false,
            authGeneration: 1,
            apiClient: { getAuthGeneration: generation },
            target: 'cpa',
            t: (key: string) => key,
        },
    )
}

test('release history consumes all advertised backend pages before publishing the collection', async () => {
    const calls: number[] = []
    const load            = releaseLoader(async (page) => {
        calls.push(page)
        return {
            page,
            per_page: 100,
            total: 250,
            releases: Array.from(
                { length: page === 3 ? 50 : 100 },
                (_, index) => ({ tag_name: `v${(page - 1) * 100 + index}` }),
            ),
        }
    })
    const entries         = await load()
    expect(calls).toEqual([1, 2, 3])
    expect(entries).toHaveLength(250)
    expect(entries?.[249].tag_name).toBe('v249')
})

test('release history exposes incomplete or repeated continuation instead of declaring a complete list', async () => {
    for (const repeated of [false, true]) {
        const load = releaseLoader(async (page) => ({
            page,
            per_page: 100,
            total: 200,
            releases: page === 1 || repeated ?
                      Array.from({ length: 100 }, (_, index) => ({ tag_name: `v${index}` })) :
                [],
        }))
        expect(load()).rejects.toThrow('version_history.pagination_incomplete')
    }
})

test('release continuation does not consume another connection after the response arrives', async () => {
    let generation = 1
    let requests   = 0
    const load     = releaseLoader(async () => {
        requests += 1;
        generation = 3;
        return { page: 1, per_page: 100, total: 250, releases: [] }
    }, () => generation)
    expect(await load()).toBeNull()
    expect(requests).toBe(1)
})

for (const [source, expected] of [['on', 'all'], ['yes', 'all'], ['no', 'off']] as const) {
    test(`legacy image mode ${source} decodes correctly and edits serialize a canonical mode`, () => {
        const yaml    = `disable-image-generation: ${source}\n`
        const decoded = decodeVisualConfigYaml(yaml)
        expect(decoded.values.disableImageGeneration).toBe(expected)
        const saved = encodeVisualConfigYaml(
            yaml,
            { ...decoded.values, disableImageGeneration: 'chat' },
            decoded.values,
            decoded.apiKeysStorage,
            yaml,
        )
        expect(parse(saved)['disable-image-generation']).toBe('chat')
    })
}

for (const locale of ['en', 'ru', 'zh-CN', 'zh-TW']) {
    test(`${locale} trim confirmation describes date records and an estimated size`, async () => {
        const messages    = JSON.parse(readFileSync(
            new URL(`../src/i18n/locales/${locale}.json`, import.meta.url),
            'utf8',
        ))
        const translation = createInstance()
        await translation.init({ lng: locale, resources: { [locale]: { translation: messages } } })
        let confirmation: { message: string; onConfirm: () => Promise<void> } | undefined
        let trims    = 0
        const handle = sourceInitializer<() => Promise<void>>('components/usage/UsageRetentionCard.tsx', 'handleTrim', {
            apiClient: { getAuthGeneration: () => 1 },
            // noinspection JSUnusedGlobalSymbols
            'setTrimming': () => {
            },
            usageApi: {
                trimPreview: async () => ({
                    files_count: 3,
                    total_size_bytes: 1024,
                    date_range: { oldest: '2026-10-01', newest: '2026-10-03' },
                }), triggerTrim: async () => {
                    trims += 1
                    return { deleted: 0 }
                },
            },
            showNotification: () => {
            },
            showConfirmation: (value: typeof confirmation) => {
                confirmation = value
            },
            t: translation.t.bind(translation),
            // noinspection JSUnusedGlobalSymbols
            'formatFileSize': formatFileSize,
        })
        await handle()
        expect(confirmation?.message).toContain('3')
        expect(confirmation?.message).toContain('2026-10-01')
        expect(confirmation?.message).toContain('2026-10-03')
        expect(confirmation?.message).toMatch(/estimated|оценка|估算/)
        expect(confirmation?.message).not.toMatch(/files|фай|文件|檔案/)
        await confirmation?.onConfirm()
        expect(trims).toBe(1)
    })
}

for (const disabled of [true, false]) {
    test(`Cookie authorization enforces disabled=${disabled} in the real submit callback`, async () => {
        let requests     = 0
        let successes    = 0
        let generation   = 1
        let resolve!: (value: { status: string }) => void
        const requestRef = { current: null as object | null }
        const mountedRef = { current: true }
        const handler    = sourceInitializer<() => Promise<void>>(
            'components/credentials/CookieAuthFlow.tsx',
            'handleSubmit',
            {
                useCallback: <T>(value: T) => value,
                cookie: 'synthetic-cookie',
                disableControls: disabled,
                requestRef,
                mountedRef,
                apiClient: { getAuthGeneration: () => generation },
                setLoading: () => {
                },
                oauthApi: {
                    iflowCookieAuth: () => {
                        requests += 1;
                        return new Promise((accept) => {
                            resolve = accept
                        })
                    },
                },
                showNotification: () => {
                },
                t: (key: string) => key,
                onSuccess: async () => {
                    successes += 1
                },
            },
        )
        const pending    = handler()
        await handler()
        expect(requests).toBe(disabled ? 0 : 1)
        if (!disabled) {
            generation = 3;
            resolve({ status: 'ok' })
        }
        await pending
        expect(successes).toBe(0)
        expect(requestRef.current).toBeNull()
    })
}

test('Antigravity grouped windows retain zero, descriptions, ordering and the actual card mapper', () => {
    const parseFraction           = sourceCallback<(value: unknown) => number | null>(mapperPath, 'parseFraction', {})
    const stringValueFromRecord   = sourceCallback<(record: unknown, ...keys: string[]) => string | null>(
        mapperPath,
        'stringValueFromRecord',
        {},
    )
    const extractCloudCodeBuckets = sourceCallback<(data: unknown) => unknown[]>(
        mapperPath,
        'extractCloudCodeBuckets',
        { parseFraction, resolveResetMs },
    )
    const map                     = sourceCallback<(data: unknown) => {
        groups: Array<{ remainingFraction: number; periodHours?: number; description?: string }>
    }>(mapperPath, 'mapAntigravity', {
        asRecord,
        numberValue,
        stringValueFromRecord,
        parseFraction,
        extractCloudCodeBuckets,
        resolveResetMs,
        invalidQuotaPayload,
        // noinspection JSUnusedGlobalSymbols
        'parseAntigravitySubscription': () => ({}),
    })
    const value                   = map({
                                            quota: {
                                                groups: [
                                                    {
                                                        displayName: 'Synthetic group',
                                                        description: 'Shared window',
                                                        buckets: [
                                                            {
                                                                bucketId: 'weekly',
                                                                window: 'weekly',
                                                                remainingFraction: 0.5,
                                                            },
                                                            {
                                                                bucket_id: 'short',
                                                                window: 'five_hour',
                                                                remaining_fraction: 0,
                                                                reset_time: '2026-11-06T01:00:00Z',
                                                            },
                                                        ],
                                                    },
                                                ],
                                            },
                                        })
    expect(value.groups.map((group) => group.periodHours)).toEqual([5, 168])
    expect(value.groups[0].remainingFraction).toBe(0)
    expect(value.groups[0].description).toBe('Shared window')
    const convert = sourceCallback<(state: unknown) => Array<{ percent: number; detail?: string }>>(
        'hooks/useCredentialQuota.ts',
        'fromAntigravity',
        { formatQuotaResetTime: () => 'reset' },
    )
    expect(convert(value)[0]).toMatchObject({ percent: 0, detail: 'Shared window' })
})

test(
    'unified quota configuration cannot submit defaults before a successful read and confirms each enable',
    async () => {
        const writes: unknown[] = []
        let confirm: { onConfirm: () => Promise<void> } | undefined
        const scope             = {
            quotaConfigLoaded: false,
            dataGeneration: 1,
            authGeneration: 1,
            apiClient: { getAuthGeneration: () => 1 },
            quotaDraft: { enabled: true, intervalMinutes: '10', maxIntervalMinutes: '30' },
            quotaConfig: { enabled: false, interval: 600, 'max-interval': 1800 },
            quotaDraftStateRef: { current: { generation: 1, dirty: true } },
            setActionError: () => {
            },
            t: (key: string) => key,
            quotaApi: {
                setConfig: async (value: unknown) => {
                    writes.push(value)
                },
            },
            showNotification: () => {
            },
            showConfirmation: (value: typeof confirm) => {
                confirm = value
            },
            runAction: async (_name: string, action: (current: () => boolean) => Promise<void>) => action(() => true),
        }
        const invoke            = () => sourceInitializer<() => Promise<void>>(
            'components/credentials/AccountInspectionPanel.tsx',
            'handleSaveQuotaConfig',
            scope,
        )()
        await invoke();
        expect(writes).toEqual([])
        scope.quotaConfigLoaded = true
        await invoke();
        expect(writes).toEqual([]);
        expect(confirm).toBeDefined()
        await confirm?.onConfirm()
        expect(writes).toEqual([{ enabled: true }])
        const yaml    = 'quota-refresh: {enabled: true, interval: 123, max-interval: 456}\ndebug: false\n'
        const decoded = decodeVisualConfigYaml(yaml)
        expect(parse(encodeVisualConfigYaml(
            yaml,
            { ...decoded.values, debug: true },
            decoded.values,
            decoded.apiKeysStorage,
            yaml,
        ))['quota-refresh']).toEqual({ enabled: true, interval: 123, 'max-interval': 456 })
    },
)

test(
    (
        'plugin editor loads full direct configuration into its existing ' +
        'sparse draft and refuses saves after a read failure'
    ),
    async () => {
        const states: unknown[] = []
        const drafts: unknown[] = []
        const current           = { future: { retained: true }, mode: 'safe' }
        const scope             = {
            useCallback: <T>(value: T) => value,
            isCurrentConnection: () => true,
            configRequestSequence: { current: 0 },
            pluginsApi: { getConfig: async () => current },
            setEditingPlugin: (value: unknown) => states.push(value),
            setConfigDraft: (value: unknown) => drafts.push(value),
            setJsonDraft: () => {
            },
            setConfigError: () => {
            },
            // noinspection JSUnusedGlobalSymbols
            'setConfigReadState': () => {
            },
            stringifyConfigValue: JSON.stringify,
            getErrorMessage: String,
        }
        const open              = sourceInitializer<(plugin: unknown) => Promise<void>>(
            'pages/PluginManagementPage.tsx',
            'openConfig',
            scope,
        )
        await open({ id: 'synthetic', config: { mode: 'list-only' }, config_fields: [] })
        expect(drafts[1]).toEqual(current)
        expect(states[1]).toMatchObject({ config: current })
        let patches = 0
        const save  = sourceInitializer<() => Promise<void>>('pages/PluginManagementPage.tsx', 'handleSaveConfig', {
            useCallback: <T>(value: T) => value,
            editingPlugin: { id: 'synthetic' },
            isCurrentConnection: () => true,
            configReadState: 'error',
            configDraft: {},
            jsonDraft: {},
            confirmPluginRuntime: async () => {
            },
            showNotification: () => {
            },
            t: (key: string) => key,
            pluginsApi: {
                patchConfig: async () => {
                    patches += 1
                },
            },
        })
        await save();
        expect(patches).toBe(0)
    },
)

test('quota controls bind the actual draft and save action while the API consumes the resource readback', async () => {
    const path   = 'components/credentials/AccountInspectionPanel.tsx'
    let draft    = { enabled: false, intervalMinutes: '10', maxIntervalMinutes: '30' }
    const state  = { current: { generation: 1, dirty: false } }
    const update = sourceInitializer<(patch: Partial<typeof draft>) => void>(path, 'updateQuotaDraft', {
        quotaDraftStateRef: state, authGeneration: 1,
        // noinspection JSUnusedGlobalSymbols
        'setQuotaDraft': (apply: (value: typeof draft) => typeof draft) => {
            draft = apply(draft)
        },
    })
    let saves    = 0
    type Control = {
        props: {
            value?: string;
            checked?: boolean;
            disabled: boolean;
            onChange: (value: unknown) => void;
            onClick: () => void
        }
    }
    const control  = (prefix: string, term: string) => sourceExpression<Control>(
        path,
        (node, tree) => node.getText(tree).startsWith(prefix) && node.getText(tree).includes(term),
        {
            React,
            Input,
            Button,
            ToggleSwitch,
            quotaDraft: draft,
            updateQuotaDraft: update,
            t: (key: string) => key,
            quotaConfigLoaded: true,
            dataGeneration: 1,
            authGeneration: 1,
            busyAction: '',
            handleSaveQuotaConfig: () => {
                saves += 1
            },
        },
    )
    const interval = control('<Input ', 'quota_interval_minutes')
    expect(interval.props.value).toBe('10');
    expect(interval.props.disabled).toBe(false)
    interval.props.onChange({ target: { value: '7' } })
    control('<Input ', 'quota_max_interval_minutes').props.onChange({ target: { value: '20' } })
    control('<ToggleSwitch ', 'quota_auto_refresh').props.onChange(true)
    control('<Button type=', 'handleSaveQuotaConfig').props.onClick()
    expect(draft).toEqual({ enabled: true, intervalMinutes: '7', maxIntervalMinutes: '20' })
    expect(state.current).toEqual({ generation: 1, dirty: true });
    expect(saves).toBe(1)
    const writes: unknown[] = []
    let reads               = 0
    const setConfig         = sourceCallback<(value: unknown) => Promise<unknown>>(
        'services/api/quota.ts',
        'setConfig',
        {
            apiClient: {
                put: async (
                    url: string,
                    body: unknown,
                    options: {
                        mutationReadback: () => Promise<unknown>
                    },
                ) => {
                    expect(url).toBe('/quota/config');
                    writes.push(body);
                    await options.mutationReadback();
                    return body
                },
            },
            quotaApi: {
                getConfig: async () => {
                    reads += 1;
                    return {
                        enabled: true,
                        interval: 420,
                        'max-interval': 1200,
                    }
                },
            },
        },
    )
    const save              = sourceInitializer<() => Promise<void>>(path, 'handleSaveQuotaConfig', {
        quotaConfigLoaded: true,
        dataGeneration: 1,
        authGeneration: 1,
        apiClient: { getAuthGeneration: () => 1 },
        quotaDraft: draft,
        quotaConfig: { enabled: true, interval: 600, 'max-interval': 1800 },
        quotaDraftStateRef: state,
        setActionError: () => {
        },
        t: (key: string) => key,
        quotaApi: { setConfig },
        showNotification: () => {
        },
        showConfirmation: () => {
        },
        runAction: async (_name: string, action: (current: () => boolean) => Promise<void>) => action(() => true),
    })
    await save()
    expect(writes).toEqual([{ interval: 420, 'max-interval': 1200 }]);
    expect(reads).toBe(1);
    expect(state.current.dirty).toBe(false)
})

for (const minutes of ['', 'NaN', 'Infinity', '-1', String(Number.MAX_SAFE_INTEGER)]) {
    test(
        `quota configuration rejects invalid or overflowing minute input ${JSON.stringify(minutes)} before writing`,
        async () => {
            let writes             = 0
            const errors: string[] = []
            const save             = sourceInitializer<() => Promise<void>>(
                'components/credentials/AccountInspectionPanel.tsx',
                'handleSaveQuotaConfig',
                {
                    quotaConfigLoaded: true,
                    dataGeneration: 1,
                    authGeneration: 1,
                    apiClient: { getAuthGeneration: () => 1 },
                    quotaDraft: { enabled: true, intervalMinutes: minutes, maxIntervalMinutes: '30' },
                    quotaConfig: { enabled: true, interval: 600, 'max-interval': 1800 },
                    setActionError: (value: string) => errors.push(value),
                    t: (key: string) => key,
                    quotaApi: {
                        setConfig: () => {
                            writes += 1
                        },
                    },
                },
            )
            await save();
            expect(writes).toBe(0);
            expect(errors).toEqual(['credentials.quota_config_invalid'])
        },
    )
}

for (const locale of ['en', 'ru', 'zh-CN', 'zh-TW']) {
    test(`${locale} image guide distinguishes the client CPA API Key from the upstream api-key`, () => {
        const messages = JSON.parse(readFileSync(
            new URL(`../src/i18n/locales/${locale}.json`, import.meta.url),
            'utf8',
        )).model_management
        expect(messages.image_call_token_desc).toContain('CPA API Key')
        expect(messages.image_call_token_desc).toContain('api-key')
        expect(messages.image_call_token_desc).toContain('Authorization: Bearer')
        expect(messages.image_call_config_desc).toContain('image: true')
        const page = readFileSync(new URL('../src/pages/ModelManagementPage.tsx', import.meta.url), 'utf8')
        expect(page).toContain('t(\'model_management.image_call_token_desc\')')
        expect(page).toContain('/v1/images/generations');
        expect(page).toContain('/v1/images/edits')
    })
}

const inspectionPath = 'components/credentials/AccountInspectionPanel.tsx'
const inspectionKey  = sourceCallback<(value: unknown) => string>(inspectionPath, 'rowKey', {})
const boundProbe     = {
    id: 'synthetic',
    file_name: 'synthetic.json',
    auth_index: '42',
    provider: 'codex',
    status: 'disabled',
    advice: 'enable_when_needed',
    probe_status: 'passed',
    auth_generation: 2,
    credential_digest: 'synthetic-digest',
    probe_revision: 'safe-probe-v2',
    checked_at: '2026-11-05T22:00:00Z',
}
for (const changed of
    [
        'none',
        'auth_generation',
        'credential_digest',
        'probe_revision',
        'checked_at',
        'probe_status',
        'advice',
        'connection',
        'server_409',
    ]) {
    test(`inspection enable rechecks the current proof binding: ${changed}`, async () => {
        let writes                     = 0
        let current                    = true
        const jobs: Promise<unknown>[] = []
        const fresh                    = {
            ...boundProbe, ...(['none', 'connection', 'server_409'].includes(changed) ?
                {} :
                { [changed]: changed === 'auth_generation' ? 3 : 'different' }),
        }
        const render                   = sourceCallback<(value: unknown) => { props: { onClick: () => void } }>(
            inspectionPath,
            'renderRowActions',
            {
                React,
                Button,
                rowKey: inspectionKey,
                styles: {},
                busyAction: '',
                tokenRefreshBusy: false,
                t: (key: string) => key,
                accountInspectionApi: {
                    getAllResults: async () => {
                        if (changed === 'connection') {
                            current = false
                        }

                        return [fresh]
                    },
                },
                authFilesApi: {
                    setStatus: async (_name: string, _disabled: boolean, _index: string, proof: unknown) => {
                        writes += 1
                        expect(proof).toEqual({
                                                  auth_generation: boundProbe.auth_generation,
                                                  credential_digest: boundProbe.credential_digest,
                                                  probe_revision: boundProbe.probe_revision,
                                                  checked_at: boundProbe.checked_at,
                                              })
                        if (changed === 'server_409') {
                            throw Object.assign(new Error('inspection_result_outdated'), { status: 409 })
                        }
                    },
                },
                onCredentialsChanged: () => {
                },
                showNotification: () => {
                },
                runAction: (_name: string, action: (isCurrent: () => boolean) => Promise<void>) => {
                    const job = action(() => current);
                    jobs.push(job);
                    return job
                },
            },
        )
        render(boundProbe).props.onClick()
        if (changed === 'none' || changed === 'connection') {
            await Promise.all(jobs)
        } else {
            expect(Promise.all(jobs)).rejects.toThrow('credentials.inspection_result_outdated_retry')
        }
        expect(writes).toBe(changed === 'none' || changed === 'server_409' ? 1 : 0)
    })
}
for (const probe_status of ['failed', 'inconclusive', 'passed']) {
    test(`inspection ${probe_status} and missing proof fields offer another probe instead of enable`, () => {
        const render = sourceCallback<(value: unknown) => { props: { children: unknown } }>(
            inspectionPath,
            'renderRowActions',
            {
                React,
                Button,
                rowKey: inspectionKey,
                styles: {},
                busyAction: '',
                tokenRefreshBusy: false,
                status: { status: 'idle' },
                t: (key: string) => key,
            },
        )
        expect(render({ ...boundProbe, probe_status, advice: 'none' }).props.children).toBe(
            'credentials.inspection_inspect_one')
        expect(render({ ...boundProbe, credential_digest: undefined }).props.children).toBe(
            'credentials.inspection_inspect_one')
    })
}

test(
    'real status API preserves manual requests and sends expected_probe exactly once without replaying a 409',
    async () => {
        const bodies: unknown[] = []
        const patch             = spyOn(apiClient, 'patch').mockImplementation(async <T>(
            _url: string,
            body?: unknown,
        ) => {
            bodies.push(body)
            if (bodies.length === 3) {
                throw Object.assign(new Error('inspection_result_outdated'), { status: 409 })
            }
            return { status: 'ok', disabled: false } as T
        })
        const proof             = {
            auth_generation: boundProbe.auth_generation,
            credential_digest: boundProbe.credential_digest,
            probe_revision: boundProbe.probe_revision,
            checked_at: boundProbe.checked_at,
        }
        try {
            await authFilesApi.setStatus('synthetic.json', false, '42')
            await authFilesApi.setStatus('synthetic.json', false, '42', proof)
            expect(authFilesApi.setStatus('synthetic.json', false, '42', proof)).rejects.toHaveProperty(
                'status',
                409,
            )
            expect(bodies).toEqual([
                                       { name: 'synthetic.json', disabled: false, auth_index: '42' },
                                       {
                                           name: 'synthetic.json',
                                           disabled: false,
                                           auth_index: '42',
                                           expected_probe: proof,
                                       },
                                       {
                                           name: 'synthetic.json',
                                           disabled: false,
                                           auth_index: '42',
                                           expected_probe: proof,
                                       },
                                   ])
        } finally {
            patch.mockRestore()
        }
    },
)
