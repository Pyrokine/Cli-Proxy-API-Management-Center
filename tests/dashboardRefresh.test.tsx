import {buildManualKeyCardItems} from '@/components/credentials/apiKeyStatus'
import {expect, mock, test} from 'bun:test'
import React from 'react'
import ts from 'typescript'
import {sourceCallback, sourceExpression, sourceInitializer} from './sourceCallbacks'

const file = 'pages/DashboardPage.tsx'
const noop = () => {
}

function statistics({ connectionStatus = 'connected', pageLayerStatus = 'current', failing = false } = {}) {
    let generation     = 1
    let wait           = Promise.resolve()
    const gate         = Promise.withResolvers<void>()
    const request      = mock(async () => {
        await wait;
        return [{}]
    })
    const providersApi = {
        getGeminiKeys: request, getCodexConfigs: request, getMetaConfigs: failing ? async () => {
            throw new Error('synthetic provider failure')
        } : request,
        getClaudeConfigs: request, getInteractionsKeys: request, getVertexConfigs: request, getXAIConfigs: request,
        getOpenAIProviders: async () => [
            {
                name: 'fixture',
                baseUrl: 'https://fixture.invalid',
                apiKeyEntries: [{ apiKey: 'a' }, { apiKey: 'b' }],
            },
        ],
    }
    const scope        = {
        useCallback: <T, >(callback: T) => callback,
        connectionStatus,
        pageLayerStatus,
        apiBase: 'https://fixture.invalid',
        apiClient: { getAuthGeneration: () => generation },
        statsRequestGeneration: { current: 0 },
        buildManualKeyCardItems,
        apiKeysApi: { list: request },
        authFilesApi: { list: async () => ({ files: [{}] }) },
        providersApi,
        setLoading: mock((_value: boolean) => {
        }),
        setStats: mock((_value: unknown) => {
        }),
        setProviderStats: mock((_value: unknown) => {
        }),
    }
    const fetch        = sourceInitializer<(force?: boolean) => Promise<void>>(file, 'fetchStats', scope)
    return {
        scope, fetch, request, defer: () => {
            wait = gate.promise
        }, complete: () => gate.resolve(), change: () => {
            ++generation
        },
    }
}

for (const cause of ['connection', 'new request', 'unmount']) {
    test(`statistics ignore a completed old request after ${cause}`, async () => {
        const flow = statistics()
        flow.defer()
        const pending = flow.fetch()
        flow.scope.setStats.mockClear()
        flow.scope.setProviderStats.mockClear()
        flow.scope.setLoading.mockClear()
        if (cause === 'connection') {
            flow.change()
        } else if (cause === 'unmount') {
            sourceCallback<() => () => void>(file, 'useEffect', {
                ...flow.scope, fetchStats: flow.fetch, fetchModels: noop,
                invalidateRequests: sourceCallback(file, 'invalidateRequests', {
                    statsRequestGeneration: flow.scope.statsRequestGeneration, modelsRequestGeneration: { current: 0 },
                }), queueMicrotask: noop,
            }, 'queueMicrotask')()()
        } else {
            ++flow.scope.statsRequestGeneration.current
        }
        flow.complete()
        await pending
        expect(flow.scope.setStats).not.toHaveBeenCalled()
        expect(flow.scope.setProviderStats).not.toHaveBeenCalled()
        expect(flow.scope.setLoading).not.toHaveBeenCalled()
    })
}

for (const state of [{ connectionStatus: 'disconnected' }, { pageLayerStatus: 'outgoing' }]) {
    test(`statistics skip an inactive ${JSON.stringify(state)} page`, async () => {
        const flow = statistics(state)
        await flow.fetch()
        expect(flow.request).not.toHaveBeenCalled()
        expect(flow.scope.setStats).not.toHaveBeenCalled()
    })
}

test('a failed provider keeps the visible credential total unknown and makes explicit refresh fail', async () => {
    const flow = statistics({ failing: true })
    await flow.fetch()
    const providerStats                  = flow.scope.setProviderStats.mock.calls[0][0]
    const scope: Record<string, unknown> = { providerStats, stats: { apiKeys: 1, authFiles: 1 } }
    for (const name of ['providerCounts', 'providerStatsReady', 'totalProviderKeys', 'totalCredentials']) {
        scope[name] = sourceInitializer(file, name, scope)
    }
    const cards = sourceInitializer<Array<{ path: string; value: unknown; sublabel?: string }>>(file, 'quickStats', {
        ...scope, React, t: (key: string) => key, loading: false, hasProviderStats: true,
        // noinspection JSUnusedGlobalSymbols
        'IconKey': () => null,
        // noinspection JSUnusedGlobalSymbols
        'IconBot': () => null,
        // noinspection JSUnusedGlobalSymbols
        'IconSatellite': () => null,
        modelsRequestLoading: false, modelsLoading: false, modelsError: null, models: [],
    })
    expect(cards.find((card) => card.path === '/credentials')).toMatchObject({ value: '-', sublabel: undefined })
    expect(flow.fetch(true)).rejects.toThrow('synthetic provider failure')
})

test(
    'the registered header refresh waits for both statistics and forced runtime inventory before finishing',
    async () => {
        const stats                       = Promise.withResolvers<void>()
        const models                      = Promise.withResolvers<void>()
        const fetchStats                  = mock(() => stats.promise)
        const fetchModels                 = mock(() => models.promise)
        const handleRefresh               = sourceInitializer<() => Promise<void>>(file, 'handleRefresh', {
            useCallback: <T, >(callback: T) => callback, fetchStats, fetchModels,
        })
        const shared                      = globalThis as unknown as {
            activeHeaderRefreshHandler?: (() => Promise<void>) | null
        }
        const previous                    = shared.activeHeaderRefreshHandler
        shared.activeHeaderRefreshHandler = null
        let cleanup: (() => void) | undefined
        try {
            sourceExpression(
                file,
                (node, tree) => ts.isCallExpression(node) &&
                                node.expression.getText(tree) ===
                                'useHeaderRefresh',
                {
                    pageLayerStatus: 'current', handleRefresh,
                    useHeaderRefresh: (handler: typeof handleRefresh) => {
                        cleanup =
                            sourceCallback<() => () => void>(
                                'hooks/useHeaderRefresh.ts',
                                'useEffect',
                                { handler },
                            )()
                    },
                },
            )
            const trigger = sourceInitializer<() => Promise<void>>(
                'hooks/useHeaderRefresh.ts',
                'triggerHeaderRefresh',
                {},
            )
            let finished  = false
            const pending = trigger().then(() => {
                finished = true
            })
            expect(fetchStats).toHaveBeenCalledWith(true)
            expect(fetchModels).toHaveBeenCalledWith(true)
            stats.resolve()
            await Promise.resolve();
            await Promise.resolve()
            expect(finished).toBe(false)
            models.resolve()
            await pending
            expect(finished).toBe(true)
            cleanup!()
            await trigger()
            expect(fetchStats).toHaveBeenCalledTimes(1)
        } finally {
            cleanup?.()
            if (previous === undefined) {
                delete shared.activeHeaderRefreshHandler
            } else {
                shared.activeHeaderRefreshHandler = previous
            }
        }
    },
)

test('the outgoing dashboard does not register a header refresh callback', () => {
    const registered: unknown[] = []
    sourceExpression(
        file,
        (node, tree) => ts.isCallExpression(node) && node.expression.getText(tree) === 'useHeaderRefresh',
        {
            pageLayerStatus: 'outgoing',
            handleRefresh: noop,
            useHeaderRefresh: (handler: unknown) => registered.push(handler),
        },
    )
    expect(registered).toEqual([null])
})

test('the header reports a real dashboard refresh failure and ignores a result from an older connection', async () => {
    let generation  = 1
    const notices   = mock()
    const pending   = Promise.withResolvers<void>()
    const apiClient = { getAuthGeneration: () => generation }
    const refresh   = sourceInitializer<() => Promise<void>>('components/layout/MainLayout.tsx', 'handleRefreshAll', {
        apiClient, clearCache: noop, fetchConfig: () => pending.promise, triggerHeaderRefresh: async () => {
            throw new Error('synthetic dashboard failure')
        },
        showNotification: notices, t: (key: string) => key,
    })
    const request   = refresh()
    pending.resolve()
    await request
    expect(notices).toHaveBeenCalledWith('notification.refresh_failed: synthetic dashboard failure', 'error')
    notices.mockClear()
    const gate  = Promise.withResolvers<void>()
    const stale = sourceInitializer<() => Promise<void>>('components/layout/MainLayout.tsx', 'handleRefreshAll', {
        apiClient, clearCache: noop, fetchConfig: () => gate.promise, triggerHeaderRefresh: async () => {
        },
        showNotification: notices, t: (key: string) => key,
    })()
    ++generation
    gate.resolve()
    await stale
    expect(notices).not.toHaveBeenCalled()
})
