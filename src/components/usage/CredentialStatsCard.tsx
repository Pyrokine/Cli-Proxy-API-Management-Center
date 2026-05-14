import { Sheet, type SheetColumn } from '@/components/common/Sheet'
import { Card } from '@/components/ui/Card'
import { formatAuthFileDisplayName, inferProviderFromAuthFileName } from '@/features/authFiles/constants'
import { useDataStatus } from '@/hooks/useDataStatus'
import styles from '@/pages/UsagePage.module.scss'
import type { UsageSummary } from '@/services/api/usage'
import type { GeminiKeyConfig, OpenAIProviderConfig, ProviderKeyConfig } from '@/types'
import type { CredentialInfo } from '@/types/sourceInfo'
import {
    buildCandidateUsageSourceIds,
    collectUsageDetails,
    formatCompactNumber,
    normalizeAuthIndex,
} from '@/utils/usage'
import { type SummaryCredentialEntry, summaryToCredentialEntries } from '@/utils/usage/summaryHelpers'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { UsagePayload } from './hooks/useUsageData'

interface CredentialStatsCardProps {
    usage: UsagePayload | null
    loading: boolean
    geminiKeys: GeminiKeyConfig[]
    claudeConfigs: ProviderKeyConfig[]
    codexConfigs: ProviderKeyConfig[]
    vertexConfigs: ProviderKeyConfig[]
    openaiProviders: OpenAIProviderConfig[]
    authFileMap: Map<string, CredentialInfo>
    summary?: UsageSummary | null
    /** Alias dictionary (raw credential source/api-key → user-friendly name).
     *  Without it the "Remaining unmatched" rows would render the raw email
     *  or sk-key instead of the alias the user set in the credentials page. */
    aliases?: Record<string, string>
}

function capitalizeProvider(name: string): string {
    if (!name) {
        return ''
    }
    if (name === 'gemini-cli' || name === 'aistudio') {
        return 'Gemini'
    }
    if (name === 'antigravity') {
        return 'Claude'
    }
    return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase()
}

function formatCredentialDisplay(provider: string, source: string, aliases?: Record<string, string>): string {
    const aliasOrSource = aliases?.[source] || source
    if (provider) {
        return `[${capitalizeProvider(provider)}] ${aliasOrSource}`
    }
    return aliasOrSource
}

function formatCredentialDisplayFromAuthFile(
    file: CredentialInfo | undefined,
    fallbackSource: string,
    aliases?: Record<string, string>
): string {
    if (!file) {
        return formatCredentialDisplay('', fallbackSource, aliases)
    }

    const provider = file.type || inferProviderFromAuthFileName(file.name)
    const source = formatAuthFileDisplayName(file.name) || fallbackSource
    return formatCredentialDisplay(provider, source, aliases)
}

interface CredentialRow {
    key: string
    displayName: string
    type: string
    success: number
    failure: number
    total: number
    successRate: number
}

interface CredentialBucket {
    success: number
    failure: number
    provider?: string
    source?: string
}

export function CredentialStatsCard({
    usage,
    loading,
    geminiKeys,
    claudeConfigs,
    codexConfigs,
    vertexConfigs,
    openaiProviders,
    authFileMap,
    summary,
    aliases,
}: CredentialStatsCardProps) {
    const { t } = useTranslation()

    // Aggregate rows: all from bySource only (no separate byAuthIndex rows to avoid duplicates).
    // Auth files are used purely for name resolution of unmatched source IDs.
    const rows = useMemo((): CredentialRow[] => {
        // Build bySource map: prefer summary.by_credential (covers all history),
        // fall back to collectUsageDetails(usage) (today only)
        const bySource: Record<string, CredentialBucket> = {}
        const summarySourceBuckets: Record<string, CredentialBucket> = {}
        const summaryEntriesBySourceId = new Map<string, SummaryCredentialEntry[]>()
        const result: CredentialRow[] = []
        const consumedSourceIds = new Set<string>()
        const consumedSummaryFilterKeys = new Set<string>()
        const authIndexToRowIndex = new Map<string, number>()
        const sourceToAuthIndex = new Map<string, string>()
        const sourceToAuthFile = new Map<string, CredentialInfo>()
        const fallbackByAuthIndex = new Map<string, CredentialBucket>()

        const summaryCredentials: SummaryCredentialEntry[] = summary?.by_credential
            ? summaryToCredentialEntries(summary.by_credential)
            : []

        if (summaryCredentials.length > 0) {
            summaryCredentials.forEach((entry) => {
                const bucket = summarySourceBuckets[entry.normalizedSourceId] ?? { success: 0, failure: 0 }
                bucket.success += entry.success
                bucket.failure += entry.failure
                summarySourceBuckets[entry.normalizedSourceId] = bucket

                const entries = summaryEntriesBySourceId.get(entry.normalizedSourceId) ?? []
                entries.push(entry)
                summaryEntriesBySourceId.set(entry.normalizedSourceId, entries)
            })
        } else if (usage) {
            // Fall back to client-side aggregation from today's data
            const details = collectUsageDetails(usage)
            details.forEach((detail) => {
                const authIdx = normalizeAuthIndex(detail.auth_index)
                const source = detail.source
                const isFailed = detail.failed

                if (!source) {
                    if (!authIdx) {
                        return
                    }
                    const fallback = fallbackByAuthIndex.get(authIdx) ?? { success: 0, failure: 0 }
                    if (isFailed) {
                        fallback.failure += 1
                    } else {
                        fallback.success += 1
                    }
                    fallbackByAuthIndex.set(authIdx, fallback)
                    return
                }

                const bucket = bySource[source] ?? { success: 0, failure: 0, source }
                if (isFailed) {
                    bucket.failure += 1
                } else {
                    bucket.success += 1
                }
                bySource[source] = bucket

                if (authIdx && !sourceToAuthIndex.has(source)) {
                    sourceToAuthIndex.set(source, authIdx)
                }
                if (authIdx && !sourceToAuthFile.has(source)) {
                    const mapped = authFileMap.get(authIdx)
                    if (mapped) {
                        sourceToAuthFile.set(source, mapped)
                    }
                }
            })
        } else {
            return []
        }

        const mergeBucketToRow = (index: number, bucket: CredentialBucket) => {
            const target = result[index]
            if (!target) {
                return
            }
            target.success += bucket.success
            target.failure += bucket.failure
            target.total = target.success + target.failure
            target.successRate = target.total > 0 ? (target.success / target.total) * 100 : 100
        }

        // Sum success/failure across candidate source IDs, marking each as consumed
        const sumCandidates = (candidates: Iterable<string>): CredentialBucket => {
            let success = 0
            let failure = 0
            for (const id of candidates) {
                const usageBucket = bySource[id]
                if (usageBucket) {
                    success += usageBucket.success
                    failure += usageBucket.failure
                    consumedSourceIds.add(id)
                }

                const summaryBucket = summarySourceBuckets[id]
                if (summaryBucket) {
                    success += summaryBucket.success
                    failure += summaryBucket.failure
                    const entries = summaryEntriesBySourceId.get(id) ?? []
                    entries.forEach((entry) => consumedSummaryFilterKeys.add(entry.filterKey))
                }
            }
            return { success, failure }
        }

        const pushRowIfNonEmpty = (bucket: CredentialBucket, key: string, displayName: string, type: string) => {
            const total = bucket.success + bucket.failure
            if (total > 0) {
                result.push({
                    key,
                    displayName,
                    type,
                    success: bucket.success,
                    failure: bucket.failure,
                    total,
                    successRate: (bucket.success / total) * 100,
                })
            }
        }

        // Aggregate all candidate source IDs for one provider config into a single row
        const addConfigRow = (
            apiKey: string,
            prefix: string | undefined,
            name: string,
            type: string,
            rowKey: string
        ) => {
            const bucket = sumCandidates(buildCandidateUsageSourceIds({ apiKey, prefix }))
            pushRowIfNonEmpty(bucket, rowKey, name, type)
        }

        // Provider rows — one row per config, stats merged across all its candidate source IDs
        geminiKeys.forEach((c, i) =>
            addConfigRow(c.apiKey, c.prefix, c.prefix?.trim() || `Gemini #${i + 1}`, 'gemini', `gemini:${i}`)
        )
        claudeConfigs.forEach((c, i) =>
            addConfigRow(c.apiKey, c.prefix, c.prefix?.trim() || `Claude #${i + 1}`, 'claude', `claude:${i}`)
        )
        codexConfigs.forEach((c, i) =>
            addConfigRow(c.apiKey, c.prefix, c.prefix?.trim() || `Codex #${i + 1}`, 'codex', `codex:${i}`)
        )
        vertexConfigs.forEach((c, i) => {
            addConfigRow(c.apiKey, c.prefix, c.prefix?.trim() || `Vertex #${i + 1}`, 'vertex', `vertex:${i}`)
        })
        // OpenAI compatibility providers — one row per provider,
        // merged across all apiKey entries (prefix counted once).
        openaiProviders.forEach((provider, providerIndex) => {
            const prefix = provider.prefix
            const displayName = prefix?.trim() || provider.name || `OpenAI #${providerIndex + 1}`

            const candidates = new Set<string>()
            buildCandidateUsageSourceIds({ prefix }).forEach((id) => candidates.add(id))
            ;(provider.apiKeyEntries || []).forEach((entry) => {
                buildCandidateUsageSourceIds({ apiKey: entry.apiKey }).forEach((id) => candidates.add(id))
            })

            pushRowIfNonEmpty(sumCandidates(candidates), `openai:${providerIndex}`, displayName, 'openai')
        })

        // Remaining unmatched bySource entries — resolve name from auth files if possible
        Object.entries(bySource).forEach(([key, bucket]) => {
            if (consumedSourceIds.has(key)) {
                return
            }
            const total = bucket.success + bucket.failure
            const authFile = sourceToAuthFile.get(key)
            const displaySource = bucket.source || key
            const row = {
                key,
                displayName: authFile
                    ? formatCredentialDisplayFromAuthFile(authFile, displaySource, aliases)
                    : formatCredentialDisplay(bucket.provider ?? '', displaySource, aliases),
                type: authFile?.type || '',
                success: bucket.success,
                failure: bucket.failure,
                total,
                successRate: total > 0 ? (bucket.success / total) * 100 : 100,
            }
            const rowIndex = result.push(row) - 1
            const authIdx = sourceToAuthIndex.get(key)
            if (authIdx && !authIndexToRowIndex.has(authIdx)) {
                authIndexToRowIndex.set(authIdx, rowIndex)
            }
        })

        summaryCredentials.forEach((entry) => {
            if (consumedSummaryFilterKeys.has(entry.filterKey)) {
                return
            }
            const total = entry.success + entry.failure
            if (total <= 0) {
                return
            }
            const inferredProvider = entry.provider || inferProviderFromAuthFileName(entry.source)
            const normalizedSource = inferredProvider
                ? formatAuthFileDisplayName(entry.source) || entry.source
                : entry.source
            result.push({
                key: entry.filterKey,
                displayName: formatCredentialDisplay(inferredProvider, normalizedSource, aliases),
                type: '',
                success: entry.success,
                failure: entry.failure,
                total,
                successRate: (entry.success / total) * 100,
            })
        })

        // Include requests that have auth_index but missing source.
        fallbackByAuthIndex.forEach((bucket, authIdx) => {
            if (bucket.success + bucket.failure === 0) {
                return
            }

            const mapped = authFileMap.get(authIdx)
            let targetRowIndex = authIndexToRowIndex.get(authIdx)
            if (targetRowIndex === undefined && mapped) {
                const matchedIndex = result.findIndex(
                    (row) => row.displayName === mapped.name && row.type === mapped.type
                )
                if (matchedIndex >= 0) {
                    targetRowIndex = matchedIndex
                    authIndexToRowIndex.set(authIdx, matchedIndex)
                }
            }

            if (targetRowIndex !== undefined) {
                mergeBucketToRow(targetRowIndex, bucket)
                return
            }

            const total = bucket.success + bucket.failure
            const rowIndex =
                result.push({
                    key: `auth:${authIdx}`,
                    displayName: mapped ? formatCredentialDisplayFromAuthFile(mapped, authIdx, aliases) : authIdx,
                    type: mapped?.type || '',
                    success: bucket.success,
                    failure: bucket.failure,
                    total,
                    successRate: (bucket.success / total) * 100,
                }) - 1
            authIndexToRowIndex.set(authIdx, rowIndex)
        })

        return result
    }, [usage, summary, geminiKeys, claudeConfigs, codexConfigs, vertexConfigs, openaiProviders, authFileMap, aliases])

    const { status } = useDataStatus({
        loading,
        data: rows,
        isEmpty: (data) => data.length === 0,
    })

    const columns = useMemo<SheetColumn<CredentialRow>[]>(
        () => [
            {
                key: 'displayName',
                header: t('usage_stats.credential_name'),
                sortable: true,
                sortValue: (row) => row.displayName,
                cell: (row) => (
                    <span className={styles.modelCell}>
                        <span>{row.displayName}</span>
                        {row.type && <span className={styles.credentialType}>{row.type}</span>}
                    </span>
                ),
            },
            {
                key: 'total',
                header: t('usage_stats.requests_count'),
                sortable: true,
                sortValue: (row) => row.total,
                cell: (row) => (
                    <span className={styles.requestCountCell}>
                        <span>{formatCompactNumber(row.total)}</span>
                        <span className={styles.requestBreakdown}>
                            (<span className={styles.statSuccess}>{row.success.toLocaleString()}</span>{' '}
                            <span className={styles.statFailure}>{row.failure.toLocaleString()}</span>)
                        </span>
                    </span>
                ),
            },
            {
                key: 'successRate',
                header: t('usage_stats.success_rate'),
                sortable: true,
                sortValue: (row) => row.successRate,
                cell: (row) => (
                    <span
                        className={
                            row.successRate >= 95
                                ? styles.statSuccess
                                : row.successRate >= 80
                                  ? styles.statNeutral
                                  : styles.statFailure
                        }
                    >
                        {row.successRate.toFixed(1)}%
                    </span>
                ),
            },
        ],
        [t]
    )

    return (
        <Card title={t('usage_stats.credential_stats')} className={styles.detailsFixedCard}>
            <Sheet
                rows={rows}
                columns={columns}
                rowKey={(row) => row.key}
                status={status}
                emptyText={t('usage_stats.no_data')}
                loadingText={t('common.loading')}
                defaultSortKey="total"
                defaultSortDir="desc"
                refreshing={loading && rows.length > 0}
                refreshingText={t('common.loading')}
            />
        </Card>
    )
}
