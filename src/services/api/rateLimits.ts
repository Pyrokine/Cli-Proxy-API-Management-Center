import {apiClient} from './client'

export interface BannedIPEntry {
    ip: string
    banned_until: string
    ban_remaining_seconds: number
    ban_count: number
}

interface RateLimitUnbanHistoryEntry {
    ip: string
    unbanned_at: string
    banned_until: string
    ban_count: number
}

export type RateLimitEventType = 'ban_started' | 'automatic_expiry' | 'manual_unban'

export interface RateLimitEventEntry {
    type: RateLimitEventType
    ip: string
    occurred_at: string
    banned_until: string
    ban_count: number
}

interface FailedLoginNoticeEntry {
    ip: string
    count: number
    last_failure_at: string
    last_successful_auth_at: string
}

interface RateLimitStatusResponse {
    banned_ips: BannedIPEntry[]
    failed_login_notices?: FailedLoginNoticeEntry[]
    unban_history: RateLimitUnbanHistoryEntry[]
    rate_limit_events?: RateLimitEventEntry[]
    rate_limit_persistence_available?: boolean
    client_ip?: string
    client_ip_source?: string
}

interface RateLimitStatusOptions {
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
