/**
 * 使用统计相关 API
 */

import {apiClient} from './client'

const USAGE_TIMEOUT_MS = 60 * 1000

interface UsageExportPayload {
    version?: number;
    exported_at?: string;
    usage?: Record<string, unknown>;

    [key: string]: unknown;
}

interface UsageImportResponse {
    added?: number;
    skipped?: number;
    total_requests?: number;
    failed_requests?: number;

    [key: string]: unknown;
}

export interface UsageRetention {
    days: number;
    max_file_size_mb: number;
    archive_months: number;
}

interface TrimResponse {
    status: string;
    archives?: Array<{
        month: string;
        file_name: string;
        size_bytes: number;
    }>;
}

interface TrimPreviewDateRange {
    oldest: string;
    newest: string;
}

interface TrimPreviewFile {
    date: string;
    size_bytes: number;
}

interface TrimPreviewResponse {
    files_count: number;
    total_size_bytes: number;
    date_range?: TrimPreviewDateRange;
    details: TrimPreviewFile[];
}

export interface SummaryTokens {
    input: number;
    output: number;
    cached: number;
    reasoning: number;
    total: number;
}

export interface SummaryTotals {
    requests: number;
    success: number;
    failure: number;
    tokens: SummaryTokens;
    cost: number;
}

export interface SummaryModelStats {
    requests: number;
    success: number;
    failure: number;
    tokens: SummaryTokens;
    cost: number;
}

export interface SummaryCredentialStats {
    success: number;
    failure: number;
}

export interface SummaryTimePoint {
    time: string;
    requests: number;
    tokens: number;
    cost: number;
    has_cost: boolean;
}

export interface UsageSummary {
    period: { from: string; to: string };
    totals: SummaryTotals;
    by_model: Record<string, SummaryModelStats>;
    by_credential: Record<string, SummaryCredentialStats>;
    time_series: SummaryTimePoint[];
    time_series_by_model: Record<string, SummaryTimePoint[]>;
}

export interface EventTokens {
    input_tokens: number;
    output_tokens: number;
    cached_tokens: number;
    reasoning_tokens: number;
    total_tokens: number;
}

export interface UsageEvent {
    timestamp: string;
    model: string;
    source: string;
    auth_index: string;
    tokens: EventTokens;
    failed: boolean;
}

interface EventsParams {
    from?: string;
    to?: string;
    page?: number;
    page_size?: number;
    model?: string;
    source?: string;
    search?: string;
    sort?: string;
    order?: 'asc' | 'desc';
}

export interface EventsResponse {
    events: UsageEvent[];
    total: number;
    page: number;
    page_size: number;
    total_pages: number;
}

export const usageApi = {
    /**
     * 获取使用统计原始数据
     */
    getUsage: () => apiClient.get<Record<string, unknown>>('/usage', { timeout: USAGE_TIMEOUT_MS }),

    /**
     * 导出使用统计快照
     */
    exportUsage: () => apiClient.get<UsageExportPayload>('/usage/export', { timeout: USAGE_TIMEOUT_MS }),

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
     * 获取聚合后的使用统计摘要
     */
    getSummary: (params?: { from?: string; to?: string; granularity?: 'hourly' | 'daily' }) => {
        const searchParams = new URLSearchParams()
        if (params?.from) {
            searchParams.set('from', params.from)
        }
        if (params?.to) {
            searchParams.set('to', params.to)
        }
        if (params?.granularity) {
            searchParams.set('granularity', params.granularity)
        }
        const qs = searchParams.toString()
        return apiClient.get<UsageSummary>(`/usage/summary${qs ? `?${qs}` : ''}`, {
            timeout: USAGE_TIMEOUT_MS,
        })
    },

    /**
     * 获取分页事件明细（支持筛选、排序）
     */
    getEvents: (params?: EventsParams) => {
        const searchParams = new URLSearchParams()
        if (params?.from) {
            searchParams.set('from', params.from)
        }
        if (params?.to) {
            searchParams.set('to', params.to)
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
        if (params?.search) {
            searchParams.set('search', params.search)
        }
        if (params?.sort) {
            searchParams.set('sort', params.sort)
        }
        if (params?.order) {
            searchParams.set('order', params.order)
        }
        const qs = searchParams.toString()
        return apiClient.get<EventsResponse>(`/usage/events${qs ? `?${qs}` : ''}`, {
            timeout: USAGE_TIMEOUT_MS,
        })
    },
}
