import {apiClient} from './client'

export interface BannedIPEntry {
    ip: string
    banned_until: string
    ban_remaining_seconds: number
    ban_count: number
}

export interface RateLimitUnbanHistoryEntry {
    ip: string
    unbanned_at: string
    banned_until: string
    ban_count: number
}

export interface RateLimitStatusResponse {
    banned_ips: BannedIPEntry[]
    unban_history: RateLimitUnbanHistoryEntry[]
}

export const rateLimitsApi = {
    getStatus: (): Promise<RateLimitStatusResponse> =>
        apiClient.get<RateLimitStatusResponse>('/rate-limit/status'),

    unban: (ip: string): Promise<{ status: string }> =>
        apiClient.delete<{ status: string }>('/rate-limit/ban', { data: { ip } }),
}
