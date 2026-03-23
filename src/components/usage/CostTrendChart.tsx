import {Card} from '@/components/ui/Card'
import styles from '@/pages/UsagePage.module.scss'
import type {UsageSummary} from '@/services/api/usage'
import {buildChartDataFromSummary, formatUsd} from '@/utils/usage'
import {buildChartOptions} from '@/utils/usage/chartConfig'
import type {ScriptableContext} from 'chart.js'
import {useMemo} from 'react'
import {Line} from 'react-chartjs-2'
import {useTranslation} from 'react-i18next'

interface CostTrendChartProps {
    loading: boolean;
    isMobile: boolean;
    summary?: UsageSummary | null;
}

const COST_COLOR = '#f59e0b'
const COST_BG    = 'rgba(245, 158, 11, 0.15)'

function buildGradient(ctx: ScriptableContext<'line'>) {
    const chart = ctx.chart
    const area  = chart.chartArea
    if (!area) {
        return COST_BG
    }
    const gradient = chart.ctx.createLinearGradient(0, area.top, 0, area.bottom)
    gradient.addColorStop(0, 'rgba(245, 158, 11, 0.28)')
    gradient.addColorStop(0.6, 'rgba(245, 158, 11, 0.12)')
    gradient.addColorStop(1, 'rgba(245, 158, 11, 0.02)')
    return gradient
}

export function CostTrendChart({ loading, isMobile, summary }: CostTrendChartProps) {
    const { t }  = useTranslation()
    const period = useMemo<'hour' | 'day'>(() => {
        if (summary?.time_series?.length && summary.time_series.length >= 2) {
            const t0 = new Date(summary.time_series[0].time).getTime()
            const t1 = new Date(summary.time_series[1].time).getTime()
            return t1 - t0 >= 20 * 3600_000 ? 'day' : 'hour'
        }
        return 'hour'
    }, [summary])

    const hasCost = useMemo(() => {
        return !!summary?.time_series?.some(p => p.has_cost)
    }, [summary])

    const { chartData, chartOptions } = useMemo(() => {
        if (!hasCost || !summary) {
            return { chartData: { labels: [], datasets: [] }, chartOptions: {} }
        }

        const result = buildChartDataFromSummary(summary, 'cost', 'total')
        const data   = {
            labels: result.labels,
            datasets: [
                {
                    label: t('usage_stats.total_cost'),
                    data: result.datasets[0]?.data ?? [],
                    borderColor: COST_COLOR,
                    backgroundColor: buildGradient,
                    pointBackgroundColor: COST_COLOR,
                    pointBorderColor: COST_COLOR,
                    fill: true,
                    tension: 0.35,
                },
            ],
        }

        const baseOptions = buildChartOptions({ period, labels: result.labels, isMobile })
        const options     = {
            ...baseOptions,
            scales: {
                ...baseOptions.scales,
                y: {
                    ...baseOptions.scales?.y,
                    ticks: {
                        ...(baseOptions.scales?.y && 'ticks' in baseOptions.scales.y ? baseOptions.scales.y.ticks : {}),
                        callback: (value: string | number) => formatUsd(Number(value)),
                    },
                },
            },
        }

        return { chartData: data, chartOptions: options }
    }, [summary, hasCost, period, isMobile, t])

    return (
        <Card title={t('usage_stats.cost_trend')}>
            {loading ? (
                <div className={styles.hint}>{t('common.loading')}</div>
            ) : !hasCost ? (
                <div className={styles.hint}>{t('usage_stats.cost_no_data')}</div>
            ) : (
                    <div className={styles.chartWrapper}>
                        <div className={styles.chartArea}>
                            <div className={styles.chartScroller}>
                                <div className={styles.chartCanvas}>
                                    <Line data={chartData} options={chartOptions} />
                                </div>
                            </div>
                        </div>
                    </div>
                )}
        </Card>
    )
}
