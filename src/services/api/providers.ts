/**
 * AI 提供商相关 API
 */

import type {ApiKeyEntry, CredentialOverrides, GeminiKeyConfig, ModelAlias, OpenAIProviderConfig, ProviderKeyConfig} from '@/types'
import {serializeModelMetadataForManagement, serializeModelThinkingForManagement} from '@/utils/modelMetadata'
import {apiClient} from './client'
import {
    normalizeClaudeFingerprintProfile,
    normalizeGeminiKeyConfig,
    normalizeOpenAIProvider,
    normalizeProviderKeyConfig,
} from './transformers'

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
            const payload: Record<string, unknown> = {
                name: model.name,
                ...serializeModelMetadataForManagement(model),
            }
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
        .filter((model): model is Record<string, unknown> => Boolean(model))
    : undefined

const serializeApiKeyEntry = (entry: ApiKeyEntry) => {
    const payload: Record<string, unknown> = { 'api-key': entry.apiKey }
    if (entry.proxyUrl) {
        payload['proxy-url'] = entry.proxyUrl
    }
    if (entry.weight !== undefined) {
        payload.weight = entry.weight
    }
    const headers = serializeHeaders(entry.headers)
    if (headers) {
        payload.headers = headers
    }
    return payload
}

const serializeCredentialOverrides = (config: CredentialOverrides): Record<string, unknown> => {
    if (config.disableCooling !== undefined && typeof config.disableCooling !== 'boolean') {
        throw new Error('disable-cooling must be a boolean')
    }
    if (config.requestRetry !== undefined && !Number.isSafeInteger(config.requestRetry)) {
        throw new Error('request-retry must be a safe integer')
    }
    return {
        ...(config.disableCooling !== undefined ? {'disable-cooling': config.disableCooling} : {}),
        ...(config.requestRetry !== undefined ? {'request-retry': config.requestRetry} : {}),
    }
}

const buildCredentialOverridePatch = (config: CredentialOverrides, original: CredentialOverrides) => {
    const current = serializeCredentialOverrides(config)
    const previous = serializeCredentialOverrides(original)
    return Object.fromEntries(
        ['disable-cooling', 'request-retry'].flatMap((key) =>
            (current[key] ?? null) === (previous[key] ?? null) ? [] : [[key, current[key] ?? null]],
        ),
    )
}

const serializeBaseKeyPayload = (config: CredentialOverrides & {
    apiKey: string
    priority?: number
    weight?: number
    prefix?: string
    baseUrl?: string
    proxyUrl?: string
    headers?: Record<string, string>
}): Record<string, unknown> => {
    const payload: Record<string, unknown> = { 'api-key': config.apiKey, ...serializeCredentialOverrides(config) }
    if (config.priority !== undefined) {
        payload.priority = config.priority
    }
    if (config.weight !== undefined) {
        payload.weight = config.weight
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

const serializeProviderKey = (config: ProviderKeyConfig, provider?: 'claude') => {
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
    if (provider === 'claude' && config.fingerprintProfile !== undefined) {
        payload['fingerprint-profile'] = normalizeClaudeFingerprintProfile(config.fingerprintProfile)
    }
    return payload
}

export const findProviderConfigIndexByAuthIndex = (
    configs: ProviderKeyConfig[],
    authIndex: string,
): number => {
    const target = authIndex.trim()
    if (!target) {
        return -1
    }
    return configs.findIndex((config) => config.authIndex?.trim() === target)
}

export const buildClaudeConfigPatchPayload = (config: ProviderKeyConfig, original: ProviderKeyConfig) => {
    const [current, previous] = [config, original].map((item): Record<string, unknown> => ({
        priority: item.priority !== undefined ? Math.trunc(item.priority) : 0,
        weight: item.weight ?? null,
        prefix: item.prefix?.trim() || '',
        'base-url': item.baseUrl?.trim() || '',
        'proxy-url': item.proxyUrl?.trim() || '',
        headers: Object.fromEntries(Object.entries(item.headers ?? {}).sort(([a], [b]) => a.localeCompare(b))),
        models: (serializeModelAliases(item.models) ?? []).map((model) => ({
            ...model,
            alias: model.alias ?? model.name,
        })),
        'excluded-models': item.excludedModels ?? [],
        cloak: serializeCloakConfig(item.cloak),
    }))
    const payload: Record<string, unknown> = {
        ...Object.fromEntries(
            Object.entries(current).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(previous[key])),
        ),
        ...buildCredentialOverridePatch(config, original),
    }
    if (config.fingerprintProfile !== undefined) {
        const profile = normalizeClaudeFingerprintProfile(config.fingerprintProfile)
        if (profile !== normalizeClaudeFingerprintProfile(original.fingerprintProfile)) {
            payload['fingerprint-profile'] = profile
        }
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
) => {
    const authIndex = original.authIndex?.trim()
    if (!authIndex) {
        throw new Error('Claude credential identity is unavailable; reload the provider before saving')
    }
    return {
        index,
        'auth-index': authIndex,
        value: buildClaudeConfigPatchPayload(config, original),
    }
}

const serializeVertexModelAliases = (models?: ModelAlias[]) =>
    Array.isArray(models)
    ? models
        .map((model) => {
            const name  = typeof model?.name === 'string' ? model.name.trim() : ''
            const alias = typeof model?.alias === 'string' ? model.alias.trim() : ''
            if (!name || !alias) {
                return null
            }
            return {
                name,
                alias,
                ...serializeModelThinkingForManagement(model.thinking),
            }
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
        ...serializeCredentialOverrides(provider),
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

const changedApiKeyPayload = (current: string, original: string) => {
    const apiKey = current.trim()
    return apiKey === original.trim() ? {} : { 'api-key': apiKey }
}

export const buildGeminiConfigPatchRequest = (
    index: number,
    config: GeminiKeyConfig,
    original: GeminiKeyConfig,
) => ({
    index,
    ...(original.authIndex?.trim() ? { 'auth-index': original.authIndex.trim() } : {}),
    value: {
        ...changedApiKeyPayload(config.apiKey, original.apiKey),
        ...buildCredentialOverridePatch(config, original),
        priority: config.priority !== undefined ? Math.trunc(config.priority) : 0,
        weight: config.weight ?? null,
        prefix: config.prefix?.trim() || '',
        'base-url': config.baseUrl?.trim() || '',
        'proxy-url': config.proxyUrl?.trim() || '',
        headers: config.headers ?? {},
        models: serializeModelAliases(config.models) ?? [],
        'excluded-models': config.excludedModels ?? [],
    },
})

const buildProviderKeyPatchRequest = (
    index: number,
    config: ProviderKeyConfig,
    original: ProviderKeyConfig,
    models: unknown[],
) => ({
    index,
    ...(original.authIndex?.trim() ? { 'auth-index': original.authIndex.trim() } : {}),
    value: {
        ...changedApiKeyPayload(config.apiKey, original.apiKey),
        ...buildCredentialOverridePatch(config, original),
        priority: config.priority !== undefined ? Math.trunc(config.priority) : 0,
        weight: config.weight ?? null,
        prefix: config.prefix?.trim() || '',
        'base-url': config.baseUrl?.trim() || '',
        ...(config.websockets !== undefined ? { websockets: Boolean(config.websockets) } : {}),
        'proxy-url': config.proxyUrl?.trim() || '',
        headers: config.headers ?? {},
        models,
        'excluded-models': config.excludedModels ?? [],
    },
})

export const buildCodexConfigPatchRequest = (
    index: number,
    config: ProviderKeyConfig,
    original: ProviderKeyConfig,
) => buildProviderKeyPatchRequest(index, config, original, serializeModelAliases(config.models) ?? [])

export const buildXAIConfigPatchRequest = (
    index: number,
    config: ProviderKeyConfig,
    original: ProviderKeyConfig,
) => buildProviderKeyPatchRequest(index, config, original, serializeModelAliases(config.models) ?? [])

export const buildVertexConfigPatchRequest = (
    index: number,
    config: ProviderKeyConfig,
    original: ProviderKeyConfig,
) => buildProviderKeyPatchRequest(index, config, original, serializeVertexModelAliases(config.models) ?? [])

export const buildOpenAIProviderPatchRequest = (
    index: number,
    provider: OpenAIProviderConfig,
    original: OpenAIProviderConfig,
) => ({
    index,
    name: original.name,
    value: {
        ...buildCredentialOverridePatch(provider, original),
        name: provider.name.trim(),
        priority: provider.priority !== undefined ? Math.trunc(provider.priority) : 0,
        prefix: provider.prefix?.trim() || '',
        'base-url': provider.baseUrl.trim(),
        disabled: Boolean(provider.disabled),
        'api-key-entries': provider.apiKeyEntries.map((entry) => serializeApiKeyEntry(entry)),
        models: serializeModelAliases(provider.models) ?? [],
        headers: provider.headers ?? {},
    },
})

export const providersApi = {
    async getGeminiKeys(): Promise<GeminiKeyConfig[]> {
        const data = await apiClient.get('/gemini-api-key')
        const list = extractArrayPayload(data, 'gemini-api-key')
        return list.map((item) => normalizeGeminiKeyConfig(item)).filter(Boolean) as GeminiKeyConfig[]
    },

    createGeminiKey: (config: GeminiKeyConfig) => apiClient.post('/gemini-api-key', serializeGeminiKey(config)),

    patchGeminiKey: (index: number, config: GeminiKeyConfig, original: GeminiKeyConfig) =>
        apiClient.patch('/gemini-api-key', buildGeminiConfigPatchRequest(index, config, original)),

    deleteGeminiKey: (apiKey: string, baseUrl?: string) =>
        apiClient.delete('/gemini-api-key', { data: providerDeleteBody(apiKey, baseUrl) }),

    async getInteractionsKeys(): Promise<GeminiKeyConfig[]> {
        const data = await apiClient.get('/interactions-api-key')
        const list = extractArrayPayload(data, 'interactions-api-key')
        return list.map((item) => normalizeGeminiKeyConfig(item)).filter(Boolean) as GeminiKeyConfig[]
    },

    createInteractionsKey: (config: GeminiKeyConfig) =>
        apiClient.post('/interactions-api-key', serializeGeminiKey(config)),

    patchInteractionsKey: (index: number, config: GeminiKeyConfig, original: GeminiKeyConfig) =>
        apiClient.patch('/interactions-api-key', buildGeminiConfigPatchRequest(index, config, original)),

    deleteInteractionsKey: (apiKey: string, baseUrl?: string) =>
        apiClient.delete('/interactions-api-key', { data: providerDeleteBody(apiKey, baseUrl) }),

    async getCodexConfigs(): Promise<ProviderKeyConfig[]> {
        const data = await apiClient.get('/codex-api-key')
        const list = extractArrayPayload(data, 'codex-api-key')
        return list.map((item) => normalizeProviderKeyConfig(item)).filter(Boolean) as ProviderKeyConfig[]
    },

    createCodexConfig: (config: ProviderKeyConfig) => apiClient.post('/codex-api-key', serializeProviderKey(config)),

    patchCodexConfig: (index: number, config: ProviderKeyConfig, original: ProviderKeyConfig) =>
        apiClient.patch('/codex-api-key', buildCodexConfigPatchRequest(index, config, original)),

    deleteCodexConfig: (apiKey: string, baseUrl?: string) =>
        apiClient.delete('/codex-api-key', { data: providerDeleteBody(apiKey, baseUrl) }),

    async getXAIConfigs(): Promise<ProviderKeyConfig[]> {
        const data = await apiClient.get('/xai-api-key')
        const list = extractArrayPayload(data, 'xai-api-key')
        return list.map((item) => normalizeProviderKeyConfig(item)).filter(Boolean) as ProviderKeyConfig[]
    },

    createXAIConfig: (config: ProviderKeyConfig) => apiClient.post('/xai-api-key', serializeProviderKey(config)),

    patchXAIConfig: (index: number, config: ProviderKeyConfig, original: ProviderKeyConfig) =>
        apiClient.patch('/xai-api-key', buildXAIConfigPatchRequest(index, config, original)),

    deleteXAIConfig: (apiKey: string, baseUrl?: string) =>
        apiClient.delete('/xai-api-key', { data: providerDeleteBody(apiKey, baseUrl) }),

    async getClaudeConfigs(): Promise<ProviderKeyConfig[]> {
        const data = await apiClient.get('/claude-api-key')
        const list = extractArrayPayload(data, 'claude-api-key')
        return list.map((item) => normalizeProviderKeyConfig(item)).filter(Boolean) as ProviderKeyConfig[]
    },

    createClaudeConfig: (config: ProviderKeyConfig) =>
        apiClient.post('/claude-api-key', serializeProviderKey(config, 'claude')),

    patchClaudeConfig: (index: number, config: ProviderKeyConfig, original: ProviderKeyConfig) =>
        apiClient.patch('/claude-api-key', buildClaudeConfigPatchRequest(index, config, original)),

    deleteClaudeConfig: (apiKey: string, baseUrl?: string) =>
        apiClient.delete('/claude-api-key', { data: providerDeleteBody(apiKey, baseUrl) }),

    async getVertexConfigs(): Promise<ProviderKeyConfig[]> {
        const data = await apiClient.get('/vertex-api-key')
        const list = extractArrayPayload(data, 'vertex-api-key')
        return list.map((item) => normalizeProviderKeyConfig(item)).filter(Boolean) as ProviderKeyConfig[]
    },

    createVertexConfig: (config: ProviderKeyConfig) => apiClient.post('/vertex-api-key', serializeVertexKey(config)),

    patchVertexConfig: (index: number, config: ProviderKeyConfig, original: ProviderKeyConfig) =>
        apiClient.patch('/vertex-api-key', buildVertexConfigPatchRequest(index, config, original)),

    deleteVertexConfig: (apiKey: string, baseUrl?: string) =>
        apiClient.delete('/vertex-api-key', { data: providerDeleteBody(apiKey, baseUrl) }),

    async getOpenAIProviders(): Promise<OpenAIProviderConfig[]> {
        const data = await apiClient.get('/openai-compatibility')
        const list = extractArrayPayload(data, 'openai-compatibility')
        return list.map((item) => normalizeOpenAIProvider(item)).filter(Boolean) as OpenAIProviderConfig[]
    },

    createOpenAIProvider: (provider: OpenAIProviderConfig) =>
        apiClient.post('/openai-compatibility', serializeOpenAIProvider(provider)),

    patchOpenAIProvider: (index: number, provider: OpenAIProviderConfig, original: OpenAIProviderConfig) =>
        apiClient.patch('/openai-compatibility', buildOpenAIProviderPatchRequest(index, provider, original)),

    deleteOpenAIProvider: (name: string) => apiClient.delete('/openai-compatibility', { data: { name } }),
}
