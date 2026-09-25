import {describe, expect, spyOn, test} from 'bun:test'
import {apiClient} from '@/services/api/client'
import {
    buildClaudeConfigPatchRequest,
    buildCodexConfigPatchRequest,
    buildGeminiConfigPatchRequest,
    buildOpenAIProviderPatchRequest,
    buildVertexConfigPatchRequest,
    buildXAIConfigPatchRequest,
    providersApi,
} from '@/services/api/providers'
import {
    normalizeGeminiKeyConfig,
    normalizeOpenAIProvider,
    normalizeProviderKeyConfig,
} from '@/services/api/transformers'

const base = {
    apiKey: 'synthetic-key',
    authIndex: 'synthetic-auth',
    name: 'example',
    baseUrl: 'https://example.test',
    apiKeyEntries: [],
}

const providers = [
    ['claude', buildClaudeConfigPatchRequest, normalizeProviderKeyConfig, providersApi.createClaudeConfig],
    ['codex', buildCodexConfigPatchRequest, normalizeProviderKeyConfig, providersApi.createCodexConfig],
    ['xai', buildXAIConfigPatchRequest, normalizeProviderKeyConfig, providersApi.createXAIConfig],
    ['gemini', buildGeminiConfigPatchRequest, normalizeGeminiKeyConfig, providersApi.createGeminiKey],
    ['interactions', buildGeminiConfigPatchRequest, normalizeGeminiKeyConfig, providersApi.createInteractionsKey],
    ['vertex', buildVertexConfigPatchRequest, normalizeProviderKeyConfig, providersApi.createVertexConfig],
    ['openai', buildOpenAIProviderPatchRequest, normalizeOpenAIProvider, providersApi.createOpenAIProvider],
] as const

describe('credential cooling and retry overrides', () => {
    for (const [name, patch, normalize, create] of providers) {
        test(`${name} reads false, zero and negative values without materializing defaults`, () => {
            for (const [cooling, retry] of [[false, 0], [true, -1], [false, 2]] as const) {
                expect(normalize({
                    'api-key': base.apiKey,
                    name: base.name,
                    'base-url': base.baseUrl,
                    'disable-cooling': cooling,
                    'request-retry': retry,
                })).toMatchObject({disableCooling: cooling, requestRetry: retry})
            }
            const inherited = normalize({'api-key': base.apiKey, name: base.name, 'base-url': base.baseUrl})
            expect(inherited).not.toHaveProperty('disableCooling')
            expect(inherited).not.toHaveProperty('requestRetry')
        })

        test(`${name} PATCH distinguishes unchanged, explicit values and clearing`, () => {
            const original = {...base, disableCooling: true, requestRetry: 2}
            const explicit = patch(0, {...base, disableCooling: false, requestRetry: 0}, original).value
            expect(explicit).toMatchObject({'disable-cooling': false, 'request-retry': 0})
            const cleared = patch(0, {...base, disableCooling: undefined, requestRetry: undefined}, original).value
            expect(cleared).toMatchObject({'disable-cooling': null, 'request-retry': null})
            const unchanged = patch(0, {...original, prefix: 'changed'}, original).value
            expect(unchanged).not.toHaveProperty('disable-cooling')
            expect(unchanged).not.toHaveProperty('request-retry')
        })

        test(`${name} rejects invalid wire types and unsafe retry writes`, () => {
            const wire = {'api-key': base.apiKey, name: base.name, 'base-url': base.baseUrl}
            for (const value of ['false', 0, 1, [], {}]) {
                expect(() => normalize({...wire, 'disable-cooling': value})).toThrow()
            }
            for (const value of ['2', 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
                expect(() => normalize({...wire, 'request-retry': value})).toThrow()
                expect(() => patch(0, {...base, requestRetry: value as number}, base)).toThrow()
            }
            const inherited = normalize({...wire, 'disable-cooling': null, 'request-retry': null})
            expect(inherited).not.toHaveProperty('disableCooling')
            expect(inherited).not.toHaveProperty('requestRetry')
            for (const value of [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]) {
                expect(normalize({...wire, 'request-retry': value})).toHaveProperty('requestRetry', value)
            }
        })

        test(`${name} POST retains explicit false and zero`, async () => {
            const post = spyOn(apiClient, 'post').mockResolvedValue({})
            try {
                await create({...base, disableCooling: false, requestRetry: 0})
                expect(post.mock.calls[0]?.[1]).toMatchObject({'disable-cooling': false, 'request-retry': 0})
            } finally {
                post.mockRestore()
            }
        })
    }
})
