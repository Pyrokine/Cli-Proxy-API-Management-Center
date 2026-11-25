import {createLogRequestQueue} from '@/pages/hooks/logRequests'
import {
    AUTO_REFRESH_INTERVALS,
    resolveAutoRefreshMs,
    resolveUsageEventsAutoRefreshMs,
    shouldRefreshUsageEvents,
    USAGE_EVENTS_AUTO_REFRESH_INTERVALS,
} from '@/utils/autoRefresh'
import {describe, expect, mock, test} from 'bun:test'
import ts from 'typescript'
import {sourceCallback, sourceExpression, sourceInitializer} from './sourceCallbacks'

const logsFile   = 'pages/LogsPage.tsx'
const eventsFile = 'components/usage/RequestEventsDetailsCard.tsx'
const intervals  = [3000, 5000, 8000, 15000, 30000, 60000]
const noop       = () => {
}
const useMemo    = <T>(compute: () => T) => compute()
const useState   = <T>(initial: T) => [initial, noop]

type Cleanup = (() => void) | undefined

function refreshControl<T>(file: string, component: string, prop: string, scope: Record<string, unknown>): T {
    return sourceExpression<T>(file, (node, tree) => {
        if (!node.parent || !ts.isJsxExpression(node.parent) || !ts.isJsxAttribute(node.parent.parent) ||
            node.parent.parent.name.getText(tree) !== prop) {
            return false
        }
        const control = node.parent.parent.parent.parent
        return (ts.isJsxSelfClosingElement(control) || ts.isJsxOpeningElement(control)) &&
               control.tagName.getText(tree) === component &&
               control.attributes.getText(tree).includes(component === 'Select' ?
                                                         'RefreshInterval' :
                                                         'checked={autoRefresh}')
    }, scope)
}

function eventsFixture(overrides: Record<string, unknown> = {}) {
    const timers: Array<{ callback: () => void; delay: number }> = []
    const pageDocument                                           = { visibilityState: 'visible' }
    const eventsRequestControllerRef                             = { current: null as AbortController | null }
    const getEvents                                              = mock(async (
        _params: unknown,
        _options: unknown,
    ) => ({ events: [], page: 1, page_size: 50, total: 0, total_pages: 0, accessible_pages: 0 }))
    const clearInterval                                          = mock()
    const onVisibleDateRangeChange                               = mock()
    let clock                                                    = Date.parse('2026-11-09T23:59:59.250Z')
    let updatedClock: number | undefined
    const scope                                                  = {
        activePreset: '24h', enabled: true, autoRefreshEnabled: true, page: 1,
        sortField: 'timestampMs', sortDir: 'desc', pageSize: 50,
        dateRange: { from: '2026-11-08T23:59:59.250Z', to: '2026-11-09T23:59:59.250Z' },
        topModels: [], topCredentials: [], topApiKeys: [], searchQuery: '', statusFilter: '', speedFilter: '',
        pauseAutoRefresh: false, backupPasswordDialog: null,
        requestLogPreview: null, requestDetails: null, exportingFormat: null,
        autoRefreshInterval: sourceInitializer<number>(eventsFile, 'configuredAutoRefreshInterval', {
            autoRefreshConfigSeconds: undefined, config: undefined, useMemo, resolveUsageEventsAutoRefreshMs,
        }),
        eventsRequestControllerRef, shouldRefreshUsageEvents,
        document: pageDocument, Date: { now: () => clock },
        window: {
            setInterval: (callback: () => void, delay: number) => {
                timers.push({ callback, delay });
                return 7
            }, clearInterval,
        },
        setAutoRefreshClockMs: (value: number) => {
            updatedClock = value
        },
        ...overrides,
    }
    const schedule                                               = () => sourceCallback<() => Cleanup>(
        eventsFile,
        'useEffect',
        scope,
        'window.setInterval',
    )()
    const flushClock                                             = async () => {
        if (updatedClock === undefined) {
            return
        }
        const effectiveDateRange = sourceCallback<() => { from: string; to: string }>(
            eventsFile,
            'effectiveDateRange',
            {
                autoRefresh: sourceInitializer<boolean>(
                    eventsFile,
                    'autoRefresh',
                    scope,
                ),
                autoRefreshClockMs: updatedClock,
                dateRange: scope.dateRange,
            },
        )()
        updatedClock             = undefined
        sourceCallback<() => void>(eventsFile, 'useEffect', {
            effectiveDateRange, onVisibleDateRangeChange,
        }, 'onVisibleDateRangeChange?.(effectiveDateRange)')()
        const eventsParams = sourceCallback<() => Record<string, unknown>>(eventsFile, 'eventsParams', {
            ...scope, effectiveDateRange,
            toBackendSortField: sourceCallback(eventsFile, 'toBackendSortField', {}),
            applyFilters: sourceCallback(eventsFile, 'applyFilters', {}),
        })()
        sourceCallback<() => Cleanup>(eventsFile, 'useEffect', {
            enabled: scope.enabled, eventsRequestControllerRef, eventsParams,
            eventsRequestSignature: JSON.stringify(eventsParams), usageApi: { getEvents },
            setEventsData: noop, setFetchError: noop, setSettledRequestSignature: noop, setPage: noop,
        }, '.getEvents(eventsParams')()
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
    }
    return {
        scope, timers, pageDocument, eventsRequestControllerRef, getEvents, clearInterval, schedule, flushClock,
        onVisibleDateRangeChange,
        advance: (ms: number) => {
            clock += ms
        },
    }
}

function logsFixture(refreshInterval: number) {
    const timers: Array<() => void>      = []
    const pageDocument                   = { visibilityState: 'visible' }
    const clearInterval                  = mock()
    const fetchLogs                      = mock(async () => ({ lines: [], logBackendKind: 'file' }))
    const nextReadAtRef                  = { current: 0 }
    let clock                            = 100_000
    let pending                          = Promise.resolve()
    const scope: Record<string, unknown> = {
        isCurrentConnection: () => true, useAuthStore: { getState: () => ({ connectionStatus: 'connected' }) },
        requests: { logs: createLogRequestQueue() }, authGeneration: 1, apiClient: { getAuthGeneration: () => 1 },
        logsApi: { fetchLogs }, logPositionRef: { current: {} }, requestLogHomeIpByIdRef: { current: {} },
        retryDelayRef: { current: 8000 }, nextReadAtRef, refreshInterval,
        MAX_BUFFER_LINES: 10000, MAX_LOG_PAGES_PER_READ: 3, FAST_CATCH_UP_MS: 1000,
        INITIAL_RETRY_MS: 8000, MAX_RETRY_MS: 60000, shouldCatchUpLogPage: () => false,
        Date: { now: () => clock }, getErrorMessage: (error: Error) => error.message, t: (key: string) => key,
    }
    for (const name of ['setLoading', 'setTotalLogLines', 'setCatchingUp', 'setLastUpdated', 'setError']) {
        scope[name] = noop
    }
    const loadLogs = sourceInitializer<(incremental: boolean) => Promise<void>>(logsFile, 'loadLogs', scope)
    scope.loadLogs = (incremental: boolean) => {
        pending = loadLogs(incremental)
    }
    Object.assign(scope, {
        activeTab: 'logs', autoRefresh: true, connectionStatus: 'connected', pageLayerStatus: 'current',
        document: pageDocument, window: {
            setInterval: (callback: () => void) => {
                timers.push(callback);
                return 7
            }, clearInterval,
        },
    })
    return {
        scope, timers, pageDocument, clearInterval, fetchLogs, nextReadAtRef,
        schedule: () => sourceCallback<() => Cleanup>(logsFile, 'useEffect', scope, 'window.setInterval')(),
        tick: async (ms: number) => {
            clock += ms;
            timers[0]!();
            await pending
        },
    }
}

describe('R-030/R-409/R-530 shared refresh contract', () => {
    test('both actual selectors expose all six intervals', () => {
        const logsOptions = sourceInitializer(logsFile, 'REFRESH_INTERVAL_OPTIONS', { AUTO_REFRESH_INTERVALS })
        const expected    = intervals.map((value) => ({ value: String(value), label: `${value / 1000}s` }))
        expect(refreshControl<typeof AUTO_REFRESH_INTERVALS>(
            logsFile, 'Select', 'options', { refreshIntervalOptions: logsOptions },
        )).toEqual(expected)
        expect(refreshControl<typeof AUTO_REFRESH_INTERVALS>(
            eventsFile, 'Select', 'options', { USAGE_EVENTS_AUTO_REFRESH_INTERVALS },
        )).toEqual(expected)
    })

    test('both consumers default to 3 seconds while the details switch defaults off', () => {
        const configRefreshMs               = sourceInitializer(
            logsFile,
            'configRefreshMs',
            { config: undefined, useMemo, resolveAutoRefreshMs },
        )
        const configuredAutoRefreshInterval = sourceInitializer<number>(eventsFile, 'configuredAutoRefreshInterval', {
            autoRefreshConfigSeconds: undefined, config: undefined, useMemo, resolveUsageEventsAutoRefreshMs,
        })
        expect(configRefreshMs).toBe(3000)
        expect(configuredAutoRefreshInterval).toBe(3000)
        expect(sourceInitializer<[boolean, () => void]>(eventsFile, 'autoRefreshEnabled', { useState })[0]).toBe(false)
        expect(sourceInitializer<boolean>(eventsFile, 'autoRefresh', {
            activePreset: '24h', autoRefreshEnabled: false,
        })).toBe(false)
    })

    test('explicit configuration and the details interval override reach the consumer', () => {
        expect(sourceInitializer<number>(eventsFile, 'configuredAutoRefreshInterval', {
            autoRefreshConfigSeconds: 8, config: { autoRefreshInterval: 60 }, useMemo, resolveUsageEventsAutoRefreshMs,
        })).toBe(8000)
        expect(sourceInitializer<number>(eventsFile, 'configuredAutoRefreshInterval', {
            autoRefreshConfigSeconds: undefined,
            config: { autoRefreshInterval: 15 },
            useMemo,
            resolveUsageEventsAutoRefreshMs,
        })).toBe(15000)
        expect(resolveAutoRefreshMs(0)).toBe(0)
        expect(resolveUsageEventsAutoRefreshMs(0)).toBe(3000)
    })

    test('the actual details switch requires opt-in and disables historical controls', () => {
        let autoRefreshEnabled      = false
        const setAutoRefreshClockMs = mock()
        const toggle                = refreshControl<(value: boolean) => void>(eventsFile, 'ToggleSwitch', 'onChange', {
            setAutoRefreshEnabled: (value: boolean) => {
                autoRefreshEnabled = value
            }, setAutoRefreshClockMs,
            Date: { now: () => 123_000 },
        })
        toggle(true)
        expect(autoRefreshEnabled).toBe(true)
        expect(setAutoRefreshClockMs).toHaveBeenCalledWith(123_000)
        toggle(false)
        expect(autoRefreshEnabled).toBe(false)
        expect(setAutoRefreshClockMs).toHaveBeenCalledTimes(1)
        for (const activePreset of ['24h', '7d', '30d', 'all', 'custom', undefined]) {
            for (const control of ['ToggleSwitch', 'Select']) {
                expect(refreshControl<boolean>(eventsFile, control, 'disabled', { activePreset }))
                    .toBe(activePreset !== '24h')
            }
        }
    })

    for (const ms of intervals) {
        test(`details selector -> interval -> real events query preserves ${ms} ms`, async () => {
            let autoRefreshIntervalOverride: number | null = null
            refreshControl<(value: string) => void>(eventsFile, 'Select', 'onChange', {
                setAutoRefreshIntervalOverride: (value: number) => {
                    autoRefreshIntervalOverride = value
                },
            })(String(ms))
            const autoRefreshInterval = sourceInitializer<number>(eventsFile, 'autoRefreshInterval', {
                autoRefreshIntervalOverride, configuredAutoRefreshInterval: resolveUsageEventsAutoRefreshMs(),
            })
            const view                = eventsFixture({ autoRefreshInterval })
            const cleanup             = view.schedule()
            expect(view.timers.map((timer) => timer.delay)).toEqual([ms])
            view.advance(ms)
            view.timers[0]!.callback()
            await view.flushClock()
            expect(view.getEvents).toHaveBeenCalledTimes(1)
            expect(view.getEvents.mock.calls[0]![0]).toMatchObject({
                                                                       page: 1,
                                                                       page_size: 50,
                                                                       sort: 'timestamp',
                                                                       order: 'desc',
                                                                       view: 'compact',
                                                                   })
            cleanup!()
            expect(view.clearInterval).toHaveBeenCalledWith(7)
        })

        test(`logs selector -> ${ms} ms -> loadLogs throttles actual API requests`, async () => {
            let refreshIntervalOverride: number | null = null
            refreshControl<(value: string) => void>(logsFile, 'Select', 'onChange', {
                // noinspection JSUnusedGlobalSymbols
                'setRefreshIntervalOverride': (value: number) => {
                    refreshIntervalOverride = value
                },
            })(String(ms))
            const refreshInterval = sourceInitializer<number>(logsFile, 'refreshInterval', {
                refreshIntervalOverride, configRefreshMs: resolveAutoRefreshMs(),
            })
            const view            = logsFixture(refreshInterval)
            const cleanup         = view.schedule()
            await view.tick(0)
            expect(view.fetchLogs).toHaveBeenCalledTimes(1)
            expect(view.nextReadAtRef.current).toBe(100_000 + ms)
            await view.tick(ms - 1)
            expect(view.fetchLogs).toHaveBeenCalledTimes(1)
            await view.tick(1)
            expect(view.fetchLogs).toHaveBeenCalledTimes(2)
            cleanup!()
            expect(view.clearInterval).toHaveBeenCalledWith(7)
        })
    }

    test('the default details timer uses 3 seconds and rolls the exact 24-hour query across midnight', async () => {
        const view    = eventsFixture()
        const cleanup = view.schedule()
        expect(view.timers[0]!.delay).toBe(3000)
        view.advance(3000)
        view.timers[0]!.callback()
        await view.flushClock()
        const range = { from: '2026-11-09T00:00:02.250Z', to: '2026-11-10T00:00:02.250Z' }
        expect(view.getEvents.mock.calls[0]![0]).toMatchObject(range)
        expect(view.onVisibleDateRangeChange).toHaveBeenCalledWith(range)
        cleanup!()
    })

    for (const state of [
        { autoRefreshEnabled: false }, { enabled: false }, { activePreset: '7d' }, { activePreset: '30d' },
        { activePreset: 'all' }, { activePreset: undefined }, { activePreset: 'custom' },
        { page: 2 }, { sortField: 'model' }, { sortDir: 'asc' },
        { pauseAutoRefresh: true }, { backupPasswordDialog: {} },
        { requestLogPreview: {} }, { requestDetails: {} }, { exportingFormat: 'csv' },
    ]) {
        test(`details does not schedule periodic requests for ${JSON.stringify(state)}`, async () => {
            const view = eventsFixture(state)
            expect(view.schedule()).toBeUndefined()
            expect(view.timers).toHaveLength(0)
            await view.flushClock()
            expect(view.getEvents).not.toHaveBeenCalled()
        })
    }

    test('details suppresses hidden/busy ticks, resumes when visible and clears the interval on stop', async () => {
        const view                        = eventsFixture()
        const cleanup                     = view.schedule()
        view.pageDocument.visibilityState = 'hidden'
        view.advance(3000)
        view.timers[0]!.callback()
        await view.flushClock()
        expect(view.getEvents).not.toHaveBeenCalled()
        view.pageDocument.visibilityState       = 'visible'
        view.eventsRequestControllerRef.current = new AbortController()
        view.timers[0]!.callback()
        await view.flushClock()
        expect(view.getEvents).not.toHaveBeenCalled()
        view.eventsRequestControllerRef.current = null
        view.timers[0]!.callback()
        await view.flushClock()
        expect(view.getEvents).toHaveBeenCalledTimes(1)
        cleanup!()
        view.scope.autoRefreshEnabled = false
        expect(view.schedule()).toBeUndefined()
        expect(view.clearInterval).toHaveBeenCalledWith(7)
    })

    test('logs uses the default 3-second request gate and skips hidden/offline/inactive polling', async () => {
        const configRefreshMs             = sourceInitializer<number>(
            logsFile,
            'configRefreshMs',
            { config: undefined, useMemo, resolveAutoRefreshMs },
        )
        const view                        = logsFixture(sourceInitializer(
            logsFile,
            'refreshInterval',
            { refreshIntervalOverride: null, configRefreshMs },
        ))
        const cleanup                     = view.schedule()
        view.pageDocument.visibilityState = 'hidden'
        await view.tick(0)
        expect(view.fetchLogs).not.toHaveBeenCalled()
        view.pageDocument.visibilityState = 'visible'
        await view.tick(0)
        expect(view.nextReadAtRef.current).toBe(103_000)
        expect(view.fetchLogs).toHaveBeenCalledTimes(1)
        cleanup!()
        for (const state of
            [
                { autoRefresh: false },
                { connectionStatus: 'disconnected' },
                { activeTab: 'errors' },
                { pageLayerStatus: 'exiting' },
                { refreshInterval: 0 },
            ]) {
            const inactive = logsFixture(configRefreshMs)
            Object.assign(inactive.scope, state)
            expect(inactive.schedule()).toBeUndefined()
            expect(inactive.timers).toHaveLength(0)
            expect(inactive.fetchLogs).not.toHaveBeenCalled()
        }
    })
})
