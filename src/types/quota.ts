/**
 * Quota management types.
 */

export type QuotaFreshness = 'fresh' | 'stale' | 'partial' | 'outdated'

export interface QuotaCacheMetadata {
    fileName: string
    type: string
    backendGeneration: number
    backendStateRevision: number
    status: string
    freshness: QuotaFreshness
    source?: string
    observedAt?: string | null
    fetchedAt?: string | null
    lastSuccessAt?: string | null
    lastError?: string
    lastErrorAt?: string | null
    retryAt?: string | null
    successfulEmpty: boolean
    lastRefreshAt?: string | null
    nextRefreshAt?: string | null
}

// Claude API payload types
export interface ClaudeExtraUsage {
    is_enabled: boolean
    monthly_limit: number
    used_credits: number
    utilization: number | null
}

export interface ClaudeUsageLimit {
    kind?: string | null
    percent?: number | string | null
    resets_at?: string | null
    is_active?: boolean | null
    scope?: {
                model?: {
                            display_name?: string | null
                        } | null
            } | null
}

export interface ClaudeQuotaWindow {
    id: string
    label: string
    labelKey?: string
    usedPercent: number | null
    resetLabel: string
    resetAtMs?: number | null
    periodHours?: number | null
}

export interface ClaudeQuotaState {
    status: 'idle' | 'loading' | 'success' | 'error'
    windows: ClaudeQuotaWindow[]
    extraUsage?: ClaudeExtraUsage | null
    planType?: string | null
    error?: string
    errorStatus?: number
}

// Quota state types
export interface AntigravityQuotaGroup {
    id: string
    label: string
    models: string[]
    remainingFraction: number
    resetTime?: string
    resetAtMs?: number | null
    periodHours?: number | null
}

export interface AntigravityQuotaState {
    status: 'idle' | 'loading' | 'success' | 'error'
    groups: AntigravityQuotaGroup[]
    serverTimeOffsetMs?: number | null
    planType?: string | null
    tierName?: string | null
    tierId?: string | null
    premium?: boolean | null
    error?: string
    errorStatus?: number
}

export interface GeminiCliQuotaBucketState {
    id: string
    label: string
    remainingFraction: number | null
    remainingAmount: number | null
    resetTime: string | undefined
    resetAtMs?: number | null
    tokenType: string | null
    modelIds?: string[]
}

export interface GeminiCliQuotaState {
    status: 'idle' | 'loading' | 'success' | 'error'
    buckets: GeminiCliQuotaBucketState[]
    tierLabel?: string | null
    tierId?: string | null
    creditBalance?: number | null
    error?: string
    errorStatus?: number
}

export interface CodexQuotaWindow {
    id: string
    label: string
    labelKey?: string
    labelParams?: Record<string, string | number>
    usedPercent: number | null
    resetLabel: string
    resetAtMs?: number | null
    periodHours?: number | null
}

export type CodexResetCreditCountSource = 'usage' | 'details'

export interface CodexResetCreditCountEvidence {
    source: CodexResetCreditCountSource
    field: 'snake_case' | 'camelCase'
    value: number
}

export type CodexResetCreditCountState =
    | { state: 'known'; value: number; evidence: CodexResetCreditCountEvidence[] }
    | { state: 'missing'; sources: CodexResetCreditCountSource[] }
    | { state: 'invalid'; sources: CodexResetCreditCountSource[] }
    | { state: 'conflict'; evidence: CodexResetCreditCountEvidence[] }

export type CodexResetCreditExpiryState = 'valid' | 'missing' | 'invalid' | 'expired'
export type CodexResetCreditDetailsState = 'present' | 'empty' | 'missing' | 'invalid' | 'error'

export interface CodexRateLimitResetCredit {
    id: string
    status: string
    grantedAt: string
    expiresAt: string | null
    expiryState: CodexResetCreditExpiryState
}

export interface CodexQuotaState {
    status: 'idle' | 'loading' | 'success' | 'error'
    windows: CodexQuotaWindow[]
    planType?: string | null
    subscriptionActiveUntil?: string | number | null
    rateLimitResetCreditsAvailableCount?: CodexResetCreditCountState
    rateLimitResetCreditsApplicableAvailableCount?: CodexResetCreditCountState
    rateLimitResetCredits?: CodexRateLimitResetCredit[]
    rateLimitResetCreditDetailsState?: CodexResetCreditDetailsState
    rateLimitResetCreditsError?: string
    error?: string
    errorStatus?: number
}

export interface KimiQuotaRow {
    id: string
    label?: string
    labelKey?: string
    labelParams?: Record<string, string | number>
    used: number
    limit: number
    resetHint?: string
    resetAtMs?: number | null
    periodHours?: number | null
}

export interface KimiQuotaState {
    status: 'idle' | 'loading' | 'success' | 'error'
    rows: KimiQuotaRow[]
    error?: string
    errorStatus?: number
}

export type XaiBillingPeriodType = 'weekly' | 'monthly' | 'unknown'
export type XaiAmountUnit = 'credits' | 'currency_minor' | 'currency_major' | 'unknown'

export interface XaiProductUsageSummary {
    product: string
    usagePercent: number | null
}

export interface XaiQuotaAuxiliaryError {
    source: string
    code: string
    status?: number | null
}

export interface XaiBillingSummary {
    periodType: XaiBillingPeriodType
    usagePercent: number | null
    periodStart?: string | null
    periodEnd?: string | null
    resetAtMs?: number | null
    periodHours?: number | null
    productUsage: XaiProductUsageSummary[]
    used: number | null
    includedUsed: number | null
    monthlyLimit: number | null
    remaining: number | null
    onDemandEnabled: boolean | null
    onDemandCap: number | null
    onDemandUsed: number | null
    onDemandUsedPercent: number | null
    usedPercent: number | null
    prepaidBalance: number | null
    billingPeriodStart?: string | null
    billingPeriodEnd?: string | null
    amountUnit: XaiAmountUnit
    currency: string | null
    source: string | null
    valueSource: Record<string, string>
    auxiliaryErrors: XaiQuotaAuxiliaryError[]
}

export interface XaiQuotaState {
    status: 'idle' | 'loading' | 'success' | 'error'
    billing: XaiBillingSummary | null
    planType?: string | null
    planCode?: string | null
    planName?: string | null
    planTier?: string | null
    error?: string
    errorStatus?: number
}
