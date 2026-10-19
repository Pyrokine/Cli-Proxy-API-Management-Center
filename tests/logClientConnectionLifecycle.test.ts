import {describe, expect, mock, spyOn, test} from 'bun:test'
import * as React from 'react'
import {apiClient} from '@/services/api/client'
import {logsApi} from '@/services/api/logs'
import {createLogRequestGuard, createLogRequestQueue} from '@/pages/hooks/logRequests'
import {sourceCallback, sourceInitializer} from './sourceCallbacks'

const file = 'pages/LogsPage.tsx'

function deferred<T>() {
    let resolve!: (value: T) => void
    let reject!: (error: Error) => void
    const promise = new Promise<T>((done, fail) => {
        resolve = done
        reject = fail
    })
    return {promise, resolve, reject}
}

function fixture() {
    let generation = 3
    const mountedRef = {current: true}
    const calls = {
        fetchLogs: mock(async () => ({lines: [], lineCount: 0, logBackendKind: 'file'})),
        fetchLogSize: mock(async () => ({total_bytes: 0, file_count: 0})),
        fetchErrorLogs: mock(async () => ({files: []})),
        downloadErrorLog: mock(async () => ({data: 'fixture'})),
        previewErrorLog: mock(async () => ({content: 'fixture'})),
        downloadRequestLogById: mock(async () => ({data: 'fixture'})),
        clearLogs: mock(async () => undefined),
        updateRequestLog: mock(async () => undefined),
        updateConfigValue: mock(),
        copyToClipboard: mock(async () => true),
        downloadBlob: mock(),
        showNotification: mock(),
        showConfirmation: mock(),
        setRequestLogUpdating: mock(),
        setRequestLogId: mock(),
        dispatchErrorLogViewer: mock(),
    }
    const requests = {
        session: createLogRequestGuard(), logs: createLogRequestQueue(), errors: createLogRequestGuard(),
        preview: createLogRequestGuard(), errorDownload: createLogRequestGuard(), requestDownload: createLogRequestGuard(),
    }
    const timers: Array<() => void> = []
    const scope: Record<string, unknown> = {
        ...calls, logsApi: calls, configApi: calls, requests, authGeneration: 3, mountedRef,
        apiClient: {getAuthGeneration: () => generation},
        isCurrentConnection: () => mountedRef.current && generation === 3,
        useAuthStore: {getState: () => ({connectionStatus: 'connected'})},
        useConfigStore: {getState: () => calls},
        requestLogEnabled: true, requestLogId: null, requestLogDownloading: false, requestLogUpdating: false,
        logState: {buffer: ['fixture']}, logPositionRef: {current: {}}, requestLogHomeIpByIdRef: {current: {}},
        pendingViewportRestoreRef: {current: null}, logViewportRef: {current: {page: 1, scrollTop: 0, anchorId: null}},
        retryDelayRef: {current: 8000}, nextReadAtRef: {current: 0}, refreshInterval: 30000,
        MAX_BUFFER_LINES: 10000, MAX_LOG_PAGES_PER_READ: 3, FAST_CATCH_UP_MS: 1000,
        INITIAL_RETRY_MS: 8000, MAX_RETRY_MS: 60000, LONG_PRESS_MS: 650,
        longPressRef: {current: null}, clearLongPressTimer: mock(),
        window: {setTimeout: (fn: () => void) => {timers.push(fn); return timers.length}},
        getErrorMessage: (err: Error) => err.message, redactSensitiveText: (text: string) => text,
        responseDataToText: async (text: string) => text,
        shouldCatchUpLogPage: () => false,
        t: (key: string) => key,
    }
    for (const name of ['setLoading', 'setLogDiskSize', 'setTotalLogLines', 'setLogState', 'setHistoryEvicted',
                        'setLogPage', 'setCatchingUp', 'setLastUpdated', 'setError', 'setLoadingErrors',
                        'setErrorLogsError', 'setErrorLogs', 'setErrorLogDownloading', 'setRequestLogDownloading',
                        'setClearingLogs']) {
        scope[name] = mock()
    }
    const callback = <T>(name: string) => sourceInitializer<T>(file, name, scope)
    return {calls, requests, scope, timers, mountedRef, callback,
            changeConnection: (value: number) => {generation = value}}
}

const staleActions: Array<[string, unknown[]]> = [
    ['loadLogs', [false]], ['clearLogs', []], ['downloadLogs', []], ['loadErrorLogs', []],
    ['downloadErrorLog', ['error.log']], ['previewErrorLog', [{name: 'error.log'}]],
    ['copyLogLine', ['fixture']], ['downloadRequestLog', ['request/id', '192.0.2.4']],
    ['toggleRequestLog', [true]], ['closeErrorLogViewer', []], ['closeRequestLogModal', []],
    ['startLongPress', [{clientX: 0, clientY: 0}, 'request/id']],
]

describe('log page connection ownership', () => {
    for (const [name, args] of staleActions) {
        for (const generation of [4, 5]) {
            test(`${name} from an obsolete render does not act at generation ${generation}`, async () => {
                const view = fixture()
                const action = view.callback<(...args: unknown[]) => unknown>(name)
                view.changeConnection(generation)
                const current = view.requests.errors.begin(generation)
                await action(...args)
                for (const call of Object.values(view.calls)) {
                    expect(call).not.toHaveBeenCalled()
                }
                expect(current.controller.signal.aborted).toBe(false)
                expect(view.timers).toHaveLength(0)
            })
        }
    }

    for (const [name, args] of staleActions.slice(0, 9)) {
        test(`${name} still serves the current connection`, async () => {
            const view = fixture()
            await view.callback<(...args: unknown[]) => unknown>(name)(...args)
            const expectedCall = {
                loadLogs: 'fetchLogs', clearLogs: 'showConfirmation', downloadLogs: 'downloadBlob',
                loadErrorLogs: 'fetchErrorLogs', downloadErrorLog: 'downloadErrorLog',
                previewErrorLog: 'previewErrorLog', copyLogLine: 'copyToClipboard',
                downloadRequestLog: 'downloadRequestLogById', toggleRequestLog: 'updateRequestLog',
            }[name] as keyof typeof view.calls
            expect(view.calls[expectedCall]).toHaveBeenCalledTimes(1)
        })
    }

    for (const change of ['connection', 'aba', 'unmount']) {
        for (const result of ['success', 'failure']) {
            test(`request-log ${result} after ${change} does not update a new connection`, async () => {
                const view = fixture()
                const operation = deferred<undefined>()
                view.calls.updateRequestLog.mockImplementation(() => operation.promise)
                const task = view.callback<(enabled: boolean) => Promise<void>>('toggleRequestLog')(true)
                expect(view.calls.setRequestLogUpdating).toHaveBeenCalledWith(true)
                if (change === 'unmount') {
                    view.mountedRef.current = false
                } else {
                    view.changeConnection(change === 'aba' ? 5 : 4)
                }
                if (result === 'success') {
                    operation.resolve(undefined)
                } else {
                    operation.reject(new Error('fixture failure'))
                }
                await task
                expect(view.calls.updateConfigValue).not.toHaveBeenCalled()
                expect(view.calls.showNotification).not.toHaveBeenCalled()
                expect(view.calls.setRequestLogUpdating).toHaveBeenCalledTimes(1)
            })
        }
    }

    test('the current request-log failure remains visible and clears its busy state', async () => {
        const view = fixture()
        view.calls.updateRequestLog.mockRejectedValue(new Error('fixture failure'))
        await view.callback<(enabled: boolean) => Promise<void>>('toggleRequestLog')(false)
        expect(view.calls.updateConfigValue).not.toHaveBeenCalled()
        expect(view.calls.showNotification).toHaveBeenCalledWith('notification.update_failed: fixture failure', 'error')
        expect(view.calls.setRequestLogUpdating.mock.calls.map(([value]) => value)).toEqual([true, false])
    })

    test('a delayed long press cannot select a request from the previous connection', () => {
        const view = fixture()
        view.callback<(event: {clientX: number; clientY: number}, id: string) => void>('startLongPress')(
            {clientX: 0, clientY: 0}, 'request/id',
        )
        expect(view.timers).toHaveLength(1)
        view.changeConnection(4)
        view.timers[0]!()
        expect(view.calls.setRequestLogId).not.toHaveBeenCalled()
    })

    test('the actual render owner rejects changed generations and unmount', () => {
        const view = fixture()
        const current = view.callback<() => boolean>('isCurrentConnection')
        expect(current()).toBe(true)
        view.changeConnection(4)
        expect(current()).toBe(false)
        view.changeConnection(5)
        expect(current()).toBe(false)
        view.changeConnection(3)
        view.mountedRef.current = false
        expect(current()).toBe(false)
        expect(sourceInitializer<number>(file, 'authGeneration', {
            apiClient: {getAuthGeneration: () => 3}, useAuthStore: (selector: () => number) => selector(),
        })).toBe(3)
    })

    test('an obsolete clear confirmation never deletes logs or aborts the new read', async () => {
        const view = fixture()
        await view.callback<() => Promise<void>>('clearLogs')()
        const confirmation = (view.calls.showConfirmation.mock.calls as unknown as Array<[{onConfirm: () => Promise<void>}]>)[0]![0]
        view.changeConnection(4)
        const read = view.requests.logs.startRead(false, 4)!
        await confirmation.onConfirm()
        expect(view.calls.clearLogs).not.toHaveBeenCalled()
        expect(read.controller.signal.aborted).toBe(false)
    })

    test('the auth subscription invalidates identical identities with a new generation and cleans up once', () => {
        const view = fixture()
        let publish!: (next: unknown, previous: unknown) => void
        const unsubscribeAuth = mock()
        const unsubscribeConfig = mock()
        view.scope.useAuthStore = {subscribe: (callback: typeof publish) => {publish = callback; return unsubscribeAuth}}
        view.scope.useConfigStore = {subscribe: () => unsubscribeConfig}
        const unmount = sourceCallback<() => () => void>(file, 'useEffect', view.scope, 'const invalidateRequests')()
        const old = view.requests.errors.begin(3)
        const state = {apiBase: 'fixture', managementKey: 'fixture', connectionStatus: 'connected', isAuthenticated: true}
        view.changeConnection(4)
        publish(state, {...state})
        expect(old.controller.signal.aborted).toBe(true)
        expect(view.calls.setRequestLogUpdating).toHaveBeenCalledWith(false)
        const fresh = view.requests.errors.begin(4)
        publish(state, {...state})
        expect(fresh.controller.signal.aborted).toBe(false)
        unmount()
        expect(view.mountedRef.current).toBe(false)
        expect(fresh.controller.signal.aborted).toBe(true)
        expect(unsubscribeAuth).toHaveBeenCalledTimes(1)
        expect(unsubscribeConfig).toHaveBeenCalledTimes(1)
    })

    test('clipboard completion from the previous connection cannot publish a notification', async () => {
        const view = fixture()
        const copying = deferred<boolean>()
        view.calls.copyToClipboard.mockImplementation(() => copying.promise)
        const task = view.callback<(text: string) => Promise<void>>('copyLogLine')('fixture')
        view.changeConnection(4)
        copying.resolve(true)
        await task
        expect(view.calls.showNotification).not.toHaveBeenCalled()
    })
})

describe('log polling page lifetime', () => {
    for (const pageLayerStatus of ['current', 'exiting', 'stacked']) {
        test(`polling owns only the current page, status=${pageLayerStatus}`, () => {
            const timers: Array<() => void> = []
            const clearInterval = mock()
            const loadLogs = mock()
            const cleanup = sourceCallback<() => (() => void) | undefined>(file, 'useEffect', {
                activeTab: 'logs', autoRefresh: true, connectionStatus: 'connected', refreshInterval: 30000,
                pageLayerStatus, FAST_CATCH_UP_MS: 1000, nextReadAtRef: {current: 0}, loadLogs,
                document: {visibilityState: 'visible'},
                window: {setInterval: (callback: () => void) => {timers.push(callback); return 7}, clearInterval},
            }, 'window.setInterval')()
            if (pageLayerStatus === 'current') {
                expect(timers).toHaveLength(1)
                timers[0]!()
                expect(loadLogs).toHaveBeenCalledWith(true)
                cleanup!()
                expect(clearInterval).toHaveBeenCalledWith(7)
            } else {
                expect(timers).toHaveLength(0)
                expect(cleanup).toBeUndefined()
                expect(loadLogs).not.toHaveBeenCalled()
            }
        })
    }
})

describe('structured log message rendering', () => {
    test('renders the message and source of a non-request log instead of empty cells', () => {
        const render = sourceInitializer<(line: Record<string, unknown>) => React.ReactElement>(file, 'renderLogRow', {
            React, styles: {}, t: (key: string) => key, isTraceableRequestPath: () => false,
            formatLogTimestamp: (value: string) => value, redactSensitiveText: (value: string) => value,
            Button: 'button', IconCopy: 'svg', cancelLongPress: mock(), handleLongPressMove: mock(),
        })
        const line = {id: 7, raw: '[error] authentication failed', level: 'error',
                      source: 'auth.go:31', message: 'authentication failed'}
        const row = render(line)
        const text = (node: React.ReactNode): string => {
            if (React.isValidElement<{children?: React.ReactNode}>(node)) {
                return text(node.props.children)
            }
            if (Array.isArray(node)) {
                return node.map(text).join(' ')
            }
            return typeof node === 'string' || typeof node === 'number' ? String(node) : ''
        }
        expect(row.props).toMatchObject({'data-log-id': 7})
        expect(text(row)).toContain('authentication failed')
        expect(text(row)).toContain('auth.go:31')
    })
})

describe('log response validation', () => {
    test.each([null, {status: 'ok'}, {lines: 'not an array'}, []])('invalid successful response %j is not reported as an empty log', async (response) => {
        const get = spyOn(apiClient, 'get').mockResolvedValue(response)
        try {
            await expect(logsApi.fetchLogs()).rejects.toThrow('Invalid logs response')
        } finally {
            get.mockRestore()
        }
    })

    test('an invalid supplemental Home response is not returned as a successful partial list', async () => {
        const get = spyOn(apiClient, 'get')
            .mockResolvedValueOnce({logs: [{line: 'fixture', timestamp: 3}], total: 3, offset: 0})
            .mockResolvedValueOnce({status: 'ok'})
        try {
            await expect(logsApi.fetchLogs({limit: 3})).rejects.toThrow('Invalid supplemental Home logs response')
            expect(get).toHaveBeenCalledTimes(2)
        } finally {
            get.mockRestore()
        }
    })
})

describe('Home log supplemental-page connection ownership', () => {
    for (const phase of ['first', 'supplemental']) {
        for (const change of ['connection', 'abort']) {
            test(`${change} during the ${phase} response prevents subsequent pages and consumption`, async () => {
                let generation = 3
                const controller = new AbortController()
                const pending = deferred<unknown>()
                const auth = spyOn(apiClient, 'getAuthGeneration').mockImplementation(() => generation)
                let count = 0
                const get = spyOn(apiClient, 'get').mockImplementation((async () => {
                    ++count
                    if (count === (phase === 'first' ? 1 : 2)) {
                        return pending.promise
                    }
                    return {logs: [{line: `fixture ${count}`, timestamp: count}], total: 3, offset: count - 1}
                }) as typeof apiClient.get)
                try {
                    const task = logsApi.fetchLogs({limit: 3}, {signal: controller.signal})
                    for (let index = 0; index < 12 && count < (phase === 'first' ? 1 : 2); ++index) {
                        await Promise.resolve()
                    }
                    expect(count).toBe(phase === 'first' ? 1 : 2)
                    if (change === 'connection') {
                        generation = 4
                    } else {
                        controller.abort()
                    }
                    pending.resolve({logs: [{line: 'obsolete fixture', timestamp: count}], total: 3, offset: count - 1})
                    await expect(task).rejects.toMatchObject({name: 'AbortError'})
                    expect(count).toBe(phase === 'first' ? 1 : 2)
                } finally {
                    auth.mockRestore()
                    get.mockRestore()
                }
            })
        }
    }

    test('a current Home request retains every supplemental page and the same AbortSignal', async () => {
        const controller = new AbortController()
        const get = spyOn(apiClient, 'get')
            .mockResolvedValueOnce({logs: [{line: 'new', timestamp: 3}], total: 3, offset: 0})
            .mockResolvedValueOnce({logs: [{line: 'middle', timestamp: 2}], total: 3, offset: 1})
            .mockResolvedValueOnce({logs: [{line: 'old', timestamp: 1}], total: 3, offset: 2})
        try {
            const result = await logsApi.fetchLogs({limit: 3}, {signal: controller.signal})
            expect(result.lines).toEqual(['old', 'middle', 'new'])
            expect(get).toHaveBeenCalledTimes(3)
            for (const [, config] of get.mock.calls) {
                expect(config?.signal).toBe(controller.signal)
            }
        } finally {
            get.mockRestore()
        }
    })
})
