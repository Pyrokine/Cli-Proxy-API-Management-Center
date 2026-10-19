import {describe, expect, test} from 'bun:test'
import type {AxiosInstance} from 'axios'

import {apiClient} from '@/services/api/client'
import {providersApi} from '@/services/api/providers'
import {computeApiUrl, normalizeApiBase} from '@/utils/connection'

for (const trailing of ['', '/', '///']) {
    test(`normalizes the management suffix before adding it with trailing ${JSON.stringify(trailing)}`, () => {
        const input = `https://fixture-a.invalid/gateway/v0/management${trailing}`
        const base = 'https://fixture-a.invalid/gateway'
        expect(normalizeApiBase(input)).toBe(base)
        expect(computeApiUrl(input)).toBe(`${base}/v0/management`)
        expect(normalizeApiBase(normalizeApiBase(input))).toBe(base)
    })
}

const instance = (apiClient as unknown as {instance: AxiosInstance}).instance
const families = [
    {path: '/gemini-api-key', load: async () => {
        const original = (await providersApi.getGeminiKeys())[0]!
        return () => providersApi.patchGeminiKey(0, {...original, priority: 2}, original)
    }},
    {path: '/interactions-api-key', load: async () => {
        const original = (await providersApi.getInteractionsKeys())[0]!
        return () => providersApi.patchInteractionsKey(0, {...original, priority: 2}, original)
    }},
    {path: '/codex-api-key', load: async () => {
        const original = (await providersApi.getCodexConfigs())[0]!
        return () => providersApi.patchCodexConfig(0, {...original, priority: 2}, original)
    }},
    {path: '/meta-api-key', load: async () => {
        const original = (await providersApi.getMetaConfigs())[0]!
        return () => providersApi.patchMetaConfig(0, {...original, priority: 2}, original)
    }},
    {path: '/xai-api-key', load: async () => {
        const original = (await providersApi.getXAIConfigs())[0]!
        return () => providersApi.patchXAIConfig(0, {...original, priority: 2}, original)
    }},
    {path: '/claude-api-key', load: async () => {
        const original = (await providersApi.getClaudeConfigs())[0]!
        return () => providersApi.patchClaudeConfig(0, {...original, priority: 2}, original)
    }},
    {path: '/vertex-api-key', load: async () => {
        const original = (await providersApi.getVertexConfigs())[0]!
        return () => providersApi.patchVertexConfig(0, {...original, priority: 2}, original)
    }},
    {path: '/openai-compatibility', load: async () => {
        const original = (await providersApi.getOpenAIProviders())[0]!
        return () => providersApi.patchOpenAIProvider(0, {...original, priority: 2}, original)
    }},
]

for (const method of ['get', 'post', 'put', 'patch', 'delete', 'getRaw', 'postForm'] as const) {
    test(`${method} binds the connection before the Axios interceptor runs`, async () => {
        const originalAdapter = instance.defaults.adapter
        let dispatched = 0
        instance.defaults.adapter = async (config) => {
            dispatched += 1
            return {config, status: 200, statusText: 'OK', headers: {}, data: {}}
        }
        apiClient.setConfig({apiBase: 'https://fixture-a.invalid', managementKey: 'fixture-key-a'})
        try {
            const work = method === 'get' || method === 'delete' || method === 'getRaw'
                ? apiClient[method]('/fixture')
                : method === 'postForm'
                    ? apiClient.postForm('/fixture', new FormData())
                    : apiClient[method]('/fixture', {})
            apiClient.setConfig({apiBase: 'https://fixture-b.invalid', managementKey: 'fixture-key-b'})
            await expect(work).rejects.toThrow()
            expect(dispatched).toBe(0)
        } finally {
            instance.defaults.adapter = originalAdapter
            apiClient.setConfig({apiBase: '', managementKey: ''})
        }
    })
}

const fixture = {
    'api-key': 'fixture-masked-key',
    'auth-index': 'fixture-auth-index',
    'base-url': 'https://fixture-provider.invalid',
    name: 'fixture-provider',
    'api-key-entries': [{'api-key': 'fixture-masked-key'}],
}

for (const family of families) {
    describe(`${family.path} connection isolation`, () => {
        for (const switchAt of ['read response', 'write interceptor'] as const) {
            test(`aborts writes when the connection changes at ${switchAt}`, async () => {
                const originalAdapter = instance.defaults.adapter
                const requests: Array<{method?: string; baseURL?: string}> = []
                let switchConnection = false
                apiClient.setConfig({apiBase: 'https://fixture-a.invalid', managementKey: 'fixture-key-a'})
                const hook = instance.interceptors.request.use((config) => {
                    if (switchAt === 'write interceptor' && config.method === 'patch') {
                        apiClient.setConfig({apiBase: 'https://fixture-b.invalid', managementKey: 'fixture-key-b'})
                    }
                    return config
                })
                instance.defaults.adapter = async (config) => {
                    requests.push({method: config.method, baseURL: config.baseURL})
                    if (switchConnection && switchAt === 'read response') {
                        apiClient.setConfig({apiBase: 'https://fixture-b.invalid', managementKey: 'fixture-key-b'})
                    }
                    return {
                        config, status: 200, statusText: 'OK', headers: {},
                        data: {[family.path.slice(1)]: [fixture]},
                    }
                }
                try {
                    const save = await family.load()
                    switchConnection = true
                    await expect(save()).rejects.toThrow()
                    expect(requests).toHaveLength(2)
                    expect(requests.every((request) => request.method === 'get' &&
                        request.baseURL === 'https://fixture-a.invalid/v0/management')).toBe(true)
                } finally {
                    instance.interceptors.request.eject(hook)
                    instance.defaults.adapter = originalAdapter
                    apiClient.setConfig({apiBase: '', managementKey: ''})
                }
            })
        }
    })
}
