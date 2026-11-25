import {searchConfigFields} from '@/components/config/configSearchIndex'
import {parseTextList} from '@/components/providers/utils'
import {decodeVisualConfigYaml, encodeVisualConfigYaml} from '@/hooks/visualConfigCodec'
import {parseLogLine} from '@/pages/hooks/logParsing'
import type {ParsedLogLine} from '@/pages/hooks/logTypes'
import {apiClient} from '@/services/api/client'
import {buildClaudeConfigPatchPayload} from '@/services/api/providers'
import {normalizeProviderKeyConfig} from '@/services/api/transformers'
import type {EventsParams, UsageEvent, UsageSummary} from '@/services/api/usage'
import {useTimezoneStore} from '@/stores/useTimezoneStore'
import {formatDateTime, parseLogTimestamp} from '@/utils/format'
import {buildChartDataFromSummary, buildTokenBreakdownChartData, type UsageDetailWithEndpoint} from '@/utils/usage'
import {summaryToApiKeyStats} from '@/utils/usage/summaryHelpers'
import axios, {AxiosError, type AxiosInstance} from 'axios'
import {expect, test} from 'bun:test'
import {createInstance} from 'i18next'
import {readFileSync} from 'node:fs'
import React, {type ReactElement} from 'react'
import ts from 'typescript'
import {parse, stringify} from 'yaml'
import {sourceCallback, sourceExpression, sourceInitializer} from './sourceCallbacks'

const noop = () => {
}

test('model catalog refresh produces persistent success and failure notifications', async () => {
    for (const fail of [false, true]) {
        const events: unknown[][] = []
        const refresh             = sourceCallback<() => Promise<void>>(
            'pages/SystemPage.tsx',
            'handleCatalogRefresh',
            {
                setCatalogRefreshing: noop,
                setCatalogMeta: noop,
                setCatalogMetaError: noop,
                modelCatalogApi: {
                    refresh: async () => {
                        if (fail) {
                            throw new Error('Synthetic catalog failure')
                        }

                        return { source: 'embed' }
                    },
                },
                showNotification: noop,
                addPersistentNotification: (...args: unknown[]) => events.push(args),
                t: (key: string) => key,
                fetchCatalogMeta: async () => {
                },
                console: { warn: noop },
                redactSensitiveText: (message: string) => message,
            },
        )
        await refresh()
        expect(events).toEqual([
                                   [
                                       fail ?
                                       'system_info.catalog_refresh_failed' :
                                       'system_info.catalog_refresh_success',
                                       fail ? 'error' : 'success',
                                       'model-update',
                                   ],
                               ])
    }
})

test('built-in model catalogs do not claim an automatic-update failure', async () => {
    const values = { en: 'Built-in catalog', ru: 'Встроенный каталог', 'zh-CN': '内置目录', 'zh-TW': '內建目錄' }
    for (const [language, expected] of Object.entries(values)) {
        const instance = createInstance()
        await instance.init({
                                lng: language,
                                resources: {
                                    [language]: {
                                        translation: JSON.parse(readFileSync(new URL(
                                            `../src/i18n/locales/${language}.json`,
                                            import.meta.url,
                                        ), 'utf8')),
                                    },
                                },
                            })
        const label = sourceExpression<string>(
            'pages/SystemPage.tsx',
            (node, tree) => ts.isConditionalExpression(node) &&
                            node.condition.getText(tree) ===
                            'catalogMeta.source === \'embed\'',
            {
                catalogMeta: { source: 'embed', last_error: '' },
                t: instance.t.bind(instance),
                // noinspection JSUnusedGlobalSymbols
                'renderCatalogSources': (sources: string[]) => sources.join(', '),
            },
        )
        expect(label).toBe(expected)
    }
})

test('built-in catalogs retain upstream candidates without treating embed as a URL', () => {
    const first  = 'https://catalog-a.invalid/models.json'
    const second = 'https://catalog-b.invalid/models.json'
    for (const { catalogMeta, expected } of [
        { catalogMeta: null, expected: [] },
        { catalogMeta: { source: 'embed', sources: [first, second, first, '', '   '] }, expected: [first, second] },
        { catalogMeta: { source: first, sources: [second, first] }, expected: [first, second] },
        { catalogMeta: { source: 'embed', sources: [] }, expected: [] },
    ]) {
        const sources = sourceCallback<() => string[]>('pages/SystemPage.tsx', 'catalogSources', { catalogMeta })()
        expect(sources).toEqual(expected)
    }
})

test('dashboard date and time and login failure timestamps honor the selected timezone', () => {
    const instant = new Date('2026-10-23T23:45:00Z')
    const scope   = { currentTime: instant, i18n: { language: 'en-GB' }, timezone: 'Asia/Tokyo' }
    const date    = sourceInitializer<string>('pages/DashboardPage.tsx', 'formattedDate', scope)
    const time    = sourceInitializer<string>('pages/DashboardPage.tsx', 'formattedTime', scope)
    expect(date).toContain('24 October 2026')
    expect(time).toBe('08:45')
    const previous = useTimezoneStore.getState().timezone
    try {
        useTimezoneStore.setState({ timezone: 'Asia/Tokyo' })
        const latest = sourceExpression<string>(
            'pages/LoginPage.tsx',
            (node, tree) => ts.isConditionalExpression(node) &&
                            node.condition.getText(tree) ===
                            'latestFailure',
            {
                latestFailure: instant.getTime(), formatDateTime,
            },
        )
        expect(latest).toBe(formatDateTime(instant))
        expect(latest).toContain('08:45')
    } finally {
        useTimezoneStore.setState({ timezone: previous })
    }
})

test('log overlap and display parsing use the same instant for UTC and offset timestamps', () => {
    const regex   = sourceInitializer<RegExp>('pages/LogsPage.tsx', 'LOG_LINE_TIMESTAMP_REGEX', {})
    const seconds = sourceInitializer<(line: string) => number | null>(
        'pages/LogsPage.tsx',
        'lineTimestampSeconds',
        {
            LOG_LINE_TIMESTAMP_REGEX: regex,
            parseLogTimestamp,
        },
    )
    const overlap = sourceInitializer<(lines: string[], after: number) => number>(
        'pages/LogsPage.tsx',
        'overlapLineLimit',
        {
            lineTimestampSeconds: seconds,
            cursorSeconds: sourceInitializer(
                'pages/LogsPage.tsx',
                'cursorSeconds',
                {
                    numberFromValue: sourceInitializer(
                        'pages/LogsPage.tsx',
                        'numberFromValue',
                        {},
                    ),
                },
            ),
        },
    )
    for (const timestamp of ['2026-10-23 10:00:00', '2026-10-23T19:00:00.123456789+09:00']) {
        const line = `[${timestamp}] [0123456789abcdef0123456789abcdef] [info] [request.go:42] 200 | POST /v1/responses`

        const parsed = parseLogLine(line)
        expect(parsed.timestamp).toBe(timestamp)
        expect(seconds(line)).toBe(Math.floor(parseLogTimestamp(parsed.timestamp) / 1000))
        expect(overlap([line], seconds(line)! - 1)).toBe(1)
        expect(overlap([line], seconds(line)!)).toBe(0)
        expect(parsed.requestId).toBe('0123456789abcdef0123456789abcdef')
    }
})

test('plugin API errors retain their concrete message alongside their stable code and status', async () => {
    const Client = apiClient.constructor as new () => typeof apiClient
    const client = new Client()
    client.setConfig({ apiBase: 'https://fixture.invalid', sessionToken: 'synthetic' })
    const instance            = (client as unknown as { instance: AxiosInstance }).instance
    instance.defaults.adapter = async (config) => {
        throw new AxiosError('Request failed', axios.AxiosError.ERR_BAD_REQUEST, config, undefined, {
            data: {
                error: 'invalid_plugin_config',
                message: 'threads must be an integer',
                code: 'PLUGIN_CONFIG_INVALID',
            },
            status: 400, statusText: 'Bad Request', headers: {}, config,
        })
    }
    let error: unknown
    try {
        await client.get('/plugins/fixture/config')
    } catch (caught: unknown) {
        error = caught
    }
    expect(error).toMatchObject({
                                    message: 'invalid_plugin_config: threads must be an integer',
                                    status: 400,
                                    backendCode: 'PLUGIN_CONFIG_INVALID',
                                })
})

test('Meta and xAI provider configurations are visible, searchable and editable through the YAML codec', () => {
    // cspell:ignoreRegExp /\\n(?=xai-api-key:)/g
    const yaml      = (
        'meta-api-key:\n  - api-key: synthetic-meta\n    priority: 1\n' +
        'xai-api-key:\n  - api-key: synthetic-xai\n    priority: 2\n'
    )
    const decoded   = decodeVisualConfigYaml(yaml)
    const providers = parse(decoded.values.providerConfigText)
    expect(providers['meta-api-key'][0].priority).toBe(1)
    expect(providers['xai-api-key'][0].priority).toBe(2)
    providers['meta-api-key'][0].priority = 4
    providers['xai-api-key'][0].priority  = 5
    const next                            = { ...decoded.values, providerConfigText: stringify(providers) }
    const saved                           = parse(encodeVisualConfigYaml(
        yaml,
        next,
        decoded.values,
        decoded.apiKeysStorage,
        yaml,
    ))
    expect(saved['meta-api-key'][0].priority).toBe(4)
    expect(saved['xai-api-key'][0].priority).toBe(5)
    for (const key of ['meta-api-key', 'xai-api-key']) {
        expect(searchConfigFields(key, (value) => value).some((entry) => entry.fieldId === 'providerConfig')).toBe(true)
    }
})

test('Claude cache-user-id preserves true, false, null and inheritance from API through editing and PATCH', () => {
    for (const value of [true, false, null, undefined]) {
        const config = normalizeProviderKeyConfig({
                                                      'api-key': 'synthetic',
                                                      cloak: {
                                                          mode: 'always', ...(value !== undefined ?
                                                              { 'cache-user-id': value } :
                                                              {}),
                                                      },
                                                  })!
        expect(config.cloak?.cacheUserId).toBe(value)
        const signature = sourceInitializer<(cloak: typeof config.cloak) => { cacheUserId: boolean | null }>(
            'pages/AiProvidersClaudeEditLayout.tsx',
            'normalizeCloakConfig',
            {},
        )(
            config.cloak)
        expect(signature.cacheUserId).toBe(value ?? null)
        let form     = { cloak: config.cloak! }
        const select = sourceExpression<ReactElement<{ value: string; onChange: (next: string) => void }>>(
            'pages/AiProvidersClaudeEditPage.tsx',
            (node, tree) => ts.isJsxSelfClosingElement(node) &&
                            node.tagName.getText(tree) ===
                            'Select' &&
                            node.getText(tree).includes('form.cloak.cacheUserId'),
            {
                React, Select: 'select', form, controlsDisabled: false, t: (key: string) => key,
                setForm: (update: (previous: typeof form) => typeof form) => {
                    form = update(form)
                },
            },
        )
        expect(select.props.value).toBe(value === undefined || value === null ? 'inherit' : String(value))
        select.props.onChange('false')
        expect(form.cloak.cacheUserId).toBe(false)
        select.props.onChange('inherit')
        expect(form.cloak.cacheUserId).toBeNull()
        const patch = buildClaudeConfigPatchPayload({
                                                        ...config,
                                                        cloak: {
                                                            ...config.cloak,
                                                            cacheUserId: value === false,
                                                        },
                                                    }, config)
        expect(patch.cloak).toMatchObject({ 'cache-user-id': value === false })
        expect(buildClaudeConfigPatchPayload(
            { ...config, cloak: { ...config.cloak, cacheUserId: null } },
            { ...config, cloak: { ...config.cloak, cacheUserId: true } },
        ).cloak).toMatchObject({ 'cache-user-id': null })
    }
})

test(
    (
        'every provider exclusion consumer preserves a comma inside a ' +
        'rule while ordinary text lists keep their delimiter contract'
    ),
    () => {
        expect(parseTextList('alpha,beta')).toEqual(['alpha', 'beta'])
        for (const page of
            [
                'AiProvidersMetaEditPage',
                'AiProvidersClaudeEditLayout',
                'AiProvidersInteractionsEditPage',
                'AiProvidersCodexEditPage',
                'AiProvidersGeminiEditPage',
                'AiProvidersXAIEditPage',
            ]) {
            const file                = `pages/${page}.tsx`
            const source              = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')
            const tree                = ts.createSourceFile(
                file,
                source,
                ts.ScriptTarget.Latest,
                true,
                ts.ScriptKind.TSX,
            )
            const positions: number[] = []
            const visit               = (node: ts.Node) => {
                if (ts.isCallExpression(node) &&
                    node.expression.getText(tree) ===
                    'parseTextList' &&
                    node.arguments[0]?.getText(tree).includes('excludedText')) {
                    positions.push(node.getStart(tree))
                }
                ts.forEachChild(node, visit)
            }
            visit(tree)
            expect(positions.length).toBeGreaterThan(0)
            for (const position of positions) {
                expect(sourceExpression<string[]>(
                    file,
                    (node, currentTree) => ts.isCallExpression(node) &&
                                           node.getStart(currentTree) ===
                                           position,
                    {
                        form: { excludedText: 'a,b\nClaude-*' }, parseTextList,
                    },
                )).toEqual(['a,b', 'Claude-*'])
            }
        }
    },
)

test(
    'the trace loader keeps the UTC window for exact matches and nearby candidates in a non-UTC timezone',
    async () => {
        const previousTimezone = process.env.TZ
        try {
            process.env.TZ = 'Asia/Tokyo'
            expect(new Date('2026-10-23T10:00:00Z').getTimezoneOffset()).toBe(-540)
            const file               = 'pages/hooks/useTraceResolver.ts'
            const eventToTraceDetail = sourceInitializer<(
                event: UsageEvent,
                line: ParsedLogLine,
                path: string,
            ) => UsageDetailWithEndpoint>(file, 'eventToTraceDetail', {
                parseLogTimestamp,
                // noinspection JSUnusedGlobalSymbols
                'buildEndpointLabel': (_line: ParsedLogLine, path: string) => path,
            })
            const requestId          = '0123456789abcdef0123456789abcdef'
            const event: UsageEvent  = {
                timestamp: '2026-10-23T10:00:00Z',
                model: 'synthetic',
                source: 'synthetic',
                auth_index: '1',
                api_key: 'synthetic',
                request_id: requestId,
                failed: false,
                tokens: { input_tokens: 5, output_tokens: 3, cached_tokens: 0, reasoning_tokens: 0, total_tokens: 8 },
            }
            for (const timestamp of ['2026-10-23 10:00:00', '2026-10-23T10:00:00Z', '2026-10-23T19:00:00+09:00']) {
                const line = parseLogLine(`[${timestamp}] [${requestId}] [info] [request.go:42] 200 | POST /v1/responses`)

                const queries: EventsParams[]          = []
                let details: UsageDetailWithEndpoint[] = []
                let exactUnavailable                   = false
                let serverSupportsExactLookup          = true
                const nearby                           = {
                    ...event,
                    request_id: requestId.toUpperCase(),
                    timestamp: '2026-10-23T10:00:01Z',
                }
                const lookupTraceEvents                = sourceCallback(file, 'lookupTraceEvents', {
                    TRACE_LOOKUP_WINDOW_MS: 120000, TRACE_MAX_CANDIDATES: 5, TRACE_EVENT_PAGE_SIZE: 500,
                    usageApi: {
                        getEvents: async (query: EventsParams) => {
                            queries.push(query)
                            return serverSupportsExactLookup && query.request_id
                                   ? { events: [event], request_id_filter: query.request_id }
                                   : { events: [nearby] }
                        },
                    },
                })

                const load                = sourceCallback<(line: ParsedLogLine) => Promise<void>>(
                    file,
                    'loadTraceUsageDetailsInternal',
                    {
                        traceScopeKey: 'fixture',
                        traceScopeKeyRef: { current: 'fixture' },
                        latestTraceScopeKeyRef: { current: 'fixture' },
                        traceRequestIdRef: { current: 0 },
                        traceRequestHomeIpRef: { current: '' },
                        traceAuthLoadedAtRef: { current: Date.now() },
                        TRACE_AUTH_CACHE_MS: 60000,
                        TRACE_REQUEST_LOG_LINES: 300,
                        lookupTraceEvents,
                        apiClient: { getAuthGeneration: () => 1 },
                        parseLogTimestamp,
                        // noinspection JSUnusedGlobalSymbols
                        'normalizeTracePath': (path: string) => path,
                        // noinspection JSUnusedGlobalSymbols
                        'createRouteDecisionTraceState': () => ({}),
                        // noinspection JSUnusedGlobalSymbols
                        'requestLogPreviewState': () => ({}),
                        // noinspection JSUnusedGlobalSymbols
                        'requestLogFailureState': () => ({}),
                        setTraceAuthFileMap: noop,
                        setTraceError: (error: string) => expect(error).toBe(''),
                        setTraceExactLookupUnavailable: (value: boolean) => {
                            exactUnavailable = value
                        },
                        setTraceLoading: noop,
                        setRouteDecisionTrace: noop,
                        setRequestLogHomeIp: noop,
                        // noinspection JSUnusedGlobalSymbols
                        'setTraceUsageDetails': (value: UsageDetailWithEndpoint[]) => {
                            details =
                                value
                        },
                        eventToTraceDetail,
                        logsApi: { previewRequestLogById: async () => ({ requestLogHomeIp: '' }) },
                        authFilesApi: {
                            list: async () => {
                                throw new Error('Fresh auth cache must avoid another request')
                            },
                        },
                        getErrorMessage: (error: Error) => error.message,
                    },
                )
                const range: EventsParams = {
                    from: '2026-10-23T09:58:00.000Z', to: '2026-10-23T10:02:00.000Z',
                    page: 1, sort: 'timestamp', order: 'desc',
                }
                const exactQuery          = { ...range, page_size: 5, request_id: requestId }
                await load(line)
                expect(queries).toEqual([exactQuery])
                expect(exactUnavailable).toBe(false)
                expect(details[0]?.__timestampMs).toBe(Date.parse(event.timestamp))
                const candidates = () => sourceCallback<() => Array<{
                    timeDeltaMs: number;
                    requestIdMatched: boolean
                }>>(
                    file,
                    'traceCandidates',
                    {
                        traceLogLine: line,
                        traceUsageDetails: details,
                        parseLogTimestamp,
                        TRACE_MAX_CANDIDATES: 5,
                        // noinspection JSUnusedGlobalSymbols
                        'extractModelFromMessage': () => undefined,
                    },
                )()
                expect(candidates()).toMatchObject([{ timeDeltaMs: 0, requestIdMatched: true }])

                serverSupportsExactLookup = false
                queries.length            = 0
                await load(line)
                expect(queries).toEqual([exactQuery, { ...range, page_size: 500 }])
                expect(exactUnavailable).toBe(true)
                expect(candidates()).toMatchObject([{ timeDeltaMs: 1000, requestIdMatched: false }])
            }
        } finally {
            if (previousTimezone === undefined) {
                delete process.env.TZ
            } else {
                process.env.TZ = previousTimezone
            }
        }
    },
)

test('both activity trend builders consume the selected timezone through the rendered chart callback', () => {
    for (const { time, labels } of [
        {
            time: '2026-10-23T23:00:00Z',
            labels: { UTC: '10-23 23:00', 'Asia/Tokyo': '10-24 08:00', 'America/Los_Angeles': '10-23 16:00' },
        },
        {
            time: '2026-10-24T00:00:00Z',
            labels: { UTC: '2026-10-24', 'Asia/Tokyo': '2026-10-24', 'America/Los_Angeles': '2026-10-23' },
        },
    ]) {
        const summary = {
            time_series: [
                {
                    time,
                    requests: 2,
                    cost: 0.003,
                    tokens: { input: 10, output: 5, cached: 3, reasoning: 1, total: 19 },
                },
            ],
        } as unknown as UsageSummary
        for (const [timezone, label] of Object.entries(labels)) {
            for (const metric of ['requests', 'tokens', 'cost', 'token_breakdown']) {
                const data = sourceCallback<() => ReturnType<typeof buildChartDataFromSummary>>(
                    'components/usage/UnifiedTrendChart.tsx',
                    'chartData',
                    {
                        summary, metric, timezone, chartDimension: 'total', aliases: undefined, t: (key: string) => key,
                        buildChartDataFromSummary, summaryToApiKeyStats,
                        // noinspection JSUnusedGlobalSymbols
                        'buildTokenBreakdownChartData': buildTokenBreakdownChartData,
                    },
                )()
                expect(data.labels).toEqual([label])
                const values = metric === 'requests' ?
                    [2] :
                               metric === 'tokens' ? [19] : metric === 'cost' ? [0.003] : [10, 5, 3, 1]
                expect(data.datasets.map((dataset) => dataset.data)).toEqual(values.map((value) => [value]))
            }
        }
    }
})
