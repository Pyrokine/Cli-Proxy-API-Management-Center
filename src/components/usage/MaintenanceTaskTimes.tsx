import {formatDateTime} from '@/utils/format'
import {SECOND_CLOCK} from '@/utils/time/sharedClock'
import {formatDurationMs} from '@/utils/usage'
import {useSyncExternalStore} from 'react'
import {useTranslation} from 'react-i18next'
import styles from './CostRecalculationCard.module.scss'

interface MaintenanceTaskTimesProps {
    running: boolean
    startedAt?: string
    completedAt?: string
}

const stoppedClockSubscription = () => () => undefined

export function MaintenanceTaskTimes({ running, startedAt, completedAt }: MaintenanceTaskTimesProps) {
    const { t, i18n }     = useTranslation()
    const started         = Date.parse(startedAt ?? '')
    const completed       = Date.parse(completedAt ?? '')
    const validStart      = Number.isFinite(started)
    const validCompletion = !running && Number.isFinite(completed) && (!validStart || completed >= started)
    const now             = useSyncExternalStore(
        running && validStart ? SECOND_CLOCK.subscribe : stoppedClockSubscription,
        SECOND_CLOCK.getSnapshot,
        SECOND_CLOCK.getServerSnapshot,
    )
    const end             = running ? now : validCompletion ? completed : Number.NaN
    const elapsed         = validStart && Number.isFinite(end) && end >= started ? end - started : null
    const notRecorded     = t('usage_stats.request_events_not_recorded')

    return (
        <dl className={styles.taskTimes}>
            <div>
                <dt>{t('usage_stats.maintenance_started_at')}</dt>
                <dd>{validStart ? (
                    <time dateTime={startedAt}>{formatDateTime(new Date(started), i18n.language)}</time>
                ) : notRecorded}</dd>
            </div>
            <div>
                <dt>{t('usage_stats.maintenance_completed_at')}</dt>
                <dd>{validCompletion ? (
                    <time dateTime={completedAt}>{formatDateTime(new Date(completed), i18n.language)}</time>
                ) : notRecorded}</dd>
            </div>
            <div>
                <dt>{t(running ? 'usage_stats.maintenance_elapsed' : 'usage_stats.maintenance_total_duration')}</dt>
                <dd>{formatDurationMs(elapsed, {
                    locale: i18n.language,
                    invalidText: notRecorded,
                    maxUnits: 4,
                    secondDecimals: 0,
                })}</dd>
            </div>
        </dl>
    )
}
