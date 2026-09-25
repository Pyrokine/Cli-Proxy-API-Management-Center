import {describe, expect, test} from 'bun:test'
import {readFileSync} from 'node:fs'
import {fileURLToPath, URL} from 'node:url'

import {expectSourceToContain} from './sourceContractAssertions'

import {usageSummaryRequestKey} from '@/components/usage/hooks/useUsageSummary'
import {
    createUsageEventExport,
    MAX_USAGE_EVENT_EXPORT_EVENTS,
    UsageEventExportLimitError,
} from '@/components/usage/usageEventExport'
import {apiClient, parseRetryAfterSeconds} from '@/services/api/client'
import {logsApi} from '@/services/api/logs'
import {updateApi} from '@/services/api/update'
import {usageApi} from '@/services/api/usage'

const logsPageSource     = readFileSync(
    fileURLToPath(new URL('../src/pages/LogsPage.tsx', import.meta.url)),
    'utf8',
)
const versionModalSource = readFileSync(
    fileURLToPath(new URL('../src/components/system/VersionHistoryModal.tsx', import.meta.url)),
    'utf8',
)
const eventsCardSource   = readFileSync(
    fileURLToPath(new URL('../src/components/usage/RequestEventsDetailsCard.tsx', import.meta.url)),
    'utf8',
)
const eventsCardStyles   = readFileSync(
    fileURLToPath(new URL('../src/components/usage/RequestEventsDetailsCard.module.scss', import.meta.url)),
    'utf8',
)
const apiClientSource    = readFileSync(
    fileURLToPath(new URL('../src/services/api/client.ts', import.meta.url)),
    'utf8',
)

describe('request cancellation contracts', () => {
    test('propagates AbortSignal through logs, update polling, and usage events APIs', async () => {
        const originalGet = apiClient.get
        const seenSignals = new Map<string, AbortSignal | undefined>()
        apiClient.get     = (async (url: string, config?: { signal?: AbortSignal }) => {
            seenSignals.set(url.split('?')[0] ?? url, config?.signal)
            if (url === '/logs') {
                return { lines: [], 'line-count': 0 }
            }
            if (url === '/update-status') {
                return {
                    status: 'idle',
                    message: '',
                    target_version: '',
                    percent: 0,
                    current_version: '',
                }
            }
            return { events: [], total: 0, page: 1, page_size: 50, total_pages: 0 }
        }) as typeof apiClient.get

        const controller = new AbortController()
        try {
            await logsApi.fetchLogs({}, { signal: controller.signal })
            await updateApi.status({ signal: controller.signal })
            await usageApi.getEvents({ page: 1 }, { signal: controller.signal })

            expect(seenSignals.get('/logs')).toBe(controller.signal)
            expect(seenSignals.get('/update-status')).toBe(controller.signal)
            expect(seenSignals.get('/usage/events')).toBe(controller.signal)
        } finally {
            apiClient.get = originalGet
        }
    })

    test('parses Retry-After seconds and HTTP dates without retrying early', () => {
        expect(parseRetryAfterSeconds('1.1', 0)).toBe(2)
        expect(parseRetryAfterSeconds('Thu, 01 Jan 1970 00:00:02 GMT', 500)).toBe(2)
        expect(parseRetryAfterSeconds('invalid', 0)).toBeUndefined()
    })

    test('ignores version headers from an earlier authentication generation', () => {
        expect(apiClientSource).toContain('responseGeneration !== this.authGeneration')
        expect(apiClientSource.indexOf('responseGeneration !== this.authGeneration')).toBeLessThan(
            apiClientSource.indexOf('new CustomEvent(\'server-version-update\''),
        )
    })

    test('does not reuse or publish version responses across authentication generations', async () => {
        for (const storageName of ['localStorage', 'sessionStorage'] as const) {
            if (typeof globalThis[storageName] !== 'undefined') {
                continue
            }
            const values = new Map<string, string>()
            Object.defineProperty(globalThis, storageName, {
                configurable: true,
                value: {
                    get length() {
                        return values.size
                    },
                    clear: () => values.clear(),
                    getItem: (key: string) => values.get(key) ?? null,
                    key: (index: number) => [...values.keys()][index] ?? null,
                    removeItem: (key: string) => values.delete(key),
                    setItem: (key: string, value: string) => values.set(key, value),
                } satisfies Storage,
            })
        }
        const { useAuthStore } = await import('../src/stores/useAuthStore')
        const originalGet      = apiClient.get
        type VersionResponse = {
            version: string
            build_time: string
            commit: string
            min_panel_version: string
            features: { plugins: boolean }
        }
        const pending: Array<{ resolve: (value: VersionResponse) => void }> = []
        const mockGet                                                       = () => new Promise<VersionResponse>((resolve) => pending.push(
            { resolve }))
        apiClient.get                                                       = mockGet as typeof apiClient.get

        try {
            apiClient.setConfig({ apiBase: 'https://server-a.example', managementKey: 'key-a' })
            const first = useAuthStore.getState().refreshServerVersion()
            apiClient.setConfig({ apiBase: 'https://server-b.example', managementKey: 'key-b' })
            const second = useAuthStore.getState().refreshServerVersion()
            expect(pending).toHaveLength(2)

            pending[1]!.resolve({
                                    version: 'server-b',
                                    build_time: 'build-b',
                                    commit: 'commit-b',
                                    min_panel_version: '1.0.0',
                                    features: { plugins: true },
                                })
            await second
            pending[0]!.resolve({
                                    version: 'server-a',
                                    build_time: 'build-a',
                                    commit: 'commit-a',
                                    min_panel_version: '0.9.0',
                                    features: { plugins: false },
                                })
            await first

            const state = useAuthStore.getState()
            expect(state.serverVersion).toBe('server-b')
            expect(state.serverBuildDate).toBe('build-b')
            expect(state.serverFeatures).toEqual({ plugins: true })
        } finally {
            apiClient.get = originalGet
            apiClient.setConfig({ apiBase: '', managementKey: '' })
            useAuthStore.setState({
                                      serverVersion: null,
                                      serverBuildDate: null,
                                      serverMinPanelVersion: null,
                                      serverFeatures: {},
                                      serverVersionSource: null,
                                  })
        }
    })

    test('keeps component request lifetimes abortable and polling serial', () => {
        expect(logsPageSource).toContain('requests.logs.invalidate()')
        expect(versionModalSource).not.toContain('setInterval(async')
        expect(versionModalSource).toContain('UPDATE_POLL_FAILURE_LIMIT')
        expect(eventsCardSource).toContain('.getEvents(eventsParams, { signal: controller.signal })')
        expect(eventsCardSource).toContain('document.visibilityState === \'visible\'')
        expect(eventsCardSource).toContain('Boolean(eventsRequestControllerRef.current)')
        expect(eventsCardSource).toContain('shouldRefreshUsageEvents')
    })
})

describe('request log lifecycle contracts', () => {
    test('only exposes log actions for available artifacts', () => {
        expect(eventsCardSource).toContain('row.requestLogState === \'available\'')
        expect(eventsCardSource).toContain('previewRequestLog(row.requestId, row.requestLogHomeIp)')
        expect(eventsCardSource).toContain('downloadRequestLog(row.requestId, row.requestLogHomeIp)')
        expect(eventsCardSource).not.toContain('requestLogEnabled || row.failed')
    })

    test('renders the complete request ID on its own wrapping line', () => {
        expect(eventsCardSource).toContain(
            '<span className={styles.requestEventsRequestId} title={row.requestId}>{row.requestId}</span>',
        )
        const requestIdRule = eventsCardStyles.match(
            /\.requestEventsRequestId\s*\{(?<body>[\s\S]*?)\n\}/,
        )?.groups?.body ?? ''
        expect(requestIdRule).toContain('display: block')
        expect(requestIdRule).toContain('width: 100%')
        expect(requestIdRule).toContain('text-align: left')
        expect(requestIdRule).toContain('white-space: normal')
        expect(requestIdRule).toContain('overflow-wrap: anywhere')
        expect(requestIdRule).not.toContain('overflow: hidden')
        expect(requestIdRule).not.toContain('text-overflow: ellipsis')
        expect(requestIdRule).not.toContain('max-width: 150px')

        const actionsRule = eventsCardStyles.match(
            /\.requestLogActions\s*\{(?<body>[\s\S]*?)\n\}/,
        )?.groups?.body ?? ''
        expect(actionsRule).toContain('flex-direction: column')
        expect(actionsRule).toContain('align-items: flex-start')
    })

    test('passes the indexed Home location to request log preview and download', async () => {
        const originalGet    = apiClient.get
        const originalGetRaw = apiClient.getRaw
        const seenRequests: Array<{
            raw: boolean
            url: string
            params: unknown
        }>                   = []
        apiClient.get        = (async (url: string, config?: { params?: unknown }) => {
            seenRequests.push({ raw: false, url, params: config?.params })
            return { content: 'preview', truncated: false, total_lines: 1 }
        }) as typeof apiClient.get
        apiClient.getRaw     = (async (url: string, config?: { params?: unknown }) => {
            seenRequests.push({ raw: true, url, params: config?.params })
            return { data: new Blob(['full log']), headers: {} }
        }) as typeof apiClient.getRaw

        try {
            await logsApi.previewRequestLogById('request/id', 300, '192.0.2.45')
            await logsApi.downloadRequestLogById('request/id', '192.0.2.45')

            expect(seenRequests).toEqual([
                                             {
                                                 raw: false,
                                                 url: '/request-log-by-id/request%2Fid',
                                                 params: { lines: 300, home_ip: '192.0.2.45' },
                                             },
                                             {
                                                 raw: true,
                                                 url: '/request-log-by-id/request%2Fid',
                                                 params: { home_ip: '192.0.2.45' },
                                             },
                                         ])
        } finally {
            apiClient.get    = originalGet
            apiClient.getRaw = originalGetRaw
        }
    })

    test('defines every artifact state in all supported locales', () => {
        const states = [
            'available',
            'pending',
            'disabled',
            'not_captured',
            'publish_failed',
            'expired',
            'legacy_unknown',
        ]
        for (const localeName of ['en', 'ru', 'zh-CN', 'zh-TW']) {
            const locale = JSON.parse(
                readFileSync(new URL(`../src/i18n/locales/${localeName}.json`, import.meta.url), 'utf8'),
            ) as { usage_stats: Record<string, string> }
            for (const state of states) {
                const key = `request_events_log_state_${state}`
                expect(locale.usage_stats[key]).toBeTruthy()
                expect(locale.usage_stats[key]).not.toBe(key)
            }
        }
    })
})

describe('usage request and export contracts', () => {
    test('keeps canonical cache buckets and both pricing views in event rendering and exports', () => {
        expect(eventsCardSource).toContain('resolveUsageTokenMetrics(event.tokens)')
        expect(eventsCardSource).toContain('tokenMetrics.cacheHitTokens')
        expectSourceToContain(eventsCardSource, 'const pricingReceipt = event.pricing_receipt')
        expect(eventsCardSource).toContain('formatPricingReceiptTitle(pricingReceipt, cost, lang, t)')
        expect(eventsCardSource).toContain('row.pricingReceiptTitle || undefined')
        expect(eventsCardSource).toContain('styles.requestEventsSubline')
        expect(eventsCardSource).toContain('row.costLabel')
        expect(eventsCardSource).not.toContain('costStatus')
        expect(eventsCardSource).not.toContain('costReason')
        expect(eventsCardSource).toContain('\'cache_read_tokens\'')
        expect(eventsCardSource).toContain('\'cache_write_tokens\'')
        expect(eventsCardSource).toContain('\'cost\'')
        expect(eventsCardSource).not.toContain('\'cost_status\'')
        expect(eventsCardSource).not.toContain('\'cost_reason\'')
    })

    test('uses compact events for the table while keeping export pages full', async () => {
        const originalGet = apiClient.get
        let requestURL    = ''
        apiClient.get     = (async (url: string) => {
            requestURL = url
            return { events: [], total: 0, page: 1, page_size: 50, total_pages: 0 }
        }) as typeof apiClient.get

        try {
            await usageApi.getEvents({ page: 1, view: 'compact' })
            expect(new URL(requestURL, 'https://example.test').searchParams.get('view')).toBe('compact')
            expect(eventsCardSource.match(/view: 'compact'/g)).toHaveLength(1)
        } finally {
            apiClient.get = originalGet
        }
    })

    test('recognizes identical summary requests for page-level reuse', () => {
        const primary = {
            from: '2026-08-03T10:00',
            to: '2026-08-03T11:00',
            granularity: 'hourly' as const,
            api_key: ['key-a', 'key-b'],
            groups: 'none' as const,
        }

        expect(usageSummaryRequestKey(primary)).toBe(usageSummaryRequestKey({ ...primary }))
        expect(usageSummaryRequestKey(primary)).toBe(
            usageSummaryRequestKey({ ...primary, from: '2026-08-03T10:00:00', to: '2026-08-03T11:00:00' }),
        )
        expect(usageSummaryRequestKey(primary)).not.toBe(
            usageSummaryRequestKey({ ...primary, groups: 'all' }),
        )
    })

    test('downloads encrypted usage backups as raw blobs', async () => {
        const originalGetRaw = apiClient.getRaw
        const controller     = new AbortController()
        let requestConfig: { responseType?: string; signal?: AbortSignal } | undefined
        apiClient.getRaw     = (async (_url: string, config?: typeof requestConfig) => {
            requestConfig = config
            return { data: new Blob(['backup']), headers: {} }
        }) as typeof apiClient.getRaw

        try {
            await usageApi.exportUsage(undefined, { signal: controller.signal })
            expect(requestConfig?.responseType).toBe('blob')
            expect(requestConfig?.signal).toBe(controller.signal)
        } finally {
            apiClient.getRaw = originalGetRaw
        }
    })

    test('uses the first export page total as the resource limit authority', async () => {
        let fetchCount = 0
        // noinspection ES6RedundantAwait
        await expect(createUsageEventExport({
                                                format: 'json',
                                                signal: new AbortController().signal,
                                                csvHeader: [],
                                                fetchPage: async () => {
                                                    ++fetchCount
                                                    return {
                                                        events: [],
                                                        total: MAX_USAGE_EVENT_EXPORT_EVENTS + 1,
                                                        page: 1,
                                                        page_size: 500,
                                                        total_pages: 21,
                                                    }
                                                },
                                                formatCsvRow: () => '',
                                                formatJsonEvent: () => ({}),
                                            })).rejects.toBeInstanceOf(UsageEventExportLimitError)
        expect(fetchCount).toBe(1)
    })

    test('serializes event exports through sequential bounded pages', async () => {
        const event                    = {
            timestamp: '2026-08-03T10:00:00Z',
            model: 'model-a',
            source: 'source-a',
            auth_index: 'auth-a',
            api_key: 'masked-key',
            tokens: {
                input_tokens: 1,
                output_tokens: 2,
                cached_tokens: 0,
                reasoning_tokens: 0,
                total_tokens: 3,
            },
            failed: false,
        }
        const requestedPages: number[] = []
        let activeRequests             = 0
        let maxActiveRequests          = 0
        const blob                     = await createUsageEventExport({
                                                                          format: 'json',
                                                                          signal: new AbortController().signal,
                                                                          csvHeader: [],
                                                                          fetchPage: async (page) => {
                                                                              requestedPages.push(page)
                                                                              ++activeRequests
                                                                              maxActiveRequests =
                                                                                  Math.max(
                                                                                      maxActiveRequests,
                                                                                      activeRequests,
                                                                                  )
                                                                              await Promise.resolve()
                                                                              --activeRequests
                                                                              return {
                                                                                  events: page === 1 ?
                                                                                          Array.from(
                                                                                              { length: 500 },
                                                                                              () => event,
                                                                                          ) :
                                                                                      [event],
                                                                                  total: 501,
                                                                                  page,
                                                                                  page_size: 500,
                                                                                  total_pages: 2,
                                                                              }
                                                                          },
                                                                          formatCsvRow: () => '',
                                                                          formatJsonEvent: (
                                                                              _item,
                                                                              index,
                                                                          ) => ({ index }),
                                                                      })

        expect(requestedPages).toEqual([1, 2])
        expect(maxActiveRequests).toBe(1)
        expect(JSON.parse(await blob?.text() ?? '[]')).toHaveLength(501)
        expect(eventsCardSource).not.toContain('const fetchAllEvents')
        expect(eventsCardSource).not.toContain('const allEvents: UsageEvent[]')
    })
})
