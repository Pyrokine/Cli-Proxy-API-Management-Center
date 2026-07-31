/**
 * 可用模型获取
 */

import {normalizeApiBase} from '@/utils/connection'
import {REQUEST_TIMEOUT_MS} from '@/utils/constants'
import {normalizeModelList} from '@/utils/models'
import axios, {type AxiosRequestConfig} from 'axios'
import {apiCallApi, getApiCallErrorMessage} from './apiCall'
import {apiClient} from './client'

const DEFAULT_CLAUDE_BASE_URL   = 'https://api.anthropic.com'
const DEFAULT_GEMINI_BASE_URL   = 'https://generativelanguage.googleapis.com'
const DEFAULT_ANTHROPIC_VERSION = '2023-06-01'
const CLAUDE_MODELS_IN_FLIGHT   = new Map<string, Promise<ReturnType<typeof normalizeModelList>>>()
const GEMINI_MODELS_IN_FLIGHT   = new Map<string, Promise<ReturnType<typeof normalizeModelList>>>()

export type ModelCatalogPrice = {
    prompt: number
    completion: number
    cache: number
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
    runtime_providers?: string[]
    requestable: boolean
    not_requestable_reason?: string
    api_key_blocked_count?: number
    credential_excluded_count?: number
    credential_configured_count?: number
}

export type ModelCatalogResponse = {
    models: ModelCatalogRow[]
    meta?: Record<string, unknown>
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
): Promise<ReturnType<typeof normalizeModelList>> {
    const result = await apiCallApi.request({
                                                method: 'GET',
                                                url: endpoint,
                                                header: Object.keys(headers).length ? headers : undefined,
                                                proxyUrl,
                                                authIndex: authIndex?.trim() || undefined,
                                            })

    if (result.statusCode < 200 || result.statusCode >= 300) {
        throw new Error(getApiCallErrorMessage(result))
    }

    const payload = result.body ?? result.bodyText
    return normalizeModelList(payload, { dedupe: true })
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value)

const buildRequestSignature = (url: string, headers: Record<string, string>, proxyUrl?: string, authIndex?: string) => {
    const headerSignature = Object.entries(headers)
                                  .sort(([a], [b]) => a.toLowerCase().localeCompare(b.toLowerCase()))
                                  .map(([key, value]) => `${key}:${value}`)
                                  .join('|')
    return `${url}||${proxyUrl ?? ''}||${authIndex ?? ''}||${headerSignature}`
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

const buildClaudeModelsEndpoint = (baseUrl: string): string => {
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

const hasHeader = (headers: Record<string, string>, name: string) => {
    const target = name.toLowerCase()
    return Object.keys(headers).some((key) => key.toLowerCase() === target)
}

const resolveBearerTokenFromAuthorization = (headers: Record<string, string>): string => {
    const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === 'authorization')
    if (!entry) {
        return ''
    }
    const value = String(entry[1] ?? '').trim()
    if (!value) {
        return ''
    }
    const match = value.match(/^Bearer\s+(?<token>.+)$/i)
    return match?.groups?.token?.trim() || ''
}

const fetchModelsViaApiCallWithEndpoint = async (
    endpoint: string,
    apiKey?: string,
    headers: Record<string, string> = {},
    proxyUrl?: string,
    authIndex?: string,
) => {
    if (!endpoint) {
        throw new Error('Invalid base url')
    }

    const resolvedHeaders = { ...headers }
    const hasAuthHeader   = Boolean(resolvedHeaders.Authorization || resolvedHeaders.authorization)
    if (apiKey && !hasAuthHeader) {
        resolvedHeaders.Authorization = `Bearer ${apiKey}`
    }

    return fetchModelList(endpoint, resolvedHeaders, proxyUrl, authIndex)
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

    async saveModelCatalog(models: ModelCatalogFileModel[]) {
        return apiClient.put<ModelCatalogResponse>('/model-catalog', { models })
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

    /**
     * Fetch available models from /v1/models endpoint (for system info page)
     */
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
    ) {
        return fetchModelsViaApiCallWithEndpoint(buildV1ModelsEndpoint(baseUrl), apiKey, headers, proxyUrl, authIndex)
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
    ) {
        return fetchModelsViaApiCallWithEndpoint(buildModelsEndpoint(baseUrl), apiKey, headers, proxyUrl, authIndex)
    },

    buildV1ModelsEndpoint(baseUrl: string) {
        return buildV1ModelsEndpoint(baseUrl)
    },

    buildClaudeModelsEndpoint(baseUrl: string) {
        return buildClaudeModelsEndpoint(baseUrl)
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
    ) {
        const endpoint = buildClaudeModelsEndpoint(baseUrl)
        if (!endpoint) {
            throw new Error('Invalid base url')
        }

        const resolvedHeaders = { ...headers }
        let resolvedApiKey    = String(apiKey ?? '').trim()
        if (!resolvedApiKey && !hasHeader(resolvedHeaders, 'x-api-key')) {
            resolvedApiKey = resolveBearerTokenFromAuthorization(resolvedHeaders)
        }

        if (resolvedApiKey && !hasHeader(resolvedHeaders, 'x-api-key')) {
            resolvedHeaders['x-api-key'] = resolvedApiKey
        }
        if (!hasHeader(resolvedHeaders, 'anthropic-version')) {
            resolvedHeaders['anthropic-version'] = DEFAULT_ANTHROPIC_VERSION
        }

        const signature = buildRequestSignature(endpoint, resolvedHeaders, proxyUrl)
        const existing  = CLAUDE_MODELS_IN_FLIGHT.get(signature)
        if (existing) {
            return existing
        }

        const request = fetchModelList(endpoint, resolvedHeaders, proxyUrl)

        CLAUDE_MODELS_IN_FLIGHT.set(signature, request)
        try {
            return await request
        } finally {
            CLAUDE_MODELS_IN_FLIGHT.delete(signature)
        }
    },

    /**
     * Fetch Gemini models from /v1beta/models via api-call.
     * Gemini API accepts API key via query param or `x-goog-api-key` header.
     */
    async fetchGeminiModelsViaApiCall(
        baseUrl: string,
        apiKey?: string,
        headers: Record<string, string> = {},
        proxyUrl?: string,
    ) {
        const endpoint = buildGeminiModelsEndpoint(baseUrl)
        if (!endpoint) {
            throw new Error('Invalid base url')
        }

        const resolvedHeaders = { ...headers }
        const resolvedApiKey  = String(apiKey ?? '').trim()
        if (resolvedApiKey &&
            !hasHeader(resolvedHeaders, 'x-goog-api-key') &&
            !hasHeader(resolvedHeaders, 'authorization')) {
            resolvedHeaders['x-goog-api-key'] = resolvedApiKey
        }

        const signature = buildRequestSignature(endpoint, resolvedHeaders, proxyUrl)
        const existing  = GEMINI_MODELS_IN_FLIGHT.get(signature)
        if (existing) {
            return existing
        }

        const request = (async () => {
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
                                                            header: Object.keys(resolvedHeaders).length ?
                                                                    resolvedHeaders :
                                                                    undefined,
                                                            proxyUrl,
                                                        })

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
        })()

        GEMINI_MODELS_IN_FLIGHT.set(signature, request)
        try {
            return await request
        } finally {
            GEMINI_MODELS_IN_FLIGHT.delete(signature)
        }
    },
}
