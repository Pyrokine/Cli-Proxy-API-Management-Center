import styles from '@/pages/UsagePage.module.scss'
import {getEffectiveTimezone} from '@/stores/useTimezoneStore'
import {
    calculateServiceHealthData,
    collectUsageDetails,
    rateToColor,
    type ServiceHealthData,
    type StatusBlockDetail,
} from '@/utils/usage'
import {type PointerEvent, useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'
import type {UsagePayload} from './hooks/useUsageData'

function formatDateTime(timestamp: number): string {
    const date     = new Date(timestamp)
    const timeZone = getEffectiveTimezone()
    return date.toLocaleString(undefined, {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        ...(timeZone ? { timeZone } : {}),
    })
}

interface ServiceHealthCardProps {
    usage: UsagePayload | null;
    loading: boolean;
}

export function ServiceHealthCard({ usage, loading }: ServiceHealthCardProps) {
    const { t }                             = useTranslation()
    const [activeTooltip, setActiveTooltip] = useState<number | null>(null)
    const gridRef                           = useRef<HTMLDivElement>(null)

    const healthData: ServiceHealthData = useMemo(() => {
        const details = usage ? collectUsageDetails(usage) : []
        return calculateServiceHealthData(details)
    }, [usage])

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
        const timeRange = `${formatDateTime(detail.startTime)} – ${formatDateTime(detail.endTime)}`

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
                            <div className={styles.healthTooltipBarFill}
                                 style={{ width: `${(detail.rate * 100).toFixed(1)}%` }} />
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

    return (
        <div className={styles.healthCard}>
            <div className={styles.healthHeader}>
                <h3 className={styles.healthTitle}>{t('service_health.title')}</h3>
                <div className={styles.healthMeta}>
                    <span className={styles.healthWindow}>{t('service_health.window')}</span>
                    <span className={`${styles.healthRate} ${rateClass}`}>
            {loading ? '--' : hasData ? `${healthData.successRate.toFixed(1)}%` : '--'}
          </span>
                </div>
            </div>
            <div className={styles.healthGridScroller}>
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
                                <div className={`${styles.healthBlock} ${isIdle ? styles.healthBlockIdle : ''}`}
                                     style={blockStyle} />
                                {isActive && renderTooltip(detail, idx)}
                            </div>
                        )
                    })}
                </div>
            </div>
            <div className={styles.healthLegend}>
                <span className={styles.healthLegendLabel}>{t('service_health.oldest')}</span>
                <div className={styles.healthLegendColors}>
                    <div className={`${styles.healthLegendBlock} ${styles.healthBlockIdle}`} />
                    <div className={styles.healthLegendBlock} style={{ backgroundColor: '#ef4444' }} />
                    <div className={styles.healthLegendBlock} style={{ backgroundColor: '#facc15' }} />
                    <div className={styles.healthLegendBlock} style={{ backgroundColor: '#10b981' }} />
                </div>
                <span className={styles.healthLegendLabel}>{t('service_health.newest')}</span>
            </div>
        </div>
    )
}
