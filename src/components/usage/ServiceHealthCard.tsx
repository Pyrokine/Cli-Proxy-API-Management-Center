import {DataStatusCard} from '@/components/common/DataStatusCard'
import {Button} from '@/components/ui/Button'
import {IconRefreshCw} from '@/components/ui/icons'
import styles from '@/pages/UsagePage.module.scss'
import type {SummaryTimePoint, UsageSummary} from '@/services/api/usage'
import {formatDateTime, formatUnixTimestamp} from '@/utils/format'
import {rateToColor, type ServiceHealthData, type StatusBlockDetail} from '@/utils/usage'
import {type PointerEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'

function calculateServiceHealthFromSummary(
    timeSeries: SummaryTimePoint[],
    fromMs: number,
    toMs: number,
    granularity: 'hourly' | 'daily' = 'hourly',
): ServiceHealthData {
    const rows           = 8
    const bucketDuration = (granularity === 'daily' ? 24 : 1) * 3600_000
    const alignedStart   = Math.floor(fromMs / bucketDuration) * bucketDuration
    const alignedEnd     = (Math.floor(toMs / bucketDuration) + 1) * bucketDuration
    const bucketCount    = Math.max(0, (alignedEnd - alignedStart) / bucketDuration)
    const maxBlocks      = rows * 200
    const blockDuration  = bucketDuration * Math.max(1, Math.ceil(bucketCount / maxBlocks))
    const blockCount     = Math.ceil((bucketCount * bucketDuration) / blockDuration)
    const cols           = Math.ceil(blockCount / rows)

    const blockStats: Array<{ success: number; failure: number; tokens: number }> = Array.from(
        { length: blockCount },
        () => ({ success: 0, failure: 0, tokens: 0 }),
    )

    let totalSuccess = 0
    let totalFailure = 0

    for (const pt of timeSeries) {
        const timestamp  = Date.parse(pt.time)
        const blockIndex = Math.floor((timestamp - alignedStart) / blockDuration)
        if (blockIndex >= 0 && blockIndex < blockCount) {
            const failure = pt.failure ?? 0
            // Compat: old data may only have requests without success/failure breakdown
            const success =
                      failure === 0 && (pt.success ?? 0) === 0 && pt.requests > 0 ? pt.requests : (pt.success ?? 0)
            blockStats[blockIndex].success += success
            blockStats[blockIndex].failure += failure
            const tokens  = typeof pt.tokens === 'number' ? pt.tokens : (pt.tokens?.total ?? 0)
            blockStats[blockIndex].tokens += tokens
            totalSuccess += success
            totalFailure += failure
        }
    }

    const blockDetails: StatusBlockDetail[] = blockStats.map((stats, idx) => {
        const startTime = alignedStart + idx * blockDuration
        const endTime   = Math.min(startTime + blockDuration, alignedEnd)
        const total     = stats.success + stats.failure

        if (total === 0) {
            return { success: 0, failure: 0, rate: -1, startTime, endTime, totalTokens: stats.tokens }
        }
        return {
            success: stats.success,
            failure: stats.failure,
            rate: stats.success / total,
            startTime,
            endTime,
            totalTokens: stats.tokens,
        }
    })

    const total       = totalSuccess + totalFailure
    // R-461:无请求时不再造一个伪 100% 成功率;消费方根据 hasData 判断显示，
    const successRate = total > 0 ? (totalSuccess / total) * 100 : -1

    const blocks = blockDetails.map((d) =>
                                        d.rate === -1
                                        ? ('idle' as const)
                                        : d.rate >= 1.0
                                          ? ('success' as const)
                                          : d.rate <= 0
                                            ? ('failure' as const)
                                            : ('mixed' as const),
    )

    return { blocks, blockDetails, totalSuccess, totalFailure, successRate, rows, cols }
}

interface ServiceHealthCardProps {
    loading: boolean
    summary?: UsageSummary | null
    fromMs: number
    toMs: number
    granularity?: 'hourly' | 'daily'
    error?: unknown
    /** Refresh handler wired into both empty and error states so users can
     *  retry without leaving the card. Hidden when not provided. */
    onRefresh?: () => void
    /** Refresh-in-progress indicator: disables the retry button and shows a
     *  loading-style label. */
    refreshing?: boolean
}

export function ServiceHealthCard({
                                      loading,
                                      summary,
                                      fromMs,
                                      toMs,
                                      granularity = 'hourly',
                                      error,
                                      onRefresh,
                                      refreshing,
                                  }: ServiceHealthCardProps) {
    const { t, i18n }                       = useTranslation()
    const [activeTooltip, setActiveTooltip] = useState<number | null>(null)
    // 给点击刷新一个最少 600ms 的本地 spinner: 父级的 refreshing 绑定的是
    // useUsageStatsStore.loading,但实际触发的是 /summary 请求,两者不在同一个 loading 状态机
    // 上.直接以"刚被点过"的本地 flag 兜底,确保用户看见反馈.
    const [locallyRefreshing, setLocallyRefreshing] = useState(false)
    const gridRef                                   = useRef<HTMLDivElement>(null)

    const handleRefreshClick = useCallback(() => {
        if (!onRefresh) {
            return
        }
        setLocallyRefreshing(true)
        try {
            onRefresh()
        } finally {
            setTimeout(() => setLocallyRefreshing(false), 600)
        }
    }, [onRefresh])

    const bucketGranularity             = summary?.period?.granularity ?? granularity
    const healthData: ServiceHealthData = useMemo(() => {
        const periodFrom = Date.parse(summary?.period?.from ?? '')
        const periodTo   = Date.parse(summary?.period?.to ?? '')
        return calculateServiceHealthFromSummary(
            summary?.time_series ?? [],
            Number.isFinite(periodFrom) ? periodFrom : fromMs,
            Number.isFinite(periodTo) ? periodTo : toMs,
            bucketGranularity,
        )
    }, [summary, fromMs, toMs, bucketGranularity])

    const hasData      = healthData.totalSuccess + healthData.totalFailure > 0
    const leadingSlots = healthData.cols * healthData.rows - healthData.blockDetails.length

    useEffect(() => {
        if (activeTooltip === null) {
            return
        }
        const handler = (e: Event) => {
            if (gridRef.current && !gridRef.current.contains(e.target as Node)) {
                setActiveTooltip(null)
            }
        }
        document.addEventListener('pointerdown', handler)
        return () => document.removeEventListener('pointerdown', handler)
    }, [activeTooltip])

    useLayoutEffect(() => {
        const scroller = gridRef.current?.parentElement
        if (!scroller || loading || !hasData) {
            return
        }
        scroller.scrollLeft = scroller.scrollWidth
    }, [loading, hasData, summary])

    const handlePointerEnter = useCallback((e: PointerEvent, idx: number) => {
        if (e.pointerType === 'mouse') {
            setActiveTooltip(idx)
        }
    }, [])

    const handlePointerLeave = useCallback((e: PointerEvent) => {
        if (e.pointerType === 'mouse') {
            setActiveTooltip(null)
        }
    }, [])

    const handlePointerDown = useCallback((e: PointerEvent, idx: number) => {
        if (e.pointerType === 'touch') {
            e.preventDefault()
            setActiveTooltip((prev) => (prev === idx ? null : idx))
        }
    }, [])

    const getTooltipPositionClass = (idx: number): string => {
        const col = Math.floor((idx + leadingSlots) / healthData.rows)
        if (col <= 2) {
            return styles.healthTooltipLeft
        }
        if (col >= healthData.cols - 3) {
            return styles.healthTooltipRight
        }
        return ''
    }

    const getTooltipVerticalClass = (idx: number): string => {
        const row = (idx + leadingSlots) % healthData.rows
        if (row <= 1) {
            return styles.healthTooltipBelow
        }
        return ''
    }

    const formatTokens = (n: number): string => {
        if (n < 1000) {
            return String(n)
        }
        if (n < 1_000_000) {
            return `${(n / 1000).toFixed(1)}K`
        }
        return `${(n / 1_000_000).toFixed(1)}M`
    }

    const renderTooltip = (detail: StatusBlockDetail, idx: number) => {
        const total     = detail.success + detail.failure
        const posClass  = getTooltipPositionClass(idx)
        const vertClass = getTooltipVerticalClass(idx)
        const timeRange = `${formatDateTime(new Date(detail.startTime), i18n.language)} – ${formatDateTime(new Date(
            detail.endTime), i18n.language)}`

        return (
            <div className={`${styles.healthTooltip} ${posClass} ${vertClass}`}>
                <span className={styles.healthTooltipTime}>{timeRange}</span>
                {total > 0 ? (
                    <>
                        <div className={styles.healthTooltipSummary}>
                            <span>
                                {t('service_health.total_requests')}: {total}
                            </span>
                            {detail.totalTokens > 0 && (
                                <span>
                                    {t('service_health.tokens')}: {formatTokens(detail.totalTokens)}
                                </span>
                            )}
                        </div>
                        <div className={styles.healthTooltipBar}>
                            <div
                                className={styles.healthTooltipBarFill}
                                style={{ width: `${(detail.rate * 100).toFixed(1)}%` }}
                            />
                        </div>
                        <span className={styles.healthTooltipStats}>
                            <span className={styles.healthTooltipSuccess}>
                                {t('status_bar.success_short')} {detail.success}
                            </span>
                            <span className={styles.healthTooltipFailure}>
                                {t('status_bar.failure_short')} {detail.failure}
                            </span>
                            <span className={styles.healthTooltipRate}>({(detail.rate * 100).toFixed(1)}%)</span>
                        </span>
                    </>
                ) : (
                     <span className={styles.healthTooltipStats}>{t('status_bar.no_requests')}</span>
                 )}
            </div>
        )
    }

    const rateClass = !hasData
                      ? ''
                      : healthData.successRate >= 90
                        ? styles.healthRateHigh
                        : healthData.successRate >= 50
                          ? styles.healthRateMedium
                          : styles.healthRateLow

    // Pick a date-label step that gives ~8 evenly spaced labels across whatever
    // grid width we ended up rendering, so 24h/7d/30d/全部 all stay readable.
    // Floor at 5 blocks (= 5 × 13px = 65px) so labels can never overlap each
    // other regardless of how short the window is — `Math.floor(cols/8)` alone
    // would yield step=2 for cols=24h, packing 30-char date strings into a
    // 26px slot.
    const labelStep = Math.max(5, Math.floor(healthData.cols / 8))

    const status       = hasData ? 'ready' : error ? 'error' : loading ? 'loading' : 'empty'
    const errorMessage = error instanceof Error ? error.message : typeof error === 'string' ? error : undefined

    if (status !== 'ready') {
        return (
            <div className={styles.healthCard}>
                <div className={styles.healthHeader}>
                    <h3 className={styles.healthTitle}>{t('service_health.title')}</h3>
                </div>
                <DataStatusCard
                    status={status}
                    skeletonVariant='rows'
                    skeletonRowCount={3}
                    emptyText={t('service_health.no_requests', { defaultValue: t('status_bar.no_requests') })}
                    errorMessage={errorMessage}
                    onRetry={onRefresh}
                    retrying={refreshing}
                />
            </div>
        )
    }

    return (
        <div className={styles.healthCard}>
            <div className={styles.healthHeader}>
                <h3 className={styles.healthTitle}>{t('service_health.title')}</h3>
                <div className={styles.healthMeta}>
                    <span className={`${styles.healthRate} ${rateClass}`}>
                        {`${healthData.successRate.toFixed(1)}%`}
                    </span>
                    {onRefresh && (
                        <Button
                            type='button'
                            size='sm'
                            variant='ghost'
                            onClick={handleRefreshClick}
                            loading={refreshing || locallyRefreshing}
                            aria-label={t('service_health.refresh', {
                                defaultValue: t('common.refresh', { defaultValue: 'Refresh' }),
                            })}
                        >
                            <IconRefreshCw size={14} />
                        </Button>
                    )}
                </div>
            </div>
            <div className={styles.healthGridScroller}>
                <div className={styles.healthDateLabels}>
                    {Array.from({ length: healthData.cols }, (_, col) => {
                        if (col % labelStep !== 0) {
                            return <span key={col} />
                        }
                        const blockIdx = Math.max(0, col * healthData.rows - leadingSlots)
                        const detail   = healthData.blockDetails[blockIdx]
                        if (!detail) {
                            return <span key={col} />
                        }
                        const [datePart = ''] = formatUnixTimestamp(detail.startTime).split(' ')
                        const dateBits  = datePart.split('/')
                        const label     = dateBits.length >= 3 ? `${dateBits[1]}/${dateBits[2]}` : datePart
                        return (
                            <span key={col} className={styles.healthDateLabel}>
                                {label}
                            </span>
                        )
                    })}
                </div>
                <div className={styles.healthGrid} ref={gridRef}>
                    {Array.from({ length: leadingSlots }, (_, index) => <span key={`empty-${index}`} aria-hidden />)}
                    {healthData.blockDetails.map((detail, idx) => {
                        const isIdle     = detail.rate === -1
                        const blockStyle = isIdle ? undefined : { backgroundColor: rateToColor(detail.rate) }
                        const isActive   = activeTooltip === idx

                        return (
                            <div
                                key={idx}
                                className={`${styles.healthBlockWrapper} ${isActive ? styles.healthBlockActive : ''}`}
                                onPointerEnter={(e) => handlePointerEnter(e, idx)}
                                onPointerLeave={handlePointerLeave}
                                onPointerDown={(e) => handlePointerDown(e, idx)}
                            >
                                <div
                                    className={`${styles.healthBlock} ${isIdle ? styles.healthBlockIdle : ''}`}
                                    style={blockStyle}
                                />
                                {isActive && renderTooltip(detail, idx)}
                            </div>
                        )
                    })}
                </div>
            </div>
            {errorMessage && <div className={styles.hint} role='alert'>
                {errorMessage} · {t('usage_stats.previous_results_shown', {
                defaultValue: 'Showing the last loaded results',
            })}
            </div>}
            {bucketGranularity === 'daily' && <div className={styles.hint}>
                {t('service_health.daily_buckets', { defaultValue: 'Grouped by UTC day within the selected range' })}
            </div>}
            <div className={styles.healthLegend}>
                <div className={styles.healthLegendItem}>
                    <div className={`${styles.healthLegendBlock} ${styles.healthBlockIdle}`} />
                    <span className={styles.healthLegendLabel}>{t('service_health.legend_idle')}</span>
                </div>
                <div className={styles.healthLegendItem}>
                    <div className={styles.healthLegendBlock} style={{ backgroundColor: '#ef4444' }} />
                    <span className={styles.healthLegendLabel}>{t('service_health.legend_failure')}</span>
                </div>
                <div className={styles.healthLegendItem}>
                    <div className={styles.healthLegendBlock} style={{ backgroundColor: '#facc15' }} />
                    <span className={styles.healthLegendLabel}>{t('service_health.legend_partial')}</span>
                </div>
                <div className={styles.healthLegendItem}>
                    <div className={styles.healthLegendBlock} style={{ backgroundColor: '#10b981' }} />
                    <span className={styles.healthLegendLabel}>{t('service_health.legend_success')}</span>
                </div>
            </div>
        </div>
    )
}
