/**
 * 后端 Quota API 客户端
 * 用于读取后端缓存的 quota 数据（替代前端直接查询 provider API）
 */

import {apiClient} from './client'

export interface QuotaEntry {
    file_name: string
    type: string
    status: string
    last_refresh: string | null
    next_refresh: string | null
    error?: string
    failure_count: number
    data?: unknown
    disabled?: boolean
}

export interface QuotaProviderSummary {
    provider: string
    credential_count: number
    idle: number
    loading: number
    success: number
    error: number
    banned: number
    quota_exceeded: number
    disabled: number
    failure_count: number
    latest_refresh_at?: string | null
    next_refresh_at?: string | null
}

export interface QuotaStatusResponse {
    enabled: boolean
    interval_seconds: number
    credentials: Record<string, QuotaEntry>
    by_provider?: Record<string, QuotaProviderSummary>
    updated_at: string
}

export interface QuotaConfig {
    enabled: boolean
    interval: number
    'max-interval': number
}

export interface ResetQuotaResponse {
    status: string
    auth_index: string
    models: string[]
}

export const quotaApi = {
    getStatus: () => apiClient.get<QuotaStatusResponse>('/quota/status'),

    refresh: (credentials?: string[]) =>
        apiClient.post<{ status: string }>('/quota/refresh', credentials ? { credentials } : {}),

    reset: (authIndex: string) =>
        apiClient.post<ResetQuotaResponse>('/reset-quota', { auth_index: authIndex }),

    getConfig: () => apiClient.get<QuotaConfig>('/quota/config'),

    putConfig: (config: Partial<QuotaConfig>) => apiClient.put<QuotaConfig>('/quota/config', config),
}
