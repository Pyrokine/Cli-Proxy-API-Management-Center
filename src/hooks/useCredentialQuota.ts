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
    ClaudeResetGrants,
    CodexQuotaState,
    CodexRateLimitResetCredit,
    CodexResetCreditCountState,
    CodexResetCreditDetailsState,
    DevinQuotaState,
    GeminiCliQuotaState,
    KimiQuotaState,
    QuotaCacheMetadata,
    QuotaFreshness,
    XaiAmountUnit,
    XaiQuotaState,
} from '@/types'
import {quotaCredentialKey} from '@/utils/quota/credentialKey'
import {formatQuotaResetTime} from '@/utils/quota/formatters'
import {resolveResetMs} from '@/utils/quota/resetInstants'
import {useMemo} from 'react'

function fromAntigravity(state: AntigravityQuotaState): QuotaItem[] {
    if (state.status !== 'success') {
        return []
    }
    return state.groups.map((g) => ({
        id: g.id,
        model: g.label,
        percent: Math.round(g.remainingFraction * 100),
        resetLabel: g.resetTime ? formatQuotaResetTime(g.resetTime) : undefined,
        resetAtMs: g.resetAtMs,
        periodHours: g.periodHours,
        liveCountdown: true,
        serverTimeOffsetMs: state.serverTimeOffsetMs,
    }))
}

function fromUsedQuotaWindows(
    state: Pick<ClaudeQuotaState, 'status' | 'windows'> | Pick<CodexQuotaState, 'status' | 'windows'>,
): QuotaItem[] {
    if (state.status !== 'success') {
        return []
    }
    return state.windows
                .filter((window) => window.usedPercent !== null || window.id === 'cloud-session-credits')
                .map((window) => ({
                    id: window.id,
                    model: window.label,
                    percent: window.usedPercent === null ? null : Math.max(0, 100 - window.usedPercent),
                    resetLabel: window.resetLabel || undefined,
                    resetAtMs: window.resetAtMs,
                    periodHours: window.periodHours,
                }))
}

export function buildDevinQuotaItems(state: DevinQuotaState): QuotaItem[] {
    if (state.status !== 'success') {
        return []
    }
    return state.windows.flatMap((window) => {
        if (window.remainingPercent === null) {
            return []
        }
        return [{
            id: `devin-${window.id}`,
            model: i18n.t(`devin_quota.${window.id}_limit`, {
                defaultValue: window.id === 'daily' ? 'Daily limit' : 'Weekly limit',
            }),
            percent: Math.round(window.remainingPercent),
            resetAtMs: window.resetAtMs,
            periodHours: window.periodHours,
        }]
    })
}

function fromGeminiCli(state: GeminiCliQuotaState): QuotaItem[] {
    if (state.status !== 'success') {
        return []
    }
    return state.buckets
                .filter((b) => b.remainingFraction !== null)
                .map((b) => ({
                    id: b.id,
                    model: b.label,
                    percent: Math.round((b.remainingFraction ?? 0) * 100),
                    resetLabel: b.resetTime ? formatQuotaResetTime(b.resetTime) : undefined,
                    resetAtMs: b.resetAtMs,
                }))
}

function fromKimi(state: KimiQuotaState): QuotaItem[] {
    if (state.status !== 'success') {
        return []
    }
    return state.rows
                .filter((r) => r.limit > 0)
                .map((r) => ({
                    id: r.id,
                    model: r.labelKey ? i18n.t(r.labelKey, r.labelParams ?? {}) : (r.label ?? r.id),
                    percent: Math.round(Math.max(0, ((r.limit - r.used) / r.limit) * 100)),
                    resetLabel: r.resetAtMs == null ? r.resetHint || undefined : undefined,
                    resetAtMs: r.resetAtMs,
                    periodHours: r.periodHours,
                }))
}

function formatXaiAmount(
    value: number | null | undefined,
    amountUnit: XaiAmountUnit,
    currency: string | null,
): string | null {
    if (value === null || value === undefined || amountUnit === 'unknown' ||
        (amountUnit !== 'credits' && !currency)) {
        return null
    }
    const amount = amountUnit === 'currency_minor' ? value / 100 : value
    if ((amountUnit === 'currency_minor' || amountUnit === 'currency_major') && currency) {
        try {
            return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount)
        } catch {
            return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(amount)} ${currency}`
        }
    }
    const formatted = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(amount)
    return amountUnit === 'credits' ?
           i18n.t('xai_quota.amount_credits', { amount: formatted, defaultValue: '{{amount}} credits' }) :
           formatted
}

export function buildXaiQuotaItems(state: XaiQuotaState): QuotaItem[] {
    if (state.status !== 'success' || !state.billing) {
        return []
    }

    const items: QuotaItem[] = []
    if (state.billing.periodType === 'weekly') {
        const weeklyUsed      = state.billing.usagePercent !== null ? Math.max(0, state.billing.usagePercent) : null
        const weeklyRemaining = weeklyUsed !== null ? Math.max(0, 100 - weeklyUsed) : null
        if (weeklyRemaining !== null || state.billing.periodEnd || state.billing.productUsage.length > 0) {
            items.push({
                           id: 'xai-weekly',
                           model: i18n.t('xai_quota.weekly_limit', { defaultValue: 'Weekly limit' }),
                           percent: weeklyRemaining === null ? null : Math.round(weeklyRemaining),
                           detail: weeklyUsed !== null ? i18n.t('xai_quota.used_percent', {
                               percent: Math.round(weeklyUsed),
                               defaultValue: '{{percent}}% used',
                           }) : i18n.t('xai_quota.usage_unavailable', {defaultValue: 'Usage unavailable'}),
                           resetLabel: state.billing.periodEnd ?
                                       formatQuotaResetTime(state.billing.periodEnd) :
                                       undefined,
                           resetAtMs: state.billing.resetAtMs ?? resolveResetMs([state.billing.periodEnd]),
                           periodHours: state.billing.periodHours,
                       })
        }
    }
    for (const [index, usage] of state.billing.productUsage.entries()) {
        const used = usage.usagePercent
        items.push({
                       id: `xai-product-${index}-${usage.product}`,
                       model: i18n.t('xai_quota.product_usage', {
                           product: usage.product,
                           defaultValue: 'Shared usage · {{product}}',
                       }),
                       // Product figures are observations, not independent remaining balances.
                       percent: null,
                       showReset: false,
                       detail: used === null ?
                               i18n.t('xai_quota.usage_unavailable', {defaultValue: 'Usage unavailable'}) :
                               i18n.t('xai_quota.used_percent', {
                                   percent: Math.round(Math.max(0, Math.min(100, used))),
                                   defaultValue: '{{percent}}% used',
                               }),
                   })
    }

    const hasMonthlyData = state.billing.usedPercent !== null ||
                           state.billing.monthlyLimit !== null ||
                           state.billing.used !== null ||
                           Boolean(state.billing.billingPeriodEnd)
    const limit                  = formatXaiAmount(
        state.billing.monthlyLimit,
        state.billing.amountUnit,
        state.billing.currency,
    )
    const remaining              = formatXaiAmount(
        state.billing.remaining,
        state.billing.amountUnit,
        state.billing.currency,
    )
    const monthlyItem: QuotaItem = {
        id: 'xai-monthly-credits',
        model: state.billing.amountUnit === 'credits' ?
               i18n.t('xai_quota.monthly_credits') : i18n.t('xai_quota.monthly_usage'),
        percent: state.billing.usedPercent === null ?
                 null : Math.round(Math.max(0, 100 - state.billing.usedPercent)),
        detail: state.billing.usedPercent === null ?
                i18n.t('xai_quota.usage_unavailable') :
                remaining !== null && limit !== null ? `${remaining} / ${limit}` : undefined,
        resetLabel: state.billing.billingPeriodEnd ?
                    formatQuotaResetTime(state.billing.billingPeriodEnd) :
                    undefined,
        resetAtMs: resolveResetMs([state.billing.billingPeriodEnd]),
    }
    const monthlyItems = hasMonthlyData &&
                         !(items.length > 0 && state.billing.monthlyLimit === 0 && state.billing.used === 0) ?
                         [monthlyItem] : []

    if (state.billing.onDemandEnabled === false || state.billing.onDemandCap === 0) {
        monthlyItem.detail = [
                                 monthlyItem.detail,
                                 i18n.t('xai_quota.pay_as_you_go_disabled', { defaultValue: 'Pay-as-you-go disabled' }),
                             ].filter(Boolean).join(' · ') || undefined
        return [...items, ...monthlyItems]
    }
    if (state.billing.onDemandCap === null || state.billing.onDemandCap <= 0 ||
        state.billing.onDemandUsedPercent === null) {
        return [...items, ...monthlyItems]
    }

    const onDemandCap       = formatXaiAmount(
        state.billing.onDemandCap,
        state.billing.amountUnit,
        state.billing.currency,
    )
    const onDemandRemaining = formatXaiAmount(
        state.billing.onDemandUsed === null ?
        null :
        Math.max(0, state.billing.onDemandCap - state.billing.onDemandUsed),
        state.billing.amountUnit,
        state.billing.currency,
    )

    return [
        ...items,
        {
            id: 'xai-pay-as-you-go',
            model: i18n.t('xai_quota.pay_as_you_go_label', { defaultValue: 'Pay as you go' }),
            percent: Math.round(Math.max(0, 100 - state.billing.onDemandUsedPercent)),
            detail: onDemandRemaining !== null && onDemandCap !== null ?
                    `${onDemandRemaining} / ${onDemandCap}` :
                    undefined,
        },
        ...monthlyItems,
    ]
}

export function quotaErrorForDisplay(metadata: QuotaCacheMetadata | undefined): string | undefined {
    return metadata?.freshness === 'fresh' ? undefined : metadata?.lastError
}

interface CredentialQuotaResult {
    items?: QuotaItem[]
    lastError?: string
    loading?: boolean
    freshness?: QuotaFreshness
    observedAt?: string | null
    successfulEmpty?: boolean
    planType?: string | null
    prepaidBalance?: string | null
    metaSubscriptionActive?: boolean | null
    premium?: boolean | null
    subscriptionActiveUntil?: string | number | null
    subscriptionError?: string
    creditBalance?: string | null
    creditsUnlimited?: boolean
    claudeResetGrants?: ClaudeResetGrants
    manualResetCount?: CodexResetCreditCountState
    applicableManualResetCount?: CodexResetCreditCountState
    resetCreditExpiries?: CodexRateLimitResetCredit[]
    resetCreditDetailsState?: CodexResetCreditDetailsState
    resetCreditExpiriesError?: string
}

/**
 * Returns quota state for a given provider and auth file name by checking all quota stores.
 * Includes items on success, error message on failure, and loading flag.
 */
export function useCredentialQuota(
    provider: string | undefined,
    fileName: string,
    authIndex?: string | number | null,
): CredentialQuotaResult {
    const key         = quotaCredentialKey(provider, fileName, authIndex)
    const metadata    = useQuotaStore((s) => s.quotaMetadata[key])
    const antigravity = useQuotaStore((s) => s.antigravityQuota[key])
    const claude      = useQuotaStore((s) => s.claudeQuota[key])
    const codex       = useQuotaStore((s) => s.codexQuota[key])
    const devin       = useQuotaStore((s) => s.devinQuota[key])
    const geminiCli   = useQuotaStore((s) => s.geminiCliQuota[key])
    const kimi        = useQuotaStore((s) => s.kimiQuota[key])
    const meta        = useQuotaStore((s) => s.metaQuota[key])
    const xai         = useQuotaStore((s) => s.xaiQuota[key])

    return useMemo(() => {
        const states                        = [antigravity, claude, codex, devin, geminiCli, kimi, meta, xai]
        const active                        = states.find((state) => state != null)
        const result: CredentialQuotaResult = {
            lastError: quotaErrorForDisplay(metadata),
            loading: metadata?.status === 'loading' || (!metadata && active?.status === 'loading'),
            freshness: metadata?.freshness,
            observedAt: metadata?.observedAt,
            successfulEmpty: metadata?.successfulEmpty,
        }

        if (!metadata && active?.status === 'error') {
            result.lastError = active.error || 'Unknown error'
        }
        if (antigravity?.status === 'success') {
            return {
                ...result,
                items: fromAntigravity(antigravity),
                planType: antigravity.planType,
                premium: antigravity.premium,
            }
        }
        if (claude?.status === 'success') {
            return {
                ...result,
                items: fromUsedQuotaWindows(claude),
                planType: claude.planType,
                claudeResetGrants: claude.resetGrants,
            }
        }
        if (codex?.status === 'success') {
            return {
                ...result,
                items: fromUsedQuotaWindows(codex),
                planType: codex.planType,
                subscriptionActiveUntil: codex.subscriptionActiveUntil,
                subscriptionError: codex.subscriptionError,
                creditBalance: codex.creditBalance,
                creditsUnlimited: codex.creditsUnlimited,
                manualResetCount: codex.rateLimitResetCreditsAvailableCount,
                applicableManualResetCount: codex.rateLimitResetCreditsApplicableAvailableCount,
                resetCreditExpiries: codex.rateLimitResetCredits,
                resetCreditDetailsState: codex.rateLimitResetCreditDetailsState,
                resetCreditExpiriesError: codex.rateLimitResetCreditsError,
            }
        }
        if (devin?.status === 'success') {
            return {
                ...result,
                items: buildDevinQuotaItems(devin),
                planType: devin.planType,
                subscriptionActiveUntil: devin.planEnd,
            }
        }
        if (geminiCli?.status === 'success') {
            return { ...result, items: fromGeminiCli(geminiCli), planType: geminiCli.tierLabel }
        }
        if (kimi?.status === 'success') {
            return { ...result, items: fromKimi(kimi) }
        }
        if (meta?.status === 'success') {
            return {
                ...result,
                planType: meta.isSubscriptionActive === false ? null : meta.planName,
                metaSubscriptionActive: meta.isSubscriptionActive,
            }
        }
        if (xai?.status === 'success') {
            const billing = xai.billing
            return {
                ...result,
                items: buildXaiQuotaItems(xai),
                planType: xai.planType,
                prepaidBalance: billing && billing.prepaidBalance !== null && billing.prepaidBalance > 0 ?
                                formatXaiAmount(billing.prepaidBalance, billing.amountUnit, billing.currency) :
                                null,
            }
        }

        return metadata || active ? result : {}
    }, [metadata, antigravity, claude, codex, devin, geminiCli, kimi, meta, xai])
}
