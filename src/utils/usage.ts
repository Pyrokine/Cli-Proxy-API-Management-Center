/**
 * 使用统计相关工具
 * 迁移自基线 modules/usage.js 的纯逻辑部分
 */

import type {PutModelPricesResponse} from '@/services/api/modelPrices'
import type {SummaryTimePoint, UsageSummary as ApiUsageSummary, UsageThinking} from '@/services/api/usage'
import type {RecentRequestBucket} from '@/types/authFile'
import type {ScriptableContext} from 'chart.js'
import {formatKeyDisplay} from './format'

export interface ModelPrice {
    prompt: number
    completion: number
    cache: number
}

export interface UsageDetail {
    timestamp: string
    source: string
    auth_index: number
    latency_ms?: number | string | null
    thinking?: UsageThinking | null
    tokens: {
        input_tokens: number
        output_tokens: number
        reasoning_tokens: number
        cached_tokens: number
        cache_tokens?: number
        total_tokens: number
    }
    failed: boolean
    __modelName?: string
    __timestampMs?: number
    __apiKey?: string
}

export interface UsageDetailWithEndpoint extends UsageDetail {
    __endpoint: string
    __endpointMethod?: string
    __endpointPath?: string
    __timestampMs: number
}

const MODEL_PRICE_STORAGE_KEY     = 'cli-proxy-model-prices-v2'
const MODEL_PRICE_MIGRATED_KEY    = 'cli-proxy-model-prices-migrated'
const USAGE_ENDPOINT_METHOD_REGEX = /^(?<method>GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s+(?<path>\S+)/i

const isRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value)

const parseTimestamp = (input: unknown): number => {
    if (input instanceof Date) {
        return input.getTime()
    }
    if (typeof input === 'number') {
        return Number.isFinite(input) ? input : Number.NaN
    }
    if (typeof input !== 'string') {
        return Number.NaN
    }

    const trimmed = input.trim()
    if (!trimmed) {
        return Number.NaN
    }
    const normalized = trimmed.replace(/(?<time>T\d{2}:\d{2}:\d{2})\.(?<ms>\d{3})\d+(?<tz>[Zz]|[+-]\d{2}:?\d{2})$/, '$<time>.$<ms>$<tz>')
    return Date.parse(normalized)
}

const timestampText = (input: unknown): string => {
    if (input instanceof Date) {
        return input.toISOString()
    }
    return typeof input === 'string' ? input : String(input ?? '')
}

const getApisRecord = (usageData: unknown): Record<string, unknown> | null => {
    const usageRecord = isRecord(usageData) ? usageData : null
    const apisRaw     = usageRecord ? usageRecord.apis : null
    return isRecord(apisRaw) ? apisRaw : null
}

interface UsageSummary {
    totalRequests: number
    successCount: number
    failureCount: number
    totalTokens: number
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
                if (!detailRecord || detailRecord.timestamp === undefined || detailRecord.timestamp === null) {
                    return
                }
                const timestamp = parseTimestamp(detailRecord.timestamp)
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
    const fromMs = from ? parseTimestamp(from) : 0
    const toMs   = to ? parseTimestamp(to) : Date.now()
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

function normalizeCredentialFilterValue(value: string): string {
    const trimmed = value.trim()
    if (!trimmed) {
        return ''
    }
    if (/^[tkm]:/.test(trimmed)) {
        return trimmed
    }

    const separator = trimmed.indexOf(':')
    const source    = separator > 0 && separator < trimmed.length - 1 ? trimmed.slice(separator + 1) : trimmed
    return normalizeUsageSourceId(source)
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

export const LATENCY_SOURCE_FIELD = 'latency_ms'

export interface DurationFormatOptions {
    maxUnits?: number
    invalidText?: string
    secondDecimals?: number | 'auto'
    locale?: string
}

export function extractLatencyMs(detail: unknown): number | null {
    const record   = isRecord(detail) ? detail : null
    const rawValue = record?.[LATENCY_SOURCE_FIELD]
    if (rawValue === null || rawValue === undefined || (typeof rawValue === 'string' && rawValue.trim() === '')) {
        return null
    }

    const parsed = Number(rawValue)
    if (!Number.isFinite(parsed) || parsed < 0) {
        return null
    }
    return parsed
}

function resolveDurationLocale(locale?: string): string | undefined {
    return locale || undefined
}

function resolveSecondDecimalPlaces(seconds: number, option?: number | 'auto'): number {
    if (typeof option === 'number') {
        return Math.max(0, Math.min(3, option))
    }
    if (seconds < 10) {
        return 2
    }
    return seconds < 60 ? 1 : 0
}

function formatDurationPart(value: number, unit: string, locale?: string, options?: Intl.NumberFormatOptions): string {
    return `${value.toLocaleString(locale, options)}${unit}`
}

export function formatDurationMs(value: number | null | undefined, options: DurationFormatOptions = {}): string {
    const invalidText = options.invalidText ?? '--'
    if (value === null || value === undefined) {
        return invalidText
    }

    const parsed = Number(value)
    if (!Number.isFinite(parsed) || parsed < 0) {
        return invalidText
    }

    const locale = resolveDurationLocale(options.locale)
    if (parsed < 1000) {
        return formatDurationPart(Math.round(parsed), 'ms', locale)
    }

    const seconds = parsed / 1000
    if (seconds < 60) {
        const digits = resolveSecondDecimalPlaces(seconds, options.secondDecimals)
        return formatDurationPart(seconds, 's', locale, {
            minimumFractionDigits: 0,
            maximumFractionDigits: digits,
        })
    }

    const units = [
        { unit: 'd', value: Math.floor(seconds / 86400) },
        { unit: 'h', value: Math.floor((seconds % 86400) / 3600) },
        { unit: 'm', value: Math.floor((seconds % 3600) / 60) },
        { unit: 's', value: Math.floor(seconds % 60) },
    ].filter((part) => part.value > 0)

    const maxUnits = Math.max(1, options.maxUnits ?? 2)
    return units
        .slice(0, maxUnits)
        .map((part) => formatDurationPart(part.value, part.unit, locale))
        .join(' ')
}

export function normalizeUsageThinking(value: unknown): UsageThinking | null {
    if (!isRecord(value)) {
        return null
    }
    const intensity = typeof value.intensity === 'string' ? value.intensity.trim() : ''
    const mode      = typeof value.mode === 'string' ? value.mode.trim() : ''
    const level     = typeof value.level === 'string' ? value.level.trim() : ''
    const rawBudget = Number(value.budget)
    const hasBudget = value.budget !== undefined && value.budget !== null && Number.isFinite(rawBudget)
    if (!intensity && !mode && !level && !hasBudget) {
        return null
    }
    return {
        ...(intensity ? { intensity } : {}),
        ...(mode ? { mode } : {}),
        ...(level ? { level } : {}),
        ...(hasBudget ? { budget: rawBudget } : {}),
    }
}

export function formatThinkingLabel(thinking: UsageThinking | null | undefined, locale?: string): string {
    if (!thinking) {
        return '-'
    }

    const intensity   = typeof thinking.intensity === 'string' ? thinking.intensity.trim() : ''
    const level       = typeof thinking.level === 'string' ? thinking.level.trim() : ''
    const mode        = typeof thinking.mode === 'string' ? thinking.mode.trim() : ''
    const budget      = typeof thinking.budget === 'number' && Number.isFinite(thinking.budget) ? thinking.budget : null
    const label       = intensity || level || (budget !== null ? String(budget) : mode)
    const budgetLabel = budget !== null ? budget.toLocaleString(locale) : null

    if (!label) {
        return '-'
    }
    if (budgetLabel !== null && label === String(budget)) {
        return budgetLabel
    }
    if (mode === 'budget' && budget !== null && budget > 0) {
        return `${label} (${budgetLabel})`
    }
    if (budget === -1 && label !== 'auto') {
        return `${label} (-1)`
    }
    return label
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
                if (!isRecord(detailRaw) || detailRaw.timestamp === undefined || detailRaw.timestamp === null) {
                    return
                }
                const timestamp   = timestampText(detailRaw.timestamp)
                const timestampMs = parseTimestamp(detailRaw.timestamp)
                const tokensRaw   = isRecord(detailRaw.tokens) ? detailRaw.tokens : {}
                details.push({
                                 timestamp,
                                 source: normalizeSource(detailRaw.source),
                                 auth_index: detailRaw.auth_index as unknown as number,
                                 latency_ms: detailRaw.latency_ms as UsageDetail['latency_ms'],
                                 thinking: normalizeUsageThinking(detailRaw.thinking),
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
                if (!isRecord(detailRaw) || detailRaw.timestamp === undefined || detailRaw.timestamp === null) {
                    return
                }
                const timestamp   = timestampText(detailRaw.timestamp)
                const timestampMs = parseTimestamp(detailRaw.timestamp)
                const tokensRaw   = isRecord(detailRaw.tokens) ? detailRaw.tokens : {}
                details.push({
                                 timestamp,
                                 source: normalizeSource(detailRaw.source),
                                 auth_index: detailRaw.auth_index as unknown as number,
                                 latency_ms: detailRaw.latency_ms as UsageDetail['latency_ms'],
                                 thinking: normalizeUsageThinking(detailRaw.thinking),
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
function extractTotalTokens(detail: unknown): number {
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
export async function saveModelPrices(prices: Record<string, ModelPrice>): Promise<PutModelPricesResponse | null> {
    try {
        const { modelPricesApi } = await import('@/services/api/modelPrices')
        return await modelPricesApi.put(prices)
    } catch {
        // Fallback to localStorage when server is unreachable
        saveModelPricesToLocalStorage(prices)
        return null
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

export type ChartDimension = 'total' | 'model' | 'credential' | 'api_key'

export interface ChartDataset {
    label: string
    data: Array<number | null>
    borderColor: string
    backgroundColor: string | CanvasGradient | ((context: ScriptableContext<'line'>) => string | CanvasGradient)
    pointBackgroundColor?: string
    pointBorderColor?: string
    pointRadius?: number
    fill: boolean
    tension: number
}

export interface ChartData {
    labels: string[]
    datasets: ChartDataset[]
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
 * 从后端 summary API 的预聚合时序数据构建图表数据
 * 跳过前端全量 details 遍历，直接使用预聚合结果
 * 支持 total、model、credential、api_key 维度
 */

function buildMultiGroupChartData(
    groups: Record<string, SummaryTimePoint[]>,
    extractValue: (pt: SummaryTimePoint) => number | null,
    formatLabel: (iso: string) => string,
): ChartData {
    if (Object.keys(groups).length === 0) {
        return { labels: [], datasets: [] }
    }

    const labelSet = new Set<string>()
    for (const points of Object.values(groups)) {
        for (const pt of points) {
            labelSet.add(pt.time)
        }
    }
    const sortedTimes = Array.from(labelSet).sort()
    const labels      = sortedTimes.map(formatLabel)
    const timeIndex   = new Map(sortedTimes.map((t, i) => [t, i]))

    const entries = Object.entries(groups)
                          .map(([name, points]) => ({
                              name,
                              total: points.reduce((s, pt) => s + (extractValue(pt) ?? 0), 0),
                              points,
                          }))
                          .sort((a, b) => b.total - a.total)

    const datasets: ChartDataset[] = entries.map(({ name, points }, index) => {
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
            pointRadius: 0,
            fill: false,
            tension: 0.3,
        }
    })

    return { labels, datasets }
}

export function getSummaryDataStart(summary?: ApiUsageSummary | null): Date | undefined {
    const points = summary?.time_series
    if (!points?.length) {
        return undefined
    }

    let earliestActive = Infinity
    let earliestAny    = Infinity
    for (const pt of points) {
        const ms = parseTimestamp(pt.time)
        if (!Number.isFinite(ms)) {
            continue
        }
        if (ms < earliestAny) {
            earliestAny = ms
        }
        if (pt.requests > 0 && ms < earliestActive) {
            earliestActive = ms
        }
    }

    const resolved = Number.isFinite(earliestActive) ? earliestActive : earliestAny
    return Number.isFinite(resolved) ? new Date(resolved) : undefined
}

export function buildChartDataFromSummary(
    summary: ApiUsageSummary,
    metric: 'requests' | 'tokens' | 'cost',
    dimension: ChartDimension = 'total',
): ChartData {
    const extractValue = (pt: SummaryTimePoint): number | null => {
        if (metric === 'requests') {
            return pt.requests
        }
        if (metric === 'tokens') {
            return typeof pt.tokens === 'number' ? pt.tokens : (pt.tokens?.total ?? 0)
        }
        return pt.has_cost ? (pt.cost ?? 0) : 0
    }

    const formatLabel = (iso: string): string => {
        const parsed = parseTimestamp(iso)
        if (!Number.isFinite(parsed)) {
            return iso
        }
        const d       = new Date(parsed)
        // 根据时间点间隔自动选择标签格式
        const hasHour = iso.includes('T') && !iso.endsWith('T00:00:00Z')
        return hasHour ? formatHourLabel(d) : formatDayLabel(d)
    }

    if (dimension === 'model') {
        return buildMultiGroupChartData(summary.time_series_by_model ?? {}, extractValue, formatLabel)
    }

    if (dimension === 'credential') {
        return buildMultiGroupChartData(summary.time_series_by_credential ?? {}, extractValue, formatLabel)
    }

    if (dimension === 'api_key') {
        return buildMultiGroupChartData(summary.time_series_by_api_key ?? {}, extractValue, formatLabel)
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
                pointRadius: 0,
                fill: true,
                tension: 0.3,
            },
        ],
    }
}

/**
 * 状态栏单个格子的状态
 */
export type StatusBlockState = 'success' | 'failure' | 'mixed' | 'idle'

/**
 * 状态栏单个格子的详细信息
 */
export interface StatusBlockDetail {
    success: number
    failure: number
    /** 该格子的成功率 (0–1)，无请求时为 -1 */
    rate: number
    /** 格子起始时间戳 (ms) */
    startTime: number
    /** 格子结束时间戳 (ms) */
    endTime: number
    /** 该格子内的 token 总量 */
    totalTokens: number
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
    blocks: StatusBlockState[]
    blockDetails: StatusBlockDetail[]
    successRate: number
    totalSuccess: number
    totalFailure: number
}

export function calculateStatusBarDataFromRecentRequests(recentRequests: RecentRequestBucket[]): StatusBarData {
    const blockDetails: StatusBlockDetail[] = recentRequests.map((bucket, index) => {
        const success           = Number(bucket.success ?? 0)
        const failure           = Number(bucket.failed ?? 0)
        const total             = success + failure
        const now               = Date.now()
        const fallbackEndTime   = now - (recentRequests.length - 1 - index) * 10 * 60 * 1000
        const fallbackStartTime = fallbackEndTime - 10 * 60 * 1000
        const startTime         = typeof bucket.startTimeMs === 'number' ? bucket.startTimeMs : fallbackStartTime
        const endTime           = typeof bucket.endTimeMs === 'number' ? bucket.endTimeMs : fallbackEndTime
        return {
            success,
            failure,
            rate: total > 0 ? success / total : -1,
            startTime,
            endTime,
            totalTokens: 0,
        }
    })

    const blocks = blockDetails.map((detail) => {
        if (detail.success === 0 && detail.failure === 0) {
            return 'idle' as const
        }
        if (detail.failure === 0) {
            return 'success' as const
        }
        if (detail.success === 0) {
            return 'failure' as const
        }
        return 'mixed' as const
    })

    const totalSuccess = blockDetails.reduce((sum, detail) => sum + detail.success, 0)
    const totalFailure = blockDetails.reduce((sum, detail) => sum + detail.failure, 0)
    const total        = totalSuccess + totalFailure

    return {
        blocks,
        blockDetails,
        successRate: total > 0 ? (totalSuccess / total) * 100 : -1,
        totalSuccess,
        totalFailure,
    }
}

/**
 * 计算状态栏数据（最近240分钟，分为24个10分钟的时间块）
 * 每个时间块代表窗口内的一个等长区间，用于展示成功/失败趋势
 */
/**
 * 服务健康监测数据（由 ServiceHealthCard 基于 summary.time_series 计算，8×96 网格，每格 1 小时，最近 32 天）
 */
export interface ServiceHealthData {
    blocks: StatusBlockState[]
    blockDetails: StatusBlockDetail[]
    successRate: number
    totalSuccess: number
    totalFailure: number
    rows: number
    cols: number
}

export type TokenCategory = 'input' | 'output' | 'cached' | 'reasoning'

/**
 * Extract unique credential source identifiers from usage data.
 */
export function getCredentialSourcesFromUsage(usageData: unknown): string[] {
    const details = collectUsageDetails(usageData)
    const sources = new Set<string>()
    details.forEach((d) => {
        if (d.source) {
            // Strip common prefixes (e.g., "t:" from token-based auth)
            const clean = d.source.replace(/^[a-z]:/, '')
            sources.add(clean || d.source)
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
    selectedApiKeys: string[] = [],
): unknown {
    if (selectedModels.length === 0 && selectedCredentials.length === 0 && selectedApiKeys.length === 0) {
        return usageData
    }
    if (!isRecord(usageData)) {
        return usageData
    }

    const apis = getApisRecord(usageData)
    if (!apis) {
        return usageData
    }

    const modelSet  = selectedModels.length > 0 ? new Set(selectedModels) : null
    const credSet   =
              selectedCredentials.length > 0
              ? new Set(selectedCredentials.map(normalizeCredentialFilterValue).filter(Boolean))
              : null
    const apiKeySet = selectedApiKeys.length > 0 ? new Set(selectedApiKeys) : null

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

            if (!credSet && !apiKeySet) {
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
                if (credSet) {
                    const sourceId = typeof d.source === 'string' ? d.source : ''
                    if (sourceId && !credSet.has(sourceId)) {
                        return false
                    }
                }
                if (apiKeySet) {
                    const key = typeof d.api_key === 'string' ? d.api_key : ''
                    if (key && !apiKeySet.has(key)) {
                        return false
                    }
                }
                return true
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
