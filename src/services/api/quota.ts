/**
 * 后端 Quota API 客户端
 * 用于读取后端缓存的 quota 数据（替代前端直接查询 provider API）
 */

import i18n from '@/i18n'
import {apiClient} from './client'

export interface QuotaEntry {
    file_name: string
    type: string
    auth_index?: string
    generation: number
    state_revision: number
    status: string
    freshness: 'fresh' | 'stale' | 'partial' | 'outdated'
    source?: string
    observed_at?: string | null
    fetched_at?: string | null
    last_success_at?: string | null
    last_error?: string
    last_error_at?: string | null
    retry_at?: string | null
    successful_empty?: boolean
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
    fresh: number
    stale: number
    partial: number
    outdated: number
    successful_empty: number
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

export type QuotaRefreshTaskStatus =
    | 'queued'
    | 'running'
    | 'paused'
    | 'succeeded'
    | 'failed'
    | 'cancelled'
    | 'inconclusive'
    | 'interrupted'

export type QuotaRefreshTargetStatus =
    | 'queued'
    | 'running'
    | 'succeeded'
    | 'failed'
    | 'skipped'
    | 'cancelled'
    | 'inconclusive'
    | 'interrupted'

export interface QuotaRefreshTaskSummary {
    total: number
    queued: number
    running: number
    succeeded: number
    failed: number
    skipped: number
    cancelled: number
    inconclusive: number
    interrupted: number
}

export interface QuotaRefreshTaskTarget {
    id: string
    identifier?: string
    entry_key?: string
    file_name?: string
    provider?: string
    status: QuotaRefreshTargetStatus
    error?: string
    started_at?: string
    completed_at?: string
    shared_execution?: boolean
}

export interface QuotaRefreshTask {
    id: string
    status: QuotaRefreshTaskStatus
    created_at: string
    started_at?: string
    completed_at?: string
    cancel_requested_at?: string
    summary: QuotaRefreshTaskSummary
    targets: QuotaRefreshTaskTarget[]
    error?: string
    persistence_error?: string
}

type QuotaRequestOptions = {
    signal?: AbortSignal
}

const quotaRefreshTaskPath = (taskId: string): string =>
    `/quota/refresh-tasks/${encodeURIComponent(taskId)}`

export const quotaApi = {
    getStatus: () => apiClient.get<QuotaStatusResponse>('/quota/status'),

    fetchCredential: (authIndex: string, provider?: string, options?: QuotaRequestOptions) =>
        apiClient.post<unknown>('/quota/fetch', {
            auth_index: authIndex,
            ...(provider ? {provider} : {}),
        }, {signal: options?.signal}),

    refresh: (credentials?: string[], options?: QuotaRequestOptions) =>
        apiClient.post<QuotaRefreshTask>(
            '/quota/refresh',
            credentials ? { credentials } : {},
            { signal: options?.signal },
        ),

    getTask: (taskId: string, options?: QuotaRequestOptions) =>
        apiClient.get<QuotaRefreshTask>(quotaRefreshTaskPath(taskId), { signal: options?.signal }),

    pauseTask: (taskId: string, options?: QuotaRequestOptions) =>
        apiClient.post<QuotaRefreshTask>(`${quotaRefreshTaskPath(taskId)}/pause`, undefined, {
            signal: options?.signal,
        }),

    resumeTask: (taskId: string, options?: QuotaRequestOptions) =>
        apiClient.post<QuotaRefreshTask>(`${quotaRefreshTaskPath(taskId)}/resume`, undefined, {
            signal: options?.signal,
        }),

    cancelTask: (taskId: string, options?: QuotaRequestOptions) =>
        apiClient.post<QuotaRefreshTask>(`${quotaRefreshTaskPath(taskId)}/cancel`, undefined, {
            signal: options?.signal,
        }),

    reset: async (authIndex: string): Promise<void> => {
        const identity = authIndex.trim()
        if (!identity) {
            throw new Error(i18n.t('auth_files.quota_reset_manual_missing_auth_index'))
        }
        const result = await apiClient.post<{status: string; auth_index: string}>('/reset-quota', {
            auth_index: identity,
        })
        if (result?.status !== 'ok' || result.auth_index !== identity) {
            throw new Error(i18n.t('auth_files.quota_reset_invalid_response'))
        }
    },

    getConfig: () => apiClient.get<QuotaConfig>('/quota/config'),
}
