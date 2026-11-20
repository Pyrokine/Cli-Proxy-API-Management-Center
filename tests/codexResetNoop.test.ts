import i18n from '@/i18n'
import {apiClient} from '@/services/api/client'
import {quotaApi} from '@/services/api/quota'
import type {ManagementMutationReceipt, ManagementMutationResult} from '@/types/api'
import {AxiosError, type AxiosInstance, type InternalAxiosRequestConfig} from 'axios'
import {afterEach, beforeEach, expect, spyOn, test} from 'bun:test'

const instance        = (apiClient as unknown as { instance: AxiosInstance }).instance
const originalAdapter = instance.defaults.adapter
const identity        = 'synthetic-index'
const completed       = { status: 'ok', consumed: true, phase: 'completed', auth_index: identity, models: [] }
const cleared         = { files: [{ name: 'synthetic.json', auth_index: identity, cooldowns: [] }] }
let restoreReceipt    = () => {
}

beforeEach(() => {
    apiClient.setConfig({ apiBase: 'https://synthetic-a.invalid', managementKey: 'synthetic-management-key' })
})
afterEach(() => {
    restoreReceipt()
    instance.defaults.adapter = originalAdapter
    apiClient.setConfig({ apiBase: '', managementKey: '' })
})

function transport(options: {
    body?: Record<string, unknown>
    files?: unknown
    outcome?: ManagementMutationResult['outcome']
    legacy?: boolean
    failure?: '/quota/status' | '/auth-files'
    duringRead?: '/quota/status' | '/auth-files'
    change?: () => void
} = {}) {
    const calls: Array<[string, string]>        = []
    const observed: ManagementMutationReceipt[] = []
    let id                                      = ''
    const outcome                               = options.outcome ?? 'uncertain'
    const receipt                               = (): ManagementMutationResult => ({
        mutation_id: id,
        request_id: 'synthetic-noop-request',
        outcome,
        confirmed_effect: outcome === 'succeeded' || outcome === 'partial',
        effects: outcome === 'succeeded' || outcome === 'partial' ? [{ kind: 'quota.consumed', target: 'quota' }] : [],
        audit_available: true,
    })
    const reply                                 = (
        config: InternalAxiosRequestConfig,
        data: unknown,
        headers: Record<string, string> = {},
    ) => ({ config, data, headers, status: 200, statusText: 'OK' })
    const reconcile                             = apiClient.reconcileMutation.bind(apiClient)
    const observer                              = spyOn(apiClient, 'reconcileMutation')
        .mockImplementation(async (value) => {
            const result = await reconcile(value)
            observed.push(result)
            return result
        })
    restoreReceipt                              = () => {
        observer.mockRestore()
    }
    instance.defaults.adapter                   = async (config) => {
        const url = config.url ?? ''
        calls.push([config.method ?? '', url])
        if (config.method === 'post') {
            expect(url).toBe('/reset-quota')
            expect(JSON.parse(String(config.data))).toEqual({ auth_index: identity })
            id = String(config.headers['X-CPA-Mutation-ID'])
            return reply(
                config,
                { ...completed, ...options.body },
                options.legacy ? {} : { 'X-CPA-Mutation-Result': JSON.stringify(receipt()) },
            )
        }
        if (url.startsWith('/mutations/')) {
            return reply(config, receipt())
        }
        if (url === options.duringRead) {
            options.change?.()
        }
        if (url === options.failure) {
            throw new AxiosError(
                'synthetic snapshot unavailable', 'ERR_BAD_RESPONSE', config, undefined,
                { ...reply(config, { error: 'synthetic snapshot unavailable' }), status: 503 },
            )
        }
        if (url === '/quota/status') {
            return reply(config, { credentials: {} })
        }
        if (url === '/auth-files') {
            return reply(config, options.files === undefined ? cleared : options.files)
        }
        throw new Error(`Unexpected request: ${url}`)
    }
    return { calls, observed, id: () => id }
}

test(
    (
        'real reset client accepts an already-redeemed completed target ' +
        'and preserves its uncertain receipt and both identities'
    ),
    async () => {
        const fixture = transport()
        expect(quotaApi.reset(identity)).resolves.toBeUndefined()
        expect(fixture.calls).toEqual([
                                          ['post', '/reset-quota'],
                                          ['get', `/mutations/${fixture.id()}`],
                                          ['get', '/quota/status'],
                                          ['get', '/auth-files'],
                                      ])
        expect(fixture.observed[fixture.observed.length - 1]).toMatchObject(
            {
                mutation_id: fixture.id(),
                request_id: 'synthetic-noop-request',
                result: {
                    outcome: 'uncertain',
                    confirmed_effect: false,
                    effects: [],
                    mutation_id: fixture.id(),
                    request_id: 'synthetic-noop-request',
                },
            })
    },
)

for (const [name, body] of [
    ['missing consumption', { consumed: undefined }],
    ['unconfirmed consumption', { consumed: false }],
    ['missing completion', { phase: undefined }],
    ['cleanup incomplete', { phase: 'local_cleanup' }],
    ['wrong original identity', { auth_index: 'different-index' }],
    ['missing original identity', { auth_index: undefined }],
] as const) {
    test(`${name} keeps the no-effect receipt uncertain and never starts another operation`, async () => {
        const fixture = transport({ body })
        expect(quotaApi.reset(identity)).rejects.toHaveProperty('mutation.result.outcome', 'uncertain')
        expect(fixture.calls.filter(([method]) => method !== 'get')).toEqual([['post', '/reset-quota']])
        expect(fixture.calls.some(([, path]) => path === '/auth-files' || path === '/quota/fetch')).toBe(false)
    })
}

for (const [name, files] of [
    ['missing target', { files: [] }],
    ['missing binding', { files: [{ name: 'synthetic.json', cooldowns: [] }] }],
    ['different binding', { files: [{ auth_index: 'different-index', cooldowns: [] }] }],
    ['missing snapshot', { files: [{ auth_index: identity }] }],
    ['unknown snapshot', { files: [{ auth_index: identity, cooldowns: null }] }],
    ['malformed snapshot', { files: [{ auth_index: identity, cooldowns: {} }] }],
    [
        'credential cooldown remains',
        { files: [{ auth_index: identity, cooldowns: [{ scope: 'credential', remaining_seconds: 10 }] }] },
    ],
    [
        'model cooldown remains',
        {
            files: [
                {
                    auth_index: identity,
                    cooldowns: [{ scope: 'model', model_key: 'synthetic-model', remaining_seconds: 10 }],
                },
            ],
        },
    ],
    [
        'unbound shared-file metadata',
        { files: [{ name: 'synthetic.json', cooldowns: [] }, { name: 'synthetic.json', auth_index: identity }] },
    ],
    [
        'conflicting snapshots of the same identity',
        { files: [{ auth_index: identity, cooldowns: [] }, { auth_index: identity, cooldowns: null }] },
    ],
] as const) {
    test(`${name} does not confirm a reset target through another identity or unknown state`, async () => {
        const fixture = transport({ files })
        expect(quotaApi.reset(identity)).rejects.toHaveProperty('mutation.result.outcome', 'uncertain')
        expect(fixture.calls.filter(([method]) => method !== 'get')).toEqual([['post', '/reset-quota']])
        expect(fixture.calls[fixture.calls.length - 1]).toEqual(['get', '/auth-files'])
    })
}

for (const failure of ['/quota/status', '/auth-files'] as const) {
    test(`${failure} readback failure remains visible with the original mutation identity`, async () => {
        const fixture = transport({ failure })
        try {
            await quotaApi.reset(identity);
            // noinspection ExceptionCaughtLocallyJS
            throw new Error('Expected readback failure')
        } catch (error) {
            const current = error as { message: string; mutation?: ManagementMutationReceipt }
            expect(current.message).toContain('synthetic snapshot unavailable')
            expect(current.mutation?.result?.outcome).toBe('uncertain')
            expect(current.mutation?.mutation_id).toBe(fixture.id())
        }
        expect(fixture.calls.filter(([method]) => method !== 'get')).toHaveLength(1)
    })
}

for (const duringRead of ['/quota/status', '/auth-files'] as const) {
    test(`A-B-A connection changes during ${duringRead} cannot confirm the original reset`, async () => {
        const fixture = transport({
                                      duringRead, change: () => {
                apiClient.setConfig({ apiBase: 'https://synthetic-b.invalid', managementKey: 'synthetic-b' })
                apiClient.setConfig({
                                        apiBase: 'https://synthetic-a.invalid',
                                        managementKey: 'synthetic-management-key',
                                    })
            },
                                  })
        expect(quotaApi.reset(identity)).rejects.toThrow(i18n.t('common.connection_changed'))
        expect(fixture.calls.filter(([method]) => method !== 'get')).toHaveLength(1)
        if (duringRead === '/quota/status') {
            expect(fixture.calls.some(([, path]) => path === '/auth-files')).toBe(false)
        }
        expect(fixture.observed.every((value) => value.result?.outcome === 'uncertain')).toBe(true)
    })
}

for (const outcome of ['partial', 'rejected'] as const) {
    test(`a completed body does not upgrade a ${outcome} receipt`, async () => {
        const fixture = transport({ outcome })
        expect(quotaApi.reset(identity)).rejects.toHaveProperty('mutation.result.outcome', outcome)
        expect(fixture.calls.some(([, path]) => path === '/auth-files')).toBe(false)
        expect(fixture.calls.filter(([method]) => method !== 'get')).toHaveLength(1)
    })
}

for (const legacy of [true, false]) {
    test(`ordinary successful reset legacy=${legacy} keeps its old response and readback contract`, async () => {
        const fixture = transport({ legacy, outcome: 'succeeded', body: { consumed: undefined, phase: undefined } })
        expect(quotaApi.reset(identity)).resolves.toBeUndefined()
        expect(fixture.calls).toEqual([['post', '/reset-quota'], ['get', '/quota/status']])
    })
}

test('cancelling an already-completed reset during target readback does not confirm or replay it', async () => {
    const controller = new AbortController()
    const fixture    = transport({ duringRead: '/auth-files', change: () => controller.abort() })
    expect(quotaApi.reset(identity, { signal: controller.signal })).rejects.toHaveProperty(
        'mutation.result.outcome',
        'uncertain',
    )
    expect(fixture.calls.filter(([method]) => method !== 'get')).toEqual([['post', '/reset-quota']])
})
