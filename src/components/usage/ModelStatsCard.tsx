import { Sheet, type SheetColumn } from '@/components/common/Sheet'
import { Card } from '@/components/ui/Card'
import { useDataStatus } from '@/hooks/useDataStatus'
import styles from '@/pages/UsagePage.module.scss'
import { formatCompactNumber, formatUsd } from '@/utils/usage'
import type { ModelStat } from '@/utils/usage/summaryHelpers'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

interface ModelStatsCardProps {
    modelStats: ModelStat[]
    loading: boolean
    hasPrices: boolean
    nameHeader?: string
    /** Card title override. OverviewTab reuses ModelStatsCard for API Key
     *  aggregates; without this prop the "API Key 统计" pane would still say
     *  "模型统计" at the top — the bug reported as issue 5. */
    cardTitle?: string
}

interface ModelStatWithRate extends ModelStat {
    successRate: number
}

export function ModelStatsCard({ modelStats, loading, hasPrices, nameHeader, cardTitle }: ModelStatsCardProps) {
    const { t } = useTranslation()

    const rows = useMemo(
        (): ModelStatWithRate[] =>
            modelStats.map((stat) => ({
                ...stat,
                successRate: stat.requests > 0 ? (stat.successCount / stat.requests) * 100 : 100,
            })),
        [modelStats]
    )

    const { status } = useDataStatus({
        loading,
        data: rows,
        isEmpty: (data) => data.length === 0,
    })

    const columns = useMemo<SheetColumn<ModelStatWithRate>[]>(() => {
        const items: SheetColumn<ModelStatWithRate>[] = [
            {
                key: 'model',
                header: nameHeader || t('usage_stats.model_name'),
                sortable: true,
                sortValue: (row) => row.model,
                cell: (row) => <span className={styles.modelCell}>{row.model}</span>,
            },
            {
                key: 'requests',
                header: t('usage_stats.requests_count'),
                sortable: true,
                sortValue: (row) => row.requests,
                cell: (row) => (
                    <span className={styles.requestCountCell}>
                        <span>{row.requests.toLocaleString()}</span>
                        <span className={styles.requestBreakdown}>
                            (<span className={styles.statSuccess}>{row.successCount.toLocaleString()}</span>{' '}
                            <span className={styles.statFailure}>{row.failureCount.toLocaleString()}</span>)
                        </span>
                    </span>
                ),
            },
            {
                key: 'tokens',
                header: t('usage_stats.tokens_count'),
                sortable: true,
                sortValue: (row) => row.tokens,
                cell: (row) => formatCompactNumber(row.tokens),
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
        ]
        if (hasPrices) {
            items.push({
                key: 'cost',
                header: t('usage_stats.total_cost'),
                sortable: true,
                sortValue: (row) => row.cost,
                cell: (row) => (row.cost > 0 ? formatUsd(row.cost) : '--'),
            })
        }
        return items
    }, [hasPrices, nameHeader, t])

    return (
        <Card title={cardTitle ?? t('usage_stats.models')} className={styles.detailsFixedCard}>
            <Sheet
                rows={rows}
                columns={columns}
                rowKey={(row) => row.model}
                status={status}
                emptyText={t('usage_stats.no_data')}
                loadingText={t('common.loading')}
                defaultSortKey="requests"
                defaultSortDir="desc"
                refreshing={loading && rows.length > 0}
                refreshingText={t('common.loading')}
            />
        </Card>
    )
}
