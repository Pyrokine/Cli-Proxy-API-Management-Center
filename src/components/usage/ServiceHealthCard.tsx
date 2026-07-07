import {DataStatusCard} from '@/components/common/DataStatusCard'
import {Button} from '@/components/ui/Button'
import {IconRefreshCw} from '@/components/ui/icons'
import styles from '@/pages/UsagePage.module.scss'
import type {SummaryTimePoint, UsageSummary} from '@/services/api/usage'
import {formatDateTime, formatUnixTimestamp} from '@/utils/format'
import {rateToColor, type ServiceHealthData, type StatusBlockDetail} from '@/utils/usage'
import {type PointerEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'

/** Builds the service-health heat map from summary.time_series.
 *
 *  The grid follows the active filter window (from/to) so it always shows
 *  exactly the period the trend chart is showing. Buckets default to 1 hour.
 *  They expand automatically once the window is too wide to draw in 1-hour
 *  cells without creating too many DOM nodes. MAX_COLS also protects the page
 *  while the "all" preset is still resolving. */
function calculateServiceHealthFromSummary(
    timeSeries: SummaryTimePoint[],
    fromMs: number,
    toMs: number,
): ServiceHealthData {
    const ROWS     = 8
    const HOUR_MS  = 60 * 60 * 1000
    const MIN_COLS = 8
    const MAX_COLS = 200 // 8 × 200 = 1600 cells — keeps render snappy

    // Align edges to whole-hour boundaries so cell counts are stable.
    const alignedEnd   = Math.floor(toMs / HOUR_MS) * HOUR_MS
    const alignedStart = Math.floor(fromMs / HOUR_MS) * HOUR_MS
    const span         = Math.max(alignedEnd - alignedStart, HOUR_MS * MIN_COLS * ROWS)

    // Compute the ideal cell count assuming 1-hour buckets, then clamp. When
    // the window is wider than MAX_COLS × ROWS hours we widen each bucket so
    // every bucket is still rendered exactly once.
    const idealCols     = Math.ceil(span / (HOUR_MS * ROWS))
    const cols          = Math.min(MAX_COLS, Math.max(MIN_COLS, idealCols))
    const blockCount    = ROWS * cols
    const blockDuration = idealCols > MAX_COLS ? Math.ceil(span / (blockCount * HOUR_MS)) * HOUR_MS : HOUR_MS
    const windowStart   = alignedEnd - blockCount * blockDuration

    const blockStats: Array<{ success: number; failure: number; tokens: number }> = Array.from(
        { length: blockCount },
        () => ({ success: 0, failure: 0, tokens: 0 }),
    )

    let totalSuccess = 0
    let totalFailure = 0

    // Backend timePoint.Time is the start of an hour bucket (e.g. "19:00:00Z"
    // covers 19:00-20:00). Subtract one hour so the bucket-start maps into
    // [bucket-start, bucket-end] when locating the cell.
    for (const pt of timeSeries) {
        const timestamp = new Date(pt.time).getTime()
        if (!Number.isFinite(timestamp) || timestamp < windowStart || timestamp >= alignedEnd) {
            continue
        }

        const ageMs      = alignedEnd - timestamp - HOUR_MS
        const blockIndex = blockCount - 1 - Math.floor(ageMs / blockDuration)

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
        const blockAge  = (blockCount - 1 - idx) * blockDuration
        const startTime = alignedEnd - blockAge - blockDuration
        const endTime   = alignedEnd - blockAge
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

    return { blocks, blockDetails, totalSuccess, totalFailure, successRate, rows: ROWS, cols }
}

interface ServiceHealthCardProps {
    loading: boolean
    summary?: UsageSummary | null
    fromMs: number
    toMs: number
    /** Optional explicit error from upstream — when provided, the card renders
     *  the DataStatusCard error state instead of the heat map. */
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

    const healthData: ServiceHealthData = useMemo(
        () => calculateServiceHealthFromSummary(summary?.time_series ?? [], fromMs, toMs),
        [summary, fromMs, toMs],
    )

    const hasData = healthData.totalSuccess + healthData.totalFailure > 0

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
        const col = Math.floor(idx / healthData.rows)
        if (col <= 2) {
            return styles.healthTooltipLeft
        }
        if (col >= healthData.cols - 3) {
            return styles.healthTooltipRight
        }
        return ''
    }

    const getTooltipVerticalClass = (idx: number): string => {
        const row = idx % healthData.rows
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

    // DataStatusCard takes loading/empty/error/ready and decides which
    // state-screen to render. We keep the heat-map mounted only when status
    // === 'ready' — otherwise initial loads, fetch errors and "no data in
    // window" all share the same visual language with the rest of the page
    // (CardSkeleton vs error-with-retry vs "no data" hint).
    //
    // Subtle: 已有 hasData 时,refresh 不应再降级成 skeleton(否则用户点刷新
    // 后整个卡片(含刷新按钮本身)会消失 1s,视觉上像点击没生效).只在首次拉取
    // 没数据时才走 loading 状态;后续刷新由刷新按钮自己的 spinner 反馈.
    const status       = error ? 'error' : loading && !hasData ? 'loading' : !loading && !hasData ? 'empty' : 'ready'
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
                        {loading ? '--' : hasData ? `${healthData.successRate.toFixed(1)}%` : '--'}
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
                        const blockIdx = col * healthData.rows
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
