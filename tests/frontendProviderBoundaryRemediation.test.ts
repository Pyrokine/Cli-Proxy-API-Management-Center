import {getApiCallErrorMessage, prepareApiCallAuth} from '@/services/api/apiCall'
import {apiClient} from '@/services/api/client'
import {modelsApi} from '@/services/api/models'
import {providersApi} from '@/services/api/providers'
import {normalizeConfigResponse} from '@/services/api/transformers'
import {buildHeaderObject, hasHeader} from '@/utils/headers'
import {getErrorMessage} from '@/utils/helpers'
import {expect, spyOn, test} from 'bun:test'
import {sourceInitializer} from './sourceCallbacks'

const buildCodexChatCompletionsEndpoint = sourceInitializer<(baseUrl: string) => string>(
    'pages/AiProvidersCodexEditPage.tsx',
    'buildCodexChatCompletionsEndpoint',
    { modelsApi },
)

test('both Meta management consumers preserve all eleven adopted flat fields and stable identity', async () => {
    const raw      = {
        'api-key': 'synthetic-meta',
        'auth-index': 'synthetic-meta-index',
        priority: 3,
        weight: 2,
        prefix: 'private',
        'base-url': 'https://meta.synthetic.invalid/v1',
        'proxy-url': 'http://proxy.synthetic.invalid',
        headers: { 'X-Synthetic': 'retained' },
        models: [{ name: 'model', alias: 'public' }],
        'excluded-models': ['Model-*'],
        'disable-cooling': false,
        'request-retry': 0,
    }
    const expected = {
        apiKey: raw['api-key'], authIndex: raw['auth-index'], priority: 3, weight: 2, prefix: 'private',
        baseUrl: raw['base-url'], proxyUrl: raw['proxy-url'], headers: raw.headers, models: raw.models,
        excludedModels: ['Model-*'], disableCooling: false, requestRetry: 0,
    }
    const get      = spyOn(apiClient, 'get').mockResolvedValue({ 'meta-api-key': [raw] })
    const post     = spyOn(apiClient, 'post').mockResolvedValue({ status: 'ok' })
    try {
        const dedicated = (await providersApi.getMetaConfigs())[0]
        expect(dedicated).toMatchObject(expected)
        expect(normalizeConfigResponse({ 'meta-api-key': [raw] }).metaApiKeys?.[0]).toMatchObject(expected)
        await providersApi.createMetaConfig(dedicated)
        const payload = post.mock.calls[0][1] as Record<string, unknown>
        for (const [key, value] of Object.entries(raw)) {
            if (key !== 'auth-index') {
                expect(payload[key]).toEqual(value)
            }
        }
    } finally {
        get.mockRestore();
        post.mockRestore()
    }
})

for (const scenario of ['body-error', 'timeout', 'success'] as const) {
    test(`the actual Codex entry and shared connectivity consumer handle ${scenario}`, async () => {
        const statuses: string[]                                              = []
        const errors: string[]                                                = []
        const notices: Array<[string, string]>                                = []
        const requests: Array<[Record<string, unknown>, { timeout: number }]> = []
        const t                                                               = (key: string) => key
        const noop                                                            = () => {
        }
        const showTestError                                                   = (message: string) => {
            statuses.push('error');
            errors.push(message)
        }
        const runConnectivityTest                                             = sourceInitializer<(
            request: () => Promise<unknown>,
            messages: unknown,
        ) => Promise<void>>(
            'hooks/useProviderConnectivityTestState.ts', 'runConnectivityTest', {
                useCallback: <T>(value: T) => value,
                previousConfigRef: { current: 'synthetic-signature' },
                configSignature: 'synthetic-signature',
                authGeneration: 1,
                apiClient: { getAuthGeneration: () => 1 },
                testRequestRef: { current: null },
                setIsTesting: noop,
                setTestStatus: (value: string) => statuses.push(value),
                setTestMessage: noop,
                showTestError,
                showNotification: (message: string, kind: string) => notices.push([message, kind]),
                getErrorMessage,
                getApiCallErrorMessage,
            },
        )
        const timeout                                                         = sourceInitializer<number>(
            'pages/AiProvidersCodexEditPage.tsx',
            'CODEX_TEST_TIMEOUT_MS',
            {},
        )
        const run                                                             = sourceInitializer<() => Promise<void>>(
            'pages/AiProvidersCodexEditPage.tsx',
            'runCodexConnectivityTest',
            {
                isTesting: false,
                form: {
                    baseUrl: 'https://codex.synthetic.invalid',
                    apiKey: 'synthetic-key',
                    headers: [],
                    proxyUrl: 'http://proxy.synthetic.invalid',
                },
                testModel: 'synthetic-model',
                availableModels: [],
                DEFAULT_CODEX_TEST_MODEL: 'default',
                buildHeaderObject,
                hasHeader,
                buildCodexChatCompletionsEndpoint,
                prepareApiCallAuth,
                runConnectivityTest,
                showTestError,
                getErrorMessage,
                t,
                CODEX_TEST_TIMEOUT_MS: timeout,
                apiCallApi: {
                    request: async (request: Record<string, unknown>, options: { timeout: number }) => {
                        requests.push([request, options])
                        if (scenario === 'timeout') {
                            throw Object.assign(new Error('request timed out'), { code: 'ECONNABORTED' })
                        }
                        const body = scenario === 'body-error' ?
                            { error: { message: 'synthetic provider rejection' } } :
                            { choices: [{ message: { content: 'Hi' } }] }
                        return { statusCode: 200, header: {}, bodyText: JSON.stringify(body), body }
                    },
                },
            },
        )
        await run()
        expect(requests).toHaveLength(1)
        expect(requests[0][0]).toMatchObject({
                                                 method: 'POST',
                                                 url: 'https://codex.synthetic.invalid/v1/chat/completions',
                                                 proxyUrl: 'http://proxy.synthetic.invalid',
                                             })
        expect(requests[0][1].timeout).toBe(timeout)
        expect(timeout).toBeGreaterThan(0)
        if (scenario === 'success') {
            expect(statuses).toContain('success');
            expect(errors).toEqual([])
        } else {
            expect(statuses).toContain('error')
            expect(statuses).not.toContain('success')
            expect(notices.some(([, kind]) => kind === 'success')).toBe(false)
            expect(errors.join(' ')).toContain(scenario === 'body-error' ?
                                               'synthetic provider rejection' :
                                               'ai_providers.codex_test_timeout')
        }
    })
}
