import {Card} from '@/components/ui/Card'
import {usageApi, type UsageStorageUpgradeStatus} from '@/services/api/usage'
import type {ApiError} from '@/types/api'
import {formatNumber} from '@/utils/format'
import {useEffect, useState} from 'react'
import {useTranslation} from 'react-i18next'
import styles from './CostRecalculationCard.module.scss'
import {MaintenanceTaskTimes} from './MaintenanceTaskTimes'

export function UsageStorageUpgradeCard({ embedded = false }: { embedded?: boolean }) {
    const { t, i18n }                     = useTranslation()
    const [status, setStatus]             = useState<UsageStorageUpgradeStatus | null>(null)
    const [loading, setLoading]           = useState(true)
    const [requestError, setRequestError] = useState('')

    useEffect(() => {
        const controller                                = new AbortController()
        let timer: ReturnType<typeof setTimeout> | null = null
        const poll                                      = async () => {
            let interval = 5000
            try {
                const next = await usageApi.getStorageUpgradeStatus({ signal: controller.signal })
                if (controller.signal.aborted) {
                    return
                }
                setStatus(next)
                setRequestError('')
                interval = next.running ? 1500 : 5000
            } catch (error: unknown) {
                if (!controller.signal.aborted) {
                    const code = (error as ApiError)?.status
                    setRequestError(code === 404 || code === 405 || code === 501 ?
                                    t('usage_stats.storage_upgrade_unsupported', { status: code }) :
                                    t('usage_stats.maintenance_status_failed', {
                                        error: error instanceof Error ? error.message : String(error),
                                    }))
                }
            } finally {
                if (!controller.signal.aborted) {
                    setLoading(false)
                    timer = setTimeout(() => void poll(), interval)
                }
            }
        }
        void poll()
        return () => {
            controller.abort()
            if (timer !== null) {
                clearTimeout(timer)
            }
        }
    }, [t])

    const progress = typeof status?.percent === 'number' && Number.isFinite(status.percent) ?
                     Math.max(0, Math.min(100, status.percent)) : null
    const count    = (value?: number) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ?
                                         formatNumber(value, i18n.language) :
                                         t('usage_stats.request_events_not_recorded')

    const content = (
        <div className={styles.content}>
            {requestError && <span className={styles.error} role='alert'>{requestError}</span>}
            {loading && !status ? <span className={styles.hint}>{t('common.loading')}</span> : null}
            {status && (
                <>
                    <div className={styles.progress} role='status'>
                        <div className={styles.progressHeader}>
                                <span className={status.status === 'complete' ? styles.complete :
                                                 status.status === 'error' ? styles.error : undefined}>
                                    {t(`usage_stats.storage_upgrade_${status.status}`)}
                                </span>
                            {status.status !== 'idle' && <strong>{progress === null ?
                                                                  t('usage_stats.request_events_not_recorded') :
                                                                  `${progress.toFixed(1)}%`}</strong>}
                        </div>
                        {status.status !== 'idle' && progress !== null && (
                            <div className={styles.progressBar} role='progressbar'
                                 aria-label={t('usage_stats.storage_upgrade_title')}
                                 aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
                                <div className={styles.progressFill} style={{ width: `${progress}%` }} />
                            </div>
                        )}
                        {status.status !== 'idle' && <span className={styles.hint}>
                                {t('usage_stats.storage_upgrade_events', {
                                    done: count(status.processed_events), total: count(status.total_events),
                                })}
                            </span>}
                        {status.error && <span className={styles.error}>{status.error}</span>}
                    </div>
                    {status.status !== 'idle' && <MaintenanceTaskTimes running={status.running}
                                                                       startedAt={status.started_at}
                                                                       completedAt={status.completed_at} />}
                </>
            )}
        </div>
    )

    return embedded ? (
        <section className={styles.taskSection}>
            <h3 className={styles.taskTitle}>{t('usage_stats.storage_upgrade_title')}</h3>
            {content}
        </section>
    ) : <Card title={t('usage_stats.storage_upgrade_title')}>{content}</Card>
}
