import {buildDailyTokenBreakdown, buildHourlyTokenBreakdown, type TokenCategory} from '@/utils/usage'
import {buildChartOptions} from '@/utils/usage/chartConfig'
import {useMemo, useState} from 'react'
import {useTranslation} from 'react-i18next'
import type {UsagePayload} from './hooks/useUsageData'
import {UsageChart} from './UsageChart'

const TOKEN_COLORS: Record<TokenCategory, { border: string; bg: string }> = {
    input: { border: '#8b8680', bg: 'rgba(139, 134, 128, 0.25)' },
    output: { border: '#10b981', bg: 'rgba(16, 185, 129, 0.25)' },
    cached: { border: '#f59e0b', bg: 'rgba(245, 158, 11, 0.25)' },
    reasoning: { border: '#8b5cf6', bg: 'rgba(139, 92, 246, 0.25)' },
}

const CATEGORIES: TokenCategory[] = ['input', 'output', 'cached', 'reasoning']

interface TokenBreakdownChartProps {
    usage: UsagePayload | null;
    loading: boolean;
    isMobile: boolean;
    hourWindowHours?: number;
}

export function TokenBreakdownChart({ usage, loading, isMobile, hourWindowHours }: TokenBreakdownChartProps) {
    const { t }               = useTranslation()
    const [period, setPeriod] = useState<'hour' | 'day'>(
        hourWindowHours !== undefined && hourWindowHours <= 48 ? 'hour' : 'day',
    )

    // Sync period when hourWindowHours changes
    const [prevHourWindow, setPrevHourWindow] = useState(hourWindowHours)
    if (prevHourWindow !== hourWindowHours) {
        setPrevHourWindow(hourWindowHours)
        setPeriod(hourWindowHours !== undefined && hourWindowHours <= 48 ? 'hour' : 'day')
    }

    const { chartData, chartOptions } = useMemo(() => {
        const series                                        =
                  period === 'hour' ?
                  buildHourlyTokenBreakdown(usage, hourWindowHours) :
                  buildDailyTokenBreakdown(usage)
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
                fill: true,
                tension: 0.35,
            })),
        }

        const baseOptions = buildChartOptions({ period, labels: series.labels, isMobile })
        const options     = {
            ...baseOptions,
            scales: {
                ...baseOptions.scales,
                y: {
                    ...baseOptions.scales?.y,
                    stacked: true,
                },
                x: {
                    ...baseOptions.scales?.x,
                    stacked: true,
                },
            },
        }

        return { chartData: data, chartOptions: options }
    }, [usage, period, isMobile, hourWindowHours, t])

    return (
        <UsageChart
            title={t('usage_stats.token_breakdown')}
            period={period}
            onPeriodChange={setPeriod}
            chartData={chartData}
            chartOptions={chartOptions}
            loading={loading}
            isMobile={isMobile}
            emptyText={t('usage_stats.no_data')}
        />
    )
}
