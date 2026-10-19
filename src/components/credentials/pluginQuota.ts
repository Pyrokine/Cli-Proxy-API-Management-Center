import type {CredentialField, QuotaItem} from './CredentialCard'
import {resolveResetMs} from '@/utils/quota/resetInstants'

export interface PluginQuotaView {
    plan: string | null
    summary: CredentialField[]
    items: QuotaItem[]
}

export interface PluginQuotaResult {
    identity: string
    payload?: unknown
    lastRefresh?: Date
    loading: boolean
    error?: string
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
    value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null

const text = (value: unknown): string => typeof value === 'string' ? value.trim() : ''

export function parsePluginQuota(value: unknown, language: string): PluginQuotaView {
    const payload = asRecord(value)
    if (!payload) {
        throw new Error('invalid plugin quota response')
    }

    const subscription = asRecord(payload.subscription)
    if (payload.subscription != null && !subscription) {
        throw new Error('invalid plugin quota subscription')
    }
    const plan = text(subscription?.tierName) || text(subscription?.plan) || text(subscription?.tierId) || null
    const summary: CredentialField[] = []
    if (payload.summary != null && !Array.isArray(payload.summary)) {
        throw new Error('invalid plugin quota summary')
    }
    for (const [index, rawMetric] of (payload.summary ?? [] as unknown[]).entries()) {
        const metric = asRecord(rawMetric)
        const key = text(metric?.key)
        const label = text(metric?.label)
        const amount = metric?.value
        if (!metric || !key || !label || typeof amount !== 'number' || !Number.isFinite(amount)) {
            throw new Error('invalid plugin quota metric')
        }
        const unit = text(metric?.unit)
        const currency = text(metric?.currency)
        if (metric?.format !== undefined && metric.format !== 'number' && metric.format !== 'currency') {
            throw new Error('invalid plugin quota metric format')
        }
        if (metric.format === 'currency' && !/^[A-Z]{3}$/.test(currency)) {
            throw new Error('invalid plugin quota currency')
        }
        const formatted = metric.format === 'currency'
                          ? new Intl.NumberFormat(language, {style: 'currency', currency}).format(amount)
                          : new Intl.NumberFormat(language, {maximumFractionDigits: 2}).format(amount)
        summary.push({id: `plugin-metric-${key}-${index}`, label, value: unit ? `${formatted} ${unit}` : formatted})
    }

    const items: QuotaItem[] = []
    if (payload.groups != null && !Array.isArray(payload.groups)) {
        throw new Error('invalid plugin quota groups')
    }
    for (const [groupIndex, rawGroup] of (payload.groups ?? [] as unknown[]).entries()) {
        const group = asRecord(rawGroup)
        if (!group || (group.buckets != null && !Array.isArray(group.buckets))) {
            throw new Error('invalid plugin quota group')
        }
        const groupName = text(group.displayName)
        for (const [bucketIndex, rawBucket] of (group.buckets ?? [] as unknown[]).entries()) {
            const bucket = asRecord(rawBucket)
            const fraction = bucket?.remainingFraction
            if (typeof fraction !== 'number' || !Number.isFinite(fraction) || fraction < 0 || fraction > 1) {
                throw new Error('invalid plugin quota bucket')
            }
            const bucketName = text(bucket?.description) || text(bucket?.window) || text(bucket?.displayName)
            const reset = text(bucket?.resetTime)
            items.push({
                id: `plugin-${groupIndex}-${bucketIndex}`,
                model: [groupName, bucketName].filter(Boolean).join(' · ') || 'Quota',
                percent: Math.round(fraction * 100),
                resetAtMs: reset ? resolveResetMs([reset]) : null,
            })
        }
    }
    if (!plan && summary.length === 0 && items.length === 0) {
        throw new Error('empty plugin quota response')
    }
    return {plan, summary, items}
}
