import type { SummaryApiKeyStats, SummaryCredentialStats, SummaryModelStats } from '@/services/api/usage'
import { normalizeUsageSourceId } from '@/utils/usage'

export interface ModelStat {
    model: string
    requests: number
    successCount: number
    failureCount: number
    tokens: number
    cost: number
}

export interface SummaryCredentialEntry {
    key: string
    filterKey: string
    provider: string
    source: string
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
    byCredential: Record<string, SummaryCredentialStats>
): SummaryCredentialEntry[] {
    const merged = new Map<string, SummaryCredentialEntry>()
    const providerSources = new Set<string>()
    const pendingLegacy: Array<{
        key: string
        stats: SummaryCredentialStats
        source: string
        normalizedSourceId: string
    }> = []

    Object.entries(byCredential).forEach(([key, stats]) => {
        const fallback = splitCredentialKey(key)
        const provider = (stats.provider ?? fallback.provider).trim()
        const source = (stats.source ?? fallback.source).trim()
        if (!source) {
            return
        }

        const normalizedSourceId = normalizeUsageSourceId(source)
        if (provider) {
            providerSources.add(normalizedSourceId)
            const filterKey = `${provider}:${source}`
            const existing = merged.get(filterKey)
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
                normalizedSourceId,
                success: stats.success,
                failure: stats.failure,
            })
            return
        }

        pendingLegacy.push({ key, stats, source, normalizedSourceId })
    })

    pendingLegacy.forEach(({ key, stats, source, normalizedSourceId }) => {
        if (providerSources.has(normalizedSourceId)) {
            return
        }

        const filterKey = source
        const existing = merged.get(filterKey)
        if (existing) {
            existing.success += stats.success
            existing.failure += stats.failure
            return
        }

        merged.set(filterKey, {
            key,
            filterKey,
            provider: '',
            source,
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
    }))
}

/** Convert summary by_api_key to ModelStat[]. Reuses the ModelStat shape so
 *  the existing ModelStatsCard can render API-key rows with a different header.
 *  The alias map lets us show human-friendly names while keeping raw keys as
 *  the lookup id; falling back to the raw key preserves stability when an
 *  alias is missing. */
export function summaryToApiKeyStats(
    byApiKey: Record<string, SummaryApiKeyStats>,
    aliases?: Record<string, string>
): ModelStat[] {
    return Object.entries(byApiKey).map(([key, stats]) => ({
        model: aliases?.[key] || key,
        requests: stats.requests,
        successCount: stats.success,
        failureCount: stats.failure,
        tokens: stats.tokens.total,
        cost: stats.cost,
    }))
}
