import {Card} from '@/components/ui/Card'
import styles from '@/pages/UsagePage.module.scss'
import type {UsageSummary} from '@/services/api/usage'
import type {GeminiKeyConfig, OpenAIProviderConfig, ProviderKeyConfig} from '@/types'
import type {CredentialInfo} from '@/types/sourceInfo'
import {
    buildCandidateUsageSourceIds,
    collectUsageDetails,
    formatCompactNumber,
    normalizeAuthIndex,
} from '@/utils/usage'
import {useCallback, useMemo, useState} from 'react'
import {useTranslation} from 'react-i18next'
import type {UsagePayload} from './hooks/useUsageData'

interface CredentialStatsCardProps {
    usage: UsagePayload | null;
    loading: boolean;
    geminiKeys: GeminiKeyConfig[];
    claudeConfigs: ProviderKeyConfig[];
    codexConfigs: ProviderKeyConfig[];
    vertexConfigs: ProviderKeyConfig[];
    openaiProviders: OpenAIProviderConfig[];
    authFileMap: Map<string, CredentialInfo>;
    summary?: UsageSummary | null;
}

interface CredentialRow {
    key: string;
    displayName: string;
    type: string;
    success: number;
    failure: number;
    total: number;
    successRate: number;
}

interface CredentialBucket {
    success: number;
    failure: number;
}

type CredSortField = 'displayName' | 'total' | 'successRate';
type CredSortDir = 'asc' | 'desc';

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
                                    }: CredentialStatsCardProps) {
    const { t }                     = useTranslation()
    const [sortField, setSortField] = useState<CredSortField>('total')
    const [sortDir, setSortDir]     = useState<CredSortDir>('desc')

    // Aggregate rows: all from bySource only (no separate byAuthIndex rows to avoid duplicates).
    // Auth files are used purely for name resolution of unmatched source IDs.
    const rows = useMemo((): CredentialRow[] => {
        // Build bySource map: prefer summary.by_credential (covers all history),
        // fall back to collectUsageDetails(usage) (today only)
        const bySource: Record<string, CredentialBucket> = {}
        const result: CredentialRow[]                    = []
        const consumedSourceIds                          = new Set<string>()
        const authIndexToRowIndex                        = new Map<string, number>()
        const sourceToAuthIndex                          = new Map<string, string>()
        const sourceToAuthFile                           = new Map<string, CredentialInfo>()
        const fallbackByAuthIndex                        = new Map<string, CredentialBucket>()

        const hasSummaryCredentials = summary?.by_credential && Object.keys(summary.by_credential).length > 0

        if (hasSummaryCredentials) {
            // Use pre-aggregated by_credential from summary API
            for (const [source, stats] of Object.entries(summary!.by_credential)) {
                bySource[source] = { success: stats.success, failure: stats.failure }
            }
        } else if (usage) {
            // Fall back to client-side aggregation from today's data
            const details = collectUsageDetails(usage)
            details.forEach((detail) => {
                const authIdx  = normalizeAuthIndex(detail.auth_index)
                const source   = detail.source
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

                const bucket = bySource[source] ?? { success: 0, failure: 0 }
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
            target.total       = target.success + target.failure
            target.successRate = target.total > 0 ? (target.success / target.total) * 100 : 100
        }

        // Sum success/failure across candidate source IDs, marking each as consumed
        const sumCandidates = (candidates: Iterable<string>): CredentialBucket => {
            let success = 0
            let failure = 0
            for (const id of candidates) {
                const bucket = bySource[id]
                if (bucket) {
                    success += bucket.success
                    failure += bucket.failure
                    consumedSourceIds.add(id)
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
            rowKey: string,
        ) => {
            const bucket = sumCandidates(buildCandidateUsageSourceIds({ apiKey, prefix }))
            pushRowIfNonEmpty(bucket, rowKey, name, type)
        }

        // Provider rows — one row per config, stats merged across all its candidate source IDs
        geminiKeys.forEach((c, i) =>
                               addConfigRow(
                                   c.apiKey,
                                   c.prefix,
                                   c.prefix?.trim() || `Gemini #${i + 1}`,
                                   'gemini',
                                   `gemini:${i}`,
                               ),
        )
        claudeConfigs.forEach((c, i) =>
                                  addConfigRow(
                                      c.apiKey,
                                      c.prefix,
                                      c.prefix?.trim() || `Claude #${i + 1}`,
                                      'claude',
                                      `claude:${i}`,
                                  ),
        )
        codexConfigs.forEach((c, i) =>
                                 addConfigRow(
                                     c.apiKey,
                                     c.prefix,
                                     c.prefix?.trim() || `Codex #${i + 1}`,
                                     'codex',
                                     `codex:${i}`,
                                 ),
        )
        vertexConfigs.forEach((c, i) =>
                                  addConfigRow(
                                      c.apiKey,
                                      c.prefix,
                                      c.prefix?.trim() || `Vertex #${i + 1}`,
                                      'vertex',
                                      `vertex:${i}`,
                                  ),
        )
        // OpenAI compatibility providers — one row per provider, merged across all apiKey entries (prefix counted once).
        openaiProviders.forEach((provider, providerIndex) => {
            const prefix      = provider.prefix
            const displayName = prefix?.trim() || provider.name || `OpenAI #${providerIndex + 1}`

            const candidates = new Set<string>()
            buildCandidateUsageSourceIds({ prefix }).forEach((id) => candidates.add(id));
            (provider.apiKeyEntries || []).forEach((entry) => {
                buildCandidateUsageSourceIds({ apiKey: entry.apiKey }).forEach((id) => candidates.add(id))
            })

            pushRowIfNonEmpty(sumCandidates(candidates), `openai:${providerIndex}`, displayName, 'openai')
        })

        // Remaining unmatched bySource entries — resolve name from auth files if possible
        Object.entries(bySource).forEach(([key, bucket]) => {
            if (consumedSourceIds.has(key)) {
                return
            }
            const total    = bucket.success + bucket.failure
            const authFile = sourceToAuthFile.get(key)
            const row      = {
                key,
                displayName: authFile?.name || (key.startsWith('t:') ? key.slice(2) : key),
                type: authFile?.type || '',
                success: bucket.success,
                failure: bucket.failure,
                total,
                successRate: total > 0 ? (bucket.success / total) * 100 : 100,
            }
            const rowIndex = result.push(row) - 1
            const authIdx  = sourceToAuthIndex.get(key)
            if (authIdx && !authIndexToRowIndex.has(authIdx)) {
                authIndexToRowIndex.set(authIdx, rowIndex)
            }
        })

        // Include requests that have auth_index but missing source.
        fallbackByAuthIndex.forEach((bucket, authIdx) => {
            if (bucket.success + bucket.failure === 0) {
                return
            }

            const mapped       = authFileMap.get(authIdx)
            let targetRowIndex = authIndexToRowIndex.get(authIdx)
            if (targetRowIndex === undefined && mapped) {
                const matchedIndex = result.findIndex((row) => row.displayName ===
                                                               mapped.name &&
                                                               row.type ===
                                                               mapped.type)
                if (matchedIndex >= 0) {
                    targetRowIndex = matchedIndex
                    authIndexToRowIndex.set(authIdx, matchedIndex)
                }
            }

            if (targetRowIndex !== undefined) {
                mergeBucketToRow(targetRowIndex, bucket)
                return
            }

            const total    = bucket.success + bucket.failure
            const rowIndex =
                      result.push({
                                      key: `auth:${authIdx}`,
                                      displayName: mapped?.name || authIdx,
                                      type: mapped?.type || '',
                                      success: bucket.success,
                                      failure: bucket.failure,
                                      total,
                                      successRate: (bucket.success / total) * 100,
                                  }) - 1
            authIndexToRowIndex.set(authIdx, rowIndex)
        })

        return result
    }, [usage, summary, geminiKeys, claudeConfigs, codexConfigs, vertexConfigs, openaiProviders, authFileMap])

    const sortedRows = useMemo(() => {
        const sorted = [...rows]
        sorted.sort((a, b) => {
            let cmp: number
            if (sortField === 'displayName') {
                cmp = a.displayName.localeCompare(b.displayName)
            } else {
                cmp = a[sortField] - b[sortField]
            }
            return sortDir === 'asc' ? cmp : -cmp
        })
        return sorted
    }, [rows, sortField, sortDir])

    const handleSort = useCallback((field: CredSortField) => {
        setSortField((prev) => {
            if (prev === field) {
                setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
            } else {
                setSortDir(field === 'displayName' ? 'asc' : 'desc')
            }
            return field
        })
    }, [])

    const sortArrow = (field: CredSortField) => {
        if (sortField !== field) {
            return ''
        }
        return sortDir === 'asc' ? ' ↑' : ' ↓'
    }

    const renderSortableHeader = (field: CredSortField, label: string) => (
        <th
            className={styles.sortableHeader}
            onClick={() => handleSort(field)}
            aria-sort={sortField === field ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
        >
            {label}
            {sortArrow(field)}
        </th>
    )

    return (
        <Card title={t('usage_stats.credential_stats')} className={styles.detailsFixedCard}>
            {loading ? (
                <div className={styles.hint}>{t('common.loading')}</div>
            ) : rows.length > 0 ? (
                <div className={styles.detailsScroll}>
                    <div className={styles.tableWrapper}>
                        <table className={styles.table}>
                            <thead>
                            <tr>
                                {renderSortableHeader('displayName', t('usage_stats.credential_name'))}
                                {renderSortableHeader('total', t('usage_stats.requests_count'))}
                                {renderSortableHeader('successRate', t('usage_stats.success_rate'))}
                            </tr>
                            </thead>
                            <tbody>
                            {sortedRows.map((row) => (
                                <tr key={row.key}>
                                    <td className={styles.modelCell}>
                                        <span>{row.displayName}</span>
                                        {row.type && <span className={styles.credentialType}>{row.type}</span>}
                                    </td>
                                    <td>
                      <span className={styles.requestCountCell}>
                        <span>{formatCompactNumber(row.total)}</span>
                        <span className={styles.requestBreakdown}>
                          (<span className={styles.statSuccess}>{row.success.toLocaleString()}</span>{' '}
                            <span className={styles.statFailure}>{row.failure.toLocaleString()}</span>)
                        </span>
                      </span>
                                    </td>
                                    <td>
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
                                    </td>
                                </tr>
                            ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            ) : (
                    <div className={styles.hint}>{t('usage_stats.no_data')}</div>
                )}
        </Card>
    )
}
