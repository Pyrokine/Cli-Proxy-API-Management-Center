import type {UsageSummary} from '@/services/api/usage'
import {buildChartData, buildChartDataFromSummary, type ChartData, type ChartDimension} from '@/utils/usage'
import {buildChartOptions} from '@/utils/usage/chartConfig'
import type {ChartOptions} from 'chart.js'
import {useEffect, useMemo, useState} from 'react'
import type {UsagePayload} from './useUsageData'

interface UseChartDataOptions {
    usage: UsagePayload | null;
    chartLines: string[];
    isMobile: boolean;
    hourWindowHours?: number;
    dimension?: ChartDimension;
    aliases?: Record<string, string>;
    summary?: UsageSummary | null;
}

export interface UseChartDataReturn {
    requestsPeriod: 'hour' | 'day';
    setRequestsPeriod: (period: 'hour' | 'day') => void;
    tokensPeriod: 'hour' | 'day';
    setTokensPeriod: (period: 'hour' | 'day') => void;
    requestsChartData: ChartData;
    tokensChartData: ChartData;
    requestsChartOptions: ChartOptions<'line'>;
    tokensChartOptions: ChartOptions<'line'>;
}

/** 判断是否可以使用 summary 预聚合数据 */
function canUseSummary(summary: UsageSummary | null | undefined, dimension: ChartDimension): summary is UsageSummary {
    // credential 维度后端无 time_series_by_credential，需回退到前端聚合
    return !!summary && dimension !== 'credential'
}

export function useChartData({
                                 usage,
                                 chartLines,
                                 isMobile,
                                 hourWindowHours,
                                 dimension = 'total',
                                 aliases,
                                 summary,
                             }: UseChartDataOptions): UseChartDataReturn {
    const [requestsPeriod, setRequestsPeriod] = useState<'hour' | 'day'>(
        hourWindowHours !== undefined && hourWindowHours <= 48 ? 'hour' : 'day',
    )
    const [tokensPeriod, setTokensPeriod]     = useState<'hour' | 'day'>(
        hourWindowHours !== undefined && hourWindowHours <= 48 ? 'hour' : 'day',
    )

    // Sync periods when hourWindowHours changes
    useEffect(() => {
        const p = hourWindowHours !== undefined && hourWindowHours <= 48 ? 'hour' : 'day'
        setRequestsPeriod(p)
        setTokensPeriod(p)
    }, [hourWindowHours])

    const requestsChartData = useMemo(() => {
        if (canUseSummary(summary, dimension)) {
            const result = buildChartDataFromSummary(summary, 'requests', dimension)
            if (result.labels.length > 0) {
                return result
            }
        }
        if (!usage) {
            return { labels: [], datasets: [] }
        }
        return buildChartData(usage, requestsPeriod, 'requests', chartLines, {
            hourWindowHours,
            dimension,
            aliases,
        })
    }, [summary, dimension, usage, requestsPeriod, chartLines, hourWindowHours, aliases])

    const tokensChartData = useMemo(() => {
        if (canUseSummary(summary, dimension)) {
            const result = buildChartDataFromSummary(summary, 'tokens', dimension)
            if (result.labels.length > 0) {
                return result
            }
        }
        if (!usage) {
            return { labels: [], datasets: [] }
        }
        return buildChartData(usage, tokensPeriod, 'tokens', chartLines, {
            hourWindowHours,
            dimension,
            aliases,
        })
    }, [summary, dimension, usage, tokensPeriod, chartLines, hourWindowHours, aliases])

    const requestsChartOptions = useMemo(
        () =>
            buildChartOptions({
                                  period: requestsPeriod,
                                  labels: requestsChartData.labels,
                                  isMobile,
                              }),
        [requestsPeriod, requestsChartData.labels, isMobile],
    )

    const tokensChartOptions = useMemo(
        () =>
            buildChartOptions({
                                  period: tokensPeriod,
                                  labels: tokensChartData.labels,
                                  isMobile,
                              }),
        [tokensPeriod, tokensChartData.labels, isMobile],
    )

    return {
        requestsPeriod,
        setRequestsPeriod,
        tokensPeriod,
        setTokensPeriod,
        requestsChartData,
        tokensChartData,
        requestsChartOptions,
        tokensChartOptions,
    }
}
