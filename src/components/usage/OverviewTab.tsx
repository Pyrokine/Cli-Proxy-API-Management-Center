import type {UsageSummary} from '@/services/api/usage'
import type {ChartDimension} from '@/utils/usage'
import {CostTrendChart} from './CostTrendChart'
import {DimensionSelector} from './DimensionSelector'
import type {UseChartDataReturn} from './hooks/useChartData'
import type {UseSparklinesReturn} from './hooks/useSparklines'
import type {UsagePayload} from './hooks/useUsageData'
import {ServiceHealthCard} from './ServiceHealthCard'
import {StatCards} from './StatCards'
import {type ChartDrillDownInfo, TrendChartsGrid} from './UsageChart'

interface OverviewTabProps {
    usage: UsagePayload | null;
    unfilteredUsage: UsagePayload | null;
    loading: boolean;
    nowMs: number;
    sparklines: UseSparklinesReturn;
    chartData: UseChartDataReturn;
    isMobile: boolean;
    chartDimension: ChartDimension;
    onChartDimensionChange: (dimension: ChartDimension) => void;
    onChartDrillDown?: (info: ChartDrillDownInfo) => void;
    summary?: UsageSummary | null;
}

export function OverviewTab({
                                usage,
                                unfilteredUsage,
                                loading,
                                nowMs,
                                sparklines,
                                chartData,
                                isMobile,
                                chartDimension,
                                onChartDimensionChange,
                                onChartDrillDown,
                                summary,
                            }: OverviewTabProps) {
    return (
        <>
            <StatCards
                usage={usage}
                loading={loading}
                nowMs={nowMs}
                sparklines={{
                    requests: sparklines.requestsSparkline,
                    tokens: sparklines.tokensSparkline,
                    rpm: sparklines.rpmSparkline,
                    tpm: sparklines.tpmSparkline,
                    cost: sparklines.costSparkline,
                }}
                summary={summary}
            />

            <ServiceHealthCard usage={unfilteredUsage} loading={loading} />

            <DimensionSelector dimension={chartDimension} onChange={onChartDimensionChange} />

            <TrendChartsGrid
                chartData={chartData}
                loading={loading}
                isMobile={isMobile}
                onDataPointClick={onChartDrillDown}
            />

            <CostTrendChart loading={loading} isMobile={isMobile} summary={summary} />
        </>
    )
}
