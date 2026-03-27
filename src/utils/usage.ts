/**
 * 使用统计相关工具
 * 迁移自基线 modules/usage.js 的纯逻辑部分
 */

import type {SummaryTimePoint, UsageSummary as ApiUsageSummary} from '@/services/api/usage'
import type {ScriptableContext} from 'chart.js'
import {formatKeyDisplay} from './format'

export interface KeyStatBucket {
    success: number;
    failure: number;
}

export interface KeyStats {
    bySource: Record<string, KeyStatBucket>;
    byAuthIndex: Record<string, KeyStatBucket>;
}

export interface ModelPrice {
    prompt: number;
    completion: number;
    cache: number;
}

export interface UsageDetail {
    timestamp: string;
    source: string;
    auth_index: number;
    tokens: {
        input_tokens: number;
        output_tokens: number;
        reasoning_tokens: number;
        cached_tokens: number;
        cache_tokens?: number;
        total_tokens: number;
    };
    failed: boolean;
    __modelName?: string;
    __timestampMs?: number;
    __apiKey?: string;
}

export interface UsageDetailWithEndpoint extends UsageDetail {
    __endpoint: string;
    __endpointMethod?: string;
    __endpointPath?: string;
    __timestampMs: number;
}

export interface ApiStats {
    endpoint: string;
    totalRequests: number;
    successCount: number;
    failureCount: number;
    totalTokens: number;
    totalCost: number;
    models: Record<string, { requests: number; successCount: number; failureCount: number; tokens: number }>;
}

const TOKENS_PER_PRICE_UNIT       = 1_000_000
const MODEL_PRICE_STORAGE_KEY     = 'cli-proxy-model-prices-v2'
const MODEL_PRICE_MIGRATED_KEY    = 'cli-proxy-model-prices-migrated'
const USAGE_ENDPOINT_METHOD_REGEX = /^(?<method>GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s+(?<path>\S+)/i

const isRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value)

const getApisRecord = (usageData: unknown): Record<string, unknown> | null => {
    const usageRecord = isRecord(usageData) ? usageData : null
    const apisRaw     = usageRecord ? usageRecord.apis : null
    return isRecord(apisRaw) ? apisRaw : null
}

interface UsageSummary {
    totalRequests: number;
    successCount: number;
    failureCount: number;
    totalTokens: number;
}

const createUsageSummary = (): UsageSummary => ({
    totalRequests: 0,
    successCount: 0,
    failureCount: 0,
    totalTokens: 0,
})

const toUsageSummaryFields = (summary: UsageSummary) => ({
    total_requests: summary.totalRequests,
    success_count: summary.successCount,
    failure_count: summary.failureCount,
    total_tokens: summary.totalTokens,
})

function filterUsageByTimestampRange<T>(usageData: T, windowStartMs: number, windowEndMs: number): T {
    const usageRecord = isRecord(usageData) ? usageData : null
    const apis        = getApisRecord(usageData)
    if (!usageRecord || !apis) {
        return usageData
    }

    const filteredApis: Record<string, unknown> = {}
    const totalSummary                          = createUsageSummary()

    Object.entries(apis).forEach(([apiName, apiEntry]) => {
        if (!isRecord(apiEntry)) {
            return
        }

        const models = isRecord(apiEntry.models) ? apiEntry.models : null
        if (!models) {
            return
        }

        const filteredModels: Record<string, unknown> = {}
        const apiSummary                              = createUsageSummary()
        let hasModelData                              = false

        Object.entries(models).forEach(([modelName, modelEntry]) => {
            if (!isRecord(modelEntry)) {
                return
            }

            const detailsRaw                 = Array.isArray(modelEntry.details) ? modelEntry.details : []
            const modelSummary               = createUsageSummary()
            const filteredDetails: unknown[] = []

            detailsRaw.forEach((detail) => {
                const detailRecord = isRecord(detail) ? detail : null
                if (!detailRecord || typeof detailRecord.timestamp !== 'string') {
                    return
                }
                const timestamp = Date.parse(detailRecord.timestamp)
                if (Number.isNaN(timestamp) || timestamp < windowStartMs || timestamp > windowEndMs) {
                    return
                }

                filteredDetails.push(detail)
                modelSummary.totalRequests += 1
                if (detailRecord.failed === true) {
                    modelSummary.failureCount += 1
                } else {
                    modelSummary.successCount += 1
                }
                modelSummary.totalTokens += extractTotalTokens(detailRecord)
            })

            if (!filteredDetails.length) {
                return
            }

            filteredModels[modelName] = {
                ...modelEntry,
                ...toUsageSummaryFields(modelSummary),
                details: filteredDetails,
            }
            hasModelData              = true

            apiSummary.totalRequests += modelSummary.totalRequests
            apiSummary.successCount += modelSummary.successCount
            apiSummary.failureCount += modelSummary.failureCount
            apiSummary.totalTokens += modelSummary.totalTokens
        })

        if (!hasModelData) {
            return
        }

        filteredApis[apiName] = {
            ...apiEntry,
            ...toUsageSummaryFields(apiSummary),
            models: filteredModels,
        }

        totalSummary.totalRequests += apiSummary.totalRequests
        totalSummary.successCount += apiSummary.successCount
        totalSummary.failureCount += apiSummary.failureCount
        totalSummary.totalTokens += apiSummary.totalTokens
    })

    return {
        ...usageRecord,
        ...toUsageSummaryFields(totalSummary),
        apis: filteredApis,
    } as T
}

/** Filter usage data by explicit from/to date strings (datetime-local format). */
export function filterUsageByDateRange<T>(usageData: T, from: string, to: string): T {
    if (!from && !to) {
        return usageData
    }
    const fromMs = from ? new Date(from).getTime() : 0
    const toMs   = to ? new Date(to).getTime() : Date.now()
    if (Number.isNaN(fromMs) || Number.isNaN(toMs)) {
        return usageData
    }
    return filterUsageByTimestampRange(usageData, fromMs, toMs)
}

export const normalizeAuthIndex = (value: unknown) => {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value.toString()
    }
    if (typeof value === 'string') {
        const trimmed = value.trim()
        return trimmed ? trimmed : null
    }
    return null
}

const USAGE_SOURCE_PREFIX_KEY    = 'k:'
const USAGE_SOURCE_PREFIX_MASKED = 'm:'
const USAGE_SOURCE_PREFIX_TEXT   = 't:'

const KEY_LIKE_TOKEN_REGEX    = new RegExp(
    '(?:' +
    [
        'sk-[A-Za-z0-9-_]{6,}',
        'sk-ant-[A-Za-z0-9-_]{6,}',
        'AIza[0-9A-Za-z-_]{8,}',
        'AI[a-zA-Z0-9_-]{6,}',
        'hf_[A-Za-z0-9]{6,}',
        'pk_[A-Za-z0-9]{6,}',
        'rk_[A-Za-z0-9]{6,}',
    ].join('|') +
    ')',
)
const MASKED_TOKEN_HINT_REGEX = /^\S{1,24}(?:\*{2,}|\.{3}|…)\S{1,24}$/

const keyFingerprintCache = new Map<string, string>()

const fnv1a64Hex = (value: string): string => {
    const cached = keyFingerprintCache.get(value)
    if (cached) {
        return cached
    }

    const FNV_OFFSET_BASIS = 0xcbf29ce484222325n
    const FNV_PRIME        = 0x100000001b3n

    let hash = FNV_OFFSET_BASIS
    for (let i = 0; i < value.length; i++) {
        hash ^= BigInt(value.charCodeAt(i))
        hash = (hash * FNV_PRIME) & 0xffffffffffffffffn
    }

    const hex = hash.toString(16).padStart(16, '0')
    keyFingerprintCache.set(value, hex)
    return hex
}

const looksLikeRawSecret = (text: string): boolean => {
    if (!text || /\s/.test(text)) {
        return false
    }

    const lower = text.toLowerCase()
    if (lower.endsWith('.json')) {
        return false
    }
    // noinspection HttpUrlsUsage
    if (lower.startsWith('http://') || lower.startsWith('https://')) {
        return false
    }
    if (/[\\/]/.test(text)) {
        return false
    }

    if (KEY_LIKE_TOKEN_REGEX.test(text)) {
        return true
    }

    if (text.length >= 32 && text.length <= 512) {
        return true
    }

    if (text.length >= 16 && text.length < 32 && /^[A-Za-z0-9._=-]+$/.test(text)) {
        return /[A-Za-z]/.test(text) && /\d/.test(text)
    }

    return false
}

const extractRawSecretFromText = (text: string): string | null => {
    if (!text) {
        return null
    }
    if (looksLikeRawSecret(text)) {
        return text
    }

    const keyLikeMatch = text.match(KEY_LIKE_TOKEN_REGEX)
    if (keyLikeMatch?.[0]) {
        return keyLikeMatch[0]
    }

    const queryMatch = text.match(/[?&](?<name>api[-_]?key|key|token|access_token|authorization)=(?<value>[^&#\s]+)/i)
    const queryValue = queryMatch?.groups?.value
    if (queryValue && looksLikeRawSecret(queryValue)) {
        return queryValue
    }

    const headerMatch = text.match(
        /(?<name>api[-_]?key|key|token|access[-_]?token|authorization)\s*[:=]\s*(?<value>[A-Za-z0-9._=-]+)/i,
    )
    const headerValue = headerMatch?.groups?.value
    if (headerValue && looksLikeRawSecret(headerValue)) {
        return headerValue
    }

    const bearerMatch = text.match(/\bBearer\s+(?<token>[A-Za-z0-9._=-]{6,})/i)
    const bearerValue = bearerMatch?.groups?.token
    if (bearerValue && looksLikeRawSecret(bearerValue)) {
        return bearerValue
    }

    return null
}

export function normalizeUsageSourceId(value: unknown, masker: (val: string) => string = formatKeyDisplay): string {
    const raw     = typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value)
    const trimmed = raw.trim()
    if (!trimmed) {
        return ''
    }

    const extracted = extractRawSecretFromText(trimmed)
    if (extracted) {
        return `${USAGE_SOURCE_PREFIX_KEY}${fnv1a64Hex(extracted)}`
    }

    if (MASKED_TOKEN_HINT_REGEX.test(trimmed)) {
        return `${USAGE_SOURCE_PREFIX_MASKED}${masker(trimmed)}`
    }

    return `${USAGE_SOURCE_PREFIX_TEXT}${trimmed}`
}

export function buildCandidateUsageSourceIds(input: { apiKey?: string; prefix?: string }): string[] {
    const result: string[] = []

    const prefix = input.prefix?.trim()
    if (prefix) {
        result.push(`${USAGE_SOURCE_PREFIX_TEXT}${prefix}`)
    }

    const apiKey = input.apiKey?.trim()
    if (apiKey) {
        result.push(`${USAGE_SOURCE_PREFIX_KEY}${fnv1a64Hex(apiKey)}`)
        result.push(`${USAGE_SOURCE_PREFIX_MASKED}${formatKeyDisplay(apiKey)}`)
    }

    return Array.from(new Set(result))
}

/**
 * 对使用数据中的敏感字段进行遮罩
 */
function maskUsageSensitiveValue(value: unknown, masker: (val: string) => string = formatKeyDisplay): string {
    if (value === null || value === undefined) {
        return ''
    }
    const raw = typeof value === 'string' ? value : String(value)
    if (!raw) {
        return ''
    }

    let masked = raw

    const queryRegex =
              /(?<prefix>[?&])(?<keyName>api[-_]?key|key|token|access_token|authorization)=(?<value>[^&#\s]+)/gi
    masked           = masked.replace(
        queryRegex,
        (_full, prefix, keyName, valuePart) => `${prefix}${keyName}=${masker(valuePart)}`,
    )

    const headerKeyPattern = 'api[-_]?key|key|token|access[-_]?token|authorization'
    const headerRegex      =
              new RegExp(`(?<keyName>${headerKeyPattern})\\s*(?<sep>[:=])\\s*(?<value>[A-Za-z0-9._-]+)`, 'gi')
    masked                 = masked.replace(
        headerRegex,
        (_full, keyName, separator, valuePart) => `${keyName}${separator}${masker(valuePart)}`,
    )

    const keyLikeRegex = new RegExp(
        '(?:' +
        [
            'sk-[A-Za-z0-9]{6,}',
            'AI[a-zA-Z0-9_-]{6,}',
            'AIza[0-9A-Za-z-_]{8,}',
            'hf_[A-Za-z0-9]{6,}',
            'pk_[A-Za-z0-9]{6,}',
            'rk_[A-Za-z0-9]{6,}',
        ].join('|') +
        ')',
        'g',
    )
    masked             = masked.replace(keyLikeRegex, (match) => masker(match))

    if (masked === raw) {
        const trimmed = raw.trim()
        if (trimmed && !/\s/.test(trimmed)) {
            const looksLikeKey =
                      /^sk-/i.test(trimmed) ||
                      /^AI/i.test(trimmed) ||
                      /^AIza/i.test(trimmed) ||
                      /^hf_/i.test(trimmed) ||
                      /^pk_/i.test(trimmed) ||
                      /^rk_/i.test(trimmed) ||
                      (!/[\\/]/.test(trimmed) && (/\d/.test(trimmed) || trimmed.length >= 10)) ||
                      trimmed.length >= 24
            if (looksLikeKey) {
                return masker(trimmed)
            }
        }
    }

    return masked
}

/**
 * 格式化每分钟数值
 */
export function formatPerMinuteValue(value: number): string {
    const num = Number(value)
    if (!Number.isFinite(num)) {
        return '0.00'
    }
    const abs = Math.abs(num)
    if (abs >= 1000) {
        return Math.round(num).toLocaleString()
    }
    if (abs >= 100) {
        return num.toFixed(0)
    }
    if (abs >= 10) {
        return num.toFixed(1)
    }
    return num.toFixed(2)
}

/**
 * 格式化紧凑数字
 */
export function formatCompactNumber(value: number): string {
    const num = Number(value)
    if (!Number.isFinite(num)) {
        return '0'
    }
    const abs = Math.abs(num)
    if (abs >= 1_000_000) {
        return `${(num / 1_000_000).toFixed(1)}M`
    }
    if (abs >= 1_000) {
        return `${(num / 1_000).toFixed(1)}K`
    }
    return abs >= 1 ? num.toFixed(0) : num.toFixed(2)
}

/**
 * 格式化美元
 */
export function formatUsd(value: number): string {
    const num = Number(value)
    if (!Number.isFinite(num)) {
        return '$0.00'
    }
    const fixed = num.toFixed(2)
    const parts = Number(fixed).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    })
    return `$${parts}`
}

const usageDetailsCache             = new WeakMap<object, UsageDetail[]>()
const usageDetailsWithEndpointCache = new WeakMap<object, UsageDetailWithEndpoint[]>()

/**
 * 从使用数据中收集所有请求明细
 */
export function collectUsageDetails(usageData: unknown): UsageDetail[] {
    const cacheKey = isRecord(usageData) ? (usageData as object) : null
    if (cacheKey) {
        const cached = usageDetailsCache.get(cacheKey)
        if (cached) {
            return cached
        }
    }

    const apis = getApisRecord(usageData)
    if (!apis) {
        return []
    }
    const details: UsageDetail[] = []
    // noinspection DuplicatedCode
    const sourceCache            = new Map<string, string>()

    const normalizeSource = (value: unknown): string => {
        const raw     = typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value)
        const trimmed = raw.trim()
        if (!trimmed) {
            return ''
        }
        const cached = sourceCache.get(trimmed)
        if (cached !== undefined) {
            return cached
        }
        const normalized = normalizeUsageSourceId(trimmed)
        sourceCache.set(trimmed, normalized)
        return normalized
    }

    Object.entries(apis).forEach(([apiKey, apiEntry]) => {
        if (!isRecord(apiEntry)) {
            return
        }
        const modelsRaw = apiEntry.models
        const models    = isRecord(modelsRaw) ? modelsRaw : null
        if (!models) {
            return
        }

        Object.entries(models).forEach(([modelName, modelEntry]) => {
            if (!isRecord(modelEntry)) {
                return
            }
            const modelDetailsRaw = modelEntry.details
            const modelDetails    = Array.isArray(modelDetailsRaw) ? modelDetailsRaw : []

            modelDetails.forEach((detailRaw) => {
                if (!isRecord(detailRaw) || typeof detailRaw.timestamp !== 'string') {
                    return
                }
                const timestamp   = detailRaw.timestamp
                const timestampMs = Date.parse(timestamp)
                const tokensRaw   = isRecord(detailRaw.tokens) ? detailRaw.tokens : {}
                details.push({
                                 timestamp,
                                 source: normalizeSource(detailRaw.source),
                                 auth_index: detailRaw.auth_index as unknown as number,
                                 tokens: tokensRaw as unknown as UsageDetail['tokens'],
                                 failed: detailRaw.failed === true,
                                 __modelName: modelName,
                                 __timestampMs: Number.isNaN(timestampMs) ? 0 : timestampMs,
                                 __apiKey: apiKey,
                             })
            })
        })
    })

    if (cacheKey) {
        usageDetailsCache.set(cacheKey, details)
    }
    return details
}

/**
 * 从使用数据中收集包含 endpoint/method/path 的请求明细
 */
export function collectUsageDetailsWithEndpoint(usageData: unknown): UsageDetailWithEndpoint[] {
    const cacheKey = isRecord(usageData) ? (usageData as object) : null
    if (cacheKey) {
        const cached = usageDetailsWithEndpointCache.get(cacheKey)
        if (cached) {
            return cached
        }
    }

    const apis = getApisRecord(usageData)
    if (!apis) {
        return []
    }

    const details: UsageDetailWithEndpoint[] = []
    // noinspection DuplicatedCode
    const sourceCache                        = new Map<string, string>()

    const normalizeSource = (value: unknown): string => {
        const raw     = typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value)
        const trimmed = raw.trim()
        if (!trimmed) {
            return ''
        }
        const cached = sourceCache.get(trimmed)
        if (cached !== undefined) {
            return cached
        }
        const normalized = normalizeUsageSourceId(trimmed)
        sourceCache.set(trimmed, normalized)
        return normalized
    }

    Object.entries(apis).forEach(([endpoint, apiEntry]) => {
        if (!isRecord(apiEntry)) {
            return
        }
        const modelsRaw = apiEntry.models
        const models    = isRecord(modelsRaw) ? modelsRaw : null
        if (!models) {
            return
        }

        const endpointMatch  = endpoint.match(USAGE_ENDPOINT_METHOD_REGEX)
        const endpointMethod = endpointMatch?.groups?.method?.toUpperCase()
        const endpointPath   = endpointMatch?.groups?.path

        Object.entries(models).forEach(([modelName, modelEntry]) => {
            if (!isRecord(modelEntry)) {
                return
            }
            const modelDetailsRaw = modelEntry.details
            const modelDetails    = Array.isArray(modelDetailsRaw) ? modelDetailsRaw : []

            modelDetails.forEach((detailRaw) => {
                if (!isRecord(detailRaw) || typeof detailRaw.timestamp !== 'string') {
                    return
                }
                const timestamp   = detailRaw.timestamp
                const timestampMs = Date.parse(timestamp)
                const tokensRaw   = isRecord(detailRaw.tokens) ? detailRaw.tokens : {}
                details.push({
                                 timestamp,
                                 source: normalizeSource(detailRaw.source),
                                 auth_index: detailRaw.auth_index as unknown as number,
                                 tokens: tokensRaw as unknown as UsageDetail['tokens'],
                                 failed: detailRaw.failed === true,
                                 __modelName: modelName,
                                 __endpoint: endpoint,
                                 __endpointMethod: endpointMethod,
                                 __endpointPath: endpointPath,
                                 __timestampMs: Number.isNaN(timestampMs) ? 0 : timestampMs,
                             })
            })
        })
    })

    if (cacheKey) {
        usageDetailsWithEndpointCache.set(cacheKey, details)
    }
    return details
}

/**
 * 从单条明细提取总 tokens
 */
export function extractTotalTokens(detail: unknown): number {
    const record    = isRecord(detail) ? detail : null
    const tokensRaw = record?.tokens
    const tokens    = isRecord(tokensRaw) ? tokensRaw : {}
    if (typeof tokens.total_tokens === 'number') {
        return tokens.total_tokens
    }
    const inputTokens     = typeof tokens.input_tokens === 'number' ? tokens.input_tokens : 0
    const outputTokens    = typeof tokens.output_tokens === 'number' ? tokens.output_tokens : 0
    const reasoningTokens = typeof tokens.reasoning_tokens === 'number' ? tokens.reasoning_tokens : 0
    const cachedTokens    = Math.max(
        typeof tokens.cached_tokens === 'number' ? Math.max(tokens.cached_tokens, 0) : 0,
        typeof tokens.cache_tokens === 'number' ? Math.max(tokens.cache_tokens, 0) : 0,
    )

    return inputTokens + outputTokens + reasoningTokens + cachedTokens
}

/**
 * 从使用数据获取模型名称列表
 */
export function getModelNamesFromUsage(usageData: unknown): string[] {
    const apis = getApisRecord(usageData)
    if (!apis) {
        return []
    }
    const names = new Set<string>()
    Object.values(apis).forEach((apiEntry) => {
        if (!isRecord(apiEntry)) {
            return
        }
        const modelsRaw = apiEntry.models
        const models    = isRecord(modelsRaw) ? modelsRaw : null
        if (!models) {
            return
        }
        Object.keys(models).forEach((modelName) => {
            if (modelName) {
                names.add(modelName)
            }
        })
    })
    return Array.from(names).sort((a, b) => a.localeCompare(b))
}

/**
 * 计算成本数据
 */
function calculateCost(detail: UsageDetail, modelPrices: Record<string, ModelPrice>): number {
    const modelName = detail.__modelName || ''
    const price     = modelPrices[modelName]
    if (!price) {
        return 0
    }
    const tokens                   = detail.tokens
    const rawInputTokens           = Number(tokens.input_tokens)
    const rawCompletionTokens      = Number(tokens.output_tokens)
    const rawCachedTokensPrimary   = Number(tokens.cached_tokens)
    const rawCachedTokensAlternate = Number(tokens.cache_tokens)

    const inputTokens      = Number.isFinite(rawInputTokens) ? Math.max(rawInputTokens, 0) : 0
    const completionTokens = Number.isFinite(rawCompletionTokens) ? Math.max(rawCompletionTokens, 0) : 0
    const cachedTokens     = Math.max(
        Number.isFinite(rawCachedTokensPrimary) ? Math.max(rawCachedTokensPrimary, 0) : 0,
        Number.isFinite(rawCachedTokensAlternate) ? Math.max(rawCachedTokensAlternate, 0) : 0,
    )
    const promptTokens     = Math.max(inputTokens - cachedTokens, 0)

    const promptCost     = (promptTokens / TOKENS_PER_PRICE_UNIT) * (Number(price.prompt) || 0)
    const cachedCost     = (cachedTokens / TOKENS_PER_PRICE_UNIT) * (Number(price.cache) || 0)
    const completionCost = (completionTokens / TOKENS_PER_PRICE_UNIT) * (Number(price.completion) || 0)
    const total          = promptCost + cachedCost + completionCost
    return Number.isFinite(total) && total > 0 ? total : 0
}

/**
 * 从 localStorage 加载模型价格
 */
export async function loadModelPrices(): Promise<Record<string, ModelPrice>> {
    try {
        const { modelPricesApi } = await import('@/services/api/modelPrices')
        const serverPrices       = await modelPricesApi.get()

        // Migrate localStorage data to server on first load
        if (
            Object.keys(serverPrices).length === 0 &&
            typeof localStorage !== 'undefined' &&
            !localStorage.getItem(MODEL_PRICE_MIGRATED_KEY)
        ) {
            const localPrices = loadModelPricesFromLocalStorage()
            if (Object.keys(localPrices).length > 0) {
                try {
                    await modelPricesApi.put(localPrices)
                } catch {
                    // Migration failed, will retry next time
                }
                localStorage.setItem(MODEL_PRICE_MIGRATED_KEY, 'true')
                return localPrices
            }
            localStorage.setItem(MODEL_PRICE_MIGRATED_KEY, 'true')
        }

        return serverPrices
    } catch {
        // Fallback to localStorage when server is unreachable
        return loadModelPricesFromLocalStorage()
    }
}

/**
 * 保存模型价格到服务端
 */
export async function saveModelPrices(prices: Record<string, ModelPrice>): Promise<void> {
    try {
        const { modelPricesApi } = await import('@/services/api/modelPrices')
        await modelPricesApi.put(prices)
    } catch {
        // Fallback to localStorage when server is unreachable
        saveModelPricesToLocalStorage(prices)
    }
}

/**
 * 从 localStorage 加载模型价格（fallback）
 */
function loadModelPricesFromLocalStorage(): Record<string, ModelPrice> {
    try {
        if (typeof localStorage === 'undefined') {
            return {}
        }
        const raw = localStorage.getItem(MODEL_PRICE_STORAGE_KEY)
        if (!raw) {
            return {}
        }
        const parsed: unknown = JSON.parse(raw)
        if (!isRecord(parsed)) {
            return {}
        }
        const normalized: Record<string, ModelPrice> = {}
        Object.entries(parsed).forEach(([model, price]: [string, unknown]) => {
            if (!model) {
                return
            }
            const priceRecord   = isRecord(price) ? price : null
            const promptRaw     = Number(priceRecord?.prompt)
            const completionRaw = Number(priceRecord?.completion)
            const cacheRaw      = Number(priceRecord?.cache)

            if (!Number.isFinite(promptRaw) && !Number.isFinite(completionRaw) && !Number.isFinite(cacheRaw)) {
                return
            }

            const prompt     = Number.isFinite(promptRaw) && promptRaw >= 0 ? promptRaw : 0
            const completion = Number.isFinite(completionRaw) && completionRaw >= 0 ? completionRaw : 0
            const cache      =
                      Number.isFinite(cacheRaw) && cacheRaw >= 0
                      ? cacheRaw
                      : Number.isFinite(promptRaw) && promptRaw >= 0
                        ? promptRaw
                        : prompt

            normalized[model] = {
                prompt,
                completion,
                cache,
            }
        })
        return normalized
    } catch {
        return {}
    }
}

/**
 * 保存模型价格到 localStorage（fallback）
 */
function saveModelPricesToLocalStorage(prices: Record<string, ModelPrice>): void {
    try {
        if (typeof localStorage === 'undefined') {
            return
        }
        localStorage.setItem(MODEL_PRICE_STORAGE_KEY, JSON.stringify(prices))
    } catch {
        console.warn('保存模型价格失败')
    }
}

/**
 * 获取 API 统计数据
 */
export function getApiStats(usageData: unknown, modelPrices: Record<string, ModelPrice>): ApiStats[] {
    const apis = getApisRecord(usageData)
    if (!apis) {
        return []
    }
    const result: ApiStats[] = []

    Object.entries(apis).forEach(([endpoint, apiData]) => {
        if (!isRecord(apiData)) {
            return
        }
        const models: Record<string, {
            requests: number;
            successCount: number;
            failureCount: number;
            tokens: number
        }>                      = {}
        let derivedSuccessCount = 0
        let derivedFailureCount = 0
        let totalCost           = 0

        const modelsData = isRecord(apiData.models) ? apiData.models : {}
        Object.entries(modelsData).forEach(([modelName, modelData]) => {
            if (!isRecord(modelData)) {
                return
            }
            const details           = Array.isArray(modelData.details) ? modelData.details : []
            const hasExplicitCounts =
                      typeof modelData.success_count === 'number' || typeof modelData.failure_count === 'number'

            let successCount = 0
            let failureCount = 0
            if (hasExplicitCounts) {
                successCount += Number(modelData.success_count) || 0
                failureCount += Number(modelData.failure_count) || 0
            }

            const price = modelPrices[modelName]
            if (details.length > 0 && (!hasExplicitCounts || price)) {
                details.forEach((detail) => {
                    const detailRecord = isRecord(detail) ? detail : null
                    if (!hasExplicitCounts) {
                        if (detailRecord?.failed === true) {
                            failureCount += 1
                        } else {
                            successCount += 1
                        }
                    }

                    if (price && detailRecord) {
                        totalCost += calculateCost(
                            { ...(detailRecord as unknown as UsageDetail), __modelName: modelName },
                            modelPrices,
                        )
                    }
                })
            }

            models[modelName] = {
                requests: Number(modelData.total_requests) || 0,
                successCount,
                failureCount,
                tokens: Number(modelData.total_tokens) || 0,
            }
            derivedSuccessCount += successCount
            derivedFailureCount += failureCount
        })

        const hasApiExplicitCounts = typeof apiData.success_count ===
                                     'number' ||
                                     typeof apiData.failure_count ===
                                     'number'
        const successCount         = hasApiExplicitCounts ? Number(apiData.success_count) || 0 : derivedSuccessCount
        const failureCount         = hasApiExplicitCounts ? Number(apiData.failure_count) || 0 : derivedFailureCount

        result.push({
                        endpoint: maskUsageSensitiveValue(endpoint) || endpoint,
                        totalRequests: Number(apiData.total_requests) || 0,
                        successCount,
                        failureCount,
                        totalTokens: Number(apiData.total_tokens) || 0,
                        totalCost,
                        models,
                    })
    })

    return result
}

/**
 * 格式化小时标签
 */
function formatHourLabel(date: Date): string {
    const month = (date.getMonth() + 1).toString().padStart(2, '0')
    const day   = date.getDate().toString().padStart(2, '0')
    const hour  = date.getHours().toString().padStart(2, '0')
    return `${month}-${day} ${hour}:00`
}

/**
 * 格式化日期标签
 */
function formatDayLabel(date: Date): string {
    const year  = date.getFullYear()
    const month = (date.getMonth() + 1).toString().padStart(2, '0')
    const day   = date.getDate().toString().padStart(2, '0')
    return `${year}-${month}-${day}`
}

/**
 * 将时间戳归一化到所在小时桶，返回桶索引；超出范围返回 -1
 */
function resolveHourBucketIndex(timestamp: number, earliestTime: number, hourMs: number, bucketCount: number): number {
    const normalized = new Date(timestamp)
    normalized.setMinutes(0, 0, 0)
    const bucketStart    = normalized.getTime()
    const lastBucketTime = earliestTime + (bucketCount - 1) * hourMs
    if (bucketStart < earliestTime || bucketStart > lastBucketTime) {
        return -1
    }
    const index = Math.floor((bucketStart - earliestTime) / hourMs)
    return index >= 0 && index < bucketCount ? index : -1
}

/**
 * 构建小时级别的数据序列
 */
function buildHourlySeriesByModel(
    usageData: unknown,
    metric: 'requests' | 'tokens' = 'requests',
    hourWindow: number            = 24,
): {
    labels: string[];
    dataByModel: Map<string, number[]>;
    hasData: boolean;
} {
    // noinspection DuplicatedCode
    const hourMs             = 60 * 60 * 1000
    const resolvedHourWindow =
              Number.isFinite(hourWindow) && hourWindow > 0 ?
              Math.min(Math.max(Math.floor(hourWindow), 1), 24 * 31) :
              24
    const now                = new Date()
    const currentHour        = new Date(now)
    currentHour.setMinutes(0, 0, 0)

    const earliestBucket = new Date(currentHour)
    earliestBucket.setHours(earliestBucket.getHours() - (resolvedHourWindow - 1))
    const earliestTime = earliestBucket.getTime()

    const labels: string[] = []
    for (let i = 0; i < resolvedHourWindow; i++) {
        const bucketStart = earliestTime + i * hourMs
        labels.push(formatHourLabel(new Date(bucketStart)))
    }

    const details     = collectUsageDetails(usageData)
    const dataByModel = new Map<string, number[]>()
    let hasData       = false

    if (!details.length) {
        return { labels, dataByModel, hasData }
    }

    details.forEach((detail) => {
        // noinspection DuplicatedCode
        const timestamp = typeof detail.__timestampMs === 'number' ?
                          detail.__timestampMs :
                          Date.parse(detail.timestamp)
        if (!Number.isFinite(timestamp) || timestamp <= 0) {
            return
        }

        const bucketIndex = resolveHourBucketIndex(timestamp, earliestTime, hourMs, labels.length)
        if (bucketIndex < 0) {
            return
        }

        const modelName = detail.__modelName || 'Unknown'
        if (!dataByModel.has(modelName)) {
            dataByModel.set(modelName, new Array(labels.length).fill(0))
        }

        const bucketValues = dataByModel.get(modelName)!
        if (metric === 'tokens') {
            bucketValues[bucketIndex] += extractTotalTokens(detail)
        } else {
            bucketValues[bucketIndex] += 1
        }
        hasData = true
    })

    return { labels, dataByModel, hasData }
}

/**
 * 构建日级别的数据序列
 */
function buildDailySeriesByModel(
    usageData: unknown,
    metric: 'requests' | 'tokens' = 'requests',
): {
    labels: string[];
    dataByModel: Map<string, number[]>;
    hasData: boolean;
} {
    const details       = collectUsageDetails(usageData)
    const valuesByModel = new Map<string, Map<string, number>>()
    const labelsSet     = new Set<string>()
    let hasData         = false

    if (!details.length) {
        return { labels: [], dataByModel: new Map(), hasData }
    }

    details.forEach((detail) => {
        const timestamp = typeof detail.__timestampMs === 'number' ?
                          detail.__timestampMs :
                          Date.parse(detail.timestamp)
        if (!Number.isFinite(timestamp) || timestamp <= 0) {
            return
        }
        const dayLabel = formatDayLabel(new Date(timestamp))
        if (!dayLabel) {
            return
        }

        const modelName = detail.__modelName || 'Unknown'
        if (!valuesByModel.has(modelName)) {
            valuesByModel.set(modelName, new Map())
        }
        const modelDayMap = valuesByModel.get(modelName)!
        const increment   = metric === 'tokens' ? extractTotalTokens(detail) : 1
        modelDayMap.set(dayLabel, (modelDayMap.get(dayLabel) || 0) + increment)
        labelsSet.add(dayLabel)
        hasData = true
    })

    const labels      = Array.from(labelsSet).sort()
    const dataByModel = new Map<string, number[]>()
    valuesByModel.forEach((dayMap, modelName) => {
        const series = labels.map((label) => dayMap.get(label) || 0)
        dataByModel.set(modelName, series)
    })

    return { labels, dataByModel, hasData }
}

export type ChartDimension = 'total' | 'model' | 'credential';

/**
 * 按凭证构建小时级别的数据序列
 */
function buildHourlySeriesByCredential(
    usageData: unknown,
    metric: 'requests' | 'tokens' = 'requests',
    hourWindow: number            = 24,
): {
    labels: string[];
    dataByGroup: Map<string, number[]>;
    hasData: boolean;
} {
    // noinspection DuplicatedCode
    const hourMs             = 60 * 60 * 1000
    const resolvedHourWindow =
              Number.isFinite(hourWindow) && hourWindow > 0 ?
              Math.min(Math.max(Math.floor(hourWindow), 1), 24 * 31) :
              24
    const now                = new Date()
    const currentHour        = new Date(now)
    currentHour.setMinutes(0, 0, 0)
    const earliestBucket = new Date(currentHour)
    earliestBucket.setHours(earliestBucket.getHours() - (resolvedHourWindow - 1))
    const earliestTime = earliestBucket.getTime()

    const labels: string[] = []
    for (let i = 0; i < resolvedHourWindow; i++) {
        labels.push(formatHourLabel(new Date(earliestTime + i * hourMs)))
    }

    const details     = collectUsageDetailsWithEndpoint(usageData)
    const dataByGroup = new Map<string, number[]>()
    let hasData       = false

    details.forEach((detail) => {
        const timestamp = detail.__timestampMs
        if (!Number.isFinite(timestamp) || timestamp <= 0) {
            return
        }

        const bucketIndex = resolveHourBucketIndex(timestamp, earliestTime, hourMs, labels.length)
        if (bucketIndex < 0) {
            return
        }

        const key = detail.__endpoint || 'Unknown'
        if (!dataByGroup.has(key)) {
            dataByGroup.set(key, new Array(labels.length).fill(0))
        }
        const bucketValues = dataByGroup.get(key)!
        bucketValues[bucketIndex] += metric === 'tokens' ? extractTotalTokens(detail) : 1
        hasData            = true
    })

    return { labels, dataByGroup, hasData }
}

/**
 * 按凭证构建日级别的数据序列
 */
function buildDailySeriesByCredential(
    usageData: unknown,
    metric: 'requests' | 'tokens' = 'requests',
): {
    labels: string[];
    dataByGroup: Map<string, number[]>;
    hasData: boolean;
} {
    const details       = collectUsageDetailsWithEndpoint(usageData)
    const valuesByGroup = new Map<string, Map<string, number>>()
    const labelsSet     = new Set<string>()
    let hasData         = false

    details.forEach((detail) => {
        const timestamp = detail.__timestampMs
        if (!Number.isFinite(timestamp) || timestamp <= 0) {
            return
        }
        const dayLabel = formatDayLabel(new Date(timestamp))
        if (!dayLabel) {
            return
        }

        const key = detail.__endpoint || 'Unknown'
        if (!valuesByGroup.has(key)) {
            valuesByGroup.set(key, new Map())
        }
        const dayMap    = valuesByGroup.get(key)!
        const increment = metric === 'tokens' ? extractTotalTokens(detail) : 1
        dayMap.set(dayLabel, (dayMap.get(dayLabel) || 0) + increment)
        labelsSet.add(dayLabel)
        hasData = true
    })

    const labels      = Array.from(labelsSet).sort()
    const dataByGroup = new Map<string, number[]>()
    valuesByGroup.forEach((dayMap, groupName) => {
        dataByGroup.set(
            groupName,
            labels.map((label) => dayMap.get(label) || 0),
        )
    })

    return { labels, dataByGroup, hasData }
}

export interface ChartDataset {
    label: string;
    data: Array<number | null>;
    borderColor: string;
    backgroundColor: string | CanvasGradient | ((context: ScriptableContext<'line'>) => string | CanvasGradient);
    pointBackgroundColor?: string;
    pointBorderColor?: string;
    fill: boolean;
    tension: number;
}

export interface ChartData {
    labels: string[];
    datasets: ChartDataset[];
}

const CHART_COLORS = [
    { borderColor: '#8b8680', backgroundColor: 'rgba(139, 134, 128, 0.15)' },
    { borderColor: '#10b981', backgroundColor: 'rgba(16, 185, 129, 0.15)' },
    { borderColor: '#f59e0b', backgroundColor: 'rgba(245, 158, 11, 0.15)' },
    { borderColor: '#c65746', backgroundColor: 'rgba(198, 87, 70, 0.15)' },
    { borderColor: '#8b5cf6', backgroundColor: 'rgba(139, 92, 246, 0.15)' },
    { borderColor: '#06b6d4', backgroundColor: 'rgba(6, 182, 212, 0.15)' },
    { borderColor: '#ec4899', backgroundColor: 'rgba(236, 72, 153, 0.15)' },
    { borderColor: '#84cc16', backgroundColor: 'rgba(132, 204, 22, 0.15)' },
    { borderColor: '#f97316', backgroundColor: 'rgba(249, 115, 22, 0.15)' },
]

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

const hexToRgb = (hex: string): { r: number; g: number; b: number } | null => {
    const normalized = hex.trim().replace('#', '')
    if (normalized.length !== 6) {
        return null
    }
    const r = Number.parseInt(normalized.slice(0, 2), 16)
    const g = Number.parseInt(normalized.slice(2, 4), 16)
    const b = Number.parseInt(normalized.slice(4, 6), 16)
    if (![r, g, b].every((channel) => Number.isFinite(channel))) {
        return null
    }
    return { r, g, b }
}

const withAlpha = (hex: string, alpha: number) => {
    const rgb = hexToRgb(hex)
    if (!rgb) {
        return hex
    }
    const clamped = clamp(alpha, 0, 1)
    return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${clamped})`
}

const buildAreaGradient = (context: ScriptableContext<'line'>, baseHex: string, fallback: string) => {
    const chart = context.chart
    const ctx   = chart.ctx
    const area  = chart.chartArea

    if (!area) {
        return fallback
    }

    const gradient = ctx.createLinearGradient(0, area.top, 0, area.bottom)
    gradient.addColorStop(0, withAlpha(baseHex, 0.28))
    gradient.addColorStop(0.6, withAlpha(baseHex, 0.12))
    gradient.addColorStop(1, withAlpha(baseHex, 0.02))
    return gradient
}

/**
 * 从后端 summary API 的 time_series / time_series_by_model 构建图表数据。
 * 跳过前端全量 details 遍历，直接使用预聚合结果。
 * 仅支持 total 和 model 维度；credential 维度需回退到 buildChartData。
 */
export function buildChartDataFromSummary(
    summary: ApiUsageSummary,
    metric: 'requests' | 'tokens' | 'cost',
    dimension: ChartDimension = 'total',
): ChartData {
    if (dimension === 'credential') {
        return { labels: [], datasets: [] }
    }

    const extractValue = (pt: SummaryTimePoint): number | null =>
        metric === 'requests' ? pt.requests : metric === 'tokens' ? pt.tokens : (pt.has_cost ? (pt.cost ?? 0) : null)

    const formatLabel = (iso: string): string => {
        const d = new Date(iso)
        if (Number.isNaN(d.getTime())) {
            return iso
        }
        // 根据时间点间隔自动选择标签格式
        const hasHour = iso.includes('T') && !iso.endsWith('T00:00:00Z')
        return hasHour ? formatHourLabel(d) : formatDayLabel(d)
    }

    if (dimension === 'model') {
        const byModel = summary.time_series_by_model
        if (!byModel || Object.keys(byModel).length === 0) {
            return { labels: [], datasets: [] }
        }

        // 收集所有时间标签（union）
        const labelSet = new Set<string>()
        for (const points of Object.values(byModel)) {
            for (const pt of points) {
                labelSet.add(pt.time)
            }
        }
        const sortedTimes = Array.from(labelSet).sort()
        const labels      = sortedTimes.map(formatLabel)
        const timeIndex   = new Map(sortedTimes.map((t, i) => [t, i]))

        // 按总量降序排列模型
        const models = Object.entries(byModel)
                             .map(([name, points]) => ({
                                 name,
                                 total: points.reduce((s, pt) => s + (extractValue(pt) ?? 0), 0),
                                 points,
                             }))
                             .sort((a, b) => b.total - a.total)

        const datasets: ChartDataset[] = models.map(({ name, points }, index) => {
            const data = new Array(sortedTimes.length).fill(0)
            for (const pt of points) {
                const idx = timeIndex.get(pt.time)
                if (idx !== undefined) {
                    data[idx] = extractValue(pt)
                }
            }
            const colorIndex = index % CHART_COLORS.length
            const style      = CHART_COLORS[colorIndex]
            return {
                label: name,
                data,
                borderColor: style.borderColor,
                backgroundColor: style.backgroundColor,
                pointBackgroundColor: style.borderColor,
                pointBorderColor: style.borderColor,
                fill: false,
                tension: 0.35,
            }
        })

        return { labels, datasets }
    }

    // total 维度
    const points = summary.time_series
    if (!points || points.length === 0) {
        return { labels: [], datasets: [] }
    }

    const labels                  = points.map((pt) => formatLabel(pt.time))
    const data: (number | null)[] = points.map(extractValue)
    const style                   = CHART_COLORS[0]

    return {
        labels,
        datasets: [
            {
                label: 'All Models',
                data,
                borderColor: style.borderColor,
                backgroundColor: (ctx) => buildAreaGradient(ctx, style.borderColor, style.backgroundColor),
                pointBackgroundColor: style.borderColor,
                pointBorderColor: style.borderColor,
                fill: true,
                tension: 0.35,
            },
        ],
    }
}

/**
 * 构建图表数据
 */
export function buildChartData(
    usageData: unknown,
    period: 'hour' | 'day'        = 'day',
    metric: 'requests' | 'tokens' = 'requests',
    selectedModels: string[]      = [],
    options: {
        hourWindowHours?: number;
        dimension?: ChartDimension;
        aliases?: Record<string, string>;
    }                             = {},
): ChartData {
    const dimension = options.dimension || 'total'

    // 按凭证维度：独立的数据分组逻辑
    if (dimension === 'credential') {
        const series =
                  period === 'hour'
                  ? buildHourlySeriesByCredential(usageData, metric, options.hourWindowHours)
                  : buildDailySeriesByCredential(usageData, metric)

        const { labels, dataByGroup } = series
        const groups                  = Array.from(dataByGroup.keys()).sort()

        if (groups.length === 0) {
            const summed = new Array(labels.length).fill(0)
            return {
                labels,
                datasets: [
                    {
                        label: 'Total',
                        data: summed,
                        borderColor: CHART_COLORS[0].borderColor,
                        backgroundColor: (ctx) =>
                            buildAreaGradient(ctx, CHART_COLORS[0].borderColor, CHART_COLORS[0].backgroundColor),
                        pointBackgroundColor: CHART_COLORS[0].borderColor,
                        pointBorderColor: CHART_COLORS[0].borderColor,
                        fill: true,
                        tension: 0.35,
                    },
                ],
            }
        }

        const datasets: ChartDataset[] = groups.map((group, index) => {
            const data       = dataByGroup.get(group) || new Array(labels.length).fill(0)
            const colorIndex = index % CHART_COLORS.length
            const style      = CHART_COLORS[colorIndex]
            return {
                label: formatKeyDisplay(group, options.aliases),
                data,
                borderColor: style.borderColor,
                backgroundColor: style.backgroundColor,
                pointBackgroundColor: style.borderColor,
                pointBorderColor: style.borderColor,
                fill: false,
                tension: 0.35,
            }
        })

        return { labels, datasets }
    }

    // 按模型维度或总计维度
    const baseSeries =
              period === 'hour'
              ? buildHourlySeriesByModel(usageData, metric, options.hourWindowHours)
              : buildDailySeriesByModel(usageData, metric)

    const { labels, dataByModel } = baseSeries

    // Build "All" series as sum of all models
    const getAllSeries = (): number[] => {
        const summed = new Array(labels.length).fill(0)
        dataByModel.forEach((values) => {
            values.forEach((value, idx) => {
                summed[idx] = (summed[idx] || 0) + value
            })
        })
        return summed
    }

    if (dimension === 'model') {
        // 按模型维度：展示所有模型的独立线条
        // 按请求量/token 量降序排列，优先展示活跃模型
        const models = Array.from(dataByModel.entries())
                            .sort((a, b) => {
                                const sumA = a[1].reduce((s, v) => s + v, 0)
                                const sumB = b[1].reduce((s, v) => s + v, 0)
                                return sumB - sumA
                            })
                            .map(([name]) => name)
        if (models.length === 0) {
            return { labels, datasets: [] }
        }

        const datasets: ChartDataset[] = models.map((model, index) => {
            const data       = dataByModel.get(model) || new Array(labels.length).fill(0)
            const colorIndex = index % CHART_COLORS.length
            const style      = CHART_COLORS[colorIndex]
            return {
                label: model,
                data,
                borderColor: style.borderColor,
                backgroundColor: style.backgroundColor,
                pointBackgroundColor: style.borderColor,
                pointBorderColor: style.borderColor,
                fill: false,
                tension: 0.35,
            }
        })

        return { labels, datasets }
    }

    // 总计维度或 selectedModels 选择
    const modelsToShow = selectedModels.length > 0 ? selectedModels : ['all']

    const datasets: ChartDataset[] = modelsToShow.map((model, index) => {
        const isAll      = model === 'all'
        const data       = isAll ? getAllSeries() : dataByModel.get(model) || new Array(labels.length).fill(0)
        const colorIndex = index % CHART_COLORS.length
        const style      = CHART_COLORS[colorIndex]
        const shouldFill = modelsToShow.length === 1 || (isAll && modelsToShow.length > 1)

        return {
            label: isAll ? 'All Models' : model,
            data,
            borderColor: style.borderColor,
            backgroundColor: shouldFill
                             ? (ctx) => buildAreaGradient(ctx, style.borderColor, style.backgroundColor)
                             : style.backgroundColor,
            pointBackgroundColor: style.borderColor,
            pointBorderColor: style.borderColor,
            fill: shouldFill,
            tension: 0.35,
        }
    })

    return { labels, datasets }
}

/**
 * 依据 usage 数据计算密钥使用统计
 */
/**
 * 状态栏单个格子的状态
 */
export type StatusBlockState = 'success' | 'failure' | 'mixed' | 'idle';

/**
 * 状态栏单个格子的详细信息
 */
export interface StatusBlockDetail {
    success: number;
    failure: number;
    /** 该格子的成功率 (0–1)，无请求时为 -1 */
    rate: number;
    /** 格子起始时间戳 (ms) */
    startTime: number;
    /** 格子结束时间戳 (ms) */
    endTime: number;
    /** 该格子内的 token 总量 */
    totalTokens: number;
}

const RATE_COLOR_STOPS = [
    { r: 239, g: 68, b: 68 }, // #ef4444 red
    { r: 250, g: 204, b: 21 }, // #facc15 yellow
    { r: 16, g: 185, b: 129 }, // #10b981 green
] as const

/** Interpolate between red → yellow → green based on success rate (0–1). */
export function rateToColor(rate: number): string {
    const t       = Math.max(0, Math.min(1, rate))
    const segment = t < 0.5 ? 0 : 1
    const localT  = segment === 0 ? t * 2 : (t - 0.5) * 2
    const from    = RATE_COLOR_STOPS[segment]
    const to      = RATE_COLOR_STOPS[segment + 1]
    const r       = Math.round(from.r + (to.r - from.r) * localT)
    const g       = Math.round(from.g + (to.g - from.g) * localT)
    const b       = Math.round(from.b + (to.b - from.b) * localT)
    return `rgb(${r}, ${g}, ${b})`
}

/**
 * 状态栏数据
 */
export interface StatusBarData {
    blocks: StatusBlockState[];
    blockDetails: StatusBlockDetail[];
    successRate: number;
    totalSuccess: number;
    totalFailure: number;
}

/**
 * 计算状态栏数据（最近200分钟，分为20个10分钟的时间块）
 * 每个时间块代表窗口内的一个等长区间，用于展示成功/失败趋势
 */
export function calculateStatusBarData(
    usageDetails: UsageDetail[],
    sourceFilter?: string,
    authIndexFilter?: number,
): StatusBarData {
    const BLOCK_COUNT       = 20
    const BLOCK_DURATION_MS = 10 * 60 * 1000 // 10 minutes
    const WINDOW_MS         = BLOCK_COUNT * BLOCK_DURATION_MS // 200 minutes

    const now         = Date.now()
    const windowStart = now - WINDOW_MS

    // Initialize blocks
    const blockStats: Array<{ success: number; failure: number; tokens: number }> = Array.from(
        { length: BLOCK_COUNT },
        () => ({ success: 0, failure: 0, tokens: 0 }),
    )

    let totalSuccess = 0
    let totalFailure = 0

    // Filter and bucket the usage details
    usageDetails.forEach((detail) => {
        const timestamp = typeof detail.__timestampMs === 'number' ?
                          detail.__timestampMs :
                          Date.parse(detail.timestamp)
        if (!Number.isFinite(timestamp) || timestamp <= 0 || timestamp < windowStart || timestamp > now) {
            return
        }

        // Apply filters if provided
        if (sourceFilter !== undefined && detail.source !== sourceFilter) {
            return
        }
        if (authIndexFilter !== undefined && detail.auth_index !== authIndexFilter) {
            return
        }

        // Calculate which block this falls into (0 = oldest, 19 = newest)
        // noinspection DuplicatedCode
        const ageMs      = now - timestamp
        const blockIndex = BLOCK_COUNT - 1 - Math.floor(ageMs / BLOCK_DURATION_MS)

        if (blockIndex >= 0 && blockIndex < BLOCK_COUNT) {
            const tokens = detail.tokens?.total_tokens ?? 0
            blockStats[blockIndex].tokens += tokens
            if (detail.failed) {
                blockStats[blockIndex].failure += 1
                totalFailure += 1
            } else {
                blockStats[blockIndex].success += 1
                totalSuccess += 1
            }
        }
    })

    // Convert stats to block states and build details
    // noinspection DuplicatedCode
    const blocks: StatusBlockState[]        = []
    const blockDetails: StatusBlockDetail[] = []

    blockStats.forEach((stat, idx) => {
        const total = stat.success + stat.failure
        if (total === 0) {
            blocks.push('idle')
        } else if (stat.failure === 0) {
            blocks.push('success')
        } else if (stat.success === 0) {
            blocks.push('failure')
        } else {
            blocks.push('mixed')
        }

        const blockStartTime = windowStart + idx * BLOCK_DURATION_MS
        blockDetails.push({
                              success: stat.success,
                              failure: stat.failure,
                              rate: total > 0 ? stat.success / total : -1,
                              startTime: blockStartTime,
                              endTime: blockStartTime + BLOCK_DURATION_MS,
                              totalTokens: stat.tokens,
                          })
    })

    // Calculate success rate
    const total       = totalSuccess + totalFailure
    const successRate = total > 0 ? (totalSuccess / total) * 100 : 100

    return {
        blocks,
        blockDetails,
        successRate,
        totalSuccess,
        totalFailure,
    }
}

/**
 * 服务健康监测数据（最近 168 小时/7 天，7×96 网格）
 * 每个格子代表 15 分钟的健康度
 */
export interface ServiceHealthData {
    blocks: StatusBlockState[];
    blockDetails: StatusBlockDetail[];
    successRate: number;
    totalSuccess: number;
    totalFailure: number;
    rows: number;
    cols: number;
}

export function calculateServiceHealthData(usageDetails: UsageDetail[]): ServiceHealthData {
    const ROWS              = 7
    const COLS              = 96
    const BLOCK_COUNT       = ROWS * COLS // 672
    const BLOCK_DURATION_MS = 15 * 60 * 1000 // 15 minutes
    const WINDOW_MS         = BLOCK_COUNT * BLOCK_DURATION_MS // 168 hours (7 days)

    const now         = Date.now()
    const windowStart = now - WINDOW_MS

    const blockStats: Array<{ success: number; failure: number; tokens: number }> = Array.from(
        { length: BLOCK_COUNT },
        () => ({ success: 0, failure: 0, tokens: 0 }),
    )

    let totalSuccess = 0
    let totalFailure = 0

    usageDetails.forEach((detail) => {
        const timestamp = typeof detail.__timestampMs === 'number' ?
                          detail.__timestampMs :
                          Date.parse(detail.timestamp)
        if (!Number.isFinite(timestamp) || timestamp <= 0 || timestamp < windowStart || timestamp > now) {
            return
        }

        // noinspection DuplicatedCode
        const ageMs      = now - timestamp
        const blockIndex = BLOCK_COUNT - 1 - Math.floor(ageMs / BLOCK_DURATION_MS)

        if (blockIndex >= 0 && blockIndex < BLOCK_COUNT) {
            const tokens = detail.tokens?.total_tokens ?? 0
            blockStats[blockIndex].tokens += tokens
            if (detail.failed) {
                blockStats[blockIndex].failure += 1
                totalFailure += 1
            } else {
                blockStats[blockIndex].success += 1
                totalSuccess += 1
            }
        }
    })

    // noinspection DuplicatedCode
    const blocks: StatusBlockState[]        = []
    const blockDetails: StatusBlockDetail[] = []

    blockStats.forEach((stat, idx) => {
        const total = stat.success + stat.failure
        if (total === 0) {
            blocks.push('idle')
        } else if (stat.failure === 0) {
            blocks.push('success')
        } else if (stat.success === 0) {
            blocks.push('failure')
        } else {
            blocks.push('mixed')
        }

        const blockStartTime = windowStart + idx * BLOCK_DURATION_MS
        blockDetails.push({
                              success: stat.success,
                              failure: stat.failure,
                              rate: total > 0 ? stat.success / total : -1,
                              startTime: blockStartTime,
                              endTime: blockStartTime + BLOCK_DURATION_MS,
                              totalTokens: stat.tokens,
                          })
    })

    const total       = totalSuccess + totalFailure
    const successRate = total > 0 ? (totalSuccess / total) * 100 : 100

    return {
        blocks,
        blockDetails,
        successRate,
        totalSuccess,
        totalFailure,
        rows: ROWS,
        cols: COLS,
    }
}

export function computeKeyStatsFromDetails(usageDetails: UsageDetail[]): KeyStats {
    const bySource: Record<string, KeyStatBucket>    = {}
    const byAuthIndex: Record<string, KeyStatBucket> = {}

    const ensureBucket = (bucket: Record<string, KeyStatBucket>, key: string) => {
        if (!bucket[key]) {
            bucket[key] = { success: 0, failure: 0 }
        }
        return bucket[key]
    }

    usageDetails.forEach((detail) => {
        const source       = normalizeUsageSourceId(detail.source)
        const authIndexKey = normalizeAuthIndex(detail.auth_index)
        const isFailed     = detail.failed

        if (source) {
            const bucket = ensureBucket(bySource, source)
            if (isFailed) {
                bucket.failure += 1
            } else {
                bucket.success += 1
            }
        }

        if (authIndexKey) {
            const bucket = ensureBucket(byAuthIndex, authIndexKey)
            if (isFailed) {
                bucket.failure += 1
            } else {
                bucket.success += 1
            }
        }
    })

    return { bySource, byAuthIndex }
}

export type TokenCategory = 'input' | 'output' | 'cached' | 'reasoning';

interface TokenBreakdownSeries {
    labels: string[];
    dataByCategory: Record<TokenCategory, number[]>;
    hasData: boolean;
}

/**
 * 按 token 类别构建小时级别的堆叠序列
 */
export function buildHourlyTokenBreakdown(usageData: unknown, hourWindow: number = 24): TokenBreakdownSeries {
    // noinspection DuplicatedCode
    const hourMs             = 60 * 60 * 1000
    const resolvedHourWindow =
              Number.isFinite(hourWindow) && hourWindow > 0 ?
              Math.min(Math.max(Math.floor(hourWindow), 1), 24 * 31) :
              24
    const now                = new Date()
    const currentHour        = new Date(now)
    currentHour.setMinutes(0, 0, 0)

    const earliestBucket = new Date(currentHour)
    earliestBucket.setHours(earliestBucket.getHours() - (resolvedHourWindow - 1))
    const earliestTime = earliestBucket.getTime()

    const labels: string[] = []
    for (let i = 0; i < resolvedHourWindow; i++) {
        labels.push(formatHourLabel(new Date(earliestTime + i * hourMs)))
    }

    const dataByCategory: Record<TokenCategory, number[]> = {
        input: new Array(labels.length).fill(0),
        output: new Array(labels.length).fill(0),
        cached: new Array(labels.length).fill(0),
        reasoning: new Array(labels.length).fill(0),
    }

    const details = collectUsageDetails(usageData)
    let hasData   = false

    details.forEach((detail) => {
        // noinspection DuplicatedCode
        const timestamp = typeof detail.__timestampMs === 'number' ?
                          detail.__timestampMs :
                          Date.parse(detail.timestamp)
        if (!Number.isFinite(timestamp) || timestamp <= 0) {
            return
        }
        const bucketIndex = resolveHourBucketIndex(timestamp, earliestTime, hourMs, labels.length)
        if (bucketIndex < 0) {
            return
        }

        const tokens    = detail.tokens
        const input     = Math.max(tokens.input_tokens, 0)
        const output    = Math.max(tokens.output_tokens, 0)
        const cached    = Math.max(tokens.cached_tokens, tokens.cache_tokens ?? 0, 0)
        const reasoning = Math.max(tokens.reasoning_tokens, 0)

        dataByCategory.input[bucketIndex] += input
        dataByCategory.output[bucketIndex] += output
        dataByCategory.cached[bucketIndex] += cached
        dataByCategory.reasoning[bucketIndex] += reasoning
        hasData = true
    })

    return { labels, dataByCategory, hasData }
}

/**
 * 按 token 类别构建日级别的堆叠序列
 */
export function buildDailyTokenBreakdown(usageData: unknown): TokenBreakdownSeries {
    const details                                               = collectUsageDetails(usageData)
    const dayMap: Record<string, Record<TokenCategory, number>> = {}
    let hasData                                                 = false

    details.forEach((detail) => {
        const timestamp = typeof detail.__timestampMs === 'number' ?
                          detail.__timestampMs :
                          Date.parse(detail.timestamp)
        if (!Number.isFinite(timestamp) || timestamp <= 0) {
            return
        }
        const dayLabel = formatDayLabel(new Date(timestamp))
        if (!dayLabel) {
            return
        }

        if (!dayMap[dayLabel]) {
            dayMap[dayLabel] = { input: 0, output: 0, cached: 0, reasoning: 0 }
        }

        const tokens    = detail.tokens
        const input     = Math.max(tokens.input_tokens, 0)
        const output    = Math.max(tokens.output_tokens, 0)
        const cached    = Math.max(tokens.cached_tokens, tokens.cache_tokens ?? 0, 0)
        const reasoning = Math.max(tokens.reasoning_tokens, 0)

        dayMap[dayLabel].input += input
        dayMap[dayLabel].output += output
        dayMap[dayLabel].cached += cached
        dayMap[dayLabel].reasoning += reasoning
        hasData = true
    })

    const labels                                          = Object.keys(dayMap).sort()
    const dataByCategory: Record<TokenCategory, number[]> = {
        input: labels.map((l) => dayMap[l].input),
        output: labels.map((l) => dayMap[l].output),
        cached: labels.map((l) => dayMap[l].cached),
        reasoning: labels.map((l) => dayMap[l].reasoning),
    }

    return { labels, dataByCategory, hasData }
}

/**
 * Extract unique credential source identifiers from usage data.
 */
export function getCredentialSourcesFromUsage(usageData: unknown): string[] {
    const details = collectUsageDetails(usageData)
    const sources = new Set<string>()
    details.forEach((d) => {
        if (d.source) {
            sources.add(d.source)
        }
    })
    return Array.from(sources).sort((a, b) => a.localeCompare(b))
}

/**
 * Filter usage data by selected models and credentials.
 * Empty arrays mean "all" (no filtering).
 */
export function filterUsageBySelections(
    usageData: unknown,
    selectedModels: string[],
    selectedCredentials: string[],
): unknown {
    if (selectedModels.length === 0 && selectedCredentials.length === 0) {
        return usageData
    }
    if (!isRecord(usageData)) {
        return usageData
    }

    const apis = getApisRecord(usageData)
    if (!apis) {
        return usageData
    }

    const modelSet = selectedModels.length > 0 ? new Set(selectedModels) : null
    const credSet  = selectedCredentials.length > 0 ? new Set(selectedCredentials) : null

    const filteredApis: Record<string, unknown> = {}
    let totalRequests                           = 0
    let totalTokens                             = 0
    let successCount                            = 0
    let failureCount                            = 0

    Object.entries(apis).forEach(([apiName, apiEntry]) => {
        if (!isRecord(apiEntry)) {
            return
        }
        const models = isRecord(apiEntry.models) ? apiEntry.models : null
        if (!models) {
            return
        }

        const filteredModels: Record<string, unknown> = {}
        let apiRequests                               = 0
        let apiTokens                                 = 0

        Object.entries(models).forEach(([modelName, modelEntry]) => {
            if (modelSet && !modelSet.has(modelName)) {
                return
            }
            if (!isRecord(modelEntry)) {
                return
            }

            if (!credSet) {
                filteredModels[modelName] = modelEntry
                apiRequests += typeof modelEntry.total_requests === 'number' ? modelEntry.total_requests : 0
                apiTokens += typeof modelEntry.total_tokens === 'number' ? modelEntry.total_tokens : 0
                return
            }

            const details         = Array.isArray(modelEntry.details) ? modelEntry.details : []
            const filteredDetails = details.filter((d: unknown) => {
                if (!isRecord(d)) {
                    return false
                }
                const src = typeof d.source === 'string' ? d.source : ''
                return !src || credSet.has(src)
            })

            if (filteredDetails.length === 0) {
                return
            }

            let mTokens  = 0
            let mSuccess = 0
            let mFailure = 0
            filteredDetails.forEach((d: Record<string, unknown>) => {
                const tok = isRecord(d.tokens) ? d.tokens : null
                mTokens += typeof tok?.total_tokens === 'number' ? tok.total_tokens : 0
                if (d.failed === true) {
                    mFailure++
                } else {
                    mSuccess++
                }
            })

            filteredModels[modelName] = {
                ...modelEntry,
                details: filteredDetails,
                total_requests: filteredDetails.length,
                total_tokens: mTokens,
                success_count: mSuccess,
                failure_count: mFailure,
            }
            apiRequests += filteredDetails.length
            apiTokens += mTokens
            successCount += mSuccess
            failureCount += mFailure
        })

        if (Object.keys(filteredModels).length > 0) {
            filteredApis[apiName] = {
                ...apiEntry,
                models: filteredModels,
                total_requests: apiRequests,
                total_tokens: apiTokens,
            }
            totalRequests += apiRequests
            totalTokens += apiTokens
        }
    })

    if (credSet) {
        return {
            ...usageData,
            apis: filteredApis,
            total_requests: totalRequests,
            total_tokens: totalTokens,
            success_count: successCount,
            failure_count: failureCount,
        }
    }

    return { ...usageData, apis: filteredApis }
}
