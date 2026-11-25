import {CardSkeleton} from '@/components/common/CardSkeleton'
import {Sheet} from '@/components/common/Sheet'
import {Button} from '@/components/ui/Button'
import {Card} from '@/components/ui/Card'
import {EmptyState} from '@/components/ui/EmptyState'
import {Input} from '@/components/ui/Input'
import {
    getModelEntriesValidationKey,
    type ModelEntry,
    parseThinkingLevelsInput,
    updateModelNumericField,
} from '@/components/ui/modelInputListUtils'
import {Pagination} from '@/components/ui/Pagination'
import {Select} from '@/components/ui/Select'
import {ToggleSwitch} from '@/components/ui/ToggleSwitch'
import {CredentialStatsCard} from '@/components/usage/CredentialStatsCard'
import {ModelStatsCard} from '@/components/usage/ModelStatsCard'
import {parseLogLine} from '@/pages/hooks/logParsing'
import type {EventsParams, EventsResponse, UsageSummary} from '@/services/api/usage'
import {formatLogTimestamp, formatNumber, toLocalDateTimeString} from '@/utils/format'
import {normalizeModelThinking} from '@/utils/modelMetadata'
import {formatDurationMs, formatThinkingLabel, resolveUsageTokenMetrics} from '@/utils/usage'
import {describe, expect, test} from 'bun:test'
import {createInstance} from 'i18next'
import {readFileSync} from 'node:fs'
import React, {createElement, type ReactElement, type ReactNode} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {I18nextProvider} from 'react-i18next'
import {Link, MemoryRouter} from 'react-router'
import {compile} from 'sass'
import ts from 'typescript'
import {sourceCallback, sourceExpression, sourceInitializer} from './sourceCallbacks'

const eventFile = 'components/usage/RequestEventsDetailsCard.tsx'
const modelFile = 'components/ui/ModelInputList.tsx'
const noop      = () => {
}
const styles    = new Proxy<Record<string, string>>({}, { get: (_target, key) => String(key) })
const translate = (key: string) => key
const languages = ['en', 'ru', 'zh-CN', 'zh-TW'] as const
const settle    = async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve()
}

async function locale(language: typeof languages[number]) {
    const instance = createInstance()
    await instance.init({
                            lng: language,
                            fallbackLng: false,
                            resources: {
                                [language]: {
                                    translation: JSON.parse(readFileSync(new URL(
                                        `../src/i18n/locales/${language}.json`,
                                        import.meta.url,
                                    ), 'utf8')),
                                },
                            },
                        })
    return instance
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

function eventCard(
    t                                    = translate,
    requestLog                           = false,
    rows: { id: string; name: string }[] = [],
    fetchError                           = '',
    fetching                             = false,
) {
    return sourceExpression<ReactElement>(
        eventFile,
        (node, tree) => ts.isJsxElement(node) &&
                        node.openingElement.tagName.getText(tree) ===
                        'Card' &&
                        node.openingElement.getText(tree).includes('extra='),
        {
            React,
            Card,
            Button,
            Select,
            ToggleSwitch,
            Pagination,
            EmptyState,
            Link,
            Modal: () => null,
            styles,
            t,
            config: { requestLog },
            autoRefresh: false,
            autoRefreshInterval: 30000,
            USAGE_EVENTS_AUTO_REFRESH_INTERVALS: [{ value: '30000', label: '30s' }],
            setAutoRefreshEnabled: noop,
            setAutoRefreshClockMs: noop,
            setAutoRefreshIntervalOverride: noop,
            activePreset: '',
            handleClearFilters: noop,
            hasActiveFilters: false,
            handleExportCsv: noop,
            handleExportJson: noop,
            fetching,
            totalCount: rows.length,
            exportingFormat: null,
            searchInput: '',
            setSearchInput: noop,
            modelAliasError: '',
            isLoading: fetching,
            rows,
            fetchError,
            isRefreshingRows: fetching && rows.length > 0,
            page: 1,
            pageSize: 50,
            setPage: noop,
            setPageSize: noop,
            requestEventColumns: [
                {
                    key: 'name',
                    header: 'Model',
                    cell: (row: { name: string }) => row.name,
                },
            ],
            Sheet,
            renderRequestEventRow: (row: { id: string; name: string }) => createElement(
                'tr', null,
                createElement(
                    'td',
                    null,
                    row.name,
                ),
            ),
            requestLogPreview: null,
            requestDetails: null,
            setRequestDetails: noop,
            requestLogPreviewSeqRef: { current: 0 },
            activeRequestLogPreviewRef: { current: null },
            setRequestLogPreview: noop,
            setRequestLogError: noop,
            downloadRequestLog: noop,
            requestLogDownloading: new Set(),
            requestLogError: '',
            requestLogPreviewing: new Set(),
        },
    )
}

describe('usage visible consumers: R-457 R-643', () => {
    test(
        (
            'custom page=1 explicit refresh reaches the real request effect, ' +
            'cancels stale reads and recovers after failure'
        ),
        async () => {
            const fixedRange            = { from: '2026-10-01T00:00', to: '2026-10-02T00:00', preset: '' }
            let refreshToken            = 0
            const refresh               = sourceCallback<() => void>('pages/UsagePage.tsx', 'handleRefresh', {
                dateRange: fixedRange,
                activeTab: 'events',
                setLiveWindowAnchorMs: noop,
                needsRawUsage: false,
                loadUsage: noop,
                setDateRange: (update: (value: typeof fixedRange) => typeof fixedRange) => expect(update(fixedRange))
                    .toBe(fixedRange),
                setSummaryRefreshToken: noop,
                setEventsRefreshToken: (update: (value: number) => number) => {
                    refreshToken = update(refreshToken)
                },
                toLocalDateTimeString,
            })
            const params: EventsParams  = {
                page: 1,
                page_size: 50,
                view: 'compact',
                from: fixedRange.from,
                to: fixedRange.to,
            }
            const calls: {
                signal: AbortSignal;
                resolve: (data: EventsResponse) => void;
                reject: (error: Error) => void
            }[]                         = []
            const events                = { data: null as EventsResponse | null }
            let fetchError              = ''
            let settledRequestSignature = ''
            let eventsRequestSignature  = ''
            let dependencies: unknown[] | undefined
            let cleanup: (() => void) | undefined
            const controllerRef         = { current: null as AbortController | null }
            const register              = (enabled = true) => {
                eventsRequestSignature =
                    sourceInitializer(
                        eventFile,
                        'eventsRequestSignature',
                        { eventsParams: params, refreshToken, useMemo: (read: () => string) => read() },
                    )
                sourceExpression(
                    eventFile,
                    (node, tree) => ts.isCallExpression(node) &&
                                    node.expression.getText(tree) ===
                                    'useEffect' &&
                                    node.arguments[0]?.getText(tree).includes('.getEvents(eventsParams'),
                    {
                        enabled,
                        eventsParams: params,
                        eventsRequestSignature,
                        refreshToken,
                        eventsRequestControllerRef: controllerRef,
                        usageApi: {
                            getEvents: (
                                _params: EventsParams,
                                options: { signal: AbortSignal },
                            ) => new Promise<EventsResponse>((
                                                                 resolve,
                                                                 reject,
                                                             ) => calls.push({
                                                                                 signal: options.signal,
                                                                                 resolve,
                                                                                 reject,
                                                                             })),
                        },
                        setEventsData: (data: EventsResponse) => {
                            events.data = data
                        },
                        setFetchError: (error: string) => {
                            fetchError = error
                        },
                        setSettledRequestSignature: (value: string) => {
                            settledRequestSignature = value
                        },
                        useEffect: (effect: () => (() => void) | undefined, next: unknown[]) => {
                            if (!dependencies ||
                                next.some((value, index) => !Object.is(value, dependencies![index]))) {
                                cleanup?.();
                                dependencies = next;
                                cleanup      = effect()
                            }
                        },
                    },
                )
            }
            const fetching              = () => sourceInitializer<boolean>(
                eventFile,
                'fetching',
                {
                    enabled: true,
                    settledRequestSignature,
                    eventsRequestSignature,
                },
            )
            const response              = (model: string): EventsResponse => ({
                events: [
                    {
                        timestamp: '2026-10-01T01:00:00Z',
                        model,
                        api_key: '',
                        source: '',
                        auth_index: 'fixture',
                        failed: false,
                        tokens: {
                            input_tokens: 0,
                            output_tokens: 0,
                            cached_tokens: 0,
                            reasoning_tokens: 0,
                            total_tokens: 0,
                        },
                    },
                ], page: 1, page_size: 50, total: 1, total_pages: 1,
            })
            register()
            expect(fetching()).toBe(true)
            refresh();
            register()
            expect(calls.length).toBe(2)
            expect(calls[0].signal.aborted).toBe(true)
            calls[0].resolve(response('stale'));
            await settle()
            expect(events.data).toBeNull()
            calls[1].resolve(response('retained'));
            await settle()
            expect(events.data).toEqual(response('retained'))
            expect(fetching()).toBe(false)
            refresh();
            register()
            expect(fetching()).toBe(true)
            expect(events.data).toEqual(response('retained'))
            calls[2].reject(new Error('Synthetic refresh failure'));
            await settle()
            expect(fetchError).toBe('Synthetic refresh failure')
            expect(fetching()).toBe(false)
            refresh();
            register()
            calls[3].resolve(response('recovered'));
            await settle()
            expect(events.data).toEqual(response('recovered'))
            expect(fetchError).toBe('')
            expect(fetching()).toBe(false)
            refresh();
            register();
            register(false)
            expect(calls[4].signal.aborted).toBe(true)
            expect(controllerRef.current).toBeNull()
            calls[4].reject(new Error('Cancelled read'));
            await settle()
            expect(fetchError).toBe('')
            expect(events.data).toEqual(response('recovered'))
        },
    )

    test('every preset dispatches an explicit event refresh even within the same displayed minute', () => {
        for (const preset of ['', '24h', '7d', '30d', 'all']) {
            let token = 0
            sourceCallback<() => void>('pages/UsagePage.tsx', 'handleRefresh', {
                dateRange: { preset },
                activeTab: 'events',
                setLiveWindowAnchorMs: noop,
                setDateRange: noop,
                needsRawUsage: false,
                loadUsage: noop,
                setSummaryRefreshToken: noop,
                setEventsRefreshToken: (update: (value: number) => number) => {
                    token = update(token)
                },
                toLocalDateTimeString,
            })()
            expect(token).toBe(1)
        }
    })

    test('refresh generations leave custom pagination intact and pass through the actual EventsTab', () => {
        const signature = (refreshToken: number) => sourceInitializer<string>(eventFile, 'pageResetSignature', {
            topModels: [],
            topCredentials: [],
            topApiKeys: [],
            statusFilter: '',
            speedFilter: '',
            searchQuery: '',
            sortField: 'timestampMs',
            sortDir: 'desc',
            dateRange: { from: 'a', to: 'b' },
            refreshToken,
        })
        expect(signature(0)).toBe(signature(1))
        const tab = sourceCallback<(props: Record<string, unknown>) => ReactElement<{ style: React.CSSProperties }>>(
            'components/usage/EventsTab.tsx',
            'EventsTab',
            {
                React,
                // noinspection JSUnusedGlobalSymbols
                'RequestEventsDetailsCard': () => null,
            },
        )(
            { refreshToken: 9, dateRange: { from: 'a', to: 'b' } })
        expect(elements(tab).some((element) => element.props.refreshToken === 9)).toBe(true)
        expect(tab.props.style).toMatchObject({ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 })
    })

    test(
        'summary refresh feedback reaches the actual credential-statistics consumer even when raw usage is idle',
        () => {
            const usageLoading = sourceExpression<boolean>('pages/UsagePage.tsx', (node, tree) =>
                ts.isBinaryExpression(node) &&
                ts.isJsxExpression(node.parent) &&
                ts.isJsxAttribute(node.parent.parent) &&
                node.parent.parent.name.getText(tree) ===
                'usageLoading', {
                                                               loading: false,
                                                               rangeResolutionLoading: false,
                                                               combinedSummaryLoading: true,
                                                           })
            expect(usageLoading).toBe(true)
            const credentials = {
                loading: false,
                geminiKeys: [],
                claudeConfigs: [],
                codexConfigs: [],
                vertexConfigs: [],
                openaiProviders: [],
                authFileMap: new Map(),
            }
            const card        = sourceExpression<ReactElement<{ loading: boolean }>>(
                'components/usage/OverviewTab.tsx',
                (
                    node,
                    tree,
                ) => ts.isJsxSelfClosingElement(node) &&
                     node.tagName.getText(tree) ===
                     'CredentialStatsCard', {
                    React,
                    CredentialStatsCard,
                    usage: null,
                    usageLoading,
                    loading: true,
                    credentials,
                    summary: null,
                    aliases: {},
                },
            )
            expect(card.props.loading).toBe(true)
        },
    )

    test(
        'real model/API key and credential Sheets retain readable rows with a header-only refresh status',
        async () => {
            const instance = await locale('en')
            for (const loading of [true, false]) {
                const stats                 = {
                    model: 'Retained model',
                    requests: 4,
                    tokens: 10,
                    successCount: 3,
                    failureCount: 1,
                    averageLatencyMs: null,
                    latencySampleCount: 0,
                    cost: 0,
                }
                const summary: UsageSummary = {
                    period: { from: '2026-10-01T00:00:00Z', to: '2026-10-02T00:00:00Z' },
                    totals: {
                        requests: 4,
                        success: 3,
                        failure: 1,
                        tokens: { input: 0, output: 0, cached: 0, reasoning: 0, total: 0 },
                        cost: 0,
                    },
                    by_model: {},
                    by_api_key: {},
                    by_credential: {
                        'codex:Retained credential': {
                            provider: 'codex',
                            source: 'Retained credential',
                            success: 3,
                            failure: 1,
                        },
                    },
                    time_series: [],
                    time_series_by_model: {},
                    time_series_by_credential: {},
                    time_series_by_api_key: {},
                }
                const cards                 = [
                    createElement(ModelStatsCard, { modelStats: [stats], loading, hasPrices: false }),
                    createElement(
                        ModelStatsCard,
                        {
                            modelStats: [{ ...stats, model: 'Retained API alias' }],
                            loading,
                            hasPrices: false,
                            cardTitle: 'API Key',
                        },
                    ),
                    createElement(
                        CredentialStatsCard,
                        {
                            usage: null,
                            loading,
                            geminiKeys: [],
                            claudeConfigs: [],
                            codexConfigs: [],
                            vertexConfigs: [],
                            openaiProviders: [],
                            authFileMap: new Map(),
                            summary,
                        },
                    ),
                ]
                for (const [index, card] of cards.entries()) {
                    const html = renderToStaticMarkup(createElement(I18nextProvider, { i18n: instance }, card))
                    expect(html).toContain(['Retained model', 'Retained API alias', 'Retained credential'][index])
                    expect(html).not.toContain('aria-busy="true"')
                    expect(html.includes('role="status"')).toBe(loading)
                }
            }
        },
    )
})

describe('visible metric and log guidance: R-593 R-658 R-613', () => {
    test(
        'event Cards consume metric and enabled/disabled guides in every language, alongside actual log navigation',
        async () => {
            for (const language of languages) {
                const instance = await locale(language)
                const t        = instance.t.bind(instance)
                for (const enabled of [false, true]) {
                    const html = renderToStaticMarkup(createElement(MemoryRouter, null, eventCard(t, enabled)))
                    expect(html).toContain(t('usage_stats.request_events_field_guide_title'))
                    expect(html).toContain(t('usage_stats.request_events_metric_guide'))
                    expect(html).toContain(t(`usage_stats.request_events_log_${enabled ?
                                                                               'enabled' :
                                                                               'disabled'}_guide`))
                    expect(html).toContain('href="/logs"')
                    expect(html).toContain('eventsCard')
                }
            }
        },
    )

    test(
        (
            'ordinary log headers expose each field meaning and both log ' +
            'states keep the actual error-list action reachable'
        ),
        async () => {
            for (const language of languages) {
                const instance = await locale(language)
                const t        = instance.t.bind(instance)
                const columns  = sourceCallback<() => { key: string; header: ReactNode }[]>(
                    'pages/LogsPage.tsx',
                    'logColumns',
                    { React, styles, t },
                )()
                for (const [columnKey, hints] of [
                    ['message', ['path', 'message']], ['request_id', ['request_id']], ['copy', ['trace']],
                ] as const) {
                    const html = renderToStaticMarkup(createElement(
                        'div',
                        null,
                        columns.find((column) => column.key === columnKey)!.header,
                    ))
                    for (const hint of hints) {
                        expect(html).toContain(t(`logs.column_${hint}_hint`))
                    }
                }
                for (const requestLogEnabled of [false, true]) {
                    let selected = ''
                    const guide  = sourceExpression<ReactElement>(
                        'pages/LogsPage.tsx',
                        (node, tree) => ts.isJsxElement(node) &&
                                        node.openingElement.getText(tree)
                                            .includes('styles.requestLogGuide'),
                        {
                            React,
                            styles,
                            t,
                            requestLogEnabled,
                            activeTab: 'logs',
                            Button,
                            handleTabChange: (tab: string) => {
                                selected = tab
                            },
                        },
                    )
                    const html   = renderToStaticMarkup(guide)
                    expect(html).toContain(t(requestLogEnabled ?
                                             'logs.error_logs_request_log_enabled' :
                                             'logs.request_log_disabled_guide'))
                    const action = elements(guide).find((element) => element.type === Button)!
                    expect(action).toBeDefined()
                    ;(action.props.onClick as () => void)()
                    expect(selected).toBe('errors')
                }
            }
        },
    )

    test('trace usage candidates consume cache-read metrics rather than counting cache writes as hits', () => {
        const file            = 'pages/LogsPage.tsx'
        const numberFromValue = sourceInitializer(file, 'numberFromValue', {})
        const scope           = {
            React,
            styles,
            t: translate,
            i18n: { language: 'en' },
            notRecordedLabel: 'Not recorded',
            // noinspection JSUnusedGlobalSymbols
            'resolveUsageTokenMetrics': resolveUsageTokenMetrics,
            trace: { resolveTraceSourceInfo: () => ({ displayName: 'Fixture', type: '' }) },
            // noinspection JSUnusedGlobalSymbols
            'formatThinkingLabel': formatThinkingLabel,
            formatLogTimestamp,
            maxTraceTokenValue: sourceInitializer(file, 'maxTraceTokenValue', { numberFromValue }),
            formatTraceDuration: sourceInitializer(file, 'formatTraceDuration', { numberFromValue, formatDurationMs }),
            formatTraceToken: sourceInitializer(file, 'formatTraceToken', { formatNumber }),
            formatTracePercent: sourceInitializer(file, 'formatTracePercent', {}),
        }
        const renderCandidate = sourceExpression<(candidate: object) => ReactElement>(
            file,
            (
                node,
                tree,
            ) => ts.isArrowFunction(node) &&
                 node.body.getText(tree)
                     .includes('const tokens') &&
                 node.parameters[0]?.name.getText(tree) ===
                 'candidate', scope,
        )
        for (const [tokens, expected] of [
            [{ input_tokens: 100, cache_read_tokens: 25, cache_write_tokens: 75, cached_tokens: 99 }, '25%'],
            [{ input_tokens: 100, cache_write_tokens: 75 }, '0%'],
            [{ input_tokens: 100, cached_tokens: 50 }, '50%'],
            [{ input_tokens: 0, cache_read_tokens: 25 }, 'Not recorded'],
        ] as const) {
            const html = renderToStaticMarkup(renderCandidate({
                                                                  detail: {
                                                                      tokens,
                                                                      __modelName: 'fixture',
                                                                      __endpoint: '/v1/responses',
                                                                  }, timeDeltaMs: null,
                                                              }))
            expect(html).toContain(`logs.trace_cache_hit</span><span class="traceInfoValue">${expected}</span>`)
        }
    })

    test(
        (
            'populated events preserve rows through refresh/failure/recovery,' +
            ' while empty and initial failures remain distinct'
        ),
        () => {
            const render = (
                rows: { id: string; name: string }[],
                error: string,
                fetching: boolean,
            ) => renderToStaticMarkup(createElement(
                MemoryRouter,
                null,
                eventCard(translate, false, rows, error, fetching),
            ))
            const rows   = [{ id: 'fixture', name: 'Retained event' }]
            expect(render(rows, '', true)).toContain('Retained event')
            expect(render(rows, '', true)).not.toContain('aria-busy="true"')
            expect(render(rows, 'Synthetic failure', false)).toContain('role="alert"')
            expect(render(rows, 'Synthetic failure', false)).toContain('Retained event')
            expect(render(rows, '', false)).not.toContain('Synthetic failure')
            expect(render([], '', false)).toContain('usage_stats.request_events_empty_title')
            expect(render([], 'Initial failure', false)).toContain('Initial failure')
            const parsed = parseLogLine(
                (
                    '[2026-11-01 10:00:00] [0123456789abcdef0123456789abcdef] [info] ' +
                    '200 | 14ms | 127.0.0.1 | POST "/v1/responses"'
                ))
            expect(parsed.path).toBe('/v1/responses')
            expect(parsed.requestId).toBe('0123456789abcdef0123456789abcdef')
        },
    )
})

describe('metadata Select consumers: R-221', () => {
    function modelSelectors(entry: ModelEntry, provider = 'xai', disabled = false) {
        let updated: ModelEntry[] = []
        const Component           = sourceCallback<(props: Record<string, unknown>) => ReactElement>(
            modelFile,
            'ModelInputList',
            {
                React,
                Fragment: React.Fragment,
                useTranslation: () => ({ t: translate }),
                useState: (initial: unknown) => [initial, noop],
                useRef: (initial: unknown) => ({ current: initial }),
                useEffect: noop,
                MODEL_PAGE_SIZE: sourceInitializer(modelFile, 'MODEL_PAGE_SIZE', {}),
                styles,
                Button,
                Input,
                Pagination,
                IconX: () => null,
                Select,
                THINKING_BOOLEAN_FIELDS: sourceInitializer(
                    modelFile,
                    'THINKING_BOOLEAN_FIELDS',
                    {},
                ),
                ADVANCED_BOOLEAN_FIELDS: sourceInitializer(
                    modelFile,
                    'ADVANCED_BOOLEAN_FIELDS',
                    {},
                ),
                normalizeModelThinking,
                getModelEntriesValidationKey,
                parseThinkingLevelsInput,
                updateModelNumericField,
            },
        )
        const tree                = Component({
                                                  entries: [entry, { name: 'untouched', alias: '' }],
                                                  onChange: (value: ModelEntry[]) => {
                                                      updated = value
                                                  },
                                                  provider,
                                                  metadataEditing: true,
                                                  disabled,
                                              })
        const selectors           = elements(tree).filter((element) => element.type === Select)
        return { tree, selectors, updated: () => updated }
    }

    test(
        (
            'all three templates use shared Select with accessible names, ' +
            'disabled state and exact thinking-mode transitions'
        ),
        () => {
            const original: ModelEntry = {
                name: 'fixture',
                alias: '',
                thinking: { min: 2, max: 9 },
                thinkingMinDraft: '2',
                thinkingMaxDraft: '9',
                preserveImportedThinkingRange: true,
            }
            for (const mode of ['inherit', 'empty', 'override']) {
                const rendered = modelSelectors(original)
                expect(elements(rendered.tree).some((element) => element.type === 'select')).toBe(false)
                const select = rendered.selectors.find((element) => element.props.ariaLabel ===
                                                                    'ai_providers.model_thinking_mode')!
                expect(select).toBeDefined()
                ;(select.props.onChange as (value: string) => void)(mode)
                const [entry, untouched] = rendered.updated()
                expect(entry.thinking).toEqual(mode === 'inherit' ?
                                               undefined :
                                               mode === 'empty' ? {} : { min: 2, max: 9 })
                expect(entry.thinkingMinDraft).toBeUndefined()
                expect(entry.thinkingMaxDraft).toBeUndefined()
                expect(untouched).toEqual({ name: 'untouched', alias: '' })
            }
            for (const entry of [{ name: 'a', alias: '' }, { name: 'a', alias: '', thinking: {} }, original]) {
                const rendered = modelSelectors(entry, 'xai', true)
                expect(rendered.selectors.length).toBe(10)
                expect(rendered.selectors.every((element) => element.props.disabled ===
                                                             true &&
                                                             typeof element.props.ariaLabel ===
                                                             'string')).toBe(true)
                const html = renderToStaticMarkup(rendered.tree)
                expect((html.match(/aria-haspopup="listbox"/g) ?? []).length).toBe(10)
            }
        },
    )

    test('provider-specific advanced flags keep all three values through the shared Select callbacks', () => {
        for (const [provider, label, field] of [
            ['codex', 'ai_providers.model_configuration_update_label', 'supportConfigurationUpdate'],
            ['openai', 'ai_providers.model_image_label', 'image'],
        ] as const) {
            for (const choice of ['', 'true', 'false']) {
                const rendered = modelSelectors({ name: 'fixture', alias: '' }, provider)
                const select   = rendered.selectors.find((element) => element.props.ariaLabel === label)!
                expect(select).toBeDefined()
                ;(select.props.onChange as (value: string) => void)(choice)
                expect(rendered.updated()[0][field]).toBe(choice === '' ? undefined : choice === 'true')
            }
        }
    })

    test('OpenAI exposes the request token limit outside collapsed model options', () => {
        const label = 'ai_providers.model_token_limit_field_label: fixture'
        for (const flag of [undefined, true, false]) {
            const rendered = modelSelectors({ name: 'fixture', alias: '', useMaxCompletionTokens: flag }, 'openai')
            const select   = rendered.selectors.find((element) => element.props.ariaLabel === label)!
            expect(select.props.value).toBe(flag ? 'max_completion_tokens' : 'max_tokens')
            expect(elements(rendered.tree).filter((element) => element.type === 'details')
                                          .some((details) => elements(details).includes(select))).toBe(false)
            ;(select.props.onChange as (value: string) => void)(flag ? 'max_tokens' : 'max_completion_tokens')
            expect(rendered.updated()[0].useMaxCompletionTokens).toBe(!flag)
        }
    })

    test('thinking and advanced boolean choices preserve undefined/true/false through the real JSX callbacks', () => {
        for (const choice of ['', 'true', 'false']) {
            const expected = choice === '' ? undefined : choice === 'true'
            for (const [label, field, thinking] of [
                ['ai_providers.model_thinking_zero_allowed_label', 'zeroAllowed', true],
                ['ai_providers.model_thinking_dynamic_allowed_label', 'dynamicAllowed', true],
                ['ai_providers.model_is_compat_label', 'isCompat', false],
                ['ai_providers.model_force_mapping_label', 'forceMapping', false],
            ] as const) {
                const rendered = modelSelectors({ name: 'fixture', alias: '', thinking: { min: 2, max: 9 } })
                const select   = rendered.selectors.find((element) => element.props.ariaLabel === label)!
                expect(select).toBeDefined()
                ;(select.props.onChange as (value: string) => void)(choice)
                const entry = rendered.updated()[0]
                expect(thinking ?
                       entry.thinking?.[field as 'zeroAllowed' | 'dynamicAllowed'] :
                       entry[field as 'isCompat' | 'forceMapping']).toBe(expected)
            }
        }
    })
})

describe('real event height consumers: R-231', () => {
    test(
        (
            'binds both actual Card branches and compiles the page-to-Sheet ' +
            'flex chain for skeleton, empty and few-row states'
        ),
        () => {
            const tree            = ts.createSourceFile(
                eventFile,
                readFileSync(new URL(`../src/${eventFile}`, import.meta.url), 'utf8'),
                ts.ScriptTarget.Latest,
                true,
                ts.ScriptKind.TSX,
            )
            const cards: string[] = []
            const visit           = (node: ts.Node) => {
                if (ts.isJsxOpeningElement(node) && node.tagName.getText(tree) === 'Card') {
                    const attribute = node.attributes.properties.find((item) => ts.isJsxAttribute(item) &&
                                                                                item.name.getText(tree) ===
                                                                                'className')
                    cards.push(attribute?.getText(tree) ?? '')
                }
                ts.forEachChild(node, visit)
            }
            visit(tree)
            expect(cards).toEqual(['className={styles.eventsCard}', 'className={styles.eventsCard}'])
            const skeleton = sourceExpression<ReactElement>(
                eventFile,
                (node, source) => ts.isJsxElement(node) &&
                                  node.openingElement.tagName.getText(source) ===
                                  'Card' &&
                                  node.getText(source).includes('<CardSkeleton'),
                {
                    React, Card,
                    // noinspection JSUnusedGlobalSymbols
                    'CardSkeleton': CardSkeleton, t: translate, styles,
                },
            )
            expect(renderToStaticMarkup(skeleton)).toContain('eventsCard')
            const css = compile(new URL(
                '../src/components/usage/RequestEventsDetailsCard.module.scss',
                import.meta.url,
            ).pathname).css
            for (const selector of ['eventsCard', 'cardLoadingShell', 'eventsSheet']) {
                expect(css.match(new RegExp(`\\.${selector}\\s*\\{(?<body>[^}]+)}`))?.[1]).toMatch(/flex:\s*1/)
            }
            const pageCss = compile(new URL('../src/pages/UsagePage.module.scss', import.meta.url).pathname).css
            expect(pageCss.match(/\.container\s*\{(?<body>[^}]+)}/)?.[1]).toMatch(/flex:\s*1/)
        },
    )
})
