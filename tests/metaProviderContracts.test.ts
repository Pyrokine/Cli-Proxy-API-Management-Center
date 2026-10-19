import {describe, expect, spyOn, test} from 'bun:test'
import {readFileSync} from 'node:fs'

import {apiCallApi} from '@/services/api/apiCall'
import {apiClient} from '@/services/api/client'
import {modelsApi} from '@/services/api/models'
import {oauthApi} from '@/services/api/oauth'
import {findProviderConfigIndexByAuthIndex, providersApi} from '@/services/api/providers'
import {normalizeConfigResponse} from '@/services/api/transformers'

const metaEditorSource = readFileSync(new URL('../src/pages/AiProvidersMetaEditPage.tsx', import.meta.url), 'utf8')
const oauthActionSource = readFileSync(new URL('../src/components/credentials/OAuthLoginAction.tsx', import.meta.url), 'utf8')
const dashboardSource = readFileSync(new URL('../src/pages/DashboardPage.tsx', import.meta.url), 'utf8')

describe('Meta Muse provider contracts', () => {
    test('reads Meta keys and stable identities from both management views', async () => {
        const get = spyOn(apiClient, 'get').mockResolvedValue({
                                                                'meta-api-key': [
                                                                    {
                                                                        'api-key': 'meta...tail',
                                                                        'auth-index': 'meta:entry',
                                                                        'base-url': 'https://api.meta.ai/v1',
                                                                        models: [{ name: 'muse-4', alias: 'muse' }],
                                                                    },
                                                                    { 'api-key': '' },
                                                                ],
                                                            })
        try {
            const keys = await providersApi.getMetaConfigs()
            expect(get).toHaveBeenCalledWith('/meta-api-key')
            expect(keys).toHaveLength(1)
            expect(keys[0]).toMatchObject({
                                              apiKey: 'meta...tail',
                                              authIndex: 'meta:entry',
                                              baseUrl: 'https://api.meta.ai/v1',
                                              models: [{ name: 'muse-4', alias: 'muse' }],
                                          })
            expect(findProviderConfigIndexByAuthIndex(keys, 'meta:entry')).toBe(0)
            expect(normalizeConfigResponse({
                                               'meta-api-key': [{ 'api-key': 'meta...tail' }],
                                               'auth-indexes': { meta: ['meta:entry'] },
                                           }).metaApiKeys?.[0]?.authIndex).toBe('meta:entry')
        } finally {
            get.mockRestore()
        }
    })

    test('includes Meta keys in the dashboard credential total', () => {
        expect(dashboardSource).toContain('providersApi.getMetaConfigs()')
        expect(dashboardSource).toContain("meta: metaRes.status === 'fulfilled' ? metaRes.value.length : null")
        expect(dashboardSource).toContain('const providerCounts     = Object.values(providerStats)')
        expect(dashboardSource).toContain('providerCounts.reduce((total, count) => total + (count ?? 0), 0)')
    })

    test('creates, patches, and deletes Meta keys without replacing the config list', async () => {
        const original = {
            apiKey: 'meta...tail',
            authIndex: 'meta:entry',
            baseUrl: 'https://api.meta.ai/v1',
        }
        const get = spyOn(providersApi, 'getMetaConfigs').mockResolvedValue([
            {...original, authIndex: 'meta:other-a'}, {...original, authIndex: 'meta:other-b'}, original,
        ])
        const post = spyOn(apiClient, 'post').mockResolvedValue({ status: 'ok' })
        const patch = spyOn(apiClient, 'patch').mockResolvedValue({ status: 'ok' })
        const remove = spyOn(apiClient, 'delete').mockResolvedValue({ status: 'ok' })
        try {
            await providersApi.createMetaConfig({
                                                    apiKey: 'meta-new-key',
                                                    models: [{ name: 'muse-4', alias: 'muse' }],
                                                    excludedModels: ['muse-legacy'],
                                                })
            expect(post).toHaveBeenCalledWith('/meta-api-key', {
                'api-key': 'meta-new-key',
                models: [{ name: 'muse-4', alias: 'muse' }],
                'excluded-models': ['muse-legacy'],
            })

            await providersApi.patchMetaConfig(2, { ...original, weight: 3 }, original)
            expect(patch).toHaveBeenCalledWith('/meta-api-key', {
                index: 2,
                'auth-index': 'meta:entry',
                value: expect.objectContaining({ weight: 3 }),
            }, {__authGeneration: apiClient.getAuthGeneration()})
            const patchRequest = patch.mock.calls[0]?.[1] as { value: Record<string, unknown> } | undefined
            expect(patchRequest?.value).not.toHaveProperty('api-key')

            await providersApi.deleteMetaConfig(' meta...tail ', ' https://api.meta.ai/v1 ')
            expect(remove).toHaveBeenCalledWith('/meta-api-key', {
                data: { 'api-key': 'meta...tail', 'base-url': 'https://api.meta.ai/v1' },
            })
        } finally {
            get.mockRestore()
            post.mockRestore()
            patch.mockRestore()
            remove.mockRestore()
        }
    })

    test('carries device-code nonce and abort signal through Meta and international Kimi OAuth', async () => {
        const get = spyOn(apiClient, 'get').mockResolvedValue({ status: 'wait' })
        const controller = new AbortController()
        try {
            for (const provider of ['meta', 'kimi-ai'] as const) {
                await oauthApi.startAuth(provider, { nonce: 'nonce-a', signal: controller.signal })
                expect(get).toHaveBeenLastCalledWith(`/${provider}-auth-url`, {
                    params: { nonce: 'nonce-a' },
                    signal: controller.signal,
                })
            }
            await oauthApi.getAuthStatus('state-a', 'nonce-a', controller.signal)
            expect(get).toHaveBeenLastCalledWith('/get-auth-status', {
                params: { state: 'state-a', nonce: 'nonce-a' },
                signal: controller.signal,
            })
            expect(oauthActionSource).toContain('setUserCode(response.user_code?.trim() ?? \'\')')
            expect(oauthActionSource).toContain("const supportsCallback = plugin || CALLBACK_SUPPORTED.includes(provider)")
            expect(oauthActionSource).toContain('{userCode && (')
        } finally {
            get.mockRestore()
        }
    })

    test('prepares Meta model discovery without contacting an upstream provider', async () => {
        const request = spyOn(apiCallApi, 'request').mockResolvedValue({
                                                                       statusCode: 200,
                                                                       header: {},
                                                                       bodyText: '{"data":[{"id":"muse-4"}]}',
                                                                       body: { data: [{ id: 'muse-4' }] },
                                                                   })
        const controller = new AbortController()
        try {
            const models = await modelsApi.fetchV1ModelsViaApiCall(
                'https://api.meta.ai/v1',
                'meta-draft-key',
                {},
                'socks5://proxy.example.test:1080',
                'meta:entry',
                controller.signal,
            )
            expect(models.map((model) => model.name)).toEqual(['muse-4'])
            expect(request).toHaveBeenCalledWith({
                method: 'GET',
                url: 'https://api.meta.ai/v1/models',
                header: { Authorization: 'Bearer $TOKEN$' },
                proxyUrl: 'socks5://proxy.example.test:1080',
                authIndex: 'meta:entry',
                draftToken: 'meta-draft-key',
            }, { signal: controller.signal })
        } finally {
            request.mockRestore()
        }
    })

    test('uses the Meta Responses endpoint and requires a selected model for connection tests', () => {
        expect(metaEditorSource).toContain(".replace(/\\/models$/i, '/responses')")
        expect(metaEditorSource).toContain("data: JSON.stringify({ model: modelName, input: 'Hi', stream: false })")
        expect(metaEditorSource).toContain("if (!modelName) {")
        expect(metaEditorSource).toContain("const baseUrl = form.baseUrl?.trim() || DEFAULT_META_BASE_URL")
        expect(metaEditorSource).toContain("apiKey.toLowerCase().startsWith('dca:')")
        expect(metaEditorSource).toContain("i18nPrefix='meta'")
    })
})
