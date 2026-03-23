import type {SummaryModelStats, UsageSummary} from '@/services/api/usage'
import type {ModelPrice} from '@/utils/usage'
import {useMemo} from 'react'
import {useChartData} from './hooks/useChartData'
import type {UsagePayload} from './hooks/useUsageData'
import {type ModelStat, ModelStatsCard} from './ModelStatsCard'
import {TokenBreakdownChart} from './TokenBreakdownChart'
import {type ChartDrillDownInfo, TrendChartsGrid} from './UsageChart'

interface ModelsTabProps {
    usage: UsagePayload | null;
    loading: boolean;
    modelPrices: Record<string, ModelPrice>;
    isMobile: boolean;
    hourWindowHours: number | undefined;
    onChartDrillDown?: (info: ChartDrillDownInfo) => void;
    summary?: UsageSummary | null;
}

const MODEL_CHART_LINES = ['all']

/** Convert summary by_model to ModelStat[] */
function summaryToModelStats(byModel: Record<string, SummaryModelStats>): ModelStat[] {
    return Object.entries(byModel).map(([model, stats]) => ({
        model,
        requests: stats.requests,
        successCount: stats.success,
        failureCount: stats.failure,
        tokens: stats.tokens.total,
        cost: stats.cost,
    }))
}

export function ModelsTab({
                              usage,
                              loading,
                              modelPrices,
                              isMobile,
                              hourWindowHours,
                              onChartDrillDown,
                              summary,
                          }: ModelsTabProps) {
    const modelStats = useMemo(() => {
        if (summary?.by_model && Object.keys(summary.by_model).length > 0) {
            return summaryToModelStats(summary.by_model)
        }
        return []
    }, [summary])

    const hasPrices = Object.keys(modelPrices).length > 0

    // 图表固定按模型维度展示，图例支持点击切换显示/隐藏
    const chartData = useChartData({
                                       usage,
                                       chartLines: MODEL_CHART_LINES,
                                       isMobile,
                                       hourWindowHours,
                                       dimension: 'model',
                                   })

    return (
        <>
            <ModelStatsCard modelStats={modelStats} loading={loading} hasPrices={hasPrices} />

            <TokenBreakdownChart usage={usage} loading={loading} isMobile={isMobile}
                                 hourWindowHours={hourWindowHours} />

            <TrendChartsGrid
                chartData={chartData}
                loading={loading}
                isMobile={isMobile}
                onDataPointClick={onChartDrillDown}
            />
        </>
    )
}
