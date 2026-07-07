import type {AccountInspectionStatusResponse} from '@/services/api/accountInspection'
import type {QuotaStatusResponse} from '@/services/api/quota'
import type {UsageSummary} from '@/services/api/usage'
import type {AuthFileItem} from '@/types/authFile'

export type ProviderHealthStatus = 'healthy' | 'warning' | 'error' | 'unknown'

export interface ProviderHealthRow {
    provider: string
    accountTotal: number
    normal: number
    abnormal: number
    disabled: number
    unavailable: number
    unknown: number
    tokenInvalid: number
    refreshFailed: number
    quotaCredentialCount: number
    quotaError: number
    quotaBanned: number
    quotaExceeded: number
    quotaDisabled: number
    quotaFailureCount: number
    requestSuccess: number
    requestFailure: number
    requestTotal: number
    errorRate: number
    nextRefreshAt?: string | null
    nextRetryAfter?: string | number | null
    lastCheckedAt?: string | null
    status: ProviderHealthStatus
}

export interface ProviderHealthInput {
    inspectionStatus?: AccountInspectionStatusResponse | null
    quotaStatus?: QuotaStatusResponse | null
    usageSummary?: UsageSummary | null
    authFiles?: AuthFileItem[]
}

const emptyRow = (provider: string): ProviderHealthRow => ({
    provider,
    accountTotal: 0,
    normal: 0,
    abnormal: 0,
    disabled: 0,
    unavailable: 0,
    unknown: 0,
    tokenInvalid: 0,
    refreshFailed: 0,
    quotaCredentialCount: 0,
    quotaError: 0,
    quotaBanned: 0,
    quotaExceeded: 0,
    quotaDisabled: 0,
    quotaFailureCount: 0,
    requestSuccess: 0,
    requestFailure: 0,
    requestTotal: 0,
    errorRate: 0,
    status: 'unknown',
})

const normalizeProvider = (value: unknown): string => {
    const provider = String(value ?? '')
        .trim()
        .toLowerCase()
    return provider || 'unknown'
}

const toNumber = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0)

const earlierTime = (current: string | number | null | undefined, next: string | number | null | undefined) => {
    if (!next) {
        return current ?? null
    }
    if (!current) {
        return next
    }
    const currentTime = new Date(current).getTime()
    const nextTime    = new Date(next).getTime()
    if (Number.isNaN(currentTime)) {
        return next
    }
    if (Number.isNaN(nextTime)) {
        return current
    }
    return nextTime < currentTime ? next : current
}

const deriveStatus = (row: ProviderHealthRow): ProviderHealthStatus => {
    if (row.accountTotal === 0 && row.quotaCredentialCount === 0 && row.requestTotal === 0) {
        return 'unknown'
    }
    if (row.unavailable > 0 || row.quotaBanned > 0 || row.quotaExceeded > 0 || row.errorRate >= 0.5) {
        return 'error'
    }
    if (row.abnormal > 0 || row.refreshFailed > 0 || row.tokenInvalid > 0 || row.quotaError > 0 || row.errorRate > 0) {
        return 'warning'
    }
    return 'healthy'
}

export function buildProviderHealthRows({
                                            inspectionStatus,
                                            quotaStatus,
                                            usageSummary,
                                            authFiles = [],
                                        }: ProviderHealthInput): ProviderHealthRow[] {
    const rows   = new Map<string, ProviderHealthRow>()
    const getRow = (providerValue: unknown) => {
        const provider = normalizeProvider(providerValue)
        const existing = rows.get(provider)
        if (existing) {
            return existing
        }
        const row = emptyRow(provider)
        rows.set(provider, row)
        return row
    }

    const hasInspectionSummary = Object.keys(inspectionStatus?.summary_by_provider ?? {}).length > 0
    const hasUsageSummary      = Object.keys(usageSummary?.by_provider ?? {}).length > 0

    Object.values(inspectionStatus?.summary_by_provider ?? {}).forEach((summary) => {
        const row         = getRow(summary.provider)
        row.accountTotal  = toNumber(summary.total)
        row.normal        = toNumber(summary.normal)
        row.abnormal      = toNumber(summary.abnormal)
        row.disabled      = toNumber(summary.disabled)
        row.unavailable   = toNumber(summary.unavailable)
        row.unknown       = toNumber(summary.unknown)
        row.tokenInvalid  = toNumber(summary.token_invalid)
        row.refreshFailed = toNumber(summary.refresh_failed)
        row.lastCheckedAt = summary.last_checked_at ?? null
    })

    authFiles.forEach((item) => {
        const row = getRow(item.provider ?? item.type)
        if (!hasInspectionSummary) {
            row.accountTotal++
        }
        if (item.disabled && !hasInspectionSummary) {
            row.disabled++
        }
        if (item.unavailable && !hasInspectionSummary) {
            row.unavailable++
            row.abnormal++
        }
        if (item.status === 'error' && !hasInspectionSummary) {
            row.refreshFailed++
            row.abnormal++
        }
        if (!hasUsageSummary) {
            const success = toNumber(item.success)
            const failed  = toNumber(item.failed)
            if (success > 0 || failed > 0) {
                row.requestSuccess += success
                row.requestFailure += failed
            } else {
                const buckets = item.recentRequests ?? []
                buckets.forEach((bucket) => {
                    row.requestSuccess += toNumber(bucket.success)
                    row.requestFailure += toNumber(bucket.failed)
                })
            }
        }
        row.nextRetryAfter = earlierTime(row.nextRetryAfter, item.nextRetryAfter)
    })

    Object.values(quotaStatus?.by_provider ?? {}).forEach((summary) => {
        const row                = getRow(summary.provider)
        row.quotaCredentialCount = toNumber(summary.credential_count)
        row.quotaError           = toNumber(summary.error)
        row.quotaBanned          = toNumber(summary.banned)
        row.quotaExceeded        = toNumber(summary.quota_exceeded)
        row.quotaDisabled        = toNumber(summary.disabled)
        row.quotaFailureCount    = toNumber(summary.failure_count)
        row.nextRefreshAt        = summary.next_refresh_at ?? null
    })

    Object.values(usageSummary?.by_provider ?? {}).forEach((summary) => {
        const row          = getRow(summary.provider)
        row.requestSuccess = toNumber(summary.success)
        row.requestFailure = toNumber(summary.failure)
    })

    rows.forEach((row) => {
        row.requestTotal = row.requestSuccess + row.requestFailure
        row.errorRate    = row.requestTotal > 0 ? row.requestFailure / row.requestTotal : 0
        row.status       = deriveStatus(row)
    })

    return [...rows.values()].sort((a, b) => {
        const statusOrder: Record<ProviderHealthStatus, number> = { error: 0, warning: 1, unknown: 2, healthy: 3 }
        const statusDiff                                        = statusOrder[a.status] - statusOrder[b.status]
        return statusDiff === 0 ? a.provider.localeCompare(b.provider) : statusDiff
    })
}
