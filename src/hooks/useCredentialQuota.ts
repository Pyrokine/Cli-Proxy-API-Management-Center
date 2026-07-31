/**
 * Bridge between QuotaStore and CredentialCard — reads cached quota data
 * for a given auth file and converts it to QuotaItem[] for display.
 */

import type {QuotaItem} from '@/components/credentials/CredentialCard'
import i18n from '@/i18n'
import {useQuotaStore} from '@/stores/useQuotaStore'
import type {
    AntigravityQuotaState,
    ClaudeQuotaState,
    CodexQuotaState,
    CodexRateLimitResetCredit,
    GeminiCliQuotaState,
    KimiQuotaState,
    XaiQuotaState,
} from '@/types'
import {quotaCredentialKey} from '@/utils/quota/credentialKey'
import {formatQuotaResetTime} from '@/utils/quota/formatters'
import {useMemo} from 'react'

function fromAntigravity(state: AntigravityQuotaState): QuotaItem[] {
    if (state.status !== 'success') {
        return []
    }
    return state.groups.map((g) => ({
        model: g.label,
        percent: Math.round(g.remainingFraction * 100),
        resetLabel: g.resetTime ? formatQuotaResetTime(g.resetTime) : undefined,
    }))
}

function fromClaude(state: ClaudeQuotaState): QuotaItem[] {
    if (state.status !== 'success') {
        return []
    }
    return state.windows
                .filter((w) => w.usedPercent !== null)
                .map((w) => ({
                    model: w.label,
                    percent: Math.max(0, 100 - (w.usedPercent ?? 0)),
                    resetLabel: w.resetLabel || undefined,
                }))
}

function fromCodex(state: CodexQuotaState): QuotaItem[] {
    if (state.status !== 'success') {
        return []
    }
    return state.windows
                .filter((w) => w.usedPercent !== null)
                .map((w) => ({
                    model: w.label,
                    percent: Math.max(0, 100 - (w.usedPercent ?? 0)),
                    resetLabel: w.resetLabel || undefined,
                }))
}

function fromGeminiCli(state: GeminiCliQuotaState): QuotaItem[] {
    if (state.status !== 'success') {
        return []
    }
    return state.buckets
                .filter((b) => b.remainingFraction !== null)
                .map((b) => ({
                    model: b.label,
                    percent: Math.round((b.remainingFraction ?? 0) * 100),
                    resetLabel: b.resetTime ? formatQuotaResetTime(b.resetTime) : undefined,
                }))
}

function fromKimi(state: KimiQuotaState): QuotaItem[] {
    if (state.status !== 'success') {
        return []
    }
    return state.rows
                .filter((r) => r.limit > 0)
                .map((r) => ({
                    model: r.label ?? r.id,
                    percent: Math.round(Math.max(0, ((r.limit - r.used) / r.limit) * 100)),
                    resetLabel: r.resetHint || undefined,
                }))
}

function formatUsdCents(value: number | null | undefined): string | null {
    if (value === null || value === undefined) {
        return null
    }
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(value / 100)
}

function fromXai(state: XaiQuotaState): QuotaItem[] {
    if (state.status !== 'success' || !state.billing) {
        return []
    }

    const items: QuotaItem[] = []
    if (state.billing.periodType === 'weekly') {
        const weeklyUsed      = state.billing.usagePercent !== null ? Math.max(0, state.billing.usagePercent) : null
        const weeklyRemaining = weeklyUsed !== null ? Math.max(0, 100 - weeklyUsed) : null
        if (weeklyRemaining !== null || state.billing.periodEnd) {
            items.push({
                model: i18n.t('xai_quota.weekly_limit', { defaultValue: 'Weekly limit' }),
                percent: Math.round(weeklyRemaining ?? 100),
                detail: weeklyUsed !== null ? i18n.t('xai_quota.used_percent', {
                    percent: Math.round(weeklyUsed),
                    defaultValue: '{{percent}}% used',
                }) : undefined,
                resetLabel: state.billing.periodEnd ? formatQuotaResetTime(state.billing.periodEnd) : undefined,
            })
        }
        for (const usage of state.billing.productUsage) {
            if (usage.usagePercent === null) {
                continue
            }
            items.push({
                model: usage.product,
                percent: Math.round(Math.max(0, 100 - usage.usagePercent)),
                detail: i18n.t('xai_quota.used_percent', {
                    percent: Math.round(Math.max(0, usage.usagePercent)),
                    defaultValue: '{{percent}}% used',
                }),
            })
        }
    }

    if (state.billing.usedPercent === null) {
        return items
    }

    const limit                  = formatUsdCents(state.billing.monthlyLimitCents)
    const includedUsed           = state.billing.includedUsedCents ?? state.billing.usedCents ?? 0
    const remaining              = state.billing.monthlyLimitCents !== null ?
                                   formatUsdCents(Math.max(0, state.billing.monthlyLimitCents - includedUsed)) :
                                   null
    const monthlyItem: QuotaItem = {
        model: i18n.t('xai_quota.monthly_credits', { defaultValue: 'Monthly credits' }),
        percent: Math.round(Math.max(0, 100 - state.billing.usedPercent)),
        detail: remaining && limit ? `${remaining} / ${limit}` : undefined,
        resetLabel: state.billing.billingPeriodEnd ?
                    formatQuotaResetTime(state.billing.billingPeriodEnd) :
                    undefined,
    }

    if (state.billing.onDemandCapCents === null || state.billing.onDemandCapCents <= 0) {
        monthlyItem.detail = [
                                 monthlyItem.detail,
                                 state.billing.onDemandCapCents === 0 ?
                                 i18n.t(
                                     'xai_quota.pay_as_you_go_disabled',
                                     { defaultValue: 'Pay-as-you-go disabled' },
                                 ) :
                                 null,
                             ].filter(Boolean).join(' · ') || undefined
        return [...items, monthlyItem]
    }

    const onDemandCap       = formatUsdCents(state.billing.onDemandCapCents)
    const onDemandUsed      = state.billing.onDemandUsedCents ?? 0
    const onDemandRemaining = formatUsdCents(Math.max(0, state.billing.onDemandCapCents - onDemandUsed))
    const onDemandPercent   = state.billing.onDemandUsedPercent === null ?
                              100 :
                              Math.max(0, 100 - state.billing.onDemandUsedPercent)

    return [
        ...items,
        {
            model: i18n.t('xai_quota.pay_as_you_go_label', { defaultValue: 'Pay as you go' }),
            percent: Math.round(onDemandPercent),
            detail: onDemandRemaining && onDemandCap ? `${onDemandRemaining} / ${onDemandCap}` : undefined,
        },
        monthlyItem,
    ]
}

interface CredentialQuotaResult {
    items?: QuotaItem[]
    error?: string
    loading?: boolean
    planType?: string | null
    premium?: boolean | null
    subscriptionActiveUntil?: string | number | null
    manualResetCount?: number | null
    resetCreditExpiries?: CodexRateLimitResetCredit[]
    resetCreditExpiriesError?: string
}

/**
 * Returns quota state for a given provider and auth file name by checking all quota stores.
 * Includes items on success, error message on failure, and loading flag.
 */
export function useCredentialQuota(provider: string | undefined, fileName: string): CredentialQuotaResult {
    const key         = quotaCredentialKey(provider, fileName)
    const antigravity = useQuotaStore((s) => s.antigravityQuota[key])
    const claude      = useQuotaStore((s) => s.claudeQuota[key])
    const codex       = useQuotaStore((s) => s.codexQuota[key])
    const geminiCli   = useQuotaStore((s) => s.geminiCliQuota[key])
    const kimi        = useQuotaStore((s) => s.kimiQuota[key])
    const xai         = useQuotaStore((s) => s.xaiQuota[key])

    return useMemo(() => {
        const states = [antigravity, claude, codex, geminiCli, kimi, xai]
        const active = states.find((s) => s != null)
        if (!active) {
            return {}
        }

        if (active.status === 'loading') {
            return { loading: true }
        }

        if (active.status === 'error') {
            const error = (active as { error?: string }).error
            return { error: error || 'Unknown error' }
        }

        if (antigravity?.status === 'success') {
            return { items: fromAntigravity(antigravity), planType: antigravity.planType, premium: antigravity.premium }
        }
        if (claude?.status === 'success') {
            return { items: fromClaude(claude), planType: claude.planType }
        }
        if (codex?.status === 'success') {
            return {
                items: fromCodex(codex),
                planType: codex.planType,
                subscriptionActiveUntil: codex.subscriptionActiveUntil,
                manualResetCount: codex.rateLimitResetCreditsAvailableCount,
                resetCreditExpiries: codex.rateLimitResetCredits,
                resetCreditExpiriesError: codex.rateLimitResetCreditsError,
            }
        }
        if (geminiCli?.status === 'success') {
            return { items: fromGeminiCli(geminiCli), planType: geminiCli.tierLabel }
        }
        if (kimi?.status === 'success') {
            return { items: fromKimi(kimi) }
        }
        if (xai?.status === 'success') {
            return { items: fromXai(xai), planType: xai.planType }
        }

        return {}
    }, [antigravity, claude, codex, geminiCli, kimi, xai])
}
