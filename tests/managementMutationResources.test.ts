import i18n from '@/i18n'
import {accountInspectionApi} from '@/services/api/accountInspection'
import {apiKeyAliasApi, apiKeysApi} from '@/services/api/apiKeys'
import {authFilesApi} from '@/services/api/authFiles'
import {apiClient} from '@/services/api/client'
import {configApi} from '@/services/api/config'
import {logsApi} from '@/services/api/logs'
import {modelCatalogApi} from '@/services/api/modelCatalog'
import {modelPricesApi} from '@/services/api/modelPrices'
import {modelsApi} from '@/services/api/models'
import {oauthApi} from '@/services/api/oauth'
import {pluginsApi, pluginStoreApi} from '@/services/api/plugins'
import {providersApi} from '@/services/api/providers'
import {quotaApi} from '@/services/api/quota'
import {rateLimitsApi} from '@/services/api/rateLimits'
import {updateApi} from '@/services/api/update'
import {usageApi} from '@/services/api/usage'
import {vertexApi} from '@/services/api/vertex'
import type {ApiError, ManagementMutationResult} from '@/types/api'
import {AxiosError, type AxiosInstance} from 'axios'
import {afterEach, expect, test} from 'bun:test'
import {readdirSync, readFileSync} from 'node:fs'
import ts from 'typescript'
import {sourceInitializer} from './sourceCallbacks'

const instance = (apiClient as unknown as {
    instance: AxiosInstance
}).instance

const adapter = instance.defaults.adapter

const key = { apiKey: 'synthetic-key' }

const provider = {
    name: 'synthetic-provider',
    baseUrl: 'https://provider.synthetic.invalid',
    apiKeyEntries: [key],
}

const cases: Array<{ name: string; readback: string; send: () => Promise<unknown>; queued?: boolean }> = [
    { name: 'settings', readback: '/config', send: () => configApi.updateDebug(true) },
    { name: 'settings delete', readback: '/config', send: () => configApi.clearProxyUrl() },
    { name: 'Gemini', readback: '/gemini-api-key', send: () => providersApi.createGeminiKey(key) },
    { name: 'Interactions', readback: '/interactions-api-key', send: () => providersApi.createInteractionsKey(key) },
    { name: 'Claude', readback: '/claude-api-key', send: () => providersApi.createClaudeConfig(key) },
    { name: 'Codex', readback: '/codex-api-key', send: () => providersApi.createCodexConfig(key) },
    { name: 'Meta', readback: '/meta-api-key', send: () => providersApi.createMetaConfig(key) },
    { name: 'xAI', readback: '/xai-api-key', send: () => providersApi.createXAIConfig(key) },
    { name: 'Vertex key', readback: '/vertex-api-key', send: () => providersApi.createVertexConfig(key) },
    { name: 'OpenAI', readback: '/openai-compatibility', send: () => providersApi.createOpenAIProvider(provider) },
    { name: 'client keys', readback: '/api-keys', send: () => apiKeysApi.replace(['synthetic-client-key']) },
    { name: 'client aliases', readback: '/api-key-aliases', send: () => apiKeyAliasApi.set('synthetic-key', 'Name') },
    {
        name: 'model catalog',
        readback: '/model-catalog',
        send: () => modelsApi.deleteModelCatalogModel('synthetic-model'),
    },
    { name: 'default models', readback: '/model-catalog', send: () => modelsApi.applyDefaultUpdate([]) },
    { name: 'remote catalog refresh', readback: '/models-catalog-meta', send: () => modelCatalogApi.refresh() },
    { name: 'prices', readback: '/model-prices', send: () => modelPricesApi.put({}) },
    {
        name: 'price recalculation',
        readback: '/usage/recalculate-costs',
        send: () => modelPricesApi.startRecalculation(),
        queued: true,
    },
    { name: 'plugin switch', readback: '/plugins', send: () => pluginsApi.setEnabled('synthetic-plugin', true) },
    {
        name: 'plugin config',
        readback: '/plugins',
        send: () => pluginsApi.patchConfig('synthetic-plugin', { limit: 1 }),
    },
    { name: 'plugin delete', readback: '/plugins', send: () => pluginsApi.deletePlugin('synthetic-plugin') },
    {
        name: 'plugin installation',
        readback: '/plugins',
        send: () => pluginStoreApi.install('synthetic-plugin'),
        queued: true,
    },
    {
        name: 'inspection',
        readback: '/account-inspection/status',
        send: () => accountInspectionApi.run(),
        queued: true,
    },
    { name: 'usage import', readback: '/usage/db-size', send: () => usageApi.importUsage({}) },
    { name: 'retention', readback: '/usage-retention', send: () => usageApi.putRetention({}) },
    { name: 'usage trim', readback: '/usage/db-size', send: () => usageApi.triggerTrim() },
    { name: 'logs clear', readback: '/logs', send: () => logsApi.clearLogs() },
    { name: 'unban', readback: '/rate-limit/status', send: () => rateLimitsApi.unban('192.0.2.10') },
    {
        name: 'Vertex import',
        readback: '/auth-files',
        send: () => vertexApi.importCredential(new File(['{}'], 'synthetic.json')),
    },
    {
        name: 'OAuth callback',
        readback: '/auth-files',
        send: () => oauthApi.submitCallback('synthetic', 'https://callback.synthetic.invalid?code=synthetic'),
    },
    {
        name: 'OAuth cancel',
        readback: '/get-auth-status',
        send: () => oauthApi.cancelSession('synthetic-state', 'synthetic-nonce'),
    },
    { name: 'cookie auth', readback: '/auth-files', send: () => oauthApi.iflowCookieAuth('synthetic-cookie') },
    { name: 'quota fetch', readback: '/quota/status', send: () => quotaApi.fetchCredential('synthetic-index') },
    { name: 'quota refresh', readback: '/quota/status', send: () => quotaApi.refresh(), queued: true },
    {
        name: 'quota pause',
        readback: '/quota/refresh-tasks/synthetic-task',
        send: () => quotaApi.pauseTask('synthetic-task'),
    },
    {
        name: 'backend update',
        readback: '/update-status',
        send: () => updateApi.trigger('v0.0.0-synthetic', 'synthetic-attempt'),
        queued: true,
    },
    { name: 'panel update', readback: '/panel-update', send: () => updateApi.panelUpdate('v0.0.0-synthetic') },
    {
        name: 'credential fields',
        readback: '/auth-files',
        send: () => authFilesApi.patchFields('synthetic.json', { note: 'changed' }, 'synthetic-index'),
    },
    { name: 'credential delete', readback: '/auth-files', send: () => authFilesApi.deleteFile('synthetic.json') },
    {
        name: 'credential upload',
        readback: '/auth-files',
        send: () => authFilesApi.upload(new File(['{}'], 'synthetic.json')),
    },
]

const resource = {
    installed: true,
    digest: `sha256:${'a'.repeat(64)}`,
    target_digest: `sha256:${'a'.repeat(64)}`,
    matches_target: true,
    files: [],
    plugins: [],
    prices: {},
    models: [],
    logs: [],
    lines: [],
    'line-count': 0,
    total: 0,
    size_bytes: 0,
    credentials: {},
}

const acknowledged = {
    status: 'ok',
    id: 'synthetic-task',
    uploaded: 1,
    deleted: 1,
    files: ['synthetic.json'],
    failed: [],
}

afterEach(() => {
    instance.defaults.adapter = adapter;
    apiClient.setConfig({ apiBase: '', sessionToken: '' })
})

for (const item of cases) {
    for (const outcome of ['succeeded', 'rejected', 'partial', 'uncertain'] as const) {
        test(`${item.name} consumes ${outcome} with its native GET and never replays the write`, async () => {
            const calls: Array<[string, string]> = []
            let mutationId                       = ''
            const confirmed                      = outcome === 'succeeded' || outcome === 'partial'
            const initialStatus                  = item.name === 'price recalculation' ?
                                                   'started' :
                                                   item.name === 'backend update' ?
                                                   'downloading' :
                                                   item.name === 'inspection' ?
                                                   'running' :
                                                   item.name === 'quota refresh' ? 'queued' : 'ok'
            const body                           = { ...acknowledged, status: initialStatus }
            const receipt                        = (): ManagementMutationResult => ({
                mutation_id: mutationId,
                request_id: 'synthetic-request',
                outcome,
                confirmed_effect: confirmed,
                effects: confirmed ?
                    [{ kind: item.queued ? 'task.queued' : 'configuration.persisted', target: 'configuration' }] :
                    [],
                audit_available: true,
            })
            instance.defaults.adapter            = async (config) => {
                const url = config.url ?? ''
                calls.push([config.method ?? '', url])
                if (config.method === 'get') {
                    return {
                        config,
                        data: url.startsWith('/mutations/') ? receipt() : resource,
                        headers: {},
                        status: 200,
                        statusText: 'OK',
                    }
                }
                mutationId = String(config.headers['X-CPA-Mutation-ID'])
                return {
                    config,
                    data: body,
                    headers: { 'X-CPA-Mutation-Result': JSON.stringify(receipt()) },
                    status: url === '/update' ? 202 : 200,
                    statusText: 'OK',
                }
            }
            if (outcome === 'succeeded' || (item.name === 'panel update' && outcome === 'uncertain')) {
                const value = await item.send()
                if (item.queued) {
                    expect(value).toHaveProperty('status', initialStatus)
                }
            } else {
                try {
                    await item.send();
                    // noinspection ExceptionCaughtLocallyJS
                    throw new Error('Expected unconfirmed result')
                } catch (error) {
                    const failure = error as ApiError
                    expect(failure.mutation?.result?.outcome).toBe(outcome)
                    expect(failure.mutation?.mutation_id).toBe(mutationId)
                    expect(failure.data).toMatchObject(body)
                }
            }
            expect(calls.filter(([method]) => method !== 'get')).toHaveLength(1)
            expect(calls.filter(([method, url]) => method === 'get' && url === item.readback)).toHaveLength(1)
            expect(mutationId).toMatch(/^[0-9a-f-]{36}$/)
        })
    }
}

for (const recovery of ['unknown', 'unavailable'] as const) {
    test(`a disconnected settings write retains ${recovery}, original error and native resource readback`, async () => {
        const calls: string[]     = []
        let id                    = ''
        instance.defaults.adapter = async (config) => {
            calls.push(`${config.method} ${config.url}`)
            if (config.method === 'put') {
                id = String(config.headers['X-CPA-Mutation-ID']);
                throw new AxiosError('synthetic disconnect', 'ERR_NETWORK', config)
            }
            if (config.url?.startsWith('/mutations/')) {
                throw new AxiosError(
                    'record unavailable',
                    'ERR_BAD_RESPONSE',
                    config,
                    undefined,
                    {
                        config,
                        data: { status: recovery },
                        headers: {},
                        status: recovery === 'unknown' ? 404 : 503,
                        statusText: 'Unavailable',
                    },
                )
            }
            return { config, data: resource, headers: {}, status: 200, statusText: 'OK' }
        }
        try {
            await configApi.updateDebug(true);
            // noinspection ExceptionCaughtLocallyJS
            throw new Error('Expected failure')
        } catch (error) {
            const failure = error as ApiError
            expect(failure.code).toBe('ERR_NETWORK')
            expect(failure.mutation?.recovery).toBe(recovery)
            expect(failure.message).toContain(id)
        }
        expect(calls).toEqual(['put /debug', `get /mutations/${id}`, 'get /config'])
    })
}

test('a legacy response still performs native readback without requiring the new receipt protocol', async () => {
    const calls: string[]     = []
    instance.defaults.adapter = async (config) => {
        calls.push(`${config.method} ${config.url}`);
        return {
            config,
            data: config.method === 'get' ? resource : acknowledged,
            headers: {},
            status: 200,
            statusText: 'OK',
        }
    }
    expect(await configApi.updateDebug(true)).toEqual(acknowledged)
    expect(calls).toEqual(['put /debug', 'get /config'])
})

test('an empty-message readback failure remains a visible failed confirmation', async () => {
    instance.defaults.adapter = async (config) => {
        if (config.method === 'get') {
            throw new Error('')
        }
        const id = String(config.headers['X-CPA-Mutation-ID'])
        return {
            config,
            data: acknowledged,
            headers: {
                'X-CPA-Mutation-Result': JSON.stringify({
                                                            mutation_id: id,
                                                            request_id: 'synthetic-request',
                                                            outcome: 'succeeded',
                                                            confirmed_effect: true,
                                                            effects: [
                                                                {
                                                                    kind: 'configuration.persisted',
                                                                    target: 'configuration',
                                                                },
                                                            ],
                                                            audit_available: true,
                                                        }),
            },
            status: 200,
            statusText: 'OK',
        }
    }
    expect(configApi.updateDebug(true)).rejects.toHaveProperty('mutation.result.outcome', 'succeeded')
})

test('every ordinary management write registers resource readback or its specialized receipt consumer', () => {
    const directory         = new URL('../src/services/api/', import.meta.url)
    const readonlyPosts     = new Set(['/api-call', '/config.yaml/validate'])
    const missing: string[] = []
    let registered          = 0
    for (const name of readdirSync(directory).filter((file) => file.endsWith('.ts'))) {
        const text  = readFileSync(new URL(name, directory), 'utf8')
        const tree  = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true)
        const visit = (node: ts.Node) => {
            if (ts.isCallExpression(node) &&
                ts.isPropertyAccessExpression(node.expression) &&
                node.expression.expression.getText(tree) ===
                'apiClient' &&
                ['post', 'put', 'patch', 'delete', 'postForm'].includes(node.expression.name.text)) {
                const endpoint = node.arguments[0]
                const path     = ts.isStringLiteralLike(endpoint) ? endpoint.text : endpoint.getText(tree)
                if (!readonlyPosts.has(path)) {
                    const options     = node.arguments[node.expression.name.text === 'delete' ? 1 : 2]
                    const specialized = path === '/config.yaml' || path === '/auth-files/status'
                    const expected    = specialized ? 'onMutationReceipt' : 'mutationReadback'
                    if (options && ts.isObjectLiteralExpression(options) && options.properties.some((property) =>
                        ts.isPropertyAssignment(property) &&
                        property.name.getText(tree) ===
                        expected &&
                        ts.isArrowFunction(property.initializer))) {
                        registered += 1
                    } else {
                        missing.push(`${name}: ${path}`)
                    }
                }
            }
            ts.forEachChild(node, visit)
        }
        visit(tree)
    }
    expect(registered).toBe(82)
    expect(missing).toEqual([])
})

test('a confirmed receipt preserves the native reset identity validation', async () => {
    instance.defaults.adapter = async (config) => {
        if (config.method === 'get') {
            return { config, data: resource, headers: {}, status: 200, statusText: 'OK' }
        }
        const id     = String(config.headers['X-CPA-Mutation-ID'])
        const result = {
            mutation_id: id,
            request_id: 'synthetic-request',
            outcome: 'succeeded',
            confirmed_effect: true,
            effects: [{ kind: 'credential.published', target: 'credential' }],
            audit_available: true,
        }
        return {
            config,
            data: { status: 'ok', auth_index: 'wrong-identity' },
            headers: { 'X-CPA-Mutation-Result': JSON.stringify(result) },
            status: 200,
            statusText: 'OK',
        }
    }
    expect(quotaApi.reset('synthetic-index')).rejects.toThrow()
})

for (const [field, matches] of [
    ['matches_target', true],
    ['matches_target', false],
    ['matches_target', 'true'],
    ['matches_target', 1],
    ['installed', 'true'],
    ['installed', 1],
] as const) {
    test(
        `panel no-op ${field}=${matches} preserves uncertain receipt without replaying publication`,
        async () => {
            const calls: string[]     = []
            let id                    = ''
            const result              = () => ({
                mutation_id: id,
                request_id: 'synthetic-panel-request',
                outcome: 'uncertain',
                confirmed_effect: false,
                effects: [],
                audit_available: true,
            })
            instance.defaults.adapter = async (config) => {
                calls.push(`${config.method} ${config.url}`)
                if (config.method === 'post') {
                    id = String(config.headers['X-CPA-Mutation-ID'])
                    return {
                        config,
                        data: { status: 'ok', message: 'Management panel updated' },
                        headers: { 'X-CPA-Mutation-Result': JSON.stringify(result()) },
                        status: 200,
                        statusText: 'OK',
                    }
                }
                if (config.url?.startsWith('/mutations/')) {
                    return { config, data: result(), headers: {}, status: 200, statusText: 'OK' }
                }
                expect(config.url).toBe('/panel-update')
                expect(config.params).toEqual({ version: 'v0.0.0-synthetic' })
                return {
                    config,
                    data: { ...resource, [field]: matches },
                    headers: {},
                    status: 200,
                    statusText: 'OK',
                }
            }
            if (matches === true) {
                const current = await updateApi.panelUpdate('v0.0.0-synthetic')
                expect(current.alreadyCurrent).toBe(true)
                expect(current.mutation?.result?.outcome).toBe('uncertain')
                expect(current.mutation?.result?.effects).toEqual([])
                expect(current.mutation?.mutation_id).toBe(id)
                expect(current.mutation?.request_id).toBe('synthetic-panel-request')
            } else {
                expect(updateApi.panelUpdate('v0.0.0-synthetic')).rejects.toHaveProperty(
                    'mutation.result.outcome',
                    'uncertain',
                )
            }
            expect(calls).toEqual(['post /panel-update', `get /mutations/${id}`, 'get /panel-update'])
        },
    )
}

test('a header-less legacy panel update retains its prior body contract without requiring the new GET', async () => {
    let count                 = 0
    instance.defaults.adapter = async (config) => {
        count += 1;
        return {
            config,
            data: { status: 'ok', message: 'legacy acknowledgement' },
            headers: {},
            status: 200,
            statusText: 'OK',
        }
    }
    expect(await updateApi.panelUpdate()).toMatchObject({
                                                            status: 'ok',
                                                            message: 'legacy acknowledgement',
                                                            alreadyCurrent: false,
                                                        })
    expect(count).toBe(1)
})

test(
    'the actual panel confirmation shows the verified target and retains both identities and unavailable audit state',
    () => {
        const result  = {
            alreadyCurrent: true,
            mutation: {
                mutation_id: 'synthetic-change-id',
                request_id: 'synthetic-request-id',
                recovery: 'unavailable',
            },
        }
        const message = sourceInitializer<string>(
            'components/system/VersionHistoryModal.tsx',
            'panelMessage',
            { result, tag: 'v0.0.0-synthetic', t: i18n.t.bind(i18n) },
        )
        for (const value of
            [
                'v0.0.0-synthetic',
                'synthetic-change-id',
                'synthetic-request-id',
                i18n.t('common.mutation_unavailable'),
            ]) {
            expect(message).toContain(value)
        }
    },
)

for (const state of [
    { ...resource, installed: false },
    { ...resource, target_digest: `sha256:${'b'.repeat(64)}` },
    { ...resource, digest: 'invalid-digest' },
]) {
    test(`panel target confirmation validates installed=${state.installed}, digest=${state.digest}`, async () => {
        let id                    = ''
        let writes                = 0
        const result              = () => ({
            mutation_id: id,
            request_id: 'synthetic-panel-request',
            outcome: 'uncertain',
            confirmed_effect: false,
            effects: [],
            audit_available: true,
        })
        instance.defaults.adapter = async (config) => {
            if (config.method === 'post') {
                writes += 1;
                id = String(config.headers['X-CPA-Mutation-ID']);
                return {
                    config,
                    data: { status: 'ok' },
                    headers: { 'X-CPA-Mutation-Result': JSON.stringify(result()) },
                    status: 200,
                    statusText: 'OK',
                }
            }
            return {
                config,
                data: config.url?.startsWith('/mutations/') ? result() : state,
                headers: {},
                status: 200,
                statusText: 'OK',
            }
        }
        expect(updateApi.panelUpdate('v0.0.0-synthetic')).rejects.toHaveProperty(
            'mutation.result.outcome',
            'uncertain',
        )
        expect(writes).toBe(1)
    })
}
