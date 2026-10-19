/**
 * AI 提供商相关 API
 */

import i18n from '@/i18n'
import type {
    ApiKeyEntry, CredentialOverrides, GeminiKeyConfig, ModelAlias,
    OpenAIProviderConfig, ProviderKeyConfig, RequestScopedErrorRule,
} from '@/types'
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

const serializeRequestScopedErrors = (rules?: RequestScopedErrorRule[]) => rules?.map((rule) => ({
    ...(rule.status !== undefined ? {status: rule.status} : {}),
    ...(rule.match !== undefined ? {match: rule.match} : {}),
    ...(rule.matchRegex !== undefined ? {'match-regexr': rule.matchRegex} : {}),
    ...(rule.action !== undefined ? {action: rule.action} : {}),
}))

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

const changedProviderFields = (current: Record<string, unknown>, original: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(current).filter(([key, value]) =>
        JSON.stringify(value) !== JSON.stringify(original[key])))

const unchangedProviderIndex = async <T extends {authIndex?: string}>(
    fetch: () => Promise<T[]>, original: T,
): Promise<{index: number; generation: number}> => {
    const generation = apiClient.getAuthGeneration()
    const latest = await fetch()
    const authIndex = original.authIndex?.trim()
    const snapshot = JSON.stringify(original)
    const matches = latest.flatMap((entry, entryIndex) =>
        (authIndex ? entry.authIndex?.trim() === authIndex : JSON.stringify(entry) === snapshot) ? [entryIndex] : [])
    if (generation !== apiClient.getAuthGeneration()) {
        throw new Error(i18n.t('common.connection_changed'))
    }
    if (matches.length !== 1 || JSON.stringify(latest[matches[0]]) !== snapshot) {
        throw new Error(i18n.t('ai_providers.provider_changed'))
    }
    return {index: matches[0]!, generation}
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

const serializeProviderKey = (config: ProviderKeyConfig, provider?: 'claude' | 'codex') => {
    const payload = serializeBaseKeyPayload(config)
    if (config.requestScopedErrors !== undefined) {
        payload['request-scoped-errors'] = serializeRequestScopedErrors(config.requestScopedErrors)
    }
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
    if (provider === 'claude') {
        if (config.fingerprintProfile !== undefined) {
            payload['fingerprint-profile'] = normalizeClaudeFingerprintProfile(config.fingerprintProfile)
        }
        if (config.rebuildMidSystemMessage !== undefined) {
            payload['rebuild-mid-system-message'] = config.rebuildMidSystemMessage
        }
    }
    if (provider === 'codex') {
        if (config.alphaSearch !== undefined) {
            payload['alpha-search'] = config.alphaSearch
        }
        if (config.disableCodexCloaking !== undefined) {
            payload['disable-codex-cloaking'] = config.disableCodexCloaking
        }
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
        'rebuild-mid-system-message': Boolean(item.rebuildMidSystemMessage),
        'request-scoped-errors': serializeRequestScopedErrors(item.requestScopedErrors),
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
                ...(model.displayName ? {'display-name': model.displayName} : {}),
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
    if (config.requestScopedErrors !== undefined) {
        payload['request-scoped-errors'] = serializeRequestScopedErrors(config.requestScopedErrors)
    }
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
        ...(provider.requestScopedErrors !== undefined ?
            {'request-scoped-errors': serializeRequestScopedErrors(provider.requestScopedErrors)} : {}),
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
    if (provider.disabled !== undefined) {
        payload.disabled = provider.disabled
    }
    if (provider.supportPromptCacheKey !== undefined) {
        payload['support-prompt-cache-key'] = provider.supportPromptCacheKey
    }
    return payload
}

const changedApiKeyPayload = (current: string, original: string) => {
    const apiKey = current.trim()
    return apiKey === original.trim() ? {} : { 'api-key': apiKey }
}

const geminiPatchFields = (config: GeminiKeyConfig): Record<string, unknown> => ({
    ...(config.requestScopedErrors !== undefined ?
        {'request-scoped-errors': serializeRequestScopedErrors(config.requestScopedErrors)} : {}),
    priority: config.priority !== undefined ? Math.trunc(config.priority) : 0,
    weight: config.weight ?? null,
    prefix: config.prefix?.trim() || '',
    'base-url': config.baseUrl?.trim() || '',
    'proxy-url': config.proxyUrl?.trim() || '',
    headers: config.headers ?? {},
    models: serializeModelAliases(config.models) ?? [],
    'excluded-models': config.excludedModels ?? [],
})

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
        ...changedProviderFields(geminiPatchFields(config), geminiPatchFields(original)),
    },
})

const providerKeyPatchFields = (config: ProviderKeyConfig, models: unknown[], supportsErrorRules: boolean) => ({
    ...(supportsErrorRules && config.requestScopedErrors !== undefined ?
        {'request-scoped-errors': serializeRequestScopedErrors(config.requestScopedErrors)} : {}),
    priority: config.priority !== undefined ? Math.trunc(config.priority) : 0,
    weight: config.weight ?? null,
    prefix: config.prefix?.trim() || '',
    'base-url': config.baseUrl?.trim() || '',
    ...(config.websockets !== undefined ? {websockets: Boolean(config.websockets)} : {}),
    'proxy-url': config.proxyUrl?.trim() || '',
    headers: config.headers ?? {},
    models,
    'excluded-models': config.excludedModels ?? [],
})

const buildProviderKeyPatchRequest = (
    index: number,
    config: ProviderKeyConfig,
    original: ProviderKeyConfig,
    models: unknown[],
    supportsErrorRules = true,
) => ({
    index,
    ...(original.authIndex?.trim() ? {'auth-index': original.authIndex.trim()} : {}),
    value: {
        ...changedApiKeyPayload(config.apiKey, original.apiKey),
        ...buildCredentialOverridePatch(config, original),
        ...changedProviderFields(
            providerKeyPatchFields(config, models, supportsErrorRules),
            providerKeyPatchFields(original, supportsErrorRules ? serializeModelAliases(original.models) ?? []
                                                   : serializeVertexModelAliases(original.models) ?? [], supportsErrorRules),
        ),
    },
})

export const buildCodexConfigPatchRequest = (
    index: number,
    config: ProviderKeyConfig,
    original: ProviderKeyConfig,
) => {
    const patch = buildProviderKeyPatchRequest(index, config, original, serializeModelAliases(config.models) ?? [])
    return {
        ...patch,
        value: {
            ...patch.value,
            ...(config.alphaSearch !== undefined && config.alphaSearch !== original.alphaSearch ?
                {'alpha-search': config.alphaSearch} : {}),
            ...(config.disableCodexCloaking !== original.disableCodexCloaking ?
                {'disable-codex-cloaking': config.disableCodexCloaking ?? null} : {}),
        },
    }
}

export const buildXAIConfigPatchRequest = (
    index: number,
    config: ProviderKeyConfig,
    original: ProviderKeyConfig,
) => buildProviderKeyPatchRequest(index, config, original, serializeModelAliases(config.models) ?? [])

export const buildVertexConfigPatchRequest = (
    index: number,
    config: ProviderKeyConfig,
    original: ProviderKeyConfig,
) => buildProviderKeyPatchRequest(index, config, original, serializeVertexModelAliases(config.models) ?? [], false)

const openAIProviderPatchFields = (provider: OpenAIProviderConfig) => ({
    ...(provider.requestScopedErrors !== undefined ?
        {'request-scoped-errors': serializeRequestScopedErrors(provider.requestScopedErrors)} : {}),
    name: provider.name.trim(),
    priority: provider.priority !== undefined ? Math.trunc(provider.priority) : 0,
    prefix: provider.prefix?.trim() || '',
    'base-url': provider.baseUrl.trim(),
    disabled: Boolean(provider.disabled),
    ...(provider.supportPromptCacheKey !== undefined ?
        {'support-prompt-cache-key': provider.supportPromptCacheKey} : {}),
    'api-key-entries': provider.apiKeyEntries.map((entry) => serializeApiKeyEntry(entry)),
    models: serializeModelAliases(provider.models) ?? [],
    headers: provider.headers ?? {},
})

export const buildOpenAIProviderPatchRequest = (
    index: number,
    provider: OpenAIProviderConfig,
    original: OpenAIProviderConfig,
) => ({
    index,
    name: original.name,
    value: {
        ...buildCredentialOverridePatch(provider, original),
        ...changedProviderFields(openAIProviderPatchFields(provider), openAIProviderPatchFields(original)),
    },
})

export const providersApi = {
    async getGeminiKeys(): Promise<GeminiKeyConfig[]> {
        const data = await apiClient.get('/gemini-api-key')
        const list = extractArrayPayload(data, 'gemini-api-key')
        return list.map((item) => normalizeGeminiKeyConfig(item)).filter(Boolean) as GeminiKeyConfig[]
    },

    createGeminiKey: (config: GeminiKeyConfig) => apiClient.post('/gemini-api-key', serializeGeminiKey(config)),

    patchGeminiKey: async (_index: number, config: GeminiKeyConfig, original: GeminiKeyConfig) => {
        const {index, generation} = await unchangedProviderIndex(providersApi.getGeminiKeys, original)
        return apiClient.patch('/gemini-api-key', buildGeminiConfigPatchRequest(index, config, original),
            {__authGeneration: generation})
    },

    deleteGeminiKey: (apiKey: string, baseUrl?: string) =>
        apiClient.delete('/gemini-api-key', { data: providerDeleteBody(apiKey, baseUrl) }),

    async getInteractionsKeys(): Promise<GeminiKeyConfig[]> {
        const data = await apiClient.get('/interactions-api-key')
        const list = extractArrayPayload(data, 'interactions-api-key')
        return list.map((item) => normalizeGeminiKeyConfig(item)).filter(Boolean) as GeminiKeyConfig[]
    },

    createInteractionsKey: (config: GeminiKeyConfig) =>
        apiClient.post('/interactions-api-key', serializeGeminiKey(config)),

    patchInteractionsKey: async (_index: number, config: GeminiKeyConfig, original: GeminiKeyConfig) => {
        const {index, generation} = await unchangedProviderIndex(providersApi.getInteractionsKeys, original)
        return apiClient.patch('/interactions-api-key', buildGeminiConfigPatchRequest(index, config, original),
            {__authGeneration: generation})
    },

    deleteInteractionsKey: (apiKey: string, baseUrl?: string) =>
        apiClient.delete('/interactions-api-key', { data: providerDeleteBody(apiKey, baseUrl) }),

    async getCodexConfigs(): Promise<ProviderKeyConfig[]> {
        const data = await apiClient.get('/codex-api-key')
        const list = extractArrayPayload(data, 'codex-api-key')
        return list.map((item) => normalizeProviderKeyConfig(item)).filter(Boolean) as ProviderKeyConfig[]
    },

    createCodexConfig: (config: ProviderKeyConfig) => apiClient.post('/codex-api-key', serializeProviderKey(config, 'codex')),

    patchCodexConfig: async (_index: number, config: ProviderKeyConfig, original: ProviderKeyConfig) => {
        const {index, generation} = await unchangedProviderIndex(providersApi.getCodexConfigs, original)
        return apiClient.patch('/codex-api-key', buildCodexConfigPatchRequest(index, config, original),
            {__authGeneration: generation})
    },

    deleteCodexConfig: (apiKey: string, baseUrl?: string) =>
        apiClient.delete('/codex-api-key', { data: providerDeleteBody(apiKey, baseUrl) }),

    async getMetaConfigs(): Promise<ProviderKeyConfig[]> {
        const data = await apiClient.get('/meta-api-key')
        const list = extractArrayPayload(data, 'meta-api-key')
        return list.map((item) => normalizeProviderKeyConfig(item)).filter(Boolean) as ProviderKeyConfig[]
    },

    createMetaConfig: (config: ProviderKeyConfig) => apiClient.post('/meta-api-key', serializeProviderKey(config)),

    patchMetaConfig: async (_index: number, config: ProviderKeyConfig, original: ProviderKeyConfig) => {
        const {index, generation} = await unchangedProviderIndex(providersApi.getMetaConfigs, original)
        return apiClient.patch('/meta-api-key', buildProviderKeyPatchRequest(
            index, config, original, serializeModelAliases(config.models) ?? [],
        ), {__authGeneration: generation})
    },

    deleteMetaConfig: (apiKey: string, baseUrl?: string) =>
        apiClient.delete('/meta-api-key', { data: providerDeleteBody(apiKey, baseUrl) }),

    async getXAIConfigs(): Promise<ProviderKeyConfig[]> {
        const data = await apiClient.get('/xai-api-key')
        const list = extractArrayPayload(data, 'xai-api-key')
        return list.map((item) => normalizeProviderKeyConfig(item)).filter(Boolean) as ProviderKeyConfig[]
    },

    createXAIConfig: (config: ProviderKeyConfig) => apiClient.post('/xai-api-key', serializeProviderKey(config)),

    patchXAIConfig: async (_index: number, config: ProviderKeyConfig, original: ProviderKeyConfig) => {
        const {index, generation} = await unchangedProviderIndex(providersApi.getXAIConfigs, original)
        return apiClient.patch('/xai-api-key', buildXAIConfigPatchRequest(index, config, original),
            {__authGeneration: generation})
    },

    deleteXAIConfig: (apiKey: string, baseUrl?: string) =>
        apiClient.delete('/xai-api-key', { data: providerDeleteBody(apiKey, baseUrl) }),

    async getClaudeConfigs(): Promise<ProviderKeyConfig[]> {
        const data = await apiClient.get('/claude-api-key')
        const list = extractArrayPayload(data, 'claude-api-key')
        return list.map((item) => normalizeProviderKeyConfig(item)).filter(Boolean) as ProviderKeyConfig[]
    },

    createClaudeConfig: (config: ProviderKeyConfig) =>
        apiClient.post('/claude-api-key', serializeProviderKey(config, 'claude')),

    patchClaudeConfig: async (_index: number, config: ProviderKeyConfig, original: ProviderKeyConfig) => {
        const {index, generation} = await unchangedProviderIndex(providersApi.getClaudeConfigs, original)
        return apiClient.patch('/claude-api-key', buildClaudeConfigPatchRequest(index, config, original),
            {__authGeneration: generation})
    },

    deleteClaudeConfig: (apiKey: string, baseUrl?: string) =>
        apiClient.delete('/claude-api-key', { data: providerDeleteBody(apiKey, baseUrl) }),

    async getVertexConfigs(): Promise<ProviderKeyConfig[]> {
        const data = await apiClient.get('/vertex-api-key')
        const list = extractArrayPayload(data, 'vertex-api-key')
        return list.map((item) => normalizeProviderKeyConfig(item)).filter(Boolean) as ProviderKeyConfig[]
    },

    createVertexConfig: (config: ProviderKeyConfig) => apiClient.post('/vertex-api-key', serializeVertexKey(config)),

    patchVertexConfig: async (_index: number, config: ProviderKeyConfig, original: ProviderKeyConfig) => {
        const {index, generation} = await unchangedProviderIndex(providersApi.getVertexConfigs, original)
        return apiClient.patch('/vertex-api-key', buildVertexConfigPatchRequest(index, config, original),
            {__authGeneration: generation})
    },

    deleteVertexConfig: (apiKey: string, baseUrl?: string) =>
        apiClient.delete('/vertex-api-key', { data: providerDeleteBody(apiKey, baseUrl) }),

    async getOpenAIProviders(): Promise<OpenAIProviderConfig[]> {
        const data = await apiClient.get('/openai-compatibility')
        const list = extractArrayPayload(data, 'openai-compatibility')
        return list.map((item) => normalizeOpenAIProvider(item)).filter(Boolean) as OpenAIProviderConfig[]
    },

    createOpenAIProvider: (provider: OpenAIProviderConfig) =>
        apiClient.post('/openai-compatibility', serializeOpenAIProvider(provider)),

    patchOpenAIProvider: async (_index: number, provider: OpenAIProviderConfig, original: OpenAIProviderConfig) => {
        const {index, generation} = await unchangedProviderIndex(providersApi.getOpenAIProviders, original)
        return apiClient.patch('/openai-compatibility', buildOpenAIProviderPatchRequest(index, provider, original),
            {__authGeneration: generation})
    },

    deleteOpenAIProvider: (name: string) => apiClient.delete('/openai-compatibility', { data: { name } }),
}
