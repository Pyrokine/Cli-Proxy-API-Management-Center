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

export interface FailedLoginNoticeEntry {
    ip: string
    count: number
    last_failure_at: string
    last_successful_auth_at: string
}

export interface RateLimitStatusResponse {
    banned_ips: BannedIPEntry[]
    failed_login_notices?: FailedLoginNoticeEntry[]
    unban_history: RateLimitUnbanHistoryEntry[]
}

export interface RateLimitStatusOptions {
    consumeFailedLoginNotices?: boolean
}

export const rateLimitsApi = {
    getStatus: (options: RateLimitStatusOptions = {}): Promise<RateLimitStatusResponse> =>
        apiClient.get<RateLimitStatusResponse>(
            options.consumeFailedLoginNotices ?
            '/rate-limit/status?consume_failed_login_notices=true' :
            '/rate-limit/status',
        ),

    unban: (ip: string): Promise<{ status: string }> =>
        apiClient.delete<{ status: string }>('/rate-limit/ban', { data: { ip } }),
}
