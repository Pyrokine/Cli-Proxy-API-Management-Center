import {BusyOverlay} from '@/components/common/BusyOverlay'
import {CardSkeleton} from '@/components/common/CardSkeleton'
import pageStyles from '@/pages/UsagePage.module.scss'
import type {UsageSummary} from '@/services/api/usage'
import {useTimezoneStore} from '@/stores/useTimezoneStore'
import {formatUnixTimestamp} from '@/utils/format'
import {
    buildChartDataFromSummary,
    buildTokenBreakdownChartData,
    type ChartDimension,
    formatCompactNumber,
    formatUsd,
    getSummaryDataStart,
    METRIC_COLORS,
    type TokenCategory,
} from '@/utils/usage'
import {buildChartOptions, getHourChartMinWidth} from '@/utils/usage/chartConfig'
import {summaryToApiKeyStats} from '@/utils/usage/summaryHelpers'
import type {ChartOptions} from 'chart.js'
import {type CSSProperties, useCallback, useMemo, useState} from 'react'
import {Line} from 'react-chartjs-2'
import {useTranslation} from 'react-i18next'
import styles from './UnifiedTrendChart.module.scss'

type Metric = 'requests' | 'tokens' | 'cost' | 'token_breakdown'

interface UnifiedTrendChartProps {
    summary: UsageSummary | null
    liveSummary?: UsageSummary | null
    aliases?: Record<string, string>
    loading: boolean
    error?: string
    chartDimension: ChartDimension
    isMobile?: boolean
    /** When set, renders a single metric without tab switcher. */
    metric?: Metric
}

// 同一指标的曲线、标题圆点与背景共用配色
const METRIC_ACCENTS: Record<Metric, { border: string; soft: string; labelKey: string }> = {
    requests: { ...METRIC_COLORS.requests, labelKey: 'usage_stats.requests_trend' },
    tokens: { ...METRIC_COLORS.tokens, labelKey: 'usage_stats.tokens_trend' },
    cost: { ...METRIC_COLORS.cost, labelKey: 'usage_stats.cost_trend' },
    token_breakdown: { ...METRIC_COLORS.tokens, labelKey: 'usage_stats.token_breakdown' },
}

export function UnifiedTrendChart({
                                      summary,
                                      liveSummary,
                                      aliases,
                                      loading,
                                      error,
                                      chartDimension,
                                      isMobile = false,
                                      metric: fixedMetric,
                                  }: UnifiedTrendChartProps) {
    const timezone                            = useTimezoneStore((state) => state.timezone)
    const { t, i18n }                         = useTranslation()
    const [internalMetric, setInternalMetric] = useState<Metric>('requests')
    const metric                              = fixedMetric ?? internalMetric
    const [hiddenSeries, setHiddenSeries]     = useState<Set<string>>(new Set())

    const handleMetricChange = useCallback((next: Metric) => {
        setInternalMetric(next)
        setHiddenSeries(new Set())
    }, [])

    const toggleDataset = useCallback((key: string) => {
        setHiddenSeries((prev) => {
            const next = new Set(prev)
            if (next.has(key)) {
                next.delete(key)
            } else {
                next.add(key)
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
            return buildTokenBreakdownChartData(summary, categoryLabels, timezone || undefined)
        }
        const keyLabels = Object.fromEntries(summaryToApiKeyStats(summary.by_api_key ?? {}, aliases)
                                                 .map((row) => [row.key!, row.model]))
        return buildChartDataFromSummary(summary, metric, chartDimension, {
            ...aliases, ...keyLabels,
        }, timezone || undefined)
    }, [summary, metric, chartDimension, t, aliases, timezone])

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

        return {
            total: summary ? fmt(totalOf(summary)) : zero,
            live: liveSummary ? fmt(totalOf(liveSummary)) : '--',
        }
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
                        callback: (value: string | number, _index: number, ticks: { value: number }[]) => {
                            const steps  = ticks.slice(1)
                                                .map((tick, index) => Math.abs(tick.value - ticks[index].value))
                                                .filter((step) => step > 0)
                            const step   = Math.min(...steps)
                            const digits = Number.isFinite(step) ?
                                           Math.min(20, Math.max(2, Math.ceil(-Math.log10(step)))) :
                                           2
                            return `$${Number(value).toLocaleString(
                                i18n.language,
                                {
                                    minimumFractionDigits: digits,
                                    maximumFractionDigits: digits,
                                },
                            )}`
                        },
                    },
                },
            },
        }
    }, [period, chartData.labels, isMobile, metric, i18n.language])

    // Empty series renders a flat zero line so the card keeps its visual rhythm
    // instead of collapsing. spanGaps:false draws real gaps for null points.
    const visibleChartData = useMemo(() => {
        if (chartData.labels.length === 0) {
            const accent = METRIC_ACCENTS[metric]
            return {
                labels: ['', ''],
                datasets: [
                    {
                        id: 'empty',
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
            datasets: chartData.datasets.map((ds) => ({
                ...ds,
                id: ds.id ?? ds.label,
                hidden: hiddenSeries.has(ds.id ?? ds.label),
                spanGaps: false,
            })),
        }
    }, [chartData, hiddenSeries, metric])

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
                    <span className={styles.metricTitle} style={{ '--metric-accent': accent.border } as CSSProperties}>
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
                    <span className={styles.metricTitle} style={{ '--metric-accent': accent.border } as CSSProperties}>
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
                {loading && summary && <BusyOverlay label={t('common.loading')} />}
                <>
                    <div className={styles.summaryBar}>
                        <span className={styles.summaryTotal}>
                            {summaryValues.total}
                            <span className={styles.summaryLabel}>
                                {t('usage_stats.unified_total_label')}
                            </span>
                        </span>
                        <span className={styles.summaryLive}>
                            <span className={styles.liveDot} />
                            {summaryValues.live}
                            <span className={styles.summaryLabel}>{t('usage_stats.unified_latest_label')}</span>
                        </span>
                    </div>

                    <div className={styles.chartBody}>
                        <div className={pageStyles.chartWrapper}>
                            {chartData.datasets.length > 1 && (
                                <div className={pageStyles.chartLegend} aria-label='Chart legend'>
                                    {chartData.datasets.map((dataset, index) => (
                                        <div
                                            key={dataset.id ?? `${dataset.label}-${index}`}
                                            className={`${pageStyles.legendItem} ${
                                                hiddenSeries.has(dataset.id ?? dataset.label) ?
                                                pageStyles.legendItemHidden :
                                                ''
                                            }`}
                                            title={dataset.label}
                                            role='button'
                                            tabIndex={0}
                                            onClick={() => toggleDataset(dataset.id ?? dataset.label)}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter' || e.key === ' ') {
                                                    e.preventDefault()
                                                    toggleDataset(dataset.id ?? dataset.label)
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
                                        <Line data={visibleChartData} options={chartOptions} datasetIdKey='id' />
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
