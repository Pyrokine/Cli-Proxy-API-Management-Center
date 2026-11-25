import {Button} from '@/components/ui/Button'
import {usageSummaryRequestKey} from '@/components/usage/hooks/useUsageSummary'
import {ModelStatsCard} from '@/components/usage/ModelStatsCard'
import {apiClient} from '@/services/api/client'
import {type SummaryApiKeyStats, usageApi, type UsageSummary} from '@/services/api/usage'
import {buildChartDataFromSummary} from '@/utils/usage'
import {summaryToApiKeyStats} from '@/utils/usage/summaryHelpers'
import {expect, spyOn, test} from 'bun:test'
import {readFileSync} from 'node:fs'
import React, {type ReactElement, type ReactNode} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {compile} from 'sass'
import ts from 'typescript'
import {sourceCallback, sourceExpression, sourceInitializer} from './sourceCallbacks'

const styles                   = new Proxy<Record<string, string>>({}, { get: (_target, key) => String(key) })
const noop                     = () => {
}
const eventFile                = 'components/usage/RequestEventsDetailsCard.tsx'
const chartFile                = 'components/usage/UnifiedTrendChart.tsx'
const t                        = (key: string) => key
const firstId                  = `sha256:${'1'.repeat(64)}`
const secondId                 = `sha256:${'2'.repeat(64)}`
const stat: SummaryApiKeyStats = {
    requests: 1, success: 1, failure: 0, cost: 0,
    tokens: { input: 2, output: 1, cached: 0, reasoning: 0, total: 3 },
}

function usageSummary(overrides: Partial<UsageSummary>): UsageSummary {
    return {
        period: { from: '2026-11-01T00:00:00Z', to: '2026-11-02T00:00:00Z' },
        totals: { ...stat }, by_model: {}, by_credential: {}, by_api_key: {},
        time_series: [], time_series_by_model: {}, time_series_by_credential: {}, time_series_by_api_key: {},
        ...overrides,
    }
}

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
    if (Array.isArray(node)) {
        return node.flatMap(elements)
    }
    if (!React.isValidElement<Record<string, unknown>>(node)) {
        return []
    }
    return [node, ...elements(node.props.children as ReactNode)]
}

function chart(summary: UsageSummary) {
    return sourceCallback<() => ReturnType<typeof buildChartDataFromSummary>>(chartFile, 'chartData', {
        summary, metric: 'requests', chartDimension: 'api_key', aliases: {}, timezone: 'UTC',
        buildChartDataFromSummary, summaryToApiKeyStats,
    })()
}

test('every usage summary path requests canonical identities and uses a distinct cache signature', async () => {
    const scope = {
        effectiveDateFrom: '2026-11-01T00:00', effectiveDateTo: '2026-11-02T00:00',
        summaryGranularity: 'hourly', chartDimension: 'total', selectedModels: ['model'],
        selectedApiKeys: [firstId], selectedCredentials: ['credential'],
        liveSummaryRange: { from: '2026-11-01T01:00:00Z', to: '2026-11-01T02:00:00Z' },
    }
    const get   = spyOn(apiClient, 'get').mockResolvedValue({})
    try {
        for (const name of ['summaryParams', 'liveSummaryParams', 'filterOptionsParams', 'heatmapSummaryParams']) {
            const params = sourceCallback<() => Parameters<typeof usageApi.getSummary>[0]>(
                'pages/UsagePage.tsx', name, scope,
            )()!
            expect(params.api_key_identity).toBe('canonical')
            expect(usageSummaryRequestKey(params)).not.toBe(usageSummaryRequestKey({
                                                                                       ...params,
                                                                                       api_key_identity: undefined,
                                                                                   }))
            const controller = new AbortController()
            await usageApi.getSummary(params, { signal: controller.signal })
            const [path, options] = get.mock.calls[get.mock.calls.length - 1]
            const query           = new URL(String(path), 'https://fixture.invalid').searchParams
            expect(query.get('api_key_identity')).toBe('canonical')
            expect(options?.signal).toBe(controller.signal)
            if (name !== 'filterOptionsParams') {
                expect(query.getAll('api_key')).toEqual([firstId])
            }
        }
        await usageApi.getSummary()
        expect(get.mock.calls[get.mock.calls.length - 1][0]).toBe('/usage/summary')
    } finally {
        get.mockRestore()
    }
})

test(
    'canonical identity mode follows NULL-key filters through events, detail exports, earliest lookup and backup export',
    async () => {
        const get    = spyOn(apiClient, 'get').mockResolvedValue({ events: [] })
        const getRaw = spyOn(apiClient, 'getRaw').mockResolvedValue({ data: new Blob(['backup']), headers: {} } as
                                                                        Awaited<ReturnType<typeof apiClient.getRaw>>)
        const scope  = {
            page: 2,
            pageSize: 50,
            sortField: 'timestampMs',
            sortDir: 'desc',
            effectiveDateRange: { from: '', to: '' },
            topModels: [],
            topCredentials: [],
            topApiKeys: ['(none)', firstId],
            searchQuery: '',
            statusFilter: '',
            speedFilter: '',
            USAGE_EVENT_EXPORT_PAGE_SIZE: 500,
            applyFilters: sourceCallback(eventFile, 'applyFilters', {}),
            toBackendSortField: sourceCallback(eventFile, 'toBackendSortField', {}),
        }
        try {
            const params       = sourceCallback<() => Parameters<typeof usageApi.getEvents>[0]>(
                eventFile,
                'eventsParams',
                scope,
            )()!
            const detailExport = sourceCallback<(page: number) => Parameters<typeof usageApi.getEvents>[0]>(
                eventFile, 'buildExportParams', scope,
            )(1)!
            for (const request of [params, { ...detailExport, export: true }]) {
                expect(request).toMatchObject({ api_key_identity: 'canonical', api_key: ['(none)', firstId] })
                await usageApi.getEvents(request)
                const query = new URL(
                    String(get.mock.calls[get.mock.calls.length - 1][0]),
                    'https://fixture.invalid',
                ).searchParams
                expect(query.get('api_key_identity')).toBe('canonical')
                expect(query.getAll('api_key')).toEqual(['(none)', firstId])
            }
            const earliest = sourceExpression<Parameters<typeof usageApi.getEvents>[0]>(
                'pages/UsagePage.tsx',
                (node, tree) =>
                    ts.isObjectLiteralExpression(node) &&
                    ts.isCallExpression(node.parent) &&
                    node.parent.expression.getText(tree).replace(
                        /\s+/g,
                        '',
                    ) ===
                    'usageApi.getEvents',
                {
                    ALL_PRESET_PLACEHOLDER_FROM: '2020-01-01T00:00',
                    effectiveDateTo: '',
                    selectedModels: [],
                    selectedCredentials: [],
                    selectedApiKeys: ['(none)'],
                },
            )!
            expect(earliest).toMatchObject({ api_key_identity: 'canonical', api_key: ['(none)'], page_size: 1 })
            await usageApi.getEvents(earliest)
            expect(String(get.mock.calls[get.mock.calls.length - 1][0])).toContain('api_key_identity=canonical')
            let backupRequest: Promise<void> | undefined
            const handleExport = sourceInitializer<(filters: object) => void>(
                'components/usage/hooks/useUsageData.ts',
                'handleExport',
                {
                    usageApi,
                    apiClient,
                    requestBackupPassword: ({ onConfirm }: { onConfirm: (password: string) => Promise<void> }) => {
                        backupRequest = onConfirm('fixture-password')
                    },
                    exportControllerRef: { current: null },
                    setExporting: noop,
                    downloadBlob: noop,
                    showNotification: noop,
                    t,
                },
            )
            const backup       = sourceExpression<() => Promise<void>>('pages/UsagePage.tsx', (node, tree) =>
                ts.isArrowFunction(node) && ts.isJsxExpression(node.parent) && ts.isJsxAttribute(node.parent.parent) &&
                node.parent.parent.name.getText(tree) === 'onExport', {
                                                                           handleExport,
                                                                           visibleDateRange: { from: '', to: '' },
                                                                           selectedModels: [],
                                                                           selectedApiKeys: ['(none)', firstId],
                                                                           selectedCredentials: [],
                                                                           activeTab: 'events',
                                                                           selectedEventSpeed: '',
                                                                       })
            backup()
            await backupRequest
            const query = new URL(String(getRaw.mock.calls[0][0]), 'https://fixture.invalid').searchParams
            expect(query.get('api_key_identity')).toBe('canonical')
            expect(query.getAll('api_key')).toEqual(['(none)', firstId])
            await usageApi.getEvents({ api_key: ['(none)'] })
            expect(String(get.mock.calls[get.mock.calls.length - 1][0])).not.toContain('api_key_identity')
        } finally {
            get.mockRestore();
            getRaw.mockRestore()
        }
    },
)

test('API key labels prefer explicit aliases while row and filter identities remain independent', () => {
    const summary = usageSummary({
                                     by_api_key: {
                                         [firstId]: { ...stat, alias: 'Operator name', display_name: 'sk...78' },
                                         [secondId]: { ...stat, alias: 'Operator name', display_name: 'sk...78' },
                                         '(none)': stat,
                                     },
                                 })
    const aliases = { [firstId]: 'Outdated name', 'sk-a...cd78': 'Unrelated name' }
    const rows    = summaryToApiKeyStats(summary.by_api_key, aliases)
    expect(rows.map((row) => row.key)).toEqual([firstId, secondId, '(none)'])
    expect(rows.slice(0, 2).map((row) => row.model)).toEqual(['Operator name', 'Operator name'])
    const options = sourceCallback<() => { value: string; label: string }[]>(
        'components/usage/FilterBar.tsx',
        'apiKeyOptions',
        {
            summary,
            optionsSummary: null,
            aliases,
            summaryToApiKeyStats,
            NONE_API_KEY_SENTINEL: '(none)',
            t,
        },
    )()
    expect(options.filter((option) => option.label === 'Operator name').map((option) => option.value))
        .toEqual([firstId, secondId])
    expect(options.find((option) => option.value === '(none)')?.label).toBe('usage_stats.filter_api_key_none')
    const rowKey = sourceExpression<(row: { key?: string; model: string }) => string>(
        'components/usage/ModelStatsCard.tsx', (node, tree) => ts.isArrowFunction(node) &&
                                                               ts.isJsxExpression(node.parent) &&
                                                               ts.isJsxAttribute(node.parent.parent) &&
                                                               node.parent.parent.name.getText(tree) ===
                                                               'rowKey', {},
    )
    expect(rowKey(rows[0])).toBe(firstId)
    expect(rowKey(rows[1])).toBe(secondId)
    expect(summaryToApiKeyStats({ 'sk...78': stat }, aliases)[0].model).toBe('sk...78')
    expect(summaryToApiKeyStats({ [firstId]: { ...stat, display_name: 'sk...78' } }, aliases)[0].model).toBe(
        'Outdated name')
    expect(summaryToApiKeyStats({ [firstId]: { ...stat, display_name: 'sk...78' } })[0].model).toBe('sk...78')
    expect(summaryToApiKeyStats({ 'synthetic-raw-client-secret': stat })[0].model).not.toContain('raw-client-secret')
})

test(
    'credential chart labels use exact source aliases without replacing the series identity or guessing mask ordinals',
    () => {
        const point     = { ...stat, time: '2026-11-01T01:00:00Z', has_cost: false }
        const key       = 'codex:abcd...wxyz [api_key]'
        const ambiguous = 'claude:sk-a...cd78 [api_key]'
        const summary   = usageSummary({
                                           by_credential: {
                                               [key]: {
                                                   provider: 'codex',
                                                   source: 'abcd...wxyz',
                                                   success: 1,
                                                   failure: 0,
                                               },
                                               [ambiguous]: {
                                                   provider: 'claude',
                                                   source: 'sk-a...cd78',
                                                   success: 1,
                                                   failure: 0,
                                               },
                                           }, time_series_by_credential: { [key]: [point], [ambiguous]: [point] },
                                       })
        const data      = buildChartDataFromSummary(summary, 'requests', 'credential', {
            'abcd...wxyz': 'Friendly credential', 'sk-a...cd78#1': 'First key', 'sk-a...cd78#2': 'Other key',
        })
        expect(data.datasets[0]).toMatchObject({ id: key, label: 'codex: Friendly credential', data: [1] })
        expect(data.datasets[1]).toMatchObject({ id: ambiguous, label: ambiguous, data: [1] })
    },
)

test('equal aliases remain distinct chart datasets, legend actions and Chart.js identities', () => {
    const point   = { ...stat, time: '2026-11-01T01:00:00Z', has_cost: false }
    const summary = usageSummary({
                                     by_api_key: {
                                         [firstId]: { ...stat, alias: 'Same alias' },
                                         [secondId]: { ...stat, alias: 'Same alias' },
                                     },
                                     time_series_by_api_key: {
                                         [firstId]: [point],
                                         [secondId]: [{ ...point, requests: 9 }],
                                     },
                                 })
    const data    = chart(summary)
    expect(data.datasets.map((dataset) => dataset.label)).toEqual(['Same alias', 'Same alias'])
    expect(new Set(data.datasets.map((dataset) => dataset.id)).size).toBe(2)
    expect(data.datasets.flatMap((dataset) => dataset.data).sort()).toEqual([1, 9])
    let hidden   = new Set<string>()
    const toggle = sourceCallback<(key: string) => void>(chartFile, 'toggleDataset', {
        setHiddenSeries: (update: (value: Set<string>) => Set<string>) => {
            hidden = update(hidden)
        },
    })
    toggle(firstId)
    const visible = sourceCallback<() => { datasets: { id: string; hidden: boolean }[] }>(
        chartFile,
        'visibleChartData',
        {
            chartData: data,
            hiddenSeries: hidden,
            metric: 'requests',
        },
    )()
    expect(visible.datasets.find((dataset) => dataset.id === firstId)?.hidden).toBe(true)
    expect(visible.datasets.find((dataset) => dataset.id === secondId)?.hidden).toBe(false)
    toggle(firstId)
    expect(hidden.size).toBe(0)
    const line = sourceExpression<ReactElement<Record<string, unknown>>>(chartFile, (node, tree) =>
        ts.isJsxSelfClosingElement(node) && node.tagName.getText(tree) === 'Line', {
                                                                             React,
                                                                             Line: noop,
                                                                             visibleChartData: visible,
                                                                             chartOptions: {},
                                                                         })
    expect(line.props.datasetIdKey).toBe('id')
})

test('statistics preserve all rows inside a bounded scroll area and cards cannot shrink over the next card', () => {
    const rows = Array.from({ length: 80 }, (_, index) => ({
        ...stat, key: `model-${index}`, model: `Model ${index}`,
        successCount: 1, failureCount: 0, tokens: 3, averageLatencyMs: null, latencySampleCount: 0,
    }))
    const html = renderToStaticMarkup(<ModelStatsCard modelStats={rows} loading={false} hasPrices={false} />)
    expect((html.match(/Model \d+/g) ?? [])).toHaveLength(80)
    for (const file of ['ModelStatsCard.tsx', 'CredentialStatsCard.tsx']) {
        const binding = sourceExpression<string>(`components/usage/${file}`, (node, tree) =>
            ts.isPropertyAccessExpression(node) && node.getText(tree) === 'styles.statsTableWrapper' &&
            ts.isJsxExpression(node.parent) && ts.isJsxAttribute(node.parent.parent) &&
            node.parent.parent.name.getText(tree) === 'tableWrapClassName', { styles })
        expect(binding).toBe('statsTableWrapper')
    }
    const css = compile(new URL('../src/pages/UsagePage.module.scss', import.meta.url).pathname).css
    expect(css.match(/\.detailsFixedCard\s*\{([^}]+)}/)?.[1]).toContain('flex: 0 0 auto')
    const scroll = css.match(/\.statsTableWrapper\s*\{([^}]+)}/)?.[1] ?? ''
    expect(scroll).toContain('max-height: 28rem')
    expect(scroll).toContain('overflow: auto')
    expect(css).toContain('position: sticky')
    const filters  = compile(new URL('../src/components/usage/FilterBar.module.scss', import.meta.url).pathname).css
    const criteria = filters.match(/\.criteriaFilters\s*\{([^}]+)}/)?.[1] ?? ''
    expect(criteria).toContain('display: flex')
    expect(criteria).toContain('flex-wrap: wrap')
    expect(criteria).not.toContain('grid-template-columns')
})

test('changing page, filters, page size or explicit refresh closes the previous inline detail', () => {
    const source = readFileSync(new URL(`../src/${eventFile}`, import.meta.url), 'utf8')
    const tree   = ts.createSourceFile(eventFile, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    let reset    = ''
    const visit  = (node: ts.Node) => {
        if (ts.isIfStatement(node) &&
            node.expression.getText(tree) ===
            'previousDetailsSignature !== eventsRequestSignature') {
            reset = node.getText(tree)
        }
        ts.forEachChild(node, visit)
    }
    visit(tree)
    expect(reset).not.toBe('')
    const base = { page: 1, page_size: 50, api_key: [firstId] }
    for (const [params, refreshToken] of [
        [{ ...base, page: 2 }, 0], [{ ...base, page_size: 100 }, 0], [{ ...base, api_key: [secondId] }, 0], [base, 1],
    ] as const) {
        const before          = JSON.stringify([base, 0])
        const after           = JSON.stringify([params, refreshToken])
        let current           = before
        let selected: unknown = { id: 'previous' }
        new Function(
            'previousDetailsSignature',
            'eventsRequestSignature',
            'setPreviousDetailsSignature',
            'setRequestDetails',
            reset,
        )(
            before, after, (value: string) => {
                current = value
            }, (value: unknown) => {
                selected = value
            },
        )
        expect(current).toBe(after)
        expect(selected).toBeNull()
    }
})

test('request log actions stay available within row details and retain their node and observation arguments', () => {
    const calls: unknown[][] = []
    const render             = sourceCallback<(row: object) => ReactElement>(eventFile, 'renderRequestLog', {
        React, styles, Button, t, notRecordedLabel: 'Not recorded', missingMetadataTitle: 'Historical event',
        requestLogStateLabel: sourceCallback(eventFile, 'requestLogStateLabel', {}),
        requestLogPreviewing: new Set(), requestLogDownloading: new Set(),
        previewRequestLog: (...args: unknown[]) => {
            calls.push(args)
        },
        downloadRequestLog: (...args: unknown[]) => {
            calls.push(args)
        },
    })
    const row                = {
        requestId: 'synthetic-request',
        requestLogState: 'available',
        requestLogHomeIp: '192.0.2.1',
    }
    const buttons            = elements(render(row)).filter((element) => element.type === Button)
    expect(buttons).toHaveLength(2)
    for (const button of buttons) {
        (button.props.onClick as () => void)()
    }
    expect(calls).toEqual([[row.requestId, row.requestLogHomeIp, row], [row.requestId, row.requestLogHomeIp]])
    expect(elements(render({ ...row, requestLogState: 'not_captured' })).some((element) => element.type === Button))
        .toBe(false)
    expect(renderToStaticMarkup(render({ ...row, requestId: '' }))).toContain('Not recorded')
})
