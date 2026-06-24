import type {DataStatusValue} from '@/components/common/DataStatusCard'
import {Sheet, type SheetColumn} from '@/components/common/Sheet'
import {Button} from '@/components/ui/Button'
import {Card} from '@/components/ui/Card'
import {
    IconChevronDown,
    IconChevronUp,
    IconCode,
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
import {Select} from '@/components/ui/Select'
import {Tabs} from '@/components/ui/Tabs'
import {ToggleSwitch} from '@/components/ui/ToggleSwitch'
import {useHeaderRefresh} from '@/hooks/useHeaderRefresh'
import {useLocalStorage} from '@/hooks/useLocalStorage'
import {configApi} from '@/services/api/config'
import {logsApi} from '@/services/api/logs'
import {useAuthStore, useConfigStore, useNotificationStore} from '@/stores'
import {AUTO_REFRESH_INTERVALS, resolveAutoRefreshMs} from '@/utils/autoRefresh'
import {copyToClipboard} from '@/utils/clipboard'
import {MANAGEMENT_API_PREFIX} from '@/utils/constants'
import {downloadBlob} from '@/utils/download'
import {formatFileSize, formatLogTimestamp, formatNumber, formatUnixTimestamp} from '@/utils/format'
import {formatDurationMs, formatThinkingLabel} from '@/utils/usage'
import type {PointerEvent as ReactPointerEvent} from 'react'
import {useDeferredValue, useEffect, useMemo, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {parseLogLine} from './hooks/logParsing'
import {
    HTTP_METHODS,
    type LogState,
    type ParsedLogLine,
    type PersistedLogFilters,
    resolveStatusGroup,
    STATUS_GROUPS,
} from './hooks/logTypes'
import {useLogFilters} from './hooks/useLogFilters'
import {isTraceableRequestPath, useTraceResolver} from './hooks/useTraceResolver'
import styles from './LogsPage.module.scss'

interface ErrorLogItem {
    name: string
    size?: number
    modified?: number
}

// 初始只渲染最近 100 行，滚动到顶部再逐步加载更多（避免一次性渲染过多导致卡顿）
const MAX_BUFFER_LINES          = 10000
const DEFAULT_LOG_PAGE_SIZE     = 50
const LONG_PRESS_MS             = 650
const LONG_PRESS_MOVE_THRESHOLD = 10

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

export function LogsPage() {
    const { t, i18n }                            = useTranslation()
    const { showNotification, showConfirmation } = useNotificationStore()
    const connectionStatus                       = useAuthStore((state) => state.connectionStatus)
    const apiBase                                = useAuthStore((state) => state.apiBase)
    const managementKey                          = useAuthStore((state) => state.managementKey)
    const traceScopeKey                          = `${apiBase}::${managementKey}`
    const config                                 = useConfigStore((state) => state.config)
    const requestLogEnabled                      = config?.requestLog ?? false

    const [activeTab, setActiveTab]                                 = useState<TabType>('logs')
    const [logState, setLogState]                                   = useState<LogState>({
                                                                                             buffer: [],
                                                                                         })
    const [loading, setLoading]                                     = useState(true)
    const [error, setError]                                         = useState('')
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
    const deferredSearchQuery                                       = useDeferredValue(searchQuery)
    const [hideManagementLogs, setHideManagementLogs]               = useLocalStorage(
        'logsPage.hideManagementLogs',
        true,
    )
    const [showRawLogs, setShowRawLogs]                             = useLocalStorage('logsPage.showRawLogs', false)
    const [structuredFiltersExpanded, setStructuredFiltersExpanded] = useLocalStorage(
        'logsPage.structuredFiltersExpanded',
        true,
    )
    const [storedFilters, setStoredFilters]                         = useLocalStorage<PersistedLogFilters>(
        'logsPage.structuredFilters',
        DEFAULT_PERSISTED_LOG_FILTERS,
    )
    const [errorLogs, setErrorLogs]                                 = useState<ErrorLogItem[]>([])
    const [loadingErrors, setLoadingErrors]                         = useState(false)
    const [errorLogsError, setErrorLogsError]                       = useState('')
    const [requestLogId, setRequestLogId]                           = useState<string | null>(null)
    const [requestLogUpdating, setRequestLogUpdating]               = useState(false)
    const [logDiskSize, setLogDiskSize]                             = useState<{
                                                                                   totalBytes: number;
                                                                                   fileCount: number
                                                                               } | null>(null)
    const [totalLogLines, setTotalLogLines]                         = useState(0)
    const notRecordedLabel                                          = t('usage_stats.request_events_not_recorded', {
        defaultValue: 'Not recorded',
    })

    // 错误日志预览
    const [previewName, setPreviewName]                     = useState<string | null>(null)
    const [previewContent, setPreviewContent]               = useState('')
    const [previewLoading, setPreviewLoading]               = useState(false)
    const [requestLogDownloading, setRequestLogDownloading] = useState(false)
    const [logPanelFullscreen, setLogPanelFullscreen]       = useState(false)

    const trace = useTraceResolver({
                                       traceScopeKey,
                                       connectionStatus,
                                       config,
                                       requestLogDownloading,
                                   })

    const logScrollerRef            = useRef<HTMLDivElement | null>(null)
    const logViewportRef            = useRef({
                                                 page: 1,
                                                 pageStart: 0,
                                                 scrollTop: 0,
                                                 anchorRaw: '',
                                             })
    const pendingViewportRestoreRef = useRef<{
                                                 anchorRaw: string
                                                 scrollTop: number
                                                 targetPage?: number
                                             } | null>(null)
    const longPressRef              = useRef<{
                                                 timer: number | null
                                                 startX: number
                                                 startY: number
                                                 fired: boolean
                                             } | null>(null)
    const logRequestInFlightRef     = useRef(false)
    const pendingFullReloadRef      = useRef(false)

    // 保存最新时间戳用于增量获取
    const latestTimestampRef = useRef<number>(0)

    const disableControls = connectionStatus !== 'connected'

    // 分页状态
    const [logPage, setLogPage]         = useState(1)
    const [logPageSize, setLogPageSize] = useLocalStorage('logsPage.pageSize', DEFAULT_LOG_PAGE_SIZE)

    const loadLogs = async (incremental = false) => {
        if (connectionStatus !== 'connected') {
            setLoading(false)
            return
        }

        if (logRequestInFlightRef.current) {
            if (!incremental) {
                pendingFullReloadRef.current = true
            }
            return
        }

        logRequestInFlightRef.current = true

        if (!incremental) {
            setLoading(true)
        }
        setError('')

        try {
            const params =
                      incremental && latestTimestampRef.current > 0
                      ? { after: latestTimestampRef.current }
                      : { limit: MAX_BUFFER_LINES }
            const [data] = await Promise.all([
                                                 logsApi.fetchLogs(params),
                                                 // 非增量加载时同步刷新磁盘占用
                                                 incremental
                                                 ? Promise.resolve(null)
                                                 : logsApi
                                                     .fetchLogSize()
                                                     .then((res) => {
                                                         setLogDiskSize({
                                                                            totalBytes: res.total_bytes,
                                                                            fileCount: res.file_count,
                                                                        })
                                                         return res
                                                     })
                                                     .catch(() => null),
                                             ])

            // 更新时间戳
            if (data['latest-timestamp']) {
                latestTimestampRef.current = data['latest-timestamp']
            }
            setTotalLogLines(typeof data['line-count'] === 'number' ? data['line-count'] : 0)

            const newLines = Array.isArray(data.lines) ? data.lines : []

            if (incremental && newLines.length > 0) {
                const viewport = logViewportRef.current
                if (!(viewport.page === 1 && viewport.scrollTop <= 2) && viewport.anchorRaw) {
                    pendingViewportRestoreRef.current = {
                        anchorRaw: viewport.anchorRaw,
                        scrollTop: viewport.scrollTop,
                    }
                }

                // 增量更新：追加新日志并限制缓冲区大小
                setLogState((prev) => {
                    const combined  = [...prev.buffer, ...newLines]
                    const dropCount = Math.max(combined.length - MAX_BUFFER_LINES, 0)
                    const buffer    = dropCount > 0 ? combined.slice(dropCount) : combined
                    return { buffer }
                })
            } else if (!incremental) {
                // 全量加载
                const buffer = newLines.slice(-MAX_BUFFER_LINES)
                setLogState({ buffer })
                setLogPage(1)
            }
        } catch (err: unknown) {
            setError(getErrorMessage(err) || t('logs.load_error'))
        } finally {
            if (!incremental) {
                setLoading(false)
            }
            logRequestInFlightRef.current = false
            if (pendingFullReloadRef.current) {
                pendingFullReloadRef.current = false
                void loadLogs(false)
            }
        }
    }

    useHeaderRefresh(() => loadLogs(false))

    const clearLogs = async () => {
        showConfirmation({
                             title: t('logs.clear_confirm_title', { defaultValue: 'Clear Logs' }),
                             message: t('logs.clear_confirm'),
                             variant: 'danger',
                             confirmText: t('common.confirm'),
                             onConfirm: async () => {
                                 try {
                                     await logsApi.clearLogs()
                                     setLogState({ buffer: [] })
                                     latestTimestampRef.current = 0
                                     setLogPage(1)
                                     showNotification(t('logs.clear_success'), 'success')
                                     logsApi
                                         .fetchLogSize()
                                         .then((res) => {
                                             setLogDiskSize({ totalBytes: res.total_bytes, fileCount: res.file_count })
                                         })
                                         .catch((e) => {
                                             console.warn('[LogsPage] fetchLogSize failed', e)
                                         })
                                 } catch (err: unknown) {
                                     const message = getErrorMessage(err)
                                     showNotification(`${t('notification.delete_failed')}${message ?
                                                                                           `: ${message}` :
                                                                                           ''}`, 'error')
                                 }
                             },
                         })
    }

    const downloadLogs = () => {
        const text = logState.buffer.join('\n')
        downloadBlob({ filename: 'logs.txt', blob: new Blob([text], { type: 'text/plain' }) })
        showNotification(t('logs.download_success'), 'success')
    }

    const loadErrorLogs = async () => {
        if (connectionStatus !== 'connected') {
            setLoadingErrors(false)
            return
        }

        setLoadingErrors(true)
        setErrorLogsError('')
        try {
            const res = await logsApi.fetchErrorLogs()
            // API 返回 { files: [...] }
            setErrorLogs(Array.isArray(res.files) ? res.files : [])
        } catch (err: unknown) {
            console.error('Failed to load error logs:', err)
            setErrorLogs([])
            const message = getErrorMessage(err)
            setErrorLogsError(
                message ? `${t('logs.error_logs_load_error')}: ${message}` : t('logs.error_logs_load_error'),
            )
        } finally {
            setLoadingErrors(false)
        }
    }

    const downloadErrorLog = async (name: string) => {
        try {
            const response = await logsApi.downloadErrorLog(name)
            downloadBlob({ filename: name, blob: new Blob([response.data], { type: 'text/plain' }) })
            showNotification(t('logs.error_log_download_success'), 'success')
        } catch (err: unknown) {
            const message = getErrorMessage(err)
            showNotification(`${t('notification.download_failed')}${message ? `: ${message}` : ''}`, 'error')
        }
    }

    const previewErrorLog = async (name: string) => {
        setPreviewName(name)
        setPreviewContent('')
        setPreviewLoading(true)
        try {
            const result = await logsApi.previewErrorLog(name, 500)
            setPreviewContent(result.content)
        } catch (err: unknown) {
            setPreviewContent(getErrorMessage(err) || 'Failed to load preview')
        } finally {
            setPreviewLoading(false)
        }
    }

    useEffect(() => {
        if (connectionStatus === 'connected') {
            latestTimestampRef.current = 0
            void loadLogs(false)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [connectionStatus])

    useEffect(() => {
        if (activeTab !== 'errors') {
            return
        }
        if (connectionStatus !== 'connected') {
            return
        }
        queueMicrotask(() => {
            void loadErrorLogs()
        })
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeTab, connectionStatus, requestLogEnabled])

    useEffect(() => {
        if (!autoRefresh || refreshInterval <= 0 || connectionStatus !== 'connected') {
            return
        }
        const id = window.setInterval(() => {
            void loadLogs(true)
        }, refreshInterval)
        return () => window.clearInterval(id)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [autoRefresh, connectionStatus, refreshInterval])

    const trimmedSearchQuery = deferredSearchQuery.trim()
    const isSearching        = trimmedSearchQuery.length > 0

    const parsedSearchLines = useMemo(() => {
        let working = logState.buffer

        if (hideManagementLogs) {
            working = working.filter((line) => !line.includes(MANAGEMENT_API_PREFIX))
        }

        if (trimmedSearchQuery) {
            const queryLowered = trimmedSearchQuery.toLowerCase()
            working            = working.filter((line) => line.toLowerCase().includes(queryLowered))
        }

        return working.map((line) => parseLogLine(line))
    }, [logState.buffer, hideManagementLogs, trimmedSearchQuery])

    const filters                  = useLogFilters({
                                                       parsedLines: parsedSearchLines,
                                                       initialFilters: storedFilters,
                                                       onFiltersChange: setStoredFilters,
                                                   })
    const structuredFiltersPanelId = 'logs-structured-filters'
    const structuredFilterCount    =
              filters.methodFilters.length + filters.statusFilters.length + filters.pathFilters.length

    const { filteredParsedLines, filteredLines, removedCount } = useMemo(() => {
        const filteredParsed = parsedSearchLines.filter((line) => {
            if (filters.methodFilterSet.size > 0 && (!line.method || !filters.methodFilterSet.has(line.method))) {
                return false
            }

            const statusGroup = resolveStatusGroup(line.statusCode)
            if (filters.statusFilterSet.size > 0 && (!statusGroup || !filters.statusFilterSet.has(statusGroup))) {
                return false
            }

            return !(filters.pathFilterSet.size > 0 && (!line.path || !filters.pathFilterSet.has(line.path)))
        })

        return {
            filteredParsedLines: filteredParsed,
            filteredLines: filteredParsed.map((line) => line.raw).reverse(),
            removedCount: Math.max(logState.buffer.length - filteredParsed.length, 0),
        }
    }, [
                                                                             logState.buffer.length,
                                                                             filters.methodFilterSet,
                                                                             filters.pathFilterSet,
                                                                             filters.statusFilterSet,
                                                                             parsedSearchLines,
                                                                         ])

    // 日志逆序（新→旧），分页切片
    const reversedParsedLines = useMemo(() => [...filteredParsedLines].reverse(), [filteredParsedLines])
    const totalFilteredLines  = reversedParsedLines.length

    // 过滤/搜索条件变化时重置到第 1 页
    useEffect(() => {
        queueMicrotask(() => {
            setLogPage(1)
        })
    }, [
                  isSearching,
                  trimmedSearchQuery,
                  filters.methodFilters,
                  filters.statusFilters,
                  filters.pathFilters,
                  hideManagementLogs,
              ])

    const pageStart      = (logPage - 1) * logPageSize
    const pageEnd        = pageStart + logPageSize
    const pagedParsed    = useMemo(
        () => (showRawLogs ? [] : reversedParsedLines.slice(pageStart, pageEnd)),
        [showRawLogs, reversedParsedLines, pageStart, pageEnd],
    )
    const rawVisibleText = useMemo(
        () => filteredLines.slice(pageStart, pageEnd).join('\n'),
        [filteredLines, pageStart, pageEnd],
    )

    useEffect(() => {
        logViewportRef.current = {
            page: logPage,
            pageStart,
            scrollTop: logScrollerRef.current?.scrollTop ?? logViewportRef.current.scrollTop,
            anchorRaw: pagedParsed[0]?.raw ?? '',
        }
    }, [logPage, pageStart, pagedParsed])

    useEffect(() => {
        const pending = pendingViewportRestoreRef.current
        if (!pending) {
            return
        }
        const anchorIndex = reversedParsedLines.findIndex((line) => line.raw === pending.anchorRaw)
        if (anchorIndex < 0) {
            pendingViewportRestoreRef.current = null
            return
        }
        const targetPage                  = Math.floor(anchorIndex / logPageSize) + 1
        pendingViewportRestoreRef.current = { ...pending, targetPage }
        if (logPage !== targetPage) {
            setLogPage(targetPage)
            return
        }
        window.requestAnimationFrame(() => {
            logScrollerRef.current?.scrollTo({ top: pending.scrollTop })
            pendingViewportRestoreRef.current = null
        })
    }, [logPage, logPageSize, reversedParsedLines])

    const logSheetStatus: DataStatusValue = loading ? 'loading' : totalFilteredLines > 0 ? 'ready' : 'empty'
    const logSheetEmptyText               = logState.buffer.length > 0 ?
                                            t('logs.search_empty_title') :
                                            t('logs.empty_title')
    const logSheetEmptyHint               = logState.buffer.length > 0 ?
                                            t('logs.search_empty_desc') :
                                            t('logs.empty_desc')
    const logColumns                      = useMemo<SheetColumn<ParsedLogLine>[]>(() => [
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
    ], [t])

    const renderLogRow = (line: ParsedLogLine) => {
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
        const emptyCell       = <span className={styles.emptyCell}>—</span>

        return (
            <tr
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
                    {line.path ? (
                        <span className={styles.path} title={line.path}>
                            {line.path}
                        </span>
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
                            onClick={(event) => {
                                event.stopPropagation()
                                cancelLongPress()
                                trace.openTraceModal(line)
                            }}
                            title={t('logs.trace_button')}
                        >
                            {t('logs.trace_short', { defaultValue: '追踪' })}
                        </button>
                    ) : emptyCell}
                </td>
            </tr>
        )
    }

    const copyLogLine = async (raw: string) => {
        const ok = await copyToClipboard(raw)
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
        if (requestLogDownloading) {
            return
        }
        setRequestLogId(null)
    }

    const downloadRequestLog = async (id: string) => {
        setRequestLogDownloading(true)
        try {
            const response = await logsApi.downloadRequestLogById(id)
            downloadBlob({
                             filename: `request-${id}.log`,
                             blob: new Blob([response.data], { type: 'text/plain' }),
                         })
            showNotification(t('logs.request_log_download_success'), 'success')
            setRequestLogId(null)
        } catch (err: unknown) {
            const message = getErrorMessage(err)
            showNotification(`${t('notification.download_failed')}${message ? `: ${message}` : ''}`, 'error')
        } finally {
            setRequestLogDownloading(false)
        }
    }

    const toggleRequestLog = async (enabled: boolean) => {
        if (requestLogUpdating) {
            return
        }
        setRequestLogUpdating(true)
        try {
            await configApi.updateRequestLog(enabled)
            useConfigStore.getState().updateConfigValue('request-log', enabled)
            showNotification(t('notification.request_log_updated'), 'success')
            if (!enabled) {
                setRequestLogId(null)
            }
        } catch (err: unknown) {
            const message = getErrorMessage(err)
            showNotification(`${t('notification.update_failed')}${message ? `: ${message}` : ''}`, 'error')
        } finally {
            setRequestLogUpdating(false)
        }
    }

    useEffect(() => {
        return () => {
            if (longPressRef.current?.timer) {
                window.clearTimeout(longPressRef.current.timer)
                longPressRef.current.timer = null
            }
        }
    }, [])

    useEffect(() => {
        if (!logPanelFullscreen) {
            return
        }

        const previousOverflow = document.body.style.overflow
        const handleKeyDown    = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setLogPanelFullscreen(false)
            }
        }

        document.body.style.overflow = 'hidden'
        window.addEventListener('keydown', handleKeyDown)
        return () => {
            document.body.style.overflow = previousOverflow
            window.removeEventListener('keydown', handleKeyDown)
        }
    }, [logPanelFullscreen])

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
                onChange={setActiveTab}
                ariaLabel={t('logs.title')}
            />

            <div className={styles.content}>
                {activeTab === 'logs' && (
                    <Card className={styles.logCard}>
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
                                                     const active = filters.pathFilters.includes(path)
                                                     return (
                                                         <button
                                                             key={path}
                                                             type='button'
                                                             className={`${styles.filterChip} ${
                                                                 active ? styles.filterChipActive : ''
                                                             }`}
                                                             onClick={() => filters.togglePathFilter(path)}
                                                             aria-pressed={active}
                                                             title={path}
                                                         >
                                                             {path} ({count})
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
                                checked={showRawLogs}
                                onChange={setShowRawLogs}
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
                                        disabled={disableControls || loading}
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
                                        disabled={disableControls}
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
                                </div>
                            </div>
                        </div>

                        <>
                            <div
                                ref={logScrollerRef}
                                className={`${styles.logPanel} ${logPanelFullscreen ? styles.logPanelFullscreen : ''}`}
                                onScroll={(event) => {
                                    logViewportRef.current.scrollTop = event.currentTarget.scrollTop
                                }}
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
                                            <span className={styles.loadMoreCount}>
                                                {t('logs.total_lines', { count: totalLogLines })}
                                            </span>
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
                                        {rawVisibleText}
                                    </pre>
                                ) : (
                                     <Sheet
                                         rows={showRawLogs ? [] : pagedParsed}
                                         columns={logColumns}
                                         rowKey={(line, index) => `${pageStart + index}-${line.raw}`}
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
                                        setLogPage(p)
                                        logScrollerRef.current?.scrollTo({ top: 0 })
                                    }}
                                    onPageSizeChange={(size) => {
                                        setLogPageSize(size)
                                        setLogPage(1)
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
                                                            onClick={() => previewErrorLog(item.name)}
                                                            disabled={disableControls}
                                                        >
                                                            {t('logs.error_logs_preview')}
                                                        </Button>
                                                        <Button
                                                            variant='secondary'
                                                            size='sm'
                                                            onClick={() => downloadErrorLog(item.name)}
                                                            disabled={disableControls}
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
                footer={
                    <>
                        {trace.traceLogLine?.requestId && (
                            <Button
                                variant='secondary'
                                onClick={() => {
                                    if (trace.traceLogLine?.requestId) {
                                        void downloadRequestLog(trace.traceLogLine.requestId)
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
                                <span className={styles.traceInfoValue}>{trace.traceLogLine.message ||
                                                                         notRecordedLabel}</span>
                            </div>
                        </div>

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
                open={previewName !== null}
                onClose={() => setPreviewName(null)}
                title={previewName ?? ''}
                width={720}
                footer={
                    <Button
                        variant='secondary'
                        onClick={() => {
                            if (previewName) {
                                void downloadErrorLog(previewName)
                            }
                        }}
                    >
                        {t('logs.error_logs_download')}
                    </Button>
                }
            >
                {previewLoading ? (
                    <div className='hint'>{t('common.loading')}</div>
                ) : (
                     <pre className={styles.previewContent}>{previewContent}</pre>
                 )}
            </Modal>
        </div>
    )
}
