import type {DataStatusValue} from '@/components/common/DataStatusCard'
import {Sheet, type SheetColumn} from '@/components/common/Sheet'
import {Button} from '@/components/ui/Button'
import {Input} from '@/components/ui/Input'
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
import {type AuthFileRefreshBatchItem, authFilesApi} from '@/services/api/authFiles'
import {apiClient} from '@/services/api/client'
import type {
    QuotaConfig,
    QuotaRefreshTask,
    QuotaRefreshTaskList,
    QuotaRefreshTaskTarget,
    QuotaStatusResponse,
} from '@/services/api/quota'
import {quotaApi} from '@/services/api/quota'
import type {UsageSummary} from '@/services/api/usage'
import {usageApi} from '@/services/api/usage'
import {useAuthFileRefreshStore} from '@/stores/useAuthFileRefreshStore'
import {useAuthStore} from '@/stores/useAuthStore'
import {useNotificationStore} from '@/stores/useNotificationStore'
import type {AuthFileItem} from '@/types/authFile'
import {formatDateTime} from '@/utils/format'
import {useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'
import styles from './AccountInspectionPanel.module.scss'
import {isQuotaRefreshTaskTerminal} from './hooks/quotaRefreshTask'
import {buildProviderHealthRows} from './providerHealth'

const UI_STATE_KEY      = 'cpa-account-inspection-ui-state'
const DEFAULT_PAGE_SIZE = 25

type ColumnKey = 'account' | 'provider' | 'status' | 'probe' | 'reason' | 'advice' | 'checked_at' | 'actions'
type DetailTab = 'results' | 'quota' | 'logs'
type ReadSection = 'status' | 'results' | 'logs' | 'quotaConfig' | 'quotaStatus' | 'usage' | 'authFiles' |
                   'quotaTasks' | 'quotaTask'
type ReadState = { loading: boolean; error: string; scope?: string }

const inspectionScheduleFields = [
    ['intervalSeconds', 'interval_seconds', 'credentials.inspection_interval', 60, 9223372036],
    ['maxConcurrency', 'max_concurrency', 'credentials.inspection_max_concurrency', 1, Number.MAX_SAFE_INTEGER],
    ['timeoutSeconds', 'timeout_seconds', 'credentials.inspection_timeout', 1, 9223372036],
    ['retentionRuns', 'retention_runs', 'credentials.inspection_retention_runs', 1, Number.MAX_SAFE_INTEGER],
] as const

type ScheduleDraftField = typeof inspectionScheduleFields[number][0]

type UIState = {
    issuesOnly?: boolean
    pageSize?: number
}

type AccountInspectionPanelProps = {
    onCredentialsChanged?: (names?: string[]) => void | Promise<void>
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

function sheetDataStatus(hasRows: boolean, read?: ReadState): DataStatusValue {
    if (hasRows) {
        return 'ready'
    }
    if (read?.error) {
        return 'error'
    }
    return !read || read.loading ? 'loading' : 'empty'
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
        case 'succeeded':
        case 'passed':
            return styles.statusNormal
        case 'disabled':
        case 'skipped':
        case 'cancelled':
            return styles.statusDisabled
        case 'unavailable':
        case 'error':
        case 'stopped':
        case 'failed':
        case 'inconclusive':
        case 'interrupted':
            return styles.statusUnavailable
        case 'queued':
        case 'running':
        case 'paused':
            return styles.statusRunning
        default:
            return styles.statusUnknown
    }
}

function providerStatusClass(status: string): string {
    switch (status) {
        case 'healthy':
            return styles.statusNormal
        case 'warning':
            return styles.statusRunning
        case 'error':
            return styles.statusUnavailable
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

function formatInspectionError(message: string, t: ReturnType<typeof useTranslation>['t']): string {
    switch (message) {
        case 'account inspection timed out':
            return t('credentials.inspection_run_timed_out', { defaultValue: 'Inspection timed out' })
        case 'account inspection stopped by request':
            return t('credentials.inspection_run_stopped', { defaultValue: 'Inspection stopped by request' })
        case 'account no longer matches the inspection target or schedule':
            return t(
                'credentials.inspection_run_target_changed',
                { defaultValue: 'The account or its inspection eligibility changed' },
            )
        case 'failed to save account inspection results':
            return t('credentials.inspection_run_save_failed', { defaultValue: 'Could not save inspection results' })
        case 'failed to save account inspection schedule':
            return t(
                'credentials.inspection_schedule_save_failed',
                { defaultValue: 'Could not save the inspection schedule' },
            )
        case 'account not found':
            return t('credentials.inspection_target_not_found', { defaultValue: 'This account is no longer available' })
        case 'account identifier matches more than one credential':
            return t(
                'credentials.inspection_target_ambiguous',
                { defaultValue: 'More than one credential matches this account' },
            )
        case 'account provider is excluded from the inspection schedule':
            return t(
                'credentials.inspection_target_excluded',
                { defaultValue: 'The inspection schedule excludes this provider' },
            )
        default:
            return message
    }
}

function formatInspectionLogMessage(
    entry: AccountInspectionLogEntry,
    t: ReturnType<typeof useTranslation>['t'],
): string {
    const message = entry.message.trim()
    let match     = /^account inspection started trigger=(?<trigger>\S+)$/.exec(message)
    if (match?.groups) {
        return t('credentials.inspection_log_started', {
            trigger: translateLogToken('credentials.inspection_log_trigger_', match.groups.trigger, t),
            defaultValue: 'Account inspection started, trigger: {{trigger}}',
        })
    }

    match = /^checked (?<account>.+) result=(?<result>\S+) reason=(?<reason>\S+)$/.exec(message)
    if (match?.groups) {
        return t('credentials.inspection_log_checked', {
            account: match.groups.account,
            result: translateLogToken('credentials.inspection_status_', match.groups.result, t),
            reason: translateLogToken('credentials.inspection_reason_', match.groups.reason, t),
            defaultValue: '{{account}} checked, result: {{result}}, reason: {{reason}}',
        })
    }

    match = /^account inspection (?<status>\S+) checked=(?<count>\d+)$/.exec(message)
    if (match?.groups) {
        return t('credentials.inspection_log_finished', {
            status: translateLogToken('credentials.inspection_status_', match.groups.status, t),
            count: match.groups.count,
            defaultValue: 'Account inspection {{status}}, checked {{count}} accounts',
        })
    }

    match = /^account inspection schedule updated enabled=(?<enabled>\S+) interval=(?<interval>\S+)$/.exec(message)
    if (match?.groups) {
        return t('credentials.inspection_log_schedule_updated', {
            enabled:
                match.groups.enabled === 'true'
                ? t('credentials.inspection_log_schedule_enabled', { defaultValue: 'enabled' })
                : t('credentials.inspection_log_schedule_disabled', { defaultValue: 'disabled' }),
            interval: match.groups.interval,
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

    return formatInspectionError(message, t)
}

export function AccountInspectionPanel(props: AccountInspectionPanelProps) {
    const generation = useAuthStore(() => apiClient.getAuthGeneration())
    return <AccountInspectionSession key={generation} authGeneration={generation} {...props} />
}

function AccountInspectionSession({ onCredentialsChanged, authGeneration }: AccountInspectionPanelProps & {
    authGeneration: number
}) {
    const { t, i18n }                                             = useTranslation()
    const showNotification                                        = useNotificationStore((s) => s.showNotification)
    const showConfirmation                                        = useNotificationStore((s) => s.showConfirmation)
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
    const [quotaStatus, setQuotaStatus]                           = useState<QuotaStatusResponse | null>(null)
    const [usageSummary, setUsageSummary]                         = useState<UsageSummary | null>(null)
    const [authFiles, setAuthFiles]                               = useState<AuthFileItem[]>()
    const [tokenRefreshResults, setTokenRefreshResults]           = useState<AuthFileRefreshBatchItem[] | null>(null)
    const [quotaConfigLoaded, setQuotaConfigLoaded]               = useState(false)
    const [quotaDraft, setQuotaDraft]                             = useState({
                                                                                 enabled: false,
                                                                                 intervalMinutes: '10',
                                                                                 maxIntervalMinutes: '30',
                                                                             })
    const quotaDraftStateRef                                      = useRef({ generation: -1, dirty: false })
    const [scheduleDraft, setScheduleDraft]                       = useState(() => scheduleDraftFrom(emptySchedule()))
    const scheduleDraftDirty                                      = useRef(false)
    const [invalidScheduleFields, setInvalidScheduleFields]       = useState<ScheduleDraftField[]>([])
    const [inspectionScheduleLoaded, setInspectionScheduleLoaded] = useState(false)
    const [resultSnapshot, setResultSnapshot]                     = useState<{
        scope: string; rows: AccountInspectionResult[]; total: number
    }>()
    const [logs, setLogs]                                         = useState<AccountInspectionLogEntry[]>([])
    const [reads, setReads]                                       = useState<Partial<Record<ReadSection, ReadState>>>({})
    const readOwners                                              = useRef(new Map<ReadSection, symbol>())
    const [quotaTaskList, setQuotaTaskList]                       = useState<QuotaRefreshTaskList>()
    const [quotaTaskDetail, setQuotaTaskDetail]                   = useState<QuotaRefreshTask>()
    const [selectedTaskId, setSelectedTaskId]                     = useState('')
    const [busyRequest, setBusyRequest]                           = useState<{
                                                                                 action: string;
                                                                                 generation: number
                                                                             } | null>(null)
    const busyRequestRef                                          = useRef<typeof busyRequest>(null)
    const tokenRefreshRequest                                     = useAuthFileRefreshStore((state) => state.request)
    const [dataGeneration, setDataGeneration]                     = useState<number | null>(null)
    const tokenRefreshBusy                                        = tokenRefreshRequest?.generation === authGeneration
    const busyAction                                              = busyRequest?.generation === authGeneration ?
                                                                    busyRequest.action :
                                                                    ''
    const [actionError, setActionError]                           = useState('')
    const latestQuotaTask                                         = status.refresh_queue.latest_task
    const quotaTasks                                              = quotaTaskList?.tasks ??
                                                                    (latestQuotaTask ? [latestQuotaTask] : [])
    const taskPreview                                             = quotaTasks.find((task) => task.id ===
                                                                                              selectedTaskId) ??
                                                                    quotaTasks.find((task) => !isQuotaRefreshTaskTerminal(
                                                                        task)) ?? quotaTasks[0]
    const selectedQuotaTask                                       = quotaTaskDetail &&
                                                                    quotaTaskDetail.id ===
                                                                    taskPreview?.id ? quotaTaskDetail : taskPreview
    const polledTask                                              = detailTab === 'quota' ?
                                                                    selectedQuotaTask :
                                                                    latestQuotaTask
    const polledTaskId                                            = polledTask?.id ?? ''
    const quotaTaskActive                                         = polledTask !==
                                                                    undefined &&
                                                                    !isQuotaRefreshTaskTerminal(polledTask)
    const quotaTaskActionBusy                                     = busyAction.startsWith('quota-')

    const resultsQuery    = useMemo(
        () => ({ status: statusFilter, issuesOnly, includeDisabled, page, pageSize }),
        [statusFilter, issuesOnly, includeDisabled, page, pageSize],
    )
    const resultsScope    = JSON.stringify(resultsQuery)
    const resultsQueryRef = useRef(resultsQuery)
    useLayoutEffect(() => {
        resultsQueryRef.current = resultsQuery
    }, [resultsQuery])
    const currentResult = resultSnapshot?.scope === resultsScope ? resultSnapshot : undefined
    const results       = currentResult?.rows ?? []
    const total         = currentResult?.total ?? 0
    const resultsRead   = reads.results?.scope === resultsScope ? reads.results : undefined
    const taskRead      = reads.quotaTask?.scope === selectedQuotaTask?.id ? reads.quotaTask : undefined
    const loading       = reads.status?.loading ?? false

    useEffect(() => {
        localStorage.setItem(UI_STATE_KEY, JSON.stringify({ issuesOnly, pageSize }))
    }, [issuesOnly, pageSize])

    const read = useCallback(async <T, >(
        section: ReadSection,
        request: () => Promise<T>,
        apply: (value: T) => void,
        scope?: string,
        signal?: AbortSignal,
    ) => {
        if (authGeneration !== apiClient.getAuthGeneration()) {
            return
        }
        const owner = Symbol()
        readOwners.current.set(section, owner)
        const isCurrent = () => readOwners.current.get(section) === owner && !signal?.aborted &&
                                authGeneration === apiClient.getAuthGeneration()
        setReads((prev) => ({
            ...prev,
            [section]: {
                loading: true,
                error: prev[section]?.scope === scope ? prev[section]?.error ?? '' : '',
                scope,
            },
        }))
        try {
            const value = await request()
            if (isCurrent()) {
                apply(value)
                setDataGeneration(authGeneration)
                setReads((prev) => ({ ...prev, [section]: { loading: false, error: '', scope } }))
            }
        } catch (error) {
            if (isCurrent()) {
                const message = error instanceof Error && error.message ? error.message : t('common.unknown_error')
                setReads((prev) => ({ ...prev, [section]: { loading: false, error: message, scope } }))
            }
        }
    }, [authGeneration, t])

    const fetchStatus      = useCallback(() => read('status', accountInspectionApi.getStatus, (response) => {
        const next = normalizeStatusResponse(response)
        setStatus(next)
        if (!scheduleDraftDirty.current) {
            setScheduleDraft(scheduleDraftFrom(next.schedule))
        }
        setInspectionScheduleLoaded(true)
    }), [read])
    const fetchResults     = useCallback(() => {
        const query = resultsQueryRef.current
        const scope = JSON.stringify(query)
        return read('results', () => accountInspectionApi.getResults(query), (response) => {
            if (resultsQueryRef.current === query) {
                setResultSnapshot({
                                      scope,
                                      rows: Array.isArray(response.results) ? response.results : [],
                                      total: typeof response.total === 'number' ? response.total : 0,
                                  })
                if (response.total_pages > 0 && query.page > response.total_pages) {
                    setPage(response.total_pages)
                }
            }
        }, scope)
    }, [read])
    const fetchLogs        = useCallback(() => read('logs', accountInspectionApi.getLogs, (response) => {
        setLogs(Array.isArray(response.logs) ? response.logs : [])
    }), [read])
    const fetchQuotaConfig = useCallback(() => read('quotaConfig', quotaApi.getConfig, (response) => {
        if (typeof response?.enabled !== 'boolean' || !Number.isSafeInteger(response.interval) ||
            !Number.isSafeInteger(response['max-interval'])) {
            throw new Error(t('credentials.quota_config_invalid'))
        }
        if (quotaDraftStateRef.current.generation !== authGeneration || !quotaDraftStateRef.current.dirty) {
            setQuotaDraft({
                              enabled: response.enabled,
                              intervalMinutes: String(response.interval / 60),
                              maxIntervalMinutes: String(response['max-interval'] / 60),
                          })
            quotaDraftStateRef.current = { generation: authGeneration, dirty: false }
        }
        setQuotaConfig(response)
        setQuotaConfigLoaded(true)
    }), [authGeneration, read, t])
    const fetchQuotaStatus = useCallback(() => read('quotaStatus', quotaApi.getStatus, setQuotaStatus), [read])
    const fetchUsage       = useCallback(() => read(
        'usage',
        () => usageApi.getSummary({ groups: 'all' }),
        setUsageSummary,
    ), [read])
    const fetchAuthFiles   = useCallback(() => read('authFiles', authFilesApi.list, (response) => {
        setAuthFiles(response.files)
    }), [read])

    const fetchOverview = useCallback(() => {
        void Promise.all([fetchLogs(), fetchQuotaConfig(), fetchQuotaStatus(), fetchUsage(), fetchAuthFiles()])
        return fetchStatus()
    }, [fetchAuthFiles, fetchLogs, fetchQuotaConfig, fetchQuotaStatus, fetchStatus, fetchUsage])
    const fetchData     = useCallback(() => {
        void fetchResults()
        return fetchOverview()
    }, [fetchOverview, fetchResults])

    useEffect(() => {
        const id = window.setTimeout(() => void fetchOverview(), 0)
        return () => window.clearTimeout(id)
    }, [fetchOverview])
    useEffect(() => {
        const id = window.setTimeout(() => void fetchResults(), 0)
        return () => window.clearTimeout(id)
    }, [fetchResults, resultsQuery])

    useEffect(() => {
        if (status.status !== 'running') {
            return
        }
        let pending = false
        const id    = window.setInterval(async () => {
            if (pending) {
                return
            }
            pending = true
            await fetchStatus()
            await Promise.all([fetchResults(), fetchLogs()])
            pending = false
        }, 2000)
        return () => window.clearInterval(id)
    }, [fetchLogs, fetchResults, fetchStatus, status.status])

    const fetchQuotaTasks = useCallback(() => read('quotaTasks', quotaApi.listTasks, setQuotaTaskList), [read])
    const fetchQuotaTask  = useCallback((taskId: string, signal?: AbortSignal) => read(
        'quotaTask',
        () => quotaApi.getTask(taskId, { signal }),
        (task) => {
            setQuotaTaskDetail(task)
            setStatus((prev) => {
                if (prev.refresh_queue.latest_task?.id !== task.id) {
                    return prev
                }
                return {
                    ...prev,
                    refresh_queue: {
                        ...prev.refresh_queue,
                        latest_task: task,
                        pending: task.summary.queued + task.summary.running,
                        skipped: task.summary.skipped,
                        failed: task.summary.failed + task.summary.inconclusive + task.summary.interrupted,
                    },
                }
            })
        },
        taskId,
        signal,
    ), [read])
    useEffect(() => {
        if (detailTab === 'quota') {
            const id = window.setTimeout(() => void fetchQuotaTasks(), 0)
            return () => window.clearTimeout(id)
        }
    }, [detailTab, fetchQuotaTasks])
    useEffect(() => {
        if (!polledTaskId || (detailTab !== 'quota' && !quotaTaskActive)) {
            return
        }
        const controller = new AbortController()
        let pending      = false
        const poll       = async () => {
            if (!pending) {
                pending = true
                await fetchQuotaTask(polledTaskId, controller.signal)
                pending = false
            }
        }
        const initial    = window.setTimeout(() => void poll(), 0)
        const interval   = quotaTaskActive ? window.setInterval(() => void poll(), 1000) : undefined
        return () => {
            controller.abort()
            window.clearTimeout(initial)
            window.clearInterval(interval)
        }
    }, [detailTab, fetchQuotaTask, polledTaskId, quotaTaskActive])

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
        async (action: string, fn: (isCurrent: () => boolean) => Promise<unknown>) => {
            const isCurrent = () => authGeneration === apiClient.getAuthGeneration()
            if (!isCurrent() || dataGeneration !== authGeneration) {
                setActionError(t('common.connection_changed'))
                return
            }
            if (busyRequestRef.current?.generation === authGeneration) {
                return
            }
            const request          = { action, generation: authGeneration }
            busyRequestRef.current = request
            setBusyRequest(request)
            setActionError('')
            try {
                await fn(isCurrent)
            } catch (err) {
                if (isCurrent()) {
                    setActionError(err instanceof Error ? err.message : t('common.unknown_error'))
                }
            } finally {
                try {
                    if (isCurrent()) {
                        await fetchData()
                    }
                } finally {
                    if (busyRequestRef.current === request) {
                        busyRequestRef.current = null
                    }
                    setBusyRequest((previous) => previous === request ? null : previous)
                }
            }
        },
        [authGeneration, dataGeneration, fetchData, t],
    )

    const updateQuotaDraft = (patch: Partial<typeof quotaDraft>) => {
        quotaDraftStateRef.current = { generation: authGeneration, dirty: true }
        setQuotaDraft((previous) => ({ ...previous, ...patch }))
    }

    const handleSaveQuotaConfig =
              async () => {
                  if (!quotaConfigLoaded ||
                      dataGeneration !==
                      authGeneration ||
                      authGeneration !==
                      apiClient.getAuthGeneration()) {
                      return
                  }
                  const maximumSeconds = 9223372036
                  const minutes        = [quotaDraft.intervalMinutes, quotaDraft.maxIntervalMinutes]
                  if (minutes.some((value) => !value.trim() ||
                                              !Number.isFinite(Number(value)) ||
                                              Number(value) <
                                              0 ||
                                              Number(value) >
                                              maximumSeconds /
                                              60)) {
                      setActionError(t('credentials.quota_config_invalid'));
                      return
                  }
                  const interval = Math.round(Number(minutes[0]) * 60)
                  const maximum  = Math.round(Number(minutes[1]) * 60)
                  const enabled  = quotaDraft.enabled && interval > 0
                  if ((enabled && (interval < 60 || maximum < 300)) || (maximum > 0 && maximum < interval)) {
                      setActionError(t('credentials.quota_config_invalid'));
                      return
                  }
                  const next    = { enabled, interval, 'max-interval': maximum }
                  const changed =
                            Object.fromEntries(
                                Object.entries(next).filter(
                                    ([key, value]) => value !==
                                                      quotaConfig[key as keyof QuotaConfig]))
                  if (Object.keys(changed).length === 0) {
                      return
                  }
                  const apply = () => runAction('quota-config', async (isCurrent) => {
                      await quotaApi.setConfig(changed)
                      if (isCurrent()) {
                          quotaDraftStateRef.current.dirty = false;
                          showNotification(t('common.success'), 'success')
                      }
                  })
                  if (enabled && !quotaConfig.enabled) {
                      showConfirmation({
                                           title: t('credentials.quota_auto_refresh'),
                                           message: t('credentials.quota_enable_warning'),
                                           confirmText: t('common.confirm'),
                                           cancelText: t('common.cancel'),
                                           onConfirm: apply,
                                       })
                  } else {
                      await apply()
                  }
              }

    const handleRefreshAllTokens = useCallback(async () => {
        await runAction('refresh-all-tokens', async (isCurrent) => {
            setTokenRefreshResults(null)
            try {
                const result = await authFilesApi.requestManualRefreshAll()
                if (!isCurrent()) {
                    return
                }
                const succeeded = result.results.filter((item) => item.success).length
                const failed    = result.results.length - succeeded
                setTokenRefreshResults(result.results)
                if (result.results.length === 0) {
                    showNotification(t('credentials.manual_token_refresh_all_none', {
                        defaultValue: 'No eligible credentials to refresh',
                    }), 'warning')
                    return
                }
                showNotification(
                    failed > 0 ?
                    t('credentials.manual_token_refresh_all_partial', {
                        success: succeeded,
                        failed,
                        defaultValue: 'Refreshed {{success}} token(s); {{failed}} failed',
                    }) :
                    t('credentials.manual_token_refresh_all_success', {
                        count: succeeded,
                        defaultValue: 'Refreshed {{count}} token(s)',
                    }),
                    failed === 0 ? 'success' : succeeded === 0 ? 'error' : 'warning',
                )
            } finally {
                if (isCurrent()) {
                    await onCredentialsChanged?.()
                }
            }
        })
    }, [onCredentialsChanged, runAction, showNotification, t])

    const updateScheduleDraft = (field: ScheduleDraftField, value: string) => {
        scheduleDraftDirty.current = true
        setScheduleDraft((prev) => ({ ...prev, [field]: value }))
        setInvalidScheduleFields((prev) => prev.filter((key) => key !== field))
    }

    const saveInspectionSchedule = async (enabled?: boolean) => {
        if (!inspectionScheduleLoaded) {
            return
        }
        const nextSchedule = { ...status.schedule, enabled: enabled ?? status.schedule.enabled }
        if (enabled === undefined) {
            const invalid = inspectionScheduleFields.filter(([field, key, , min, max]) => {
                const input = scheduleDraft[field].trim()
                const value = Number(input)
                if (!/^\d+$/.test(input) || !Number.isSafeInteger(value) || value < min || value > max) {
                    return true
                }
                nextSchedule[key] = value
                return false
            }).map(([field]) => field)
            setInvalidScheduleFields(invalid)
            if (invalid.length > 0) {
                return
            }
        }

        await runAction('inspection-schedule', async (isCurrent) => {
            const saved = normalizeSchedule(await accountInspectionApi.updateSchedule(nextSchedule))
            if (!isCurrent()) {
                return
            }
            readOwners.current.delete('status')
            setStatus((prev) => ({ ...prev, schedule: saved }))
            if (enabled === undefined || !scheduleDraftDirty.current) {
                scheduleDraftDirty.current = false
                setScheduleDraft(scheduleDraftFrom(saved))
            }
            showNotification(t('common.success'), 'success')
        })
    }

    const runQuotaTaskAction = (action: string, request: (id: string) => Promise<QuotaRefreshTask>) => {
        if (!selectedQuotaTask) {
            return
        }
        const id = selectedQuotaTask.id
        void runAction(`${action}-${id}`, async (isCurrent) => {
            await request(id)
            if (isCurrent()) {
                await fetchQuotaTask(id)
            }
        })
    }

    const formatTime = useCallback(
        (value?: string | number | null) => {
            if (!value) {
                return '-'
            }
            const date = new Date(value)
            return Number.isNaN(date.getTime()) ? String(value) : formatDateTime(date, i18n.language)
        },
        [i18n.language],
    )

    const formatPercent = useCallback(
        (value: number) => new Intl.NumberFormat(i18n.language, {
            maximumFractionDigits: value > 0 && value < 0.1 ? 1 : 0,
            style: 'percent',
        }).format(value),
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
            if (result.probe_status === 'outdated') {
                return (
                    <span className={styles.noAction}>
                        {t('credentials.inspection_probe_status_outdated', { defaultValue: '已过期' })}
                    </span>
                )
            }
            const hasBinding = Number.isSafeInteger(result.auth_generation) && result.auth_generation >= 0 &&
                               Boolean(result.credential_digest && result.probe_revision) &&
                               Number.isFinite(Date.parse(result.checked_at))
            if (result.advice ===
                'enable_when_needed' &&
                result.status ===
                'disabled' &&
                result.probe_status ===
                'passed' &&
                hasBinding) {
                return (
                    <Button
                        variant='secondary'
                        size='xs'
                        loading={busyAction === `enable-${key}`}
                        disabled={Boolean(busyAction) || tokenRefreshBusy}
                        onClick={() =>
                            void runAction(`enable-${key}`, async (isCurrent) => {
                                const currentResults = await accountInspectionApi.getAllResults(
                                    {
                                        includeDisabled: true,
                                    })
                                if (!isCurrent()) {
                                    return
                                }
                                const current = currentResults.find((candidate) => rowKey(candidate) ===
                                                                                   key &&
                                                                                   candidate.provider ===
                                                                                   result.provider)
                                if (!current ||
                                    current.advice !==
                                    'enable_when_needed' ||
                                    current.status !==
                                    'disabled' ||
                                    current.probe_status !==
                                    'passed' ||
                                    current.auth_generation !==
                                    result.auth_generation ||
                                    current.credential_digest !==
                                    result.credential_digest ||
                                    current.probe_revision !==
                                    result.probe_revision ||
                                    current.checked_at !==
                                    result.checked_at) {
                                    throw new Error(t('credentials.inspection_result_outdated_retry'))
                                }
                                try {
                                    await authFilesApi.setStatus(result.file_name, false, result.auth_index, {
                                        auth_generation: result.auth_generation,
                                        credential_digest: result.credential_digest,
                                        probe_revision: result.probe_revision,
                                        checked_at: result.checked_at,
                                    })
                                } catch (error) {
                                    if (error instanceof Error && 'status' in error && error.status === 409) {
                                        error.message =
                                            `${t('credentials.inspection_result_outdated_retry')} ${error.message}`
                                    }
                                    throw error
                                }
                                if (!isCurrent()) {
                                    return
                                }
                                await onCredentialsChanged?.([result.file_name])
                                if (isCurrent()) {
                                    showNotification(t('common.success'), 'success')
                                }
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
                        disabled={Boolean(busyAction) || tokenRefreshBusy}
                        onClick={() =>
                            void runAction(`refresh-${key}`, async (isCurrent) => {
                                try {
                                    await authFilesApi.requestManualRefresh(result.file_name, result.auth_index)
                                } finally {
                                    if (isCurrent()) {
                                        await onCredentialsChanged?.([result.file_name])
                                    }
                                }
                                if (!isCurrent()) {
                                    return
                                }
                                showNotification(
                                    t('credentials.manual_token_refresh_success', {
                                        name: result.account || result.file_name,
                                        defaultValue: 'Token refreshed for "{{name}}"',
                                    }),
                                    'success',
                                )
                            })
                        }
                    >
                        {t('credentials.inspection_refresh_token', { defaultValue: '刷新 token' })}
                    </Button>
                )
            }
            if (result.status === 'unknown' || result.status === 'disabled' ||
                ['provider_error', 'probe_failed', 'probe_inconclusive'].includes(result.reason)) {
                return (
                    <Button
                        variant='ghost'
                        size='xs'
                        disabled={status.status === 'running' || Boolean(busyAction) || tokenRefreshBusy}
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
        [busyAction, onCredentialsChanged, runAction, showNotification, status.status, t, tokenRefreshBusy],
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
                columnKey: 'probe',
                key: 'probe_status',
                header: t('credentials.inspection_probe', { defaultValue: '主动探测' }),
                sortable: true,
                sortValue: (row) => row.probe_status,
                cell: (row) => {
                    const digest = row.credential_digest || ''
                    return (
                        <div className={styles.probeCell} title={row.probe_error || undefined}>
                            <span className={`${styles.statusBadge} ${statusClass(row.probe_status)}`}>
                                {t(`credentials.inspection_probe_status_${row.probe_status}`, {
                                    defaultValue: row.probe_status,
                                })}
                            </span>
                            <span className={styles.probeMeta}>
                                {t('credentials.inspection_probe_revision', { defaultValue: '协议' })}:{' '}
                                {row.probe_revision || '-'}
                            </span>
                            <span className={styles.probeMeta}>
                                {t('credentials.inspection_auth_generation', { defaultValue: '凭证代际' })}:{' '}
                                {row.auth_generation}
                            </span>
                            <span className={styles.probeMeta}>
                                {t('credentials.inspection_credential_digest', { defaultValue: '凭证摘要' })}:{' '}
                                <code className={styles.probeDigest} title={digest || undefined}>
                                    {digest ? `${digest.slice(0, 12)}…` : '-'}
                                </code>
                            </span>
                        </div>
                    )
                },
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

    const totalPages                 = Math.max(1, Math.ceil(total / pageSize))
    const sheetStatus                = sheetDataStatus(results.length > 0, resultsRead)
    const visibleLogs                = useMemo(() => logs.slice(-80), [logs])
    const providerHealthRows         = useMemo(
        () => buildProviderHealthRows({ inspectionStatus: status, quotaStatus, usageSummary, authFiles }),
        [authFiles, quotaStatus, status, usageSummary],
    )
    const lastRun                    = status.last_run
    const lastRunResultLabel         = lastRun ? t('credentials.inspection_last_run_result', {
        checked: lastRun.checked,
        defaultValue: '{{checked}} accounts',
    }) : ''
    const logsSheetStatus            = sheetDataStatus(visibleLogs.length > 0, reads.logs)
    const renderReadError            = (state: ReadState | undefined, retry: () => void, label?: string) =>
        state?.error && (
                         <div className={styles.readError} role='alert'>
                             <span>{label ? `${label}: ${state.error}` : state.error}</span>
                             <Button variant='secondary' size='xs' onClick={retry} loading={state.loading}>
                                 {t('common.retry')}
                             </Button>
                         </div>
                     )
    const logColumns                 = useMemo<SheetColumn<AccountInspectionLogEntry>[]>(() => [
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
    const quotaTaskColumns           = useMemo<SheetColumn<QuotaRefreshTaskTarget>[]>(() => [
        {
            key: 'provider',
            header: t('credentials.quota_task_provider', { defaultValue: 'Provider' }),
            cell: (target) => target.provider || '-',
        },
        {
            key: 'credential',
            header: t('credentials.quota_task_credential', { defaultValue: '凭证' }),
            cell: (target) => {
                const name = target.file_name || target.identifier || target.entry_key || target.id
                return <span className={styles.taskCredential} title={name}>{name}</span>
            },
        },
        {
            key: 'status',
            header: t('credentials.quota_task_target_status', { defaultValue: '目标状态' }),
            cell: (target) => (
                <span className={`${styles.statusBadge} ${statusClass(target.status)}`}>
                    {t(`credentials.quota_task_status_${target.status}`, { defaultValue: target.status })}
                </span>
            ),
        },
        {
            key: 'result',
            header: t('credentials.quota_task_result', { defaultValue: '结果' }),
            cell: (target) => (
                <span className={styles.taskResult}>
                    {target.error || (target.shared_execution
                                      ?
                                      t('credentials.quota_task_shared_execution', { defaultValue: '复用同一目标刷新' })
                                      :
                                      '-')}
                </span>
            ),
        },
        {
            key: 'started_at',
            header: t('credentials.quota_task_started_at', { defaultValue: '开始时间' }),
            cell: (target) => <span className={styles.timeCell}>{formatTime(target.started_at)}</span>,
        },
        {
            key: 'completed_at',
            header: t('credentials.quota_task_completed_at', { defaultValue: '完成时间' }),
            cell: (target) => <span className={styles.timeCell}>{formatTime(target.completed_at)}</span>,
        },
    ], [formatTime, t])
    const tokenRefreshColumns        = useMemo<SheetColumn<AuthFileRefreshBatchItem>[]>(() => [
        {
            key: 'provider',
            header: t('credentials.quota_task_provider'),
            cell: (item) => item.provider || '-',
        },
        {
            key: 'filename',
            header: t('credentials.quota_task_credential'),
            cell: (item) => <span className={styles.taskCredential}>{item.filename}</span>,
        },
        {
            key: 'auth_index',
            header: t('credentials.manual_token_refresh_identity'),
            cell: (item) => <span className={styles.taskCredential}>{item.auth_index}</span>,
        },
        {
            key: 'result',
            header: t('credentials.quota_task_result'),
            cell: (item) => (
                <span className={styles.rowActions}>
                    <span className={`${styles.statusBadge} ${item.success ?
                                                              styles.statusNormal :
                                                              styles.statusUnavailable}`}>
                        {t(item.success ? 'credentials.refresh_status_success' : 'credentials.refresh_status_error')}
                    </span>
                    <span className={styles.taskResult}>{item.error || item.status || '-'}</span>
                </span>
            ),
        },
        {
            key: 'refreshed_at',
            header: t('credentials.quota_task_completed_at'),
            cell: (item) => <span className={styles.timeCell}>{formatTime(item.refreshed_at)}</span>,
        },
    ], [formatTime, t])
    const taskHistoryError           = reads.quotaTasks?.error || (quotaTaskList?.persistence_error ?
                                                                   t(
                                                                       'credentials.quota_task_history_unavailable',
                                                                       { defaultValue: 'Saved task history is unavailable' },
                                                                   ) : '')
    const quotaTaskSheetStatus       = sheetDataStatus(
        Boolean(selectedQuotaTask?.targets.length),
        taskRead ?? (reads.quotaTasks && { ...reads.quotaTasks, error: taskHistoryError }),
    )
    const inspectionScheduleDisabled = !inspectionScheduleLoaded || Boolean(busyAction)
    const sheetEmptyHint             =
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
                        <strong>{inspectionScheduleLoaded ? status.summary.total : '—'}</strong>
                    </div>
                    <div className={styles.metric}>
                        <span>{t('credentials.inspection_normal', { defaultValue: '正常' })}</span>
                        <strong>{inspectionScheduleLoaded ? status.summary.normal : '—'}</strong>
                    </div>
                    <div className={styles.metric}>
                        <span>{t('credentials.inspection_abnormal', { defaultValue: '异常' })}</span>
                        <strong>{inspectionScheduleLoaded ? status.summary.abnormal : '—'}</strong>
                    </div>
                    <div className={styles.metric}>
                        <span>{t('credentials.inspection_token_invalid', { defaultValue: 'Token 失效' })}</span>
                        <strong>{inspectionScheduleLoaded ? status.summary.token_invalid : '—'}</strong>
                    </div>
                    <div className={styles.metric}>
                        <span>{t('credentials.inspection_refresh_failed', { defaultValue: '刷新失败' })}</span>
                        <strong>{inspectionScheduleLoaded ? status.summary.refresh_failed : '—'}</strong>
                    </div>
                    <div className={styles.metric}>
                        <span>{t('credentials.inspection_disabled', { defaultValue: '已禁用' })}</span>
                        <strong>{inspectionScheduleLoaded ? status.summary.disabled : '—'}</strong>
                    </div>
                </div>

                <div className={styles.statusPanel}>
                    <div>
                        <div className={styles.sectionTitle}>
                            {t('credentials.inspection_runtime_status', { defaultValue: '运行状态' })}
                        </div>
                        <div className={styles.statusLine}>
                            {lastRun && (
                                <span>
                                    {t('credentials.inspection_last_run', { defaultValue: 'Last inspection' })}:{' '}
                                    {formatTime(lastRun.started_at)} · {lastRunResultLabel}
                                    {lastRun.error && ` · ${formatInspectionError(lastRun.error, t)}`}
                                </span>
                            )}
                            <span>
                                    {t('credentials.next_refresh_at', { defaultValue: '下次刷新' })}:{' '}
                                {formatTime(status.refresh_queue.next_refresh)}
                                </span>
                            {latestQuotaTask && (
                                <span>
                                    {t(
                                        'credentials.quota_task_latest',
                                        { defaultValue: 'Latest quota refresh task' },
                                    )}:{' '}
                                    {status.refresh_queue.pending}{' '}{t('credentials.inspection_refresh_pending')} ·{' '}
                                    {status.refresh_queue.skipped}{' '}{t('credentials.inspection_refresh_skipped')} ·{' '}
                                    {status.refresh_queue.failed}{' '}{t('credentials.inspection_refresh_failed_queue')}
                                </span>
                            )}
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
                            disabled={!inspectionScheduleLoaded ||
                                      status.status ===
                                      'running' ||
                                      Boolean(busyAction) ||
                                      tokenRefreshBusy}
                            onClick={() => void runAction('run', accountInspectionApi.run)}
                        >
                            {t('credentials.inspection_run_now', { defaultValue: '立即巡检' })}
                        </Button>
                        <Button
                            variant='secondary'
                            size='sm'
                            disabled={status.status !== 'running' || Boolean(busyAction) || tokenRefreshBusy}
                            loading={busyAction === 'stop'}
                            onClick={() => void runAction('stop', accountInspectionApi.stop)}
                        >
                            {t('credentials.inspection_stop', { defaultValue: '停止' })}
                        </Button>
                        <Button
                            variant='secondary'
                            size='sm'
                            loading={busyAction === 'refresh-all-tokens'}
                            disabled={Boolean(busyAction) || tokenRefreshBusy || dataGeneration !== authGeneration}
                            onClick={() => showConfirmation({
                                                                title: t('credentials.manual_token_refresh_all'),
                                                                message: t('credentials.manual_token_refresh_confirm'),
                                                                confirmText: t('credentials.manual_token_refresh_all'),
                                                                cancelText: t('common.cancel'),
                                                                onConfirm: handleRefreshAllTokens,
                                                            })}
                        >
                            {t('credentials.manual_token_refresh_all', { defaultValue: 'Refresh all tokens' })}
                        </Button>
                        <Button variant='ghost' size='sm' onClick={() => void fetchData()} loading={loading}>
                            {t('common.refresh')}
                        </Button>
                    </div>
                </div>

                {renderReadError(reads.status, fetchStatus, t('credentials.inspection_runtime_status'))}

                {tokenRefreshResults !== null && (
                    <div className={styles.sectionCard}>
                        <div className={styles.sectionHeaderCompact}>
                            <div className={styles.sectionTitle}>{t('credentials.manual_token_refresh_results')}</div>
                            <Button variant='ghost' size='sm' onClick={() => setTokenRefreshResults(null)}>
                                {t('common.close')}
                            </Button>
                        </div>
                        <Sheet
                            rows={tokenRefreshResults}
                            columns={tokenRefreshColumns}
                            rowKey={(item, index) => `${item.filename}-${item.auth_index}-${index}`}
                            status={tokenRefreshResults.length > 0 ? 'ready' : 'empty'}
                            emptyText={t('credentials.manual_token_refresh_all_none')}
                            pagination
                        />
                    </div>
                )}

                <div className={styles.providerHealthSection}>
                    <div className={styles.sectionHeaderCompact}>
                        <div>
                            <div className={styles.sectionTitle}>
                                {t('credentials.provider_health_title', { defaultValue: 'Provider 健康概览' })}
                            </div>
                            <div className={styles.statusHint}>
                                {t('credentials.provider_health_hint', {
                                    defaultValue: '汇总账号巡检、quota 轮询、运行请求和冷却时间，详情仍以巡检结果为准',
                                })}
                            </div>
                        </div>
                    </div>
                    {renderReadError(reads.quotaStatus, fetchQuotaStatus, t('credentials.quota_auto_refresh'))}
                    {renderReadError(reads.usage, fetchUsage, t('nav.usage_stats'))}
                    {renderReadError(reads.authFiles, fetchAuthFiles, t('nav.credentials'))}
                    {providerHealthRows.length === 0 ? (
                        <div className={styles.providerHealthEmpty}>
                            {t('credentials.provider_health_empty', { defaultValue: '暂无 provider 健康数据' })}
                        </div>
                    ) : (
                         <div className={styles.providerHealthGrid}>
                             {providerHealthRows.map((row) => (
                                 <div className={styles.providerHealthCard} key={row.provider}>
                                     <div className={styles.providerHealthHeader}>
                                         <strong>{row.provider}</strong>
                                         <span className={`${styles.statusBadge} ${providerStatusClass(row.status)}`}>
                                             {t(`credentials.provider_health_status_${row.status}`, {
                                                 defaultValue: row.status,
                                             })}
                                         </span>
                                     </div>
                                     <div className={styles.providerHealthMetrics}>
                                         <span>
                                             {t('credentials.provider_health_accounts', { defaultValue: '账号' })}:{' '}
                                             <strong>{row.accountCountsAvailable ? row.accountTotal : '—'}</strong>
                                         </span>
                                         <span>
                                             {t('credentials.provider_health_abnormal', { defaultValue: '异常' })}:{' '}
                                             <strong>{row.accountCountsAvailable ? row.abnormal : '—'}</strong>
                                         </span>
                                         <span>
                                             {t('credentials.inspection_disabled', { defaultValue: '已禁用' })}:{' '}
                                             <strong>{row.accountCountsAvailable ? row.disabled : '—'}</strong>
                                         </span>
                                         <span>
                                             {t(
                                                 'credentials.inspection_status_unavailable',
                                                 { defaultValue: '不可用' },
                                             )}:{' '}
                                             <strong>{row.accountCountsAvailable ? row.unavailable : '—'}</strong>
                                         </span>
                                         <span>
                                             {t(
                                                 'credentials.inspection_token_invalid',
                                                 { defaultValue: 'Token 失效' },
                                             )}:{' '}
                                             <strong>{row.inspectionAvailable ? row.tokenInvalid : '—'}</strong>
                                         </span>
                                         <span>
                                             {t(
                                                 'credentials.inspection_refresh_failed',
                                                 { defaultValue: '刷新失败' },
                                             )}:{' '}
                                             <strong>{row.accountCountsAvailable ? row.refreshFailed : '—'}</strong>
                                         </span>
                                         <span>
                                             {t(
                                                 'credentials.provider_health_quota',
                                                 { defaultValue: 'Quota 异常' },
                                             )}:{' '}
                                             <strong>{row.quotaAvailable ?
                                                      row.quotaError + row.quotaBanned + row.quotaExceeded :
                                                      '—'}</strong>
                                         </span>
                                         <span>
                                             {t(
                                                 'credentials.provider_health_error_rate',
                                                 { defaultValue: '错误率' },
                                             )}:{' '}
                                             <strong>{row.errorRate === null ?
                                                      '—' :
                                                      formatPercent(row.errorRate)}</strong>
                                         </span>
                                     </div>
                                     <div className={styles.providerHealthMeta}>
                                         <span>
                                             {t(
                                                 'credentials.provider_health_last_checked',
                                                 { defaultValue: '最近巡检' },
                                             )}:{' '}
                                             {formatTime(row.lastCheckedAt)}
                                         </span>
                                         <span>
                                             {t(
                                                 'credentials.provider_health_next_retry',
                                                 { defaultValue: '下次恢复/轮询' },
                                             )}:{' '}
                                             {formatTime(row.nextRetryAfter ?? row.nextRefreshAt)}
                                         </span>
                                     </div>
                                 </div>
                             ))}
                         </div>
                     )}
                </div>

                <div className={styles.settingsGrid}>
                    <div className={styles.settingsCard} id='quota-refresh-settings'>
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
                                    {quotaConfigLoaded ?
                                     t(quotaConfig.enabled ? 'common.enabled' : 'common.disabled') :
                                     '—'}
                                </span>
                        </div>
                        {renderReadError(reads.quotaConfig, fetchQuotaConfig)}
                        <div className={styles.settingsFields}>
                            <ToggleSwitch label={t('credentials.quota_auto_refresh')} checked={quotaDraft.enabled}
                                          disabled={!quotaConfigLoaded ||
                                                    dataGeneration !==
                                                    authGeneration ||
                                                    Boolean(busyAction)}
                                          onChange={(enabled) => updateQuotaDraft({ enabled })} />
                            <Input label={t('credentials.quota_interval_minutes')} type='number' min={0} step='any'
                                   value={quotaDraft.intervalMinutes} disabled={!quotaConfigLoaded ||
                                                                                dataGeneration !==
                                                                                authGeneration ||
                                                                                Boolean(busyAction)}
                                   onChange={(event) => updateQuotaDraft({ intervalMinutes: event.target.value })} />
                            <Input label={t('credentials.quota_max_interval_minutes')} type='number' min={0} step='any'
                                   value={quotaDraft.maxIntervalMinutes} disabled={!quotaConfigLoaded ||
                                                                                   dataGeneration !==
                                                                                   authGeneration ||
                                                                                   Boolean(busyAction)}
                                   onChange={(event) => updateQuotaDraft({ maxIntervalMinutes: event.target.value })} />
                            <Button type='button' variant='secondary' size='sm'
                                    onClick={() => void handleSaveQuotaConfig()} disabled={!quotaConfigLoaded ||
                                                                                           dataGeneration !==
                                                                                           authGeneration ||
                                                                                           Boolean(busyAction)}>{t(
                                'common.save')}</Button>
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
                            {inspectionScheduleFields.map(([field, , label, min, max]) => (
                                <div key={field} className={styles.settingsField}>
                                    <Input
                                        label={t(label)}
                                        type='number'
                                        min={min}
                                        max={max}
                                        step={1}
                                        value={scheduleDraft[field]}
                                        onChange={(event) => updateScheduleDraft(field, event.target.value)}
                                        disabled={inspectionScheduleDisabled}
                                        error={invalidScheduleFields.includes(field) ?
                                               t('credentials.inspection_schedule_integer_range', {
                                                   min: min.toLocaleString(i18n.language),
                                                   max: max.toLocaleString(i18n.language),
                                                   defaultValue: 'Enter a whole number from {{min}} to {{max}}',
                                               }) :
                                               undefined}
                                    />
                                </div>
                            ))}
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

                {actionError &&
                 <div className={styles.error} role='alert'>{formatInspectionError(actionError, t)}</div>}

                <Tabs
                    items={[
                        {
                            value: 'results',
                            label: t('credentials.inspection_results_tab', { defaultValue: '巡检结果' }),
                        },
                        {
                            value: 'quota',
                            label: t('credentials.quota_task_tab', { defaultValue: '配额刷新任务' }),
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

                        {results.length > 0 && renderReadError(resultsRead, fetchResults)}
                        <Sheet
                            rows={results}
                            columns={columns}
                            rowKey={(row) => rowKey(row)}
                            status={sheetStatus}
                            errorMessage={resultsRead?.error}
                            onRetry={fetchResults}
                            retrying={resultsRead?.loading}
                            emptyText={t('credentials.inspection_empty', { defaultValue: '暂无巡检结果' })}
                            emptyHint={sheetEmptyHint}
                            loadingText={t('common.loading')}
                            refreshing={resultsRead?.loading && results.length > 0}
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
                ) : detailTab === 'quota' ? (
                    <div className={styles.sectionCard}>
                        <div className={styles.tableControls}>
                            {quotaTasks.length > 0 && (
                                <Select
                                    value={selectedQuotaTask?.id ?? ''}
                                    options={quotaTasks.map((task) => ({
                                        value: task.id,
                                        label: `${t(
                                            `credentials.quota_task_status_${task.id === selectedQuotaTask?.id ?
                                                                             selectedQuotaTask.status :
                                                                             task.status}`,
                                            { defaultValue: task.status },
                                        )} · ${formatTime(task.created_at)} · ${task.id.slice(0, 8)}`,
                                    }))}
                                    onChange={setSelectedTaskId}
                                    ariaLabel={t(
                                        'credentials.quota_task_select',
                                        { defaultValue: 'Select a refresh task' },
                                    )}
                                    disabled={quotaTaskActionBusy}
                                    fullWidth={false}
                                />
                            )}
                            <Button variant='ghost' size='sm' loading={reads.quotaTasks?.loading} onClick={() => {
                                void fetchQuotaTasks()
                                if (selectedQuotaTask) {
                                    void fetchQuotaTask(selectedQuotaTask.id)
                                }
                            }}>
                                {t('common.refresh')}
                            </Button>
                        </div>
                        {selectedQuotaTask && taskHistoryError && renderReadError(
                            { loading: reads.quotaTasks?.loading ?? false, error: taskHistoryError }, fetchQuotaTasks,
                        )}
                        {selectedQuotaTask && (
                            <>
                                <div className={styles.statusPanel}>
                                    <div>
                                        <div className={styles.taskHeaderLine}>
                                            <div className={styles.sectionTitle}>
                                                {t(
                                                    'credentials.quota_task_tab',
                                                    { defaultValue: 'Quota refresh task' },
                                                )}
                                            </div>
                                            <span
                                                className={`${styles.statusBadge} ${
                                                    statusClass(selectedQuotaTask.status)}`}>
                                                {t(`credentials.quota_task_status_${selectedQuotaTask.status}`, {
                                                    defaultValue: selectedQuotaTask.status,
                                                })}
                                            </span>
                                        </div>
                                        <div className={styles.statusLine}>
                                            <span>
                                                {t('credentials.quota_task_id', { defaultValue: '任务 ID' })}:{' '}
                                                <code className={styles.taskId}>{selectedQuotaTask.id}</code>
                                            </span>
                                            <span>
                                                {t(
                                                    'credentials.quota_task_created_at',
                                                    { defaultValue: '创建时间' },
                                                )}:{' '}
                                                {formatTime(selectedQuotaTask.created_at)}
                                            </span>
                                            <span>
                                                {t(
                                                    'credentials.quota_task_started_at',
                                                    { defaultValue: '开始时间' },
                                                )}:{' '}
                                                {formatTime(selectedQuotaTask.started_at)}
                                            </span>
                                            <span>
                                                {t(
                                                    'credentials.quota_task_completed_at',
                                                    { defaultValue: '完成时间' },
                                                )}:{' '}
                                                {formatTime(selectedQuotaTask.completed_at)}
                                            </span>
                                        </div>
                                    </div>
                                    <div className={styles.actionsRow}>
                                        <Button
                                            variant='secondary'
                                            size='sm'
                                            loading={busyAction === `quota-pause-${selectedQuotaTask.id}`}
                                            disabled={Boolean(busyAction) ||
                                                      !['queued', 'running'].includes(selectedQuotaTask.status)}
                                            onClick={() => runQuotaTaskAction('quota-pause', quotaApi.pauseTask)}
                                        >
                                            {t('credentials.quota_task_pause', { defaultValue: '暂停' })}
                                        </Button>
                                        <Button
                                            variant='secondary'
                                            size='sm'
                                            loading={busyAction === `quota-resume-${selectedQuotaTask.id}`}
                                            disabled={Boolean(busyAction) || selectedQuotaTask.status !== 'paused'}
                                            onClick={() => runQuotaTaskAction('quota-resume', quotaApi.resumeTask)}
                                        >
                                            {t('credentials.quota_task_resume', { defaultValue: '继续' })}
                                        </Button>
                                        <Button
                                            variant='danger'
                                            size='sm'
                                            loading={busyAction === `quota-cancel-${selectedQuotaTask.id}`}
                                            disabled={Boolean(busyAction) ||
                                                      isQuotaRefreshTaskTerminal(selectedQuotaTask)}
                                            onClick={() => runQuotaTaskAction('quota-cancel', quotaApi.cancelTask)}
                                        >
                                            {t('credentials.quota_task_cancel', { defaultValue: '取消' })}
                                        </Button>
                                    </div>
                                </div>
                                <div className={styles.summaryGrid}>
                                    {([
                                        ['total', selectedQuotaTask.summary.total, '目标'],
                                        ['queued', selectedQuotaTask.summary.queued, '排队'],
                                        ['running', selectedQuotaTask.summary.running, '执行中'],
                                        ['succeeded', selectedQuotaTask.summary.succeeded, '成功'],
                                        ['failed', selectedQuotaTask.summary.failed, '失败'],
                                        ['skipped', selectedQuotaTask.summary.skipped, '跳过'],
                                        ['cancelled', selectedQuotaTask.summary.cancelled, '取消'],
                                        ['inconclusive', selectedQuotaTask.summary.inconclusive, '无法判定'],
                                        ['interrupted', selectedQuotaTask.summary.interrupted, '已中断'],
                                    ] as const).map(([key, value, label]) => (
                                        <div className={styles.metric} key={key}>
                                            <span>{t(`credentials.quota_task_summary_${key}`, {
                                                defaultValue: label,
                                            })}</span>
                                            <strong>{value}</strong>
                                        </div>
                                    ))}
                                </div>
                                {(selectedQuotaTask.error || selectedQuotaTask.persistence_error) && (
                                    <div className={styles.error}>
                                        {[selectedQuotaTask.error, selectedQuotaTask.persistence_error]
                                            .filter(Boolean)
                                            .join(' · ')}
                                    </div>
                                )}
                            </>
                        )}
                        {selectedQuotaTask && selectedQuotaTask.targets.length > 0 && renderReadError(
                            taskRead,
                            () => void fetchQuotaTask(selectedQuotaTask.id),
                        )}
                        <Sheet
                            rows={selectedQuotaTask?.targets ?? []}
                            columns={quotaTaskColumns}
                            rowKey={(target) => target.id}
                            status={quotaTaskSheetStatus}
                            errorMessage={taskRead?.error || taskHistoryError}
                            onRetry={selectedQuotaTask ?
                                     () => void fetchQuotaTask(selectedQuotaTask.id) :
                                     fetchQuotaTasks}
                            retrying={taskRead?.loading ?? reads.quotaTasks?.loading}
                            emptyText={t('credentials.quota_task_empty', { defaultValue: '暂无配额刷新任务' })}
                            loadingText={t('common.loading')}
                        />
                    </div>
                ) : (
                        <div className={styles.sectionCard}>
                            {visibleLogs.length > 0 && renderReadError(reads.logs, fetchLogs)}
                            <Sheet
                                rows={visibleLogs}
                                columns={logColumns}
                                rowKey={(entry, index) => `${entry.time}-${index}`}
                                status={logsSheetStatus}
                                errorMessage={reads.logs?.error}
                                onRetry={fetchLogs}
                                retrying={reads.logs?.loading}
                                emptyText={t('credentials.inspection_logs_empty', { defaultValue: '暂无巡检日志' })}
                                loadingText={t('common.loading')}
                                refreshing={reads.logs?.loading && visibleLogs.length > 0}
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
                                    <Button variant='ghost' size='sm' onClick={() => void fetchLogs()}
                                            loading={reads.logs?.loading}>
                                        {t('common.refresh')}
                                    </Button>
                                )}
                            />
                        </div>
                    )}
            </div>
        </div>
    )
}
