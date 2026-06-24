/**
 * Quota management types.
 */

// Claude API payload types
export interface ClaudeExtraUsage {
    is_enabled: boolean
    monthly_limit: number
    used_credits: number
    utilization: number | null
}

export interface ClaudeQuotaWindow {
    id: string
    label: string
    labelKey?: string
    usedPercent: number | null
    resetLabel: string
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
}

export interface AntigravityQuotaState {
    status: 'idle' | 'loading' | 'success' | 'error'
    groups: AntigravityQuotaGroup[]
    error?: string
    errorStatus?: number
}

export interface GeminiCliQuotaBucketState {
    id: string
    label: string
    remainingFraction: number | null
    remainingAmount: number | null
    resetTime: string | undefined
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
}

export interface CodexQuotaState {
    status: 'idle' | 'loading' | 'success' | 'error'
    windows: CodexQuotaWindow[]
    planType?: string | null
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
}

export interface KimiQuotaState {
    status: 'idle' | 'loading' | 'success' | 'error'
    rows: KimiQuotaRow[]
    error?: string
    errorStatus?: number
}

export interface XaiBillingSummary {
    usedCents: number | null
    monthlyLimitCents: number | null
    onDemandCapCents: number | null
    usedPercent: number | null
    billingPeriodStart?: string | null
    billingPeriodEnd?: string | null
}

export interface XaiQuotaState {
    status: 'idle' | 'loading' | 'success' | 'error'
    billing: XaiBillingSummary | null
    error?: string
    errorStatus?: number
}
