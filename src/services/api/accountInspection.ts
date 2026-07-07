import {apiClient} from './client'

export type AccountInspectionStatus = 'idle' | 'running' | 'completed' | 'stopped' | 'error'
export type AccountHealthStatus = 'normal' | 'unavailable' | 'unknown' | 'disabled'

export interface AccountInspectionSchedule {
    enabled: boolean
    interval_seconds: number
    providers: string[]
    max_concurrency: number
    timeout_seconds: number
    retention_runs: number
}

export interface AccountInspectionSummary {
    total: number
    normal: number
    abnormal: number
    token_invalid: number
    refresh_failed: number
    disabled: number
}

export interface AccountInspectionReasonCount {
    reason: string
    count: number
}

export interface AccountInspectionProviderSummary extends AccountInspectionSummary {
    provider: string
    unavailable: number
    unknown: number
    last_checked_at?: string
    top_reasons?: AccountInspectionReasonCount[]
}

export interface AccountInspectionRun {
    id: string
    started_at: string
    ended_at?: string
    duration_ms: number
    status: AccountInspectionStatus
    checked: number
    summary: AccountInspectionSummary
    error?: string
}

export interface AccountInspectionRefreshQueue {
    pending: number
    skipped: number
    failed: number
    next_refresh?: string
}

export interface AccountInspectionStatusResponse {
    status: AccountInspectionStatus
    schedule: AccountInspectionSchedule
    summary: AccountInspectionSummary
    summary_by_provider?: Record<string, AccountInspectionProviderSummary>
    refresh_queue: AccountInspectionRefreshQueue
    current_run?: AccountInspectionRun
    last_run?: AccountInspectionRun
    updated_at: string
}

export interface AccountInspectionResult {
    id: string
    account: string
    file_name: string
    provider: string
    auth_index?: string
    status: AccountHealthStatus
    reason: string
    advice: string
    auto_handling: string
    checked_at: string
}

export interface AccountInspectionResultsResponse {
    results: AccountInspectionResult[]
    total: number
    page: number
    page_size: number
    total_pages: number
}

export interface AccountInspectionLogEntry {
    time: string
    level: string
    message: string
}

export interface AccountInspectionLogsResponse {
    logs: AccountInspectionLogEntry[]
}

export const accountInspectionApi = {
    getStatus: () => apiClient.get<AccountInspectionStatusResponse>('/account-inspection/status'),

    getResults: (params?: {
        status?: string
        issuesOnly?: boolean
        includeDisabled?: boolean
        page?: number
        pageSize?: number
    }) =>
        apiClient.get<AccountInspectionResultsResponse>('/account-inspection/results', {
            params: {
                status: params?.status || undefined,
                issues_only: params?.issuesOnly ? 'true' : undefined,
                include_disabled: params?.includeDisabled ? 'true' : undefined,
                page: params?.page,
                page_size: params?.pageSize,
            },
        }),

    getLogs: () => apiClient.get<AccountInspectionLogsResponse>('/account-inspection/logs'),

    updateSchedule: (schedule: AccountInspectionSchedule) =>
        apiClient.put<AccountInspectionSchedule>('/account-inspection/schedule', schedule),

    run: () => apiClient.post<AccountInspectionRun>('/account-inspection/run'),

    inspectOne: (target: { id?: string; file_name?: string; auth_index?: string }) =>
        apiClient.post<AccountInspectionRun>('/account-inspection/inspect-one', target),

    stop: () => apiClient.post<{ status: AccountInspectionStatus }>('/account-inspection/stop'),

    refreshToken: (target: { id?: string; file_name?: string; auth_index?: string }) =>
        apiClient.post<{ status: string }>('/account-inspection/refresh-token', target),
}
