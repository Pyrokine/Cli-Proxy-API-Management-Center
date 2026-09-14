import {Button} from '@/components/ui/Button'
import {Card} from '@/components/ui/Card'
import {type CostRecalculationStatus, modelPricesApi} from '@/services/api/modelPrices'
import {formatUsd} from '@/utils/usage'
import {useEffect, useState} from 'react'
import {useTranslation} from 'react-i18next'
import styles from './CostRecalculationCard.module.scss'

interface CostRecalculationCardProps {
    refreshKey?: number
}

function progressValue(status: CostRecalculationStatus): number {
    const value = status.percent ?? 0
    return Math.max(0, Math.min(100, value))
}

function phaseLabel(status: CostRecalculationStatus, t: ReturnType<typeof useTranslation>['t']): string {
    if (status.status === 'ok') {
        return t('usage_stats.recalculate_complete')
    }
    if (status.phase === 'day_rollup' || status.status === 'rolling_up') {
        return t('usage_stats.recalculate_phase_rollup')
    }
    if (status.status === 'error' || status.status === 'interrupted') {
        return t('usage_stats.recalculate_interrupted')
    }
    return t('usage_stats.recalculate_phase_events')
}

export function CostRecalculationCard({ refreshKey = 0 }: CostRecalculationCardProps) {
    const { t }                              = useTranslation()
    const [status, setStatus]                = useState<CostRecalculationStatus | null>(null)
    const [loading, setLoading]              = useState(true)
    const [starting, setStarting]            = useState(false)
    const [requestError, setRequestError]    = useState('')
    const [localRefreshKey, setLocalRefresh] = useState(0)

    useEffect(() => {
        const controller                                = new AbortController()
        let timer: ReturnType<typeof setTimeout> | null = null

        const poll = async () => {
            try {
                const next = await modelPricesApi.getRecalculationStatus({ signal: controller.signal })
                if (controller.signal.aborted) {
                    return
                }
                setStatus(next)
                setRequestError('')
                if (next.running) {
                    timer = setTimeout(() => {
                        void poll()
                    }, 1500)
                }
            } catch (err: unknown) {
                if (!controller.signal.aborted) {
                    setRequestError(err instanceof Error ? err.message : '')
                }
            } finally {
                if (!controller.signal.aborted) {
                    setLoading(false)
                }
            }
        }

        void poll()
        return () => {
            controller.abort()
            if (timer) {
                clearTimeout(timer)
            }
        }
    }, [localRefreshKey, refreshKey])

    const start = async () => {
        setStarting(true)
        try {
            const next = await modelPricesApi.startRecalculation()
            setStatus(next)
            setLocalRefresh((value) => value + 1)
        } catch (err: unknown) {
            setRequestError(err instanceof Error ? err.message : '')
        } finally {
            setStarting(false)
        }
    }

    const running         = Boolean(status?.running)
    const resumable       = status?.resumable || status?.status === 'interrupted' || status?.status === 'error'
    const totalEvents     = status?.total_events ?? 0
    const processedEvents = status?.processed_events ?? 0
    const progress        = progressValue(status ?? { status: 'idle', running: false })

    return (
        <Card
            title={t('usage_stats.recalculate_title')}
            extra={
                <Button
                    variant='secondary'
                    size='sm'
                    onClick={() => void start()}
                    loading={starting}
                    disabled={running || loading}
                >
                    {resumable ? t('usage_stats.recalculate_resume') : t('usage_stats.recalculate_button')}
                </Button>
            }
        >
            <div className={styles.content}>
                <p className={styles.description}>{t('usage_stats.recalculate_desc')}</p>
                {loading ? (
                    <span className={styles.hint}>{t('common.loading')}</span>
                ) : requestError ? (
                    <span className={styles.error} role='status'>{requestError}</span>
                ) : status && status.status !== 'idle' ? (
                    <div className={styles.progress} role='status'>
                        <div className={styles.progressHeader}>
                            <span>{phaseLabel(status, t)}</span>
                            <strong>{progress.toFixed(1)}%</strong>
                        </div>
                        <div
                            className={styles.progressBar}
                            role='progressbar'
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={progress}
                            aria-label={t('usage_stats.recalculate_title')}
                        >
                            <div className={styles.progressFill} style={{ width: `${progress}%` }} />
                        </div>
                        {status.phase === 'day_rollup' || status.status === 'rolling_up' ? (
                            <span className={styles.hint}>{t('usage_stats.recalculate_days_progress', {
                                done: status.rollup_done_days ?? 0,
                                total: status.rollup_total_days ?? 0,
                            })}</span>
                        ) : (
                             <span className={styles.hint}>{t('usage_stats.recalculate_events_progress', {
                                 done: processedEvents,
                                 total: totalEvents,
                                 changed: status.changed_events ?? 0,
                             })}</span>
                         )}
                        {status.status === 'ok' ? (
                            <span className={styles.complete}>{t('usage_stats.recalculate_success', {
                                days: status.recalculated_days ?? 0,
                                cost: formatUsd(status.total_cost ?? 0),
                            })}</span>
                        ) : null}
                        {status.status !== 'ok' && status.error ?
                         <span className={styles.error}>{status.error}</span> :
                         null}
                        {status.resumed ?
                         <span className={styles.hint}>{t('usage_stats.recalculate_resumed')}</span> :
                         null}
                        {status.status !== 'ok' && status.restart_reason ?
                         <span className={styles.hint}>{status.restart_reason}</span> :
                         null}
                    </div>
                ) : (
                        <span className={styles.hint}>{t('usage_stats.recalculate_idle')}</span>
                    )}
            </div>
        </Card>
    )
}
