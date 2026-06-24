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

export interface QuotaStatusResponse {
    enabled: boolean
    interval_seconds: number
    credentials: Record<string, QuotaEntry>
    updated_at: string
}

export interface QuotaConfig {
    enabled: boolean
    interval: number
    'max-interval': number
}

export const quotaApi = {
    getStatus: () => apiClient.get<QuotaStatusResponse>('/quota/status'),

    refresh: (credentials?: string[]) =>
        apiClient.post<{ status: string }>('/quota/refresh', credentials ? { credentials } : {}),

    getConfig: () => apiClient.get<QuotaConfig>('/quota/config'),

    putConfig: (config: Partial<QuotaConfig>) => apiClient.put<QuotaConfig>('/quota/config', config),
}
