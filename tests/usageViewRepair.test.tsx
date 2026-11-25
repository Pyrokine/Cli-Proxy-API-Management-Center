import {errorLogViewerReducer, type ErrorLogViewerState} from '@/pages/hooks/errorLogViewer'
import {createLogRequestGuard, createLogRequestQueue} from '@/pages/hooks/logRequests'
import {apiClient} from '@/services/api/client'
import {logsApi, PendingRequestLogError} from '@/services/api/logs'
import {type EventsResponse, type SummaryTimePoint, usageApi} from '@/services/api/usage'
import {formatFileSize, parseLogTimestamp, toLocalDateTimeSecondsString} from '@/utils/format'
import {redactSensitiveText} from '@/utils/redaction'
import {extractLatencyMs, formatDurationMs} from '@/utils/usage'
import {AxiosHeaders} from 'axios'
import {expect, mock, spyOn, test} from 'bun:test'
import React, {type ReactElement, type ReactNode} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import ts from 'typescript'
import {sourceCallback, sourceExpression, sourceInitializer} from './sourceCallbacks'

const usagePage     = 'pages/UsagePage.tsx'
const healthCard    = 'components/usage/ServiceHealthCard.tsx'
const eventsCard    = 'components/usage/RequestEventsDetailsCard.tsx'
const logsPage      = 'pages/LogsPage.tsx'
const traceResolver = 'pages/hooks/useTraceResolver.ts'
const day           = 24 * 3600_000
const styles        = new Proxy<Record<string, string>>({}, { get: (_, key) => String(key) })
const t             = (key: string, options: Record<string, unknown> = {}) =>
    String(options.defaultValue ?? key).replace(/{{(\w+)}}/g, (_, name: string) => String(options[name]))
const noop          = () => {
}
const immediately   = <T, >(read: () => T) => read()
const settle        = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
const textOf        = (tree: ReactNode) => renderToStaticMarkup(<>{tree}</>)

function elements(tree: ReactNode): ReactElement<Record<string, unknown>>[] {
    return Array.isArray(tree) ? tree.flatMap(elements) : React.isValidElement<Record<string, unknown>>(tree)
                                                          ? [tree, ...elements(tree.props.children as ReactNode)] : []
}

function logResponse(status: number, text: string, contentType: string, attachment = false) {
    return {
        data: new Blob([text], { type: contentType }), status, statusText: String(status),
        headers: new AxiosHeaders({
                                      'content-type': contentType,
                                      ...(attachment ?
                                          { 'content-disposition': 'attachment; filename="fixture.log"' } :
                                          {}),
                                  }),
        config: { headers: new AxiosHeaders() },
    }
}

const logPending  = {
    error: 'request log is still being published', request_log_state: 'pending',
    request_log_home_ip: '192.0.2.8',
}
const blankEvents = { events: [], total: 0, page: 1, page_size: 50, total_pages: 0 }

function event(requestId: string, model = 'fixture-model', latency?: number) {
    return {
        request_id: requestId, model, timestamp: '2026-11-23T20:00:00.137612891Z', source: '', auth_index: '',
        api_key: '', latency_ms: latency, failed: false,
        tokens: { input_tokens: 1, output_tokens: 0, cached_tokens: 0, reasoning_tokens: 0, total_tokens: 1 },
    }
}

test('F02: service-health data uses the server’s UTC bucket boundaries, including the inclusive end', () => {
    const summary                           = {
        period: { from: '2026-10-15T15:14:00Z', to: '2026-10-19T00:00:00Z', granularity: 'daily' },
        time_series: [
            { time: '2026-10-15T00:00:00Z', requests: 3, success: 2, failure: 1 },
            { time: '2026-10-19T00:00:00Z', requests: 1, success: 1, failure: 0 },
        ] as SummaryTimePoint[],
    }
    const calculateServiceHealthFromSummary = sourceCallback(healthCard, 'calculateServiceHealthFromSummary', {})
    const bucketGranularity                 = sourceInitializer(
        healthCard,
        'bucketGranularity',
        { summary, granularity: 'hourly' },
    )
    const health                            = sourceCallback<() => {
        totalSuccess: number; totalFailure: number;
        blockDetails: Array<{ startTime: number; endTime: number; success: number }>
    }>(healthCard, 'healthData', {
        summary, fromMs: 0, toMs: 0, bucketGranularity, calculateServiceHealthFromSummary,
    })()
    expect(health.totalSuccess).toBe(3)
    expect(health.totalFailure).toBe(1)
    expect(health.blockDetails.map(({ startTime, endTime }) => endTime - startTime)).toEqual(Array(5).fill(day))
    expect(health.blockDetails[0].startTime).toBe(Date.parse(summary.time_series[0].time))
    expect(health.blockDetails[health.blockDetails.length - 1]?.success).toBe(1)
    const params = sourceCallback<() => { granularity: string }>(usagePage, 'heatmapSummaryParams', {
        effectiveDateFrom: '2026-06-01T00:00:00Z', effectiveDateTo: '2026-10-19T00:00:00Z',
        selectedModels: [], selectedApiKeys: [], selectedCredentials: [],
    })()
    expect(params.granularity).toBe('daily')
})

test(
    'F03: empty history resolves without an effective data range; a real event retains its exact instant',
    async () => {
        const first = event('first')
        const get   = spyOn(apiClient, 'get').mockResolvedValueOnce(blankEvents)
                                             .mockResolvedValueOnce({ ...blankEvents, events: [first], total: 1 })
                                             .mockRejectedValueOnce(new Error('synthetic read failure'))
        const key   = 'lookup-key'
        type Resolution = { key: string; from?: string; error?: string }
        let resolvedAll: Resolution | null = null
        const view                         = sourceCallback<() => () => void>(usagePage, 'useEffect', {
            ALL_PRESET_PLACEHOLDER_FROM: sourceInitializer(usagePage, 'ALL_PRESET_PLACEHOLDER_FROM', {}),
            usageApi, t, isAllPreset: true, usageStatsTabActive: true, allSummaryResolutionKey: key,
            effectiveDateTo: '2026-11-23T21:00:00Z', selectedModels: [], selectedCredentials: [], selectedApiKeys: [],
            setAllSummaryResolution: (next: typeof resolvedAll) => {
                resolvedAll = next
            },
        }, '.getEvents(')
        const value                        = (name: string) => sourceInitializer(usagePage, name, {
            isAllPreset: true, resolvedAll, rangeResolutionError: resolvedAll?.error,
        })
        try {
            const unmount = view()
            await settle()
            expect(get).toHaveBeenCalledTimes(1)
            expect(value('rangeEmpty')).toBe(true)
            expect(value('effectiveRangeReady')).toBe(false)
            unmount()
            view()
            await settle()
            expect(value('effectiveRangeReady')).toBe(true)
            expect(value('effectiveDateFrom')).toBe(first.timestamp)
            view()
            await settle()
            expect<Resolution | null>(resolvedAll).toEqual({ key, error: 'synthetic read failure' })
            expect(value('rangeEmpty')).toBe(false)
        } finally {
            get.mockRestore()
        }
    },
)

test('F06: pending and non-file responses are not downloads; an attachment remains a valid text log', async () => {
    const pending    = logResponse(202, JSON.stringify(logPending), 'application/json')
    const incorrect  = logResponse(200, '{"error":"Log unavailable"}', 'application/json')
    const attachment = logResponse(200, '{"error":"literal text in a saved log"}', 'application/json', true)
    const raw        = spyOn(apiClient, 'getRaw').mockResolvedValueOnce(pending).mockResolvedValueOnce(incorrect)
                                                 .mockResolvedValueOnce(attachment)
    const signal     = new AbortController().signal
    try {
        await expect(logsApi.downloadRequestLogById('fixture', '192.0.2.8', { signal })).rejects.toMatchObject({
                                                                                                                   name: 'PendingRequestLogError',
                                                                                                                   preview: {
                                                                                                                       requestLogState: 'pending',
                                                                                                                       requestLogHomeIp: '192.0.2.8',
                                                                                                                   },
                                                                                                               })
        await expect(logsApi.downloadRequestLogById('fixture')).rejects.toThrow('Log unavailable')
        await expect(logsApi.downloadRequestLogById('fixture')).resolves.toBe(attachment)
        expect(raw.mock.calls[0]?.[1]).toMatchObject({ signal, params: { home_ip: '192.0.2.8' } })
    } finally {
        raw.mockRestore()
    }
})

test('F06: event preview and both download consumers handle a pending artifact and can retry', async () => {
    type Preview = { id: string; state?: string; message?: string; content: string; homeIp: string }
    let preview: Preview | null  = null
    const setRequestLogPreview   = (next: Preview | ((prev: Preview | null) => Preview)) => {
        preview = typeof next === 'function' ? next(preview) : next
    }
    const get                    = spyOn(apiClient, 'get').mockResolvedValueOnce(logPending)
                                                          .mockResolvedValueOnce({
                                                                                     content: 'published content',
                                                                                     truncated: false,
                                                                                     total_lines: 1,
                                                                                 })
    const raw                    = spyOn(apiClient, 'getRaw').mockResolvedValue(logResponse(
        202,
        JSON.stringify(logPending),
        'application/json',
    ))
    const downloadBlob           = mock()
    const showNotification       = mock()
    const eventScope             = {
        logsApi, apiClient, PendingRequestLogError, redactSensitiveText, downloadBlob, t,
        setRequestLogPreview, setRequestLogError: noop, setRequestLogPreviewing: noop, setRequestLogDownloading: noop,
        requestLogPreviewSeqRef: { current: 0 }, activeRequestLogPreviewRef: { current: null },
    }
    const previewEventLog        = sourceCallback<(id: string, homeIp: string) => Promise<void>>(
        eventsCard, 'previewRequestLog', eventScope,
    )
    const downloadEventLog       = sourceCallback<(id: string, homeIp: string) => Promise<void>>(
        eventsCard, 'downloadRequestLog', eventScope,
    )
    const downloadLogPageRequest = sourceInitializer<(id: string, homeIp: string) => Promise<void>>(
        logsPage, 'downloadRequestLog', {
            ...eventScope, isCurrentConnection: () => true, authGeneration: apiClient.getAuthGeneration(),
            requests: { requestDownload: createLogRequestGuard() }, showNotification, setRequestLogId: noop,
        },
    )
    try {
        await previewEventLog('fixture', '')
        expect(preview).toMatchObject({ state: 'pending', message: logPending.error, homeIp: '192.0.2.8' })
        await downloadEventLog('fixture', '192.0.2.8')
        await downloadLogPageRequest('fixture', '192.0.2.8')
        expect(downloadBlob).not.toHaveBeenCalled()
        expect(showNotification.mock.calls[0]?.[1]).toBe('warning')
        await previewEventLog('fixture', '192.0.2.8')
        expect(preview).toMatchObject({ state: '', content: 'published content' })
        expect(get.mock.calls[1]?.[1]).toMatchObject({ params: { lines: 300, home_ip: '192.0.2.8' } })
    } finally {
        raw.mockRestore()
        get.mockRestore()
    }
})

test('F07: tries the request ID before reading a crowded time window and distinguishes a legacy lookup', async () => {
    const exact    = event('exact', 'different-model')
    const nearby   = event('nearby')
    const response = (events: EventsResponse['events'], filter?: string) => ({
        ...blankEvents, events, total: filter ? events.length : 501, request_id_filter: filter,
    })
    const get      = spyOn(apiClient, 'get')
        .mockResolvedValueOnce(response([exact], 'exact'))
        .mockResolvedValueOnce(response([nearby]))
        .mockResolvedValueOnce(response([nearby]))
    const lookup   = sourceCallback<(stamp: number, id: string, isCurrent: () => boolean) =>
        Promise<{ events: EventsResponse['events']; exactLookupUnavailable: boolean }>>(
        traceResolver, 'lookupTraceEvents', {
            usageApi, TRACE_LOOKUP_WINDOW_MS: 120_000, TRACE_MAX_CANDIDATES: 5, TRACE_EVENT_PAGE_SIZE: 500,
        },
    )
    const stamp    = Date.parse(exact.timestamp)
    try {
        await expect(lookup(stamp, 'exact', () => true)).resolves.toEqual({
                                                                              events: [exact],
                                                                              exactLookupUnavailable: false,
                                                                          })
        expect(get).toHaveBeenCalledTimes(1)
        expect(String(get.mock.calls[0]?.[0])).toContain('request_id=exact')
        await expect(lookup(stamp, 'unknown', () => true)).resolves.toEqual({
                                                                                events: [nearby],
                                                                                exactLookupUnavailable: true,
                                                                            })
        const query = new URL(String(get.mock.calls[2]?.[0]), 'https://fixture.invalid').searchParams
        expect(query.get('request_id')).toBeNull()
        expect(query.get('page_size')).toBe('500')
        expect(query.get('from')).toBe(new Date(stamp - 120_000).toISOString())
        expect(query.get('to')).toBe(new Date(stamp + 120_000).toISOString())
        const candidates = sourceCallback<() => Array<{ detail: { request_id: string }; requestIdMatched: boolean }>>(
            traceResolver, 'traceCandidates', {
                parseLogTimestamp, TRACE_MAX_CANDIDATES: 5, extractModelFromMessage: () => nearby.model,
                traceLogLine: { requestId: 'exact', timestamp: exact.timestamp },
                traceUsageDetails: [nearby, exact].map((row) => ({
                    request_id: row.request_id, __modelName: row.model, __timestampMs: stamp,
                })),
            },
        )()
        expect(candidates).toHaveLength(1)
        expect(candidates[0]).toMatchObject({ requestIdMatched: true, detail: { request_id: 'exact' } })
    } finally {
        get.mockRestore()
    }
})

test('F08: clear filters resets model, credential, client key, result, speed and debounced search immediately', () => {
    const setters        = {
        setSelectedModels: mock(), setSelectedCredentials: mock(), setSelectedApiKeys: mock(),
        setSelectedEventStatus: mock(), setSelectedEventSpeed: mock(),
    }
    const onClearFilters = sourceCallback(usagePage, 'clearUsageFilters', setters)
    const setSearchInput = mock()
    const clear          = sourceInitializer<() => void>(
        eventsCard,
        'handleClearFilters',
        { onClearFilters, setSearchInput },
    )
    clear()
    expect(setters.setSelectedModels).toHaveBeenCalledWith([])
    expect(setters.setSelectedCredentials).toHaveBeenCalledWith([])
    expect(setters.setSelectedApiKeys).toHaveBeenCalledWith([])
    expect(setters.setSelectedEventStatus).toHaveBeenCalledWith('')
    expect(setters.setSelectedEventSpeed).toHaveBeenCalledWith('')
    expect(setSearchInput).toHaveBeenCalledWith('')
    expect(sourceInitializer(eventsCard, 'searchQuery', { searchInput: '', debouncedSearch: 'old' })).toBe('')
})

test('F09 and F13: same-minute refresh advances milliseconds and the backup uses the visible rolling bounds', () => {
    const dateTo                 = '2026-11-23T20:00:10.337Z'
    let dateRange                = { from: '', to: '2026-11-23T20:00:00.000Z', preset: '24h' }
    const setSummaryRefreshToken = mock()
    const now                    = spyOn(Date, 'now').mockReturnValue(Date.parse(dateTo))
    try {
        sourceCallback<() => void>(usagePage, 'handleRefresh', {
            setDateRange: (change: (range: typeof dateRange) => typeof dateRange) => {
                dateRange = change(dateRange)
            },
            setSummaryRefreshToken, activeTab: 'overview', setLiveWindowAnchorMs: noop, needsRawUsage: false,
        })()
        expect(dateRange).toEqual({ from: '2026-11-22T20:00:10.337Z', to: dateTo, preset: '24h' })
        expect(setSummaryRefreshToken).toHaveBeenCalledTimes(1)
    } finally {
        now.mockRestore()
    }
    const rolling          = { from: '2026-11-22T20:00:14.179Z', to: '2026-11-23T20:00:14.179Z' }
    const visibleDateRange = sourceInitializer(usagePage, 'visibleDateRange', {
        activeTab: 'events', eventsDateRange: dateRange, eventsVisibleDateRange: { base: dateRange, range: rolling },
    })
    const handleExport     = mock()
    const select           = sourceExpression<() => void>(usagePage, (node, tree) =>
        ts.isArrowFunction(node) && ts.isJsxExpression(node.parent) && ts.isJsxAttribute(node.parent.parent) &&
        node.parent.parent.name.getText(tree) === 'onExport', {
                                                              visibleDateRange,
                                                              handleExport,
                                                              selectedModels: ['model'],
                                                              selectedApiKeys: ['(none)'],
                                                              selectedCredentials: ['g'],
                                                              activeTab: 'events',
                                                              selectedEventSpeed: 'fast',
                                                          })
    select()
    expect(handleExport).toHaveBeenCalledWith({
                                                  ...rolling, model: 'model', api_key: ['(none)'], credential: 'g',
                                                  api_key_identity: 'canonical', speed: 'fast',
                                              })
    expect(sourceCallback<(value: string) => string>('components/ui/DateRangePicker.tsx', 'asDateTimeInputValue', {
        toLocalDateTimeSecondsString,
    })(rolling.to)).toBe(toLocalDateTimeSecondsString(new Date(rolling.to)))
})

test(
    'F09: an explicit refresh repeats a fixed summary request even when its date parameters are unchanged',
    async () => {
        const file                           = 'components/usage/hooks/useUsageSummary.ts'
        const params                         = {
            from: '2026-11-20T00:00:00Z',
            to: '2026-11-21T00:00:00Z',
            granularity: 'hourly',
        }
        const reload                         = sourceCallback(file, 'reload', {
            enabled: true, params, usageApi, inflightRef: { current: null },
            setLoading: noop, setError: noop, setSummary: noop,
        })
        let dependencies: readonly unknown[] = []
        const runEffect                      = (refreshToken: number) => sourceExpression(file, (node, tree) =>
            ts.isCallExpression(node) && node.expression.getText(tree) === 'useEffect' &&
            node.arguments[0]?.getText(tree).includes('void reload()'), {
                                                                                              enabled: true,
                                                                                              refreshToken,
                                                                                              reload,
                                                                                              useEffect: (
                                                                                                  effect: () => void,
                                                                                                  next: readonly unknown[],
                                                                                              ) => {
                                                                                                  if (next.some((
                                                                                                                    value,
                                                                                                                    index,
                                                                                                                ) => value !==
                                                                                                                     dependencies[index])) {
                                                                                                      dependencies =
                                                                                                          next
                                                                                                      effect()
                                                                                                  }
                                                                                              },
                                                                                          })
        const get                            = spyOn(apiClient, 'get').mockResolvedValue({})
        try {
            runEffect(0)
            await settle()
            runEffect(1)
            await settle()
            expect(get).toHaveBeenCalledTimes(2)
            const [first, refreshed] = get.mock.calls.map(([path]) => path)
            expect(String(first)).toContain('/usage/summary?')
            expect(refreshed).toBe(first)
        } finally {
            get.mockRestore()
        }
    },
)

test('F10: confirmation names the application log and leaves clearing to the existing explicit action', async () => {
    const clearLogs        = mock(async () => {
    })
    const showNotification = mock()
    const showConfirmation = mock<(data: { title: string; message: string; onConfirm: () => Promise<void> }) => void>()
    const authGeneration   = 3
    const action           = sourceInitializer<() => Promise<void>>(logsPage, 'clearLogs', {
        apiClient: { getAuthGeneration: () => authGeneration }, authGeneration, t, isCurrentConnection: () => true,
        requests: {
            session: createLogRequestGuard(),
            logs: createLogRequestQueue(),
            diskSize: createLogRequestGuard(),
        },
        useAuthStore: { getState: () => ({ connectionStatus: 'connected' }) }, showConfirmation, showNotification,
        logsApi: { clearLogs }, loadLogDiskSize: noop, setClearingLogs: noop, setLoading: noop, setError: noop,
        setLogState: noop, pendingViewportRestoreRef: {}, logPositionRef: {}, requestLogHomeIpByIdRef: {},
        nextReadAtRef: {}, retryDelayRef: {}, INITIAL_RETRY_MS: 8000, setCatchingUp: noop,
        setHistoryEvicted: noop, setLastUpdated: noop, setTotalLogLines: noop, setLogPage: noop,
    })
    await action()
    expect(clearLogs).not.toHaveBeenCalled()
    const dialog = showConfirmation.mock.calls[0]![0]
    expect(dialog.title).toContain('application logs')
    expect(dialog.message).toContain('rotated files')
    expect(dialog.message).toContain('will be kept')
    await dialog.onConfirm()
    expect(clearLogs).toHaveBeenCalledTimes(1)
    expect(showNotification).toHaveBeenCalledWith('Application logs cleared', 'success')
})

test('F11: error preview keeps backend line count, tail marker and redacted preview text', async () => {
    const get                      = spyOn(apiClient, 'get').mockResolvedValue({
                                                                                   content: 'tail contents',
                                                                                   truncated: true,
                                                                                   total_lines: 501,
                                                                               })
    let state: ErrorLogViewerState = { status: 'closed' }
    const preview                  = sourceInitializer<(item: { name: string }) => Promise<void>>(
        logsPage,
        'previewErrorLog',
        {
            logsApi,
            apiClient,
            authGeneration: apiClient.getAuthGeneration(),
            requests: { preview: createLogRequestGuard() },
            isCurrentConnection: () => true,
            t,
            redactSensitiveText,
            ERROR_LOG_PREVIEW_LINES: 500,
            dispatchErrorLogViewer: (action: Parameters<typeof errorLogViewerReducer>[1]) => {
                state =
                    errorLogViewerReducer(
                        state,
                        action,
                    )
            },
        },
    )
    try {
        await preview({ name: 'error-fixture.log' })
        expect(get.mock.calls[0]?.[1]).toMatchObject({ params: { lines: 500 } })
        expect(state).toMatchObject({ status: 'ready', metadata: { truncated: true, totalLines: 501 } })
        const view   = sourceExpression<ReactNode>(logsPage, (node, tree) => ts.isBinaryExpression(node) &&
                                                                             node.left.getText(tree) ===
                                                                             'errorLogViewer.status === \'ready\'' &&
                                                                             ts.isParenthesizedExpression(node.right), {
                                                       React,
                                                       styles,
                                                       ERROR_LOG_PREVIEW_LINES: 500,
                                                       errorLogViewer: state,
                                                       t: (key: string, props: Record<string, unknown>) => key.endsWith(
                                                           '_lines') ? `${props.count} lines` : t(key, props),
                                                   })
        const markup = textOf(view)
        expect(markup).toContain('501 lines')
        expect(markup).toContain('last 500 lines')
        expect(markup).toContain('tail contents')
    } finally {
        get.mockRestore()
    }
})

test('F15: the recorded latency observation displays 0 ms separately from a missing value', () => {
    const label = sourceExpression<string>(eventsCard, (node, tree) => ts.isCallExpression(node) &&
                                                                       node.expression.getText(tree) ===
                                                                       'formatDurationMs' &&
                                                                       node.arguments[0]?.getText(tree) ===
                                                                       'latencyMs', {
                                               formatDurationMs,
                                               latencyMs: extractLatencyMs(event('zero', 'm', 0)),
                                               lang: 'en',
                                               notRecordedLabel: 'Not recorded',
                                           })
    expect(label).toBe('0ms')
    expect(extractLatencyMs(event('unknown'))).toBeNull()
    expect(formatDurationMs(null, { invalidText: 'Not recorded' })).toBe('Not recorded')
})

test('F16: the real paginator keeps the total, offers only accessible pages, and resets on page-size change', () => {
    const onPageChange     = mock()
    const onPageSizeChange = mock()
    const Select           = () => null
    const render           = sourceCallback<(props: object) => ReactElement>(
        'components/ui/Pagination.tsx',
        'Pagination',
        {
            React,
            styles,
            Select,
            useTranslation: () => ({
                t: (
                    key: string,
                    args: { total?: number },
                ) =>
                    key === 'pagination.range' ?
                    `${args.total} total` :
                    key,
            }),
            useCallback: immediatelyLikeCallback,
            useMemo: immediately,
            DEFAULT_PAGE_SIZE_OPTIONS: [
                25,
                50,
                100,
            ],
            buildPageNumbers: sourceCallback(
                'components/ui/Pagination.tsx',
                'buildPageNumbers',
                {},
            ),
        },
    )
    const props            = { total: 120000, pageSize: 50, page: 2000, maxPage: 2001, onPageChange, onPageSizeChange }
    const view             = render(props)
    const last             = elements(view).find(({ props }) => props['aria-label'] === 'pagination.last')!
    ;(last.props.onClick as () => void)()
    expect(onPageChange).toHaveBeenLastCalledWith(2001)
    expect(textOf(view)).toContain('120000 total')
    expect(textOf(view)).not.toContain('2400')
    const selector = elements(view).find(({ type }) => type === Select)!
    ;(selector.props.onChange as (size: string) => void)('100')
    expect(onPageSizeChange).toHaveBeenLastCalledWith(100)
    expect(onPageChange).toHaveBeenLastCalledWith(1)
})

function immediatelyLikeCallback<T>(fn: T): T {
    return fn
}

test(
    'F17: a disk read failure leaves the previous amount, labels it stale, and clears the warning after recovery',
    async () => {
        const logsApi        = { fetchLogSize: mock(async () => ({ total_bytes: 100, file_count: 1 })) }
        const authGeneration = 3
        type DiskSize = { totalBytes: number; fileCount: number }
        let logDiskSize: DiskSize | null = null
        let logDiskSizeError             = ''
        const disk                       = sourceInitializer<() => Promise<void>>(logsPage, 'loadLogDiskSize', {
            logsApi, authGeneration, apiClient: { getAuthGeneration: () => authGeneration },
            requests: { diskSize: createLogRequestGuard() }, t, redactSensitiveText,
            getErrorMessage: (err: Error) => err.message,
            setLogDiskSize: (data: typeof logDiskSize) => {
                logDiskSize = data
            },
            setLogDiskSizeError: (error: string) => {
                logDiskSizeError = error
            },
        })
        const badge                      = () => sourceExpression<ReactNode>(
            logsPage,
            (
                node,
                tree,
            ) => ts.isBinaryExpression(node) &&
                 node.left.getText(tree) ===
                 '(logDiskSize !== null || logDiskSizeError)',
            {
                React,
                t,
                styles,
                logDiskSize,
                logDiskSizeError,
                formatFileSize,
            },
        )
        logsApi.fetchLogSize.mockRejectedValueOnce(new Error('first read failed'))
        await disk()
        expect(textOf(badge())).toContain('Disk usage unavailable')
        await disk()
        logsApi.fetchLogSize.mockRejectedValueOnce(new Error('refresh failed'))
        await disk()
        expect<DiskSize | null>(logDiskSize).toEqual({ totalBytes: 100, fileCount: 1 })
        expect(textOf(badge())).toContain('(last read; refresh failed)')
        logsApi.fetchLogSize.mockResolvedValueOnce({ total_bytes: 0, file_count: 0 })
        await disk()
        expect<DiskSize | null>(logDiskSize).toEqual({ totalBytes: 0, fileCount: 0 })
        expect(logDiskSizeError).toBe('')
    },
)
