import {Button} from '@/components/ui/Button'
import {Card} from '@/components/ui/Card'
import styles from '@/pages/UsagePage.module.scss'
import type {ChartData} from '@/utils/usage'
import {getHourChartMinWidth} from '@/utils/usage/chartConfig'
import type {ChartOptions} from 'chart.js'
import {useCallback, useMemo, useState} from 'react'
import {Line} from 'react-chartjs-2'
import {useTranslation} from 'react-i18next'
import type {UseChartDataReturn} from './hooks/useChartData'

export interface ChartDrillDownInfo {
    label: string;
    datasetLabel: string;
}

interface UsageChartProps {
    title: string;
    period: 'hour' | 'day';
    onPeriodChange: (period: 'hour' | 'day') => void;
    chartData: ChartData;
    chartOptions: ChartOptions<'line'>;
    loading: boolean;
    isMobile: boolean;
    emptyText: string;
    onDataPointClick?: (info: ChartDrillDownInfo) => void;
}

export function UsageChart({
                               title,
                               period,
                               onPeriodChange,
                               chartData,
                               chartOptions,
                               loading,
                               isMobile,
                               emptyText,
                               onDataPointClick,
                           }: UsageChartProps) {
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

    // 合并 onClick 钻取回调到 chart options
    const mergedOptions = useMemo((): ChartOptions<'line'> => {
        if (!onDataPointClick) {
            return chartOptions
        }
        return {
            ...chartOptions,
            onClick: (_event, elements, chart) => {
                if (!elements.length) {
                    return
                }
                const { datasetIndex, index } = elements[0]
                const label                   = chart.data.labels?.[index]
                const datasetLabel            = chart.data.datasets[datasetIndex]?.label
                if (label && datasetLabel) {
                    onDataPointClick({ label: String(label), datasetLabel })
                }
            },
        }
    }, [chartOptions, onDataPointClick])

    const visibleChartData = useMemo(
        () => ({
            labels: chartData.labels,
            datasets: chartData.datasets.map((ds, i) => ({
                ...ds,
                hidden: hiddenIndices.has(i),
            })),
        }),
        [chartData, hiddenIndices],
    )

    return (
        <Card
            title={title}
            extra={
                <div className={styles.periodButtons}>
                    <Button
                        variant={period === 'hour' ? 'primary' : 'secondary'}
                        size='sm'
                        onClick={() => onPeriodChange('hour')}
                    >
                        {t('usage_stats.by_hour')}
                    </Button>
                    <Button variant={period === 'day' ? 'primary' : 'secondary'} size='sm'
                            onClick={() => onPeriodChange('day')}>
                        {t('usage_stats.by_day')}
                    </Button>
                </div>
            }
        >
            {loading ? (
                <div className={styles.hint}>{t('common.loading')}</div>
            ) : chartData.labels.length > 0 ? (
                <div className={styles.chartWrapper}>
                    <div className={styles.chartLegend} aria-label='Chart legend'>
                        {chartData.datasets.map((dataset, index) => (
                            <div
                                key={`${dataset.label}-${index}`}
                                className={`${styles.legendItem} ${hiddenIndices.has(index) ?
                                                                   styles.legendItemHidden :
                                                                   ''}`}
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
                                <span className={styles.legendDot} style={{ backgroundColor: dataset.borderColor }} />
                                <span className={styles.legendLabel}>{dataset.label}</span>
                            </div>
                        ))}
                    </div>
                    <div className={styles.chartArea}>
                        <div className={styles.chartScroller}>
                            <div
                                className={styles.chartCanvas}
                                style={
                                    period === 'hour' ?
                                        { minWidth: getHourChartMinWidth(chartData.labels.length, isMobile) } :
                                    undefined
                                }
                            >
                                <Line data={visibleChartData} options={mergedOptions} />
                            </div>
                        </div>
                    </div>
                </div>
            ) : (
                    <div className={styles.hint}>{emptyText}</div>
                )}
        </Card>
    )
}

/* ── Trend Charts Grid ──────────────────────── */

interface TrendChartsGridProps {
    chartData: UseChartDataReturn;
    loading: boolean;
    isMobile: boolean;
    onDataPointClick?: (info: ChartDrillDownInfo) => void;
}

/** Paired requests + tokens trend charts used by OverviewTab and ModelsTab */
export function TrendChartsGrid({ chartData, loading, isMobile, onDataPointClick }: TrendChartsGridProps) {
    const { t } = useTranslation()

    return (
        <div className={styles.chartsGrid}>
            <UsageChart
                title={t('usage_stats.requests_trend')}
                period={chartData.requestsPeriod}
                onPeriodChange={chartData.setRequestsPeriod}
                chartData={chartData.requestsChartData}
                chartOptions={chartData.requestsChartOptions}
                loading={loading}
                isMobile={isMobile}
                emptyText={t('usage_stats.no_data')}
                onDataPointClick={onDataPointClick}
            />
            <UsageChart
                title={t('usage_stats.tokens_trend')}
                period={chartData.tokensPeriod}
                onPeriodChange={chartData.setTokensPeriod}
                chartData={chartData.tokensChartData}
                chartOptions={chartData.tokensChartOptions}
                loading={loading}
                isMobile={isMobile}
                emptyText={t('usage_stats.no_data')}
                onDataPointClick={onDataPointClick}
            />
        </div>
    )
}
