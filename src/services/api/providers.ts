/**
 * AI 提供商相关 API
 */

import type {ApiKeyEntry, GeminiKeyConfig, ModelAlias, OpenAIProviderConfig, ProviderKeyConfig} from '@/types'
import {apiClient} from './client'
import {normalizeGeminiKeyConfig, normalizeOpenAIProvider, normalizeProviderKeyConfig} from './transformers'

const serializeHeaders = (headers?: Record<string, string>) =>
    headers && Object.keys(headers).length ? headers : undefined

const isRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value)

const extractArrayPayload = (data: unknown, key: string): unknown[] => {
    if (Array.isArray(data)) {
        return data
    }
    if (!isRecord(data)) {
        return []
    }
    const candidate = data[key] ?? data.items ?? data.data ?? data
    return Array.isArray(candidate) ? candidate : []
}

const providerDeleteBody = (apiKey: string, baseUrl?: string) => {
    const payload: Record<string, string> = { 'api-key': apiKey.trim() }
    const trimmedBaseUrl                  = (baseUrl ?? '').trim()
    if (trimmedBaseUrl) {
        payload['base-url'] = trimmedBaseUrl
    }
    return payload
}

const serializeModelAliases = (models?: ModelAlias[]) =>
    Array.isArray(models)
    ? models
        .map((model) => {
            if (!model?.name) {
                return null
            }
            const payload: Record<string, unknown> = { name: model.name }
            if (model.alias && model.alias !== model.name) {
                payload.alias = model.alias
            }
            if (model.priority !== undefined) {
                payload.priority = model.priority
            }
            if (model.testModel) {
                payload['test-model'] = model.testModel
            }
            return payload
        })
        .filter(Boolean)
    : undefined

const serializeApiKeyEntry = (entry: ApiKeyEntry) => {
    const payload: Record<string, unknown> = { 'api-key': entry.apiKey }
    if (entry.proxyUrl) {
        payload['proxy-url'] = entry.proxyUrl
    }
    if (entry.authIndex?.trim()) {
        payload['auth-index'] = entry.authIndex.trim()
    }
    const headers = serializeHeaders(entry.headers)
    if (headers) {
        payload.headers = headers
    }
    return payload
}

const serializeBaseKeyPayload = (config: {
    apiKey: string
    priority?: number
    prefix?: string
    baseUrl?: string
    proxyUrl?: string
    headers?: Record<string, string>
}): Record<string, unknown> => {
    const payload: Record<string, unknown> = { 'api-key': config.apiKey }
    if (config.priority !== undefined) {
        payload.priority = config.priority
    }
    if (config.prefix?.trim()) {
        payload.prefix = config.prefix.trim()
    }
    if (config.baseUrl) {
        payload['base-url'] = config.baseUrl
    }
    if (config.proxyUrl) {
        payload['proxy-url'] = config.proxyUrl
    }
    const headers = serializeHeaders(config.headers)
    if (headers) {
        payload.headers = headers
    }
    return payload
}

const serializeCloakConfig = (config: ProviderKeyConfig['cloak']): Record<string, unknown> | null => {
    if (!config) {
        return null
    }
    return {
        mode: config.mode?.trim() || 'auto',
        'strict-mode': Boolean(config.strictMode),
        'sensitive-words': Array.isArray(config.sensitiveWords) ? config.sensitiveWords : [],
    }
}

const serializeProviderKey = (config: ProviderKeyConfig) => {
    const payload = serializeBaseKeyPayload(config)
    if (config.websockets !== undefined) {
        payload.websockets = config.websockets
    }
    const models = serializeModelAliases(config.models)
    if (models && models.length) {
        payload.models = models
    }
    if (config.excludedModels && config.excludedModels.length) {
        payload['excluded-models'] = config.excludedModels
    }
    const cloak = serializeCloakConfig(config.cloak)
    if (cloak) {
        payload.cloak = cloak
    }
    return payload
}

export const buildClaudeConfigPatchPayload = (config: ProviderKeyConfig, original: ProviderKeyConfig) => {
    const payload: Record<string, unknown> = {
        priority: config.priority !== undefined ? Math.trunc(config.priority) : 0,
        prefix: config.prefix?.trim() || '',
        'base-url': config.baseUrl?.trim() || '',
        'proxy-url': config.proxyUrl?.trim() || '',
        headers: config.headers ?? {},
        models: (config.models ?? []).map((model) => {
            const name  = model.name.trim()
            const alias = model.alias?.trim() || name
            return { name, alias }
        }),
        'excluded-models': config.excludedModels ?? [],
    }
    const cloak         = serializeCloakConfig(config.cloak)
    const originalCloak = serializeCloakConfig(original.cloak)
    if (JSON.stringify(cloak) !== JSON.stringify(originalCloak)) {
        payload.cloak = cloak
    }
    const apiKey = config.apiKey.trim()
    if (apiKey && apiKey !== original.apiKey.trim()) {
        payload['api-key'] = apiKey
    }
    return payload
}

export const buildClaudeConfigPatchRequest = (
    index: number,
    config: ProviderKeyConfig,
    original: ProviderKeyConfig,
) => ({
    index,
    ...(original.authIndex?.trim() ? { 'auth-index': original.authIndex.trim() } : {}),
    value: buildClaudeConfigPatchPayload(config, original),
})

const serializeVertexModelAliases = (models?: ModelAlias[]) =>
    Array.isArray(models)
    ? models
        .map((model) => {
            const name  = typeof model?.name === 'string' ? model.name.trim() : ''
            const alias = typeof model?.alias === 'string' ? model.alias.trim() : ''
            if (!name || !alias) {
                return null
            }
            return { name, alias }
        })
        .filter(Boolean)
    : undefined

const serializeVertexKey = (config: ProviderKeyConfig) => {
    const payload = serializeBaseKeyPayload(config)
    const models  = serializeVertexModelAliases(config.models)
    if (models && models.length) {
        payload.models = models
    }
    if (config.excludedModels && config.excludedModels.length) {
        payload['excluded-models'] = config.excludedModels
    }
    return payload
}

const serializeGeminiKey = (config: GeminiKeyConfig) => {
    const payload = serializeBaseKeyPayload(config)
    const models  = serializeModelAliases(config.models)
    if (models && models.length) {
        payload.models = models
    }
    if (config.excludedModels && config.excludedModels.length) {
        payload['excluded-models'] = config.excludedModels
    }
    return payload
}

const serializeOpenAIProvider = (provider: OpenAIProviderConfig) => {
    const payload: Record<string, unknown> = {
        name: provider.name,
        'base-url': provider.baseUrl,
        'api-key-entries': Array.isArray(provider.apiKeyEntries)
                           ? provider.apiKeyEntries.map((entry) => serializeApiKeyEntry(entry))
                           : [],
    }
    if (provider.prefix?.trim()) {
        payload.prefix = provider.prefix.trim()
    }
    const headers = serializeHeaders(provider.headers)
    if (headers) {
        payload.headers = headers
    }
    const models = serializeModelAliases(provider.models)
    if (models && models.length) {
        payload.models = models
    }
    if (provider.priority !== undefined) {
        payload.priority = provider.priority
    }
    if (provider.testModel) {
        payload['test-model'] = provider.testModel
    }
    if (provider.disabled !== undefined) {
        payload.disabled = provider.disabled
    }
    return payload
}

export const providersApi = {
    async getGeminiKeys(): Promise<GeminiKeyConfig[]> {
        const data = await apiClient.get('/gemini-api-key')
        const list = extractArrayPayload(data, 'gemini-api-key')
        return list.map((item) => normalizeGeminiKeyConfig(item)).filter(Boolean) as GeminiKeyConfig[]
    },

    saveGeminiKeys: (configs: GeminiKeyConfig[]) =>
        apiClient.put(
            '/gemini-api-key',
            configs.map((item) => serializeGeminiKey(item)),
        ),

    deleteGeminiKey: (apiKey: string, baseUrl?: string) =>
        apiClient.delete('/gemini-api-key', { data: providerDeleteBody(apiKey, baseUrl) }),

    async getCodexConfigs(): Promise<ProviderKeyConfig[]> {
        const data = await apiClient.get('/codex-api-key')
        const list = extractArrayPayload(data, 'codex-api-key')
        return list.map((item) => normalizeProviderKeyConfig(item)).filter(Boolean) as ProviderKeyConfig[]
    },

    saveCodexConfigs: (configs: ProviderKeyConfig[]) =>
        apiClient.put(
            '/codex-api-key',
            configs.map((item) => serializeProviderKey(item)),
        ),

    deleteCodexConfig: (apiKey: string, baseUrl?: string) =>
        apiClient.delete('/codex-api-key', { data: providerDeleteBody(apiKey, baseUrl) }),

    async getClaudeConfigs(): Promise<ProviderKeyConfig[]> {
        const data = await apiClient.get('/claude-api-key')
        const list = extractArrayPayload(data, 'claude-api-key')
        return list.map((item) => normalizeProviderKeyConfig(item)).filter(Boolean) as ProviderKeyConfig[]
    },

    saveClaudeConfigs: (configs: ProviderKeyConfig[]) =>
        apiClient.put(
            '/claude-api-key',
            configs.map((item) => serializeProviderKey(item)),
        ),

    patchClaudeConfig: (index: number, config: ProviderKeyConfig, original: ProviderKeyConfig) =>
        apiClient.patch('/claude-api-key', buildClaudeConfigPatchRequest(index, config, original)),

    deleteClaudeConfig: (apiKey: string, baseUrl?: string) =>
        apiClient.delete('/claude-api-key', { data: providerDeleteBody(apiKey, baseUrl) }),

    async getVertexConfigs(): Promise<ProviderKeyConfig[]> {
        const data = await apiClient.get('/vertex-api-key')
        const list = extractArrayPayload(data, 'vertex-api-key')
        return list.map((item) => normalizeProviderKeyConfig(item)).filter(Boolean) as ProviderKeyConfig[]
    },

    saveVertexConfigs: (configs: ProviderKeyConfig[]) =>
        apiClient.put(
            '/vertex-api-key',
            configs.map((item) => serializeVertexKey(item)),
        ),

    deleteVertexConfig: (apiKey: string, baseUrl?: string) =>
        apiClient.delete('/vertex-api-key', { data: providerDeleteBody(apiKey, baseUrl) }),

    async getOpenAIProviders(): Promise<OpenAIProviderConfig[]> {
        const data = await apiClient.get('/openai-compatibility')
        const list = extractArrayPayload(data, 'openai-compatibility')
        return list.map((item) => normalizeOpenAIProvider(item)).filter(Boolean) as OpenAIProviderConfig[]
    },

    saveOpenAIProviders: (providers: OpenAIProviderConfig[]) =>
        apiClient.put(
            '/openai-compatibility',
            providers.map((item) => serializeOpenAIProvider(item)),
        ),

    deleteOpenAIProvider: (name: string) => apiClient.delete('/openai-compatibility', { data: { name } }),
}
