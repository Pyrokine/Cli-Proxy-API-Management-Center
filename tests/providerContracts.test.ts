import {describe, expect, spyOn, test} from 'bun:test'

import {
    buildInteractionsEndpoint,
    buildInteractionsProbePayload,
    INTERACTIONS_API_REVISION,
} from '@/components/providers/utils'
import {API_CALL_TOKEN, prepareApiCallAuth} from '@/services/api/apiCall'
import {apiClient} from '@/services/api/client'
import {
    buildClaudeConfigPatchRequest,
    buildCodexConfigPatchRequest,
    buildGeminiConfigPatchRequest,
    buildOpenAIProviderPatchRequest,
    buildXAIConfigPatchRequest,
    providersApi,
} from '@/services/api/providers'
import {
    normalizeConfigResponse,
    normalizeGeminiKeyConfig,
    normalizeOpenAIProvider,
    normalizeProviderKeyConfig,
} from '@/services/api/transformers'

describe('api-call token contract', () => {
    test('uses a draft token with the required placeholder', () => {
        const prepared = prepareApiCallAuth({
                                                apiKey: 'draft-secret',
                                                preferredHeader: 'Authorization',
                                                authorizationScheme: 'Bearer',
                                            })

        expect(prepared.headers.Authorization).toBe(`Bearer ${API_CALL_TOKEN}`)
        expect(prepared.draftToken).toBe('draft-secret')
    })

    test('uses auth-index for a persisted masked credential', () => {
        const prepared = prepareApiCallAuth({
                                                apiKey: 'sk-pro...tail',
                                                authIndex: 'auth-123',
                                                preferredHeader: 'x-api-key',
                                            })

        expect(prepared.headers['x-api-key']).toBe(API_CALL_TOKEN)
        expect(prepared.draftToken).toBeUndefined()
    })

    test('treats four-star redaction as a persisted credential mask', () => {
        const prepared = prepareApiCallAuth({
                                                apiKey: '****',
                                                authIndex: 'auth-short-key',
                                                preferredHeader: 'x-api-key',
                                            })

        expect(prepared.headers['x-api-key']).toBe(API_CALL_TOKEN)
        expect(prepared.draftToken).toBeUndefined()
    })

    test('rejects a stored credential header mixed with an explicit credential header', () => {
        expect(() => prepareApiCallAuth({
                                            headers: {
                                                'x-api-key': '****',
                                                Authorization: 'Bearer token-b',
                                            },
                                            authIndex: 'auth-123',
                                            preferredHeader: 'x-api-key',
                                            headerNames: ['Authorization'],
                                        })).toThrow('Multiple credential headers require different tokens')
    })

    test('rejects different credentials in multiple protected headers', () => {
        expect(() => prepareApiCallAuth({
                                            headers: {
                                                'x-api-key': 'key-a',
                                                Authorization: 'Bearer token-b',
                                            },
                                            preferredHeader: 'x-api-key',
                                            headerNames: ['Authorization'],
                                        })).toThrow('Multiple credential headers require different tokens')
    })

    test('converts a custom restricted header to the placeholder contract', () => {
        const prepared = prepareApiCallAuth({
                                                headers: { 'x-goog-api-key': 'custom-secret' },
                                                apiKey: 'field-secret',
                                                preferredHeader: 'x-goog-api-key',
                                                headerNames: ['Authorization'],
                                            })

        expect(prepared.headers['x-goog-api-key']).toBe(API_CALL_TOKEN)
        expect(prepared.draftToken).toBe('custom-secret')
    })
})

describe('provider mutation contract', () => {
    test('Gemini PATCH uses auth-index and preserves an unchanged secret', () => {
        const original = {
            apiKey: 'gem...tail',
            authIndex: 'gemini-auth',
            priority: 1,
            prefix: 'old',
        }
        const request  = buildGeminiConfigPatchRequest(
            3,
            { ...original, priority: 9, weight: 0, prefix: '', models: [], excludedModels: [] },
            original,
        )

        expect(request.index).toBe(3)
        expect(request['auth-index']).toBe('gemini-auth')
        expect(request.value).not.toHaveProperty('api-key')
        expect(request.value).toMatchObject({priority: 9, weight: 0, prefix: ''})
        expect(request.value).not.toHaveProperty('models')
        expect(request.value).not.toHaveProperty('excluded-models')
    })

    test('Claude PATCH requires stable credential identity', () => {
        const original = {
            apiKey: 'cla...tail',
            baseUrl: 'https://api.anthropic.com',
        }

        expect(() => buildClaudeConfigPatchRequest(0, { ...original, priority: 2 }, original)).toThrow(
            'Claude credential identity is unavailable',
        )

        const request = buildClaudeConfigPatchRequest(
            0,
            { ...original, priority: 2 },
            { ...original, authIndex: 'claude-auth', weight: 4 },
        )
        expect(request['auth-index']).toBe('claude-auth')
        expect(request.value.weight).toBeNull()
    })

    test('Codex PATCH carries changed editable fields and a changed secret', () => {
        const original = {
            apiKey: 'cod...tail',
            authIndex: 'codex-auth',
            baseUrl: 'https://api.openai.com',
        }
        const request  = buildCodexConfigPatchRequest(
            1,
            {
                apiKey: 'new-secret',
                baseUrl: 'https://api.openai.com/v1',
                priority: 4,
                weight: 3,
                websockets: true,
                models: [{ name: 'gpt-upstream', alias: 'gpt-alias' }],
                excludedModels: ['gpt-old'],
            },
            original,
        )

        expect(request['auth-index']).toBe('codex-auth')
        expect(request.value['api-key']).toBe('new-secret')
        expect(request.value).toHaveProperty('weight', 3)
        expect(request.value).toHaveProperty('websockets', true)
        expect(request.value).toHaveProperty('models', [{ name: 'gpt-upstream', alias: 'gpt-alias' }])
        expect(request.value).toHaveProperty('excluded-models', ['gpt-old'])
    })

    test('OpenAI PATCH identifies the original provider name', () => {
        const original = {
            name: 'old-provider',
            baseUrl: 'https://api.openai.com',
            apiKeyEntries: [{ apiKey: 'old...tail' }],
        }
        const request  = buildOpenAIProviderPatchRequest(
            2,
            {
                name: 'new-provider',
                baseUrl: 'https://api.openai.com/v1',
                apiKeyEntries: [{ ...original.apiKeyEntries[0]!, authIndex: 'openai:entry', weight: 2 }],
                priority: 5,
            },
            original,
        )

        expect(request.index).toBe(2)
        expect(request.name).toBe('old-provider')
        expect(request.value.name).toBe('new-provider')
        expect(request.value.priority).toBe(5)
        expect(request.value['api-key-entries']).toEqual([{ 'api-key': 'old...tail', weight: 2 }])
    })

    test('keeps OpenAI entry positions and never inherits a provider auth-index', () => {
        const provider = normalizeOpenAIProvider({
                                                     name: 'multi-key',
                                                     'base-url': 'https://example.com/v1',
                                                     'auth-index': 'openai:provider',
                                                     'api-key-entries': [
                                                         {},
                                                         { 'api-key': 'masked-key' },
                                                     ],
                                                 })

        expect(provider?.apiKeyEntries).toEqual([
                                                    {
                                                        apiKey: '',
                                                        proxyUrl: undefined,
                                                        headers: undefined,
                                                        authIndex: undefined,
                                                        weight: undefined,
                                                    },
                                                    {
                                                        apiKey: 'masked-key',
                                                        proxyUrl: undefined,
                                                        headers: undefined,
                                                        authIndex: undefined,
                                                        weight: undefined,
                                                    },
                                                ])
    })

    test('uses the xAI stable identity for provider updates', () => {
        const original = {
            apiKey: 'xai...tail',
            authIndex: 'xai:auth',
            baseUrl: 'https://api.x.ai/v1',
        }
        const request  = buildXAIConfigPatchRequest(
            1,
            { ...original, weight: 3, websockets: true, disableCooling: true },
            original,
        )

        expect(request).toMatchObject({
                                          index: 1,
                                          'auth-index': 'xai:auth',
                                          value: { weight: 3, websockets: true, 'disable-cooling': true },
                                      })
        expect(request.value).not.toHaveProperty('api-key')
    })

    test('builds the native Interactions probe contract', () => {
        expect(buildInteractionsEndpoint('')).toBe(
            'https://generativelanguage.googleapis.com/v1beta/interactions',
        )
        expect(buildInteractionsEndpoint('https://generativelanguage.googleapis.com')).toBe(
            'https://generativelanguage.googleapis.com/v1beta/interactions',
        )
        expect(buildInteractionsEndpoint('https://example.com/v1beta')).toBe(
            'https://example.com/v1beta/interactions',
        )
        expect(buildInteractionsEndpoint('https://example.com/v1beta/interactions')).toBe(
            'https://example.com/v1beta/interactions',
        )
        expect(INTERACTIONS_API_REVISION).toBe('2026-05-20')
        expect(buildInteractionsProbePayload('gemini-3.6-flash')).toEqual({
                                                                              model: 'gemini-3.6-flash',
                                                                              input: 'Hi',
                                                                          })
    })

    test('uses the dedicated Interactions endpoint and Gemini-compatible contract', async () => {
        const get   = spyOn(apiClient, 'get').mockResolvedValue({
                                                                    'interactions-api-key': [
                                                                        {
                                                                            'api-key': 'masked-key',
                                                                            'auth-index': 'interactions-auth',
                                                                            weight: 0,
                                                                        },
                                                                    ],
                                                                })
        const patch = spyOn(apiClient, 'patch').mockResolvedValue({ status: 'ok' })

        try {
            const keys = await providersApi.getInteractionsKeys()
            expect(get).toHaveBeenCalledWith('/interactions-api-key')
            expect(keys[0]).toMatchObject({ apiKey: 'masked-key', authIndex: 'interactions-auth', weight: 0 })

            await providersApi.patchInteractionsKey(0, { ...keys[0]!, weight: 3 }, keys[0]!)
            expect(patch).toHaveBeenCalledWith('/interactions-api-key', {
                index: 0,
                'auth-index': 'interactions-auth',
                value: expect.objectContaining({ weight: 3 }),
            }, {__authGeneration: apiClient.getAuthGeneration()})
        } finally {
            get.mockRestore()
            patch.mockRestore()
        }
    })

    test('normalizes provider and API-key entry weights without losing explicit zero', () => {
        expect(normalizeGeminiKeyConfig({ 'api-key': 'gemini-key', weight: 0 })?.weight).toBe(0)
        expect(normalizeProviderKeyConfig({ 'api-key': 'codex-key', weight: '7' })?.weight).toBe(7)
        expect(normalizeProviderKeyConfig({ 'api-key': 'codex-key', weight: 1.5 })?.weight).toBeUndefined()
        expect(normalizeProviderKeyConfig({
                                              'api-key': 'xai-key',
                                              'disable-cooling': true,
                                          })?.disableCooling).toBe(true)
        expect(normalizeOpenAIProvider({
                                           name: 'openai',
                                           'base-url': 'https://api.openai.com',
                                           'api-key-entries': [{ 'api-key': 'openai-key', weight: 4 }],
                                       })?.apiKeyEntries[0]?.weight).toBe(4)
    })

    test('merges the compact config auth-index view by provider and API-key entry', () => {
        const config = normalizeConfigResponse({
                                                   'claude-api-key': [
                                                       { 'api-key': 'claude-a' },
                                                       { 'api-key': 'claude-b', 'auth-index': 'claude:embedded' },
                                                   ],
                                                   'xai-api-key': [{ 'api-key': 'xai-a' }],
                                                   'openai-compatibility': [
                                                       {
                                                           name: 'multi-key',
                                                           'base-url': 'https://example.com/v1',
                                                           'api-key-entries': [
                                                               {},
                                                               { 'api-key': 'openai-b' },
                                                           ],
                                                       },
                                                       {
                                                           name: 'without-keys',
                                                           'base-url': 'https://empty.example.com/v1',
                                                           'api-key-entries': [],
                                                       },
                                                   ],
                                                   'auth-indexes': {
                                                       claude: ['claude:a', ''],
                                                       xai: ['xai:a'],
                                                       'openai-entries': [['openai:a', 'openai:b'], []],
                                                       'openai-fallback': ['', 'openai:fallback'],
                                                   },
                                               })

        expect(config.claudeApiKeys?.map((item) => item.authIndex)).toEqual([
                                                                                'claude:a',
                                                                                'claude:embedded',
                                                                            ])
        expect(config.xaiApiKeys?.[0]?.authIndex).toBe('xai:a')
        expect(config.openaiCompatibility?.[0]?.apiKeyEntries.map((entry) => ({
            apiKey: entry.apiKey,
            authIndex: entry.authIndex,
        }))).toEqual([
                         { apiKey: '', authIndex: 'openai:a' },
                         { apiKey: 'openai-b', authIndex: 'openai:b' },
                     ])
        expect(config.openaiCompatibility?.[0]?.authIndex).toBeUndefined()
        expect(config.openaiCompatibility?.[1]?.authIndex).toBe('openai:fallback')
    })
})
