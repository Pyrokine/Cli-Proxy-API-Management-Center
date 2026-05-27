import {CardSkeleton} from '@/components/common/CardSkeleton'
import {Card} from '@/components/ui/Card'
import {LoadingSpinner} from '@/components/ui/LoadingSpinner'
import pageStyles from '@/pages/UsagePage.module.scss'
import type {SummaryTimePoint, UsageSummary} from '@/services/api/usage'
import {formatUnixTimestamp} from '@/utils/format'
import type {TokenCategory} from '@/utils/usage'
import {buildChartOptions, getHourChartMinWidth} from '@/utils/usage/chartConfig'
import {useCallback, useMemo, useState} from 'react'
import {Line} from 'react-chartjs-2'
import {useTranslation} from 'react-i18next'

const TOKEN_COLORS: Record<TokenCategory, { border: string; bg: string }> = {
    input: { border: '#8b8680', bg: 'rgba(139, 134, 128, 0.25)' },
    output: { border: '#10b981', bg: 'rgba(16, 185, 129, 0.25)' },
    cached: { border: '#f59e0b', bg: 'rgba(245, 158, 11, 0.25)' },
    reasoning: { border: '#8b5cf6', bg: 'rgba(139, 92, 246, 0.25)' },
}

const CATEGORIES: TokenCategory[] = ['input', 'output', 'cached', 'reasoning']

interface TokenBreakdownChartProps {
    summary: UsageSummary | null
    loading: boolean
    isMobile: boolean
}

interface TokenBreakdownSeries {
    labels: string[]
    dataByCategory: Record<TokenCategory, number[]>
    period: 'hour' | 'day'
}

/**
 * Extract per-category token counts from summary.time_series so the chart
 * reacts to the top-level date-range + dimension filters applied upstream.
 * Previously this component read from the raw `usage` payload, which ignored
 * the summary filters and left the chart stuck on unfiltered data.
 */
function buildTokenBreakdownFromSummary(summary: UsageSummary | null): TokenBreakdownSeries {
    const empty: TokenBreakdownSeries = {
        labels: [],
        dataByCategory: { input: [], output: [], cached: [], reasoning: [] },
        period: 'hour',
    }
    const ts                          = summary?.time_series
    if (!ts?.length) {
        return empty
    }

    const period: 'hour' | 'day' = (() => {
        if (ts.length < 2) {
            return 'hour'
        }
        const t0 = new Date(ts[0].time).getTime()
        const t1 = new Date(ts[1].time).getTime()
        return t1 - t0 >= 20 * 3600_000 ? 'day' : 'hour'
    })()

    const formatLabel = (iso: string): string => {
        const d = new Date(iso)
        if (Number.isNaN(d.getTime())) {
            return iso
        }
        const full = formatUnixTimestamp(d.getTime())
        if (!full) {
            return iso
        }
        const [datePart = full, timePart = full] = full.split(' ')
        if (period === 'day') {
            const dateBits = datePart.split('/')
            return dateBits.length >= 3 ? `${dateBits[1]}/${dateBits[2]}` : datePart
        }
        return timePart.slice(0, 5)
    }

    const labels: string[]                                = ts.map((pt: SummaryTimePoint) => formatLabel(pt.time))
    const dataByCategory: Record<TokenCategory, number[]> = {
        input: [],
        output: [],
        cached: [],
        reasoning: [],
    }
    for (const pt of ts) {
        const tokens =
                  typeof pt.tokens === 'object' && pt.tokens
                  ? pt.tokens
                  : { input: 0, output: 0, cached: 0, reasoning: 0, total: 0 }
        dataByCategory.input.push(tokens.input ?? 0)
        dataByCategory.output.push(tokens.output ?? 0)
        dataByCategory.cached.push(tokens.cached ?? 0)
        dataByCategory.reasoning.push(tokens.reasoning ?? 0)
    }

    return { labels, dataByCategory, period }
}

export function TokenBreakdownChart({ summary, loading, isMobile }: TokenBreakdownChartProps) {
    const { t }                             = useTranslation()
    const [hiddenIndices, setHiddenIndices] = useState<Set<number>>(new Set())

    const toggleDataset = useCallback((index: number) => {
        setHiddenIndices((prev) => {
            const next = new Set(prev)
            if (next.has(index)) {
                next.delete(index)
            } else {
                next.add(index)
            }
            return next
        })
    }, [])

    const { chartData, chartOptions, period, isEmpty } = useMemo(() => {
        const series                                        = buildTokenBreakdownFromSummary(summary)
        const categoryLabels: Record<TokenCategory, string> = {
            input: t('usage_stats.input_tokens'),
            output: t('usage_stats.output_tokens'),
            cached: t('usage_stats.cached_tokens'),
            reasoning: t('usage_stats.reasoning_tokens'),
        }

        const data = {
            labels: series.labels,
            datasets: CATEGORIES.map((cat) => ({
                label: categoryLabels[cat],
                data: series.dataByCategory[cat],
                borderColor: TOKEN_COLORS[cat].border,
                backgroundColor: TOKEN_COLORS[cat].bg,
                pointBackgroundColor: TOKEN_COLORS[cat].border,
                pointBorderColor: TOKEN_COLORS[cat].border,
                pointRadius: 0,
                fill: true,
                tension: 0.35,
                spanGaps: false,
            })),
        }

        const baseOptions = buildChartOptions({ period: series.period, labels: series.labels, isMobile })
        const options     = {
            ...baseOptions,
            scales: {
                ...baseOptions.scales,
                y: { ...baseOptions.scales?.y, stacked: true },
                x: { ...baseOptions.scales?.x, stacked: true },
            },
        }

        return {
            chartData: data,
            chartOptions: options,
            period: series.period,
            isEmpty: series.labels.length === 0,
        }
    }, [summary, isMobile, t])

    const visibleChartData = useMemo(
        () => ({
            labels: chartData.labels,
            datasets: chartData.datasets.map((ds, i) => ({ ...ds, hidden: hiddenIndices.has(i) })),
        }),
        [chartData, hiddenIndices],
    )

    return (
        <Card title={t('usage_stats.token_breakdown')}>
            {loading && !summary ? (
                <CardSkeleton variant='rows' rowCount={4} showTitle={false} />
            ) : isEmpty ? (
                <div className={pageStyles.hint}>{t('usage_stats.no_data')}</div>
            ) : (
                    <div className={pageStyles.cardLoadingShell}>
                        {loading && summary && (
                            <div className={pageStyles.cardLoadingOverlay} aria-busy='true'>
                                <div className={pageStyles.cardLoadingPill}>
                                    <LoadingSpinner size={16} className={pageStyles.cardLoadingSpinner} />
                                    <span>{t('common.loading')}</span>
                                </div>
                            </div>
                        )}
                        <div className={pageStyles.chartWrapper}>
                            <div className={pageStyles.chartLegend} aria-label='Chart legend'>
                                {chartData.datasets.map((dataset, index) => (
                                    <div
                                        key={`${dataset.label}-${index}`}
                                        className={`${pageStyles.legendItem} ${
                                            hiddenIndices.has(index) ? pageStyles.legendItemHidden : ''
                                        }`}
                                        title={dataset.label}
                                        role='button'
                                        tabIndex={0}
                                        onClick={() => toggleDataset(index)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' || e.key === ' ') {
                                                e.preventDefault()
                                                toggleDataset(index)
                                            }
                                        }}
                                    >
                                    <span
                                        className={pageStyles.legendDot}
                                        style={{ backgroundColor: dataset.borderColor }}
                                    />
                                        <span className={pageStyles.legendLabel}>{dataset.label}</span>
                                    </div>
                                ))}
                            </div>
                            <div className={pageStyles.chartArea}>
                                <div className={pageStyles.chartScroller}>
                                    <div
                                        className={pageStyles.chartCanvas}
                                        style={
                                            period === 'hour'
                                            ? { minWidth: getHourChartMinWidth(chartData.labels.length, isMobile) }
                                            : undefined
                                        }
                                    >
                                        <Line data={visibleChartData} options={chartOptions} />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
        </Card>
    )
}
