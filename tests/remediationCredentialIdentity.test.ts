import {formatAuthFileDisplayName, inferProviderFromAuthFileName} from '@/features/authFiles/constants'
import type {SummaryCredentialStats, UsageEvent, UsageSummary} from '@/services/api/usage'
import type {CredentialInfo} from '@/types/sourceInfo'
import {formatDateTime, formatNumber, maskApiKey} from '@/utils/format'
import {buildSourceInfoMap, resolveSourceDisplay} from '@/utils/sourceResolver'
import {
    buildCandidateUsageSourceIds,
    collectUsageDetails,
    extractLatencyMs,
    formatDurationMs,
    formatThinkingLabel,
    isNoThinkingUsage,
    normalizeAuthIndex,
    normalizeUsageThinking,
    resolveUsageTokenMetrics,
} from '@/utils/usage'
import {summaryToCredentialEntries} from '@/utils/usage/summaryHelpers'
import {describe, expect, test} from 'bun:test'
import {sourceCallback} from './sourceCallbacks'

const detailsFile = 'components/usage/RequestEventsDetailsCard.tsx'
type DetailRow = {
    sourceRaw: string;
    source: string;
    sourceType: string;
    authIndex: string;
    apiKey: string;
    apiKeyMasked: string;
    user: string;
    totalTokens: number;
    failed: boolean
}
const detailScope: Record<string, unknown> = {
    resolveSourceDisplay, formatDateTime, formatNumber, maskApiKey,
    // noinspection JSUnusedGlobalSymbols
    'extractLatencyMs': extractLatencyMs, formatDurationMs,
    // noinspection JSUnusedGlobalSymbols
    'formatThinkingLabel': formatThinkingLabel,
    // noinspection JSUnusedGlobalSymbols
    'isNoThinkingUsage': isNoThinkingUsage, normalizeUsageThinking,
    // noinspection JSUnusedGlobalSymbols
    'resolveUsageTokenMetrics': resolveUsageTokenMetrics,
}
for (const name of [
    'channelLabel', 'numberFromValue', 'nonNegativeNumber',
    'displayApiKey', 'normalizeRequestLogState', 'formatTokenValue', 'formatPercent', 'formatThroughput',
    'formatEventCost', 'formatRequestThinkingLabel', 'resolveModelAliasRelations', 'pricingLineItemLabel',
    'formatPricingReason', 'formatPricingReceiptTitle', 'sanitizeUpstreamUrl', 'observedRequestSpeed',
]) {
    detailScope[name] = sourceCallback(detailsFile, name, detailScope)
}
const eventToRow = sourceCallback<(...args: unknown[]) => DetailRow>(detailsFile, 'eventToRow', detailScope)
const t          = (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key

function detailEvent(input: Partial<UsageEvent>): UsageEvent {
    return {
        timestamp: '2026-11-09T00:00:00Z', model: 'fixture-model', source: '', auth_index: '',
        api_key: 'fixture-client-key', api_key_alias: 'Client alias', failed: false,
        tokens: { input_tokens: 3, output_tokens: 1, total_tokens: 4 }, ...input,
    } as UsageEvent
}

function detailRow(
    event: UsageEvent,
    map: ReturnType<typeof buildSourceInfoMap>,
    files = new Map<string, CredentialInfo>(),
): DetailRow {
    return eventToRow(event, 0, map, files, 'en', 'No API key', 'Not recorded', new Map(), t)
}

describe('R-474 actual detail source identity consumers', () => {
    const prefix = 'a@b.test'
    const apiKey = 'fixture-shared-provider-key'
    const map    = buildSourceInfoMap({
                                          claudeApiKeys: [{ apiKey, prefix }], codexApiKeys: [{ apiKey, prefix }],
                                      })

    test('resolves every shared prefix, hash and masked key by authoritative provider', () => {
        for (const source of buildCandidateUsageSourceIds({ apiKey, prefix })) {
            for (const provider of ['claude', 'codex']) {
                expect(resolveSourceDisplay(source, '', map, new Map(), provider)).toEqual({
                                                                                               displayName: prefix,
                                                                                               type: provider,
                                                                                           })
                expect(detailRow(detailEvent({ source, provider }), map)).toMatchObject(
                    {
                        sourceRaw: source,
                        source: prefix,
                        sourceType: provider ===
                                    'codex' ?
                                    'Codex' :
                                    'Claude',
                        apiKey: 'fixture-client-key',
                        apiKeyMasked: 'Client alias',
                        user: prefix,
                    })
            }
        }
    })

    test('selects the matching provider alias instead of the first key alias', () => {
        const aliased = buildSourceInfoMap({
                                               claudeApiKeys: [{ apiKey, prefix: 'Claude account' }],
                                               codexApiKeys: [{ apiKey, prefix: 'Codex account' }],
                                           })
        const source  = buildCandidateUsageSourceIds({ apiKey })[0]
        expect(detailRow(detailEvent({ source, provider: 'codex' }), aliased)).toMatchObject(
            {
                source: 'Codex account',
                user: 'Codex account',
                sourceType: 'Codex',
                apiKeyMasked: 'Client alias',
            })
    })

    test('preserves each named OpenAI-compatible provider alias and the provider-less legacy label', () => {
        const compatible = buildSourceInfoMap({
                                                  openaiCompatibility: [
                                                      {
                                                          name: 'custom-compatible',
                                                          prefix: 'First compatible alias',
                                                          baseUrl: 'https://example.invalid',
                                                          apiKeyEntries: [{ apiKey }],
                                                      },
                                                      {
                                                          name: 'custom-second',
                                                          prefix: 'Second compatible alias',
                                                          baseUrl: 'https://example.invalid',
                                                          apiKeyEntries: [{ apiKey }],
                                                      },
                                                  ],
                                              })
        const source     = buildCandidateUsageSourceIds({ apiKey })[0]
        for (const [provider, displayName] of [
            ['custom-compatible', 'First compatible alias'], ['custom-second', 'Second compatible alias'],
        ]) {
            expect(resolveSourceDisplay(source, '', compatible, new Map(), provider)).toEqual({
                                                                                                  displayName,
                                                                                                  type: provider,
                                                                                              })
            expect(detailRow(detailEvent({ source, provider }), compatible)).toMatchObject({
                                                                                               sourceRaw: source,
                                                                                               source: displayName,
                                                                                               user: displayName,
                                                                                               sourceType: provider,
                                                                                           })
        }
        expect(resolveSourceDisplay(source, '', compatible, new Map())).toEqual(
            {
                displayName: 'First compatible alias',
                type: 'openai',
            })
    })

    test('uses matching auth_index and rejects source or auth_index from a different provider', () => {
        const claudeOnly = buildSourceInfoMap({ claudeApiKeys: [{ apiKey, prefix }] })
        const files      = new Map<string, CredentialInfo>([
                                                               [
                                                                   `t:${prefix}`,
                                                                   { name: 'Wrong source file', type: 'claude' },
                                                               ],
                                                               ['0', { name: 'Codex auth account', type: 'codex' }],
                                                               [
                                                                   'wrong',
                                                                   { name: 'Wrong auth account', type: 'claude' },
                                                               ],
                                                           ])
        expect(resolveSourceDisplay(`t:${prefix}`, 0, claudeOnly, files, 'codex'))
            .toEqual({ displayName: 'Codex auth account', type: 'codex' })
        expect(detailRow(detailEvent({ source: `t:${prefix}`, auth_index: '0', provider: 'codex' }), claudeOnly, files))
            .toMatchObject({
                               sourceRaw: `t:${prefix}`,
                               authIndex: '0',
                               source: 'Codex auth account',
                               sourceType: 'Codex',
                           })
        expect(resolveSourceDisplay(`t:${prefix}`, 'wrong', claudeOnly, files, 'codex')).toEqual(
            {
                displayName: prefix,
                type: 'codex',
            })
        expect(resolveSourceDisplay('', '0', map, files, ' Codex ')).toEqual({
                                                                                 displayName: 'Codex auth account',
                                                                                 type: 'codex',
                                                                             })
        expect(resolveSourceDisplay('', '0', map, files, 'future-provider')).toEqual({
                                                                                         displayName: '-',
                                                                                         type: 'future-provider',
                                                                                     })
    })

    test('preserves full email source, matching auth-file name and authoritative unknown provider', () => {
        const files = new Map<string, CredentialInfo>([[prefix, { name: 'OAuth account alias', type: 'codex' }]])
        expect(detailRow(detailEvent({ source: prefix, provider: 'codex' }), map, files))
            .toMatchObject({ sourceRaw: prefix, source: 'OAuth account alias', sourceType: 'Codex' })
        expect(detailRow(detailEvent({ source: prefix, provider: 'future-provider' }), map, files))
            .toMatchObject({ source: prefix, sourceType: 'future-provider' })
        expect(detailRow(detailEvent({ source: `t:${prefix}`, provider: ' codex ' }), map))
            .toMatchObject({ source: prefix, sourceType: 'Codex' })
    })

    test('retains the provider-less trace and details lookup contract', () => {
        const files = new Map<string, CredentialInfo>([
                                                          [
                                                              'legacy.json',
                                                              { name: 'Legacy source alias', type: 'codex' },
                                                          ],
                                                          ['0', { name: 'Legacy index alias', type: 'codex' }],
                                                      ])
        const trace = sourceCallback<(source: string, index: unknown) => { displayName: string; type: string }>(
            'pages/hooks/useTraceResolver.ts', 'resolveTraceSourceInfo',
            { resolveSourceDisplay, traceSourceInfoMap: map, traceAuthFileMap: files },
        )
        expect(trace(`t:${prefix}`, '0')).toEqual({ displayName: prefix, type: 'claude' })
        expect(trace('legacy.json', '')).toEqual({ displayName: 'Legacy source alias', type: 'codex' })
        expect(trace('missing', 0)).toEqual({ displayName: 'Legacy index alias', type: 'codex' })
        expect(trace(`t:${prefix}`, '')).toEqual(resolveSourceDisplay(`t:${prefix}`, '', map, files, '  '))
        expect(detailRow(detailEvent({ source: `t:${prefix}` }), map, files)).toMatchObject({
                                                                                                source: prefix,
                                                                                                sourceType: 'Claude',
                                                                                            })
    })

    test('actual rows keep provider chips and counts, while filters retain exact original identities', () => {
        const events = [
            detailEvent({ source: `t:${prefix}`, provider: 'claude', auth_index: 'claude-index' }),
            detailEvent({ source: `t:${prefix}`, provider: 'codex', auth_index: 'codex-index', failed: true }),
            detailEvent({ source: prefix }),
        ]
        const rows   = sourceCallback<() => DetailRow[]>(detailsFile, 'rows', {
            enabled: true, eventsData: { events }, eventToRow, sourceInfoMap: map, authFileMap: new Map(),
            i18n: { language: 'en' }, noApiKeyLabel: 'No API key', notRecordedLabel: 'Not recorded',
            modelAliasLookup: new Map(), t, aliases: {},
        })()
        expect(rows).toHaveLength(3)
        expect(rows.map(({ sourceType }) => sourceType)).toEqual(['Claude', 'Codex', ''])
        expect(rows.reduce((total, row) => total + row.totalTokens, 0)).toBe(12)
        expect(rows.map(({ authIndex }) => authIndex)).toEqual(['claude-index', 'codex-index', '-'])
        expect(rows.filter(({ failed }) => failed)).toHaveLength(1)
        const selected                        = [`claude:${prefix}`, `codex:${prefix}`, prefix]
        const params: Record<string, unknown> = {}
        const applyFilters                    = sourceCallback<(...args: unknown[]) => void>(
            detailsFile,
            'applyFilters',
            {},
        )
        applyFilters(params, 'from', 'to', [], selected, [], '', '')
        expect(params).toEqual({ api_key_identity: 'canonical', from: 'from', to: 'to', source: selected.join(',') })
    })
})

const email                                         = 'a@b.test'
const identity                                      = `~cpa-credential-v1:identity:${Buffer.from(email).toString(
    'base64url')}`
const mixed: Record<string, SummaryCredentialStats> = {
    [email]: { provider: '', source: email, source_kind: 'identity', filter_key: identity, success: 3, failure: 1 },
    [`claude:${email} [identity]`]: {
        provider: 'claude',
        source: email,
        source_kind: 'identity',
        filter_key: `claude:${identity}`,
        success: 5,
        failure: 1,
    },
    [`codex:${email} [identity]`]: {
        provider: 'codex',
        source: email,
        source_kind: 'identity',
        filter_key: `codex:${identity}`,
        success: 7,
        failure: 2,
    },
}
const summary                                       = { by_credential: mixed } as UsageSummary
const filterFile                                    = 'components/usage/FilterBar.tsx'
const statsFile                                     = 'components/usage/CredentialStatsCard.tsx'
type Option = { value: string; label: string }
type Row = { key: string; displayName: string; success: number; failure: number; total: number }

const capitalizeProvider                    = sourceCallback<(name: string) => string>(
    filterFile,
    'capitalizeProvider',
    {},
)
const maskSensitiveKey                      = sourceCallback<(name: string) => string>(
    filterFile,
    'maskSensitiveKey',
    {},
)
const formatCredentialOptionLabel           = sourceCallback<(
    provider: string,
    source: string,
    kind: string,
    aliases?: Record<string, string>,
) => string>(
    filterFile, 'formatCredentialOptionLabel', { capitalizeProvider, maskSensitiveKey },
)
const normalizeCredentialOption             = sourceCallback<(
    entry: unknown,
    aliases?: Record<string, string>,
) => Option>(
    filterFile,
    'normalizeCredentialOption',
    { formatAuthFileDisplayName, inferProviderFromAuthFileName, formatCredentialOptionLabel },
)
const normalizeCredentialProviderForDisplay = sourceCallback<(provider: string) => string>(
    filterFile, 'normalizeCredentialProviderForDisplay', { capitalizeProvider },
)
const buildCredentialOptionDisplayKey       = sourceCallback<(
    provider: string,
    source: string,
    aliases?: Record<string, string>,
) => string>(
    filterFile, 'buildCredentialOptionDisplayKey', { normalizeCredentialProviderForDisplay, maskSensitiveKey },
)
const buildCredentialOptionsFromSummary     = sourceCallback<(
    summary: UsageSummary,
    aliases?: Record<string, string>,
) => Option[]>(
    filterFile,
    'buildCredentialOptionsFromSummary',
    { summaryToCredentialEntries, normalizeCredentialOption, buildCredentialOptionDisplayKey },
)
const formatCredentialDisplay               = sourceCallback<(
    provider: string,
    source: string,
    aliases?: Record<string, string>,
) => string>(
    statsFile, 'formatCredentialDisplay', { capitalizeProvider },
)
const formatCredentialDisplayFromAuthFile   = sourceCallback<(
    file: unknown,
    source: string,
    aliases?: Record<string, string>,
) => string>(
    statsFile,
    'formatCredentialDisplayFromAuthFile',
    { formatCredentialDisplay, inferProviderFromAuthFileName, formatAuthFileDisplayName },
)

function credentialRows(byCredential: Record<string, SummaryCredentialStats>, aliases?: Record<string, string>): Row[] {
    return sourceCallback<() => Row[]>(statsFile, 'rows', {
        summary: { by_credential: byCredential },
        usage: null,
        geminiKeys: [],
        claudeConfigs: [],
        codexConfigs: [],
        vertexConfigs: [],
        openaiProviders: [],
        authFileMap: new Map(),
        aliases,
        summaryToCredentialEntries,
        // noinspection JSUnusedGlobalSymbols
        'buildCandidateUsageSourceIds': buildCandidateUsageSourceIds,
        // noinspection JSUnusedGlobalSymbols
        'collectUsageDetails': collectUsageDetails,
        normalizeAuthIndex,
        inferProviderFromAuthFileName,
        formatAuthFileDisplayName,
        formatCredentialDisplay,
        formatCredentialDisplayFromAuthFile,
    })()
}

describe('R-474 credential identity contract', () => {
    test('retains disjoint provider-less history and Claude/Codex buckets in either input order', () => {
        for (const input of [mixed, Object.fromEntries(Object.entries(mixed).reverse())]) {
            const entries = summaryToCredentialEntries(input)
            expect(entries).toHaveLength(3)
            expect(entries.map(({ filterKey }) => filterKey).sort()).toEqual([
                                                                                 identity,
                                                                                 `claude:${identity}`,
                                                                                 `codex:${identity}`,
                                                                             ].sort())
            expect(entries.reduce((total, entry) => total + entry.success + entry.failure, 0)).toBe(19)
            expect(entries.find(({ provider }) => provider === '')?.success).toBe(3)
            expect(entries.find(({ provider }) => provider === 'claude')?.success).toBe(5)
            expect(entries.find(({ provider }) => provider === 'codex')?.success).toBe(7)
        }
    })

    test('merges only the same original filter identity, including bare and t: cache generations', () => {
        const entries = summaryToCredentialEntries({
                                                       [email]: { success: 2, failure: 1 },
                                                       [`t:${email}`]: { success: 3, failure: 2 },
                                                       [`claude:${email}`]: { success: 5, failure: 0 },
                                                       [`codex:${email}`]: { success: 7, failure: 1 },
                                                   })
        expect(entries.map(({ filterKey, success, failure }) => ({ filterKey, success, failure }))).toEqual(
            [
                {
                    filterKey: email,
                    success: 5,
                    failure: 3,
                },
                {
                    filterKey: `claude:${email}`,
                    success: 5,
                    failure: 0,
                },
                {
                    filterKey: `codex:${email}`,
                    success: 7,
                    failure: 1,
                },
            ])
    })

    test('keeps API-key and identity types distinct even when their safe source displays match', () => {
        const apiKeyFilter = identity.replace(':identity:', ':api_key:')
        const entries      = summaryToCredentialEntries({
                                                            identity: mixed[`claude:${email} [identity]`],
                                                            apiKey: {
                                                                provider: 'claude',
                                                                source: email,
                                                                source_kind: 'api_key',
                                                                filter_key: `claude:${apiKeyFilter}`,
                                                                success: 2,
                                                                failure: 0,
                                                            },
                                                        })
        expect(entries).toHaveLength(2)
        expect(entries.map(({ filterKey }) => filterKey)).toEqual([`claude:${identity}`, `claude:${apiKeyFilter}`])
    })

    test('actual dropdown consumer distinguishes equal aliases while preserving stable filter values', () => {
        const aliases = { [email]: 'Shared account' }

        const options = sourceCallback<() => Option[]>(filterFile, 'credentialOptions', {
            optionsSummary: summary, summary: null, aliases, buildCredentialOptionsFromSummary,
        })()
        expect(options).toContainEqual({ value: `claude:${identity}`, label: '[Claude] Shared account · Identity' })
        expect(options).toContainEqual({ value: `codex:${identity}`, label: '[Codex] Shared account · Identity' })
        expect(options).toContainEqual({ value: identity, label: 'Shared account · Identity' })
        expect(new Set(options.map(({ value }) => value)).size).toBe(3)
        const selectedCredentials = options.filter(({ label }) => label.startsWith('[Codex]')).map(({ value }) => value)
        const params              = sourceCallback<() => { credential: string }>(
            'pages/UsagePage.tsx',
            'summaryParams',
            {
                effectiveDateFrom: '2026-11-01',
                effectiveDateTo: '2026-11-09',
                summaryGranularity: 'daily',
                selectedModels: [],
                selectedApiKeys: [],
                selectedCredentials,
                chartDimension: 'credential',
            },
        )()
        expect(params.credential).toBe(`codex:${identity}`)
    })

    test('actual statistics consumer shows separate provider rows and preserves historical totals', () => {
        const rows = credentialRows(mixed, { [email]: 'Shared account' })
        expect(rows).toHaveLength(3)
        expect(rows).toContainEqual(expect.objectContaining({
                                                                key: `claude:${identity}`,
                                                                displayName: '[Claude] Shared account',
                                                                total: 6,
                                                            }))
        expect(rows).toContainEqual(expect.objectContaining({
                                                                key: `codex:${identity}`,
                                                                displayName: '[Codex] Shared account',
                                                                total: 9,
                                                            }))
        expect(rows).toContainEqual(expect.objectContaining({ key: identity, displayName: 'Shared account', total: 4 }))
        expect(rows.reduce((total, row) => total + row.total, 0)).toBe(19)
    })

    test('keeps full email domains distinct and preserves legacy auth-file presentation', () => {
        const input: Record<string, SummaryCredentialStats> = {
            [`claude:${email}`]: { provider: 'claude', source: email, success: 1, failure: 0 },
            'claude:a@b.invalid': { provider: 'claude', source: 'a@b.invalid', success: 2, failure: 0 },
            'codex-file': { source: 'codex-a@b.test.json', success: 3, failure: 0 },
        }

        const options = buildCredentialOptionsFromSummary({ by_credential: input } as UsageSummary)
        expect(options).toContainEqual({ value: `claude:${email}`, label: `[Claude] ${email}` })
        expect(options).toContainEqual({ value: 'claude:a@b.invalid', label: '[Claude] a@b.invalid' })
        expect(options).toContainEqual({ value: 'codex-a@b.test.json', label: `[Codex] ${email}` })
        expect(credentialRows(input).map(({ displayName }) => displayName).sort()).toEqual([
                                                                                               '[Claude] a@b.invalid',
                                                                                               `[Claude] ${email}`,
                                                                                               `[Codex] ${email}`,
                                                                                           ])
    })

    test('aliases on original auth-file names survive display-name normalization in filters and statistics', () => {
        const source             = 'codex-account@example.test.json'
        const aliases            = { [source]: 'Named account' }
        const input              = { original: { source, success: 3, failure: 0 } }
        const data: UsageSummary = {
            period: { from: '2026-11-20T00:00:00Z', to: '2026-11-21T00:00:00Z' },
            totals: {
                requests: 3, success: 3, failure: 0, cost: 0,
                tokens: { input: 0, output: 0, cached: 0, reasoning: 0, total: 0 },
            },
            by_model: {}, by_credential: input, by_api_key: {}, time_series: [],
            time_series_by_model: {}, time_series_by_credential: {}, time_series_by_api_key: {},
        }
        expect(buildCredentialOptionsFromSummary(data, aliases))
            .toEqual([{ value: source, label: '[Codex] Named account' }])
        expect(credentialRows(input, aliases)[0]).toMatchObject({
                                                                    key: source,
                                                                    displayName: '[Codex] Named account',
                                                                    total: 3,
                                                                })
        expect(formatCredentialDisplayFromAuthFile({ name: source, rawName: source, type: 'codex' }, '', aliases))
            .toBe('[Codex] Named account')
    })

    test('a response containing only qualified Claude/Codex sources renders exactly two rows', () => {
        const qualified = Object.fromEntries(Object.entries(mixed).filter(([, stats]) => stats.provider))
        expect(credentialRows(qualified).map(({ displayName }) => displayName).sort()).toEqual([
                                                                                                   `[Claude] ${email}`,
                                                                                                   `[Codex] ${email}`,
                                                                                               ])
        expect(buildCredentialOptionsFromSummary({ by_credential: qualified } as UsageSummary)).toHaveLength(2)
    })
})
