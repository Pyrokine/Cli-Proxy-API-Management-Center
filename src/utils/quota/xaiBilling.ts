import type {XaiAmountUnit, XaiBillingPeriodType, XaiBillingSummary, XaiQuotaAuxiliaryError} from '@/types'
import {resolveResetMs} from '@/utils/quota/resetInstants'

interface ParsedXaiQuota {
    billing: XaiBillingSummary
    planType: string | null
    planCode: string | null
    planName: string | null
    planTier: string | null
}

export function parseXaiQuotaPayload(data: unknown): ParsedXaiQuota | null {
    const root = asRecord(data)
    if (!root) {
        return null
    }
    if (hasOwn(root, 'schema_version')) {
        return parseStandardPayload(root)
    }
    return parseLegacyPayload(root)
}

function parseStandardPayload(root: Record<string, unknown>): ParsedXaiQuota | null {
    const schemaVersion = numberValue(root.schema_version)
    const normalized    = asRecord(root.normalized)
    if (schemaVersion !== 1 || !normalized || !hasRecognizedStandardField(normalized)) {
        return null
    }

    const planCode        = stringValue(normalized.plan_code)
    const planName        = stringValue(normalized.plan_name)
    const planTier        = stringValue(normalized.plan_tier)
    const usagePeriod     = asRecord(normalized.usage_period)
    const billingPeriod   = asRecord(normalized.billing_period)
    const periodType      = normalizePeriodType(stringValue(usagePeriod?.type))
    const periodStart     = stringValue(usagePeriod?.start)
    const periodEnd       = stringValue(usagePeriod?.end)
    const periodStartMs   = resolveResetMs([periodStart])
    const resetAtMs       = resolveResetMs([periodEnd])
    const periodHours     = periodStartMs !== null && resetAtMs !== null && resetAtMs > periodStartMs ?
                            (resetAtMs - periodStartMs) / 3_600_000 :
                            null
    const monthlyLimit    = numberValue(normalized.monthly_limit)
    const includedUsed    = numberValue(normalized.included_used)
    const remaining       = numberValue(normalized.remaining)
    const onDemandCap     = numberValue(normalized.on_demand_cap)
    const onDemandUsed    = numberValue(normalized.on_demand_used)
    const usagePercent    = normalizePercent(numberValue(normalized.usage_percent))
    const usedPercent     = percentage(includedUsed, monthlyLimit) ??
                            (periodType === 'monthly' ? usagePercent : null)
    const onDemandPercent = onDemandCap !== null && onDemandCap > 0 && onDemandUsed !== null ?
                            (onDemandUsed / onDemandCap) * 100 :
                            null

    return {
        billing: {
            periodType,
            usagePercent,
            periodStart,
            periodEnd,
            resetAtMs,
            periodHours,
            productUsage: parseProductUsage(normalized.product_usage),
            used: numberValue(normalized.used),
            includedUsed,
            monthlyLimit,
            remaining: remaining ?? amountRemaining(monthlyLimit, includedUsed),
            onDemandEnabled: booleanValue(normalized.on_demand_enabled),
            onDemandCap,
            onDemandUsed,
            onDemandUsedPercent: onDemandPercent,
            usedPercent,
            prepaidBalance: numberValue(normalized.prepaid_balance),
            billingPeriodStart: stringValue(billingPeriod?.start),
            billingPeriodEnd: stringValue(billingPeriod?.end),
            amountUnit: normalizeAmountUnit(stringValue(normalized.amount_unit)),
            currency: normalizeCurrency(stringValue(normalized.currency)),
            source: stringValue(root.source),
            valueSource: parseValueSource(root.value_source),
            auxiliaryErrors: parseAuxiliaryErrors(root.auxiliary_errors),
        },
        planType: planTier ?? planName ?? planCode,
        planCode,
        planName,
        planTier,
    }
}

function parseLegacyPayload(root: Record<string, unknown>): ParsedXaiQuota | null {
    const usageRecord   = pickRecord([root], ['usage', 'current_usage', 'billing', 'billing_summary']) ?? root
    const configRecord  = pickRecord([root], ['config', 'billing_config', 'limits', 'subscription']) ?? root
    const sources       = [usageRecord, configRecord, root]
    const currentPeriod = pickRecord([configRecord, usageRecord, root], ['currentPeriod', 'current_period'])
    const periodType    = normalizePeriodType(stringValue(currentPeriod?.type))
    const productUsage  = parseProductUsage(configRecord.productUsage ?? configRecord.product_usage)
    const usagePercent  = normalizePercent(pickNumber(sources, ['creditUsagePercent', 'credit_usage_percent']))
    const periodStart   = stringValue(currentPeriod?.start) ?? pickString(sources, ['period_start', 'periodStart'])
    const periodEnd     = stringValue(currentPeriod?.end) ?? pickString(sources, ['period_end', 'periodEnd'])

    const genericUsed          = pickNumber(sources, [
        'used_cents', 'usedCents', 'usage_cents', 'usageCents', 'current_usage_cents', 'currentUsageCents',
        'spent_cents', 'spentCents', 'used', 'currentUsage',
    ])
    const totalUsed            = pickNumber(
        sources,
        ['total_used', 'totalUsed', 'total_usage_cents', 'totalUsageCents', 'totalUsage'],
    )
    const explicitIncludedUsed = pickNumber(
        sources,
        [
            'included_used',
            'includedUsed',
            'included_used_cents',
            'includedUsedCents',
        ],
    )
    const onDemandUsed         = pickNumber(sources, [
        'on_demand_used', 'onDemandUsed', 'on_demand_used_cents', 'onDemandUsedCents',
    ])
    const includedUsed         = explicitIncludedUsed ?? genericUsed ?? subtractAmounts(totalUsed, onDemandUsed)
    const used                 = totalUsed ?? addAmounts(includedUsed, onDemandUsed) ?? genericUsed
    const monthlyLimit         = pickNumber([configRecord, root], [
        'monthly_limit_cents', 'monthlyLimitCents', 'monthly_limit', 'monthlyLimit', 'spending_limit_cents',
        'spendingLimitCents', 'hard_limit_cents', 'hardLimitCents', 'credit_limit_cents', 'creditLimitCents',
        'limit_cents', 'limitCents', 'limit',
    ])
    const remaining            = pickNumber(sources, ['remaining', 'remaining_credits', 'remainingCredits']) ??
                                 amountRemaining(monthlyLimit, includedUsed)
    const onDemandCap          = pickNumber([configRecord, root], [
        'on_demand_cap_cents', 'onDemandCapCents', 'on_demand_cap', 'onDemandCap',
        'on_demand_spend_limit_cents', 'onDemandSpendLimitCents', 'on_demand_limit_cents', 'onDemandLimitCents',
    ])
    const usedPercentRaw       = pickNumber(
        sources,
        [
            'used_percent',
            'usedPercent',
            'usage_percent',
            'usagePercent',
            'utilization',
        ],
    )
    const remainingPercentRaw  = pickNumber(sources, ['remaining_percent', 'remainingPercent'])
    const usedPercent          = usedPercentRaw !== null ?
                                 normalizePercent(usedPercentRaw) :
                                 remainingPercentRaw !== null ?
                                 100 - (normalizePercent(remainingPercentRaw) ?? 0) :
                                 percentage(includedUsed, monthlyLimit)
    const onDemandUsedPercent  = percentage(onDemandUsed, onDemandCap)
    const billingPeriodStart   = pickString(sources, [
        'billing_period_start', 'billingPeriodStart', 'start_time', 'startTime',
    ])
    const billingPeriodEnd     = pickString(sources, [
        'billing_period_end', 'billingPeriodEnd', 'end_time', 'endTime', 'next_reset', 'nextReset', 'reset_at',
        'resetAt',
    ])
    const planCode             = pickPlanValue([root, configRecord, usageRecord], 'code')
    const planName             = pickPlanValue([root, configRecord, usageRecord], 'name')
    const planTier             = pickString(
        [root, configRecord, usageRecord],
        ['subscriptionTier', 'subscription_tier'],
    )
    const hasUsage             = usagePercent !==
                                 null ||
                                 periodType !==
                                 'unknown' ||
                                 productUsage.length >
                                 0 ||
                                 monthlyLimit !==
                                 null ||
                                 includedUsed !==
                                 null ||
                                 used !==
                                 null ||
                                 remaining !==
                                 null ||
                                 onDemandCap !==
                                 null ||
                                 onDemandUsed !==
                                 null ||
                                 Boolean(periodEnd || billingPeriodEnd)
    if (!hasUsage && !planCode && !planName && !planTier) {
        return null
    }

    const activePeriodStart = periodType !== 'unknown' || usagePercent !== null || productUsage.length > 0 ?
                              periodStart :
                              billingPeriodStart
    const activePeriodEnd   = periodType !== 'unknown' || usagePercent !== null || productUsage.length > 0 ?
                              periodEnd :
                              billingPeriodEnd
    const periodStartMs     = resolveResetMs([activePeriodStart])
    const resetAtMs         = resolveResetMs([activePeriodEnd])
    const periodHours       = periodStartMs !== null && resetAtMs !== null && resetAtMs > periodStartMs ?
                              (resetAtMs - periodStartMs) / 3_600_000 :
                              null

    return {
        billing: {
            periodType: periodType === 'unknown' && (usagePercent !== null || productUsage.length > 0) ?
                        'weekly' :
                        periodType === 'unknown' && hasUsage ? 'monthly' : periodType,
            usagePercent: periodType === 'weekly' || productUsage.length > 0 ? usagePercent : usedPercent,
            periodStart: activePeriodStart,
            periodEnd: activePeriodEnd,
            resetAtMs,
            periodHours,
            productUsage,
            used,
            includedUsed,
            monthlyLimit,
            remaining,
            onDemandEnabled: pickBoolean(sources, ['onDemandEnabled', 'on_demand_enabled']),
            onDemandCap,
            onDemandUsed,
            onDemandUsedPercent,
            usedPercent,
            prepaidBalance: pickNumber(sources, ['prepaidBalance', 'prepaid_balance']),
            billingPeriodStart,
            billingPeriodEnd,
            amountUnit: legacyAmountUnit(sources),
            currency: normalizeCurrency(pickString(sources, ['currency', 'currency_code', 'currencyCode'])),
            source: stringValue(root.source) ?? 'legacy',
            valueSource: {},
            auxiliaryErrors: [],
        },
        planType: planTier ?? planName ?? planCode,
        planCode,
        planName,
        planTier,
    }
}

function hasRecognizedStandardField(record: Record<string, unknown>): boolean {
    return [
        'plan_code', 'plan_name', 'plan_tier', 'monthly_limit', 'used', 'included_used', 'remaining',
        'on_demand_enabled', 'on_demand_cap', 'on_demand_used', 'prepaid_balance', 'usage_percent',
        'usage_period', 'billing_period', 'product_usage',
    ].some((key) => hasOwn(record, key))
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(record, key)
}

function asRecord(value: unknown): Record<string, unknown> | null {
    if (typeof value === 'string' && value.trim() !== '') {
        try {
            return asRecord(JSON.parse(value))
        } catch {
            return null
        }
    }
    return value !== null && typeof value === 'object' && !Array.isArray(value) ?
           value as Record<string, unknown> :
           null
}

function numberValue(value: unknown): number | null {
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : null
    }
    if (typeof value === 'string') {
        const normalized = value.trim().replace(/[$,%\s]/g, '')
        if (!normalized) {
            return null
        }
        const parsed = Number(normalized)
        return Number.isFinite(parsed) ? parsed : null
    }
    const record = asRecord(value)
    return record && hasOwn(record, 'val') ? numberValue(record.val) : null
}

function stringValue(value: unknown): string | null {
    if (typeof value === 'string') {
        const trimmed = value.trim()
        return trimmed || null
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        return String(value)
    }
    return null
}

function booleanValue(value: unknown): boolean | null {
    if (typeof value === 'boolean') {
        return value
    }
    return null
}

function pickRecord(sources: Array<Record<string, unknown> | null>, keys: string[]): Record<string, unknown> | null {
    for (const source of sources) {
        if (!source) {
            continue
        }
        for (const key of keys) {
            const record = asRecord(source[key])
            if (record) {
                return record
            }
        }
    }
    return null
}

function pickNumber(sources: Array<Record<string, unknown> | null>, keys: string[]): number | null {
    for (const source of sources) {
        if (!source) {
            continue
        }
        for (const key of keys) {
            if (!hasOwn(source, key)) {
                continue
            }
            const parsed = numberValue(source[key])
            if (parsed !== null) {
                return parsed
            }
        }
    }
    return null
}

function pickString(sources: Array<Record<string, unknown> | null>, keys: string[]): string | null {
    for (const source of sources) {
        if (!source) {
            continue
        }
        for (const key of keys) {
            const value = stringValue(source[key])
            if (value) {
                return value
            }
        }
    }
    return null
}

function pickBoolean(sources: Array<Record<string, unknown> | null>, keys: string[]): boolean | null {
    for (const source of sources) {
        if (!source) {
            continue
        }
        for (const key of keys) {
            if (!hasOwn(source, key)) {
                continue
            }
            const value = booleanValue(source[key])
            if (value !== null) {
                return value
            }
        }
    }
    return null
}

function pickPlanValue(sources: Array<Record<string, unknown> | null>, kind: 'code' | 'name'): string | null {
    const directKeys = kind === 'code' ?
        ['planCode', 'plan_code'] :
        ['planName', 'plan_name', 'subscriptionName', 'subscription_name']
    const direct     = pickString(sources, directKeys)
    if (direct) {
        return direct
    }
    for (const source of sources) {
        for (const key of ['plan', 'subscription', 'membership']) {
            const record = asRecord(source?.[key])
            if (!record) {
                continue
            }
            const value = kind === 'code' ?
                          pickString([record], ['code', 'id', 'tier', 'slug']) :
                          pickString([record], ['name', 'displayName', 'display_name', 'label'])
            if (value) {
                return value
            }
        }
    }
    return null
}

function parseProductUsage(value: unknown): Array<{ product: string; usagePercent: number | null }> {
    if (!Array.isArray(value)) {
        return []
    }
    return value.flatMap((item, index) => {
        const record = asRecord(item)
        if (!record) {
            return []
        }
        return [
            {
                product: stringValue(record.product) ?? `Product ${index + 1}`,
                usagePercent: normalizePercent(numberValue(record.usage_percent ?? record.usagePercent)),
            },
        ]
    })
}

function parseValueSource(value: unknown): Record<string, string> {
    const record = asRecord(value)
    if (!record) {
        return {}
    }
    return Object.fromEntries(Object.entries(record).flatMap(([key, item]) => {
        const source = stringValue(item)
        return source ? [[key, source]] : []
    }))
}

function parseAuxiliaryErrors(value: unknown): XaiQuotaAuxiliaryError[] {
    if (!Array.isArray(value)) {
        return []
    }
    return value.flatMap((item) => {
        const record = asRecord(item)
        const source = stringValue(record?.source)
        const code   = stringValue(record?.code)
        if (!source || !code) {
            return []
        }
        return [{ source, code, status: numberValue(record?.status) }]
    })
}

function normalizePeriodType(value: string | null): XaiBillingPeriodType {
    const normalized = value?.toLowerCase() ?? ''
    if (normalized.includes('weekly')) {
        return 'weekly'
    }
    if (normalized.includes('monthly')) {
        return 'monthly'
    }
    return 'unknown'
}

function normalizeAmountUnit(value: string | null): XaiAmountUnit {
    switch (value?.trim().toLowerCase()) {
        case 'credit':
        case 'credits':
            return 'credits'
        case 'cent':
        case 'cents':
        case 'currency_minor':
            return 'currency_minor'
        case 'currency':
        case 'currency_major':
        case 'dollar':
        case 'dollars':
            return 'currency_major'
        default:
            return 'unknown'
    }
}

function legacyAmountUnit(sources: Array<Record<string, unknown> | null>): XaiAmountUnit {
    const explicit = normalizeAmountUnit(pickString(sources, ['amount_unit', 'amountUnit', 'unit']))
    if (explicit !== 'unknown') {
        return explicit
    }
    return sources.some((source) => Object.keys(source ?? {}).some((key) => key.toLowerCase().endsWith('cents'))) ?
           'currency_minor' :
           'unknown'
}

function normalizeCurrency(value: string | null): string | null {
    const normalized = value?.trim().toUpperCase() ?? ''
    return /^[A-Z]{3}$/.test(normalized) ? normalized : null
}

function normalizePercent(value: number | null): number | null {
    if (value === null) {
        return null
    }
    return value >= 0 && value <= 1 ? value * 100 : value
}

function percentage(value: number | null, limit: number | null): number | null {
    return value !== null && limit !== null && limit > 0 ? (value / limit) * 100 : null
}

function amountRemaining(limit: number | null, used: number | null): number | null {
    return limit !== null && used !== null ? Math.max(0, limit - used) : null
}

function addAmounts(left: number | null, right: number | null): number | null {
    return left !== null && right !== null ? left + right : null
}

function subtractAmounts(total: number | null, part: number | null): number | null {
    return total !== null && part !== null ? Math.max(0, total - part) : null
}
