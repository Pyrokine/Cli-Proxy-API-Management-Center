import {Button} from '@/components/ui/Button'
import type {UsageEvent} from '@/services/api/usage'
import {formatDateTime, formatNumber} from '@/utils/format'
import {
    extractLatencyMs,
    formatDurationMs,
    formatThinkingLabel,
    isNoThinkingUsage,
    normalizeUsageThinking,
    resolveUsageTokenMetrics,
} from '@/utils/usage'
import {expect, test} from 'bun:test'
import {readFileSync} from 'node:fs'
import React, {type ReactElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {compile} from 'sass'
import ts from 'typescript'
import {sourceCallback, sourceExpression, sourceInitializer} from './sourceCallbacks'

const noop      = () => {
}
const file      = 'components/usage/RequestEventsDetailsCard.tsx'
const usagePage = 'pages/UsagePage.tsx'
type AllRangeResolution = { key: string; from?: string; error?: string } | null

function allRangeEffect(scope: Record<string, unknown>) {
    return sourceCallback<() => (() => void) | undefined>(usagePage, 'useEffect', {
        isAllPreset: true, usageStatsTabActive: true, t: (key: string) => key,
        ALL_PRESET_PLACEHOLDER_FROM: sourceInitializer<string>(usagePage, 'ALL_PRESET_PLACEHOLDER_FROM', {}),
        ...scope,
    }, 'void usageApi')()
}

function resolvedAll(allSummaryResolution: AllRangeResolution, allSummaryResolutionKey: string) {
    return sourceInitializer<AllRangeResolution>(usagePage, 'resolvedAll', {
        isAllPreset: true, allSummaryResolution, allSummaryResolutionKey,
    })
}

test('all-range summary failures expose an error, release loading and recover on an explicit retry', async () => {
    let resolution: AllRangeResolution = null
    let fail                           = true
    let requests                       = 0
    let summaryRefreshToken            = 0
    const effectiveDateTo              = '2026-10-23T20:00:00.000Z'
    const filters                      = {
        effectiveDateTo,
        selectedModels: [],
        selectedCredentials: [],
        selectedApiKeys: [],
    }
    const key                          = () => sourceInitializer<string>(
        usagePage,
        'allSummaryResolutionKey',
        { ...filters, summaryRefreshToken },
    )
    const scope                        = {
        ...filters,
        setAllSummaryResolution: (result: AllRangeResolution) => {
            resolution = result
        },
        usageApi: {
            getEvents: async () => {
                requests++
                if (fail) {
                    throw new Error('Synthetic earliest-event failure')
                }
                return { events: [{ timestamp: '2026-10-22T10:00:00Z' }], total: 1 }
            },
        },
    }
    const cleanup                      = allRangeEffect({ ...scope, allSummaryResolutionKey: key() })
    for (let i = 0; i < 3; i++) {
        await Promise.resolve()
    }
    const result = resolvedAll(resolution, key())
    expect(result).toEqual({ key: key(), error: 'Synthetic earliest-event failure' })
    expect(sourceInitializer<boolean>(usagePage, 'rangeResolutionLoading', {
        isAllPreset: true, resolvedAll: result,
    })).toBe(false)
    expect(sourceInitializer<boolean>(usagePage, 'effectiveRangeReady', {
        isAllPreset: true, resolvedAll: result,
    })).toBe(false)
    const rangeError = sourceInitializer<string>(usagePage, 'rangeResolutionError', { resolvedAll: result })
    const refresh    = sourceCallback<() => void>(usagePage, 'handleRefresh', {
        activeTab: 'overview', needsRawUsage: false, setDateRange: noop, setLiveWindowAnchorMs: noop,
        setSummaryRefreshToken: (update: (value: number) => number) => {
            summaryRefreshToken = update(summaryRefreshToken)
        },
    })
    const errorView  = sourceExpression<ReactElement>(
        'pages/UsagePage.tsx',
        (node, tree) => ts.isBinaryExpression(node) &&
                        node.left.getText(tree) ===
                        'rangeResolutionError' &&
                        ts.isJsxElement(node.right),
        {
            React,
            styles: {},
            rangeResolutionError: rangeError,
            t: (key: string) => key,
            handleRefresh: refresh,
        },
    )
    const html       = renderToStaticMarkup(errorView)
    expect(html).toContain('role="alert"')
    expect(html).toContain('Synthetic earliest-event failure')
    expect(html).toContain('common.retry')
    cleanup?.()
    fail = false
    refresh()
    expect(summaryRefreshToken).toBe(1)
    expect(resolvedAll(resolution, key())).toBeNull()
    const recovered = allRangeEffect({ ...scope, allSummaryResolutionKey: key() })
    for (let i = 0; i < 3; i++) {
        await Promise.resolve()
    }
    expect(resolvedAll(resolution, key())).toEqual({ key: key(), from: '2026-10-22T10:00:00Z' })
    expect(requests).toBe(2)
    recovered?.()
})

test('live-summary failure exposes retry and preserves range totals until an authoritative recovery', async () => {
    const mainSummary        = { totals: { requests: 100 }, time_series: [] }
    let liveSummary: unknown = null
    let liveSummaryError     = ''
    let loading              = false
    let fail                 = true
    let requests             = 0
    let token                = 0
    const reload             = sourceCallback<() => Promise<unknown>>(
        'components/usage/hooks/useUsageSummary.ts',
        'reload',
        {
            enabled: true,
            params: {
                from: '2026-10-23T10:08',
                to: '2026-10-23T11:08',
                granularity: 'hourly',
            },
            inflightRef: { current: null },
            setLoading: (value: boolean) => {
                loading = value
            },
            setError: (value: string) => {
                liveSummaryError = value
            },
            // noinspection JSUnusedGlobalSymbols
            'setSummary': (value: unknown) => {
                liveSummary = value
            },
            usageApi: {
                getSummary: async () => {
                    requests++
                    if (fail) {
                        throw new Error('Synthetic live-summary failure')
                    }
                    return { totals: { requests: 0 } }
                },
            },
        },
    )
    const loadLive           = async (refreshToken: number) => {
        const options = sourceExpression<{ enabled: boolean; refreshToken: number }>(usagePage, (node, tree) =>
            ts.isCallExpression(node) && node.expression.getText(tree) === 'useUsageSummary' &&
            node.arguments[0]?.getText(tree) === 'liveSummaryParams', {
                                                                                         usageStatsTabActive: true,
                                                                                         effectiveRangeReady: true,
                                                                                         reuseSummaryForLive: false,
                                                                                         summaryRefreshToken: refreshToken,
                                                                                         liveSummaryParams: {},
                                                                                         useUsageSummary: (
                                                                                             _params: unknown,
                                                                                             options: unknown,
                                                                                         ) => options,
                                                                                     })
        expect(options).toEqual({ enabled: true, refreshToken })
        let pending: Promise<unknown> | undefined
        sourceExpression('components/usage/hooks/useUsageSummary.ts', (node, tree) =>
            ts.isCallExpression(node) && node.expression.getText(tree) === 'useEffect' &&
            node.arguments[0]?.getText(tree).includes('queueMicrotask('), {
                             ...options,
                             useEffect: (effect: () => void, dependencies: unknown[]) => {
                                 expect(dependencies).toContain(refreshToken)
                                 effect()
                             },
                             reload: () => {
                                 pending = reload()
                             },
                         })
        await Promise.resolve()
        expect(pending).toBeDefined()
        await pending
    }
    await loadLive(0)
    expect(loading).toBe(false)
    expect(liveSummary).toBeNull()
    expect(liveSummaryError).toBe('Synthetic live-summary failure')
    const refresh = sourceCallback<() => void>(usagePage, 'handleRefresh', {
        activeTab: 'overview', setLiveWindowAnchorMs: noop,
        setDateRange: noop, setSummaryRefreshToken: (update: (value: number) => number) => {
            token = update(token)
        },
        setEventsRefreshToken: noop, needsRawUsage: false, loadUsage: noop,
    })
    const view    = sourceExpression<ReactElement>('pages/UsagePage.tsx', (node, tree) =>
        ts.isBinaryExpression(node) &&
        node.left.getText(tree).includes('liveSummaryError') &&
        ts.isJsxElement(node.right), {
                                                       React,
                                                       styles: {},
                                                       liveSummaryError,
                                                       reuseSummaryForLive: false,
                                                       t: (key: string) => key,
                                                       handleRefresh: refresh,
                                                   })
    const html    = renderToStaticMarkup(view)
    expect(html).toContain('role="alert"')
    expect(html).toContain('Synthetic live-summary failure')
    expect(html).toContain('common.retry')
    const values = () => sourceCallback<() => { total: string; live: string }>(
        'components/usage/UnifiedTrendChart.tsx',
        'summaryValues',
        {
            summary: mainSummary,
            liveSummary,
            metric: 'requests',
            formatCompactNumber: String,
            formatUsd: String,
        },
    )()
    expect(values()).toEqual({ total: '100', live: '--' })
    fail = false
    refresh()
    expect(token).toBe(1)
    await loadLive(token)
    expect(requests).toBe(2)
    expect(liveSummaryError).toBe('')
    expect(loading).toBe(false)
    expect(values()).toEqual({ total: '100', live: '0' })
})

test('all-range retry schedules summary reload before deferred React state updaters execute', () => {
    let reload                                         = 0
    const deferred: Array<(value: unknown) => unknown> = []
    const refresh                                      = sourceCallback<() => void>(
        'pages/UsagePage.tsx',
        'handleRefresh',
        {
            dateRange: { preset: 'all' },
            activeTab: 'overview',
            setLiveWindowAnchorMs: noop,
            setDateRange: (updater: (value: unknown) => unknown) => deferred.push(updater),
            setSummaryRefreshToken: (update: (value: number) => number) => {
                reload = update(reload)
            },
            setEventsRefreshToken: noop,
            needsRawUsage: false,
            loadUsage: noop,
        },
    )
    refresh()
    expect(reload).toBe(1)
    expect(deferred).toHaveLength(1)
})

test('all-range selection and sequential filter clearing replace the resolved earliest event', async () => {
    const to     = '2026-10-23T09:00:00.000Z'
    let range    = { from: '2026-10-22T09:00:00.000Z', to, preset: '24h' }
    const select = sourceCallback<(from: string, to: string, preset: string) => void>(
        usagePage, 'handleDateRangeChange', {
            setDateRange: (value: typeof range) => {
                range = value
            },
        },
    )
    select('', to, 'all')
    expect(range).toEqual({ from: '', to, preset: 'all' })
    let resolution: AllRangeResolution = { key: 'previous-window', from: '2026-10-22T09:00:00Z' }
    for (const [selectedModels, selectedApiKeys, selectedCredentials, timestamp] of [
        [['model'], ['client-key'], ['credential'], '2026-10-20T00:00:00.123456789Z'],
        [[], ['client-key'], ['credential'], '2026-10-18T00:00:00Z'],
        [[], [], ['credential'], '2026-10-15T00:00:00Z'],
        [[], [], [], '2019-10-01T00:00:00Z'],
    ] as const) {
        const selection = { selectedModels, selectedApiKeys, selectedCredentials, effectiveDateTo: range.to }
        const key       = sourceInitializer<string>(
            usagePage,
            'allSummaryResolutionKey',
            { ...selection, summaryRefreshToken: 0 },
        )
        expect(resolvedAll(resolution, key)).toBeNull()
        let query: Record<string, unknown> | undefined
        const cleanup = allRangeEffect({
                                           ...selection, allSummaryResolutionKey: key,
                                           setAllSummaryResolution: (result: AllRangeResolution) => {
                                               resolution = result
                                           },
                                           usageApi: {
                                               getEvents: async (params: Record<string, unknown>) => {
                                                   query = params
                                                   return { events: [{ timestamp }], total: 1 }
                                               },
                                           },
                                       })
        await Promise.resolve()
        expect(query).toMatchObject({
                                        from: '1677-09-21T00:12:43.145224192Z', to, order: 'asc', sort: 'timestamp',
                                        page: 1, page_size: 1, api_key_identity: 'canonical', view: 'compact',
                                    })
        expect(query?.model).toBe(selectedModels.length ? selectedModels.join(',') : undefined)
        expect(query?.api_key).toEqual(selectedApiKeys.length ? selectedApiKeys : undefined)
        expect(query?.source).toBe(selectedCredentials.length ? selectedCredentials.join(',') : undefined)
        const result = resolvedAll(resolution, key)
        expect(result).toEqual({ key, from: timestamp })
        expect(sourceInitializer<string>(usagePage, 'effectiveDateFrom', {
            isAllPreset: true, resolvedAll: result,
        })).toBe(timestamp)
        cleanup?.()
    }
})

test('event rows and expanded pricing details retain amounts and cost explanations', () => {
    const numberFromValue                = sourceCallback(file, 'numberFromValue', {})
    const scope: Record<string, unknown> = {
        formatDateTime,
        formatNumber,
        // noinspection JSUnusedGlobalSymbols
        'extractLatencyMs': extractLatencyMs,
        formatDurationMs,
        // noinspection JSUnusedGlobalSymbols
        'formatThinkingLabel': formatThinkingLabel,
        // noinspection JSUnusedGlobalSymbols
        'isNoThinkingUsage': isNoThinkingUsage,
        normalizeUsageThinking,
        // noinspection JSUnusedGlobalSymbols
        'resolveUsageTokenMetrics': resolveUsageTokenMetrics,
        resolveSourceDisplay: () => ({ displayName: 'Fixture credential', type: 'codex' }),
        resolveApiKeyAlias: () => '',
        displayApiKey: () => 'masked',
        channelLabel: (value: string) => value,
        normalizeRequestLogState: () => 'not_recorded',
        resolveModelAliasRelations: () => [],
        numberFromValue,
        nonNegativeNumber: sourceCallback(file, 'nonNegativeNumber', { numberFromValue }),
        formatEventCost: sourceCallback(file, 'formatEventCost', {}),
        formatPricingReason: sourceCallback(file, 'formatPricingReason', {}),
        formatPercent: () => '-',
        formatThroughput: () => '-',
        formatTokenValue: String,
        formatRequestThinkingLabel: () => '-',
        sanitizeUpstreamUrl: sourceCallback(file, 'sanitizeUpstreamUrl', {}),
        observedRequestSpeed: sourceCallback(file, 'observedRequestSpeed', {}),
    }
    const convert                        = sourceCallback<(
        event: UsageEvent,
        index: number,
        sources: object,
        files: Map<string, unknown>,
        lang: string,
        noKey: string,
        missing: string,
        aliases: Map<string, unknown>,
        t: (key: string) => string,
    ) => {
        costLabel: string;
        costReason: string;
        pricingReceiptTitle: string
    }>(file, 'eventToRow', scope)
    const t                              = (key: string) => key.endsWith('unpriced') ? 'Unpriced' : key
    for (const status of ['unpriced', 'partial'] as const) {
        const row = convert({
                                timestamp: '2026-10-23T10:00:00Z',
                                model: 'fixture',
                                source: '',
                                auth_index: '',
                                api_key: 'synthetic',
                                tokens: {
                                    input_tokens: 0,
                                    output_tokens: 0,
                                    cached_tokens: 0,
                                    reasoning_tokens: 0,
                                    total_tokens: 0,
                                },
                                failed: false,
                                cost: 0,
                                cost_status: status,
                                cost_reason: 'Price not configured',
                            }, 0, {}, new Map(), 'en', '', '-', new Map(), t)
        expect(row.costReason).toBe('Price not configured')
        const expectedCost = status === 'unpriced' ? 'Unpriced' : '$0.00'
        expect(row.costLabel).toBe(expectedCost)
        const cell = sourceExpression<ReactElement>(
            file,
            (node, tree) => ts.isJsxElement(node) &&
                            node.openingElement.tagName.getText(tree) === 'span' &&
                            node.getText(tree).includes('{row.costLabel}'),
            { React, styles: {}, row },
        )
        expect(renderToStaticMarkup(cell)).toContain(expectedCost)
        const details = sourceExpression<ReactElement>(
            file,
            (node, tree) => ts.isJsxElement(node) &&
                            node.openingElement.tagName.getText(tree) === 'section' &&
                            node.openingElement.getText(tree).includes('styles.requestPricingSection'),
            { React, styles: { requestEventsCostReason: 'cost-reason' }, row, t },
        )
        const html = renderToStaticMarkup(details)
        expect(html).toContain('<p class="cost-reason">Price not configured</p>')
        expect(html).toContain(expectedCost)
    }
})

const css  = (file: string) => compile(
    new URL(`../src/${file}`, import.meta.url).pathname,
    { logger: { warn: noop, debug: noop } },
).css
const body = (content: string, selector: RegExp): string => content.match(selector)?.[1] ?? ''

test('compiled white-theme quota warning and error states have distinct readable colors', () => {
    const theme   = css('styles/themes.scss')
    const white   = body(theme, /\[data-theme=['"]?white['"]?]\s*\{(?<body>[^}]+)}/)
    const warning = white.match(/--warning-color:\s*(?<color>#[0-9a-f]{6})/i)?.[1]
    const error   = theme.match(/--error-color:\s*(?<color>#[0-9a-f]{6})/i)?.[1]
    expect(warning).toBeDefined()
    expect(error).toBeDefined()
    expect(warning).not.toBe(error)
    const rgb       = warning!.slice(1).match(/../g)!.map((part) => parseInt(part, 16) / 255).map((value) => value <=
                                                                                                             0.04045 ?
                                                                                                             value /
                                                                                                             12.92 :
                                                                                                             ((value +
                                                                                                               0.055) /
                                                                                                              1.055) **
                                                                                                             2.4)
    const luminance = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722
    expect(1.05 / (luminance + 0.05)).toBeGreaterThan(4.5)
    const card = css('components/credentials/CredentialCard.module.scss')
    expect(body(card, /\.barMedium\s*\{(?<body>[^}]+)}/)).toContain('var(--warning-color)')
    expect(body(card, /\.barLow\s*\{(?<body>[^}]+)}/)).toContain('var(--error-color)')
})

test('compiled payload inputs, Select triggers and policy delete controls share the medium height', () => {
    const shared       = css('styles/components.scss')
    const select       = css('components/ui/Select.module.scss')
    const visual       = css('components/config/VisualConfigEditor.module.scss')
    const inputHeight  = body(shared, /\.input,\s*textarea\s*\{(?<body>[^}]+)}/)
        .match(/(?:^|\s)(?:min-)?height:\s*(?<value>[^;]+);/)?.[1]
    const selectHeight = body(select, /\.trigger\s*\{(?<body>[^}]+)}/).match(/(?:^|\s)height:\s*(?<value>[^;]+);/)?.[1]
    expect(inputHeight).toBeDefined()
    expect(inputHeight).toBe(selectHeight)
    expect(body(visual, /\.visualEditor :global\(\.input\)\s*\{(?<body>[^}]+)}/)).not.toContain('min-height: 48px')
    const button = sourceExpression<ReactElement<{ size: string }>>(
        'components/config/VisualConfigEditorBlocks.tsx',
        (node, tree) => ts.isJsxElement(node) &&
                        node.openingElement.tagName.getText(tree) ===
                        'Button' &&
                        node.getText(tree).includes('setLimitDrafts') &&
                        node.getText(tree).includes('limit.id'),
        {
            React,
            Button,
            limit: { id: 'fixture' },
            disabled: false,
            setLimitDrafts: noop,
            visualT: (key: string) => key,
        },
    )
    expect(button.props.size).toBe('md')
})

test('system capacity limits share the second equal-width desktop column beside their retention fields', () => {
    const path                   = new URL('../src/components/config/VisualConfigEditor.tsx', import.meta.url)
    const source                 = readFileSync(path, 'utf8')
    const tree                   = ts.createSourceFile(
        path.pathname,
        source,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
    )
    const grids: ts.JsxElement[] = []
    const visit                  = (node: ts.Node) => {
        if (ts.isJsxElement(node) && node.openingElement.getText(tree).includes('styles.systemFieldGrid')) {
            grids.push(node)
        }
        ts.forEachChild(node, visit)
    }
    visit(tree)
    expect(grids).toHaveLength(1)
    const fields = grids[0].children.filter((node) => ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node))
    const index  = (field: string) => fields.findIndex((node) => node.getText(tree).includes(`values.${field}`))
    expect(index('logsMaxTotalSizeMb')).toBe(1)
    expect(index('usageRetentionMaxDbSizeMb')).toBe(4)
    expect(index('usageRetentionDays')).toBe(3)
    expect(index('imageArtifactCacheMaxTotalSizeMb')).toBe(2)
    expect(index('imageArtifactCacheRetentionDays')).toBe(5)
    expect(body(css('components/config/VisualConfigEditor.module.scss'), /\.systemFieldGrid\s*\{(?<body>[^}]+)}/))
        .toContain('grid-template-columns: repeat(3, minmax(0, 1fr))')
})

test('compiled Events card, loading shell and table consume the remaining flex height', () => {
    const page   = css('pages/UsagePage.module.scss')
    const events = css('components/usage/RequestEventsDetailsCard.module.scss')
    expect(body(page, /\.container\s*\{(?<body>[^}]+)}/)).toContain('flex: 1')
    expect(body(events, /\.eventsCard\s*\{(?<body>[^}]+)}/)).toContain('flex: 1')
    expect(body(events, /\.cardLoadingShell\s*\{(?<body>[^}]+)}/)).toContain('flex: 1')
    expect(body(events, /\.eventsSheet\s*\{(?<body>[^}]+)}/)).toContain('flex: 1')
})
