import type {SummaryApiKeyStats, SummaryCredentialStats, SummaryModelStats} from '@/services/api/usage'
import {maskApiKey} from '@/utils/format'
import {normalizeUsageSourceId} from '@/utils/usage'

export interface ModelStat {
    key?: string
    model: string
    requests: number
    successCount: number
    failureCount: number
    tokens: number
    cost: number
    averageLatencyMs: number | null
    totalLatencyMs?: number | null
    latencySampleCount: number
}

export interface SummaryCredentialEntry {
    key: string
    filterKey: string
    provider: string
    source: string
    sourceKind: 'api_key' | 'identity' | ''
    normalizedSourceId: string
    success: number
    failure: number
}

function splitCredentialKey(key: string): { provider: string; source: string } {
    if (key.startsWith('t:')) {
        return { provider: '', source: key.slice(2) }
    }
    const idx = key.indexOf(':')
    if (idx <= 0 || idx >= key.length - 1) {
        return { provider: '', source: key }
    }
    return {
        provider: key.slice(0, idx),
        source: key.slice(idx + 1),
    }
}

/**
 * Summary credential rows come from multiple schema generations:
 * - v2 rows carry provider/source fields and use a `provider:source` map key
 * - legacy rows only have the bare source key
 * - some older cached payloads may still surface a `t:source` key
 *
 * This helper canonicalizes all of them into one shape so the dropdown,
 * credential stats table and credentials page all consume the same contract.
 */
export function summaryToCredentialEntries(
    byCredential: Record<string, SummaryCredentialStats>,
): SummaryCredentialEntry[] {
    const merged = new Map<string, SummaryCredentialEntry>()

    Object.entries(byCredential).forEach(([key, stats]) => {
        const fallback           = splitCredentialKey(key)
        const provider           = (stats.provider ?? fallback.provider).trim()
        const source             = (stats.source ?? fallback.source).trim()
        const sourceKind         = stats.source_kind ?? ''
        const normalizedSourceId = normalizeUsageSourceId(source)
        if (!source) {
            return
        }

        const filterKey = stats.filter_key?.trim() || (provider ? `${provider}:${source}` : source)
        const existing  = merged.get(filterKey)
        if (existing) {
            existing.success += stats.success
            existing.failure += stats.failure
            return
        }

        merged.set(filterKey, {
            key,
            filterKey,
            provider,
            source,
            sourceKind,
            normalizedSourceId,
            success: stats.success,
            failure: stats.failure,
        })
    })

    return Array.from(merged.values())
}

/** Convert summary by_model to ModelStat[] */
export function summaryToModelStats(byModel: Record<string, SummaryModelStats>): ModelStat[] {
    return Object.entries(byModel).map(([model, stats]) => ({
        model,
        requests: stats.requests,
        successCount: stats.success,
        failureCount: stats.failure,
        tokens: stats.tokens.total,
        cost: stats.cost,
        averageLatencyMs: stats.average_latency_ms ?? null,
        totalLatencyMs: stats.total_latency_ms ?? null,
        latencySampleCount: stats.latency_sample_count ?? 0,
    }))
}

/** Keep API key identity separate from the server-provided alias or safe display. */
export function summaryToApiKeyStats(
    byApiKey: Record<string, SummaryApiKeyStats>,
    aliases?: Record<string, string>,
): ModelStat[] {
    return Object.entries(byApiKey).map(([key, stats]) => ({
        key,
        model: stats.alias?.trim() || aliases?.[key]?.trim() || stats.display_name?.trim() ||
               (key === '(none)' || key.includes('...') || key.includes('****') ? key : maskApiKey(key)),
        requests: stats.requests,
        successCount: stats.success,
        failureCount: stats.failure,
        tokens: stats.tokens.total,
        cost: stats.cost,
        averageLatencyMs: stats.average_latency_ms ?? null,
        totalLatencyMs: stats.total_latency_ms ?? null,
        latencySampleCount: stats.latency_sample_count ?? 0,
    }))
}
