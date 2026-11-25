import {Sheet, type SheetColumn} from '@/components/common/Sheet'
import {Button} from '@/components/ui/Button'
import {Select} from '@/components/ui/Select'
import {
    createUsageEventExport,
    USAGE_EVENT_EXPORT_PAGE_SIZE,
    UsageEventExportLimitError,
} from '@/components/usage/usageEventExport'
import i18n from '@/i18n'
import {apiClient} from '@/services/api/client'
import {
    type EventsParams,
    type EventsResponse,
    type PricingReceipt,
    REQUEST_SPEEDS,
    usageApi,
    type UsageEvent,
} from '@/services/api/usage'
import {formatDateTime, formatNumber, maskApiKey} from '@/utils/format'
import {buildSourceInfoMap, resolveSourceDisplay} from '@/utils/sourceResolver'
import {
    extractLatencyMs,
    formatDurationMs,
    formatThinkingLabel,
    isNoThinkingUsage,
    normalizeUsageThinking,
    resolveUsageTokenMetrics,
} from '@/utils/usage'
import {expect, spyOn, test} from 'bun:test'
import {createInstance} from 'i18next'
import {readFileSync} from 'node:fs'
import React, {type ReactElement, type ReactNode} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {compile} from 'sass'
import ts from 'typescript'
import {sourceCallback, sourceExpression, sourceInitializer} from './sourceCallbacks'

const file            = 'components/usage/RequestEventsDetailsCard.tsx'
const styles          = new Proxy<Record<string, string>>({}, { get: (_target, key) => String(key) })
const noop            = () => {
}
const fixturePassword = 'fixture-password'
type Row = {
    id: string
    model: string
    clientModel: string
    upstreamUrl: string
    upstreamModel: string
    responseModel: string
    responseProvider: string
    responseProviderSource: string
    requestServiceTier: string
    responseServiceTier: string
    requestSpeed: string
    responseSpeed: string
    speed: string
    speedLabel: string
    speedSource: string
    speedSourceLabel: string
    costReason: string
    pricingReceiptTitle: string
}
const helpers: Record<string, unknown> = {
    resolveSourceDisplay, formatDateTime, formatNumber, maskApiKey,
    extractLatencyMs, formatDurationMs, formatThinkingLabel,
    isNoThinkingUsage, normalizeUsageThinking, resolveUsageTokenMetrics,
}
for (const name of [
    'channelLabel', 'numberFromValue', 'nonNegativeNumber',
    'displayApiKey', 'normalizeRequestLogState', 'formatTokenValue', 'formatPercent', 'formatThroughput',
    'formatEventCost', 'formatRequestThinkingLabel', 'resolveModelAliasRelations', 'pricingLineItemLabel',
    'formatPricingReason', 'formatPricingReceiptTitle', 'sanitizeUpstreamUrl', 'observedRequestSpeed',
]) {
    helpers[name] = sourceCallback(file, name, helpers)
}
const convert                     = sourceCallback<(...args: unknown[]) => Row>(file, 'eventToRow', helpers)
const observeSpeed                = helpers.observedRequestSpeed as (event: Partial<UsageEvent>) => {
    speed: string;
    speedSource: string
}
const sanitizeUrl                 = helpers.sanitizeUpstreamUrl as (url: string) => string
const renderDetails               = sourceCallback<(props: { row: Row; t: unknown }) => ReactElement>(
    file,
    'RequestObservationDetails',
    {
        React, Fragment: React.Fragment, styles,
        REQUEST_OBSERVATION_GROUPS: sourceInitializer(file, 'REQUEST_OBSERVATION_GROUPS', {}),
    },
)
const sourceMap                   = buildSourceInfoMap({})
const t                           = (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key
const baseEvent: UsageEvent       = {
    timestamp: '2026-11-18T01:00:00Z', model: 'routed-model', provider: 'codex',
    source: '', auth_index: '', api_key: '', completed: true, failed: false,
    tokens: { input_tokens: 2, output_tokens: 1, cached_tokens: 0, reasoning_tokens: 0, total_tokens: 3 },
}
const defaultEvents: UsageEvent[] = [
    {
        ...baseEvent, request_id: 'tier-downgrade', client_model: 'client-alias',
        upstream_url: 'https://upstream.example.test/v1/responses?region=test',
        upstream_model: 'forwarded-model', response_model: 'returned-model',
        response_provider: 'reported-channel', response_provider_source: 'body.response.provider',
        request_service_tier: 'priority', response_service_tier: 'default',
    },
    {
        ...baseEvent, request_id: 'claude-fast', provider: 'claude', executor_type: 'ClaudeExecutor',
        client_model: 'client-alias', upstream_url: 'https://upstream.example.test/v1/messages',
        upstream_model: 'forwarded-model', response_model: 'returned-model',
        response_provider: 'reported-channel', response_provider_source: 'header.X-Upstream-Provider',
        request_service_tier: 'default', response_service_tier: 'standard',
        request_speed: 'fast', response_speed: 'fast',
    },
    { ...baseEvent, request_id: 'legacy-unknown', request_service_tier: 'priority' },
    {
        ...baseEvent, request_id: 'failed-attempt',
        upstream_url: 'https://upstream.example.test/v1/responses', upstream_model: 'forwarded-model',
        failed: true, completed: false, request_service_tier: 'priority',
    },
]
const fixture: EventsResponse     = process.env.CPA_DETAILS_FIXTURE
                                    ?
                                    JSON.parse(readFileSync(process.env.CPA_DETAILS_FIXTURE, 'utf8'))
                                    :
    { events: defaultEvents, total: defaultEvents.length, page: 1, page_size: 50, total_pages: 1 }
const rowFor                      = (event: UsageEvent, translate: unknown = t) => convert(
    event, 0, sourceMap, new Map(), 'en', 'No API key', 'Not recorded', new Map(), translate,
)
const speedCases                  = [
    [{ request_service_tier: 'priority' }, 'unknown'],
    [{ request_service_tier: 'priority', response_service_tier: 'default' }, 'standard'],
    [{ request_service_tier: 'default', response_service_tier: 'priority' }, 'fast'],
    [{ request_service_tier: 'ultrafast', response_service_tier: 'ultrafast' }, 'ultrafast'],
    [{ response_service_tier: 'unrecognized' }, 'unknown'],
    [{ response_service_tier: 'priority', failed: true }, 'fast'],
    [{ provider: 'claude', request_speed: 'fast', response_service_tier: 'priority' }, 'unknown'],
    [{ executor_type: 'ClaudeExecutor', response_service_tier: 'priority' }, 'unknown'],
    [{ provider: 'claude', response_speed: 'fast', response_service_tier: 'standard' }, 'fast'],
    [
        {
            provider: 'claude', request_speed: 'fast', response_speed: 'standard',
            response_service_tier: 'priority',
        },
        'standard',
    ],
] as const
const rawUpstreamUrl              = 'https://name:synthetic-password@upstream.example.test/v1/responses?' +
                                    'api%5Fkey=synthetic-key&accessToken=synthetic-token&X-Amz-Signature=synthetic-signature&region=test#private'

function columns(translate: unknown, select: (row: Row | null) => void = noop, current: Row | null = null) {
    return sourceCallback<() => SheetColumn<Row>[]>(file, 'requestEventColumns', {
        React, styles, t: translate, Button, requestDetails: current,
        setRequestDetails: (update: Row | null | ((value: Row | null) => Row | null)) =>
            select(typeof update === 'function' ? update(current) : update),
        renderSortableHeader: (_field: string, label: string) => label,
        identityLabel: 'Identity', apiKeyLabel: 'API Key', requestLogLabel: 'Request log',
        missingMetadataTitle: 'Missing', notRecordedLabel: 'Not recorded',
        requestLogPreviewing: new Set(), requestLogDownloading: new Set(),
        previewRequestLog: noop, downloadRequestLog: noop,
        requestLogStateLabel: sourceCallback(file, 'requestLogStateLabel', {}),
        renderFailedNoUsage: sourceCallback(file, 'renderFailedNoUsage', {}),
    })()
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

async function locale(language: string) {
    const instance    = createInstance()
    const translation = JSON.parse(readFileSync(
        new URL(`../src/i18n/locales/${language}.json`, import.meta.url), 'utf8',
    ))
    await instance.init({
                            lng: language,
                            fallbackLng: false,
                            resources: { [language]: { translation } },
                        })
    return instance
}

async function exportFixture(format: 'json' | 'csv', response: EventsResponse = fixture) {
    let output: Blob | undefined
    const exportEvents = sourceCallback<(format: string, backupPassword: string) => Promise<void>>(
        file,
        'exportEvents',
        {
            apiClient,
            exportControllerRef: { current: null },
            setExportingFormat: noop,
            sourceInfoMap: sourceMap,
            authFileMap: new Map(),
            i18n: { language: 'en' },
            noApiKeyLabel: '',
            notRecordedLabel: '',
            modelAliasLookup: new Map(),
            t,
            aliases: {},
            eventToRow: convert,
            observedRequestSpeed: helpers.observedRequestSpeed,
            createUsageEventExport,
            UsageEventExportLimitError,
            USAGE_EVENT_EXPORT_PAGE_SIZE,
            USAGE_EVENT_CSV_HEADER: sourceInitializer(
                file,
                'USAGE_EVENT_CSV_HEADER',
                {},
            ),
            usageApi: { getEvents: async () => response },
            buildExportParams: () => ({ page: 1 }),
            normalizeUsageThinking,
            sanitizeUpstreamUrl: sanitizeUrl,
            encodeCsv: sourceInitializer(
                file,
                'encodeCsv',
                {},
            ),
            downloadBlob: ({ blob }: {
                blob: Blob
            }) => {
                output = blob
            },
            showNotification: (
                message: string,
                kind: string,
            ) => {
                if (kind ===
                    'error') {
                    throw new Error(message)
                }
            },
        },
    )
    await exportEvents(format, fixturePassword)
    return output!.text()
}

test('R-711 tier confirmation, downgrade, unknown and Claude speed remain independent', () => {
    for (const [event, expected] of speedCases) {
        expect(observeSpeed(event).speed).toBe(expected)
    }
})

test('R-711 / R-712 real API events reach the actual row and Sheet cells', async () => {
    const getEvents = sourceCallback<(params: object) => Promise<EventsResponse>>(
        'services/api/usage.ts', 'getEvents', {
            apiClient: {
                get: async (path: string) => {
                    expect(path).toContain('view=compact')
                    return fixture
                },
            },
            appendQueryValues: noop, USAGE_TIMEOUT_MS: 30_000,
        },
    )
    const received  = await getEvents({ view: 'compact' })
    const rows      = received.events.map((event) => rowFor(event))
    expect(rows).toHaveLength(4)
    expect(rows.map((row) => row.speed)).toEqual(['standard', 'fast', 'unknown', 'unknown'])
    expect(rows[0]).toMatchObject({
                                      model: 'routed-model',
                                      clientModel: 'client-alias',
                                      upstreamModel: 'forwarded-model',
                                      responseModel: 'returned-model',
                                      requestServiceTier: 'priority',
                                      responseServiceTier: 'default',
                                  })
    const visible = columns(t).filter((column) => ['model', 'speed', 'upstream', 'identity'].includes(column.key))
    const html    = renderToStaticMarkup(
        <Sheet rows={rows} columns={visible} rowKey={(row) => row.id} status='ready' />,
    )
    expect(html).toContain('standard')
    expect(html).toContain('fast')
    expect(html).toContain('unknown')
    expect(html).toContain('upstream.example.test')
    expect(html).not.toContain('/v1/responses')
    const details = renderToStaticMarkup(renderDetails({ row: rows[0], t }))
    expect(details).toContain('Requested tier</dt><dd>priority')
    expect(details).toContain('Returned tier</dt><dd>default')
    expect(details).toContain('upstream.example.test')
})

test(
    'request summary exposes reasoning, returned service class, performance, token splits and cost before expansion',
    async () => {
        const instance  = await locale('zh-CN')
        const translate = instance.t.bind(instance)
        const row       = rowFor({
                                     ...baseEvent,
                                     metadata_recorded: true,
                                     reasoning_effort: 'xhigh',
                                     request_service_tier: 'priority',
                                     response_service_tier: 'default',
                                     upstream_url: rawUpstreamUrl,
                                     total_duration_ms: 4000,
                                     time_to_first_byte_ms: 250,
                                     cost: 0.0123,
                                     cost_status: 'partial',
                                     cost_reason: 'Full pricing explanation belongs in details',
                                     tokens: {
                                         input_tokens: 1000,
                                         output_tokens: 100,
                                         reasoning_tokens: 25,
                                         cached_tokens: 700,
                                         cache_read_tokens: 700,
                                         cache_write_tokens: 10,
                                         total_tokens: 1100,
                                     },
                                 }, translate)
        const summary   = renderToStaticMarkup(<Sheet rows={[row]} columns={columns(translate)}
                                                      rowKey={(value) => value.id} status='ready' />)
        for (const text of [
            '推理设置', 'xhigh', '处理模式', '普通', '申请档位', 'priority',
            '首字耗时', '响应吞吐', '25 tok/s', '总Token数', '1,100', '输入', '1,000', '输出',
            '思考', '缓存读', '700', '缓存写', '缓存命中', '70%', '0.0123', 'upstream.example.test',
        ]) {
            expect(summary).toContain(text)
        }
        for (const hidden of [
            '标准 Standard', 'Full pricing explanation belongs in details',
            '/v1/responses', 'synthetic-password', 'synthetic-token', 'synthetic-key', 'synthetic-signature',
        ]) {
            expect(summary).not.toContain(hidden)
        }
        expect(renderToStaticMarkup(renderDetails({ row, t: translate })))
            .toContain('Full pricing explanation belongs in details')
    },
)

test('summary keeps unrecorded performance explicit instead of displaying measured zero', () => {
    const row  = rowFor(baseEvent)
    const html = renderToStaticMarkup(<Sheet rows={[row]} columns={columns(t)}
                                             rowKey={(value) => value.id} status='ready' />)
    expect(html).toContain('Not recorded')
    expect(html).toContain('unknown')
    expect(html).not.toContain('0 tok/s')
    expect(html).not.toContain('0ms')
    const measured = rowFor({ ...baseEvent, latency_ms: 0 })
    expect(measured).toMatchObject({ latencyMs: 0, latencyLabel: '0ms' })
    expect(renderToStaticMarkup(renderDetails({ row: measured, t }))).toContain('0ms')
})

test('R-712 each request expands into a full-width detail row and collapses without fetching history', () => {
    const row                               = rowFor(fixture.events[0])
    const selected: { current: Row | null } = { current: null }
    const select                            = (value: Row | null) => {
        selected.current = value
    }
    const action                            = elements(columns(t, select).find((column) => column.key ===
                                                                                           'details')!.cell(row))
        .find((element) => element.type === Button)!
    expect(action.props['aria-expanded']).toBe(false)
    ;(action.props.onClick as () => void)()
    expect(selected.current).toBe(row)
    const actualColumns = columns(t, select, selected.current)
    expect(actualColumns.map((column) => column.key)).toEqual([
                                                                  'timestamp',
                                                                  'model',
                                                                  'identity',
                                                                  'result',
                                                                  'tokens',
                                                                  'details',
                                                              ])
    const renderRow = sourceCallback<(row: Row) => ReactElement>(file, 'renderRequestEventRow', {
        React, Fragment: React.Fragment, styles, requestDetails: selected.current, requestEventColumns: actualColumns,
        RequestObservationDetails: renderDetails, renderRequestLog: () => null, requestLogLabel: 'Request log', t,
    })
    const html      = renderToStaticMarkup(<Sheet rows={[row]} columns={actualColumns} rowKey={(value) => value.id}
                                                  status='ready' renderRow={renderRow} />)
    expect(html).toContain('colSpan="6"')
    expect(html).toContain('aria-expanded="true"')
    expect(html).toContain('Reported by upstream')
    expect(html).toContain('body.response.provider')
    const collapse = elements(actualColumns.find((column) => column.key === 'details')!.cell(row))
        .find((element) => element.type === Button)!
    ;(collapse.props.onClick as () => void)()
    expect(selected.current).toBeNull()
})

test('R-712 every locale renders provenance, independent speed and a missing historical next hop', async () => {
    for (const language of ['en', 'ru', 'zh-CN', 'zh-TW']) {
        const instance  = await locale(language)
        const translate = instance.t.bind(instance)
        const row       = rowFor(fixture.events[1], translate)
        const html      = renderToStaticMarkup(renderDetails({ row, t: translate }))
        for (const key of [
            'cpa_observed', 'upstream_reported', 'client_model', 'upstream_url', 'upstream_model',
            'response_model', 'response_provider', 'response_provider_source', 'next_hop',
        ]) {
            const value = translate(`usage_stats.request_events_${key}`)
            expect(value).not.toStartWith('usage_stats.')
            expect(html).toContain(value)
        }
        for (const value of [
            'client-alias', 'forwarded-model', 'returned-model', 'reported-channel',
            'header.X-Upstream-Provider', 'standard', 'fast',
        ]) {
            expect(html).toContain(value)
        }
        expect(html).toContain('Not recorded')
        expect(html).not.toContain('next-hop.example')
    }
})

test('final response URL is distinct, sanitized and shown under CPA observations in every locale', async () => {
    const finalUrl = rawUpstreamUrl.replace('upstream.example.test', 'final.example.test')
    for (const language of ['en', 'ru', 'zh-CN', 'zh-TW']) {
        const instance  = await locale(language)
        const translate = instance.t.bind(instance)
        const row       = rowFor({
                                     ...baseEvent, upstream_url: rawUpstreamUrl, response_url: finalUrl,
                                     response_url_status: 'observed', response_url_source: 'http_response_request_url',
                                     upstream_next_hop_status: 'not_reported', cache_read_reported: true,
                                 }, translate)
        const summary   = renderToStaticMarkup(<Sheet rows={[row]} columns={columns(translate)}
                                                      rowKey={(value) => value.id} status='ready' />)
        const details   = renderToStaticMarkup(renderDetails({ row, t: translate }))
        expect(summary).toContain('upstream.example.test')
        expect(summary).toContain('final.example.test')
        expect(summary).not.toContain('/v1/responses')
        expect(details).toContain('https://final.example.test/v1/responses')
        expect(details).toContain(translate('usage_stats.request_events_response_url_source_http'))
        expect(details).toContain(translate('usage_stats.request_events_next_hop_not_reported'))
        expect(summary + details).not.toContain('synthetic-')
        expect(details.indexOf('https://final.example.test/v1/responses'))
            .toBeLessThan(details.indexOf(translate('usage_stats.request_events_upstream_reported')))
    }
})

test(
    'missing final URLs show their recorded reason and established connections retain handshake evidence',
    async () => {
        const instance  = await locale('zh-CN')
        const translate = instance.t.bind(instance)
        for (const [status, key] of [
            ['no_response', 'no_response'], ['unavailable', 'unavailable'],
            ['not_provided', 'not_provided'], ['connection_reused', 'connection_reused'],
        ] as const) {
            const row  = rowFor({ ...baseEvent, response_url_status: status }, translate)
            const html = renderToStaticMarkup(renderDetails({ row, t: translate }))
            expect(html).toContain(translate(`usage_stats.request_events_response_url_${key}`))
        }
        const reused = rowFor({
                                  ...baseEvent,
                                  response_url: 'wss://final.example.test/stream',
                                  response_url_status: 'observed',
                                  response_url_source: 'ws_connection_handshake_url',
                              }, translate)
        const html   = renderToStaticMarkup(renderDetails({ row: reused, t: translate }))
        expect(html).toContain('wss://final.example.test/stream')
        expect(html).toContain(translate('usage_stats.request_events_response_url_source_connection'))
    },
)

test('reported cache miss, reported hit and absent cache evidence remain distinct', async () => {
    const instance  = await locale('zh-CN')
    const translate = instance.t.bind(instance)
    for (const [reported, read, expectedRate] of [[true, 0, 0], [true, 800, 80], [false, 0, null]] as const) {
        const row = rowFor({
                               ...baseEvent, cache_read_reported: reported,
                               tokens: {
                                   ...baseEvent.tokens,
                                   input_tokens: 1000,
                                   cache_read_tokens: read,
                                   cache_write_tokens: 0,
                               },
                           }, translate)
        expect(row).toMatchObject({ cacheReadTokens: reported ? read : null, cacheHitRate: expectedRate })
        const html = renderToStaticMarkup(renderDetails({ row, t: translate }))
        if (reported) {
            expect(html).toContain(`${expectedRate}%`)
            expect(html).not.toContain(translate('usage_stats.request_events_cache_not_reported'))
        } else {
            expect(html).toContain(translate('usage_stats.request_events_cache_not_reported'))
            expect(html).not.toContain('0%')
        }
    }
    expect(rowFor({
                      ...baseEvent, tokens: { ...baseEvent.tokens, input_tokens: 1000, cache_read_tokens: 800 },
                  })).toMatchObject({ cacheReadTokens: 800, cacheHitRate: 80 })
})

test('reported zero cache writes, positive writes and unknown write totals stay distinct', async () => {
    for (const language of ['zh-CN', 'zh-TW', 'en', 'ru']) {
        const instance  = await locale(language)
        const translate = instance.t.bind(instance)
        for (const [reported, write] of [[true, 0], [true, 200], [false, 0], [false, 200]] as const) {
            const row = rowFor({
                                   ...baseEvent, cache_read_reported: true, cache_write_reported: reported,
                                   tokens: {
                                       ...baseEvent.tokens, input_tokens: 1000, cache_read_tokens: 100,
                                       cache_write_tokens: write, cached_tokens: 100 + write,
                                   },
                               }, translate)
            expect(row).toMatchObject({
                                          cacheReadTokens: 100,
                                          cacheHitRate: 10,
                                          cacheWriteTokens: reported ? write : null,
                                          cachedTokens: reported ? 100 + write : null,
                                      })
            const html = renderToStaticMarkup(renderDetails({ row, t: translate }))
            if (reported) {
                expect(html).not.toContain(translate('usage_stats.request_events_cache_write_not_reported'))
            } else {
                expect(html).toContain(translate('usage_stats.request_events_cache_write_not_reported'))
            }
        }
    }
    expect(rowFor({ ...baseEvent, tokens: { ...baseEvent.tokens, cache_write_tokens: 200, cached_tokens: 200 } }))
        .toMatchObject({ cacheWriteTokens: 200, cachedTokens: 200 })
})

test('final response evidence and cache presence survive sanitized JSON and CSV exports', async () => {
    const event: UsageEvent = {
        ...baseEvent, upstream_url: rawUpstreamUrl,
        response_url: rawUpstreamUrl.replace('upstream.example.test', 'final.example.test'),
        response_url_status: 'observed', response_url_source: 'http_response_request_url',
        upstream_next_hop_status: 'not_reported', cache_read_reported: false, cache_write_reported: false,
    }
    const response          = { ...fixture, events: [event], total: 1, total_pages: 1 }
    for (const format of ['json', 'csv'] as const) {
        const text = await exportFixture(format, response)
        for (const field of [
            'response_url', 'response_url_source', 'response_url_status',
            'upstream_next_hop_status', 'cache_read_reported', 'cache_write_reported', 'final.example.test',
        ]) {
            expect(text).toContain(field)
        }
        expect(text).not.toContain('synthetic-')
        if (format === 'json') {
            expect(JSON.parse(text)[0]).toMatchObject({
                                                          response_url_source: 'http_response_request_url',
                                                          cache_read_reported: false,
                                                          cache_write_reported: false,
                                                      })
        }
    }
})

test('explicit event aliases win and short masks never guess between conflicting alias identities', () => {
    const aliases          = {
        'sk-a...cd78': 'First alias', 'sk-b...ef78': 'Second alias',
        'exact-safe-id': 'Exact alias', 'exact-source-id': 'Credential alias',
    }
    const convertWithAlias = (event: UsageEvent) => convert(
        event, 0, sourceMap, new Map(), 'en',
        'No API key', 'Not recorded', new Map(), t, aliases,
    ) as Row & { apiKeyMasked: string; user: string; source: string }
    expect(convertWithAlias({ ...baseEvent, api_key: 'sk...78', api_key_alias: 'Explicit alias' }).apiKeyMasked)
        .toBe('Explicit alias')
    expect(convertWithAlias({ ...baseEvent, api_key: 'sk...78' }).apiKeyMasked).toBe('sk...78')
    expect(convertWithAlias({ ...baseEvent, api_key: 'exact-safe-id', api_key_alias: '' }).apiKeyMasked).toBe(
        'Exact alias')
    expect(convertWithAlias({ ...baseEvent, source: 'exact-source-id' })).toMatchObject({
                                                                                            source: 'Credential alias',
                                                                                            user: 'Credential alias',
                                                                                        })
    expect(convertWithAlias({ ...baseEvent, source: 'sk...78' }).user).toBe('sk...78')
})

test('R-712 URL credentials are removed from the observed endpoint', () => {
    const sanitized = sanitizeUrl(rawUpstreamUrl)
    expect(sanitized).not.toContain('synthetic-')
    expect(sanitized).not.toContain('name')
    expect(sanitized).toContain('region=test')
    expect(sanitizeUrl(sanitized)).toBe(sanitized)
    expect(sanitizeUrl('javascript:alert(1)')).toBe('')
})

test('R-712 upstream self-reports stay escaped text in the actual details', () => {
    const row  = rowFor({
                            ...baseEvent,
                            upstream_url: rawUpstreamUrl,
                            response_model: '<script>alert(1)</script>',
                            response_provider: '<img src=x onerror=alert(1)>',
                        })
    const html = renderToStaticMarkup(renderDetails({ row, t }))
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('synthetic-')
})

test('R-712 structured observations also reach the existing raw-log preview', () => {
    const row     = rowFor(fixture.events[0])
    const details = sourceExpression<ReactElement>(
        file,
        (node, tree) => ts.isJsxSelfClosingElement(node) &&
                        node.tagName.getText(tree) === 'RequestObservationDetails' &&
                        node.getText(tree).includes('requestLogPreview.observations'),
        { React, RequestObservationDetails: renderDetails, requestLogPreview: { observations: row }, t },
    )
    expect(renderToStaticMarkup(details)).toContain('body.response.provider')
})

test('R-711 / R-712 actual JSON and CSV exports preserve observations and existing identity', async () => {
    for (const format of ['json', 'csv'] as const) {
        const text = await exportFixture(format)
        for (const value of [
            'request_service_tier', 'response_service_tier', 'request_speed', 'response_speed',
            'upstream_url', 'response_provider_source', 'client-alias', 'forwarded-model',
            'returned-model', 'reported-channel', 'priority', 'default',
        ]) {
            expect(text).toContain(value)
        }
        expect(text).not.toContain('synthetic-query-secret')
        if (format === 'json') {
            expect(JSON.parse(text)[0].model).toBe('routed-model')
        }
    }
})

test('R-712 existing responsive tokens compile for the added details', () => {
    const css = compile(new URL(
        '../src/components/usage/RequestEventsDetailsCard.module.scss', import.meta.url,
    ).pathname).css
    expect(css).toContain('.requestObservationDetails')
    expect(css).toContain('grid-template-columns: minmax(0, 1fr)')
    expect(css).toContain('overflow-wrap: anywhere')
    expect(css).toContain('.requestPricingReceipt')
})

test('all actual speeds preserve server precedence, raw evidence and failure independence', () => {
    for (const speed of REQUEST_SPEEDS) {
        expect(observeSpeed({ ...baseEvent, speed, response_service_tier: 'priority' })).toEqual({
                                                                                                     speed,
                                                                                                     speedSource: 'speed',
                                                                                                 })
    }
    for (const speed of REQUEST_SPEEDS.filter((value) => value !== 'unknown')) {
        for (const state of [{ failed: true }, { completed: false }, {}]) {
            expect(observeSpeed({ ...baseEvent, ...state, response_service_tier: speed })).toEqual({
                                                                                                       speed,
                                                                                                       speedSource: 'response_service_tier',
                                                                                                   })
            expect(observeSpeed({ ...baseEvent, ...state, provider: 'claude', response_speed: speed })).toEqual({
                                                                                                                    speed,
                                                                                                                    speedSource: 'response_speed',
                                                                                                                })
        }
    }
    for (const event of [
        { service_tier: 'priority' }, { request_service_tier: 'fast' },
        { provider: 'claude', response_service_tier: 'priority' },
        { executor_type: 'ClaudeExecutor', response_service_tier: 'priority' },
        { request_speed: 'fast', response_service_tier: 'priority' },
        { response_speed: 'future-speed', response_service_tier: 'priority' },
        { response_service_tier: 'constructor' }, { response_service_tier: '__proto__' },
    ]) {
        expect(observeSpeed({ ...baseEvent, ...event }).speed).toBe('unknown')
    }
    expect(observeSpeed({ ...baseEvent, speed: 'unknown', response_service_tier: 'priority' }).speed).toBe('unknown')
    for (const codePoint of [0x85, 0xa0, 0x1680, 0x2000, 0x2028, 0x3000]) {
        const whitespace = String.fromCodePoint(codePoint)
        expect(observeSpeed({ ...baseEvent, response_service_tier: `${whitespace}PrIoRiTy${whitespace}` }).speed).toBe(
            'fast')
        expect(observeSpeed({ ...baseEvent, provider: `${whitespace}Claude`, response_speed: 'ultrafast' }).speed).toBe(
            'ultrafast')
    }
    const bom = String.fromCodePoint(0xfeff)
    expect(observeSpeed({ ...baseEvent, response_service_tier: `${bom}priority` }).speed).toBe('unknown')
    expect(observeSpeed({ ...baseEvent, request_speed: bom, response_service_tier: 'priority' }).speed).toBe('unknown')
    const downgraded = rowFor({ ...baseEvent, service_tier: 'ultrafast', response_service_tier: 'default' })
    expect(downgraded).toMatchObject({
                                         speed: 'standard',
                                         requestServiceTier: 'ultrafast',
                                         responseServiceTier: 'default',
                                     })
})

test('actual usage API serializes the speed, raw export flag and cancellation signal for both exports', async () => {
    const get        = spyOn(apiClient, 'get').mockResolvedValue(fixture)
    const getRaw     = spyOn(apiClient, 'getRaw').mockResolvedValue({
                                                                        data: new Blob(['synthetic']),
                                                                        headers: {},
                                                                    } as Awaited<ReturnType<typeof apiClient.getRaw>>)
    const controller = new AbortController()
    try {
        for (const speed of REQUEST_SPEEDS) {
            get.mockResolvedValue({ ...fixture, speed_filter: speed })
            getRaw.mockResolvedValue({
                                         data: new Blob([JSON.stringify({ speed_filter: speed, usage: {} })]),
                                         headers: {},
                                     } as Awaited<ReturnType<typeof apiClient.getRaw>>)
            await usageApi.getEvents(
                { speed, page: 3, page_size: 50, status: 'failure', export: true },
                { signal: controller.signal },
            )
            const [path, config] = get.mock.calls[get.mock.calls.length - 1]
            const query          = new URL(String(path), 'https://fixture.invalid').searchParams
            expect(query.getAll('speed')).toEqual([speed])
            expect(query.get('page')).toBe('3')
            expect(query.get('status')).toBe('failure')
            expect(query.get('export')).toBe('true')
            expect(config?.signal).toBe(controller.signal)
            await usageApi.exportUsage({ speed, model: 'fixture-model' }, { signal: controller.signal })
            const [exportPath, exportConfig] = getRaw.mock.calls[getRaw.mock.calls.length - 1]
            expect(new URL(String(exportPath), 'https://fixture.invalid').searchParams.get('speed')).toBe(speed)
            expect(exportConfig?.signal).toBe(controller.signal)
        }
        await usageApi.getEvents({ speed: '' })
        expect(get.mock.calls[get.mock.calls.length - 1][0]).toBe('/usage/events')
        await usageApi.exportUsage({ speed: '' })
        expect(getRaw.mock.calls[getRaw.mock.calls.length - 1][0]).toBe('/usage/export')
    } finally {
        get.mockRestore()
        getRaw.mockRestore()
    }
})

test(
    'missing or mismatched speed-filter echoes reject list and both export actions, including empty results',
    async () => {
        const empty    = { ...fixture, events: [], total: 0 }
        const get      = spyOn(apiClient, 'get').mockResolvedValue(empty)
        const getRaw   = spyOn(apiClient, 'getRaw').mockResolvedValue({
                                                                          data: new Blob([JSON.stringify({ usage: {} })]),
                                                                          headers: {},
                                                                      } as Awaited<ReturnType<typeof apiClient.getRaw>>)
        const message  = i18n.t('usage_stats.request_events_speed_filter_unsupported')
        let downloaded = false
        try {
            for (const view of [undefined, 'compact'] as const) {
                for (const echo of [undefined, 'batch']) {
                    get.mockResolvedValue({ ...empty, speed_filter: echo })
                    await expect(usageApi.getEvents({ speed: 'fast', view })).rejects.toThrow(message)
                }
            }
            get.mockResolvedValue({ ...empty, speed_filter: 'fast' })
            expect((await usageApi.getEvents({ speed: 'fast', view: 'compact' })).total).toBe(0)
            get.mockResolvedValue(empty)
            const exportEvents = sourceCallback<(format: string, backupPassword: string) => Promise<void>>(
                file,
                'exportEvents',
                {
                    apiClient,
                    exportControllerRef: { current: null },
                    setExportingFormat: noop,
                    sourceInfoMap: sourceMap,
                    authFileMap: new Map(),
                    i18n: { language: 'en' },
                    noApiKeyLabel: '',
                    notRecordedLabel: '',
                    modelAliasLookup: new Map(),
                    t,
                    aliases: {},
                    eventToRow: convert,
                    observedRequestSpeed: helpers.observedRequestSpeed,
                    createUsageEventExport,
                    UsageEventExportLimitError,
                    USAGE_EVENT_EXPORT_PAGE_SIZE,
                    USAGE_EVENT_CSV_HEADER: sourceInitializer(
                        file,
                        'USAGE_EVENT_CSV_HEADER',
                        {},
                    ),
                    usageApi,
                    buildExportParams: () => ({
                        page: 1,
                        speed: 'fast',
                    }),
                    normalizeUsageThinking,
                    sanitizeUpstreamUrl: sanitizeUrl,
                    encodeCsv: sourceInitializer(
                        file,
                        'encodeCsv',
                        {},
                    ),
                    downloadBlob: () => {
                        downloaded =
                            true
                    },
                    showNotification: noop,
                },
            )
            await expect(exportEvents('csv', fixturePassword)).rejects.toThrow(message)
            expect(downloaded).toBe(false)
            let confirmation: Promise<void> | undefined
            const backup = sourceInitializer<(filters: object) => void>(
                'components/usage/hooks/useUsageData.ts',
                'handleExport',
                {
                    exportControllerRef: { current: null }, setExporting: noop, usageApi, t, apiClient,
                    requestBackupPassword: ({ onConfirm }: { onConfirm: (password: string) => Promise<void> }) => {
                        confirmation = onConfirm(fixturePassword)
                    },
                    downloadBlob: () => {
                        downloaded = true
                    },
                    showNotification: noop,
                },
            )
            backup({ speed: 'fast' })
            await expect(confirmation!).rejects.toThrow(`notification.download_failed: ${message}`)
            expect(downloaded).toBe(false)
            for (const body of ['not-json', JSON.stringify({ speed_filter: 'batch', usage: {} })]) {
                getRaw.mockResolvedValue({
                                             data: new Blob([body]),
                                             headers: {},
                                         } as Awaited<ReturnType<typeof apiClient.getRaw>>)
                await expect(usageApi.exportUsage({ speed: 'fast' })).rejects.toThrow(message)
            }
            const blob = new Blob([JSON.stringify({ speed_filter: 'fast', usage: { synthetic: [] } })])
            getRaw.mockResolvedValue({
                                         data: blob,
                                         headers: { 'content-disposition': 'attachment; filename="backup.json"' },
                                     } as unknown as Awaited<ReturnType<typeof apiClient.getRaw>>)
            const confirmed = await usageApi.exportUsage({ speed: 'fast' })
            expect(confirmed.data).toBe(blob)
            expect(confirmed.headers['content-disposition']).toContain('backup.json')
            get.mockResolvedValue(empty)
            expect((await usageApi.getEvents()).events).toEqual([])
            getRaw.mockResolvedValue({
                                         data: new Blob(['old-server-backup']),
                                         headers: {},
                                     } as Awaited<ReturnType<typeof apiClient.getRaw>>)
            expect(await (await usageApi.exportUsage()).data.text()).toBe('old-server-backup')
        } finally {
            get.mockRestore()
            getRaw.mockRestore()
        }
    },
)

test('the six-option filter and unchanged backup action carry speed only in the Events tab', async () => {
    for (const language of ['en', 'ru', 'zh-CN', 'zh-TW']) {
        const instance = await locale(language)
        let selected   = ''
        const view     = sourceExpression<ReactElement>('components/usage/FilterBar.tsx', (node, tree) =>
            ts.isBinaryExpression(node) && ts.isParenthesizedExpression(node.right) &&
            node.left.getText(tree) === 'selectedSpeed !== undefined && onSelectedSpeedChange', {
                                                            React,
                                                            Select,
                                                            styles,
                                                            REQUEST_SPEEDS,
                                                            selectedSpeed: 'unknown',
                                                            onSelectedSpeedChange: (value: string) => {
                                                                selected = value
                                                            },
                                                            t: instance.t.bind(instance),
                                                        })
        const select   = elements(view).find((element) => element.type === Select)!
        const options  = select.props.options as { value: string; label: string }[]
        expect(options.map((option) => option.value)).toEqual(['', ...REQUEST_SPEEDS])
        expect(options.every((option) => !option.label.startsWith('usage_stats.'))).toBe(true)
        ;(select.props.onChange as (value: string) => void)('ultrafast')
        expect(selected).toBe('ultrafast')
        expect(renderToStaticMarkup(view)).toContain(instance.t('usage_stats.request_events_actual_speed'))
    }
    for (const activeTab of ['events', 'overview']) {
        const selected = sourceExpression<string | undefined>('pages/UsagePage.tsx', (node, tree) =>
            ts.isConditionalExpression(node) && ts.isJsxExpression(node.parent) &&
            ts.isJsxAttribute(node.parent.parent) && node.parent.parent.name.getText(tree) === 'selectedSpeed', {
                                                                  activeTab, selectedEventSpeed: 'fast',
                                                              })
        expect(selected).toBe(activeTab === 'events' ? 'fast' : undefined)
        let exported: EventsParams | undefined
        const onExport = sourceExpression<() => void>('pages/UsagePage.tsx', (node, tree) =>
            ts.isArrowFunction(node) && ts.isJsxExpression(node.parent) && ts.isJsxAttribute(node.parent.parent) &&
            node.parent.parent.name.getText(tree) === 'onExport', {
                                                          activeTab,
                                                          selectedEventSpeed: 'fast',
                                                          visibleDateRange: { from: 'from', to: 'to' },
                                                          selectedModels: ['model'],
                                                          selectedApiKeys: ['client'],
                                                          selectedCredentials: ['credential'],
                                                          handleExport: (filters: EventsParams) => {
                                                              exported = filters
                                                          },
                                                      })
        onExport()
        expect(exported?.speed).toBe(activeTab === 'events' ? 'fast' : undefined)
        expect(exported).toMatchObject({
                                           from: 'from',
                                           to: 'to',
                                           model: 'model',
                                           api_key: ['client'],
                                           credential: 'credential',
                                       })
    }
    const setSpeed = () => {
    }
    const tab      = sourceCallback<(props: object) => ReactElement>('components/usage/EventsTab.tsx', 'EventsTab', {
        React, RequestEventsDetailsCard: noop,
    })({ selectedSpeed: 'batch', onSelectedSpeedChange: setSpeed })
    const card     = elements(tab).find((element) => element.props.selectedSpeed === 'batch')!
    expect(card.props.onSelectedSpeedChange).toBe(setSpeed)
    const clear = sourceInitializer<() => void>(file, 'handleClearFilters', {
        onClearFilters: undefined,
        onSelectedStatusChange: noop,
        onSelectedSpeedChange: (value: string) => expect(value).toBe(''),
        setSearchInput: noop,
        STATUS_ALL: '',
    })
    clear()
})

test('actual filter, page reset and export builder share the same server-side speed condition', () => {
    const scope  = {
        topModels: ['model-a'], topCredentials: ['credential-a'], topApiKeys: ['key,a'],
        searchQuery: 'returned', statusFilter: 'failure', speedFilter: 'ultrafast',
        sortField: 'timestampMs', sortDir: 'desc', page: 4, pageSize: 50, USAGE_EVENT_EXPORT_PAGE_SIZE,
        dateRange: { from: '2026-11-01T00:00', to: '2026-11-02T00:00' },
        effectiveDateRange: { from: '2026-11-01T00:00', to: '2026-11-02T00:00' },
        toBackendSortField: sourceCallback(file, 'toBackendSortField', {}),
        applyFilters: sourceCallback(file, 'applyFilters', {}),
    }
    const params = sourceCallback<() => EventsParams>(file, 'eventsParams', scope)()
    expect(params).toMatchObject({
                                     speed: 'ultrafast',
                                     status: 'failure',
                                     page: 4,
                                     view: 'compact',
                                     api_key: ['key,a'],
                                 })
    const exportParams = sourceCallback<(page: number) => EventsParams>(file, 'buildExportParams', scope)
    for (const page of [1, 2, 3]) {
        expect(exportParams(page)).toMatchObject({ speed: 'ultrafast', status: 'failure', page, page_size: 500 })
        expect(exportParams(page).view).toBeUndefined()
    }
    const previous = sourceInitializer<string>(file, 'pageResetSignature', { ...scope, speedFilter: 'fast' })
    const current  = sourceInitializer<string>(file, 'pageResetSignature', scope)
    expect(current).not.toBe(previous)
    const source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')
    const tree   = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    let reset    = ''
    const visit  = (node: ts.Node) => {
        if (ts.isIfStatement(node) && node.expression.getText(tree) === 'prevPageResetSig !== pageResetSignature') {
            reset = node.getText(tree)
        }
        ts.forEachChild(node, visit)
    }
    visit(tree)
    expect(reset).not.toBe('')
    let page      = 4
    let signature = previous
    new Function('prevPageResetSig', 'pageResetSignature', 'setPrevPageResetSig', 'setPage', reset)(
        previous, current, (value: string) => {
            signature = value
        }, (value: number) => {
            page = value
        },
    )
    expect(page).toBe(1)
    expect(signature).toBe(current)
    const controller = new AbortController()
    const cleanup    = sourceCallback<() => () => void>(file, 'useEffect', {
        exportControllerRef: { current: controller },
    }, 'exportControllerRef.current?.abort()')()
    cleanup()
    expect(controller.signal.aborted).toBe(true)
})

test(
    'both actual multi-page detail export formats keep the speed condition and original requested values',
    async () => {
        const buildExportParams = sourceCallback<(page: number) => EventsParams>(file, 'buildExportParams', {
            effectiveDateRange: { from: '', to: '' },
            topModels: [],
            topCredentials: [],
            topApiKeys: [],
            statusFilter: 'failure',
            speedFilter: 'ultrafast',
            searchQuery: '',
            sortField: 'timestampMs',
            sortDir: 'desc',
            USAGE_EVENT_EXPORT_PAGE_SIZE,
            applyFilters: sourceCallback(file, 'applyFilters', {}),
            toBackendSortField: sourceCallback(file, 'toBackendSortField', {}),
        })
        for (const format of ['csv', 'json'] as const) {
            const requests: EventsParams[] = []
            let downloaded: Blob | undefined
            let generation                 = 1
            let changeConnectionAfterRead  = false
            const exportEvents             = sourceCallback<(format: string, backupPassword: string) => Promise<void>>(
                file,
                'exportEvents',
                {
                    apiClient: { getAuthGeneration: () => generation },
                    exportControllerRef: { current: null }, setExportingFormat: noop,
                    sourceInfoMap: sourceMap, authFileMap: new Map(), i18n: { language: 'en' },
                    noApiKeyLabel: '', notRecordedLabel: '', modelAliasLookup: new Map(), t, aliases: {},
                    eventToRow: convert, observedRequestSpeed: helpers.observedRequestSpeed,
                    createUsageEventExport, UsageEventExportLimitError, USAGE_EVENT_EXPORT_PAGE_SIZE,
                    USAGE_EVENT_CSV_HEADER: sourceInitializer(file, 'USAGE_EVENT_CSV_HEADER', {}),
                    usageApi: {
                        getEvents: async (params: EventsParams, options: { backupPassword?: string }) => {
                            expect(options.backupPassword).toBe(fixturePassword)
                            requests.push(params)
                            if (changeConnectionAfterRead) {
                                ++generation
                            }
                            const events = Array.from({ length: params.page === 1 ? 500 : 1 }, (_, index) => ({
                                ...baseEvent, request_id: `page-${params.page}-${index}`, speed: 'ultrafast',
                                request_service_tier: 'priority', response_service_tier: 'ultrafast', failed: true,
                            }))
                            return { events, total: 501, page: params.page, page_size: 500, total_pages: 2 }
                        },
                    },
                    buildExportParams, normalizeUsageThinking, sanitizeUpstreamUrl: sanitizeUrl,
                    encodeCsv: sourceInitializer(file, 'encodeCsv', {}),
                    downloadBlob: ({ blob }: { blob: Blob }) => {
                        downloaded = blob
                    },
                    showNotification: (message: string, kind: string) => {
                        if (kind === 'error') {
                            throw new Error(message)
                        }
                    },
                },
            )
            await exportEvents(format, fixturePassword)
            expect(requests.map((params) => params.page)).toEqual([1, 2])
            for (const request of requests) {
                expect(request).toMatchObject({ speed: 'ultrafast', status: 'failure', export: true })
            }
            const text = await downloaded!.text()
            expect(text).toContain('priority')
            expect(text).toContain('ultrafast')
            expect(text).toContain('speed_observation_source')
            expect(text).toContain('page-2-0')
            if (format === 'json') {
                expect(JSON.parse(text)).toHaveLength(501)
                expect(JSON.parse(text)[500]).toMatchObject({
                                                                speed: 'ultrafast',
                                                                failed: true,
                                                                request_service_tier: 'priority',
                                                            })
            } else {
                requests.length           = 0
                downloaded                = undefined
                changeConnectionAfterRead = true
                await expect(exportEvents(format, fixturePassword)).rejects.toThrow('common.connection_changed')
                expect(requests.map((params) => params.page)).toEqual([1])
                expect(downloaded).toBeUndefined()
            }
        }
    },
)

test('reasoning settings show recorded effort or configuration without repeating token counts', async () => {
    const settings = [
        { event: { reasoning_effort: ' max ' }, label: 'max' },
        { event: { reasoning_effort: 'xhigh' }, label: 'xhigh' },
        { event: { reasoning_effort: 'none' }, label: 'none' },
        { event: { reasoning_effort: 'max', thinking: {} }, label: 'max' },
        { event: { thinking: { intensity: 'medium' } }, label: 'medium' },
        { event: { thinking: { level: 'high' } }, label: 'high' },
        { event: { thinking: { mode: 'adaptive' } }, label: 'adaptive' },
        { event: { reasoning_effort: 'max', thinking: { level: 'high' } }, label: 'high' },
    ] satisfies { event: Partial<UsageEvent>; label: string }[]
    for (const language of ['en', 'ru', 'zh-CN', 'zh-TW']) {
        const instance  = await locale(language)
        const translate = instance.t.bind(instance)
        for (const { event, label } of settings) {
            const row = rowFor({ ...baseEvent, ...event }, translate)
            expect(row).toMatchObject({ thinkingRecorded: true, thinkingLabel: label })
            expect(renderToStaticMarkup(renderDetails({ row, t: translate }))).toContain(`>${label}</dd>`)
        }
    }
    const budget = rowFor({ ...baseEvent, thinking: { mode: 'budget', budget: 4096 } })
    expect(budget).toMatchObject({ thinkingRecorded: true, thinkingLabel: '4,096' })
    for (const thinking of [{ mode: 'off' }, { budget: 0 }]) {
        expect(rowFor({ ...baseEvent, thinking })).toMatchObject({ thinkingRecorded: true, thinkingNone: true })
    }
    for (const reasoningTokens of [0, 7]) {
        const row = rowFor({
                               ...baseEvent, reasoning_effort: ' ', thinking: {},
                               tokens: {
                                   ...baseEvent.tokens,
                                   output_tokens: 10,
                                   reasoning_tokens: reasoningTokens,
                                   total_tokens: 12,
                               },
                           })
        expect(row).toMatchObject({ thinkingRecorded: false, thinkingLabel: 'Not recorded', reasoningTokens })
        const html = renderToStaticMarkup(renderDetails({ row, t }))
        expect(html).toContain('usage_stats.request_events_thinking_column</dt><dd>Not recorded')
        expect(html).toContain(`usage_stats.reasoning_tokens</dt><dd>${reasoningTokens}`)
    }
})

test('compact event effort reaches the visible reasoning settings through the actual rows callback', async () => {
    const cases    = [
        { id: 'effort-max-zero', effort: 'max', reasoning: 0 },
        { id: 'effort-max-positive', effort: 'max', reasoning: 7 },
        { id: 'effort-low-positive', effort: 'low', reasoning: 7 },
        { id: 'tokens-only', effort: '', reasoning: 7 },
    ]
    const response = process.env.CPA_REASONING_SETTINGS_FIXTURE
                     ? JSON.parse(readFileSync(process.env.CPA_REASONING_SETTINGS_FIXTURE, 'utf8'))
                     : {
            events: cases.map(({ id, effort, reasoning }) => ({
                ...baseEvent, request_id: id, reasoning_effort: effort,
                tokens: { ...baseEvent.tokens, output_tokens: 10, reasoning_tokens: reasoning, total_tokens: 12 },
            })),
        }
    const get      = spyOn(apiClient, 'get').mockResolvedValue(response)
    try {
        const eventsData = await usageApi.getEvents({ view: 'compact' })
        expect(get.mock.calls[0]?.[0]).toBe('/usage/events?view=compact')
        expect(eventsData.events).toHaveLength(cases.length)
        for (const language of ['en', 'ru', 'zh-CN', 'zh-TW']) {
            const instance         = await locale(language)
            const translate        = instance.t.bind(instance)
            const notRecordedLabel = translate('usage_stats.request_events_not_recorded')
            const rows             = sourceCallback<() => Row[]>(file, 'rows', {
                enabled: true, eventsData, eventToRow: convert, sourceInfoMap: sourceMap,
                authFileMap: new Map(), i18n: { language }, noApiKeyLabel: '', notRecordedLabel,
                modelAliasLookup: new Map(), t: translate, aliases: {},
            })()
            for (const [index, { id, effort, reasoning }] of cases.entries()) {
                expect(eventsData.events[index].request_id).toBe(id)
                expect(rows[index]).toMatchObject({
                                                      thinkingLabel: effort || notRecordedLabel,
                                                      thinkingRecorded: Boolean(effort),
                                                      reasoningTokens: reasoning,
                                                      totalTokens: 12,
                                                  })
            }
            const html = rows.map((row) => renderToStaticMarkup(renderDetails({ row, t: translate }))).join('')
            expect(html).toContain(instance.t('usage_stats.request_events_thinking_column'))
            expect(html).toContain('>max</dd>')
            expect(html).toContain('>low</dd>')
            expect(html).toContain(`${instance.t('usage_stats.reasoning_tokens')}</dt><dd>7`)
        }
    } finally {
        get.mockRestore()
    }
})

test('cost summaries stay short while expanded details show complete explanations and request-time receipts', () => {
    const css  = compile(new URL(
        '../src/components/usage/RequestEventsDetailsCard.module.scss', import.meta.url,
    ).pathname).css
    const rule = css.match(/\.requestEventsCostReason\s*\{([^}]+)}/)?.[1] ?? ''
    expect(rule).toContain('white-space: pre-wrap')
    expect(rule).not.toContain('line-clamp')
    const receipt    = {
        schema_version: 2, captured_at: baseEvent.timestamp, priced_at: baseEvent.timestamp,
        provider: 'codex', model: 'routed-model', canonical_model: 'priced-model', source: 'synthetic-price-source',
        price_revision: 'request-time-price-revision', currency: 'USD', cost_micro: 1_000_000, cost_status: 'complete',
        cost_reason: 'Full request-time pricing explanation',
        coverage: { priced_tokens: 3, unpriced_tokens: 0, total_tokens: 3 }, line_items: [],
    } satisfies PricingReceipt
    const longReason = 'Ultrafast speed price is not configured; 使用当前目录参考价格，完整计价原因保留 '.repeat(8)
    for (const reason of ['', 'Price not configured', longReason]) {
        for (const status of ['complete', 'partial', 'unpriced'] as const) {
            const row     = rowFor({
                                       ...baseEvent,
                                       cost: 2,
                                       cost_status: status,
                                       cost_reason: reason,
                                       pricing_receipt: receipt,
                                   })
            const summary = renderToStaticMarkup(columns(t).find((column) => column.key === 'tokens')!.cell(row))
            expect(summary).toContain(status === 'unpriced' ? 'usage_stats.request_events_pricing_unpriced' : '$2.00')
            expect(summary).not.toContain('Full request-time pricing explanation')
            if (reason) {
                expect(summary).not.toContain(reason)
            }
            const detail = renderToStaticMarkup(renderDetails({ row, t }))
            if (reason) {
                expect(detail).toContain(reason)
            }
            expect(detail).toContain(receipt.cost_reason)
            expect(detail).toContain(receipt.price_revision)
            expect(detail).toContain('Request-time cost: $1.00')
        }
    }
})

test(
    'observed missing pricing evidence is localized once per reason while exports retain original evidence',
    async () => {
        const reason                  = 'billing region was not reported; Additional billable operations were not fully reported for this request; ' +
                                        'The actual processing geography required for this model was not reported; additional billing quantities or rates are incomplete'
        const receipt: PricingReceipt = {
            schema_version: 1, captured_at: baseEvent.timestamp, priced_at: baseEvent.timestamp,
            provider: 'codex', model: baseEvent.model, canonical_model: baseEvent.model,
            source: 'synthetic-price-source',
            currency: 'USD', cost_micro: 1000, cost_status: 'partial', cost_reason: reason,
            coverage: { priced_tokens: 3, unpriced_tokens: 0, total_tokens: 3 }, line_items: [],
        }
        const event: UsageEvent       = {
            ...baseEvent,
            cost: 0.001,
            cost_status: 'partial',
            cost_reason: reason,
            pricing_receipt: receipt,
        }
        for (const lang of ['zh-CN', 'zh-TW', 'en', 'ru']) {
            const instance = createInstance()
            await instance.init({
                                    lng: lang,
                                    resources: { [lang]: { translation: i18n.getResourceBundle(lang, 'translation') } },
                                })
            const translate = instance.t.bind(instance)
            const labels    = ['region_missing', 'charges_incomplete'].map((key) =>
                                                                               translate(`usage_stats.request_events_pricing_${key}`))
            const row       = rowFor(event, translate)
            expect(row.costReason).toBe(labels.join('\n'))
            for (const label of labels) {
                expect(row.pricingReceiptTitle.split(label)).toHaveLength(2)
            }
            const html = renderToStaticMarkup(renderDetails({ row, t: translate }))
            for (const label of labels) {
                expect(html).toContain(label)
            }
            expect(html).not.toContain('billing region was not reported')
        }
        const response = { ...fixture, events: [event], total: 1, total_pages: 1 }
        expect(await exportFixture('csv', response)).toContain(reason)
        expect(JSON.parse(await exportFixture('json', response))[0]).toMatchObject({
                                                                                       cost_reason: reason,
                                                                                       pricing_receipt: { cost_reason: reason },
                                                                                   })
    },
)

test('exports retain current pricing completeness independently of the request-time receipt', async () => {
    const receipt = {
        schema_version: 2, captured_at: baseEvent.timestamp, priced_at: baseEvent.timestamp,
        provider: 'codex', model: 'routed-model', canonical_model: 'priced-model', source: 'synthetic-price-source',
        currency: 'USD', cost_micro: 1_000_000, cost_status: 'complete',
        coverage: { priced_tokens: 3, unpriced_tokens: 0, total_tokens: 3 }, line_items: [],
    } satisfies PricingReceipt
    for (const status of ['complete', 'partial', 'unpriced'] as const) {
        const reason            = status === 'complete' ? '' : 'Missing applicable price, current cost is incomplete'
        const event: UsageEvent = {
            ...baseEvent, cost: 0, cost_status: status,
            cost_reason: reason, pricing_receipt: receipt,
        }
        const response          = { ...fixture, events: [event], total: 1, total_pages: 1 }
        const csv               = await exportFixture('csv', response)
        expect(csv.split('\n')[0]).toContain('cost,cost_status,cost_reason,billing_metadata,pricing_receipt')
        expect(csv).toContain(`"0","${status}","${reason}",`)
        const exported = JSON.parse(await exportFixture('json', response))[0]
        expect(exported).toMatchObject({
                                           cost: 0, cost_status: status, cost_reason: reason,
                                           pricing_receipt: { cost_micro: 1_000_000, cost_status: 'complete' },
                                       })
    }
})

test('pricing details show context, region, new cache TTLs, modalities and additional fee amounts', async () => {
    const receipt: PricingReceipt = {
        schema_version: 2, captured_at: baseEvent.timestamp, priced_at: baseEvent.timestamp,
        provider: 'synthetic', model: 'routed-model', canonical_model: 'priced-model',
        source: 'synthetic-price-source', currency: 'USD', cost_micro: 24050, cost_status: 'complete',
        speed: 'standard', cache_read_reported: true,
        condition_ids: ['synthetic-context-rule'],
        billing_metadata: { schema_version: 1, context_input_tokens: 1000, region: 'us', charges_reported: true },
        coverage: {
            uncached_input_tokens: 700, cache_write_30m_tokens: 100, cache_write_12h_tokens: 200,
            output_tokens: 100, priced_tokens: 1100, unpriced_tokens: 0, total_tokens: 1100,
        },
        line_items: [
            {
                category: 'uncached_input', modality: 'image', tokens: 100, rate_per_million: 6,
                rate_source: 'synthetic-modality-rate', cost_micro: 600, priced: true,
            },
            {
                category: 'uncached_input', modality: 'text', tokens: 600, rate_per_million: 2,
                rate_source: 'synthetic-text-rate', cost_micro: 1200, priced: true,
            },
            {
                category: 'cache_write_30m', tokens: 100, rate_per_million: 2.5,
                rate_source: 'synthetic-30m-rate', cost_micro: 250, priced: true,
            },
            {
                category: 'cache_write_12h', tokens: 200, rate_per_million: 5,
                rate_source: 'synthetic-12h-rate', cost_micro: 1000, priced: true,
            },
            {
                category: 'output', tokens: 100, rate_per_million: 10,
                rate_source: 'synthetic-output-rate', cost_micro: 1000, priced: true,
            },
        ],
        additional_line_items: [
            {
                kind: 'web_search', unit: 'request', quantity: 2, price: 10, per_units: 1000,
                rate_source: 'synthetic-search-rate', cost_micro: 20000, priced: true,
            },
            {
                kind: 'web_fetch', unit: 'request', quantity: 1, price: 0, per_units: 1000,
                rate_source: 'synthetic-free-fetch', cost_micro: 0, priced: true,
            },
        ],
    }
    for (const language of ['en', 'ru', 'zh-CN', 'zh-TW']) {
        const instance  = await locale(language)
        const translate = instance.t.bind(instance)
        const row       = rowFor({ ...baseEvent, cost: 0.02405, pricing_receipt: receipt }, translate)
        const html      = renderToStaticMarkup(renderDetails({ row, t: translate }))
        for (const key of [
            'context_input', 'region', 'category_cache_write_30m', 'category_cache_write_12h',
            'modality_image', 'modality_text', 'charge_web_search', 'charge_web_fetch',
        ]) {
            expect(html).toContain(translate(`usage_stats.request_events_pricing_${key}`))
        }
        expect(html).toContain('synthetic-search-rate')
        expect(html).toContain('synthetic-free-fetch')
        expect(html).toContain('synthetic-modality-rate')
        expect(html.match(/synthetic-search-rate/g)).toHaveLength(1)
    }
    const exported: UsageEvent = {
        ...baseEvent, cost: 0.02405, pricing_receipt: receipt,
        billing_metadata: receipt.billing_metadata, cache_read_reported: true,
    }
    for (const format of ['json', 'csv'] as const) {
        const text = await exportFixture(format, { ...fixture, events: [exported], total: 1, total_pages: 1 })
        for (const key of [
            'billing_metadata', 'pricing_receipt', 'context_input_tokens', 'cache_write_30m',
            'cache_write_12h', 'condition_ids', 'additional_line_items', 'synthetic-search-rate',
        ]) {
            expect(text).toContain(key)
        }
        if (format === 'json') {
            expect(JSON.parse(text)[0].pricing_receipt.additional_line_items).toEqual(receipt.additional_line_items)
        }
    }
    const missing: PricingReceipt = {
        ...receipt, cost_status: 'partial', additional_line_items: [
            {
                kind: 'missing_fee',
                unit: 'request',
                quantity: 1,
                rate_source: 'unconfigured',
                cost_micro: 0,
                priced: false,
            },
        ],
    }
    const instance                = await locale('en')
    const format                  = helpers.formatPricingReceiptTitle as (
        value: PricingReceipt, cost: number,
        language: string, translate: unknown,
    ) => string
    const title                   = format(missing, 0.02405, 'en', instance.t.bind(instance))
    const missingLine             = title.split('\n').find((line) => line.startsWith('missing_fee:'))!
    expect(missingLine).toContain('Unpriced')
    expect(missingLine).not.toContain('$0.00')
})

test('request-time speed rates and item amounts render once while old receipts stay readable', async () => {
    const receipt: PricingReceipt = {
        schema_version: 2,
        captured_at: baseEvent.timestamp,
        priced_at: baseEvent.timestamp,
        provider: 'codex',
        model: 'routed-model',
        canonical_model: 'priced-model',
        source: 'synthetic-price-source',
        currency: 'USD',
        cost_micro: 6_000_000,
        cost_status: 'complete',
        speed: 'fast',
        speed_source: 'response_service_tier',
        speed_multiplier: 3,
        speed_rate_source: 'synthetic-speed-source',
        speed_effective_from: '2026-11-01',
        speed_effective_until: '2026-11-30',
        coverage: { priced_tokens: 1_000_000, unpriced_tokens: 0, total_tokens: 1_000_000 },
        line_items: [
            {
                category: 'uncached_input',
                tokens: 1_000_000,
                rate_per_million: 6,
                base_rate_per_million: 2,
                speed_multiplier: 3,
                rate_source: 'synthetic-rate',
                cost_micro: 6_000_000,
                priced: true,
            },
        ],
    }
    for (const language of ['en', 'ru', 'zh-CN', 'zh-TW']) {
        const instance  = await locale(language)
        const translate = instance.t.bind(instance)
        const row       = convert(
            { ...baseEvent, speed: 'ultrafast', cost: 6, pricing_receipt: receipt },
            0, sourceMap, new Map(), language, '', '', new Map(), translate,
        )
        const html      = renderToStaticMarkup(renderDetails({ row, t: translate }))
        expect(html).toContain('synthetic-speed-source')
        expect(html).toContain('2026-11-01 → 2026-11-30')
        expect(html).toContain('×3')
        expect(html).toContain(translate('usage_stats.request_events_speed_fast'))
        expect(html).toContain(translate('usage_stats.request_events_speed_ultrafast'))
        expect(html).toContain(translate('usage_stats.request_events_pricing_base_rate'))
        expect(html).toContain('synthetic-rate')
        expect(html).not.toContain('18.00')
    }
    const perCategory      = {
        ...receipt,
        cost_micro: 5_000_000,
        line_items: receipt.line_items.map((item) => ({
            ...item,
            rate_per_million: 5,
            speed_multiplier: 2.5,
            cost_micro: 5_000_000,
        })),
    }
    const perCategoryTitle = (helpers.formatPricingReceiptTitle as (
        receipt: PricingReceipt,
        cost: number,
        language: string,
        t: unknown,
    ) => string)(
        perCategory, 5, 'en', t,
    )
    expect(perCategoryTitle).toContain('5/MTok = $5.00')
    expect(perCategoryTitle).toContain('×2.5')
    expect(perCategoryTitle).toContain('×3')
    const legacy = { ...receipt }
    delete legacy.speed
    delete legacy.speed_source
    delete legacy.speed_multiplier
    delete legacy.speed_rate_source
    delete legacy.speed_effective_from
    delete legacy.speed_effective_until
    legacy.line_items = receipt.line_items.map((item) => {
        const legacyItem = { ...item }
        delete legacyItem.base_rate_per_million
        delete legacyItem.speed_multiplier
        return legacyItem
    })
    const instance    = await locale('en')
    const row         = rowFor(
        { ...baseEvent, response_service_tier: 'priority', cost: 6, pricing_receipt: legacy },
        instance.t.bind(instance),
    )
    const html        = renderToStaticMarkup(renderDetails({ row, t: instance.t.bind(instance) }))
    expect(html).toContain(`${instance.t('usage_stats.request_events_actual_speed')}: Unknown`)
    expect(html).toContain('Speed multiplier: Not recorded')
    expect(html).toContain('$6.00')
    expect(html).not.toContain('Base rate / MTok')
    expect(renderToStaticMarkup(renderDetails({ row: rowFor(baseEvent), t: instance.t.bind(instance) })))
        .toContain('No request-time cost details were recorded')
})

test('costs render as plain amounts in summaries and details in all four languages', async () => {
    const expected = {
        'zh-CN': { name: '费用', removed: ['估算费用', '参考费用', '已完整计价', '部分计价'] },
        'zh-TW': { name: '費用', removed: ['估算費用', '參考費用', '已完整計價', '部分計價'] },
        en: { name: 'Cost', removed: ['Estimated cost', 'Fully priced', 'Partially priced', 'reference amount'] },
        ru: { name: 'Стоимость', removed: ['Оценочная стоимость', 'Все расходы учтены', 'справочная сумма'] },
    }
    for (const [language, labels] of Object.entries(expected)) {
        const instance                = await locale(language)
        const translate               = instance.t.bind(instance)
        const receipt: PricingReceipt = {
            schema_version: 2, captured_at: baseEvent.timestamp, priced_at: baseEvent.timestamp,
            provider: 'codex', model: baseEvent.model, canonical_model: baseEvent.model,
            source: 'synthetic-price-source',
            currency: 'USD', cost_micro: 1_000_000, cost_status: 'complete',
            coverage: { priced_tokens: 3, unpriced_tokens: 0, total_tokens: 3 }, line_items: [],
        }
        const rendered                = (status: 'complete' | 'partial') => {
            const row = rowFor({
                                   ...baseEvent, cost: 2, cost_status: status,
                                   pricing_receipt: { ...receipt, cost_status: status },
                               }, translate)
            return renderToStaticMarkup(<Sheet rows={[row]} columns={columns(translate)}
                                               rowKey={(value) => value.id} status='ready' />) +
                   renderToStaticMarkup(renderDetails({ row, t: translate }))
        }
        const html                    = rendered('complete')
        expect(rendered('partial')).toBe(html)
        expect(html).toContain(`<h3>${labels.name}</h3>`)
        expect(html.split(translate('usage_stats.request_events_pricing_receipt'))).toHaveLength(2)
        expect(html).toContain('$2.00')
        expect(html).toContain('$1.00')
        for (const label of labels.removed) {
            expect(html).not.toContain(label)
        }
        expect(html).not.toContain('request_events_pricing_status_')
        expect(html).not.toContain('request_events_pricing_coverage')
    }
})

test('free zero and unpriced costs stay distinct for current and request-time amounts', async () => {
    for (const language of ['zh-CN', 'zh-TW', 'en', 'ru']) {
        const instance  = await locale(language)
        const translate = instance.t.bind(instance)
        const unknown   = translate('usage_stats.request_events_pricing_unpriced')
        for (const current of ['complete', 'partial', 'unpriced'] as const) {
            for (const original of ['complete', 'partial', 'unpriced'] as const) {
                const receipt: PricingReceipt = {
                    schema_version: 1, captured_at: baseEvent.timestamp, priced_at: baseEvent.timestamp,
                    provider: 'codex', model: baseEvent.model, canonical_model: baseEvent.model,
                    source: 'synthetic-price-source',
                    currency: 'USD', cost_micro: 0, cost_status: original,
                    coverage: { priced_tokens: 0, unpriced_tokens: 3, total_tokens: 3 }, line_items: [],
                }
                const row                     = rowFor({
                                                           ...baseEvent,
                                                           cost: 0,
                                                           cost_status: current,
                                                           pricing_receipt: receipt,
                                                       }, translate)
                expect(row).toMatchObject({ costLabel: current === 'unpriced' ? unknown : '$0.00' })
                const lines       = row.pricingReceiptTitle.split('\n')
                const requestLine = lines.find((line) => line.startsWith(
                    translate('usage_stats.request_events_pricing_request_cost') + ':'))
                const currentLine = lines.find((line) => line.startsWith(
                    translate('usage_stats.request_events_pricing_current_cost') + ':'))
                expect(requestLine).toBe(translate('usage_stats.request_events_pricing_request_cost') +
                                         ': ' + (original === 'unpriced' ? unknown : '$0.00'))
                expect(currentLine).toBe(translate('usage_stats.request_events_pricing_current_cost') +
                                         ': ' + (current === 'unpriced' ? unknown : '$0.00'))
            }
        }
    }
})

test('the field guide explains processing mode and costs without extra states', async () => {
    for (const language of ['zh-CN', 'zh-TW', 'en', 'ru']) {
        const instance  = await locale(language)
        const translate = instance.t.bind(instance)
        const guide     = sourceExpression<ReactElement>(file, (node, tree) =>
            ts.isJsxElement(node) && node.openingElement.tagName.getText(tree) === 'details' &&
            node.getText(tree).includes('request_events_field_guide_title'), { React, t: translate })
        const html      = renderToStaticMarkup(guide)
        expect(guide.props).not.toHaveProperty('open', true)
        for (const key of ['field_guide_title', 'metric_guide', 'speed_hint', 'cost_guide']) {
            const text = translate(`usage_stats.request_events_${key}`)
            expect(text).not.toStartWith('usage_stats.')
            expect(html).toContain(text)
        }
    }
})

test('the cost chart uses the same total label as other metrics without an extra cost qualifier', () => {
    const view = sourceExpression<ReactElement>('components/usage/UnifiedTrendChart.tsx', (node, tree) =>
        ts.isJsxElement(node) && node.openingElement.tagName.getText(tree) === 'span' &&
        node.getText(tree).includes('summaryValues.total'), {
                                                    React,
                                                    styles,
                                                    metric: 'cost',
                                                    summaryValues: { total: '$12.34' },
                                                    t,
                                                })
    const html = renderToStaticMarkup(view)
    expect(html).toContain('$12.34')
    expect(html).toContain('usage_stats.unified_total_label')
    expect(html).not.toContain('cost_reference_amount')
})
