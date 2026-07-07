import {CardSkeleton} from '@/components/common/CardSkeleton'
import {LoadingSpinner} from '@/components/ui/LoadingSpinner'
import pageStyles from '@/pages/UsagePage.module.scss'
import type {UsageSummary} from '@/services/api/usage'
import {formatUnixTimestamp} from '@/utils/format'
import {
    buildChartDataFromSummary,
    buildTokenBreakdownChartData,
    type ChartDimension,
    formatCompactNumber,
    formatUsd,
    getSummaryDataStart,
    type TokenCategory,
} from '@/utils/usage'
import {buildChartOptions, getHourChartMinWidth} from '@/utils/usage/chartConfig'
import type {ChartOptions} from 'chart.js'
import {useCallback, useMemo, useState} from 'react'
import {Line} from 'react-chartjs-2'
import {useTranslation} from 'react-i18next'
import styles from './UnifiedTrendChart.module.scss'

type Metric = 'requests' | 'tokens' | 'cost' | 'token_breakdown'

interface UnifiedTrendChartProps {
    summary: UsageSummary | null
    liveSummary?: UsageSummary | null
    loading: boolean
    error?: string
    chartDimension: ChartDimension
    isMobile?: boolean
    /** When set, renders a single metric without tab switcher. */
    metric?: Metric
}

// Per-metric accent: border tints the dot in the metric title and feeds the
// soft radial backdrop so side-by-side cards are visually distinguishable at a
// glance. Colors come from upstream commit 2bcaf15 where the three-card
// layout was introduced.
const METRIC_ACCENTS: Record<Metric, { border: string; soft: string; labelKey: string }> = {
    requests: { border: '#8b8680', soft: 'rgba(139, 134, 128, 0.14)', labelKey: 'usage_stats.requests_trend' },
    tokens: { border: '#8b5cf6', soft: 'rgba(139, 92, 246, 0.14)', labelKey: 'usage_stats.tokens_trend' },
    cost: { border: '#f59e0b', soft: 'rgba(245, 158, 11, 0.14)', labelKey: 'usage_stats.cost_trend' },
    token_breakdown: { border: '#8b5cf6', soft: 'rgba(139, 92, 246, 0.14)', labelKey: 'usage_stats.token_breakdown' },
}

export function UnifiedTrendChart({
                                      summary,
                                      liveSummary,
                                      loading,
                                      error,
                                      chartDimension,
                                      isMobile = false,
                                      metric: fixedMetric,
                                  }: UnifiedTrendChartProps) {
    const { t, i18n }                         = useTranslation()
    const [internalMetric, setInternalMetric] = useState<Metric>('requests')
    const metric                              = fixedMetric ?? internalMetric
    const [hiddenIndices, setHiddenIndices]   = useState<Set<number>>(new Set())

    const handleMetricChange = useCallback((next: Metric) => {
        setInternalMetric(next)
        setHiddenIndices(new Set())
    }, [])

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

    const period = useMemo<'hour' | 'day'>(() => {
        const ts = summary?.time_series
        if (ts && ts.length >= 2) {
            const t0 = new Date(ts[0].time).getTime()
            const t1 = new Date(ts[1].time).getTime()
            return t1 - t0 >= 20 * 3600_000 ? 'day' : 'hour'
        }
        return 'hour'
    }, [summary])

    const chartData = useMemo(() => {
        if (!summary) {
            return { labels: [], datasets: [] }
        }
        if (metric === 'token_breakdown') {
            const categoryLabels: Record<TokenCategory, string> = {
                input: t('usage_stats.input_tokens'),
                output: t('usage_stats.output_tokens'),
                cached: t('usage_stats.cached_tokens'),
                reasoning: t('usage_stats.reasoning_tokens'),
            }
            return buildTokenBreakdownChartData(summary, categoryLabels)
        }
        return buildChartDataFromSummary(summary, metric, chartDimension)
    }, [summary, metric, chartDimension, t])

    // For the cost card we still want a flat 0 sparkline (parity with requests/
    // tokens) when no priced points exist, so emptiness is signaled by a small
    // header note rather than a full hint replacing the chart.
    const noCostNote = useMemo(() => {
        if (metric !== 'cost') {
            return ''
        }
        const hasAny = !!summary?.time_series?.some((pt) => pt.has_cost)
        return hasAny ? '' : t('usage_stats.cost_no_data')
    }, [metric, summary, t])

    const summaryValues = useMemo(() => {
        const zero = metric === 'cost' ? formatUsd(0) : formatCompactNumber(0)
        const fmt  = (v: number) => (metric === 'cost' ? formatUsd(v) : formatCompactNumber(v))

        const totalOf = (source: UsageSummary | null | undefined) => {
            const totals = source?.totals
            if (!totals) {
                return 0
            }
            if (metric === 'requests') {
                return totals.requests
            }
            if (metric === 'tokens' || metric === 'token_breakdown') {
                return totals.tokens.total
            }
            return totals.cost
        }

        const ts  = summary?.time_series ?? []
        const val = (pt: (typeof ts)[number]) => {
            if (!pt) {
                return 0
            }
            if (metric === 'requests') {
                return pt.requests
            }
            if (metric === 'tokens' || metric === 'token_breakdown') {
                return typeof pt.tokens === 'number' ? pt.tokens : (pt.tokens?.total ?? 0)
            }
            return pt.has_cost ? (pt.cost ?? 0) : 0
        }

        let liveSum = totalOf(liveSummary)
        if (!liveSummary && ts.length) {
            const oneHourAgoMs = Date.now() - 3600_000
            for (let i = ts.length - 1; i >= 0; --i) {
                const ptTime = new Date(ts[i].time).getTime()
                if (ptTime < oneHourAgoMs) {
                    break
                }
                liveSum += val(ts[i])
            }
        }

        return { total: summary ? fmt(totalOf(summary)) : zero, live: fmt(liveSum) }
    }, [summary, liveSummary, metric])

    // "Data starts at": earliest point in the series, shown in the card header
    // so users understand why trailing gaps exist for long date ranges.
    const dataStartLabel = useMemo(() => {
        const earliest = getSummaryDataStart(summary)
        if (!earliest) {
            return ''
        }
        const full = formatUnixTimestamp(earliest.getTime(), i18n.language)
        return full ? (full.split(' ')[0] ?? full) : ''
    }, [summary, i18n.language])

    const chartOptions = useMemo((): ChartOptions<'line'> => {
        const base = buildChartOptions({ period, labels: chartData.labels, isMobile })
        if (metric === 'token_breakdown') {
            return {
                ...base,
                scales: {
                    ...base.scales,
                    y: { ...base.scales?.y, stacked: true },
                    x: { ...base.scales?.x, stacked: true },
                },
            }
        }
        if (metric !== 'cost') {
            return base
        }
        return {
            ...base,
            scales: {
                ...base.scales,
                y: {
                    ...base.scales?.y,
                    ticks: {
                        ...(base.scales?.y && 'ticks' in base.scales.y ? base.scales.y.ticks : {}),
                        callback: (value: string | number) => formatUsd(Number(value)),
                    },
                },
            },
        }
    }, [period, chartData.labels, isMobile, metric])

    // Empty series renders a flat zero line so the card keeps its visual rhythm
    // instead of collapsing. spanGaps:false draws real gaps for null points.
    const visibleChartData = useMemo(() => {
        if (chartData.labels.length === 0) {
            const accent = METRIC_ACCENTS[metric]
            return {
                labels: ['', ''],
                datasets: [
                    {
                        label: '',
                        data: [0, 0],
                        borderColor: accent.border,
                        backgroundColor: accent.soft,
                        pointRadius: 0,
                        fill: true,
                        tension: 0,
                        spanGaps: false,
                    },
                ],
            }
        }
        return {
            labels: chartData.labels,
            datasets: chartData.datasets.map((ds, i) => ({
                ...ds,
                hidden: hiddenIndices.has(i),
                spanGaps: false,
            })),
        }
    }, [chartData, hiddenIndices, metric])

    const metricTabs: Array<{ key: Exclude<Metric, 'token_breakdown'>; label: string }> = [
        { key: 'requests', label: t('usage_stats.requests_trend') },
        { key: 'tokens', label: t('usage_stats.tokens_trend') },
        { key: 'cost', label: t('usage_stats.cost_trend') },
    ]

    const isEmpty     = chartData.labels.length === 0
    const accent      = METRIC_ACCENTS[metric]
    const metricLabel = t(accent.labelKey)

    // First-load skeleton: show only when there's no prior data — refreshes
    // keep the old chart visible so users don't see a flash on every filter
    // change.
    if (loading && !summary) {
        return (
            <div className={styles.container}>
                <div className={styles.headerFixed}>
                    <span className={styles.metricTitle} style={{ color: accent.border }}>
                        {metricLabel}
                    </span>
                </div>
                <div className={styles.trendLoadingShell}>
                    <div className={styles.trendLoadingSummary}>
                        <div className={styles.trendLoadingPrimary} />
                        <div className={styles.trendLoadingSecondary} />
                    </div>
                    <CardSkeleton variant='chart' rowCount={1} showTitle={false} className={styles.trendLoadingChart} />
                </div>
            </div>
        )
    }

    if (error && !summary) {
        return (
            <div className={styles.container}>
                <div className={pageStyles.hint}>{error}</div>
            </div>
        )
    }

    return (
        <div className={styles.container}>
            <div
                className={styles.accentBackdrop}
                style={{ background: `radial-gradient(ellipse at top right, ${accent.soft} 0%, transparent 55%)` }}
            />

            {!fixedMetric ? (
                <div className={styles.header}>
                    <div className={styles.metricTabs}>
                        {metricTabs.map(({ key, label }) => (
                            <button
                                key={key}
                                type='button'
                                className={`${styles.metricTab} ${metric === key ? styles.metricTabActive : ''}`}
                                onClick={() => handleMetricChange(key)}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                </div>
            ) : (
                 <div className={styles.headerFixed}>
                    <span className={styles.metricTitle} style={{ color: accent.border }}>
                        {metricLabel}
                    </span>
                     {dataStartLabel && (
                         <span className={styles.dataStartsAt}>
                            {t('usage_stats.data_starts_at', { date: dataStartLabel, defaultValue: 'Starts {{date}}' })}
                        </span>
                     )}
                 </div>
             )}

            <div className={pageStyles.cardLoadingShell}>
                {loading && summary && (
                    <div className={pageStyles.cardLoadingOverlay} aria-busy='true'>
                        <div className={pageStyles.cardLoadingPill}>
                            <LoadingSpinner size={16} className={pageStyles.cardLoadingSpinner} />
                            <span>{t('common.loading')}</span>
                        </div>
                    </div>
                )}
                <>
                    <div className={styles.summaryBar}>
                        <span className={styles.summaryTotal}>
                            {summaryValues.total}
                            <span className={styles.summaryLabel}>{t('usage_stats.unified_total_label')}</span>
                        </span>
                        <span className={styles.summaryLive}>
                            <span className={styles.liveDot} />
                            {summaryValues.live}
                            <span className={styles.summaryLabel}>{t('usage_stats.unified_latest_label')}</span>
                        </span>
                        {noCostNote && (
                            <span className={styles.dataStartsAt} style={{ marginLeft: 'auto' }}>
                                {noCostNote}
                            </span>
                        )}
                    </div>

                    <div className={styles.chartBody}>
                        <div className={pageStyles.chartWrapper}>
                            {chartData.datasets.length > 1 && (
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
                            )}
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
                    {isEmpty && <div className={styles.emptyHint}>{t('usage_stats.no_data')}</div>}
                </>
            </div>
        </div>
    )
}
