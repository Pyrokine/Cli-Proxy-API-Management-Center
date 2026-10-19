import {describe, expect, mock, spyOn, test} from 'bun:test'
import {logsApi} from '@/services/api/logs'
import {apiClient} from '@/services/api/client'
import {appendLogBuffer, emptyLogBuffer, replaceLogBuffer, shouldCatchUpLogPage} from '@/pages/hooks/logBuffer'
import {createLogParserCache} from '@/pages/hooks/logParsing'
import {createLogRequestQueue} from '@/pages/hooks/logRequests'
import {sourceCallback, sourceInitializer} from './sourceCallbacks'

const file = 'pages/LogsPage.tsx'
const MAX_BUFFER_LINES = sourceInitializer<number>(file, 'MAX_BUFFER_LINES', {})

type PendingViewport = {anchorId: number; scrollTop: number; anchorOffset?: number; targetPage?: number} | null

function fixture(showRawLogs: boolean, count: number, page: number, scrollTop = 120) {
    let logState = appendLogBuffer(emptyLogBuffer(), Array.from({length: count}, (_, i) => `fixture ${i}`), MAX_BUFFER_LINES)
    let logPage = page
    const logPageSize = 50
    const parse = createLogParserCache()
    const reversedParsedLines = [...parse(logState)].reverse()
    const pageStart = (logPage - 1) * logPageSize
    const pagedParsed = sourceInitializer(file, 'pagedParsed', {
        showRawLogs, reversedParsedLines, pageStart, pageEnd: pageStart + logPageSize,
        useMemo: (fn: () => unknown) => fn(),
    })
    const scrollTo = mock()
    const logScrollerRef = {current: {
        scrollTop, scrollTo, clientTop: 0, getBoundingClientRect: () => ({top: 100}),
        querySelector: (_selector: string): {getBoundingClientRect: () => {top: number}} | null => null,
        querySelectorAll: () => [] as Array<{dataset: {logId: string}; getBoundingClientRect: () => {top: number; bottom: number}}>,
    }}
    const logViewportRef = {current: {page: 1, pageStart: 0, scrollTop: 0, anchorId: null as number | null, anchorOffset: null as number | null}}
    const pendingViewportRestoreRef: {current: PendingViewport} = {current: null}
    const setLogPage = (value: number) => { logPage = value }
    const setHistoryEvicted = mock()
    const capture = () => sourceCallback<() => void>(file, 'captureLogViewport', {
        logPage, pageStart, pagedParsed, reversedParsedLines, showRawLogs, logScrollerRef, logViewportRef,
    })()
    capture()
    const preserveLogViewport = sourceInitializer<() => void>(file, 'preserveLogViewport', {
        logViewportRef, pendingViewportRestoreRef,
    })
    const frames: FrameRequestCallback[] = []
    const restore = () => sourceCallback<() => void>(file, 'useEffect', {
        pendingViewportRestoreRef, reversedParsedLines: [...parse(logState)].reverse(),
        logState, logPage, logPageSize, logScrollerRef, setLogPage, setHistoryEvicted,
        window: {requestAnimationFrame: (fn: FrameRequestCallback) => frames.push(fn)},
    }, 'const anchorIndex =')()
    const loadLogs = sourceInitializer<(incremental: boolean) => Promise<void>>(file, 'loadLogs', {
        useAuthStore: {getState: () => ({connectionStatus: 'connected'})}, apiClient, logsApi,
        isCurrentConnection: () => true, authGeneration: apiClient.getAuthGeneration(),
        requests: {logs: createLogRequestQueue()}, MAX_LOG_PAGES_PER_READ: 3, MAX_BUFFER_LINES,
        logPositionRef: {current: {cursor: 'fixture-cursor'}}, requestLogHomeIpByIdRef: {current: {}},
        pendingViewportRestoreRef, logViewportRef, preserveLogViewport, appendLogBuffer, replaceLogBuffer, shouldCatchUpLogPage,
        setLogState: (fn: (previous: typeof logState) => typeof logState) => { logState = fn(logState) },
        setLoading: mock(), setLogDiskSize: mock(), setTotalLogLines: mock(), setHistoryEvicted, setLogPage,
        setCatchingUp: mock(), setLastUpdated: mock(), setError: mock(), retryDelayRef: {current: 8000},
        nextReadAtRef: {current: 0}, refreshInterval: 60000, INITIAL_RETRY_MS: 8000, MAX_RETRY_MS: 60000,
        FAST_CATCH_UP_MS: 1000,
    })
    return {logViewportRef, pendingViewportRestoreRef, loadLogs, restore, frames, scrollTo, logScrollerRef,
            setHistoryEvicted, capture, preserveLogViewport, getPage: () => logPage, getState: () => logState, setLogPage}
}

describe('log reading viewport', () => {
    for (const raw of [true, false]) {
        test(`${raw ? 'raw' : 'structured'} historical pages retain their record anchor on incremental reads`, async () => {
            const view = fixture(raw, 120, 2)
            expect(view.logViewportRef.current.anchorId).toBe(69)
            const fetch = spyOn(logsApi, 'fetchLogs').mockResolvedValue({
                lines: Array.from({length: 60}, (_, i) => `new ${i}`), lineCount: 60,
                logBackendKind: 'file', nextCursor: 'fixture-next',
            })
            try {
                await view.loadLogs(true)
                expect(view.pendingViewportRestoreRef.current).toEqual({anchorId: 69, scrollTop: 120})
                view.restore()
                expect(view.getPage()).toBe(3)
                view.restore()
                expect(view.frames).toHaveLength(1)
                view.frames[0]!(0)
                expect(view.scrollTo).toHaveBeenCalledWith({top: 120})
                expect(view.pendingViewportRestoreRef.current).toBeNull()
            } finally {
                fetch.mockRestore()
            }
        })

        test(`${raw ? 'raw' : 'structured'} evicted reading anchors return to the first page with a notice`, async () => {
            const view = fixture(raw, MAX_BUFFER_LINES, MAX_BUFFER_LINES / 50)
            expect(view.logViewportRef.current.anchorId).toBe(49)
            const fetch = spyOn(logsApi, 'fetchLogs').mockResolvedValue({
                lines: Array.from({length: 200}, (_, i) => `new ${i}`), lineCount: 200,
                logBackendKind: 'file', nextCursor: 'fixture-next',
            })
            try {
                await view.loadLogs(true)
                expect(view.getState().bufferStart).toBe(200)
                view.restore()
                expect(view.getPage()).toBe(1)
                expect(view.setHistoryEvicted).toHaveBeenCalledWith(true)
                expect(view.pendingViewportRestoreRef.current).toBeNull()
                expect(view.frames).toHaveLength(0)
            } finally {
                fetch.mockRestore()
            }
        })
    }

    for (const raw of [true, false]) {
        test(`${raw ? 'raw' : 'structured'} restoration uses record geometry, not only the former scrollTop`, () => {
            const view = fixture(raw, 120, 2, 120)
            view.pendingViewportRestoreRef.current = {anchorId: 69, scrollTop: 120, anchorOffset: -5}
            view.logScrollerRef.current.querySelector = () => ({getBoundingClientRect: () => ({top: 50})})
            view.restore()
            view.frames[0]!(0)
            expect(view.scrollTo).toHaveBeenCalledWith({top: 75})
        })
    }

    for (const raw of [true, false]) {
        test(`${raw ? 'raw' : 'structured'} captures the first visible record and its container-relative offset`, () => {
            const view = fixture(raw, 120, 2, 150)
            view.logScrollerRef.current.clientTop = 2
            view.logScrollerRef.current.querySelectorAll = () => [
                {dataset: {logId: ''}, getBoundingClientRect: () => ({top: 95, bottom: 115})},
                {dataset: {logId: 'invalid'}, getBoundingClientRect: () => ({top: 95, bottom: 115})},
                {dataset: {logId: '69'}, getBoundingClientRect: () => ({top: 80, bottom: 100})},
                {dataset: {logId: '64'}, getBoundingClientRect: () => ({top: 97, bottom: 117})},
            ]
            view.capture()
            expect(view.logViewportRef.current).toMatchObject({anchorId: 64, anchorOffset: -5, scrollTop: 150})
            view.preserveLogViewport()
            expect(view.pendingViewportRestoreRef.current).toEqual({anchorId: 64, anchorOffset: -5, scrollTop: 150})
        })

        test(`${raw ? 'raw' : 'structured'} uses the same paged record IDs in both formats`, () => {
            const view = fixture(raw, 120, 2)
            const reversedParsedLines = [...createLogParserCache()(view.getState())].reverse()
            const result = sourceInitializer<Array<{id: number}>>(file, 'pagedParsed', {
                reversedParsedLines, pageStart: 50, pageEnd: 100, showRawLogs: raw,
                useMemo: (fn: () => unknown) => fn(),
            })
            expect(result.map((entry) => entry.id)).toEqual(Array.from({length: 50}, (_, index) => 69 - index))
        })
    }

    test('newest-page polling does not restore historical scroll positions', async () => {
        const view = fixture(true, 120, 1, 0)
        const fetch = spyOn(logsApi, 'fetchLogs').mockResolvedValue({lines: ['new'], lineCount: 1, logBackendKind: 'file', nextCursor: 'fixture-next'})
        try {
            await view.loadLogs(true)
            expect(view.pendingViewportRestoreRef.current).toBeNull()
            view.restore()
            expect(view.getPage()).toBe(1)
            expect(view.frames).toHaveLength(0)
        } finally {
            fetch.mockRestore()
        }
    })

    test('an obsolete animation frame cannot discard a newer restore request', () => {
        const view = fixture(true, 120, 2)
        view.pendingViewportRestoreRef.current = {anchorId: 69, scrollTop: 120}
        view.restore()
        const next = {anchorId: 68, scrollTop: 160}
        view.pendingViewportRestoreRef.current = next
        view.frames[0]!(0)
        expect(view.pendingViewportRestoreRef.current).toBe(next)
        expect(view.scrollTo).not.toHaveBeenCalled()
    })

    test('filter changes discard pending restoration and reset the reading page', async () => {
        const view = fixture(true, 120, 2)
        view.pendingViewportRestoreRef.current = {anchorId: 69, scrollTop: 120}
        view.restore()
        sourceCallback<() => void>(file, 'useEffect', {
            pendingViewportRestoreRef: view.pendingViewportRestoreRef,
            logScrollerRef: view.logScrollerRef, setLogPage: view.setLogPage,
        }, 'queueMicrotask(() => {\n            setLogPage(1)')()
        await Promise.resolve()
        expect(view.getPage()).toBe(1)
        expect(view.pendingViewportRestoreRef.current).toBeNull()
        view.frames[0]!(0)
        expect(view.scrollTo).toHaveBeenCalledTimes(1)
        expect(view.scrollTo).toHaveBeenCalledWith({top: 0})
    })
})
