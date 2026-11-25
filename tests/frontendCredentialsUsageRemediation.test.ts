import {buildManualKeyCardItems} from '@/components/credentials/apiKeyStatus'
import {filterAuthFiles} from '@/components/credentials/authFileListLogic'
import {groupVendorAuthFiles} from '@/components/credentials/hooks/useCredentialsData'
import type {VendorDefinition} from '@/components/credentials/hooks/useVendorRegistry'
import {downloadAuthFilesBatch} from '@/features/authFiles/batchDownload'
import type {UsageSummary} from '@/services/api/usage'
import {useTimezoneStore} from '@/stores/useTimezoneStore'
import type {AuthFileItem} from '@/types/authFile'
import {buildChartDataFromSummary, formatCompactNumber, formatUsd, type ServiceHealthData} from '@/utils/usage'
import {summaryToApiKeyStats} from '@/utils/usage/summaryHelpers'
import {describe, expect, test} from 'bun:test'
import {Children, createElement, isValidElement, type ReactElement, type ReactNode} from 'react'
import ts from 'typescript'
import {sourceCallback, sourceExpression, sourceInitializer} from './sourceCallbacks'

const file       = (name: string, extra: object = {}) => ({ name, ...extra }) as AuthFileItem
const healthCard = 'components/usage/ServiceHealthCard.tsx'

function expectLatestHealthCellAtBottomRight(healthData: ServiceHealthData) {
    const leadingSlots = sourceInitializer<number>(healthCard, 'leadingSlots', { healthData })
    const latest       = healthData.blockDetails.length - 1
    const grid         = sourceExpression<ReactElement<{ children: ReactNode }>>(
        healthCard,
        (node, tree) =>
            ts.isJsxElement(node) &&
            node.openingElement.attributes.getText(tree).includes('className={styles.healthGrid}'),
        {
            React: { createElement },
            healthData,
            leadingSlots,
            activeTooltip: latest,
            gridRef: null,
            styles: {
                healthGrid: 'health-grid',
                healthBlockWrapper: 'cell',
                healthBlockActive: 'latest-cell',
            },
            rateToColor: () => '',
            renderTooltip: () => null,
            handlePointerLeave: () => {
            },
        },
    )
    const slots        = Children.toArray(grid.props.children)
                                 .filter(isValidElement<{ 'aria-hidden'?: boolean; className?: string }>)
    expect(slots).toHaveLength(healthData.cols * healthData.rows)
    expect(slots.filter((slot) => slot.props['aria-hidden'])).toEqual(slots.slice(0, leadingSlots))
    expect(leadingSlots).toBeLessThan(healthData.rows)
    const latestSlot = slots.findIndex((slot) => slot.props.className?.includes('latest-cell'))
    expect(Math.floor(latestSlot / healthData.rows)).toBe(healthData.cols - 1)
    expect(latestSlot % healthData.rows).toBe(7)
    const getTooltipVerticalClass = sourceInitializer<(index: number) => string>(
        healthCard,
        'getTooltipVerticalClass',
        {
            healthData,
            leadingSlots,
            styles: { healthTooltipBelow: 'below' },
        },
    )
    expect(getTooltipVerticalClass(latest)).toBe('')
}

describe('frontend credential and usage remediation', () => {
    test('stops a selected-file download before saving or dispatching on another connection', async () => {
        let generation           = 1
        const requests: string[] = []
        const saved: string[]    = []
        const result             = await downloadAuthFilesBatch(['first.json', 'second.json'], async (name) => {
            requests.push(name)
            generation = 2
            return new Blob(['synthetic'])
        }, (name) => saved.push(name), () => generation === 1)
        expect(requests).toEqual(['first.json'])
        expect(saved).toEqual([])
        expect(result).toEqual({ downloaded: [], failed: ['first.json', 'second.json'] })
    })

    test('assigns each auth file once using provider before type and filename', () => {
        const vendors = [
            { id: 'codex', authFileTypes: ['codex'], oauthProviders: [] },
            { id: 'claude', authFileTypes: ['claude'], oauthProviders: ['anthropic'] },
            { id: 'other', authFileTypes: [], oauthProviders: [] },
        ] as unknown as VendorDefinition[]
        const entries = [
            file('claude-legacy.json', { provider: 'codex', type: 'claude' }),
            file('codex-legacy.json', { type: 'claude' }),
        ]
        const groups  = groupVendorAuthFiles(vendors, entries)
        expect(groups.get('codex')).toEqual([entries[0]])
        expect(groups.get('claude')).toEqual([entries[1]])
        expect([...groups.values()].flat()).toHaveLength(2)
    })

    test('filters current failures independently of accumulated successful requests', () => {
        const unavailable = file('failed.json', { status: 'error', unavailable: true, success: 10, failed: 1 })
        const active      = file('ready.json', { status: 'active', success: 0, failed: 10 })
        const disabled    = file('disabled.json', { status: 'disabled' })
        const quota       = file('quota.json', { status: 'quota_exceeded', success: 10 })
        const filter      = (statusFilter: string) => sourceCallback<() => AuthFileItem[]>(
            'components/credentials/VendorSection.tsx',
            'filteredAuthFiles',
            {
                typeFilter: 'all',
                data: { authFiles: [unavailable, active, disabled, quota] },
                rawQuery: '',
                statusFilter,
                quotaStatusMap: {},
                filterAuthFiles,
                vendor: { id: 'codex', label: 'Codex' },
                t: (key: string) => key,
            },
        )()
        expect(filter('available')).toEqual([active])
        expect(filter('error')).toEqual([unavailable])
        expect(filter('disabled')).toEqual([disabled])
        expect(filter('exhausted')).toEqual([quota])
    })

    test('counts all eight manual provider families and each OpenAI key on the dashboard', async () => {
        let stats: Record<string, number> | undefined
        const entries    = async () => [{}]
        const fetchStats = sourceCallback<() => Promise<void>>('pages/DashboardPage.tsx', 'fetchStats', {
            apiBase: 'https://fixture.invalid',
            connectionStatus: 'connected',
            pageLayerStatus: 'current',
            apiClient: { getAuthGeneration: () => 1 },
            statsRequestGeneration: { current: 0 },
            setLoading: () => {
            },
            setStats: () => {
            },
            setProviderStats: (value: typeof stats) => {
                stats = value
            },
            apiKeysApi: { list: async () => [] },
            authFilesApi: { list: async () => ({ files: [] }) },
            buildManualKeyCardItems,
            providersApi: {
                getGeminiKeys: entries, getCodexConfigs: entries, getMetaConfigs: entries, getClaudeConfigs: entries,
                getInteractionsKeys: entries, getVertexConfigs: entries, getXAIConfigs: entries,
                getOpenAIProviders: async () => [
                    {
                        name: 'demo',
                        baseUrl: 'https://fixture.invalid',
                        apiKeyEntries: [{ apiKey: 'a' }, { apiKey: 'b' }],
                    },
                ],
            },
        })
        await fetchStats()
        expect(stats).toEqual({
                                  gemini: 1,
                                  codex: 1,
                                  meta: 1,
                                  claude: 1,
                                  openai: 2,
                                  interactions: 1,
                                  vertex: 1,
                                  xai: 1,
                              })
    })

    test('includes the final partial hour of the heatmap and excludes the next bucket', () => {
        const calculate = sourceCallback<(points: unknown[], from: number, to: number) => {
            totalSuccess: number;
            blockDetails: { totalTokens: number }[]
        }>(healthCard, 'calculateServiceHealthFromSummary', {})
        const result    = calculate([
                                        { time: '2026-10-23T11:00:00Z', requests: 1, success: 1, tokens: 14 },
                                        { time: '2026-10-23T12:00:00Z', requests: 2, success: 2, tokens: 99 },
                                    ], Date.parse('2026-10-23T11:00:00Z'), Date.parse('2026-10-23T11:59:00Z'))
        expect(result.totalSuccess).toBe(1)
        expect(result.blockDetails.reduce((sum, block) => sum + block.totalTokens, 0)).toBe(14)
    })

    test('retains thirty-day hourly health history and moves whole cells across hour and day boundaries', () => {
        const hour      = 3600000
        const anchor    = Date.parse('2026-10-23T11:59:30.125Z')
        const initRange = sourceCallback<() => { from: string; to: string; preset: string }>(
            'pages/UsagePage.tsx',
            'initDateRange',
            {
                Date: class extends Date {
                    constructor(value?: number) {
                        super(value ??
                              anchor)
                    }
                },
                DEFAULT_PRESET: sourceInitializer<string>(
                    'pages/UsagePage.tsx',
                    'DEFAULT_PRESET',
                    {},
                ),
            },
        )
        const range     = initRange()
        const from      = Date.parse(range.from)
        const to        = Date.parse(range.to)
        expect(range.preset).toBe('30d')
        expect(range.from).toBe('2026-09-23T11:59:30.125Z')
        expect(range.to).toBe('2026-10-23T11:59:30.125Z')
        const calculate = sourceCallback<(
            points: unknown[], from: number, to: number, granularity?: 'hourly' | 'daily',
        ) => ServiceHealthData>(healthCard, 'calculateServiceHealthFromSummary', {})
        const points    = Array.from({ length: 721 }, (_, index) => ({
            time: new Date(Math.floor(from / hour) * hour + index * hour).toISOString(),
            requests: 1,
            success: 1,
            tokens: index + 1,
        }))
        const history   = calculate(points, from, to)
        expect(history.totalSuccess).toBe(721)
        expect(history.blockDetails).toHaveLength(721)
        expect(history.blockDetails.filter((detail) => detail.success > 0)).toHaveLength(721)
        expect(history.rows).toBe(8)
        expect(history.blockDetails.every((detail) => detail.startTime %
                                                      hour ===
                                                      0 &&
                                                      detail.endTime -
                                                      detail.startTime ===
                                                      hour)).toBe(true)
        const newestIndex = history.blockDetails.findIndex((detail) => detail.totalTokens === 721)
        expect(newestIndex).toBe(history.blockDetails.length - 1)
        expectLatestHealthCellAtBottomRight(history)
        for (const shift of [1, 24]) {
            const shifted = calculate(points, from + shift * hour, to + shift * hour)
            expect(shifted.blockDetails.findIndex((detail) => detail.totalTokens === 721)).toBe(newestIndex - shift)
        }
        expect(calculate(points, from + 20000, to + 20000).blockDetails).toEqual(history.blockDetails)

        const summary           = {
            period: { from: '2026-10-15T15:14:00Z', to: '2026-10-19T00:00:00Z', granularity: 'daily' },
            time_series: [{ time: '2026-10-19T00:00:00Z', requests: 4, success: 3, failure: 1, tokens: 12 }],
        }
        const bucketGranularity = sourceInitializer(healthCard, 'bucketGranularity', { summary, granularity: 'hourly' })
        const daily             = sourceCallback<() => ServiceHealthData>(healthCard, 'healthData', {
            bucketGranularity, summary, fromMs: 0, toMs: 0, calculateServiceHealthFromSummary: calculate,
        })()
        expect(daily.blockDetails).toHaveLength(5)
        expect(daily.blockDetails.map(({ startTime, endTime }) => endTime - startTime)).toEqual(Array(5).fill(24 *
                                                                                                              hour))
        expect(daily).toMatchObject({ totalSuccess: 3, totalFailure: 1 })
        expect(daily.blockDetails[4]).toMatchObject({ totalTokens: 12, startTime: Date.parse('2026-10-19T00:00:00Z') })
        expectLatestHealthCellAtBottomRight(daily)
    })

    test('propagates each active selection and filter clear to summary, live totals and the hourly heatmap', () => {
        const selections        = [
            { selectedModels: ['model-a'], selectedApiKeys: ['synthetic-key'], selectedCredentials: ['credential-a'] },
            { selectedModels: [], selectedApiKeys: ['synthetic-key'], selectedCredentials: ['credential-a'] },
            { selectedModels: [], selectedApiKeys: [], selectedCredentials: ['credential-a'] },
            { selectedModels: [], selectedApiKeys: [], selectedCredentials: [] },
        ]
        const effectiveDateFrom = '2026-09-23T11:59'
        const effectiveDateTo   = '2026-10-23T11:59'
        for (const selection of selections) {
            for (const name of ['summaryParams', 'liveSummaryParams', 'heatmapSummaryParams']) {
                const params = sourceCallback<() => {
                    from: string;
                    to: string;
                    model?: string;
                    api_key?: string[];
                    credential?: string;
                    granularity: string
                }>('pages/UsagePage.tsx', name, {
                    ...selection,
                    effectiveDateFrom,
                    effectiveDateTo,
                    summaryGranularity: 'daily',
                    chartDimension: 'total',
                    liveSummaryRange: { from: '2026-10-23T10:59', to: effectiveDateTo },
                })()
                expect(params.model).toBe(selection.selectedModels.length ?
                                          selection.selectedModels.join(',') :
                                          undefined)
                expect(params.api_key).toEqual(selection.selectedApiKeys.length ? selection.selectedApiKeys : undefined)
                expect(params.credential).toBe(selection.selectedCredentials.length ?
                                               selection.selectedCredentials.join(',') :
                                               undefined)
                if (name === 'heatmapSummaryParams') {
                    expect(params).toMatchObject({
                                                     from: effectiveDateFrom,
                                                     to: effectiveDateTo,
                                                     granularity: 'hourly',
                                                     groups: 'none',
                                                 })
                }
            }
        }
    })

    test('requests the latest heatmap position after data is ready and retains loading and empty states', () => {
        for (const state of
            [{ loading: false, hasData: true }, { loading: true, hasData: true }, { loading: false, hasData: false }]) {
            const scroller = { scrollLeft: 0, scrollWidth: 1600 }
            sourceCallback<() => void>('components/usage/ServiceHealthCard.tsx', 'useLayoutEffect', {
                ...state, gridRef: { current: { parentElement: scroller } },
            }, 'scroller.scrollLeft')()
            expect(scroller.scrollLeft).toBe(!state.loading && state.hasData ? 1600 : 0)
        }
    })

    test('anchors the latest-hour query to now even when the selected range ends tomorrow', async () => {
        const now   = Date.parse('2026-10-23T12:08:35.123Z')
        const range = sourceCallback<() => { from: string; to: string }>('pages/UsagePage.tsx', 'liveSummaryRange', {
            liveWindowAnchorMs: now,
            effectiveDateFrom: '2026-10-22T00:00',
            effectiveDateTo: '2026-10-24T23:59',
        })()
        expect(range).toEqual({ from: new Date(now - 3600000).toISOString(), to: new Date(now).toISOString() })
        let request      = ''
        const getSummary = sourceCallback<(params: object) => Promise<unknown>>('services/api/usage.ts', 'getSummary', {
            localToIsoUtc: sourceCallback('services/api/usage.ts', 'localToIsoUtc', {}),
            appendQueryValues: sourceCallback('services/api/usage.ts', 'appendQueryValues', {}),
            USAGE_TIMEOUT_MS: 60000,
            apiClient: {
                get: async (path: string) => {
                    request = path;
                    return {}
                },
            },
        })
        await getSummary(range)
        const query = new URL(request, 'https://synthetic.invalid').searchParams
        expect(query.get('from')).toBe(range.from)
        expect(query.get('to')).toBe(range.to)
        expect(Date.parse(query.get('to')!) - Date.parse(query.get('from')!)).toBe(3600000)
    })

    test('passes precise live totals through the token breakdown consumer', () => {
        const liveSummary = { totals: { tokens: { total: 1300 } } }
        const component   = sourceCallback<(props: object) => {
            props: { children: { props: { liveSummary: unknown } } }
        }>('components/usage/TokenBreakdownChart.tsx', 'TokenBreakdownChart', {
            React: { createElement },
            useTranslation: () => ({ t: (key: string) => key }),
            Card: 'section',
            UnifiedTrendChart: 'trend',
        })
        const tree        = component({ summary: { time_series: [] }, liveSummary, loading: false, isMobile: false })
        expect(tree.props.children.props.liveSummary).toBe(liveSummary)
        const values = sourceCallback<() => { live: string }>(
            'components/usage/UnifiedTrendChart.tsx',
            'summaryValues',
            {
                summary: {
                    time_series: [
                        {
                            time: '2026-10-22T00:00:00Z',
                            tokens: 100000,
                        },
                    ],
                },
                liveSummary,
                metric: 'token_breakdown',
                formatCompactNumber,
                formatUsd: String,
            },
        )()
        expect(values.live).toBe(formatCompactNumber(1300))
    })

    test('keeps live values unavailable until their own summary arrives and preserves authoritative zeros', () => {
        const summary = {
            totals: { requests: 100, tokens: { total: 900 }, cost: 0.213625 },
            time_series: [
                {
                    time: new Date(Date.now() + 3600000).toISOString(),
                    requests: 700,
                    tokens: 10000,
                    cost: 5.5,
                },
            ],
        }
        for (const metric of ['requests', 'tokens', 'cost', 'token_breakdown']) {
            const values = (liveSummary: unknown) => sourceCallback<() => { total: string; live: string }>(
                'components/usage/UnifiedTrendChart.tsx',
                'summaryValues',
                {
                    summary, liveSummary, metric, formatCompactNumber, formatUsd,
                },
            )()
            const total  = metric === 'cost' ? formatUsd(0.213625) : metric === 'requests' ? '100' : '900'
            expect(values(null)).toEqual({ total, live: '--' })
            expect(values(undefined)).toEqual({ total, live: '--' })
            const live = { totals: { requests: 0, tokens: { total: 0 }, cost: 0 } }
            expect(values(live)).toEqual({ total, live: metric === 'cost' ? formatUsd(0) : formatCompactNumber(0) })
        }
    })

    test('uses the chosen timezone on chart labels and aliases only the API-key legend', () => {
        const previous = useTimezoneStore.getState().timezone
        try {
            useTimezoneStore.setState({ timezone: 'Asia/Tokyo' })
            const point   = { time: '2026-10-23T10:00:00Z', requests: 2 }
            const summary = {
                time_series: [point],
                time_series_by_api_key: { 'synthetic-key': [point] },
            } as unknown as UsageSummary
            const chart   = buildChartDataFromSummary(summary, 'requests', 'api_key', { 'synthetic-key': 'My key' })
            expect(chart.labels).toEqual(['10-23 19:00'])
            expect(chart.datasets[0]?.label).toBe('My key')
            expect(chart.datasets[0]?.data).toEqual([2])
        } finally {
            useTimezoneStore.setState({ timezone: previous })
        }
    })

    test('renders distinct total-metric line colors while preserving grouped-series colors and exact values', () => {
        const point   = { time: '2026-10-23T10:00:00Z', requests: 2, tokens: 17, cost: 0.0003683 }
        const summary = {
            time_series: [point],
            time_series_by_model: { first: [point], second: [point] },
        } as unknown as UsageSummary
        const metrics = ['requests', 'tokens', 'cost'] as const
        const colors  = ['#0891b2', '#8b5cf6', '#b45309']
        const values  = [2, 17, 0.0003683]
        for (const [index, metric] of metrics.entries()) {
            const chartData = sourceCallback<() => ReturnType<typeof buildChartDataFromSummary>>(
                'components/usage/UnifiedTrendChart.tsx',
                'chartData',
                {
                    summary,
                    metric,
                    chartDimension: 'total',
                    aliases: undefined,
                    timezone: 'UTC',
                    buildChartDataFromSummary, summaryToApiKeyStats,
                },
            )()
            const visible   = sourceCallback<() => typeof chartData>(
                'components/usage/UnifiedTrendChart.tsx',
                'visibleChartData',
                {
                    chartData,
                    hiddenSeries: new Set<string>(),
                    metric,
                },
            )()
            expect(visible.datasets[0]).toMatchObject({
                                                          borderColor: colors[index],
                                                          pointBackgroundColor: colors[index],
                                                          pointBorderColor: colors[index],
                                                          data: [values[index]],
                                                          hidden: false,
                                                      })
            expect(buildChartDataFromSummary(summary, metric, 'model').datasets.map((dataset) => dataset.borderColor))
                .toEqual(['#8b8680', '#10b981'])
        }
    })

    test('formats eleven small cost-axis ticks with eleven distinct labels', () => {
        const options = sourceCallback<() => {
            scales: { y: { ticks: { callback: (value: number, index: number, ticks: { value: number }[]) => string } } }
        }>('components/usage/UnifiedTrendChart.tsx', 'chartOptions', {
            // noinspection JSUnusedGlobalSymbols
            'buildChartOptions': () => ({}),
            period: 'hour',
            chartData: { labels: [] },
            isMobile: false,
            metric: 'cost',
            i18n: { language: 'en' },
        })()
        const ticks   = Array.from({ length: 11 }, (_, index) => ({ value: index * 0.002 }))
        const labels  = ticks.map((tick, index) => options.scales.y.ticks.callback(tick.value, index, ticks))
        expect(new Set(labels).size).toBe(11)
        expect(labels[1]).toContain('0.002')
    })
})

test('database size failures stay visible without becoming zero bytes and clear on recovery', async () => {
    let dbSize: number | null          = 100
    const errors: Array<string | null> = []
    let fail                           = true
    const load                         = sourceCallback<() => Promise<void>>(
        'components/usage/UsageRetentionCard.tsx',
        'loadRetention',
        {
            setLoading: () => {
            },
            setLoadError: (value: string | null) => {
                errors.push(value)
            },
            usageApi: {
                getRetention: async () => ({ days: 30 }),
                getDBSize: async () => {
                    if (fail) {
                        throw new Error('size unavailable')
                    }
                    return { size_bytes: 581370 }
                },
            },
            setRetention: () => {
            },
            setDraft: () => {
            },
            toDraft: () => ({}),
            t: (key: string) => key,
            setDbSize: (value: number | null) => {
                dbSize = value
            },
            setDbMaxSize: () => {
            },
            setDbSizeWarning: () => {
            },
            setDbSizeCapped: () => {
            },
        },
    )
    await load()
    expect(dbSize).toBeNull()
    expect(errors[errors.length - 1]).toBe('notification.load_failed: size unavailable')
    fail = false
    await load()
    expect(dbSize).toBe(581370)
    expect(errors[errors.length - 1]).toBeNull()
})
