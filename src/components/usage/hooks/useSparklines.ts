import type {UsageSummary} from '@/services/api/usage'
import {collectUsageDetails, extractTotalTokens} from '@/utils/usage'
import {useCallback, useMemo} from 'react'
import type {UsagePayload} from './useUsageData'

interface SparklineData {
    labels: string[];
    datasets: [
        {
            data: Array<number | null>;
            borderColor: string;
            backgroundColor: string;
            fill: boolean;
            tension: number;
            pointRadius: number;
            borderWidth: number;
        },
    ];
}

export interface SparklineBundle {
    data: SparklineData;
}

interface UseSparklinesOptions {
    usage: UsagePayload | null;
    loading: boolean;
    nowMs: number;
    summary?: UsageSummary | null;
}

export interface UseSparklinesReturn {
    requestsSparkline: SparklineBundle | null;
    tokensSparkline: SparklineBundle | null;
    rpmSparkline: SparklineBundle | null;
    tpmSparkline: SparklineBundle | null;
    costSparkline: SparklineBundle | null;
}

export function useSparklines({ usage, loading, nowMs, summary }: UseSparklinesOptions): UseSparklinesReturn {
    const lastHourSeries = useMemo(() => {
        if (!usage) {
            return { labels: [], requests: [], tokens: [] }
        }
        if (!Number.isFinite(nowMs) || nowMs <= 0) {
            return { labels: [], requests: [], tokens: [] }
        }
        const details = collectUsageDetails(usage)
        if (!details.length) {
            return { labels: [], requests: [], tokens: [] }
        }

        const windowMinutes  = 60
        const now            = nowMs
        const windowStart    = now - windowMinutes * 60 * 1000
        const requestBuckets = new Array(windowMinutes).fill(0)
        const tokenBuckets   = new Array(windowMinutes).fill(0)

        details.forEach((detail) => {
            const timestamp = detail.__timestampMs ?? 0
            if (!Number.isFinite(timestamp) || timestamp < windowStart || timestamp > now) {
                return
            }
            const minuteIndex = Math.min(windowMinutes - 1, Math.floor((timestamp - windowStart) / 60000))
            requestBuckets[minuteIndex] += 1
            tokenBuckets[minuteIndex] += extractTotalTokens(detail)
        })

        const labels = requestBuckets.map((_, idx) => {
            const date = new Date(windowStart + (idx + 1) * 60000)
            const h    = date.getHours().toString().padStart(2, '0')
            const m    = date.getMinutes().toString().padStart(2, '0')
            return `${h}:${m}`
        })

        return { labels, requests: requestBuckets, tokens: tokenBuckets }
    }, [nowMs, usage])

    const buildSparkline = useCallback(
        (
            series: { labels: string[]; data: Array<number | null> },
            color: string,
            backgroundColor: string,
        ): SparklineBundle | null => {
            if (loading || !series?.data?.length) {
                return null
            }
            const sliceStart = Math.max(series.data.length - 60, 0)
            const labels     = series.labels.slice(sliceStart)
            const points     = series.data.slice(sliceStart)
            return {
                data: {
                    labels,
                    datasets: [
                        {
                            data: points,
                            borderColor: color,
                            backgroundColor,
                            fill: true,
                            tension: 0.45,
                            pointRadius: 0,
                            borderWidth: 2,
                        },
                    ],
                },
            }
        },
        [loading],
    )

    const requestsSparkline = useMemo(
        () =>
            buildSparkline(
                { labels: lastHourSeries.labels, data: lastHourSeries.requests },
                '#8b8680',
                'rgba(139, 134, 128, 0.18)',
            ),
        [buildSparkline, lastHourSeries.labels, lastHourSeries.requests],
    )

    const tokensSparkline = useMemo(
        () =>
            buildSparkline(
                { labels: lastHourSeries.labels, data: lastHourSeries.tokens },
                '#8b5cf6',
                'rgba(139, 92, 246, 0.18)',
            ),
        [buildSparkline, lastHourSeries.labels, lastHourSeries.tokens],
    )

    const rpmSparkline = useMemo(
        () =>
            buildSparkline(
                { labels: lastHourSeries.labels, data: lastHourSeries.requests },
                '#10b981',
                'rgba(16, 185, 129, 0.18)',
            ),
        [buildSparkline, lastHourSeries.labels, lastHourSeries.requests],
    )

    const tpmSparkline = useMemo(
        () =>
            buildSparkline(
                { labels: lastHourSeries.labels, data: lastHourSeries.tokens },
                '#f97316',
                'rgba(249, 115, 22, 0.18)',
            ),
        [buildSparkline, lastHourSeries.labels, lastHourSeries.tokens],
    )

    const costSparkline = useMemo(() => {
        if (loading || !summary?.time_series?.length) {
            return null
        }
        const ts     = summary.time_series
        const labels = ts.map((pt) => {
            const d = new Date(pt.time)
            const h = d.getHours().toString().padStart(2, '0')
            const m = d.getMinutes().toString().padStart(2, '0')
            return `${h}:${m}`
        })
        const data = ts.map((pt) => pt.has_cost ? (pt.cost ?? 0) : null)
        return buildSparkline({ labels, data }, '#f59e0b', 'rgba(245, 158, 11, 0.18)')
    }, [buildSparkline, loading, summary])

    return {
        requestsSparkline,
        tokensSparkline,
        rpmSparkline,
        tpmSparkline,
        costSparkline,
    }
}
