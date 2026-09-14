/**
 * 可用模型获取
 */

import {normalizeApiBase} from '@/utils/connection'
import {REQUEST_TIMEOUT_MS} from '@/utils/constants'
import {normalizeModelList} from '@/utils/models'
import axios, {type AxiosRequestConfig} from 'axios'
import {apiCallApi, getApiCallErrorMessage, isCredentialHeaderName, prepareApiCallAuth} from './apiCall'
import {apiClient} from './client'

const DEFAULT_CLAUDE_BASE_URL   = 'https://api.anthropic.com'
const DEFAULT_GEMINI_BASE_URL   = 'https://generativelanguage.googleapis.com'
const DEFAULT_ANTHROPIC_VERSION = '2023-06-01'
const CLAUDE_MODELS_IN_FLIGHT   = new Map<string, Promise<ReturnType<typeof normalizeModelList>>>()
const GEMINI_MODELS_IN_FLIGHT   = new Map<string, Promise<ReturnType<typeof normalizeModelList>>>()

export type ClaudeModelDiscoveryOptions = {
    endpoint: string
    authMode: 'anthropic' | 'bearer'
    addAnthropicVersion: boolean
}

export type ModelCatalogPriceStatus = 'complete' | 'partial' | 'unpriced'

export type ModelCatalogTokenRates = {
    prompt?: number
    completion?: number
    cache?: number
    cache_read?: number
    cache_write?: number
    cache_write_5m?: number
    cache_write_1h?: number
}

export type ModelCatalogUtcRateBand = ModelCatalogTokenRates & {
    weekdays: string[]
    start: string
    end: string
}

export type ModelCatalogPrice = ModelCatalogTokenRates & {
    utc_rate_bands?: ModelCatalogUtcRateBand[]
    status?: ModelCatalogPriceStatus
    auto_apply?: boolean
    currency?: string
    source?: string
    checked_at?: string
    effective_from?: string
    effective_until?: string
    region?: string
    service_tier?: string
    unpriced_reason?: string
    limitations?: string[]
}

export type ModelCatalogFileModel = {
    name: string
    provider: string
    channel: string
    group: string
    display_name?: string
    user_created: boolean
    enabled: boolean
    aliases?: string[]
    price?: ModelCatalogPrice
}

export type ModelCatalogRow = ModelCatalogFileModel & {
    id: string
    runtime_available: boolean
    runtime_only?: boolean
    runtime_providers?: string[]
    runtime_available_providers?: string[]
    runtime_configured_clients?: number
    runtime_available_clients?: number
    runtime_quota_cooldown_clients?: number
    runtime_suspended_clients?: number
    requestable: boolean
    not_requestable_reason?: string
    api_key_blocked_count?: number
    credential_excluded_count?: number
    credential_configured_count?: number
}

export type ModelCatalogLoadSource = 'current' | 'previous' | 'initialized'

export type ModelCatalogMeta = {
    models_config: string
    previous_models_config: string
    load_source: ModelCatalogLoadSource
    recovered_from_previous: boolean
    current_error?: string
    defaults_version: string
    schema_version: number
    removed_default_count: number
}

export type ModelCatalogResponse = {
    models: ModelCatalogRow[]
    meta: ModelCatalogMeta
    recalculation_pending?: boolean
}

export type ModelCatalogPatchRequest = {
    name: string
    provider?: string
    channel?: string
    group?: string
    display_name?: string
    'display-name'?: string
    enabled?: boolean
    aliases?: string[]
    price?: ModelCatalogPrice
    clear_price?: boolean
}

export type ModelCatalogFieldChange = {
    current?: unknown
    default?: unknown
}

export type ModelCatalogDefaultUpdateChange = {
    id: string
    name: string
    type: 'new_default' | 'changed_default' | 'restore_removed_default' | 'default_removed_upstream'
    current?: ModelCatalogFileModel
    default?: ModelCatalogFileModel
    fields?: Record<string, ModelCatalogFieldChange>
}

export type ModelCatalogDefaultUpdatePreview = {
    current_defaults_version: string
    latest_defaults_version: string
    changes: ModelCatalogDefaultUpdateChange[]
}

export type ModelCatalogApplyDecision = {
    name: string
    action: 'use_default' | 'restore' | 'adopt' | 'remove_default' | 'keep_current' | 'skip'
}

export type ModelCatalogApplyResult = {
    status: string
    backup_path?: string
    applied: number
}

export type ModelCatalogApplyDefaultUpdateResponse = {
    result: ModelCatalogApplyResult
    catalog: ModelCatalogResponse
}

/** Fetch models from an endpoint via apiCall proxy and return a deduplicated list. */
async function fetchModelList(
    endpoint: string,
    headers: Record<string, string>,
    proxyUrl?: string,
    authIndex?: string,
    draftToken?: string,
    signal?: AbortSignal,
): Promise<ReturnType<typeof normalizeModelList>> {
    const result = await apiCallApi.request({
                                                method: 'GET',
                                                url: endpoint,
                                                header: Object.keys(headers).length ? headers : undefined,
                                                proxyUrl,
                                                authIndex: authIndex?.trim() || undefined,
                                                draftToken,
                                            }, { signal })

    if (result.statusCode < 200 || result.statusCode >= 300) {
        throw new Error(getApiCallErrorMessage(result))
    }

    const payload = result.body ?? result.bodyText
    return normalizeModelList(payload, { dedupe: true })
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value)

const TOKEN_HEADER_TEMPLATE_PATTERN = /^(?:\$TOKEN\$|(?:Bearer|Basic|ApiKey)\s+\$TOKEN\$)$/i

const canDeduplicateModelRequest = (
    headers: Record<string, string>,
    proxyUrl?: string,
    draftToken?: string,
) => {
    if (draftToken || proxyUrl?.trim()) {
        return false
    }
    return Object.entries(headers).every(
        ([key, value]) => !isCredentialHeaderName(key) || TOKEN_HEADER_TEMPLATE_PATTERN.test(value.trim()),
    )
}

const buildRequestSignature = (
    url: string,
    headers: Record<string, string>,
    authIndex?: string,
) => {
    const headerSignature = Object.entries(headers)
                                  .sort(([a], [b]) => a.toLowerCase().localeCompare(b.toLowerCase()))
                                  .map(([key, value]) => [key, value])
    return JSON.stringify({ url, authIndex: authIndex ?? '', headers: headerSignature })
}

const buildModelsEndpoint = (baseUrl: string): string => {
    const normalized = normalizeApiBase(baseUrl)
    if (!normalized) {
        return ''
    }
    const trimmed = normalized.replace(/\/+$/g, '')
    if (/\/models$/i.test(trimmed)) {
        return trimmed
    }
    return `${trimmed}/models`
}

const buildV1ModelsEndpoint = (baseUrl: string): string => {
    const normalized = normalizeApiBase(baseUrl)
    if (!normalized) {
        return ''
    }
    const trimmed = normalized.replace(/\/+$/g, '')
    if (/\/v1\/models$/i.test(trimmed)) {
        return trimmed
    }
    if (/\/v1$/i.test(trimmed)) {
        return `${trimmed}/models`
    }
    return `${trimmed}/v1/models`
}

const buildClaudeModelsEndpoint = (
    baseUrl: string,
    discovery?: ClaudeModelDiscoveryOptions,
): string => {
    const discoveryEndpoint = normalizeApiBase(discovery?.endpoint)
    if (discoveryEndpoint) {
        return discoveryEndpoint
    }
    const normalized = normalizeApiBase(baseUrl)
    const fallback   = normalized || DEFAULT_CLAUDE_BASE_URL
    let trimmed      = fallback.replace(/\/+$/g, '')
    trimmed          = trimmed.replace(/\/v1\/models$/i, '')
    trimmed          = trimmed.replace(/\/v1(?:\/.*)?$/i, '')
    return `${trimmed}/v1/models`
}

const buildGeminiModelsEndpoint = (baseUrl: string): string => {
    const normalized = normalizeApiBase(baseUrl)
    const fallback   = normalized || DEFAULT_GEMINI_BASE_URL
    let trimmed      = fallback.replace(/\/+$/g, '')
    trimmed          = trimmed.replace(/\/v1beta\/models$/i, '')
    trimmed          = trimmed.replace(/\/v1beta(?:\/.*)?$/i, '')
    return `${trimmed}/v1beta/models`
}

const stripGeminiModelResourceName = (value: string): string => {
    const trimmed = String(value ?? '').trim()
    if (!trimmed) {
        return ''
    }
    return trimmed.replace(/^\/?models\//i, '')
}

const headerKeys = (headers: Record<string, string>, name: string) => {
    const target = name.toLowerCase()
    return Object.keys(headers).filter((key) => key.toLowerCase() === target)
}

const hasHeader = (headers: Record<string, string>, name: string) => headerKeys(headers, name).length > 0

const assertSingleCredentialHeaders = (headers: Record<string, string>) => {
    const credentialNames = ['authorization', 'x-api-key']
    credentialNames.forEach((name) => {
        const keys = headerKeys(headers, name)
        if (keys.length > 1) {
            throw new Error(`Duplicate credential header: ${keys[1]}`)
        }
    })
}

const removeHeader = (headers: Record<string, string>, name: string) => {
    headerKeys(headers, name).forEach((key) => delete headers[key])
}

type NormalizedDiscoveryHeaders = {
    headers: Record<string, string>
    maskedHeaderNames?: string[]
}

const renameMaskedHeader = (
    names: string[] | undefined,
    from: string,
    to: string,
): string[] | undefined => names?.map((name) => name.toLowerCase() === from ? to : name)

const normalizeBearerDiscoveryHeaders = (
    headers: Record<string, string>,
    maskedHeaderNames?: string[],
): NormalizedDiscoveryHeaders => {
    const normalized = { ...headers }
    assertSingleCredentialHeaders(normalized)

    const authorizationKey          = headerKeys(normalized, 'authorization')[0]
    const apiKeyHeader              = headerKeys(normalized, 'x-api-key')[0]
    let normalizedMaskedHeaderNames = maskedHeaderNames
    if (!authorizationKey && apiKeyHeader) {
        normalized.Authorization = normalized[apiKeyHeader]
        delete normalized[apiKeyHeader]
        normalizedMaskedHeaderNames = renameMaskedHeader(maskedHeaderNames, 'x-api-key', 'authorization')
    }
    return { headers: normalized, maskedHeaderNames: normalizedMaskedHeaderNames }
}

const normalizeAnthropicDiscoveryHeaders = (
    headers: Record<string, string>,
    maskedHeaderNames?: string[],
): NormalizedDiscoveryHeaders => {
    const normalized = { ...headers }
    assertSingleCredentialHeaders(normalized)

    const authorizationKey          = headerKeys(normalized, 'authorization')[0]
    const apiKeyHeader              = headerKeys(normalized, 'x-api-key')[0]
    let normalizedMaskedHeaderNames = maskedHeaderNames
    if (!apiKeyHeader && authorizationKey) {
        const authorization     = normalized[authorizationKey].trim()
        normalized['x-api-key'] = authorization.replace(/^Bearer\s+/i, '')
        delete normalized[authorizationKey]
        normalizedMaskedHeaderNames = renameMaskedHeader(maskedHeaderNames, 'authorization', 'x-api-key')
    }
    return { headers: normalized, maskedHeaderNames: normalizedMaskedHeaderNames }
}

const fetchModelsViaApiCallWithEndpoint = async (
    endpoint: string,
    apiKey?: string,
    headers: Record<string, string> = {},
    proxyUrl?: string,
    authIndex?: string,
    signal?: AbortSignal,
) => {
    if (!endpoint) {
        throw new Error('Invalid base url')
    }

    const prepared = prepareApiCallAuth({
                                            headers,
                                            apiKey,
                                            authIndex,
                                            preferredHeader: 'Authorization',
                                            authorizationScheme: 'Bearer',
                                        })

    return fetchModelList(endpoint, prepared.headers, proxyUrl, authIndex, prepared.draftToken, signal)
}

export const modelsApi = {
    async fetchRuntimeModels(config?: AxiosRequestConfig) {
        const response = await apiClient.get<{ models?: unknown[]; data?: unknown[] } | unknown[]>(
            '/runtime-models',
            config,
        )
        return normalizeModelList(response, { dedupe: true })
    },

    async fetchModelCatalog() {
        return apiClient.get<ModelCatalogResponse>('/model-catalog')
    },

    async patchModelCatalogModel(request: ModelCatalogPatchRequest) {
        return apiClient.patch<ModelCatalogResponse>('/model-catalog', request)
    },

    async deleteModelCatalogModel(name: string) {
        return apiClient.delete<ModelCatalogResponse>('/model-catalog', { params: { name } })
    },

    async fetchDefaultUpdatePreview() {
        return apiClient.get<ModelCatalogDefaultUpdatePreview>('/model-catalog/default-update')
    },

    async applyDefaultUpdate(decisions: ModelCatalogApplyDecision[]) {
        return apiClient.post<ModelCatalogApplyDefaultUpdateResponse>(
            '/model-catalog/default-update/apply',
            { decisions },
        )
    },

    /** Fetch available models from the public /v1/models endpoint. */
    async fetchModels(
        baseUrl: string,
        apiKey?: string,
        headers: Record<string, string> = {},
        config?: AxiosRequestConfig,
    ) {
        const endpoint = buildV1ModelsEndpoint(baseUrl)
        if (!endpoint) {
            throw new Error('Invalid base url')
        }

        const resolvedHeaders = { ...headers }
        if (apiKey) {
            resolvedHeaders.Authorization = `Bearer ${apiKey}`
        }

        const response = await axios.get(endpoint, {
            ...config,
            timeout: config?.timeout ?? REQUEST_TIMEOUT_MS,
            headers: {
                ...config?.headers,
                ...resolvedHeaders,
            },
        })
        const payload  = response.data?.data ?? response.data?.models ?? response.data
        return normalizeModelList(payload, { dedupe: true })
    },

    /**
     * Fetch models from /v1/models endpoint via api-call.
     * Useful when the configured baseUrl is the upstream host root (e.g. https://api.example.com).
     */
    async fetchV1ModelsViaApiCall(
        baseUrl: string,
        apiKey?: string,
        headers: Record<string, string> = {},
        proxyUrl?: string,
        authIndex?: string,
        signal?: AbortSignal,
    ) {
        return fetchModelsViaApiCallWithEndpoint(
            buildV1ModelsEndpoint(baseUrl),
            apiKey,
            headers,
            proxyUrl,
            authIndex,
            signal,
        )
    },

    /**
     * Fetch models from /models endpoint via api-call (for OpenAI provider discovery)
     */
    async fetchModelsViaApiCall(
        baseUrl: string,
        apiKey?: string,
        headers: Record<string, string> = {},
        proxyUrl?: string,
        authIndex?: string,
        signal?: AbortSignal,
    ) {
        return fetchModelsViaApiCallWithEndpoint(
            buildModelsEndpoint(baseUrl),
            apiKey,
            headers,
            proxyUrl,
            authIndex,
            signal,
        )
    },

    buildV1ModelsEndpoint(baseUrl: string) {
        return buildV1ModelsEndpoint(baseUrl)
    },

    buildClaudeModelsEndpoint(baseUrl: string, discovery?: ClaudeModelDiscoveryOptions) {
        return buildClaudeModelsEndpoint(baseUrl, discovery)
    },

    buildGeminiModelsEndpoint(baseUrl: string) {
        return buildGeminiModelsEndpoint(baseUrl)
    },

    /**
     * Fetch Claude models from /v1/models via api-call.
     * Anthropic requires `x-api-key` and `anthropic-version` headers.
     */
    async fetchClaudeModelsViaApiCall(
        baseUrl: string,
        apiKey?: string,
        headers: Record<string, string> = {},
        proxyUrl?: string,
        authIndex?: string,
        discovery?: ClaudeModelDiscoveryOptions,
        apiKeyIsMasked?: boolean,
        maskedHeaderNames?: string[],
        signal?: AbortSignal,
    ) {
        const endpoint = buildClaudeModelsEndpoint(baseUrl, discovery)
        if (!endpoint) {
            throw new Error('Invalid base url')
        }

        const usesBearerAuth = discovery?.authMode === 'bearer'
        const normalizedAuth = usesBearerAuth ?
                               normalizeBearerDiscoveryHeaders(headers, maskedHeaderNames) :
                               normalizeAnthropicDiscoveryHeaders(headers, maskedHeaderNames)
        const prepared       = prepareApiCallAuth({
                                                      headers: normalizedAuth.headers,
                                                      apiKey,
                                                      authIndex,
                                                      preferredHeader: usesBearerAuth ? 'Authorization' : 'x-api-key',
                                                      headerNames: usesBearerAuth ? ['x-api-key'] : ['Authorization'],
                                                      authorizationScheme: usesBearerAuth ? 'Bearer' : undefined,
                                                      apiKeyIsMasked,
                                                      maskedHeaderNames: normalizedAuth.maskedHeaderNames,
                                                  })
        if (usesBearerAuth) {
            const credentialHeaders = Object.entries(prepared.headers)
                                            .filter(([name, value]) =>
                                                        isCredentialHeaderName(name) || value.includes('$TOKEN$'),
                                            )
                                            .map(([name]) => name)
            if (prepared.draftToken || credentialHeaders.length > 0) {
                for (const name of credentialHeaders) {
                    removeHeader(prepared.headers, name)
                }
                removeHeader(prepared.headers, 'authorization')
                prepared.headers.Authorization = 'Bearer $TOKEN$'
            }
        }
        if (discovery?.addAnthropicVersion === false) {
            removeHeader(prepared.headers, 'anthropic-version')
        } else if (!hasHeader(prepared.headers, 'anthropic-version')) {
            prepared.headers['anthropic-version'] = DEFAULT_ANTHROPIC_VERSION
        }

        if (signal || !canDeduplicateModelRequest(prepared.headers, proxyUrl, prepared.draftToken)) {
            return fetchModelList(endpoint, prepared.headers, proxyUrl, authIndex, prepared.draftToken, signal)
        }

        const signature = buildRequestSignature(endpoint, prepared.headers, authIndex)
        const existing  = CLAUDE_MODELS_IN_FLIGHT.get(signature)
        if (existing) {
            return existing
        }

        const request = fetchModelList(endpoint, prepared.headers, proxyUrl, authIndex)
        CLAUDE_MODELS_IN_FLIGHT.set(signature, request)
        try {
            return await request
        } finally {
            CLAUDE_MODELS_IN_FLIGHT.delete(signature)
        }
    },

    /**
     * Fetch Gemini model metadata through the configured endpoint.
     * Gemini API accepts API key via query param or `x-goog-api-key` header.
     */
    async fetchGeminiModelsViaApiCall(
        baseUrl: string,
        apiKey?: string,
        headers: Record<string, string> = {},
        proxyUrl?: string,
        authIndex?: string,
        signal?: AbortSignal,
    ) {
        const endpoint = buildGeminiModelsEndpoint(baseUrl)
        if (!endpoint) {
            throw new Error('Invalid base url')
        }

        const prepared = prepareApiCallAuth({
                                                headers,
                                                apiKey,
                                                authIndex,
                                                preferredHeader: 'x-goog-api-key',
                                                headerNames: ['Authorization'],
                                            })

        const fetchPages = async () => {
            const seen                                             = new Set<string>()
            const collected: ReturnType<typeof normalizeModelList> = []
            let pageToken                                          = ''

            for (let page = 0; page < 20; page += 1) {
                const url = new URL(endpoint)
                if (pageToken) {
                    url.searchParams.set('pageToken', pageToken)
                }

                const result = await apiCallApi.request({
                                                            method: 'GET',
                                                            url: url.toString(),
                                                            header: Object.keys(prepared.headers).length ?
                                                                    prepared.headers :
                                                                    undefined,
                                                            proxyUrl,
                                                            authIndex: authIndex?.trim() || undefined,
                                                            draftToken: prepared.draftToken,
                                                        }, { signal })

                if (result.statusCode < 200 || result.statusCode >= 300) {
                    throw new Error(getApiCallErrorMessage(result))
                }

                const payload    = result.body ?? result.bodyText
                const normalized = normalizeModelList(payload, { dedupe: false })
                normalized.forEach((model) => {
                    const name = stripGeminiModelResourceName(model.name)
                    const key  = (name || '').toLowerCase()
                    if (!key || seen.has(key)) {
                        return
                    }
                    seen.add(key)
                    const resolved = { ...model, name }
                    if (resolved.alias && resolved.alias.trim() === name) {
                        resolved.alias = undefined
                    }
                    collected.push(resolved)
                })

                const nextToken =
                          isRecord(payload) && typeof payload.nextPageToken === 'string' ? payload.nextPageToken : ''
                if (!nextToken) {
                    break
                }
                pageToken = nextToken
            }

            return collected
        }

        if (signal || !canDeduplicateModelRequest(prepared.headers, proxyUrl, prepared.draftToken)) {
            return fetchPages()
        }

        const signature = buildRequestSignature(endpoint, prepared.headers, authIndex)
        const existing  = GEMINI_MODELS_IN_FLIGHT.get(signature)
        if (existing) {
            return existing
        }

        const request = fetchPages()
        GEMINI_MODELS_IN_FLIGHT.set(signature, request)
        try {
            return await request
        } finally {
            GEMINI_MODELS_IN_FLIGHT.delete(signature)
        }
    },
}
