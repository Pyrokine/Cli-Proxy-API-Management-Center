import type {DataStatusValue} from '@/components/common/DataStatusCard'
import {Sheet, type SheetColumn} from '@/components/common/Sheet'
import {usePageTransitionLayer} from '@/components/common/PageTransitionLayer'
import {Button} from '@/components/ui/Button'
import {Card} from '@/components/ui/Card'
import {
    IconChevronDown,
    IconChevronUp,
    IconCode,
    IconCopy,
    IconDownload,
    IconEyeOff,
    IconMaximize2,
    IconMinimize2,
    IconRefreshCw,
    IconSearch,
    IconSlidersHorizontal,
    IconTimer,
    IconTrash2,
    IconX,
} from '@/components/ui/icons'
import {Input} from '@/components/ui/Input'
import {Modal} from '@/components/ui/Modal'
import {Pagination} from '@/components/ui/Pagination'
import {lockScroll, unlockScroll} from '@/components/ui/scrollLock'
import {Select} from '@/components/ui/Select'
import {Tabs} from '@/components/ui/Tabs'
import {ToggleSwitch} from '@/components/ui/ToggleSwitch'
import {useHeaderRefresh} from '@/hooks/useHeaderRefresh'
import {useLocalStorage} from '@/hooks/useLocalStorage'
import {configApi} from '@/services/api/config'
import {apiClient} from '@/services/api/client'
import {logsApi, type ErrorLogFile, type LogsQuery} from '@/services/api/logs'
import {useAuthStore, useConfigStore, useNotificationStore} from '@/stores'
import {AUTO_REFRESH_INTERVALS, resolveAutoRefreshMs} from '@/utils/autoRefresh'
import {copyToClipboard} from '@/utils/clipboard'
import {MANAGEMENT_API_PREFIX} from '@/utils/constants'
import {downloadBlob} from '@/utils/download'
import {formatFileSize, formatLogTimestamp, formatNumber, formatUnixTimestamp} from '@/utils/format'
import {redactSensitiveText} from '@/utils/redaction'
import {formatDurationMs, formatThinkingLabel} from '@/utils/usage'
import type {PointerEvent as ReactPointerEvent} from 'react'
import {useCallback, useDeferredValue, useEffect, useMemo, useReducer, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {errorLogViewerReducer} from './hooks/errorLogViewer'
import {appendLogBuffer, emptyLogBuffer, replaceLogBuffer, shouldCatchUpLogPage} from './hooks/logBuffer'
import {shouldExitLogFullscreen} from './hooks/logFullscreen'
import {createLogParserCache} from './hooks/logParsing'
import {createLogRequestGuard, createLogRequestQueue} from './hooks/logRequests'
import {
    HTTP_METHODS,
    type LogState,
    type ParsedLogLine,
    type PersistedLogFilters,
    STATUS_GROUPS,
} from './hooks/logTypes'
import type {RouteDecisionCooldown, RouteDecisionQuotaStatus} from './hooks/routeDecisionTrace'
import {matchesLogFilters, useLogFilters} from './hooks/useLogFilters'
import {isTraceableRequestPath, useTraceResolver} from './hooks/useTraceResolver'
import styles from './LogsPage.module.scss'

// 每页只渲染当前页的日志，缓存最多保留 10000 行
const MAX_BUFFER_LINES          = 10000
const MAX_LOG_PAGES_PER_READ    = 3
const FAST_CATCH_UP_MS          = 1000
const INITIAL_RETRY_MS          = 8000
const MAX_RETRY_MS              = 60000
const DEFAULT_LOG_PAGE_SIZE     = 50
const LONG_PRESS_MS             = 650
const LONG_PRESS_MOVE_THRESHOLD = 10
const LOG_LINE_TIMESTAMP_REGEX  = /^\[?(?<ts>\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2})/

const REFRESH_INTERVAL_OPTIONS: ReadonlyArray<{ value: string; label: string }> = AUTO_REFRESH_INTERVALS
const DEFAULT_PERSISTED_LOG_FILTERS: PersistedLogFilters                        = {
    methodFilters: [],
    statusFilters: [],
    pathFilters: [],
}

function formatRefreshIntervalLabel(value: number): string {
    if (value <= 0) {
        return '0s'
    }
    if (value % 1000 === 0) {
        return `${value / 1000}s`
    }
    return `${value}ms`
}

const getErrorMessage = (err: unknown): string => {
    if (err instanceof Error) {
        return err.message
    }
    if (typeof err === 'string') {
        return err
    }
    if (typeof err !== 'object' || err === null) {
        return ''
    }
    if (!('message' in err)) {
        return ''
    }

    const message = (err as { message?: unknown }).message
    return typeof message === 'string' ? message : ''
}

const responseDataToText = async (data: unknown): Promise<string> => {
    if (typeof Blob !== 'undefined' && data instanceof Blob) {
        return data.text()
    }
    if (typeof data === 'string') {
        return data
    }
    return String(data ?? '')
}

const numberFromValue = (value: number | string | null | undefined): number | null => {
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : null
    }
    if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value)
        return Number.isFinite(parsed) ? parsed : null
    }
    return null
}

const overlapAfterValue = (value: number | string | undefined): number | string | undefined => {
    if (typeof value === 'number') {
        return Math.max(0, value - 1)
    }
    if (typeof value === 'string') {
        const parsed = Date.parse(value)
        return Number.isFinite(parsed) ? new Date(Math.max(0, parsed - 1000)).toISOString() : value
    }
    return undefined
}

const cursorSeconds = (value: number | string | undefined): number | null => {
    const numeric = numberFromValue(value)
    if (numeric !== null) {
        return numeric
    }
    if (typeof value !== 'string') {
        return null
    }
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null
}

const lineTimestampSeconds = (line: string): number | null => {
    const timestamp = line.match(LOG_LINE_TIMESTAMP_REGEX)?.groups?.ts
    if (!timestamp) {
        return null
    }
    const parsed = Date.parse(timestamp.replace(' ', 'T'))
    return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null
}

const overlapLineLimit = (buffer: string[], requestAfter: number | string | undefined): number => {
    const after = cursorSeconds(requestAfter)
    if (after === null) {
        return 0
    }
    let count                = 0
    let pendingContinuations = 0
    for (let index = buffer.length - 1; index >= 0; --index) {
        const lineSeconds = lineTimestampSeconds(buffer[index])
        if (lineSeconds === null) {
            ++pendingContinuations
            continue
        }
        if (lineSeconds > after) {
            count += pendingContinuations + 1
            pendingContinuations = 0
            continue
        }
        break
    }
    return count
}

const dropOverlappingLogLines = (buffer: string[], lines: string[], maxOverlap: number): string[] => {
    const overlap = Math.min(buffer.length, lines.length, maxOverlap)
    for (let size = overlap; size > 0; --size) {
        let matched = true
        for (let index = 0; index < size; ++index) {
            if (buffer[buffer.length - size + index] !== lines[index]) {
                matched = false
                break
            }
        }
        if (matched) {
            return lines.slice(size)
        }
    }
    return lines
}

const formatTraceDuration = (value: number | string | null | undefined, locale: string, missingText: string): string =>
    formatDurationMs(numberFromValue(value), { locale, invalidText: missingText })

const formatTracePercent = (
    cachedTokens: number | null,
    inputTokens: number | null,
    locale: string,
    missingText: string,
): string => {
    if (cachedTokens === null || inputTokens === null || inputTokens <= 0) {
        return missingText
    }
    const value = (cachedTokens / inputTokens) * 100
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value)}%`
}

const formatTraceToken = (value: number | null, locale: string, missingText: string): string =>
    value === null ? missingText : formatNumber(value, locale)

const maxTraceTokenValue = (...values: Array<number | string | null | undefined>): number | null => {
    const parsed = values
        .map(numberFromValue)
        .filter((value): value is number => value !== null)
        .map((value) => Math.max(value, 0))
    return parsed.length > 0 ? Math.max(...parsed) : null
}

type TabType = 'logs' | 'errors'

type LogPosition = {
    after?: number | string
    cursor?: string
}

export function LogsPage() {
    const { t, i18n }                            = useTranslation()
    const transitionLayer                        = usePageTransitionLayer()
    const pageLayerStatus                        = transitionLayer?.status ?? 'current'
    const { showNotification, showConfirmation } = useNotificationStore()
    const connectionStatus                       = useAuthStore((state) => state.connectionStatus)
    const authGeneration                         = useAuthStore(() => apiClient.getAuthGeneration())
    const mountedRef                             = useRef(true)
    const isCurrentConnection                    = () => mountedRef.current && authGeneration === apiClient.getAuthGeneration()
    const apiBase                                = useAuthStore((state) => state.apiBase)
    const managementKey                          = useAuthStore((state) => state.managementKey)
    const traceScopeKey                          = `${apiBase}::${managementKey}`
    const config                                 = useConfigStore((state) => state.config)
    const requestLogEnabled                      = config?.requestLog ?? false

    const [activeTab, setActiveTab]                                 = useState<TabType>('logs')
    const [logState, setLogState]                                   = useState<LogState>(emptyLogBuffer)
    const parseCachedLogs                                            = useMemo(createLogParserCache, [])
    const [loading, setLoading]                                     = useState(true)
    const [clearingLogs, setClearingLogs]                           = useState(false)
    const [error, setError]                                         = useState('')
    const [catchingUp, setCatchingUp]                               = useState(false)
    const [lastUpdated, setLastUpdated]                             = useState<number | null>(null)
    const [historyEvicted, setHistoryEvicted]                       = useState(false)
    const configRefreshMs                                           = useMemo(
        () => resolveAutoRefreshMs(config?.autoRefreshInterval),
        [config?.autoRefreshInterval],
    )
    const [autoRefreshOverride, setAutoRefreshOverride]             = useLocalStorage<boolean | null>(
        'logsPage.autoRefresh',
        null,
    )
    const [refreshIntervalOverride, setRefreshIntervalOverride]     = useLocalStorage<number | null>(
        'logsPage.refreshInterval',
        null,
    )
    const autoRefresh                                               = (autoRefreshOverride ?? configRefreshMs > 0) &&
                                                                      (refreshIntervalOverride ?? configRefreshMs) >
                                                                      0
    const refreshInterval                                           = refreshIntervalOverride ?? configRefreshMs
    const refreshIntervalOptions                                    = useMemo(() => {
        const refreshValue = String(refreshInterval)
        if (REFRESH_INTERVAL_OPTIONS.some((option) => option.value === refreshValue)) {
            return REFRESH_INTERVAL_OPTIONS
        }
        return [
            ...REFRESH_INTERVAL_OPTIONS,
            { value: refreshValue, label: formatRefreshIntervalLabel(refreshInterval) },
        ]
    }, [refreshInterval])
    const [searchQuery, setSearchQuery]                             = useState('')
    const [levelFilter, setLevelFilter]                             = useState('')
    const deferredSearchQuery                                       = useDeferredValue(searchQuery)
    const [hideManagementLogs, setHideManagementLogs]               = useLocalStorage(
        'logsPage.hideManagementLogs',
        true,
    )
    const [showRawLogs, setShowRawLogs]                             = useLocalStorage('logsPage.showRawLogs', false)
    const [wrapLogs, setWrapLogs]                                   = useLocalStorage('logsPage.wrapLogs', false)
    const [structuredFiltersExpanded, setStructuredFiltersExpanded] = useLocalStorage(
        'logsPage.structuredFiltersExpanded',
        true,
    )
    const [storedFilters, setStoredFilters]                         = useLocalStorage<PersistedLogFilters>(
        'logsPage.structuredFilters',
        DEFAULT_PERSISTED_LOG_FILTERS,
    )
    const [errorLogs, setErrorLogs]                                 = useState<ErrorLogFile[]>([])
    const [loadingErrors, setLoadingErrors]                         = useState(false)
    const [errorLogsError, setErrorLogsError]                       = useState('')
    const [errorLogViewer, dispatchErrorLogViewer]                  = useReducer(errorLogViewerReducer, {
        status: 'closed',
    })
    const selectedErrorLog                                         = errorLogViewer.status === 'closed' ?
                                                                     null : errorLogViewer.item
    const [errorLogDownloading, setErrorLogDownloading]             = useState<string | null>(null)
    const [requestLogId, setRequestLogId]                           = useState<string | null>(null)
    const [requestLogUpdating, setRequestLogUpdating]               = useState(false)
    const [logDiskSize, setLogDiskSize]                             = useState<{
                                                                                   totalBytes: number;
                                                                                   fileCount: number
                                                                               } | null>(null)
    const [totalLogLines, setTotalLogLines]                         = useState<number | null>(null)
    const notRecordedLabel                                          = t('usage_stats.request_events_not_recorded', {
        defaultValue: 'Not recorded',
    })

    const [requestLogDownloading, setRequestLogDownloading] = useState(false)
    const [logPanelFullscreen, setLogPanelFullscreen]       = useState(false)
    if (pageLayerStatus !== 'current' && logPanelFullscreen) {
        setLogPanelFullscreen(false)
    }

    const trace                        = useTraceResolver({
                                                              traceScopeKey,
                                                              connectionStatus,
                                                              config,
                                                              requestLogDownloading,
                                                          })
    const routeDecisionTrace           = trace.routeDecisionTrace
    const routeDecision                = routeDecisionTrace.decision
    const routeBackendNotProvidedLabel = t('logs.trace_route_backend_not_provided')
    const routeRequestLogStateLabel    = useMemo(() => {
        switch (routeDecisionTrace.requestLogState) {
            case 'pending':
                return t('usage_stats.request_events_log_state_pending')
            case 'available':
                return t('usage_stats.request_events_log_state_available')
            case 'disabled':
                return t('usage_stats.request_events_log_state_disabled')
            case 'not_captured':
                return t('usage_stats.request_events_log_state_not_captured')
            case 'publish_failed':
                return t('usage_stats.request_events_log_state_publish_failed')
            case 'expired':
                return t('usage_stats.request_events_log_state_expired')
            case 'legacy_unknown':
                return t('usage_stats.request_events_log_state_legacy_unknown')
            default:
                return ''
        }
    }, [routeDecisionTrace.requestLogState, t])
    const routeDecisionStatusLabel     = useMemo(() => {
        switch (routeDecisionTrace.status) {
            case 'loading':
                return t('logs.trace_route_loading')
            case 'pending':
                return t('logs.trace_route_pending')
            case 'lifecycle':
                return routeRequestLogStateLabel
            case 'missing_request_id':
                return t('logs.trace_route_missing_request_id')
            case 'not_found':
                return t('logs.trace_route_not_found')
            case 'not_recorded':
                return t('logs.trace_route_not_recorded')
            case 'truncated':
                return t('logs.trace_route_truncated')
            case 'invalid':
                return t('logs.trace_route_invalid')
            case 'unavailable':
                return t('logs.trace_route_unavailable')
            default:
                return ''
        }
    }, [routeDecisionTrace.status, routeRequestLogStateLabel, t])
    const routeCandidateScopeLabel     = routeDecision?.candidateScope === 'complete'
                                         ? t('logs.trace_route_scope_complete')
                                         : routeDecision?.candidateScope === 'selected_only'
                                           ? t('logs.trace_route_scope_selected_only')
                                           : routeDecision
                                             ? t('logs.trace_route_scope_unknown')
                                             : ''
    const formatRouteBoolean           = (value: boolean | null): string => {
        if (value === null) {
            return routeBackendNotProvidedLabel
        }
        return value ? t('common.yes') : t('common.no')
    }
    const formatRouteNullableNumber    = (value: number | null): string =>
        value === null ? routeBackendNotProvidedLabel : new Intl.NumberFormat(i18n.language).format(value)
    const formatRouteQuotaStatus       = (status: RouteDecisionQuotaStatus): string => {
        switch (status) {
            case 'fresh':
                return t('logs.trace_route_quota_status_fresh')
            case 'stale':
                return t('logs.trace_route_quota_status_stale')
            case 'unknown':
                return t('logs.trace_route_quota_status_unknown')
            default:
                return routeBackendNotProvidedLabel
        }
    }
    const formatRouteCooldown          = (cooldown: RouteDecisionCooldown): string => {
        if (!cooldown.known) {
            return routeBackendNotProvidedLabel
        }
        const parts = [
            t(
                cooldown.active ? 'logs.trace_route_cooldown_active' : 'logs.trace_route_cooldown_inactive',
            ),
        ]
        if (cooldown.active) {
            if (cooldown.indefinite) {
                parts.push(t('logs.trace_route_cooldown_indefinite'))
            } else if (cooldown.retryAfterMs !== null) {
                parts.push(t('logs.trace_route_cooldown_retry_after', {
                    duration: formatTraceDuration(cooldown.retryAfterMs, i18n.language, routeBackendNotProvidedLabel),
                }))
            }
            if (cooldown.reason) {
                parts.push(t('logs.trace_route_cooldown_reason', { reason: cooldown.reason }))
            }
        }
        if (cooldown.effectKey) {
            parts.push(t('logs.trace_route_cooldown_effect', { effect: cooldown.effectKey }))
        }
        if (cooldown.stateGeneration !== null) {
            parts.push(t('logs.trace_route_cooldown_generation', { generation: cooldown.stateGeneration }))
        }
        if (cooldown.resetAuthority) {
            parts.push(t('logs.trace_route_cooldown_reset', { authority: cooldown.resetAuthority }))
        }
        return parts.join(' · ')
    }

    const logScrollerRef            = useRef<HTMLDivElement | null>(null)
    const logViewportRef            = useRef({
                                                 page: 1,
                                                 pageStart: 0,
                                                 scrollTop: 0,
                                                 anchorId: null as number | null,
                                                 anchorOffset: null as number | null,
                                             })
    const pendingViewportRestoreRef = useRef<{
                                                 anchorId: number
                                                 scrollTop: number
                                                 anchorOffset?: number
                                                 targetPage?: number
                                             } | null>(null)
    const longPressRef              = useRef<{
                                                 timer: number | null
                                                 startX: number
                                                 startY: number
                                                 fired: boolean
                                             } | null>(null)
    const [requests] = useState(() => ({
        session: createLogRequestGuard(),
        logs: createLogRequestQueue(),
        errors: createLogRequestGuard(),
        preview: createLogRequestGuard(),
        errorDownload: createLogRequestGuard(),
        requestDownload: createLogRequestGuard(),
    }))

    // 保存最新读取位置用于增量获取
    const logPositionRef          = useRef<LogPosition>({})
    const retryDelayRef           = useRef(INITIAL_RETRY_MS)
    const nextReadAtRef           = useRef(0)
    const requestLogHomeIpByIdRef = useRef<Record<string, string>>({})

    const disableControls = connectionStatus !== 'connected'
    const refreshDisabled = disableControls || loading || clearingLogs
    const clearDisabled   = disableControls || clearingLogs

    // 分页状态
    const [logPage, setLogPage]         = useState(1)
    const [logPageSize, setLogPageSize] = useLocalStorage('logsPage.pageSize', DEFAULT_LOG_PAGE_SIZE)

    const loadLogs = async (incremental = false) => {
        if (!isCurrentConnection()) {
            return
        }
        if (useAuthStore.getState().connectionStatus !== 'connected') {
            setLoading(false)
            return
        }

        const request = requests.logs.startRead(incremental, authGeneration)
        if (request === null) {
            return
        }
        const requestIsCurrent = () => requests.logs.isCurrent(request, apiClient.getAuthGeneration())

        if (!incremental) {
            setLoading(true)
        }

        try {
            for (let page = 0; page < MAX_LOG_PAGES_PER_READ; ++page) {
                const position          = logPositionRef.current
                const overlapAfter      = incremental && !position.cursor && position.after !== undefined
                const requestAfter      = overlapAfter ? overlapAfterValue(position.after) : position.after
                const params: LogsQuery = incremental
                                          ? {
                        limit: MAX_BUFFER_LINES,
                        ...(requestAfter !== undefined ? { after: requestAfter } : {}),
                        ...(position.cursor ? { cursor: position.cursor } : {}),
                    }
                                          : { limit: MAX_BUFFER_LINES }
                const [data, logSize]   = await Promise.all([
                                                                logsApi.fetchLogs(params, {
                                                                    signal: request.controller.signal,
                                                                }),
                                                                incremental || page > 0
                                                                ? Promise.resolve(null)
                                                                : logsApi
                                                                    .fetchLogSize({ signal: request.controller.signal })
                                                                    .catch((err: unknown) => {
                                                                        if (requestIsCurrent()) {
                                                                            console.warn('[LogsPage] fetchLogSize failed', err)
                                                                        }
                                                                        return null
                                                                    }),
                                                            ])
                if (!requestIsCurrent()) {
                    return
                }
                if (logSize) {
                    setLogDiskSize({ totalBytes: logSize.total_bytes, fileCount: logSize.file_count })
                }

                const nextPosition: LogPosition = incremental ? { ...logPositionRef.current } : {}
                if (data.latestAfter !== undefined) {
                    nextPosition.after = data.latestAfter
                }
                if (typeof data.nextCursor === 'string') {
                    if (data.nextCursor) {
                        nextPosition.cursor = data.nextCursor
                    } else {
                        delete nextPosition.cursor
                    }
                } else if (!incremental || data.logBackendKind === 'home-db') {
                    delete nextPosition.cursor
                }
                logPositionRef.current = nextPosition

                const newLines = Array.isArray(data.lines) ? data.lines : []
                if (data.requestLogHomeIpById && newLines.length > 0) {
                    requestLogHomeIpByIdRef.current = incremental
                                                      ? {
                            ...requestLogHomeIpByIdRef.current,
                            ...data.requestLogHomeIpById,
                        }
                                                      : data.requestLogHomeIpById
                } else if (!incremental) {
                    requestLogHomeIpByIdRef.current = {}
                }
                setTotalLogLines(data.logBackendKind === 'home-db' ? data.total ?? null : null)

                const cursorReset = data.cursorReset === true

                if (incremental && cursorReset) {
                    setLogState((previous) => replaceLogBuffer(previous, newLines, MAX_BUFFER_LINES))
                    pendingViewportRestoreRef.current = null
                    setHistoryEvicted(true)
                    setLogPage(1)
                } else if (incremental && newLines.length > 0) {
                    preserveLogViewport()

                    setLogState((prev) => {
                        const linesToAppend = overlapAfter
                                              ? dropOverlappingLogLines(
                                prev.buffer,
                                newLines,
                                overlapLineLimit(prev.buffer, requestAfter),
                            )
                                              : newLines
                        return appendLogBuffer(prev, linesToAppend, MAX_BUFFER_LINES)
                    })
                } else if (!incremental) {
                    setLogState((previous) => replaceLogBuffer(previous, newLines, MAX_BUFFER_LINES))
                    pendingViewportRestoreRef.current = null
                    setHistoryEvicted(false)
                    setLogPage(1)
                }

                const more = incremental && shouldCatchUpLogPage(data, position.cursor, MAX_BUFFER_LINES)
                setCatchingUp(more)
                setLastUpdated(Date.now())
                setError('')
                retryDelayRef.current = INITIAL_RETRY_MS
                nextReadAtRef.current = Date.now() + (more ? FAST_CATCH_UP_MS : refreshInterval)
                if (!more) {
                    break
                }
            }
        } catch (err: unknown) {
            if (requestIsCurrent()) {
                setCatchingUp(false)
                setError(getErrorMessage(err) || t('logs.load_error'))
                nextReadAtRef.current = Date.now() + retryDelayRef.current
                retryDelayRef.current = Math.min(retryDelayRef.current * 2, MAX_RETRY_MS)
            }
        } finally {
            const result = requests.logs.finish(request, apiClient.getAuthGeneration())
            if (result.finished) {
                if (!incremental && !result.reload) {
                    setLoading(false)
                }
                if (result.reload) {
                    void loadLogs(false)
                }
            }
        }
    }

    useHeaderRefresh(pageLayerStatus === 'current' ? () => activeTab === 'errors' ? loadErrorLogs() : loadLogs(false) : null)

    const clearLogs = async () => {
        if (!isCurrentConnection()) {
            return
        }
        const session = requests.session.capture(authGeneration)
        showConfirmation({
                             title: t('logs.clear_confirm_title', { defaultValue: 'Clear Logs' }),
                             message: t('logs.clear_confirm'),
                             variant: 'danger',
                             confirmText: t('common.confirm'),
                             onConfirm: async () => {
                                 const currentAuthGeneration = apiClient.getAuthGeneration()
                                 if (!isCurrentConnection() || !requests.session.isCurrent(session, currentAuthGeneration) ||
                                     useAuthStore.getState().connectionStatus !== 'connected') {
                                     return
                                 }
                                 const request = requests.logs.startClear(currentAuthGeneration)
                                 if (request === null) {
                                     return
                                 }
                                 setClearingLogs(true)
                                 setLoading(false)
                                 setError('')
                                 let clearFailed = false
                                 try {
                                     await logsApi.clearLogs({ signal: request.controller.signal })
                                     if (!requests.logs.isCurrent(request, apiClient.getAuthGeneration())) {
                                         return
                                     }
                                     setLogState((previous) => replaceLogBuffer(previous, [], MAX_BUFFER_LINES))
                                     pendingViewportRestoreRef.current = null
                                     logPositionRef.current          = {}
                                     requestLogHomeIpByIdRef.current = {}
                                     nextReadAtRef.current           = 0
                                     retryDelayRef.current           = INITIAL_RETRY_MS
                                     setCatchingUp(false)
                                     setHistoryEvicted(false)
                                     setLastUpdated(null)
                                     setTotalLogLines(null)
                                     setLogDiskSize(null)
                                     setLogPage(1)

                                     try {
                                         const size = await logsApi.fetchLogSize({ signal: request.controller.signal })
                                         if (!requests.logs.isCurrent(request, apiClient.getAuthGeneration())) {
                                             return
                                         }
                                         setLogDiskSize({
                                                            totalBytes: size.total_bytes,
                                                            fileCount: size.file_count,
                                                        })
                                     } catch (err: unknown) {
                                         if (requests.logs.isCurrent(request, apiClient.getAuthGeneration())) {
                                             console.warn('[LogsPage] fetchLogSize failed', err)
                                         }
                                     }
                                     if (requests.logs.isCurrent(request, apiClient.getAuthGeneration())) {
                                         showNotification(t('logs.clear_success'), 'success')
                                     }
                                 } catch (err: unknown) {
                                     if (!requests.logs.isCurrent(request, apiClient.getAuthGeneration())) {
                                         return
                                     }
                                     clearFailed = true
                                     const message = getErrorMessage(err)
                                     showNotification(`${t('notification.delete_failed')}${message ?
                                                                                                   `: ${message}` :
                                                                                                   ''}`, 'error')
                                 } finally {
                                     const result = requests.logs.finish(request, apiClient.getAuthGeneration(), clearFailed)
                                     if (result.finished) {
                                         setClearingLogs(false)
                                         if (result.reload) {
                                             void loadLogs(false)
                                         }
                                     }
                                 }
                             },
                         })
    }

    const downloadLogs = () => {
        if (!isCurrentConnection()) {
            return
        }
        const text = logState.buffer.map(redactSensitiveText).join('\n')
        downloadBlob({ filename: 'logs.txt', blob: new Blob([text], { type: 'text/plain' }) })
        showNotification(t('logs.download_success'), 'success')
    }

    const loadErrorLogs = async () => {
        if (!isCurrentConnection()) {
            return
        }
        if (useAuthStore.getState().connectionStatus !== 'connected') {
            setLoadingErrors(false)
            return
        }

        const request = requests.errors.begin(authGeneration)
        setLoadingErrors(true)
        setErrorLogsError('')
        try {
            const res = await logsApi.fetchErrorLogs({ signal: request.controller.signal })
            if (!requests.errors.isCurrent(request, apiClient.getAuthGeneration())) {
                return
            }
            setErrorLogs(res.files)
        } catch (err: unknown) {
            if (!requests.errors.isCurrent(request, apiClient.getAuthGeneration())) {
                return
            }
            console.error('Failed to load error logs:', err)
            setErrorLogs([])
            const message = getErrorMessage(err)
            setErrorLogsError(
                message ? `${t('logs.error_logs_load_error')}: ${message}` : t('logs.error_logs_load_error'),
            )
        } finally {
            if (requests.errors.isCurrent(request, apiClient.getAuthGeneration())) {
                requests.errors.finish(request)
                setLoadingErrors(false)
            }
        }
    }

    const downloadErrorLog = async (name: string) => {
        if (!isCurrentConnection()) {
            return
        }
        const request = requests.errorDownload.begin(authGeneration)
        setErrorLogDownloading(name)
        try {
            const response = await logsApi.downloadErrorLog(name, { signal: request.controller.signal })
            if (!requests.errorDownload.isCurrent(request, apiClient.getAuthGeneration())) {
                return
            }
            const text = redactSensitiveText(await responseDataToText(response.data))
            if (!requests.errorDownload.isCurrent(request, apiClient.getAuthGeneration())) {
                return
            }
            downloadBlob({ filename: name, blob: new Blob([text], { type: 'text/plain' }) })
            showNotification(t('logs.error_log_download_success'), 'success')
        } catch (err: unknown) {
            if (!requests.errorDownload.isCurrent(request, apiClient.getAuthGeneration())) {
                return
            }
            const message = getErrorMessage(err)
            showNotification(`${t('notification.download_failed')}${message ? `: ${message}` : ''}`, 'error')
        } finally {
            if (requests.errorDownload.isCurrent(request, apiClient.getAuthGeneration())) {
                requests.errorDownload.finish(request)
                setErrorLogDownloading(null)
            }
        }
    }

    const previewErrorLog = async (item: ErrorLogFile) => {
        if (!isCurrentConnection()) {
            return
        }
        const request = requests.preview.begin(authGeneration)
        dispatchErrorLogViewer({ type: 'open', item })
        try {
            const result = await logsApi.previewErrorLog(item.name, 500, {
                signal: request.controller.signal,
            })
            if (!requests.preview.isCurrent(request, apiClient.getAuthGeneration())) {
                return
            }
            dispatchErrorLogViewer({ type: 'ready', text: redactSensitiveText(result.content) })
        } catch (err: unknown) {
            if (!requests.preview.isCurrent(request, apiClient.getAuthGeneration())) {
                return
            }
            const message = getErrorMessage(err)
            dispatchErrorLogViewer({
                                       type: 'error',
                                       message: message ?
                                                `${t('logs.error_log_open_failed')}: ${message}` :
                                                t('logs.error_log_open_failed'),
                                   })
        } finally {
            if (requests.preview.isCurrent(request, apiClient.getAuthGeneration())) {
                requests.preview.finish(request)
            }
        }
    }

    const closeErrorLogViewer = () => {
        if (!isCurrentConnection()) {
            return
        }
        requests.preview.invalidate()
        dispatchErrorLogViewer({ type: 'close' })
    }

    useEffect(() => {
        mountedRef.current = true
        let observedAuthGeneration = apiClient.getAuthGeneration()
        const invalidateRequests = () => {
            requests.session.invalidate()
            requests.logs.invalidate()
            requests.errors.invalidate()
            requests.preview.invalidate()
            requests.errorDownload.invalidate()
            requests.requestDownload.invalidate()
            if (longPressRef.current?.timer) {
                window.clearTimeout(longPressRef.current.timer)
            }
            longPressRef.current = null
        }
        const resetLogs = () => {
            logPositionRef.current          = {}
            requestLogHomeIpByIdRef.current = {}
            nextReadAtRef.current           = 0
            retryDelayRef.current           = INITIAL_RETRY_MS
            setCatchingUp(false)
            setHistoryEvicted(false)
            setLastUpdated(null)
            setLogState((previous) => replaceLogBuffer(previous, [], MAX_BUFFER_LINES))
            pendingViewportRestoreRef.current = null
            setLoading(false)
            setClearingLogs(false)
            setError('')
            setLogDiskSize(null)
            setTotalLogLines(null)
            setLogPage(1)
        }
        const resetErrors = () => {
            setErrorLogs([])
            setLoadingErrors(false)
            setErrorLogsError('')
            dispatchErrorLogViewer({ type: 'close' })
            setErrorLogDownloading(null)
            setRequestLogId(null)
            setRequestLogDownloading(false)
            setRequestLogUpdating(false)
        }

        const unsubscribeAuth = useAuthStore.subscribe((next, previous) => {
            const nextAuthGeneration = apiClient.getAuthGeneration()
            if (nextAuthGeneration === observedAuthGeneration &&
                next.apiBase === previous.apiBase &&
                next.managementKey === previous.managementKey &&
                next.connectionStatus === previous.connectionStatus &&
                next.isAuthenticated === previous.isAuthenticated) {
                return
            }
            observedAuthGeneration = nextAuthGeneration
            invalidateRequests()
            resetLogs()
            resetErrors()
        })
        const unsubscribeConfig = useConfigStore.subscribe((next, previous) => {
            if (next.config?.requestLog === previous.config?.requestLog) {
                return
            }
            requests.errors.invalidate()
            requests.preview.invalidate()
            requests.errorDownload.invalidate()
            requests.requestDownload.invalidate()
            resetErrors()
        })
        return () => {
            mountedRef.current = false
            unsubscribeAuth()
            unsubscribeConfig()
            invalidateRequests()
        }
    }, [requests])

    useEffect(() => {
        if (connectionStatus === 'connected') {
            void loadLogs(false)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [connectionStatus, apiBase, managementKey, authGeneration])

    useEffect(() => {
        if (activeTab !== 'errors' || connectionStatus !== 'connected') {
            requests.errors.invalidate()
            return
        }
        queueMicrotask(() => {
            void loadErrorLogs()
        })
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeTab, connectionStatus, apiBase, managementKey, requestLogEnabled, authGeneration])

    useEffect(() => {
        if (!autoRefresh || refreshInterval <= 0 || connectionStatus !== 'connected' || activeTab !== 'logs' ||
            pageLayerStatus !== 'current') {
            return
        }
        const id = window.setInterval(() => {
            if (document.visibilityState === 'hidden' || Date.now() < nextReadAtRef.current) {
                return
            }
            void loadLogs(true)
        }, FAST_CATCH_UP_MS)
        return () => window.clearInterval(id)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeTab, autoRefresh, connectionStatus, refreshInterval, authGeneration, pageLayerStatus])

    const trimmedSearchQuery = deferredSearchQuery.trim()
    const isSearching        = trimmedSearchQuery.length > 0

    const parsedLines = useMemo(() => parseCachedLogs(logState), [logState, parseCachedLogs])
    useEffect(() => {
        const byRequestId = requestLogHomeIpByIdRef.current
        if (Object.keys(byRequestId).length <= MAX_BUFFER_LINES) {
            return
        }
        const retainedIds = new Set(parsedLines.map((line) => line.requestId))
        for (const requestId of Object.keys(byRequestId)) {
            if (!retainedIds.has(requestId)) {
                delete byRequestId[requestId]
            }
        }
    }, [parsedLines])

    const parsedSearchLines = useMemo(() => {
        let working = parsedLines

        if (hideManagementLogs) {
            working = working.filter((line) => {
                const path = line.path?.split('?')[0]
                return path !== MANAGEMENT_API_PREFIX && !path?.startsWith(`${MANAGEMENT_API_PREFIX}/`)
            })
        }

        if (trimmedSearchQuery) {
            const queryLowered = trimmedSearchQuery.toLowerCase()
            working            = working.filter((line) => line.raw.toLowerCase().includes(queryLowered))
        }

        return working
    }, [parsedLines, hideManagementLogs, trimmedSearchQuery])

    const filters                  = useLogFilters({
                                                       parsedLines: parsedSearchLines,
                                                       initialFilters: storedFilters,
                                                       onFiltersChange: setStoredFilters,
                                                   })
    const structuredFiltersPanelId = 'logs-structured-filters'
    const structuredFilterCount    =
              filters.methodFilters.length + filters.statusFilters.length + filters.pathFilters.length

    const { filteredParsedLines, removedCount } = useMemo(() => {
        const activeFilters = {
            methodFilterSet: filters.methodFilterSet,
            statusFilterSet: filters.statusFilterSet,
            pathFilterSet: filters.pathFilterSet,
        }
        const filteredParsed = parsedSearchLines.filter((line) => matchesLogFilters(line, levelFilter, activeFilters))

        return {
            filteredParsedLines: filteredParsed,
            removedCount: Math.max(logState.buffer.length - filteredParsed.length, 0),
        }
    }, [
                                                                             logState.buffer.length,
                                                                             filters.methodFilterSet,
                                                                             filters.pathFilterSet,
                                                                             filters.statusFilterSet,
                                                                             levelFilter,
                                                                             parsedSearchLines,
                                                                         ])

    // 日志逆序（新→旧），分页切片
    const reversedParsedLines = useMemo(() => [...filteredParsedLines].reverse(), [filteredParsedLines])
    const totalFilteredLines  = reversedParsedLines.length

    // 过滤/搜索条件变化时重置到第 1 页
    useEffect(() => {
        pendingViewportRestoreRef.current = null
        logScrollerRef.current?.scrollTo({top: 0})
        queueMicrotask(() => {
            setLogPage(1)
        })
    }, [
                  isSearching,
                  trimmedSearchQuery,
                  levelFilter,
                  filters.methodFilters,
                  filters.statusFilters,
                  filters.pathFilters,
                  hideManagementLogs,
              ])

    const pageStart      = (logPage - 1) * logPageSize
    const pageEnd        = pageStart + logPageSize
    const pagedParsed = useMemo(
        () => reversedParsedLines.slice(pageStart, pageEnd),
        [reversedParsedLines, pageStart, pageEnd],
    )

    const captureLogViewport = useCallback(() => {
        const node = logScrollerRef.current
        const top = node ? node.getBoundingClientRect().top + node.clientTop : null
        const anchor = node && top !== null
                       ? Array.from(node.querySelectorAll<HTMLElement>('[data-log-id]')).find((row) =>
                Boolean(row.dataset.logId?.trim()) && Number.isFinite(Number(row.dataset.logId)) &&
                row.getBoundingClientRect().bottom > top)
                       : undefined
        logViewportRef.current = {
            page: logPage,
            pageStart,
            scrollTop: node?.scrollTop ?? logViewportRef.current.scrollTop,
            anchorId: anchor ? Number(anchor.dataset.logId) : reversedParsedLines[pageStart]?.id ?? null,
            anchorOffset: anchor && top !== null ? anchor.getBoundingClientRect().top - top : null,
        }
    }, [logPage, pageStart, reversedParsedLines])

    const preserveLogViewport = () => {
        const viewport = logViewportRef.current
        if (!(viewport.page === 1 && viewport.scrollTop <= 2) && viewport.anchorId !== null) {
            pendingViewportRestoreRef.current = {
                anchorId: viewport.anchorId,
                scrollTop: viewport.scrollTop,
                ...(typeof viewport.anchorOffset === 'number' ? {anchorOffset: viewport.anchorOffset} : {}),
            }
        }
    }

    useEffect(() => {
        captureLogViewport()
    }, [captureLogViewport, showRawLogs, wrapLogs])

    useEffect(() => {
        const pending = pendingViewportRestoreRef.current
        if (!pending) {
            return
        }
        const anchorIndex = reversedParsedLines.findIndex((line) => line.id === pending.anchorId)
        if (anchorIndex < 0) {
            pendingViewportRestoreRef.current = null
            if (pending.anchorId < logState.bufferStart) {
                setLogPage(1)
                setHistoryEvicted(true)
            }
            return
        }
        const targetPage                  = Math.floor(anchorIndex / logPageSize) + 1
        const restore                     = { ...pending, targetPage }
        pendingViewportRestoreRef.current = restore
        if (logPage !== targetPage) {
            setLogPage(targetPage)
            return
        }
        window.requestAnimationFrame(() => {
            if (pendingViewportRestoreRef.current !== restore) {
                return
            }
            const node = logScrollerRef.current
            const anchor = node?.querySelector<HTMLElement>(`[data-log-id="${restore.anchorId}"]`)
            const top = node && anchor && typeof restore.anchorOffset === 'number'
                        ? Math.max(0, node.scrollTop + anchor.getBoundingClientRect().top -
                            node.getBoundingClientRect().top - node.clientTop - restore.anchorOffset)
                        : restore.scrollTop
            node?.scrollTo({top})
            pendingViewportRestoreRef.current = null
        })
    }, [logPage, logPageSize, logState.bufferStart, reversedParsedLines, showRawLogs, wrapLogs])

    const logSheetStatus: DataStatusValue = loading ? 'loading' : totalFilteredLines > 0 ? 'ready' : 'empty'
    const logSheetEmptyText               = logState.buffer.length > 0 ?
                                            t('logs.search_empty_title') :
                                            t('logs.empty_title')
    const logSheetEmptyHint               = logState.buffer.length > 0 ?
                                            t('logs.search_empty_desc') :
                                            t('logs.empty_desc')
    const logColumns                      = useMemo<SheetColumn<ParsedLogLine & {id: number}>[]>(() => [
        {
            key: 'time',
            header: t('logs.column_time', { defaultValue: '时间' }),
            cell: () => null,
            className: styles.timeColumn,
            headerClassName: styles.timeColumn,
        },
        {
            key: 'level',
            header: t('logs.column_level', { defaultValue: '级别' }),
            cell: () => null,
            className: styles.levelColumn,
            headerClassName: styles.levelColumn,
        },
        {
            key: 'method',
            header: t('logs.column_method', { defaultValue: '方法' }),
            cell: () => null,
            className: styles.methodColumn,
            headerClassName: styles.methodColumn,
        },
        {
            key: 'path',
            header: t('logs.column_path', { defaultValue: '路径' }),
            cell: () => null,
            className: styles.pathColumn,
            headerClassName: styles.pathColumn,
        },
        {
            key: 'message',
            header: t('logs.trace_message'),
            cell: () => null,
            className: styles.messageColumn,
            headerClassName: styles.messageColumn,
        },
        {
            key: 'status',
            header: t('logs.column_status', { defaultValue: '状态' }),
            cell: () => null,
            className: styles.statusColumn,
            headerClassName: styles.statusColumn,
        },
        {
            key: 'latency',
            header: t('logs.column_latency', { defaultValue: '耗时' }),
            cell: () => null,
            className: styles.latencyColumn,
            headerClassName: styles.latencyColumn,
        },
        {
            key: 'request_id',
            header: t('logs.column_request_id', { defaultValue: '请求 ID' }),
            cell: () => null,
            className: styles.requestIdColumn,
            headerClassName: styles.requestIdColumn,
        },
        {
            key: 'ip',
            header: t('logs.column_ip', { defaultValue: 'IP' }),
            cell: () => null,
            className: styles.ipColumn,
            headerClassName: styles.ipColumn,
        },
        {
            key: 'trace',
            header: t('logs.column_trace', { defaultValue: '追踪' }),
            cell: () => null,
            className: styles.traceColumn,
            headerClassName: styles.traceColumn,
        },
        {
            key: 'copy',
            header: t('common.copy'),
            cell: () => null,
            className: styles.copyColumn,
            headerClassName: styles.copyColumn,
        },
    ], [t])

    const renderLogRow = (line: ParsedLogLine & {id: number}) => {
        const canTraceRequest = isTraceableRequestPath(line.path)
        const rowClassNames   = [styles.logTableRow]
        if (line.level === 'warn') {
            rowClassNames.push(styles.rowWarn)
        }
        if (line.level === 'error' || line.level === 'fatal') {
            rowClassNames.push(styles.rowError)
        }

        const levelClassName  = [
            styles.badge,
            line.level === 'info' ? styles.levelInfo : '',
            line.level === 'warn' ? styles.levelWarn : '',
            line.level === 'error' || line.level === 'fatal' ? styles.levelError : '',
            line.level === 'debug' ? styles.levelDebug : '',
            line.level === 'trace' ? styles.levelTrace : '',
        ].filter(Boolean).join(' ')
        const statusClassName = [
            styles.badge,
            styles.statusBadge,
            typeof line.statusCode === 'number' && line.statusCode >= 200 && line.statusCode < 300
            ? styles.statusSuccess
            : typeof line.statusCode === 'number' && line.statusCode >= 300 && line.statusCode < 400
              ? styles.statusInfo
              : typeof line.statusCode === 'number' && line.statusCode >= 400 && line.statusCode < 500
                ? styles.statusWarn
                : styles.statusError,
        ].join(' ')
        const redactedPath    = line.path ? redactSensitiveText(line.path) : ''
        const redactedMessage = redactSensitiveText(line.message || line.raw)
        const redactedSource  = line.source ? redactSensitiveText(line.source) : ''
        const emptyCell       = <span className={styles.emptyCell}>—</span>

        return (
            <tr
                data-log-id={line.id}
                className={rowClassNames.join(' ')}
                onDoubleClick={() => {
                    void copyLogLine(line.raw)
                }}
                onPointerDown={(event) => startLongPress(event, line.requestId)}
                onPointerUp={cancelLongPress}
                onPointerLeave={cancelLongPress}
                onPointerCancel={cancelLongPress}
                onPointerMove={handleLongPressMove}
                title={t('logs.double_click_copy_hint', {
                    defaultValue: 'Double-click to copy',
                })}
            >
                <td className={styles.timestamp}>{formatLogTimestamp(line.timestamp)}</td>
                <td className={styles.levelCell}>
                    {line.level ? <span className={levelClassName}>{line.level.toUpperCase()}</span> : emptyCell}
                </td>
                <td className={styles.methodCell}>
                    {line.method ?
                     <span className={[styles.badge, styles.methodBadge].join(' ')}>{line.method}</span> :
                     emptyCell}
                </td>
                <td className={styles.pathCell}>
                    {redactedPath ? (
                        <span className={styles.path} title={redactedPath}>
                            {redactedPath}
                        </span>
                    ) : emptyCell}
                </td>
                <td className={styles.messageCell}>
                    {redactedSource && <span className={styles.source} title={redactedSource}>{redactedSource}</span>}
                    {redactedMessage ? (
                        <span className={styles.messageText} title={redactedMessage}>{redactedMessage}</span>
                    ) : emptyCell}
                </td>
                <td className={styles.statusCell}>
                    {typeof line.statusCode === 'number' ?
                     <span className={statusClassName}>{line.statusCode}</span> :
                     emptyCell}
                </td>
                <td className={styles.latencyCell}>
                    {line.latency ? <span className={styles.pill}>{line.latency}</span> : emptyCell}
                </td>
                <td className={styles.requestIdCell}>
                    {line.requestId ? (
                        <span className={[styles.badge, styles.requestIdBadge].join(' ')} title={line.requestId}>
                            {line.requestId}
                        </span>
                    ) : emptyCell}
                </td>
                <td className={styles.ipCell}>
                    {line.ip ? <span className={styles.ipText} title={line.ip}>{line.ip}</span> : emptyCell}
                </td>
                <td className={styles.traceCell}>
                    {canTraceRequest ? (
                        <button
                            type='button'
                            className={styles.traceButton}
                            onPointerDown={(event) => event.stopPropagation()}
                            onClick={(event) => {
                                event.stopPropagation()
                                cancelLongPress()
                                trace.openTraceModal(
                                    line,
                                    line.requestId ? requestLogHomeIpByIdRef.current[line.requestId] : undefined,
                                )
                            }}
                            title={t('logs.trace_button')}
                        >
                            {t('logs.trace_short', { defaultValue: '追踪' })}
                        </button>
                    ) : emptyCell}
                </td>
                <td className={styles.copyCell}>
                    <Button
                        variant='ghost'
                        size='xs'
                        className={styles.copyButton}
                        aria-label={t('common.copy')}
                        title={t('common.copy')}
                        onPointerDown={(event) => event.stopPropagation()}
                        onDoubleClick={(event) => event.stopPropagation()}
                        onClick={() => void copyLogLine(line.raw)}
                    >
                        <IconCopy size={14} />
                    </Button>
                </td>
            </tr>
        )
    }

    const copyLogLine = async (raw: string) => {
        if (!isCurrentConnection()) {
            return
        }
        const ok = await copyToClipboard(redactSensitiveText(raw))
        if (!isCurrentConnection()) {
            return
        }
        if (ok) {
            showNotification(t('logs.copy_success', { defaultValue: 'Copied to clipboard' }), 'success')
        } else {
            showNotification(t('logs.copy_failed', { defaultValue: 'Copy failed' }), 'error')
        }
    }

    const clearLongPressTimer = () => {
        if (longPressRef.current?.timer) {
            window.clearTimeout(longPressRef.current.timer)
            longPressRef.current.timer = null
        }
    }

    const startLongPress = (event: ReactPointerEvent<HTMLElement>, id?: string) => {
        if (!isCurrentConnection()) {
            return
        }
        if (!requestLogEnabled) {
            return
        }
        if (!id) {
            return
        }
        if (requestLogId) {
            return
        }
        clearLongPressTimer()
        longPressRef.current = {
            timer: window.setTimeout(() => {
                if (!isCurrentConnection()) {
                    return
                }
                setRequestLogId(id)
                if (longPressRef.current) {
                    longPressRef.current.fired = true
                    longPressRef.current.timer = null
                }
            }, LONG_PRESS_MS),
            startX: event.clientX,
            startY: event.clientY,
            fired: false,
        }
    }

    const cancelLongPress = () => {
        clearLongPressTimer()
        longPressRef.current = null
    }

    const handleLongPressMove = (event: ReactPointerEvent<HTMLElement>) => {
        const current = longPressRef.current
        if (!current || current.timer === null || current.fired) {
            return
        }
        const deltaX = Math.abs(event.clientX - current.startX)
        const deltaY = Math.abs(event.clientY - current.startY)
        if (deltaX > LONG_PRESS_MOVE_THRESHOLD || deltaY > LONG_PRESS_MOVE_THRESHOLD) {
            cancelLongPress()
        }
    }

    const closeRequestLogModal = () => {
        if (!isCurrentConnection()) {
            return
        }
        if (requestLogDownloading) {
            return
        }
        setRequestLogId(null)
    }

    const downloadRequestLog = async (id: string, frozenHomeIp?: string | null) => {
        if (!isCurrentConnection()) {
            return
        }
        const request = requests.requestDownload.begin(authGeneration)
        setRequestLogDownloading(true)
        try {
            const homeIp   = frozenHomeIp === undefined ?
                             requestLogHomeIpByIdRef.current[id] :
                             frozenHomeIp || undefined
            const response = await logsApi.downloadRequestLogById(id, homeIp, {
                signal: request.controller.signal,
            })
            if (!requests.requestDownload.isCurrent(request, apiClient.getAuthGeneration())) {
                return
            }
            const text = redactSensitiveText(await responseDataToText(response.data))
            if (!requests.requestDownload.isCurrent(request, apiClient.getAuthGeneration())) {
                return
            }
            downloadBlob({
                             filename: `request-${id}.log`,
                             blob: new Blob([text], { type: 'text/plain' }),
                         })
            showNotification(t('logs.request_log_download_success'), 'success')
            setRequestLogId(null)
        } catch (err: unknown) {
            if (!requests.requestDownload.isCurrent(request, apiClient.getAuthGeneration())) {
                return
            }
            const message = getErrorMessage(err)
            showNotification(`${t('notification.download_failed')}${message ? `: ${message}` : ''}`, 'error')
        } finally {
            if (requests.requestDownload.isCurrent(request, apiClient.getAuthGeneration())) {
                requests.requestDownload.finish(request)
                setRequestLogDownloading(false)
            }
        }
    }

    const toggleRequestLog = async (enabled: boolean) => {
        if (!isCurrentConnection() || requestLogUpdating) {
            return
        }
        setRequestLogUpdating(true)
        try {
            await configApi.updateRequestLog(enabled)
            if (!isCurrentConnection()) {
                return
            }
            useConfigStore.getState().updateConfigValue('request-log', enabled)
            showNotification(t('notification.request_log_updated'), 'success')
            if (!enabled) {
                setRequestLogId(null)
            }
        } catch (err: unknown) {
            if (!isCurrentConnection()) {
                return
            }
            const message = getErrorMessage(err)
            showNotification(`${t('notification.update_failed')}${message ? `: ${message}` : ''}`, 'error')
        } finally {
            if (isCurrentConnection()) {
                setRequestLogUpdating(false)
            }
        }
    }

    const handleTabChange = (tab: TabType) => {
        setLogPanelFullscreen(false)
        setActiveTab(tab)
    }

    useEffect(() => {
        if (!logPanelFullscreen || activeTab !== 'logs' || pageLayerStatus !== 'current') {
            return
        }

        const handleKeyDown = (event: KeyboardEvent) => {
            if (shouldExitLogFullscreen(event, Boolean(document.querySelector('.modal-overlay')))) {
                setLogPanelFullscreen(false)
            }
        }

        lockScroll()
        window.addEventListener('keydown', handleKeyDown)
        return () => {
            unlockScroll()
            window.removeEventListener('keydown', handleKeyDown)
        }
    }, [activeTab, logPanelFullscreen, pageLayerStatus])

    return (
        <div className={styles.container}>
            <h1 className={styles.pageTitle}>{t('logs.title')}</h1>

            <Tabs
                className={styles.tabs}
                items={[
                    { value: 'logs', label: t('logs.log_content') },
                    { value: 'errors', label: t('logs.error_logs_modal_title') },
                ]}
                activeValue={activeTab}
                onChange={handleTabChange}
                ariaLabel={t('logs.title')}
            />

            <div className={styles.content}>
                {activeTab === 'logs' && (
                    <Card className={`${styles.logCard} ${logPanelFullscreen ? styles.logCardFullscreen : ''}`}>
                        {error && <div className='error-box'>{error}</div>}

                        <div className={styles.filters}>
                            <div className={styles.searchWrapper}>
                                <Input
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    placeholder={t('logs.search_placeholder')}
                                    className={styles.searchInput}
                                    rightElement={
                                        searchQuery ? (
                                            <button
                                                type='button'
                                                className={styles.searchClear}
                                                onClick={() => setSearchQuery('')}
                                                title={t('logs.search_clear', { defaultValue: 'Clear search' })}
                                                aria-label={t('logs.search_clear', { defaultValue: 'Clear search' })}
                                            >
                                                <IconX size={16} />
                                            </button>
                                        ) : (
                                            <IconSearch size={16} className={styles.searchIcon} />
                                        )
                                    }
                                />
                            </div>

                            <div className={styles.filterPanelHeader}>
                                <Button
                                    type='button'
                                    variant='secondary'
                                    size='sm'
                                    className={styles.filterPanelToggle}
                                    onClick={() => setStructuredFiltersExpanded((prev: boolean) => !prev)}
                                    aria-expanded={structuredFiltersExpanded}
                                    aria-controls={structuredFiltersPanelId}
                                    title={
                                        structuredFiltersExpanded
                                        ? t('logs.filter_panel_collapse')
                                        : t('logs.filter_panel_expand')
                                    }
                                >
                                    <span className={styles.filterPanelButtonContent}>
                                        <IconSlidersHorizontal size={16} />
                                        <span>{t('logs.filter_panel_title')}</span>
                                        {structuredFilterCount > 0 && (
                                            <span className={styles.filterPanelCount}>
                                                {t('logs.filter_panel_active_count', { count: structuredFilterCount })}
                                            </span>
                                        )}
                                        {structuredFiltersExpanded ? (
                                            <IconChevronUp size={16} />
                                        ) : (
                                             <IconChevronDown size={16} />
                                         )}
                                    </span>
                                </Button>
                                <Select
                                    value={levelFilter}
                                    onChange={setLevelFilter}
                                    options={[
                                        {value: '', label: t('logs.all_levels')},
                                        ...(['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const).map((level) => ({
                                            value: level,
                                            label: level.toUpperCase(),
                                        })),
                                    ]}
                                    ariaLabel={t('logs.level_filter')}
                                    fullWidth={false}
                                    disabled={disableControls}
                                    className={styles.levelSelect}
                                />
                            </div>

                            {structuredFiltersExpanded && (
                                <div id={structuredFiltersPanelId} className={styles.structuredFilters}>
                                    <div className={styles.filterChipGroup}>
                                        <span className={styles.filterChipLabel}>{t('logs.filter_method')}</span>
                                        <div className={styles.filterChipList}>
                                            {HTTP_METHODS.map((method) => {
                                                const active = filters.methodFilters.includes(method)
                                                const count  = filters.methodCounts[method] ?? 0
                                                return (
                                                    <button
                                                        key={method}
                                                        type='button'
                                                        className={`${styles.filterChip} ${
                                                            active ? styles.filterChipActive : ''
                                                        }`}
                                                        onClick={() => filters.toggleMethodFilter(method)}
                                                        disabled={count === 0 && !active}
                                                        aria-pressed={active}
                                                    >
                                                        {method} ({count})
                                                    </button>
                                                )
                                            })}
                                        </div>
                                    </div>

                                    <div className={styles.filterChipGroup}>
                                        <span className={styles.filterChipLabel}>{t('logs.filter_status')}</span>
                                        <div className={styles.filterChipList}>
                                            {STATUS_GROUPS.map((statusGroup) => {
                                                const active = filters.statusFilters.includes(statusGroup)
                                                const count  = filters.statusCounts[statusGroup] ?? 0
                                                return (
                                                    <button
                                                        key={statusGroup}
                                                        type='button'
                                                        className={`${styles.filterChip} ${
                                                            active ? styles.filterChipActive : ''
                                                        }`}
                                                        onClick={() => filters.toggleStatusFilter(statusGroup)}
                                                        disabled={count === 0 && !active}
                                                        aria-pressed={active}
                                                    >
                                                        {t(`logs.filter_status_${statusGroup}`)} ({count})
                                                    </button>
                                                )
                                            })}
                                        </div>
                                    </div>

                                    <div className={styles.filterChipGroup}>
                                        <span className={styles.filterChipLabel}>{t('logs.filter_path')}</span>
                                        <div className={styles.filterChipList}>
                                            {filters.pathOptions.length === 0 ? (
                                                <span className={styles.filterChipHint}>
                                                    {t('logs.filter_path_empty')}
                                                </span>
                                            ) : (
                                                 filters.pathOptions.map(({ path, count }) => {
                                                     const active       = filters.pathFilters.includes(path)
                                                     const redactedPath = redactSensitiveText(path)
                                                     return (
                                                         <button
                                                             key={path}
                                                             type='button'
                                                             className={`${styles.filterChip} ${
                                                                 active ? styles.filterChipActive : ''
                                                             }`}
                                                             onClick={() => filters.togglePathFilter(path)}
                                                             aria-pressed={active}
                                                             title={redactedPath}
                                                         >
                                                             {redactedPath} ({count})
                                                         </button>
                                                     )
                                                 })
                                             )}
                                        </div>
                                    </div>

                                    <Button
                                        variant='ghost'
                                        size='sm'
                                        onClick={filters.clearStructuredFilters}
                                        disabled={!filters.hasStructuredFilters}
                                    >
                                        {t('logs.clear_filters')}
                                    </Button>
                                </div>
                            )}

                            <ToggleSwitch
                                checked={hideManagementLogs}
                                onChange={setHideManagementLogs}
                                label={
                                    <span className={styles.switchLabel}>
                                        <IconEyeOff size={16} />
                                        {t('logs.hide_management_logs', { prefix: MANAGEMENT_API_PREFIX })}
                                    </span>
                                }
                            />

                            <ToggleSwitch
                                checked={wrapLogs}
                                onChange={(value) => {
                                    preserveLogViewport()
                                    setWrapLogs(value)
                                }}
                                label={t('logs.wrap_lines')}
                            />

                            <ToggleSwitch
                                checked={showRawLogs}
                                onChange={(value) => {
                                    preserveLogViewport()
                                    setShowRawLogs(value)
                                }}
                                label={
                                    <span
                                        className={styles.switchLabel}
                                        title={t('logs.show_raw_logs_hint', {
                                            defaultValue: 'Show original log text for easier multi-line copy',
                                        })}
                                    >
                                        <IconCode size={16} />
                                        {t('logs.show_raw_logs', { defaultValue: 'Show raw logs' })}
                                    </span>
                                }
                            />

                            <div className={styles.toolbar}>
                                <div className={styles.toolbarPrimary}>
                                    <Button
                                        variant='secondary'
                                        size='sm'
                                        onClick={() => loadLogs(false)}
                                        disabled={refreshDisabled}
                                        loading={loading}
                                        className={styles.actionButton}
                                    >
                                        <span className={styles.buttonContent}>
                                            <IconRefreshCw size={16} />
                                            {t('logs.refresh_button')}
                                        </span>
                                    </Button>
                                    <div className={styles.autoRefreshControlGroup}>
                                        <ToggleSwitch
                                            checked={autoRefresh}
                                            onChange={setAutoRefreshOverride}
                                            disabled={disableControls}
                                            label={
                                                <span className={styles.switchLabel}>
                                                    <IconTimer size={16} />
                                                    {t('logs.refresh_interval')}
                                                </span>
                                            }
                                        />
                                        <Select
                                            value={String(refreshInterval)}
                                            options={refreshIntervalOptions}
                                            onChange={(v) => setRefreshIntervalOverride(Number(v))}
                                            fullWidth={false}
                                            className={styles.intervalSelect}
                                            ariaLabel={t('logs.refresh_interval')}
                                        />
                                    </div>
                                </div>
                                <div className={styles.toolbarSecondary}>
                                    <Button
                                        variant={requestLogEnabled ? 'primary' : 'secondary'}
                                        size='sm'
                                        onClick={() => {
                                            void toggleRequestLog(!requestLogEnabled)
                                        }}
                                        disabled={disableControls || requestLogDownloading || requestLogUpdating}
                                        loading={requestLogUpdating}
                                        className={styles.actionButton}
                                    >
                                        <span className={styles.buttonContent}>
                                            <IconCode size={16} />
                                            {requestLogEnabled
                                             ? t('logs.request_log_disable_button', { defaultValue: '关闭请求日志' })
                                             : t('logs.request_log_enable_button', { defaultValue: '开启请求日志' })}
                                        </span>
                                    </Button>
                                    <Button
                                        variant='secondary'
                                        size='sm'
                                        onClick={downloadLogs}
                                        disabled={logState.buffer.length === 0}
                                        className={styles.actionButton}
                                    >
                                        <span className={styles.buttonContent}>
                                            <IconDownload size={16} />
                                            {t('logs.download_button')}
                                        </span>
                                    </Button>
                                    <Button
                                        type='button'
                                        variant='secondary'
                                        size='sm'
                                        onClick={() => setLogPanelFullscreen((prev) => !prev)}
                                        className={styles.actionButton}
                                        aria-pressed={logPanelFullscreen}
                                        title={
                                            logPanelFullscreen
                                            ? t('logs.fullscreen_exit')
                                            : t('logs.fullscreen_enter')
                                        }
                                    >
                                        <span className={styles.buttonContent}>
                                            {logPanelFullscreen ?
                                             <IconMinimize2 size={16} /> :
                                             <IconMaximize2 size={16} />}
                                            {logPanelFullscreen ?
                                             t('logs.fullscreen_exit') :
                                             t('logs.fullscreen_enter')}
                                        </span>
                                    </Button>
                                    <Button
                                        variant='danger'
                                        size='sm'
                                        onClick={clearLogs}
                                        disabled={clearDisabled}
                                        loading={clearingLogs}
                                        className={styles.actionButton}
                                    >
                                        <span className={styles.buttonContent}>
                                            <IconTrash2 size={16} />
                                            {t('logs.clear_button')}
                                        </span>
                                    </Button>
                                    {logDiskSize !== null && (
                                        <span
                                            className={styles.diskUsageBadge}
                                            title={t('logs.disk_usage_detail', {
                                                size: formatFileSize(logDiskSize.totalBytes),
                                                count: logDiskSize.fileCount,
                                            })}
                                        >
                                            {t('logs.disk_usage', { size: formatFileSize(logDiskSize.totalBytes) })}
                                        </span>
                                    )}
                                    <span className={styles.logReadStatus} role='status'>
                                        {error ? t('logs.read_failed') :
                                         loading ? t('logs.loading') :
                                         catchingUp ? t(autoRefresh ? 'logs.catching_up' : 'logs.more_logs') :
                                         t(autoRefresh ? 'logs.reading_continuously' : 'logs.reading_paused')}
                                    </span>
                                    {lastUpdated !== null && (
                                        <span className={styles.logReadStatus}>
                                            {t('logs.last_read', {
                                                time: new Date(lastUpdated).toLocaleTimeString(i18n.language),
                                            })}
                                        </span>
                                    )}
                                    {historyEvicted && (
                                        <Button
                                            variant='secondary'
                                            size='sm'
                                            onClick={() => {
                                                setLogPage(1)
                                                setHistoryEvicted(false)
                                                logScrollerRef.current?.scrollTo({ top: 0 })
                                            }}
                                            className={styles.actionButton}
                                        >
                                            {t('logs.history_evicted')}
                                        </Button>
                                    )}
                                </div>
                            </div>
                        </div>

                        <>
                            <div
                                ref={logScrollerRef}
                                className={`${styles.logPanel} ${logPanelFullscreen ? styles.logPanelFullscreen : ''} ${wrapLogs ? styles.logPanelWrapped : ''}`}
                                onScroll={() => {
                                    captureLogViewport()
                                }}
                                tabIndex={0}
                                role='region'
                                aria-label={t('logs.log_content')}
                                aria-busy={loading}
                            >
                                {logPanelFullscreen && (
                                    <div className={styles.fullscreenExitBar}>
                                        <Button
                                            type='button'
                                            variant='secondary'
                                            size='sm'
                                            onClick={() => setLogPanelFullscreen(false)}
                                        >
                                            <span className={styles.buttonContent}>
                                                <IconMinimize2 size={16} />
                                                {t('logs.fullscreen_exit')}
                                            </span>
                                        </Button>
                                    </div>
                                )}
                                {removedCount > 0 && (
                                    <div className={styles.loadMoreBanner}>
                                        <div className={styles.loadMoreStats}>
                                            <span>
                                                {t('logs.buffered_lines', { count: logState.buffer.length })}
                                            </span>
                                            {totalLogLines !== null && (
                                                <span className={styles.loadMoreCount}>
                                                    {t('logs.total_lines', { count: totalLogLines })}
                                                </span>
                                            )}
                                            <span className={styles.loadMoreCount}>
                                                {t('logs.filtered_lines', { count: removedCount })}
                                            </span>
                                            {hideManagementLogs && removedCount > 0 && (
                                                <span className={styles.loadMoreNotice}>
                                                    {t('logs.filtered_timeline_notice')}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                )}
                                {showRawLogs && logSheetStatus === 'ready' ? (
                                    <pre className={styles.rawLog} spellCheck={false}>
                                        {pagedParsed.map((line) => (
                                            <span key={line.id} data-log-id={line.id} style={{display: 'block'}}>
                                                {redactSensitiveText(line.raw) || ' '}
                                            </span>
                                        ))}
                                    </pre>
                                ) : (
                                     <Sheet
                                         rows={showRawLogs ? [] : pagedParsed}
                                         columns={logColumns}
                                         rowKey={(line) => String(line.id)}
                                         status={logSheetStatus}
                                         emptyText={logSheetEmptyText}
                                         emptyHint={logSheetEmptyHint}
                                         loadingText={t('logs.loading')}
                                         skeletonRowCount={6}
                                         className={styles.logSheet}
                                         scrollClassName={styles.logSheetScroll}
                                         tableWrapClassName={styles.logSheetTableWrap}
                                         tableClassName={styles.logTable}
                                         renderRow={renderLogRow}
                                     />
                                 )}
                            </div>
                            {!loading && totalFilteredLines > 0 && (
                                <Pagination
                                    total={totalFilteredLines}
                                    page={logPage}
                                    pageSize={logPageSize}
                                    onPageChange={(p) => {
                                        pendingViewportRestoreRef.current = null
                                        setLogPage(p)
                                        logScrollerRef.current?.scrollTo({ top: 0 })
                                    }}
                                    onPageSizeChange={(size) => {
                                        pendingViewportRestoreRef.current = null
                                        setLogPageSize(size)
                                        setLogPage(1)
                                        logScrollerRef.current?.scrollTo({top: 0})
                                    }}
                                />
                            )}
                        </>
                    </Card>
                )}

                {activeTab === 'errors' && (
                    <Card
                        extra={
                            <Button
                                variant='secondary'
                                size='sm'
                                onClick={loadErrorLogs}
                                loading={loadingErrors}
                                disabled={disableControls}
                            >
                                {t('common.refresh')}
                            </Button>
                        }
                    >
                        <div className='stack'>
                            <div className='hint'>
                                {t('logs.error_logs_description')}
                                {` `}
                                {t('logs.error_logs_retention', { count: config?.errorLogsMaxFiles ?? 10 })}
                            </div>

                            {requestLogEnabled && (
                                <div>
                                    <div className='status-badge warning'>
                                        {t('logs.error_logs_request_log_enabled')}
                                    </div>
                                </div>
                            )}

                            {errorLogsError && <div className='error-box'>{errorLogsError}</div>}

                            <div className={styles.errorPanel}>
                                {loadingErrors ? (
                                    <div className='hint'>{t('common.loading')}</div>
                                ) : errorLogs.length === 0 ? (
                                    <div className='hint'>{t('logs.error_logs_empty')}</div>
                                ) : (
                                        <div className='item-list'>
                                            {errorLogs.map((item) => (
                                                <div key={item.name} className='item-row'>
                                                    <div className='item-meta'>
                                                        <div className='item-title'>{item.name}</div>
                                                        <div className='item-subtitle'>
                                                            {item.size ?
                                                             `${(item.size / 1024).toFixed(1)} KB` :
                                                             ''}{' '}
                                                            {item.modified ? formatUnixTimestamp(item.modified) : ''}
                                                        </div>
                                                    </div>
                                                    <div className='item-actions'>
                                                        <Button
                                                            variant='ghost'
                                                            size='sm'
                                                            onClick={() => previewErrorLog(item)}
                                                            disabled={disableControls}
                                                        >
                                                            {t('logs.error_logs_preview')}
                                                        </Button>
                                                        <Button
                                                            variant='secondary'
                                                            size='sm'
                                                            onClick={() => downloadErrorLog(item.name)}
                                                            disabled={disableControls || errorLogDownloading !== null}
                                                            loading={errorLogDownloading === item.name}
                                                        >
                                                            {t('logs.error_logs_download')}
                                                        </Button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                            </div>
                        </div>
                    </Card>
                )}
            </div>

            <Modal
                open={Boolean(trace.traceLogLine)}
                onClose={trace.closeTraceModal}
                title={t('logs.trace_title')}
                width={900}
                footer={
                    <>
                        {trace.traceLogLine?.requestId && (
                            <Button
                                variant='secondary'
                                onClick={() => {
                                    if (trace.traceLogLine?.requestId) {
                                        void downloadRequestLog(
                                            trace.traceLogLine.requestId,
                                            trace.requestLogHomeIp,
                                        )
                                    }
                                }}
                                loading={requestLogDownloading}
                            >
                                {t('logs.trace_download_request_log')}
                            </Button>
                        )}
                        <Button variant='secondary' onClick={trace.closeTraceModal} disabled={requestLogDownloading}>
                            {t('common.close')}
                        </Button>
                    </>
                }
            >
                {trace.traceLogLine && (
                    <div className={styles.tracePanel}>
                        <div className={styles.traceNotice}>{t('logs.trace_notice')}</div>
                        <div className={styles.traceNotice}>{t('logs.trace_usage_field_guide')}</div>

                        <h3 className={styles.traceSectionTitle}>{t('logs.trace_log_info')}</h3>
                        <div className={styles.traceInfoGrid}>
                            <div className={styles.traceInfoItem}>
                                <span className={styles.traceInfoLabel}>{t('logs.trace_request_id')}</span>
                                <span className={styles.traceInfoValue}>{trace.traceLogLine.requestId ||
                                                                         notRecordedLabel}</span>
                            </div>
                            <div className={styles.traceInfoItem}>
                                <span className={styles.traceInfoLabel}>{t('logs.trace_method')}</span>
                                <span className={styles.traceInfoValue}>{trace.traceLogLine.method ||
                                                                         notRecordedLabel}</span>
                            </div>
                            <div className={styles.traceInfoItem}>
                                <span className={styles.traceInfoLabel}>{t('logs.trace_path')}</span>
                                <span className={styles.traceInfoValue}>{trace.traceLogLine.path ||
                                                                         notRecordedLabel}</span>
                            </div>
                            <div className={styles.traceInfoItem}>
                                <span className={styles.traceInfoLabel}>{t('logs.trace_status_code')}</span>
                                <span className={styles.traceInfoValue}>
                                    {typeof trace.traceLogLine.statusCode === 'number'
                                     ? trace.traceLogLine.statusCode
                                     : notRecordedLabel}
                                </span>
                            </div>
                            <div className={styles.traceInfoItem}>
                                <span className={styles.traceInfoLabel}>{t('logs.trace_proxy_latency')}</span>
                                <span className={styles.traceInfoValue}>{trace.traceLogLine.latency ||
                                                                         notRecordedLabel}</span>
                            </div>
                            <div className={styles.traceInfoItem}>
                                <span className={styles.traceInfoLabel}>{t('logs.trace_ip')}</span>
                                <span className={styles.traceInfoValue}>{trace.traceLogLine.ip ||
                                                                         notRecordedLabel}</span>
                            </div>
                            <div className={styles.traceInfoItem}>
                                <span className={styles.traceInfoLabel}>{t('logs.trace_timestamp')}</span>
                                <span className={styles.traceInfoValue}>
                                    {formatLogTimestamp(trace.traceLogLine.timestamp) || notRecordedLabel}
                                </span>
                            </div>
                            <div className={`${styles.traceInfoItem} ${styles.traceInfoItemWide}`}>
                                <span className={styles.traceInfoLabel}>{t('logs.trace_message')}</span>
                                <span className={styles.traceInfoValue}>{trace.traceLogLine.message
                                                                         ?
                                                                         redactSensitiveText(trace.traceLogLine.message)
                                                                         :
                                                                         notRecordedLabel}</span>
                            </div>
                        </div>

                        <div className={styles.traceCandidatesHeader}>
                            <h3 className={styles.traceSectionTitle}>{t('logs.trace_route_decision_title')}</h3>
                        </div>
                        {routeDecisionTrace.status === 'ready' && routeDecision ? (
                            <>
                                {routeDecision.candidateScope === 'selected_only' && (
                                    <div className={styles.traceNotice}>
                                        {t('logs.trace_route_selected_only_notice')}
                                    </div>
                                )}
                                {routeDecisionTrace.requestLogTruncated && (
                                    <div className={styles.traceNotice}>
                                        {t('logs.trace_route_log_truncated_ready')}
                                    </div>
                                )}
                                {routeDecision.truncatedCandidates > 0 && (
                                    <div className={styles.traceNotice}>
                                        {t('logs.trace_route_candidates_truncated_notice', {
                                            count: routeDecision.truncatedCandidates,
                                        })}
                                    </div>
                                )}
                                {routeDecisionTrace.omittedEvents > 0 && (
                                    <div className={styles.traceNotice}>
                                        {t('logs.trace_route_events_omitted_notice', {
                                            count: routeDecisionTrace.omittedEvents,
                                        })}
                                    </div>
                                )}
                                {routeDecisionTrace.invalidLines > 0 && (
                                    <div className={styles.traceNotice}>
                                        {t('logs.trace_route_invalid_lines_notice', {
                                            count: routeDecisionTrace.invalidLines,
                                        })}
                                    </div>
                                )}
                                <div className={styles.traceInfoGrid}>
                                    <div className={styles.traceInfoItem}>
                                        <span className={styles.traceInfoLabel}>{t('logs.trace_route_strategy')}</span>
                                        <span className={styles.traceInfoValue}>{routeDecision.strategy}</span>
                                    </div>
                                    {routeRequestLogStateLabel && (
                                        <div className={styles.traceInfoItem}>
                                            <span className={styles.traceInfoLabel}>
                                                {t('logs.trace_route_request_log_state')}
                                            </span>
                                            <span className={styles.traceInfoValue}>{routeRequestLogStateLabel}</span>
                                        </div>
                                    )}
                                    <div className={styles.traceInfoItem}>
                                        <span className={styles.traceInfoLabel}>{t('logs.trace_route_attempt')}</span>
                                        <span className={styles.traceInfoValue}>
                                            {routeDecisionTrace.attempt ?? notRecordedLabel}
                                        </span>
                                    </div>
                                    <div className={styles.traceInfoItem}>
                                        <span className={styles.traceInfoLabel}>
                                            {t('logs.trace_route_requested_model')}
                                        </span>
                                        <span className={styles.traceInfoValue}>
                                            {routeDecision.requestedModel || notRecordedLabel}
                                        </span>
                                    </div>
                                    <div className={styles.traceInfoItem}>
                                        <span
                                            className={styles.traceInfoLabel}>{t('logs.trace_route_routed_model')}</span>
                                        <span className={styles.traceInfoValue}>
                                            {routeDecision.routedModel || notRecordedLabel}
                                        </span>
                                    </div>
                                    <div className={styles.traceInfoItem}>
                                        <span className={styles.traceInfoLabel}>{t('logs.trace_route_providers')}</span>
                                        <span className={styles.traceInfoValue}>
                                            {routeDecision.providers.join(', ') || notRecordedLabel}
                                        </span>
                                    </div>
                                    <div className={styles.traceInfoItem}>
                                        <span className={styles.traceInfoLabel}>{t('logs.trace_route_affinity')}</span>
                                        <span className={styles.traceInfoValue}>
                                            {routeDecision.affinity || notRecordedLabel}
                                        </span>
                                    </div>
                                    <div className={styles.traceInfoItem}>
                                        <span
                                            className={styles.traceInfoLabel}>{t('logs.trace_route_matched_rule')}</span>
                                        <span className={styles.traceInfoValue}>
                                            {routeDecision.matchedRule || notRecordedLabel}
                                        </span>
                                    </div>
                                    <div className={styles.traceInfoItem}>
                                        <span className={styles.traceInfoLabel}>
                                            {t('logs.trace_route_candidate_scope')}
                                        </span>
                                        <span className={styles.traceInfoValue}>{routeCandidateScopeLabel}</span>
                                    </div>
                                    <div className={styles.traceInfoItem}>
                                        <span className={styles.traceInfoLabel}>
                                            {t('logs.trace_route_truncated_candidates')}
                                        </span>
                                        <span className={styles.traceInfoValue}>
                                            {formatNumber(routeDecision.truncatedCandidates, i18n.language)}
                                        </span>
                                    </div>
                                    <div className={styles.traceInfoItem}>
                                        <span className={styles.traceInfoLabel}>
                                            {t('logs.trace_route_omitted_events')}
                                        </span>
                                        <span className={styles.traceInfoValue}>
                                            {formatNumber(routeDecisionTrace.omittedEvents, i18n.language)}
                                        </span>
                                    </div>
                                    <div className={`${styles.traceInfoItem} ${styles.traceInfoItemWide}`}>
                                        <span className={styles.traceInfoLabel}>{t('logs.trace_route_selected')}</span>
                                        <span className={styles.traceInfoValue}>
                                            {routeDecision.selected
                                             ? [
                                                 routeDecision.selected.provider,
                                                 routeDecision.selected.targetModel || routeDecision.selected.model,
                                                 routeDecision.selected.authIndex,
                                                 routeDecision.selected.matchedRule,
                                             ].filter(Boolean).join(' · ')
                                             : t('logs.trace_route_no_selected')}
                                        </span>
                                    </div>
                                </div>

                                <h4 className={styles.traceSectionTitle}>{t('logs.trace_route_candidates')}</h4>
                                <div className={styles.traceCandidates}>
                                    {routeDecision.candidates.map((candidate) => {
                                        const sourceInfo     = trace.resolveTraceSourceInfo('', candidate.authIndex)
                                        const credentialName = sourceInfo.displayName !== '-' &&
                                                               sourceInfo.displayName !== candidate.authIndex
                                                               ? sourceInfo.displayName
                                                               : ''
                                        return (
                                            <div key={candidate.authIndex} className={styles.traceCandidate}>
                                                <div className={styles.traceCandidateHeader}>
                                                    {candidate.selected && (
                                                        <span className={styles.traceModelBadge}>
                                                        {t('logs.trace_route_selected_badge')}
                                                    </span>
                                                    )}
                                                    <span className={styles.traceInfoValue} title={candidate.authIndex}>
                                                    {[
                                                        candidate.provider,
                                                        credentialName,
                                                        sourceInfo.type,
                                                        candidate.authIndex,
                                                    ]
                                                        .filter(Boolean)
                                                        .join(' · ')}
                                                </span>
                                                </div>
                                                <div className={styles.traceCandidateGrid}>
                                                    <div className={styles.traceInfoItem}>
                                                        <span
                                                            className={styles.traceInfoLabel}>{t('logs.trace_model')}</span>
                                                        <span className={styles.traceInfoValue}>
                                                        {candidate.model || notRecordedLabel}
                                                    </span>
                                                    </div>
                                                    <div className={styles.traceInfoItem}>
                                                    <span className={styles.traceInfoLabel}>
                                                        {t('logs.trace_route_target_model')}
                                                    </span>
                                                        <span className={styles.traceInfoValue}>
                                                        {candidate.targetModel || notRecordedLabel}
                                                    </span>
                                                    </div>
                                                    <div className={styles.traceInfoItem}>
                                                    <span className={styles.traceInfoLabel}>
                                                        {t('logs.trace_route_priority')}
                                                    </span>
                                                        <span
                                                            className={styles.traceInfoValue}>{candidate.priority}</span>
                                                    </div>
                                                    <div className={styles.traceInfoItem}>
                                                    <span className={styles.traceInfoLabel}>
                                                        {t('logs.trace_route_effective_weight')}
                                                    </span>
                                                        <span className={styles.traceInfoValue}>
                                                        {candidate.effectiveWeight}
                                                    </span>
                                                    </div>
                                                    <div className={styles.traceInfoItem}>
                                                        <span className={styles.traceInfoLabel}>{t(
                                                            'logs.trace_route_native')}</span>
                                                        <span className={styles.traceInfoValue}>
                                                        {formatRouteBoolean(candidate.native)}
                                                    </span>
                                                    </div>
                                                    <div className={styles.traceInfoItem}>
                                                    <span className={styles.traceInfoLabel}>
                                                        {t('logs.trace_route_converted')}
                                                    </span>
                                                        <span className={styles.traceInfoValue}>
                                                        {formatRouteBoolean(candidate.converted)}
                                                    </span>
                                                    </div>
                                                    <div className={styles.traceInfoItem}>
                                                    <span className={styles.traceInfoLabel}>
                                                        {t('logs.trace_route_affinity')}
                                                    </span>
                                                        <span className={styles.traceInfoValue}>
                                                        {candidate.affinity || notRecordedLabel}
                                                    </span>
                                                    </div>
                                                    <div className={styles.traceInfoItem}>
                                                    <span className={styles.traceInfoLabel}>
                                                        {t('logs.trace_route_quota_status')}
                                                    </span>
                                                        <span className={styles.traceInfoValue}>
                                                        {formatRouteQuotaStatus(candidate.quotaStatus)}
                                                    </span>
                                                    </div>
                                                    <div className={styles.traceInfoItem}>
                                                    <span className={styles.traceInfoLabel}>
                                                        {t('logs.trace_route_quota_headroom')}
                                                    </span>
                                                        <span className={styles.traceInfoValue}>
                                                        {candidate.quotaHeadroom === null
                                                         ? routeBackendNotProvidedLabel
                                                         : `${new Intl.NumberFormat(i18n.language, {
                                                                maximumFractionDigits: 1,
                                                            }).format(candidate.quotaHeadroom * 100)}%`}
                                                    </span>
                                                    </div>
                                                    <div className={styles.traceInfoItem}>
                                                    <span className={styles.traceInfoLabel}>
                                                        {t('logs.trace_route_quota_reset_after')}
                                                    </span>
                                                        <span className={styles.traceInfoValue}>
                                                        {formatTraceDuration(
                                                            candidate.quotaResetAfterMs,
                                                            i18n.language,
                                                            routeBackendNotProvidedLabel,
                                                        )}
                                                    </span>
                                                    </div>
                                                    <div className={styles.traceInfoItem}>
                                                    <span className={styles.traceInfoLabel}>
                                                        {t('logs.trace_route_in_flight')}
                                                    </span>
                                                        <span className={styles.traceInfoValue}>
                                                        {formatRouteNullableNumber(candidate.inFlight)}
                                                    </span>
                                                    </div>
                                                    <div className={styles.traceInfoItem}>
                                                    <span className={styles.traceInfoLabel}>
                                                        {t('logs.trace_route_matched_rules')}
                                                    </span>
                                                        <span className={styles.traceInfoValue}>
                                                        {candidate.matchedRules.join(', ') ||
                                                         t('logs.trace_route_none')}
                                                    </span>
                                                    </div>
                                                    <div
                                                        className={`${styles.traceInfoItem} ${styles.traceInfoItemWide}`}>
                                                    <span className={styles.traceInfoLabel}>
                                                        {t('logs.trace_route_excluded_reasons')}
                                                    </span>
                                                        <span className={styles.traceInfoValue}>
                                                        {candidate.excludedReasons.join(', ') ||
                                                         t('logs.trace_route_none')}
                                                    </span>
                                                    </div>
                                                    <div
                                                        className={`${styles.traceInfoItem} ${styles.traceInfoItemWide}`}>
                                                    <span className={styles.traceInfoLabel}>
                                                        {t('logs.trace_route_cooldown_exact_model')}
                                                    </span>
                                                        <span className={styles.traceInfoValue}>
                                                        {formatRouteCooldown(candidate.cooldowns.exactModel)}
                                                    </span>
                                                    </div>
                                                    <div
                                                        className={`${styles.traceInfoItem} ${styles.traceInfoItemWide}`}>
                                                    <span className={styles.traceInfoLabel}>
                                                        {t('logs.trace_route_cooldown_quota_family')}
                                                    </span>
                                                        <span className={styles.traceInfoValue}>
                                                        {formatRouteCooldown(candidate.cooldowns.quotaFamily)}
                                                    </span>
                                                    </div>
                                                    <div
                                                        className={`${styles.traceInfoItem} ${styles.traceInfoItemWide}`}>
                                                    <span className={styles.traceInfoLabel}>
                                                        {t('logs.trace_route_cooldown_credential')}
                                                    </span>
                                                        <span className={styles.traceInfoValue}>
                                                        {formatRouteCooldown(candidate.cooldowns.credential)}
                                                    </span>
                                                    </div>
                                                    <div
                                                        className={`${styles.traceInfoItem} ${styles.traceInfoItemWide}`}>
                                                    <span className={styles.traceInfoLabel}>
                                                        {t('logs.trace_route_cooldown_provider')}
                                                    </span>
                                                        <span className={styles.traceInfoValue}>
                                                        {formatRouteCooldown(candidate.cooldowns.provider)}
                                                    </span>
                                                    </div>
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>
                            </>
                        ) : routeDecisionTrace.status !== 'idle' ? (
                            <div className={styles.traceNotice}>
                                <span>{routeDecisionStatusLabel}</span>
                                {routeRequestLogStateLabel &&
                                 routeRequestLogStateLabel !==
                                 routeDecisionStatusLabel &&
                                 (
                                     <span> · {routeRequestLogStateLabel}</span>
                                 )}
                                {routeDecisionTrace.message && (
                                    <span> · {redactSensitiveText(routeDecisionTrace.message)}</span>
                                )}
                            </div>
                        ) : null}

                        <div className={styles.traceCandidatesHeader}>
                            <h3 className={styles.traceSectionTitle}>{t('logs.trace_candidates_title')}</h3>
                            <Button
                                variant='secondary'
                                size='sm'
                                onClick={() => {
                                    void trace.refreshTraceUsageDetails().catch(() => {
                                    })
                                }}
                                loading={trace.traceLoading}
                                disabled={requestLogDownloading}
                            >
                                {t('common.refresh')}
                            </Button>
                        </div>
                        {trace.traceLoading ? (
                            <div className='hint'>{t('logs.trace_loading')}</div>
                        ) : trace.traceError ? (
                            <div className='error-box'>{trace.traceError}</div>
                        ) : trace.traceCandidates.length === 0 ? (
                            <div className='hint'>{t('logs.trace_no_match')}</div>
                        ) : (
                                <div className={styles.traceCandidates}>
                                    {trace.traceCandidates.map((candidate) => {
                                        const detail          = candidate.detail
                                        const sourceInfo      = trace.resolveTraceSourceInfo(
                                            String(detail.source ?? ''),
                                            detail.auth_index,
                                        )
                                        const tokens          = detail.tokens
                                        const inputTokens     = maxTraceTokenValue(tokens?.input_tokens)
                                        const outputTokens    = maxTraceTokenValue(tokens?.output_tokens)
                                        const reasoningTokens = maxTraceTokenValue(tokens?.reasoning_tokens)
                                        const cachedTokens    = maxTraceTokenValue(
                                            tokens?.cached_tokens,
                                            tokens?.cache_tokens,
                                        )
                                        const thinking        = detail.thinking ??
                                                                (detail.reasoning_effort ?
                                                                    { intensity: detail.reasoning_effort } :
                                                                 null)
                                        const thinkingLabel   = thinking
                                                                ? formatThinkingLabel(thinking, i18n.language)
                                                                : notRecordedLabel
                                        const completedLabel  =
                                                  typeof detail.completed === 'boolean'
                                                  ? detail.completed
                                                    ?
                                                    t(
                                                        'usage_stats.request_events_completed',
                                                        { defaultValue: 'Completed' },
                                                    )
                                                    :
                                                    t(
                                                        'usage_stats.request_events_incomplete',
                                                        { defaultValue: 'Incomplete' },
                                                    )
                                                  : notRecordedLabel
                                        return (
                                            <div
                                                key={[
                                                    detail.__endpoint,
                                                    detail.__modelName,
                                                    detail.timestamp,
                                                    detail.source,
                                                ].join('-')}
                                                className={styles.traceCandidate}
                                            >
                                                <div className={styles.traceCandidateHeader}>
                                                    {candidate.modelMatched && (
                                                        <span className={styles.traceModelBadge}>
                                                        {t('logs.trace_model_matched')}
                                                    </span>
                                                    )}
                                                    {candidate.timeDeltaMs !== null && (
                                                        <span className={styles.traceDelta}>
                                                        {t('logs.trace_delta_seconds', {
                                                            seconds: (candidate.timeDeltaMs / 1000).toFixed(2),
                                                        })}
                                                    </span>
                                                    )}
                                                </div>
                                                <div className={styles.traceCandidateGrid}>
                                                    <div className={styles.traceInfoItem}>
                                                    <span className={styles.traceInfoLabel}>
                                                        {t('logs.trace_endpoint')}
                                                    </span>
                                                        <span className={styles.traceInfoValue}>
                                                        {detail.__endpoint}
                                                    </span>
                                                    </div>
                                                    <div className={styles.traceInfoItem}>
                                                    <span className={styles.traceInfoLabel}>
                                                        {t('logs.trace_model')}
                                                    </span>
                                                        <span className={styles.traceInfoValue}>
                                                        {detail.__modelName || notRecordedLabel}
                                                    </span>
                                                    </div>
                                                    <div className={styles.traceInfoItem}>
                                                    <span className={styles.traceInfoLabel}>
                                                        {t('logs.trace_source')}
                                                    </span>
                                                        <span
                                                            className={styles.traceInfoValue}
                                                            title={String(detail.source || notRecordedLabel)}
                                                        >
                                                        <span>{sourceInfo.displayName || notRecordedLabel}</span>
                                                            {sourceInfo.type && (
                                                                <span className={styles.traceSourceType}>
                                                                {sourceInfo.type}
                                                            </span>
                                                            )}
                                                    </span>
                                                    </div>
                                                    <div className={styles.traceInfoItem}>
                                                    <span className={styles.traceInfoLabel}>
                                                        {t('logs.trace_auth_index')}
                                                    </span>
                                                        <span className={styles.traceInfoValue}>
                                                        {detail.auth_index ?? notRecordedLabel}
                                                    </span>
                                                    </div>
                                                    <div className={styles.traceInfoItem}>
                                                    <span className={styles.traceInfoLabel}>
                                                        {t('logs.trace_timestamp')}
                                                    </span>
                                                        <span className={styles.traceInfoValue}>
                                                        {formatLogTimestamp(detail.timestamp) || notRecordedLabel}
                                                    </span>
                                                    </div>
                                                    <div className={styles.traceInfoItem}>
                                                    <span className={styles.traceInfoLabel}>
                                                        {t('logs.trace_result')}
                                                    </span>
                                                        <span className={styles.traceInfoValue}>
                                                        {detail.failed
                                                         ? t('stats.failure')
                                                         : t('stats.success')}
                                                    </span>
                                                    </div>
                                                    <div className={styles.traceInfoItem}>
                                                    <span className={styles.traceInfoLabel}>
                                                        {t('logs.trace_usage_request_id')}
                                                    </span>
                                                        <span className={styles.traceInfoValue}>
                                                        {detail.request_id || notRecordedLabel}
                                                    </span>
                                                    </div>
                                                    <div className={styles.traceInfoItem}>
                                                    <span className={styles.traceInfoLabel}>
                                                        {t('logs.trace_usage_total_duration')}
                                                    </span>
                                                        <span className={styles.traceInfoValue}>
                                                        {formatTraceDuration(
                                                            detail.total_duration_ms,
                                                            i18n.language,
                                                            notRecordedLabel,
                                                        )}
                                                    </span>
                                                    </div>
                                                    <div className={styles.traceInfoItem}>
                                                    <span className={styles.traceInfoLabel}>
                                                        {t('logs.trace_recorded_latency')}
                                                    </span>
                                                        <span className={styles.traceInfoValue}>
                                                        {formatTraceDuration(
                                                            detail.latency_ms,
                                                            i18n.language,
                                                            notRecordedLabel,
                                                        )}
                                                    </span>
                                                    </div>
                                                    <div className={styles.traceInfoItem}>
                                                    <span className={styles.traceInfoLabel}>
                                                        {t('logs.trace_time_to_first_byte')}
                                                    </span>
                                                        <span className={styles.traceInfoValue}>
                                                        {formatTraceDuration(
                                                            detail.time_to_first_byte_ms,
                                                            i18n.language,
                                                            notRecordedLabel,
                                                        )}
                                                    </span>
                                                    </div>
                                                    <div className={styles.traceInfoItem}>
                                                    <span className={styles.traceInfoLabel}>
                                                        {t('logs.trace_input_tokens')}
                                                    </span>
                                                        <span className={styles.traceInfoValue}>
                                                        {formatTraceToken(inputTokens, i18n.language, notRecordedLabel)}
                                                    </span>
                                                    </div>
                                                    <div className={styles.traceInfoItem}>
                                                    <span className={styles.traceInfoLabel}>
                                                        {t('logs.trace_output_tokens')}
                                                    </span>
                                                        <span className={styles.traceInfoValue}>
                                                        {formatTraceToken(
                                                            outputTokens,
                                                            i18n.language,
                                                            notRecordedLabel,
                                                        )}
                                                    </span>
                                                    </div>
                                                    <div className={styles.traceInfoItem}>
                                                    <span className={styles.traceInfoLabel}>
                                                        {t('logs.trace_reasoning_tokens')}
                                                    </span>
                                                        <span className={styles.traceInfoValue}>
                                                        {formatTraceToken(
                                                            reasoningTokens,
                                                            i18n.language,
                                                            notRecordedLabel,
                                                        )}
                                                    </span>
                                                    </div>
                                                    <div className={styles.traceInfoItem}>
                                                    <span className={styles.traceInfoLabel}>
                                                        {t('logs.trace_cached_tokens')}
                                                    </span>
                                                        <span className={styles.traceInfoValue}>
                                                        {formatTraceToken(
                                                            cachedTokens,
                                                            i18n.language,
                                                            notRecordedLabel,
                                                        )}
                                                    </span>
                                                    </div>
                                                    <div className={styles.traceInfoItem}>
                                                    <span className={styles.traceInfoLabel}>
                                                        {t('logs.trace_cache_hit')}
                                                    </span>
                                                        <span className={styles.traceInfoValue}>
                                                        {formatTracePercent(
                                                            cachedTokens,
                                                            inputTokens,
                                                            i18n.language,
                                                            notRecordedLabel,
                                                        )}
                                                    </span>
                                                    </div>
                                                    <div className={styles.traceInfoItem}>
                                                    <span className={styles.traceInfoLabel}>
                                                        {t('logs.trace_thinking')}
                                                    </span>
                                                        <span className={styles.traceInfoValue}>{thinkingLabel}</span>
                                                    </div>
                                                    <div className={styles.traceInfoItem}>
                                                    <span className={styles.traceInfoLabel}>
                                                        {t('logs.trace_completed')}
                                                    </span>
                                                        <span className={styles.traceInfoValue}>{completedLabel}</span>
                                                    </div>
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>
                            )}
                    </div>
                )}
            </Modal>

            <Modal
                open={Boolean(requestLogId)}
                onClose={closeRequestLogModal}
                title={t('logs.request_log_download_title')}
                footer={
                    <>
                        <Button variant='secondary' onClick={closeRequestLogModal} disabled={requestLogDownloading}>
                            {t('common.cancel')}
                        </Button>
                        <Button
                            onClick={() => {
                                if (requestLogId) {
                                    void downloadRequestLog(requestLogId)
                                }
                            }}
                            loading={requestLogDownloading}
                            disabled={!requestLogId}
                        >
                            {t('common.confirm')}
                        </Button>
                    </>
                }
            >
                {requestLogId ? t('logs.request_log_download_confirm', { id: requestLogId }) : null}
            </Modal>

            <Modal
                open={errorLogViewer.status !== 'closed'}
                onClose={closeErrorLogViewer}
                title={selectedErrorLog?.name ?? ''}
                width={720}
                footer={
                    <>
                        <Button
                            variant='secondary'
                            onClick={() => {
                                if (errorLogViewer.status === 'ready') {
                                    void copyLogLine(errorLogViewer.text)
                                }
                            }}
                            disabled={errorLogViewer.status !== 'ready' || !errorLogViewer.text}
                        >
                            {t('common.copy')}
                        </Button>
                        <Button
                            variant='secondary'
                            onClick={() => {
                                if (selectedErrorLog) {
                                    void downloadErrorLog(selectedErrorLog.name)
                                }
                            }}
                            disabled={errorLogViewer.status === 'loading' || errorLogDownloading !== null}
                            loading={selectedErrorLog !== null && errorLogDownloading === selectedErrorLog.name}
                        >
                            {t('logs.error_logs_download')}
                        </Button>
                    </>
                }
            >
                {errorLogViewer.status === 'loading' && (
                    <div className='hint'>{t('common.loading')}</div>
                )}
                {errorLogViewer.status === 'error' && (
                    <div className='error-box'>{errorLogViewer.message}</div>
                )}
                {errorLogViewer.status === 'ready' && (
                    errorLogViewer.text ?
                    <pre className={styles.previewContent}>{errorLogViewer.text}</pre> :
                    <div className='hint'>{t('logs.error_log_empty_content')}</div>
                )}
            </Modal>
        </div>
    )
}
