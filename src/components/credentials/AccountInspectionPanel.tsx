import type {DataStatusValue} from '@/components/common/DataStatusCard'
import {Sheet, type SheetColumn} from '@/components/common/Sheet'
import {Button} from '@/components/ui/Button'
import {Pagination} from '@/components/ui/Pagination'
import {Select} from '@/components/ui/Select'
import {Tabs} from '@/components/ui/Tabs'
import {ToggleSwitch} from '@/components/ui/ToggleSwitch'
import type {
    AccountInspectionLogEntry,
    AccountInspectionRefreshQueue,
    AccountInspectionResult,
    AccountInspectionSchedule,
    AccountInspectionStatusResponse,
    AccountInspectionSummary,
} from '@/services/api/accountInspection'
import {accountInspectionApi} from '@/services/api/accountInspection'
import {authFilesApi} from '@/services/api/authFiles'
import type {QuotaConfig} from '@/services/api/quota'
import {quotaApi} from '@/services/api/quota'
import {useNotificationStore} from '@/stores/useNotificationStore'
import {formatDateTime} from '@/utils/format'
import {useCallback, useEffect, useMemo, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {useNavigate} from 'react-router-dom'
import styles from './AccountInspectionPanel.module.scss'

const UI_STATE_KEY      = 'cpa-account-inspection-ui-state'
const DEFAULT_PAGE_SIZE = 25

type ColumnKey = 'account' | 'provider' | 'status' | 'reason' | 'advice' | 'checked_at' | 'actions'
type DetailTab = 'results' | 'logs'

type UIState = {
    issuesOnly?: boolean
    pageSize?: number
}

type AccountInspectionPanelProps = {
    onCredentialsChanged?: () => void | Promise<void>
}

function loadUIState(): UIState {
    try {
        const raw = localStorage.getItem(UI_STATE_KEY)
        if (!raw) {
            return {}
        }
        const parsed = JSON.parse(raw)
        if (!parsed || typeof parsed !== 'object') {
            return {}
        }
        const state = parsed as UIState
        return {
            issuesOnly: typeof state.issuesOnly === 'boolean' ? state.issuesOnly : undefined,
            pageSize: typeof state.pageSize === 'number' ? state.pageSize : undefined,
        }
    } catch {
        return {}
    }
}

function emptySchedule(): AccountInspectionSchedule {
    return {
        enabled: false,
        interval_seconds: 3600,
        providers: [],
        max_concurrency: 4,
        timeout_seconds: 30,
        retention_runs: 20,
    }
}

function emptySummary(): AccountInspectionSummary {
    return {
        total: 0,
        normal: 0,
        abnormal: 0,
        token_invalid: 0,
        refresh_failed: 0,
        disabled: 0,
    }
}

function emptyRefreshQueue(): AccountInspectionRefreshQueue {
    return {
        pending: 0,
        skipped: 0,
        failed: 0,
    }
}

function emptyQuotaConfig(): QuotaConfig {
    return {
        enabled: false,
        interval: 600,
        'max-interval': 1800,
    }
}

function scheduleDraftFrom(schedule: AccountInspectionSchedule) {
    return {
        intervalSeconds: String(schedule.interval_seconds),
        maxConcurrency: String(schedule.max_concurrency),
        timeoutSeconds: String(schedule.timeout_seconds),
        retentionRuns: String(schedule.retention_runs),
    }
}

function parsePositiveInt(value: string, fallback: number): number {
    const parsed = Number.parseInt(value, 10)
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

function emptyStatus(): AccountInspectionStatusResponse {
    return {
        status: 'idle',
        schedule: emptySchedule(),
        summary: emptySummary(),
        refresh_queue: emptyRefreshQueue(),
        updated_at: '',
    }
}

function normalizeSchedule(schedule: AccountInspectionSchedule | null | undefined): AccountInspectionSchedule {
    return {
        ...emptySchedule(),
        ...(schedule ?? {}),
        providers: Array.isArray(schedule?.providers) ? schedule.providers : [],
    }
}

function normalizeSummary(summary: AccountInspectionSummary | null | undefined): AccountInspectionSummary {
    return {
        ...emptySummary(),
        ...(summary ?? {}),
    }
}

function normalizeRefreshQueue(
    refreshQueue: AccountInspectionRefreshQueue | null | undefined,
): AccountInspectionRefreshQueue {
    return {
        ...emptyRefreshQueue(),
        ...(refreshQueue ?? {}),
    }
}

function normalizeStatusResponse(status: AccountInspectionStatusResponse): AccountInspectionStatusResponse {
    return {
        ...emptyStatus(),
        ...status,
        schedule: normalizeSchedule(status.schedule),
        summary: normalizeSummary(status.summary),
        refresh_queue: normalizeRefreshQueue(status.refresh_queue),
    }
}

function statusClass(status: string): string {
    switch (status) {
        case 'normal':
        case 'completed':
            return styles.statusNormal
        case 'disabled':
            return styles.statusDisabled
        case 'unavailable':
        case 'error':
        case 'stopped':
            return styles.statusUnavailable
        case 'running':
            return styles.statusRunning
        default:
            return styles.statusUnknown
    }
}

function targetFor(result: AccountInspectionResult) {
    return {
        id: result.id || undefined,
        file_name: result.file_name || undefined,
        auth_index: result.auth_index || undefined,
    }
}

function rowKey(result: AccountInspectionResult) {
    return `${result.id || ''}-${result.file_name}-${result.auth_index || ''}`
}

function translateLogToken(prefix: string, value: string, t: ReturnType<typeof useTranslation>['t']): string {
    return t(`${prefix}${value}`, { defaultValue: value })
}

function formatInspectionLogMessage(
    entry: AccountInspectionLogEntry,
    t: ReturnType<typeof useTranslation>['t'],
): string {
    const message = entry.message.trim()
    let match     = /^account inspection started trigger=(\S+)$/.exec(message)
    if (match) {
        return t('credentials.inspection_log_started', {
            trigger: translateLogToken('credentials.inspection_log_trigger_', match[1], t),
            defaultValue: 'Account inspection started, trigger: {{trigger}}',
        })
    }

    match = /^checked (.+) result=(\S+) reason=(\S+)$/.exec(message)
    if (match) {
        return t('credentials.inspection_log_checked', {
            account: match[1],
            result: translateLogToken('credentials.inspection_status_', match[2], t),
            reason: translateLogToken('credentials.inspection_reason_', match[3], t),
            defaultValue: '{{account}} checked, result: {{result}}, reason: {{reason}}',
        })
    }

    match = /^account inspection (\S+) checked=(\d+)$/.exec(message)
    if (match) {
        return t('credentials.inspection_log_finished', {
            status: translateLogToken('credentials.inspection_status_', match[1], t),
            count: match[2],
            defaultValue: 'Account inspection {{status}}, checked {{count}} accounts',
        })
    }

    match = /^account inspection schedule updated enabled=(\S+) interval=(\S+)$/.exec(message)
    if (match) {
        return t('credentials.inspection_log_schedule_updated', {
            enabled:
                match[1] === 'true'
                ? t('credentials.inspection_log_schedule_enabled', { defaultValue: 'enabled' })
                : t('credentials.inspection_log_schedule_disabled', { defaultValue: 'disabled' }),
            interval: match[2],
            defaultValue: 'Inspection schedule updated, status: {{enabled}}, interval: {{interval}}',
        })
    }

    if (message === 'account inspection stop requested') {
        return t('credentials.inspection_log_stop_requested', { defaultValue: 'Account inspection stop requested' })
    }
    if (message === 'account inspection interrupted by server restart') {
        return t('credentials.inspection_log_interrupted_restart', {
            defaultValue: 'Account inspection was interrupted by server restart',
        })
    }
    if (message === 'account inspection interrupted by server shutdown') {
        return t('credentials.inspection_log_interrupted_shutdown', {
            defaultValue: 'Account inspection was interrupted by server shutdown',
        })
    }

    return message
}

export function AccountInspectionPanel({ onCredentialsChanged }: AccountInspectionPanelProps) {
    const { t, i18n }                                             = useTranslation()
    const navigate                                                = useNavigate()
    const showNotification                                        = useNotificationStore((s) => s.showNotification)
    const [initialUIState]                                        = useState(loadUIState)
    const [issuesOnly, setIssuesOnly]                             = useState(initialUIState.issuesOnly ?? true)
    const [includeDisabled, setIncludeDisabled]                   = useState(false)
    const [detailTab, setDetailTab]                               = useState<DetailTab>('results')
    const [pageSize, setPageSize]                                 = useState(initialUIState.pageSize ??
                                                                             DEFAULT_PAGE_SIZE)
    const [page, setPage]                                         = useState(1)
    const [statusFilter, setStatusFilter]                         = useState('')
    const [status, setStatus]                                     = useState<AccountInspectionStatusResponse>(
        emptyStatus)
    const [quotaConfig, setQuotaConfig]                           = useState<QuotaConfig>(emptyQuotaConfig)
    const [quotaConfigLoaded, setQuotaConfigLoaded]               = useState(false)
    const [scheduleDraft, setScheduleDraft]                       = useState(() => scheduleDraftFrom(emptySchedule()))
    const [inspectionScheduleLoaded, setInspectionScheduleLoaded] = useState(false)
    const [results, setResults]                                   = useState<AccountInspectionResult[]>([])
    const [logs, setLogs]                                         = useState<AccountInspectionLogEntry[]>([])
    const [total, setTotal]                                       = useState(0)
    const [loading, setLoading]                                   = useState(false)
    const [busyAction, setBusyAction]                             = useState<string>('')
    const [fetchError, setFetchError]                             = useState('')
    const [actionError, setActionError]                           = useState('')

    useEffect(() => {
        localStorage.setItem(UI_STATE_KEY, JSON.stringify({ issuesOnly, pageSize }))
    }, [issuesOnly, pageSize])

    const fetchData = useCallback(async () => {
        setLoading(true)
        try {
            const [statusRes, resultsRes, logsRes, quotaConfigRes] = await Promise.all([
                                                                                           accountInspectionApi.getStatus(),
                                                                                           accountInspectionApi.getResults(
                                                                                               {
                                                                                                   status: statusFilter,
                                                                                                   issuesOnly,
                                                                                                   includeDisabled,
                                                                                                   page,
                                                                                                   pageSize,
                                                                                               }),
                                                                                           accountInspectionApi.getLogs(),
                                                                                           quotaApi.getConfig(),
                                                                                       ])
            const nextStatus                                       = normalizeStatusResponse(statusRes)
            const nextQuotaConfig                                  = { ...emptyQuotaConfig(), ...quotaConfigRes }
            setStatus(nextStatus)
            setQuotaConfig(nextQuotaConfig)
            setQuotaConfigLoaded(true)
            setScheduleDraft(scheduleDraftFrom(nextStatus.schedule))
            setInspectionScheduleLoaded(true)
            setResults(Array.isArray(resultsRes.results) ? resultsRes.results : [])
            setTotal(typeof resultsRes.total === 'number' ? resultsRes.total : 0)
            setLogs(Array.isArray(logsRes.logs) ? logsRes.logs : [])
            setFetchError('')
        } catch (err) {
            setFetchError(err instanceof Error ? err.message : t('common.unknown_error'))
        } finally {
            setLoading(false)
        }
    }, [includeDisabled, issuesOnly, page, pageSize, statusFilter, t])

    useEffect(() => {
        const id = window.setTimeout(() => void fetchData(), 0)
        return () => window.clearTimeout(id)
    }, [fetchData])

    useEffect(() => {
        if (status.status !== 'running') {
            return
        }
        const id = window.setInterval(() => void fetchData(), 2000)
        return () => window.clearInterval(id)
    }, [fetchData, status.status])

    const handleIssuesOnlyChange = useCallback((checked: boolean) => {
        setIssuesOnly(checked)
        setPage(1)
    }, [])

    const handleIncludeDisabledChange = useCallback((checked: boolean) => {
        setIncludeDisabled(checked)
        setPage(1)
    }, [])

    const handleStatusFilterChange = useCallback((value: string) => {
        setStatusFilter(value)
        setPage(1)
    }, [])

    const handlePageSizeChange = useCallback((value: number) => {
        setPageSize(value)
        setPage(1)
    }, [])

    const runAction = useCallback(
        async (action: string, fn: () => Promise<unknown>) => {
            setBusyAction(action)
            setActionError('')
            try {
                await fn()
                await fetchData()
            } catch (err) {
                setActionError(err instanceof Error ? err.message : t('common.unknown_error'))
            } finally {
                setBusyAction('')
            }
        },
        [fetchData, t],
    )

    const saveInspectionSchedule = useCallback(
        async (enabled = status.schedule.enabled) => {
            if (!inspectionScheduleLoaded) {
                return
            }
            const nextSchedule: AccountInspectionSchedule = {
                ...status.schedule,
                enabled,
                interval_seconds: Math.max(
                    60,
                    parsePositiveInt(
                        scheduleDraft.intervalSeconds,
                        status.schedule.interval_seconds,
                    ),
                ),
                max_concurrency: parsePositiveInt(scheduleDraft.maxConcurrency, status.schedule.max_concurrency),
                timeout_seconds: parsePositiveInt(scheduleDraft.timeoutSeconds, status.schedule.timeout_seconds),
                retention_runs: parsePositiveInt(scheduleDraft.retentionRuns, status.schedule.retention_runs),
            }
            await runAction('inspection-schedule', async () => {
                const saved = normalizeSchedule(await accountInspectionApi.updateSchedule(nextSchedule))
                setStatus((prev) => ({ ...prev, schedule: saved }))
                setScheduleDraft(scheduleDraftFrom(saved))
                showNotification(t('common.success'), 'success')
            })
        },
        [inspectionScheduleLoaded, runAction, scheduleDraft, showNotification, status.schedule, t],
    )

    const formatTime = useCallback(
        (value?: string) => {
            if (!value) {
                return '-'
            }
            const date = new Date(value)
            return Number.isNaN(date.getTime()) ? value : formatDateTime(date, i18n.language)
        },
        [i18n.language],
    )

    const renderReason = useCallback(
        (reason: string) =>
            t(`credentials.inspection_reason_${reason}`, {
                defaultValue: reason || '-',
            }),
        [t],
    )

    const renderAdvice = useCallback(
        (advice: string) =>
            t(`credentials.inspection_advice_${advice}`, {
                defaultValue: advice || '-',
            }),
        [t],
    )

    const renderRowActions = useCallback(
        (result: AccountInspectionResult) => {
            const key = rowKey(result)
            if (result.status === 'disabled') {
                return (
                    <Button
                        variant='secondary'
                        size='xs'
                        loading={busyAction === `enable-${key}`}
                        onClick={() =>
                            void runAction(`enable-${key}`, async () => {
                                await authFilesApi.setStatus(result.file_name, false)
                                await onCredentialsChanged?.()
                                showNotification(t('common.success'), 'success')
                            })
                        }
                    >
                        {t('credentials.inspection_enable_account', { defaultValue: '启用' })}
                    </Button>
                )
            }
            if (result.reason === 'token_expired' || result.reason === 'refresh_failed') {
                return (
                    <Button
                        variant='secondary'
                        size='xs'
                        loading={busyAction === `refresh-${key}`}
                        onClick={() =>
                            void runAction(`refresh-${key}`, () => accountInspectionApi.refreshToken(targetFor(result)))
                        }
                    >
                        {t('credentials.inspection_refresh_token', { defaultValue: '刷新 token' })}
                    </Button>
                )
            }
            if (result.status === 'unknown' || result.reason === 'provider_error') {
                return (
                    <Button
                        variant='ghost'
                        size='xs'
                        disabled={status.status === 'running'}
                        loading={busyAction === `inspect-${key}`}
                        onClick={() =>
                            void runAction(`inspect-${key}`, () => accountInspectionApi.inspectOne(targetFor(result)))
                        }
                    >
                        {t('credentials.inspection_inspect_one', { defaultValue: '巡检' })}
                    </Button>
                )
            }
            return (
                <span className={styles.noAction}>
                    {t('credentials.inspection_no_action', { defaultValue: '无需操作' })}
                </span>
            )
        },
        [busyAction, onCredentialsChanged, runAction, showNotification, status.status, t],
    )

    const columns = useMemo<SheetColumn<AccountInspectionResult>[]>(() => {
        const items: Array<SheetColumn<AccountInspectionResult> & { columnKey: ColumnKey }> = [
            {
                columnKey: 'account',
                key: 'account',
                header: t('credentials.inspection_account', { defaultValue: '账号' }),
                sortable: true,
                sortValue: (row) => row.account,
                cell: (row) => (
                    <span className={styles.accountCell} title={row.account}>
                        {row.account}
                    </span>
                ),
            },
            {
                columnKey: 'provider',
                key: 'provider',
                header: t('credentials.inspection_provider', { defaultValue: '供应商' }),
                sortable: true,
                sortValue: (row) => row.provider || '',
                cell: (row) => row.provider || '-',
            },
            {
                columnKey: 'status',
                key: 'status',
                header: t('credentials.inspection_status', { defaultValue: '状态' }),
                sortable: true,
                sortValue: (row) => row.status,
                cell: (row) => (
                    <span className={`${styles.statusBadge} ${statusClass(row.status)}`}>
                        {t(`credentials.inspection_status_${row.status}`, { defaultValue: row.status })}
                    </span>
                ),
            },
            {
                columnKey: 'reason',
                key: 'reason',
                header: t('credentials.inspection_reason', { defaultValue: '原因' }),
                sortable: true,
                sortValue: (row) => row.reason,
                cell: (row) => renderReason(row.reason),
            },
            {
                columnKey: 'advice',
                key: 'advice',
                header: t('credentials.inspection_advice', { defaultValue: '建议' }),
                cell: (row) => <span className={styles.adviceCell}>{renderAdvice(row.advice)}</span>,
            },
            {
                columnKey: 'checked_at',
                key: 'checked_at',
                header: t('credentials.inspection_checked_at', { defaultValue: '检查时间' }),
                sortable: true,
                sortValue: (row) => Date.parse(row.checked_at) || 0,
                cell: (row) => <span className={styles.timeCell}>{formatTime(row.checked_at)}</span>,
            },
            {
                columnKey: 'actions',
                key: 'actions',
                header: t('common.action'),
                cell: (row) => <div className={styles.rowActions}>{renderRowActions(row)}</div>,
            },
        ]
        return items
    }, [formatTime, renderAdvice, renderReason, renderRowActions, t])

    const totalPages                       = Math.max(1, Math.ceil(total / pageSize))
    const sheetStatus: DataStatusValue     = fetchError
                                             ? 'error'
                                             : loading && results.length === 0
                                               ? 'loading'
                                               : results.length === 0
                                                 ? 'empty'
                                                 : 'ready'
    const visibleLogs                      = useMemo(() => logs.slice(-80), [logs])
    const lastRunResultLabel               = status.last_run
                                             ? t('credentials.inspection_last_run_result', {
            checked: status.last_run.checked,
            defaultValue: '{{checked}} 个账号',
        })
                                             : ''
    const logsSheetStatus: DataStatusValue = loading && visibleLogs.length === 0
                                             ? 'loading'
                                             : visibleLogs.length === 0
                                               ? 'empty'
                                               : 'ready'
    const logColumns                       = useMemo<SheetColumn<AccountInspectionLogEntry>[]>(() => [
        {
            key: 'time',
            header: t('credentials.inspection_log_time', { defaultValue: '时间' }),
            cell: (entry) => <span className={styles.logTime}>{formatTime(entry.time)}</span>,
        },
        {
            key: 'level',
            header: t('credentials.inspection_log_level', { defaultValue: '级别' }),
            cell: (entry) => (
                <span className={`${styles.logLevel} ${statusClass(entry.level)}`}>
                    {entry.level.toUpperCase()}
                </span>
            ),
        },
        {
            key: 'message',
            header: t('credentials.inspection_log_message', { defaultValue: '内容' }),
            cell: (entry) => <span className={styles.logMessage}>{formatInspectionLogMessage(entry, t)}</span>,
        },
    ], [formatTime, t])
    const inspectionScheduleDisabled       = !inspectionScheduleLoaded || busyAction === 'inspection-schedule'
    const sheetEmptyHint                   =
              results.length ===
              0 &&
              !includeDisabled &&
              status.summary.disabled >
              0 &&
              (statusFilter === '' || statusFilter === 'disabled')
              ? t('credentials.inspection_empty_disabled_hidden', {
                  count: status.summary.disabled,
                  defaultValue: '{{count}} disabled accounts are hidden by the current filter',
              })
              : undefined

    return (
        <div className={styles.panel}>
            <div className={styles.panelHeader}>
                <div>
                    <div className={styles.panelTitle}>{t(
                        'credentials.inspection_title',
                        { defaultValue: '账号巡检' },
                    )}</div>
                    <div className={styles.panelSubtitle}>
                        {t('credentials.inspection_panel_subtitle', {
                            defaultValue: '结果、日志和后端配额状态都保存在服务端',
                        })}
                    </div>
                </div>
                {status.status === 'running' && (
                    <span className='loading-spinner' role='status' aria-label={t('common.loading')} />
                )}
            </div>
            <div className={styles.body}>
                <div className={styles.summaryGrid}>
                    <div className={styles.metric}>
                        <span>{t('credentials.inspection_total', { defaultValue: '账号总数' })}</span>
                        <strong>{status.summary.total}</strong>
                    </div>
                    <div className={styles.metric}>
                        <span>{t('credentials.inspection_normal', { defaultValue: '正常' })}</span>
                        <strong>{status.summary.normal}</strong>
                    </div>
                    <div className={styles.metric}>
                        <span>{t('credentials.inspection_abnormal', { defaultValue: '异常' })}</span>
                        <strong>{status.summary.abnormal}</strong>
                    </div>
                    <div className={styles.metric}>
                        <span>{t('credentials.inspection_token_invalid', { defaultValue: 'Token 失效' })}</span>
                        <strong>{status.summary.token_invalid}</strong>
                    </div>
                    <div className={styles.metric}>
                        <span>{t('credentials.inspection_refresh_failed', { defaultValue: '刷新失败' })}</span>
                        <strong>{status.summary.refresh_failed}</strong>
                    </div>
                    <div className={styles.metric}>
                        <span>{t('credentials.inspection_disabled', { defaultValue: '已禁用' })}</span>
                        <strong>{status.summary.disabled}</strong>
                    </div>
                </div>

                <div className={styles.statusPanel}>
                    <div>
                        <div className={styles.sectionTitle}>
                            {t('credentials.inspection_runtime_status', { defaultValue: '运行状态' })}
                        </div>
                        <div className={styles.statusLine}>
                            {status.last_run && (
                                <span>
                                        {t('credentials.inspection_last_run', { defaultValue: '上次巡检' })}:{' '}
                                    {formatTime(status.last_run.started_at)} · {lastRunResultLabel}
                                    </span>
                            )}
                            <span>
                                    {t('credentials.next_refresh_at', { defaultValue: '下次刷新' })}:{' '}
                                {formatTime(status.refresh_queue.next_refresh)}
                                </span>
                            <span>
                                    {t('credentials.inspection_refresh_queue', { defaultValue: '后端配额轮询' })}:{' '}
                                {status.refresh_queue.pending}{' '}
                                {t('credentials.inspection_refresh_pending', { defaultValue: '待刷新' })} ·{' '}
                                {status.refresh_queue.skipped}{' '}
                                {t('credentials.inspection_refresh_skipped', { defaultValue: '已跳过' })} ·{' '}
                                {status.refresh_queue.failed}{' '}
                                {t('credentials.inspection_refresh_failed_queue', { defaultValue: '失败' })}
                                </span>
                        </div>
                        <div className={styles.statusHint}>
                            {t('credentials.inspection_runtime_hint', {
                                defaultValue:
                                    '账号巡检读取服务端配额状态，再补充账号禁用、token 和供应商错误判断',
                            })}
                        </div>
                    </div>
                    <div className={styles.actionsRow}>
                        <Button
                            variant='primary'
                            size='sm'
                            loading={busyAction === 'run'}
                            disabled={status.status === 'running'}
                            onClick={() => void runAction('run', accountInspectionApi.run)}
                        >
                            {t('credentials.inspection_run_now', { defaultValue: '立即巡检' })}
                        </Button>
                        <Button
                            variant='secondary'
                            size='sm'
                            disabled={status.status !== 'running'}
                            loading={busyAction === 'stop'}
                            onClick={() => void runAction('stop', accountInspectionApi.stop)}
                        >
                            {t('credentials.inspection_stop', { defaultValue: '停止' })}
                        </Button>
                        <Button variant='ghost' size='sm' onClick={() => void fetchData()} loading={loading}>
                            {t('common.refresh')}
                        </Button>
                    </div>
                </div>

                <div className={styles.settingsGrid}>
                    <div className={styles.settingsCard}>
                        <div className={styles.settingsHeader}>
                            <div>
                                <div className={styles.settingsTitle}>
                                    {t('credentials.quota_auto_refresh', { defaultValue: '后端配额轮询' })}
                                </div>
                                <div className={styles.settingsHint}>
                                    {t('credentials.quota_scheduler_hint', {
                                        defaultValue: '由后端 quota-refresh 调度器统一维护缓存和下次刷新时间',
                                    })}
                                </div>
                            </div>
                            <span className={`${styles.statusBadge} ${quotaConfig.enabled ?
                                                                      styles.statusRunning :
                                                                      styles.statusDisabled}`}>
                                    {quotaConfig.enabled
                                     ? t('common.enabled', { defaultValue: '已启用' })
                                     : t('common.disabled', { defaultValue: '已禁用' })}
                                </span>
                        </div>
                        <div className={styles.settingsFields}>
                            <div className={styles.settingsField}>
                                <span>{t('credentials.quota_poll_interval', { defaultValue: '配额轮询间隔' })}</span>
                                <strong>{quotaConfigLoaded ? `${quotaConfig.interval}s` : '-'}</strong>
                            </div>
                            <div className={styles.settingsField}>
                                <span>{t(
                                    'credentials.quota_poll_max_interval',
                                    { defaultValue: '最大轮询间隔' },
                                )}</span>
                                <strong>{quotaConfigLoaded ? `${quotaConfig['max-interval']}s` : '-'}</strong>
                            </div>
                            <Button
                                variant='secondary'
                                size='sm'
                                onClick={() => navigate('/config')}
                            >
                                {t('credentials.quota_open_config', { defaultValue: '到配置面板修改' })}
                            </Button>
                        </div>
                    </div>
                    <div className={styles.settingsCard}>
                        <div className={styles.settingsHeader}>
                            <div>
                                <div className={styles.settingsTitle}>
                                    {t('credentials.inspection_schedule_enabled', { defaultValue: '定时巡检' })}
                                </div>
                                <div className={styles.settingsHint}>
                                    {t('credentials.inspection_schedule_hint', {
                                        defaultValue: '由后端账号巡检调度器保存定时任务和巡检日志',
                                    })}
                                </div>
                            </div>
                            <ToggleSwitch
                                checked={status.schedule.enabled}
                                disabled={inspectionScheduleDisabled}
                                onChange={(checked) => void saveInspectionSchedule(checked)}
                                ariaLabel={t('credentials.inspection_schedule_enabled', { defaultValue: '定时巡检' })}
                            />
                        </div>
                        <div className={styles.settingsFields}>
                            <label className={styles.settingsField}>
                                <span>{t('credentials.inspection_interval', { defaultValue: '间隔秒数' })}</span>
                                <input
                                    type='number'
                                    min='60'
                                    value={scheduleDraft.intervalSeconds}
                                    onChange={(event) =>
                                        setScheduleDraft((prev) => ({
                                            ...prev,
                                            intervalSeconds: event.target.value,
                                        }))
                                    }
                                    disabled={inspectionScheduleDisabled}
                                />
                            </label>
                            <label className={styles.settingsField}>
                                <span>{t('credentials.inspection_max_concurrency', { defaultValue: '最大并发' })}</span>
                                <input
                                    type='number'
                                    min='1'
                                    value={scheduleDraft.maxConcurrency}
                                    onChange={(event) =>
                                        setScheduleDraft((prev) => ({
                                            ...prev,
                                            maxConcurrency: event.target.value,
                                        }))
                                    }
                                    disabled={inspectionScheduleDisabled}
                                />
                            </label>
                            <label className={styles.settingsField}>
                                <span>{t('credentials.inspection_timeout', { defaultValue: '超时秒数' })}</span>
                                <input
                                    type='number'
                                    min='1'
                                    value={scheduleDraft.timeoutSeconds}
                                    onChange={(event) =>
                                        setScheduleDraft((prev) => ({ ...prev, timeoutSeconds: event.target.value }))
                                    }
                                    disabled={inspectionScheduleDisabled}
                                />
                            </label>
                            <label className={styles.settingsField}>
                                <span>{t('credentials.inspection_retention_runs', { defaultValue: '保留轮次' })}</span>
                                <input
                                    type='number'
                                    min='1'
                                    value={scheduleDraft.retentionRuns}
                                    onChange={(event) =>
                                        setScheduleDraft((prev) => ({ ...prev, retentionRuns: event.target.value }))
                                    }
                                    disabled={inspectionScheduleDisabled}
                                />
                            </label>
                            <Button
                                variant='secondary'
                                size='sm'
                                loading={busyAction === 'inspection-schedule'}
                                disabled={inspectionScheduleDisabled}
                                onClick={() => void saveInspectionSchedule()}
                            >
                                {t('common.save')}
                            </Button>
                        </div>
                    </div>
                </div>

                <div className={styles.filterPanel}>
                    <ToggleSwitch
                        checked={issuesOnly}
                        onChange={handleIssuesOnlyChange}
                        label={t('credentials.inspection_issues_only', { defaultValue: '只看异常' })}
                    />
                    <ToggleSwitch
                        checked={includeDisabled}
                        onChange={handleIncludeDisabledChange}
                        label={t('credentials.inspection_include_disabled', { defaultValue: '包含禁用账号' })}
                    />
                </div>

                {actionError && <div className={styles.error}>{actionError}</div>}

                <Tabs
                    items={[
                        {
                            value: 'results',
                            label: t('credentials.inspection_results_tab', { defaultValue: '巡检结果' }),
                        },
                        { value: 'logs', label: t('credentials.inspection_logs', { defaultValue: '巡检日志' }) },
                    ]}
                    activeValue={detailTab}
                    onChange={setDetailTab}
                    ariaLabel={t('credentials.inspection_title', { defaultValue: '账号巡检' })}
                    size='sm'
                />

                {detailTab === 'results' ? (
                    <div className={styles.sectionCard}>
                        <div className={styles.tableControls}>
                            <Select
                                value={statusFilter}
                                options={[
                                    { value: '', label: t('usage_stats.filter_all') },
                                    {
                                        value: 'normal',
                                        label: t('credentials.inspection_status_normal', { defaultValue: '正常' }),
                                    },
                                    {
                                        value: 'unavailable',
                                        label: t(
                                            'credentials.inspection_status_unavailable',
                                            { defaultValue: '不可用' },
                                        ),
                                    },
                                    {
                                        value: 'unknown',
                                        label: t('credentials.inspection_status_unknown', { defaultValue: '未知' }),
                                    },
                                    {
                                        value: 'disabled',
                                        label: t('credentials.inspection_status_disabled', { defaultValue: '已禁用' }),
                                    },
                                ]}
                                onChange={handleStatusFilterChange}
                                ariaLabel={t('credentials.inspection_status_filter', { defaultValue: '巡检状态筛选' })}
                                fullWidth={false}
                            />
                        </div>

                        <Sheet
                            rows={results}
                            columns={columns}
                            rowKey={(row) => rowKey(row)}
                            status={sheetStatus}
                            errorMessage={fetchError}
                            onRetry={fetchData}
                            retrying={loading}
                            emptyText={t('credentials.inspection_empty', { defaultValue: '暂无巡检结果' })}
                            emptyHint={sheetEmptyHint}
                            loadingText={t('common.loading')}
                            refreshing={loading && results.length > 0}
                            refreshingText={t('common.loading')}
                        />

                        <Pagination
                            total={total}
                            page={Math.min(page, totalPages)}
                            pageSize={pageSize}
                            onPageChange={setPage}
                            onPageSizeChange={handlePageSizeChange}
                        />
                    </div>
                ) : (
                     <Sheet
                         rows={visibleLogs}
                         columns={logColumns}
                         rowKey={(entry, index) => `${entry.time}-${index}`}
                         status={logsSheetStatus}
                         emptyText={t('credentials.inspection_logs_empty', { defaultValue: '暂无巡检日志' })}
                         loadingText={t('common.loading')}
                         refreshing={loading && visibleLogs.length > 0}
                         refreshingText={t('common.loading')}
                         className={styles.logsPanel}
                         tableWrapClassName={styles.logsTableWrap}
                         summaryContent={(
                             <div>
                                 <div className={styles.logsTitle}>
                                     {t('credentials.inspection_logs', { defaultValue: '巡检日志' })}
                                 </div>
                                 <div className={styles.logsMeta}>
                                     {t('credentials.inspection_logs_count', {
                                         shown: visibleLogs.length,
                                         total: logs.length,
                                         defaultValue: '显示最后 {{shown}} / {{total}} 条，后端已保存',
                                     })}
                                 </div>
                             </div>
                         )}
                         toolbarContent={(
                             <Button variant='ghost' size='sm' onClick={() => void fetchData()} loading={loading}>
                                 {t('common.refresh')}
                             </Button>
                         )}
                     />
                 )}
            </div>
        </div>
    )
}
