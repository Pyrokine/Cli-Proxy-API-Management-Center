/**
 * 使用统计相关 API
 */

import {apiClient} from './client'

const USAGE_TIMEOUT_MS = 60 * 1000

/**
 * 把 datetime-local 字符串(浏览器按本地时区填写,无 timezone 后缀)
 * 转成带 Z 的 ISO UTC 字符串,后端 parseTimeParam 优先匹配 RFC3339,
 * 这样就消除了"前端选 10:15 本地、后端当 10:15 UTC 处理"造成的偏移
 *
 * 已经带时区后缀(toISOString 输出或手动带 ±hh:mm)的字符串透传,
 * 让 hook 的 reload({from: precomputedIso}) 这类用法不被双转换
 *
 */
function localToIsoUtc(value: string): string {
    if (!value) {
        return value
    }
    if (/Z$|[+-]\d{2}:?\d{2}$/.test(value)) {
        return value
    }
    // datetime-local input 没有秒,补 :00 或 T00:00 让 Date 解析稳定
    const normalized = value.includes('T') ? value : `${value}T00:00`
    const d          = new Date(normalized)
    if (Number.isNaN(d.getTime())) {
        return value
    }
    return d.toISOString()
}

function appendQueryValues(
    searchParams: URLSearchParams,
    name: string,
    value: string | readonly string[] | undefined,
): void {
    if (typeof value !== 'string') {
        value?.forEach((item) => {
            if (item.trim()) {
                searchParams.append(name, item)
            }
        })
        return
    }
    if (value.trim()) {
        searchParams.set(name, value)
    }
}

interface UsageImportResponse {
    added?: number
    skipped?: number
    total_requests?: number
    failed_requests?: number

    [key: string]: unknown
}

export interface UsageRetention {
    days: number
    max_db_size_mb?: number
    warning_threshold_pct?: number
}

interface TrimResponse {
    status: string
}

interface TrimPreviewDateRange {
    oldest: string
    newest: string
}

interface TrimPreviewFile {
    date: string
    size_bytes: number
}

interface TrimPreviewResponse {
    files_count: number
    total_size_bytes: number
    date_range?: TrimPreviewDateRange
    details: TrimPreviewFile[]
}

export interface SummaryTokens {
    input: number
    output: number
    cached: number
    cache_read?: number
    cache_write?: number
    reasoning: number
    total: number
}

interface SummaryCostCoverageCount {
    requests: number
    tokens: number
}

interface SummaryCostCoverage {
    complete: SummaryCostCoverageCount
    partial: SummaryCostCoverageCount
    unpriced: SummaryCostCoverageCount
}

export interface SummaryTotals {
    requests: number
    success: number
    failure: number
    tokens: SummaryTokens
    cost: number
    cost_coverage?: SummaryCostCoverage
    average_latency_ms?: number | null
    total_latency_ms?: number | null
    latency_sample_count?: number
}

export interface SummaryModelStats {
    requests: number
    success: number
    failure: number
    tokens: SummaryTokens
    cost: number
    average_latency_ms?: number | null
    total_latency_ms?: number | null
    latency_sample_count?: number
}

export interface SummaryCredentialStats {
    success: number
    failure: number
    /** The upstream vendor and safe source display. Empty/undefined for legacy
     *  payloads. Current responses also provide a stable, type-aware filter key;
     *  the map key is reserved for unique chart labels. */
    provider?: string
    source?: string
    source_kind?: 'api_key' | 'identity'
    filter_key?: string
}

export interface SummaryApiKeyStats {
    requests: number
    success: number
    failure: number
    tokens: SummaryTokens
    cost: number
    average_latency_ms?: number | null
    total_latency_ms?: number | null
    latency_sample_count?: number
}

export interface SummaryProviderStats {
    provider: string
    requests: number
    success: number
    failure: number
    error_rate: number
}

export interface SummaryTimePoint {
    time: string
    requests: number
    success: number
    failure: number
    tokens: SummaryTokens
    cost: number
    has_cost: boolean
}

export interface UsageSummary {
    period: { from: string; to: string }
    totals: SummaryTotals
    by_model: Record<string, SummaryModelStats>
    by_credential: Record<string, SummaryCredentialStats>
    by_provider?: Record<string, SummaryProviderStats>
    by_api_key: Record<string, SummaryApiKeyStats>
    by_auth_index?: Record<string, SummaryApiKeyStats>
    time_series: SummaryTimePoint[]
    time_series_by_model: Record<string, SummaryTimePoint[]>
    time_series_by_credential: Record<string, SummaryTimePoint[]>
    time_series_by_api_key: Record<string, SummaryTimePoint[]>
    time_series_by_auth_index?: Record<string, SummaryTimePoint[]>
}

export interface EventTokens {
    input_tokens: number
    output_tokens: number
    cached_tokens: number
    cache_tokens?: number | string | null
    cache_read_tokens?: number | string | null
    cache_write_tokens?: number | string | null
    reasoning_tokens: number
    total_tokens: number
}

export interface UsageThinking {
    intensity?: string
    mode?: string
    level?: string
    budget?: number
}

export type RequestLogState =
    | 'pending'
    | 'available'
    | 'disabled'
    | 'not_captured'
    | 'publish_failed'
    | 'expired'
    | 'legacy_unknown'

export type RequestLogLocation = 'local' | 'home'
export type UsageCostStatus = 'complete' | 'partial' | 'unpriced'

type PricingLineItemCategory =
    | 'uncached_input'
    | 'cache_read'
    | 'cache_write_5m'
    | 'cache_write_1h'
    | 'cache_write_unknown'
    | 'output'
    | 'reasoning'
    | 'unclassified'

export interface PricingCoverage {
    uncached_input_tokens?: number | string
    cache_read_tokens?: number | string
    cache_write_5m_tokens?: number | string
    cache_write_1h_tokens?: number | string
    cache_write_unknown_tokens?: number | string
    output_tokens?: number | string
    reasoning_tokens?: number | string
    unclassified_tokens?: number | string
    priced_tokens: number | string
    unpriced_tokens: number | string
    total_tokens: number | string
}

export interface PricingLineItem {
    category: PricingLineItemCategory
    tokens: number | string
    rate_per_million?: number
    rate_source: string
    cost_micro: number | string
    priced: boolean
}

export interface PricingReceipt {
    schema_version: number
    captured_at: string
    priced_at: string
    provider: string
    model: string
    canonical_model: string
    price_revision?: string
    source: string
    currency: string
    effective_from?: string
    effective_until?: string
    cost_micro: number | string
    cost_status: UsageCostStatus
    cost_reason?: string
    coverage: PricingCoverage
    line_items: PricingLineItem[]
}

export interface UsageEvent {
    timestamp: string
    model: string
    source: string
    auth_index: string
    api_key: string
    api_key_alias?: string
    provider?: string
    latency_ms?: number | string | null
    request_id?: string | null
    request_log_state?: RequestLogState | null
    request_log_location?: RequestLogLocation | null
    request_log_file_name?: string | null
    request_log_home_ip?: string | null
    request_log_reason?: string | null
    request_log_revision?: number | string | null
    request_log_updated_at?: string | null
    time_to_first_byte_ms?: number | string | null
    total_duration_ms?: number | string | null
    completed?: boolean | null
    metadata_recorded?: boolean | null
    reasoning_effort?: string | null
    thinking?: UsageThinking | null
    tokens: EventTokens
    cost?: number
    cost_status?: UsageCostStatus
    cost_reason?: string
    pricing_receipt?: PricingReceipt
    failed: boolean
}

export interface EventsParams {
    from?: string
    to?: string
    page?: number
    page_size?: number
    model?: string
    source?: string
    api_key?: string | readonly string[]
    status?: 'success' | 'failure' | ''
    search?: string
    sort?: string
    order?: 'asc' | 'desc'
    view?: 'compact'
}

export interface EventsResponse {
    events: UsageEvent[]
    total: number
    page: number
    page_size: number
    total_pages: number
}

export const usageApi = {
    /**
     * 获取使用统计原始数据
     */
    getUsage: () => apiClient.get<Record<string, unknown>>('/usage', { timeout: USAGE_TIMEOUT_MS }),

    /**
     * 导出使用统计快照,可选筛选
     * 不传 filters 或全部为空 = 导出全量
     */
    exportUsage: (filters?: {
        from?: string
        to?: string
        model?: string
        api_key?: string | readonly string[]
        credential?: string
    }, options?: { signal?: AbortSignal }) => {
        const params = new URLSearchParams()
        if (filters) {
            const { from, to, ...rest } = filters
            if (from && from.trim()) {
                params.set('from', localToIsoUtc(from))
            }
            if (to && to.trim()) {
                params.set('to', localToIsoUtc(to))
            }
            if (rest.model?.trim()) {
                params.set('model', rest.model)
            }
            appendQueryValues(params, 'api_key', rest.api_key)
            if (rest.credential?.trim()) {
                params.set('credential', rest.credential)
            }
        }
        const qs  = params.toString()
        const url = qs ? `/usage/export?${qs}` : '/usage/export'
        return apiClient.getRaw(url, {
            timeout: USAGE_TIMEOUT_MS,
            responseType: 'blob',
            signal: options?.signal,
        })
    },

    /**
     * 导入使用统计快照
     */
    importUsage: (payload: unknown) =>
        apiClient.post<UsageImportResponse>('/usage/import', payload, { timeout: USAGE_TIMEOUT_MS }),

    /**
     * 获取数据保留配置
     */
    getRetention: () => apiClient.get<UsageRetention>('/usage-retention'),

    /**
     * 更新数据保留配置
     */
    putRetention: (retention: Partial<UsageRetention>) =>
        apiClient.put<UsageRetention & { status: string }>('/usage-retention', retention),

    /**
     * 预览即将清理的数据（不实际删除）
     */
    trimPreview: () => apiClient.get<TrimPreviewResponse>('/usage-retention/trim-preview'),

    /**
     * 手动触发数据清理
     */
    triggerTrim: () => apiClient.post<TrimResponse>('/usage-retention/trim', {}),

    /**
     * 获取数据库文件大小(events.db + WAL + SHM)
     */
    getDBSize: () =>
        apiClient.get<{
            size_bytes: number
            max_size_bytes?: number
            warning_threshold_pct?: number
            warning?: boolean
            capped?: boolean
        }>('/usage/db-size'),

    /**
     * 获取聚合后的使用统计摘要
     */
    getSummary: (
        params?: {
            from?: string
            to?: string
            granularity?: 'hourly' | 'daily'
            model?: string
            api_key?: string | readonly string[]
            credential?: string
            groups?: 'none' | 'all'
            auth_index_groups?: boolean
            auth_index_granularity?: '10m' | 'hourly' | 'daily'
        },
        options?: { signal?: AbortSignal },
    ) => {
        const searchParams = new URLSearchParams()
        if (params?.from) {
            searchParams.set('from', localToIsoUtc(params.from))
        }
        if (params?.to) {
            searchParams.set('to', localToIsoUtc(params.to))
        }
        if (params?.granularity) {
            searchParams.set('granularity', params.granularity)
        }
        if (params?.model) {
            searchParams.set('model', params.model)
        }
        appendQueryValues(searchParams, 'api_key', params?.api_key)
        if (params?.credential) {
            searchParams.set('credential', params.credential)
        }
        if (params?.groups) {
            searchParams.set('groups', params.groups)
        }
        if (params?.auth_index_groups) {
            searchParams.set('auth_index_groups', 'true')
        }
        if (params?.auth_index_granularity) {
            searchParams.set('auth_index_granularity', params.auth_index_granularity)
        }
        const qs = searchParams.toString()
        return apiClient.get<UsageSummary>(`/usage/summary${qs ? `?${qs}` : ''}`, {
            timeout: USAGE_TIMEOUT_MS,
            signal: options?.signal,
        })
    },

    /**
     * 获取分页事件明细（支持筛选、排序）
     */
    getEvents: (params?: EventsParams, options?: { signal?: AbortSignal }) => {
        const searchParams = new URLSearchParams()
        if (params?.from) {
            searchParams.set('from', localToIsoUtc(params.from))
        }
        if (params?.to) {
            searchParams.set('to', localToIsoUtc(params.to))
        }
        if (params?.page) {
            searchParams.set('page', String(params.page))
        }
        if (params?.page_size) {
            searchParams.set('page_size', String(params.page_size))
        }
        if (params?.model) {
            searchParams.set('model', params.model)
        }
        if (params?.source) {
            searchParams.set('source', params.source)
        }
        appendQueryValues(searchParams, 'api_key', params?.api_key)
        if (params?.status) {
            searchParams.set('status', params.status)
        }
        if (params?.search) {
            searchParams.set('search', params.search)
        }
        if (params?.sort) {
            searchParams.set('sort', params.sort)
        }
        if (params?.order) {
            searchParams.set('order', params.order)
        }
        if (params?.view) {
            searchParams.set('view', params.view)
        }
        const qs = searchParams.toString()
        return apiClient.get<EventsResponse>(`/usage/events${qs ? `?${qs}` : ''}`, {
            timeout: USAGE_TIMEOUT_MS,
            signal: options?.signal,
        })
    },
}
