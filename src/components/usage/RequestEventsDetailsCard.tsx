import {CardSkeleton} from '@/components/common/CardSkeleton'
import {Sheet, type SheetColumn} from '@/components/common/Sheet'
import {Button} from '@/components/ui/Button'
import {Card} from '@/components/ui/Card'
import {EmptyState} from '@/components/ui/EmptyState'
import {Modal} from '@/components/ui/Modal'
import {Pagination} from '@/components/ui/Pagination'
import {Select} from '@/components/ui/Select'
import {ToggleSwitch} from '@/components/ui/ToggleSwitch'
import {useDebounce} from '@/hooks/useDebounce'
import {authFilesApi} from '@/services/api/authFiles'
import {logsApi} from '@/services/api/logs'
import {
    type EventsParams,
    type EventsResponse,
    type PricingReceipt,
    type RequestLogState,
    usageApi,
    type UsageEvent,
    type UsageThinking,
} from '@/services/api/usage'
import {useConfigStore, useNotificationStore} from '@/stores'
import type {GeminiKeyConfig, OpenAIProviderConfig, ProviderKeyConfig} from '@/types'
import type {OAuthModelAliasEntry} from '@/types/oauth'
import type {CredentialInfo} from '@/types/sourceInfo'
import {
    resolveUsageEventsAutoRefreshMs,
    shouldRefreshUsageEvents,
    USAGE_EVENTS_AUTO_REFRESH_INTERVALS,
} from '@/utils/autoRefresh'
import {downloadBlob} from '@/utils/download'
import {formatDateTime, formatNumber, maskApiKey, toLocalDateTimeSecondsString} from '@/utils/format'
import {redactSensitiveText} from '@/utils/redaction'
import {buildSourceInfoMap, resolveSourceDisplay} from '@/utils/sourceResolver'
import {
    extractLatencyMs,
    formatDurationMs,
    formatThinkingLabel,
    isNoThinkingUsage,
    normalizeUsageThinking,
    resolveUsageTokenMetrics,
} from '@/utils/usage'
import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'
import styles from './RequestEventsDetailsCard.module.scss'
import {
    createUsageEventExport,
    MAX_USAGE_EVENT_EXPORT_EVENTS,
    USAGE_EVENT_EXPORT_PAGE_SIZE,
    UsageEventExportLimitError,
} from './usageEventExport'

const STATUS_ALL             = ''
const DEFAULT_PAGE_SIZE      = 50
const USAGE_EVENT_CSV_HEADER = [
    'timestamp',
    'model',
    'source',
    'auth_index',
    'provider',
    'api_key',
    'user',
    'request_id',
    'result',
    'latency_ms',
    'time_to_first_byte_ms',
    'total_duration_ms',
    'completed',
    'cache_hit_rate',
    'response_throughput_tokens_per_second',
    'thinking_intensity',
    'thinking_mode',
    'thinking_level',
    'thinking_budget',
    'input_tokens',
    'output_tokens',
    'reasoning_tokens',
    'cache_read_tokens',
    'cache_write_tokens',
    'cached_tokens',
    'total_tokens',
    'cost',
]

function formatRequestThinkingLabel(
    thinking: UsageThinking | null,
    reasoningTokens: number | null,
    lang: string,
    t: ReturnType<typeof useTranslation>['t'],
    notRecordedLabel: string,
): string {
    if (thinking) {
        const label = formatThinkingLabel(thinking, lang)
        if (label !== '-') {
            return label
        }
    }
    if (reasoningTokens !== null && reasoningTokens > 0) {
        return t('usage_stats.request_events_thinking_recorded', { defaultValue: 'Recorded' })
    }
    if (reasoningTokens === 0) {
        return t('usage_stats.request_events_reasoning_zero', { defaultValue: '0 reasoning tokens' })
    }
    return notRecordedLabel
}

type RequestEventRow = {
    id: string
    timestamp: string
    timestampMs: number
    timestampLabel: string
    model: string
    modelAliasRelations: string[]
    sourceRaw: string
    source: string
    sourceType: string
    sourceLabel: string
    authIndex: string
    apiKey: string
    apiKeyMasked: string
    user: string
    requestId: string
    requestLogState: RequestLogState
    requestLogHomeIp: string
    latencyMs: number | null
    latencyLabel: string
    timeToFirstByteMs: number | null
    timeToFirstByteLabel: string
    totalDurationMs: number | null
    totalDurationLabel: string
    completed: boolean | null
    cacheHitRate: number | null
    cacheHitRateLabel: string
    throughputTokensPerSecond: number | null
    throughputLabel: string
    thinking: UsageThinking | null
    thinkingLabel: string
    thinkingRecorded: boolean
    thinkingNone: boolean
    failed: boolean
    inputTokens: number | null
    inputTokensLabel: string
    outputTokens: number | null
    outputTokensLabel: string
    reasoningTokens: number | null
    reasoningTokensLabel: string
    cachedTokens: number | null
    cachedTokensLabel: string
    cacheReadTokens: number | null
    cacheReadTokensLabel: string
    cacheWriteTokens: number | null
    cacheWriteTokensLabel: string
    totalTokens: number | null
    totalTokensLabel: string
    cost: number
    costLabel: string
    pricingReceiptLabel: string
    pricingReceiptTitle: string
}

interface RequestEventsDetailsCardProps {
    enabled?: boolean
    refreshToken?: number
    geminiKeys: GeminiKeyConfig[]
    claudeConfigs: ProviderKeyConfig[]
    codexConfigs: ProviderKeyConfig[]
    vertexConfigs: ProviderKeyConfig[]
    openaiProviders: OpenAIProviderConfig[]
    drillDownSearch?: string
    authFileMap: Map<string, CredentialInfo>
    dateRange: { from: string; to: string }
    activePreset?: string
    aliases?: Record<string, string>
    autoRefreshConfigSeconds?: number | null
    onVisibleDateRangeChange?: (range: { from: string; to: string }) => void
    // Mirrored from the top FilterBar so model / credential / api-key choices
    // filter the events table instead of duplicating the dropdowns inside.
    selectedModels?: string[]
    selectedCredentials?: string[]
    selectedApiKeys?: string[]
    selectedStatus?: string
    onSelectedStatusChange?: (status: string) => void
}

const encodeCsv = (value: string | number): string => {
    const text        = String(value ?? '')
    const trimmedLeft = text.replace(/^\s+/, '')
    const safeText    = trimmedLeft && /^[=+\-@]/.test(trimmedLeft) ? `'${text}` : text
    return `"${safeText.replace(/"/g, '""')}"`
}

type SortField =
    | 'timestampMs'
    | 'model'
    | 'totalTokens'
    | 'inputTokens'
    | 'outputTokens'
    | 'reasoningTokens'
    | 'cachedTokens'
type SortDir = 'asc' | 'desc'

type ModelAliasRelation = {
    channel: string
    name: string
    alias: string
    label: string
}

type ModelAliasLookup = Map<string, ModelAliasRelation[]>

function channelLabel(channel: string): string {
    const labels: Record<string, string> = {
        'aistudio': 'AI Studio',
        'antigravity': 'Antigravity',
        'claude': 'Claude',
        'codex': 'Codex',
        'gemini-cli': 'Gemini CLI',
        'iflow': 'iFlow',
        'openai': 'OpenAI',
        'vertex': 'Vertex',
    }
    return labels[channel] ?? channel
}

function modelKeyCandidates(model: string): string[] {
    const key = model.trim().toLowerCase()
    if (!key) {
        return []
    }
    const withoutModels = key.startsWith('models/') ? key.slice('models/'.length) : key
    return Array.from(new Set([key, withoutModels, `models/${withoutModels}`]))
}

function addModelAliasLookupEntry(lookup: ModelAliasLookup, key: string, relation: ModelAliasRelation): void {
    const relations = lookup.get(key) ?? []
    if (!relations.some((item) => item.channel ===
                                  relation.channel &&
                                  item.name ===
                                  relation.name &&
                                  item.alias ===
                                  relation.alias)) {
        lookup.set(key, [...relations, relation])
    }
}

function buildModelAliasLookup(aliases: Record<string, OAuthModelAliasEntry[]>): ModelAliasLookup {
    const lookup: ModelAliasLookup = new Map()
    for (const [channel, entries] of Object.entries(aliases)) {
        for (const entry of entries ?? []) {
            const name  = entry.name.trim()
            const alias = entry.alias.trim()
            if (!name || !alias) {
                continue
            }
            const relation = {
                channel,
                name,
                alias,
                label: `${channelLabel(channel)}: ${alias} ↔ ${name}`,
            }
            modelKeyCandidates(name).forEach((key) => addModelAliasLookupEntry(lookup, key, relation))
            modelKeyCandidates(alias).forEach((key) => addModelAliasLookupEntry(lookup, key, relation))
        }
    }
    return lookup
}

function resolveModelAliasRelations(model: string, lookup: ModelAliasLookup): string[] {
    return (lookup.get(model.trim().toLowerCase()) ?? []).map((item) => item.label)
}

/** Append shared filter fields to a params object. API keys remain separate query
 *  values so a key containing a comma is not confused with multiple selections. */
function applyFilters(
    params: EventsParams,
    from: string,
    to: string,
    selectedModels: readonly string[],
    selectedCredentials: readonly string[],
    selectedApiKeys: readonly string[],
    searchQuery: string,
    statusFilter: string,
): void {
    if (from) {
        params.from = from
    }
    if (to) {
        params.to = to
    }
    if (selectedModels.length > 0) {
        params.model = selectedModels.join(',')
    }
    if (selectedCredentials.length > 0) {
        params.source = selectedCredentials.join(',')
    }
    if (selectedApiKeys.length > 0) {
        params.api_key = selectedApiKeys
    }
    if (searchQuery.trim()) {
        params.search = searchQuery.trim()
    }
    if (statusFilter === 'success' || statusFilter === 'failure') {
        params.status = statusFilter
    }
}

function renderFailedNoUsage(t: ReturnType<typeof useTranslation>['t']) {
    return t('usage_stats.request_events_failed_no_usage', { defaultValue: '失败未返回用量' })
}

const responseDataToText = async (data: unknown): Promise<string> => {
    if (typeof Blob !== 'undefined' && data instanceof Blob) {
        return data.text()
    }
    if (typeof data === 'string') {
        return data
    }
    return String(data ?? '')
}

/** Map backend sort field name */
function toBackendSortField(field: SortField): string {
    switch (field) {
        case 'timestampMs':
            return 'timestamp'
        case 'totalTokens':
        case 'inputTokens':
        case 'outputTokens':
        case 'reasoningTokens':
        case 'cachedTokens':
            return 'tokens'
        default:
            return field
    }
}

function numberFromValue(value: number | string | null | undefined): number | null {
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : null
    }
    if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value)
        return Number.isFinite(parsed) ? parsed : null
    }
    return null
}

function formatPercent(value: number | null, lang: string, missingText: string): string {
    if (value === null) {
        return missingText
    }
    return `${new Intl.NumberFormat(lang, { maximumFractionDigits: 1 }).format(value)}%`
}

function formatThroughput(value: number | null, lang: string, missingText: string): string {
    if (value === null) {
        return missingText
    }
    return `${new Intl.NumberFormat(lang, { maximumFractionDigits: 1 }).format(value)} tok/s`
}

function formatTokenValue(value: number | null, lang: string, missingText: string): string {
    if (value === null) {
        return missingText
    }
    return formatNumber(value, lang)
}

function formatEventCost(value: number, lang: string, currency = 'USD'): string {
    try {
        return new Intl.NumberFormat(lang, {
            style: 'currency',
            currency,
            minimumFractionDigits: 2,
            maximumFractionDigits: value > 0 && value < 0.01 ? 6 : 4,
        }).format(value)
    } catch {
        return `${currency} ${new Intl.NumberFormat(lang, { maximumFractionDigits: 6 }).format(value)}`
    }
}

function pricingLineItemLabel(
    category: string,
    t: ReturnType<typeof useTranslation>['t'],
): string {
    return t(`usage_stats.request_events_pricing_category_${category}`, { defaultValue: category })
}

function formatPricingReceiptTitle(
    receipt: PricingReceipt,
    currentCost: number,
    lang: string,
    t: ReturnType<typeof useTranslation>['t'],
): string {
    const receiptCostMicro = nonNegativeNumber(receipt.cost_micro) ?? 0
    const receiptCost      = receiptCostMicro / 1_000_000
    const currency         = receipt.currency || 'USD'
    const lines            = [
        t('usage_stats.request_events_pricing_receipt', { defaultValue: 'Request-time pricing receipt' }),
        `${t('usage_stats.request_events_pricing_provider', { defaultValue: 'Provider' })}: ${receipt.provider || '-'}`,
        `${t('usage_stats.request_events_pricing_model', { defaultValue: 'Model' })}: ${receipt.model ||
                                                                                        '-'} → ${receipt.canonical_model ||
                                                                                                 '-'}`,
        `${t('usage_stats.request_events_pricing_source', { defaultValue: 'Source' })}: ${receipt.source || '-'}`,
        `${t('usage_stats.request_events_pricing_revision', { defaultValue: 'Revision' })}: ${receipt.price_revision ||
                                                                                              '-'}`,
        `${t(
            'usage_stats.request_events_pricing_request_cost',
            { defaultValue: 'Request-time cost' },
        )}: ${formatEventCost(receiptCost, lang, currency)} (${receipt.cost_status})`,
        `${t(
            'usage_stats.request_events_pricing_current_cost',
            { defaultValue: 'Current-catalog cost' },
        )}: ${formatEventCost(currentCost, lang)}`,
        `${t('usage_stats.request_events_pricing_coverage', { defaultValue: 'Coverage' })}: ${formatNumber(
            numberFromValue(receipt.coverage.priced_tokens) ?? 0,
            lang,
        )} / ${formatNumber(numberFromValue(receipt.coverage.total_tokens) ?? 0, lang)}`,
    ]
    const effectiveRange   = [receipt.effective_from, receipt.effective_until].filter(Boolean).join(' → ')
    if (effectiveRange) {
        lines.push(`${t(
            'usage_stats.request_events_pricing_effective',
            { defaultValue: 'Effective' },
        )}: ${effectiveRange}`)
    }
    receipt.line_items.forEach((item) => {
        const tokens    = numberFromValue(item.tokens) ?? 0
        const itemCost  = (numberFromValue(item.cost_micro) ?? 0) / 1_000_000
        const rateLabel = item.priced && typeof item.rate_per_million === 'number'
                          ?
                          `${item.rate_per_million}/${t(
                              'usage_stats.request_events_pricing_million_tokens',
                              { defaultValue: 'MTok' },
                          )}`
                          :
                          t('usage_stats.request_events_pricing_unpriced', { defaultValue: 'Unpriced' })
        lines.push(
            `${pricingLineItemLabel(item.category, t)}: ${formatNumber(
                tokens,
                lang,
            )} × ${rateLabel} = ${formatEventCost(itemCost, lang, currency)} [${item.rate_source}]`,
        )
    })
    if (receipt.cost_reason) {
        lines.push(receipt.cost_reason)
    }
    return lines.join('\n')
}

function nonNegativeNumber(value: number | string | null | undefined): number | null {
    const parsed = numberFromValue(value)
    return parsed === null ? null : Math.max(parsed, 0)
}

function backendMaskedApiKey(key: string): string {
    if (key.length > 8) {
        return `${key.slice(0, 4)}...${key.slice(-4)}`
    }
    if (key.length > 4) {
        return `${key.slice(0, 2)}...${key.slice(-2)}`
    }
    if (key.length > 2) {
        return `${key.slice(0, 1)}...${key.slice(-1)}`
    }
    return key
}

function resolveApiKeyAlias(apiKey: string, aliases?: Record<string, string>): string {
    if (!apiKey || !aliases) {
        return ''
    }
    if (aliases[apiKey]) {
        return aliases[apiKey]
    }
    for (const [rawKey, alias] of Object.entries(aliases)) {
        if (backendMaskedApiKey(rawKey) === apiKey || maskApiKey(rawKey) === apiKey) {
            return alias
        }
    }
    return ''
}

function displayApiKey(apiKey: string, alias: string, noApiKeyLabel: string): string {
    if (!apiKey) {
        return noApiKeyLabel
    }
    if (alias) {
        return alias
    }
    return apiKey.includes('...') ? apiKey : maskApiKey(apiKey)
}

function errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err || '')
}

function normalizeRequestLogState(value: unknown): RequestLogState {
    switch (value) {
        case 'pending':
        case 'available':
        case 'disabled':
        case 'not_captured':
        case 'publish_failed':
        case 'expired':
        case 'legacy_unknown':
            return value
        default:
            return 'legacy_unknown'
    }
}

function requestLogStateLabel(
    state: RequestLogState,
    t: ReturnType<typeof useTranslation>['t'],
): string {
    switch (state) {
        case 'pending':
            return t('usage_stats.request_events_log_state_pending', { defaultValue: 'Log is being generated' })
        case 'disabled':
            return t('usage_stats.request_events_log_state_disabled', { defaultValue: 'Logging was disabled' })
        case 'not_captured':
            return t('usage_stats.request_events_log_state_not_captured', { defaultValue: 'Log was not captured' })
        case 'publish_failed':
            return t('usage_stats.request_events_log_state_publish_failed', { defaultValue: 'Log generation failed' })
        case 'expired':
            return t('usage_stats.request_events_log_state_expired', { defaultValue: 'Log has expired' })
        case 'legacy_unknown':
            return t('usage_stats.request_events_log_state_legacy_unknown', {
                defaultValue: 'Historical request has no log status',
            })
        case 'available':
            return t('usage_stats.request_events_log_state_available', { defaultValue: 'Log available' })
    }
}

function safeRequestLogFilename(requestId: string): string {
    return `request-${requestId.replace(/[^a-zA-Z0-9_.-]/g, '_')}.log`
}

/** Map a UsageEvent from backend to a RequestEventRow */
function eventToRow(
    event: UsageEvent,
    index: number,
    sourceInfoMap: ReturnType<typeof buildSourceInfoMap>,
    authFileMap: Map<string, CredentialInfo>,
    lang: string,
    noApiKeyLabel: string,
    notRecordedLabel: string,
    modelAliasLookup: ModelAliasLookup,
    t: ReturnType<typeof useTranslation>['t'],
    aliases?: Record<string, string>,
): RequestEventRow {
    const timestampMs         = Date.parse(event.timestamp)
    const date                = Number.isNaN(timestampMs) ? null : new Date(timestampMs)
    const sourceRaw           = event.source || ''
    const authIndex           = event.auth_index || '-'
    const sourceInfo          = resolveSourceDisplay(sourceRaw, event.auth_index, sourceInfoMap, authFileMap)
    const rawApiKey           = event.api_key || ''
    const alias               = 'api_key_alias' in event
                                ? (event.api_key_alias || '').trim()
                                : resolveApiKeyAlias(rawApiKey, aliases)
    const sourceDisplay       = sourceInfo.displayName.trim()
    const hasSourceDisplay    = sourceDisplay !== '' && sourceDisplay !== '-'
    const maskedApiKey        = displayApiKey(rawApiKey, alias, noApiKeyLabel)
    const sourceBase          =
              hasSourceDisplay && sourceDisplay !== maskedApiKey ?
              sourceDisplay :
              alias || sourceDisplay || noApiKeyLabel
    const providerLabel       = (sourceInfo.type || event.provider || '').trim()
    const providerDisplay     = providerLabel ? channelLabel(providerLabel) : ''
    const latencyMs           = extractLatencyMs(event)
    const timeToFirstByteMs   = numberFromValue(event.time_to_first_byte_ms)
    const totalDurationMs     = numberFromValue(event.total_duration_ms)
    const requestId           = typeof event.request_id === 'string' ? event.request_id.trim() : ''
    const requestLogState     = normalizeRequestLogState(event.request_log_state)
    const requestLogHomeIp    = typeof event.request_log_home_ip === 'string' ? event.request_log_home_ip.trim() : ''
    const tokenMetrics        = resolveUsageTokenMetrics(event.tokens)
    const inputTokens         = tokenMetrics.inputTokens
    const outputTokens        = tokenMetrics.outputTokens
    const reasoningTokens     = tokenMetrics.reasoningTokens
    const cachedTokens        = tokenMetrics.cachedTokens
    const cacheReadTokens     = tokenMetrics.cacheReadTokens
    const cacheWriteTokens    = tokenMetrics.cacheWriteTokens
    const totalTokens         = tokenMetrics.totalTokens
    const cacheHitRate        = inputTokens !== null && tokenMetrics.cacheHitTokens !== null && inputTokens > 0
                                ? (tokenMetrics.cacheHitTokens / inputTokens) * 100
                                : null
    const throughputTokens    =
              totalDurationMs !== null && totalDurationMs > 0 && outputTokens !== null
              ? outputTokens / (totalDurationMs / 1000)
              : null
    const cost                = nonNegativeNumber(event.cost) ?? 0
    const pricingReceipt      = event.pricing_receipt
    const requestTimeCost     = pricingReceipt
                                ? (nonNegativeNumber(pricingReceipt.cost_micro) ?? 0) / 1_000_000
                                : null
    const receiptCurrency     = pricingReceipt?.currency || 'USD'
    const pricingChanged      = requestTimeCost !== null && receiptCurrency === 'USD' &&
                                Math.abs(requestTimeCost - cost) >= 0.0000005
    const pricingReceiptLabel = pricingReceipt && requestTimeCost !== null
                                ?
                                `${t(
                                    'usage_stats.request_events_pricing_request_short',
                                    { defaultValue: 'At request' },
                                )}: ${formatEventCost(requestTimeCost, lang, receiptCurrency)}${pricingChanged ?
                                                                                                ` · ${t(
                                                                                                    'usage_stats.request_events_pricing_recalculated',
                                                                                                    { defaultValue: 'Recalculated' },
                                                                                                )}` :
                                                                                                ''}`
                                :
                                ''
    const pricingReceiptTitle = pricingReceipt
                                ? formatPricingReceiptTitle(pricingReceipt, cost, lang, t)
                                : ''
    const thinking            = normalizeUsageThinking(event.thinking)
    const hasRequestMetadata  =
              event.metadata_recorded === true &&
              (requestId !== '' ||
               timeToFirstByteMs !== null ||
               totalDurationMs !== null ||
               typeof event.completed === 'boolean')

    return {
        id: `${requestId || event.timestamp}-${event.model}-${sourceRaw}-${authIndex}-${index}`,
        timestamp: event.timestamp,
        timestampMs: Number.isNaN(timestampMs) ? 0 : timestampMs,
        timestampLabel: date ? formatDateTime(date, lang) : event.timestamp || '-',
        model: event.model || '-',
        modelAliasRelations: resolveModelAliasRelations(event.model || '', modelAliasLookup),
        sourceRaw: sourceRaw || '-',
        source: sourceInfo.displayName,
        sourceType: providerDisplay,
        sourceLabel: sourceBase,
        authIndex,
        apiKey: rawApiKey,
        apiKeyMasked: maskedApiKey,
        user: sourceBase,
        requestId,
        requestLogState,
        requestLogHomeIp,
        latencyMs,
        latencyLabel: formatDurationMs(latencyMs, { locale: lang, invalidText: notRecordedLabel }),
        timeToFirstByteMs,
        timeToFirstByteLabel: formatDurationMs(timeToFirstByteMs, { locale: lang, invalidText: notRecordedLabel }),
        totalDurationMs,
        totalDurationLabel: formatDurationMs(totalDurationMs, { locale: lang, invalidText: notRecordedLabel }),
        completed: hasRequestMetadata && typeof event.completed === 'boolean' ? event.completed : null,
        cacheHitRate,
        cacheHitRateLabel: formatPercent(cacheHitRate, lang, notRecordedLabel),
        throughputTokensPerSecond: throughputTokens,
        throughputLabel: formatThroughput(throughputTokens, lang, notRecordedLabel),
        thinking,
        thinkingLabel: formatRequestThinkingLabel(thinking, reasoningTokens, lang, t, notRecordedLabel),
        thinkingRecorded: Boolean(thinking || reasoningTokens !== null),
        thinkingNone: isNoThinkingUsage(thinking),
        failed: event.failed,
        inputTokens,
        inputTokensLabel: formatTokenValue(inputTokens, lang, notRecordedLabel),
        outputTokens,
        outputTokensLabel: formatTokenValue(outputTokens, lang, notRecordedLabel),
        reasoningTokens,
        reasoningTokensLabel: formatTokenValue(reasoningTokens, lang, notRecordedLabel),
        cachedTokens,
        cachedTokensLabel: formatTokenValue(cachedTokens, lang, notRecordedLabel),
        cacheReadTokens,
        cacheReadTokensLabel: formatTokenValue(cacheReadTokens, lang, notRecordedLabel),
        cacheWriteTokens,
        cacheWriteTokensLabel: formatTokenValue(cacheWriteTokens, lang, notRecordedLabel),
        totalTokens,
        totalTokensLabel: formatTokenValue(totalTokens, lang, notRecordedLabel),
        cost,
        costLabel: formatEventCost(cost, lang),
        pricingReceiptLabel,
        pricingReceiptTitle,
    }
}

export function RequestEventsDetailsCard({
                                             enabled = true,
                                             refreshToken = 0,
                                             geminiKeys,
                                             claudeConfigs,
                                             codexConfigs,
                                             vertexConfigs,
                                             openaiProviders,
                                             drillDownSearch,
                                             authFileMap,
                                             dateRange,
                                             activePreset,
                                             aliases,
                                             autoRefreshConfigSeconds,
                                             onVisibleDateRangeChange,
                                             selectedModels,
                                             selectedCredentials,
                                             selectedApiKeys,
                                             selectedStatus,
                                             onSelectedStatusChange,
                                         }: RequestEventsDetailsCardProps) {
    const { t, i18n }      = useTranslation()
    const config           = useConfigStore((state) => state.config)
    const showNotification = useNotificationStore((state) => state.showNotification)

    // Model / credential / api-key filters come from the top FilterBar via props;
    // only the result (status) filter and free-text search remain local since the
    // top bar has no equivalents for those.
    const topModels      = useMemo(() => selectedModels ?? [], [selectedModels])
    const topCredentials = useMemo(() => selectedCredentials ?? [], [selectedCredentials])
    const topApiKeys     = useMemo(() => selectedApiKeys ?? [], [selectedApiKeys])

    const statusFilter                  = selectedStatus ?? STATUS_ALL
    const [searchInput, setSearchInput] = useState('')
    const searchQuery                   = useDebounce(searchInput, 300)
    const [sortField, setSortField]     = useState<SortField>('timestampMs')
    const [sortDir, setSortDir]         = useState<SortDir>('desc')
    const [page, setPage]               = useState(1)
    const [pageSize, setPageSize]       = useState(DEFAULT_PAGE_SIZE)

    // 自动刷新需要手动开启，并且只用于滚动的最近 24 小时范围
    const configuredAutoRefreshInterval                                 = useMemo(
        () => resolveUsageEventsAutoRefreshMs(autoRefreshConfigSeconds ?? config?.autoRefreshInterval),
        [autoRefreshConfigSeconds, config?.autoRefreshInterval],
    )
    const [autoRefreshEnabled, setAutoRefreshEnabled]                   = useState(false)
    const [autoRefreshIntervalOverride, setAutoRefreshIntervalOverride] = useState<number | null>(null)
    const autoRefresh                                                   = activePreset === '24h' && autoRefreshEnabled
    const autoRefreshInterval                                           =
              autoRefreshIntervalOverride ?? configuredAutoRefreshInterval
    const [autoRefreshClockMs, setAutoRefreshClockMs]                   = useState(() => Date.now())

    // Server-side data
    const [eventsData, setEventsData]                           = useState<EventsResponse | null>(null)
    const [settledRequestSignature, setSettledRequestSignature] = useState('')
    const [fetchError, setFetchError]                           = useState<string>('')
    const [requestLogPreview, setRequestLogPreview]             = useState<{
                                                                               id: string
                                                                               homeIp: string
                                                                               content: string
                                                                               truncated: boolean
                                                                               totalLines: number
                                                                           } | null>(null)
    const [requestLogError, setRequestLogError]                 = useState('')
    const [requestLogPreviewing, setRequestLogPreviewing]       = useState<Set<string>>(() => new Set())
    const [requestLogDownloading, setRequestLogDownloading]     = useState<Set<string>>(() => new Set())
    const [oauthModelAlias, setOauthModelAlias]                 = useState<Record<string, OAuthModelAliasEntry[]>>({})
    const [modelAliasError, setModelAliasError]                 = useState('')
    const [exportingFormat, setExportingFormat]                 = useState<'csv' | 'json' | null>(null)
    const eventsRequestControllerRef                            = useRef<AbortController | null>(null)
    const exportControllerRef                                   = useRef<AbortController | null>(null)
    const requestLogPreviewSeqRef                               = useRef(0)
    const activeRequestLogPreviewRef                            = useRef<string | null>(null)

    // 从图表钻取时，同步搜索关键词
    const [prevDrillDown, setPrevDrillDown] = useState(drillDownSearch)
    if (prevDrillDown !== drillDownSearch) {
        setPrevDrillDown(drillDownSearch)
        if (drillDownSearch) {
            setSearchInput(drillDownSearch)
            setPage(1)
        }
    }

    const effectiveDateRange = useMemo(() => {
        if (!autoRefresh) {
            return { from: dateRange.from, to: dateRange.to }
        }
        const now = new Date(autoRefreshClockMs)
        return {
            from: toLocalDateTimeSecondsString(new Date(now.getTime() - 24 * 60 * 60 * 1000)),
            to: toLocalDateTimeSecondsString(now),
        }
    }, [autoRefresh, autoRefreshClockMs, dateRange.from, dateRange.to])

    useEffect(() => {
        onVisibleDateRangeChange?.(effectiveDateRange)
    }, [effectiveDateRange, onVisibleDateRangeChange])

    const sourceInfoMap    = useMemo(
        () =>
            buildSourceInfoMap({
                                   geminiApiKeys: geminiKeys,
                                   claudeApiKeys: claudeConfigs,
                                   codexApiKeys: codexConfigs,
                                   vertexApiKeys: vertexConfigs,
                                   openaiCompatibility: openaiProviders,
                               }),
        [claudeConfigs, codexConfigs, geminiKeys, openaiProviders, vertexConfigs],
    )
    const modelAliasLookup = useMemo(() => buildModelAliasLookup(oauthModelAlias), [oauthModelAlias])

    useEffect(() => {
        let cancelled = false
        authFilesApi
            .getOauthModelAlias()
            .then((data) => {
                if (!cancelled) {
                    setOauthModelAlias(data)
                    setModelAliasError('')
                }
            })
            .catch((err) => {
                console.warn('Failed to load model aliases:', err)
                if (!cancelled) {
                    setModelAliasError(errorMessage(err) || t('common.unknown_error'))
                }
            })
        return () => {
            cancelled = true
        }
    }, [t])

    // Reset page when filters change
    const pageResetSignature                      = [
        topModels.join(','),
        topCredentials.join(','),
        topApiKeys.join(','),
        statusFilter,
        searchQuery,
        sortField,
        sortDir,
        dateRange.from,
        dateRange.to,
        String(refreshToken),
    ].join('|')
    const [prevPageResetSig, setPrevPageResetSig] = useState(pageResetSignature)
    if (prevPageResetSig !== pageResetSignature) {
        setPrevPageResetSig(pageResetSignature)
        setPage(1)
    }

    const eventsParams           = useMemo<EventsParams>(() => {
        const params: EventsParams = {
            page,
            page_size: pageSize,
            sort: toBackendSortField(sortField),
            order: sortDir,
            view: 'compact',
        }
        applyFilters(
            params,
            effectiveDateRange.from,
            effectiveDateRange.to,
            topModels,
            topCredentials,
            topApiKeys,
            searchQuery,
            statusFilter,
        )
        return params
    }, [
                                                             page,
                                                             pageSize,
                                                             sortField,
                                                             sortDir,
                                                             effectiveDateRange.from,
                                                             effectiveDateRange.to,
                                                             topModels,
                                                             topCredentials,
                                                             topApiKeys,
                                                             statusFilter,
                                                             searchQuery,
                                                         ])
    const eventsRequestSignature = useMemo(() => JSON.stringify(eventsParams), [eventsParams])

    // Fetch events from backend
    useEffect(() => {
        if (!enabled) {
            eventsRequestControllerRef.current?.abort()
            eventsRequestControllerRef.current = null
            return
        }

        const controller                   = new AbortController()
        eventsRequestControllerRef.current = controller

        usageApi
            .getEvents(eventsParams, { signal: controller.signal })
            .then((data) => {
                if (eventsRequestControllerRef.current === controller && !controller.signal.aborted) {
                    setEventsData(data)
                    setFetchError('')
                }
            })
            .catch((err: unknown) => {
                if (eventsRequestControllerRef.current === controller && !controller.signal.aborted) {
                    setFetchError(err instanceof Error ? err.message : 'request failed')
                }
            })
            .finally(() => {
                if (eventsRequestControllerRef.current === controller) {
                    eventsRequestControllerRef.current = null
                    if (!controller.signal.aborted) {
                        setSettledRequestSignature(eventsRequestSignature)
                    }
                }
            })

        return () => {
            if (eventsRequestControllerRef.current === controller) {
                eventsRequestControllerRef.current = null
            }
            controller.abort()
        }
    }, [enabled, eventsParams, eventsRequestSignature])

    useEffect(() => {
        const scheduleEligible = shouldRefreshUsageEvents({
                                                              activePreset,
                                                              enabled: enabled && autoRefreshEnabled,
                                                              page,
                                                              sortField,
                                                              sortDir,
                                                              pageVisible: true,
                                                              busy: false,
                                                          })
        if (!scheduleEligible || requestLogPreview !== null || exportingFormat !== null) {
            return
        }
        const intervalId = window.setInterval(() => {
            const busy = Boolean(eventsRequestControllerRef.current) ||
                         requestLogPreview !== null ||
                         exportingFormat !== null
            if (shouldRefreshUsageEvents({
                                             activePreset,
                                             enabled: enabled && autoRefreshEnabled,
                                             page,
                                             sortField,
                                             sortDir,
                                             pageVisible: document.visibilityState === 'visible',
                                             busy,
                                         })) {
                setAutoRefreshClockMs(Date.now())
            }
        }, autoRefreshInterval)
        return () => window.clearInterval(intervalId)
    }, [
                  activePreset,
                  autoRefreshEnabled,
                  autoRefreshInterval,
                  enabled,
                  exportingFormat,
                  page,
                  requestLogPreview,
                  sortDir,
                  sortField,
              ])

    useEffect(
        () => () => {
            exportControllerRef.current?.abort()
        },
        [],
    )

    const noApiKeyLabel        = t('usage_stats.filter_api_key_none')
    const identityLabel        = t('usage_stats.request_events_identity', { defaultValue: 'Identity' })
    const apiKeyLabel          = t('usage_stats.request_events_api_key', { defaultValue: 'API Key' })
    const requestLogLabel      = t('usage_stats.request_events_request_log', { defaultValue: 'Request log' })
    const missingMetadataTitle = t('usage_stats.request_events_missing_metadata_hint', {
        defaultValue: 'Historical events do not contain this metadata',
    })
    const notRecordedLabel     = t('usage_stats.request_events_not_recorded', { defaultValue: 'Not recorded' })

    const rows = useMemo<RequestEventRow[]>(
        () => {
            if (!enabled || !eventsData?.events) {
                return []
            }
            return eventsData.events.map((event, index) =>
                                             eventToRow(
                                                 event,
                                                 index,
                                                 sourceInfoMap,
                                                 authFileMap,
                                                 i18n.language,
                                                 noApiKeyLabel,
                                                 notRecordedLabel,
                                                 modelAliasLookup,
                                                 t,
                                                 aliases,
                                             ),
            )
        },
        [
            enabled,
            eventsData,
            sourceInfoMap,
            authFileMap,
            i18n.language,
            noApiKeyLabel,
            notRecordedLabel,
            modelAliasLookup,
            t,
            aliases,
        ],
    )

    const totalCount       = enabled ? (eventsData?.total ?? 0) : 0
    const fetching         = enabled && settledRequestSignature !== eventsRequestSignature
    const isInitialLoading = fetching && !eventsData
    const isRefreshingRows = fetching && rows.length > 0
    const isLoading        = !enabled || fetching

    const hasActiveFilters =
              statusFilter !== STATUS_ALL ||
              searchInput.trim() !== '' ||
              topModels.length > 0 ||
              topCredentials.length > 0 ||
              topApiKeys.length > 0

    const handleClearFilters = () => {
        onSelectedStatusChange?.(STATUS_ALL)
        setSearchInput('')
    }

    const buildExportParams = useCallback(
        (page: number): EventsParams => {
            const params: EventsParams = {
                page,
                page_size: USAGE_EVENT_EXPORT_PAGE_SIZE,
                sort: toBackendSortField(sortField),
                order: sortDir,
            }
            applyFilters(
                params,
                effectiveDateRange.from,
                effectiveDateRange.to,
                topModels,
                topCredentials,
                topApiKeys,
                searchQuery,
                statusFilter,
            )
            return params
        },
        [effectiveDateRange, topModels, topCredentials, topApiKeys, statusFilter, searchQuery, sortField, sortDir],
    )

    const exportEvents = useCallback(
        async (format: 'csv' | 'json') => {
            exportControllerRef.current?.abort()
            const controller            = new AbortController()
            exportControllerRef.current = controller
            setExportingFormat(format)

            const formatRow = (event: UsageEvent, index: number) => eventToRow(
                event,
                index,
                sourceInfoMap,
                authFileMap,
                i18n.language,
                noApiKeyLabel,
                notRecordedLabel,
                modelAliasLookup,
                t,
                aliases,
            )

            try {
                const blob = await createUsageEventExport({
                                                              format,
                                                              signal: controller.signal,
                                                              csvHeader: USAGE_EVENT_CSV_HEADER,
                                                              fetchPage: (page, signal) => usageApi.getEvents(
                                                                  buildExportParams(page),
                                                                  { signal },
                                                              ),
                                                              formatCsvRow: (event, index) => {
                                                                  const row = formatRow(event, index)
                                                                  return [
                                                                      event.timestamp,
                                                                      event.model,
                                                                      event.source,
                                                                      event.auth_index ?? '',
                                                                      event.provider ?? '',
                                                                      row.apiKeyMasked,
                                                                      row.user,
                                                                      row.requestId,
                                                                      event.failed ? 'failed' : 'success',
                                                                      row.latencyMs ?? '',
                                                                      row.timeToFirstByteMs ?? '',
                                                                      row.totalDurationMs ?? '',
                                                                      row.completed === null ?
                                                                      '' :
                                                                      String(row.completed),
                                                                      row.cacheHitRate ?? '',
                                                                      row.throughputTokensPerSecond ?? '',
                                                                      row.thinking?.intensity ?? '',
                                                                      row.thinking?.mode ?? '',
                                                                      row.thinking?.level ?? '',
                                                                      row.thinking?.budget ?? '',
                                                                      row.inputTokens ?? '',
                                                                      row.outputTokens ?? '',
                                                                      row.reasoningTokens ?? '',
                                                                      row.cacheReadTokens ?? '',
                                                                      row.cacheWriteTokens ?? '',
                                                                      row.cachedTokens ?? '',
                                                                      row.totalTokens ?? '',
                                                                      row.cost,
                                                                  ]
                                                                      .map((value) => encodeCsv(value))
                                                                      .join(',')
                                                              },
                                                              formatJsonEvent: (event, index) => {
                                                                  const safeEvent = { ...event } as Record<string, unknown>
                                                                  delete safeEvent.raw_api_key
                                                                  return {
                                                                      ...safeEvent,
                                                                      api_key: formatRow(event, index).apiKeyMasked,
                                                                      thinking: normalizeUsageThinking(event.thinking) ??
                                                                                undefined,
                                                                  }
                                                              },
                                                          })
                if (!blob || controller.signal.aborted) {
                    return
                }
                const fileTime = new Date().toISOString().replace(/[:.]/g, '-')
                downloadBlob({
                                 filename: `usage-events-${fileTime}.${format}`,
                                 blob,
                                 revokeDelayMs: 60000,
                             })
                showNotification(t('usage_stats.export_success'), 'success')
            } catch (err: unknown) {
                if (!controller.signal.aborted) {
                    if (err instanceof UsageEventExportLimitError) {
                        showNotification(
                            t('usage_stats.export_limit_exceeded', {
                                limit: formatNumber(MAX_USAGE_EVENT_EXPORT_EVENTS, i18n.language),
                            }),
                            'warning',
                        )
                    } else {
                        const message = err instanceof Error ? err.message : String(err)
                        showNotification(
                            `${t('notification.download_failed')}${message ? `: ${message}` : ''}`,
                            'error',
                        )
                    }
                }
            } finally {
                if (exportControllerRef.current === controller) {
                    exportControllerRef.current = null
                    setExportingFormat(null)
                }
            }
        },
        [
            aliases,
            authFileMap,
            buildExportParams,
            i18n.language,
            modelAliasLookup,
            noApiKeyLabel,
            notRecordedLabel,
            showNotification,
            sourceInfoMap,
            t,
        ],
    )

    const handleExportCsv  = useCallback(() => void exportEvents('csv'), [exportEvents])
    const handleExportJson = useCallback(() => void exportEvents('json'), [exportEvents])

    const handleSort = useCallback((field: SortField) => {
        setSortField((prev) => {
            if (prev === field) {
                setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
            } else {
                setSortDir(field === 'model' ? 'asc' : 'desc')
            }
            return field
        })
    }, [])

    const previewRequestLog = useCallback(async (requestId: string, homeIp: string) => {
        if (!requestId) {
            return
        }
        const seq                          = ++requestLogPreviewSeqRef.current
        activeRequestLogPreviewRef.current = requestId
        setRequestLogPreview({ id: requestId, homeIp, content: '', truncated: false, totalLines: 0 })
        setRequestLogError('')
        setRequestLogPreviewing((prev) => new Set(prev).add(requestId))
        try {
            const preview = await logsApi.previewRequestLogById(requestId, 300, homeIp || undefined)
            if (requestLogPreviewSeqRef.current === seq && activeRequestLogPreviewRef.current === requestId) {
                setRequestLogPreview({
                                         id: requestId,
                                         homeIp,
                                         content: redactSensitiveText(preview.content),
                                         truncated: preview.truncated,
                                         totalLines: preview.total_lines,
                                     })
            }
        } catch (err) {
            if (requestLogPreviewSeqRef.current === seq && activeRequestLogPreviewRef.current === requestId) {
                setRequestLogError(errorMessage(err) || 'request log unavailable')
            }
        } finally {
            setRequestLogPreviewing((prev) => {
                const next = new Set(prev)
                next.delete(requestId)
                return next
            })
        }
    }, [])

    const downloadRequestLog = useCallback(async (requestId: string, homeIp: string) => {
        if (!requestId) {
            return
        }
        setRequestLogError('')
        setRequestLogDownloading((prev) => new Set(prev).add(requestId))
        try {
            const response = await logsApi.downloadRequestLogById(requestId, homeIp || undefined)
            const content  = redactSensitiveText(await responseDataToText(response.data))
            downloadBlob({
                             filename: safeRequestLogFilename(requestId),
                             blob: new Blob([content], { type: 'text/plain' }),
                         })
        } catch (err) {
            setRequestLogError(errorMessage(err) || 'request log download failed')
            setRequestLogPreview((prev) => prev ?? {
                id: requestId,
                homeIp,
                content: '',
                truncated: false,
                totalLines: 0,
            })
        } finally {
            setRequestLogDownloading((prev) => {
                const next = new Set(prev)
                next.delete(requestId)
                return next
            })
        }
    }, [])

    const renderSortableHeader = useCallback((field: SortField, label: string) => (
        <button type='button' className={styles.sortHeaderButton} onClick={() => handleSort(field)}>
            {label}
            {sortField === field ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
        </button>
    ), [handleSort, sortDir, sortField])

    const requestEventColumns = useMemo<SheetColumn<RequestEventRow>[]>(
        () => [
            {
                key: 'timestamp',
                header: renderSortableHeader('timestampMs', t('usage_stats.request_events_timestamp')),
                headerClassName: styles.sortableHeader,
                className: styles.requestEventsTimestamp,
                cell: (row) => <span title={row.timestamp}>{row.timestampLabel}</span>,
            },
            {
                key: 'model',
                header: renderSortableHeader('model', t('usage_stats.model_name')),
                headerClassName: styles.sortableHeader,
                className: styles.requestEventsModelCell,
                cell: (row) => (
                    <div title={[row.model, ...row.modelAliasRelations].join('\n')}>
                        <div className={styles.requestEventsModelPrimary}>{row.model}</div>
                        {row.modelAliasRelations.slice(0, 2).map((relation) => (
                            <div key={relation} className={styles.requestEventsModelAlias}>{relation}</div>
                        ))}
                    </div>
                ),
            },
            {
                key: 'identity',
                header: `${identityLabel} / ${apiKeyLabel}`,
                className: styles.requestEventsCallerCell,
                cell: (row) => (
                    <div className={styles.requestEventsIdentityStack}
                         title={`${row.user}\n${apiKeyLabel}: ${row.apiKeyMasked}`}>
                        <div className={styles.requestEventsIdentityLine}>
                            {row.sourceType &&
                             <span className={styles.requestEventsProviderChip}>{row.sourceType}</span>}
                            <span className={styles.requestEventsSourceText}>{row.user}</span>
                        </div>
                        <div className={styles.requestEventsApiKeyLine}>
                            <span className={styles.requestEventsApiKeyLabel}>{apiKeyLabel}</span>
                            <span className={styles.requestEventsApiKeyValue}>{row.apiKeyMasked}</span>
                        </div>
                    </div>
                ),
            },
            {
                key: 'result',
                header: t('usage_stats.request_events_result'),
                className: styles.requestEventsResultCell,
                cell: (row) => (
                    <div className={styles.requestEventsResultStack}>
                    <span className={row.failed ? styles.requestEventsResultFailed : styles.requestEventsResultSuccess}>
                        {row.failed ? t('stats.failure') : t('stats.success')}
                    </span>
                        <div className={styles.requestEventsResultSubline}
                             title={row.completed === null ? missingMetadataTitle : undefined}>
                            {row.completed === null
                             ? notRecordedLabel
                             : row.completed
                               ? t('usage_stats.request_events_completed', { defaultValue: 'Completed' })
                               : t('usage_stats.request_events_incomplete', { defaultValue: 'Incomplete' })}
                        </div>
                    </div>
                ),
            },
            {
                key: 'tokens',
                header: renderSortableHeader('totalTokens', t('usage_stats.total_tokens')),
                headerClassName: `${styles.sortableHeader} ${styles.requestEventsNumericHeader}`,
                className: `${styles.requestEventsNumericCell} ${styles.requestEventsTokenCell}`,
                cell: (row) => row.failed && row.totalTokens === 0 ? (
                    <div className={styles.requestEventsNoUsage}>{renderFailedNoUsage(t)}</div>
                ) : (
                                   <>
                                       <div className={styles.requestEventsMetricPrimary}>{row.totalTokensLabel}</div>
                                       <div className={styles.requestEventsSubline}>
                                           {t(
                                               'usage_stats.request_events_input_short',
                                               { defaultValue: '输入' },
                                           )} {row.inputTokensLabel} · {t(
                                           'usage_stats.request_events_output_short',
                                           { defaultValue: '输出' },
                                       )} {row.outputTokensLabel} · {t(
                                           'usage_stats.request_events_reasoning_short',
                                           { defaultValue: '思考' },
                                       )} {row.reasoningTokensLabel} · {t(
                                           'usage_stats.request_events_cache_read_short',
                                           { defaultValue: '缓存读取' },
                                       )} {row.cacheReadTokensLabel} · {t(
                                           'usage_stats.request_events_cache_write_short',
                                           { defaultValue: '缓存写入' },
                                       )} {row.cacheWriteTokensLabel}
                                       </div>
                                   </>
                               ),
            },
            {
                key: 'cost',
                header: t('usage_stats.request_events_cost', { defaultValue: '费用' }),
                headerClassName: styles.requestEventsNumericHeader,
                className: `${styles.requestEventsNumericCell} ${styles.requestEventsCostCell}`,
                cell: (row) => (
                    <div title={row.pricingReceiptTitle || undefined}>
                        <div className={styles.requestEventsMetricPrimary}>{row.costLabel}</div>
                        {row.pricingReceiptLabel && (
                            <div className={styles.requestEventsSubline}>{row.pricingReceiptLabel}</div>
                        )}
                    </div>
                ),
            },
            {
                key: 'duration',
                header: t('usage_stats.request_events_duration', { defaultValue: 'Duration' }),
                headerClassName: styles.requestEventsNumericHeader,
                className: `${styles.requestEventsNumericCell} ${styles.requestEventsDurationCell}`,
                cell: (row) => (
                    <>
                        {row.totalDurationMs !== null ? (
                            <div className={styles.requestEventsMetricPrimary}>{t(
                                'usage_stats.request_events_total_duration')}: {row.totalDurationLabel}</div>
                        ) : row.latencyMs !== null ? (
                            <div className={styles.requestEventsMetricPrimary}>{t(
                                'usage_stats.request_events_recorded_latency',
                                { defaultValue: 'Recorded' },
                            )}: {row.latencyLabel}</div>
                        ) : (
                                <div className={styles.requestEventsMetricPrimary}
                                     title={missingMetadataTitle}>{notRecordedLabel}</div>
                            )}
                        <div className={styles.requestEventsSubline}>
                            {t(
                                'usage_stats.request_events_ttfb',
                                { defaultValue: 'First byte' },
                            )}: {row.timeToFirstByteLabel} · {t(
                            'usage_stats.request_events_throughput',
                            { defaultValue: 'Throughput' },
                        )}: {row.throughputLabel}
                        </div>
                    </>
                ),
            },
            {
                key: 'cacheHit',
                header: t('usage_stats.request_events_cache_hit_rate', { defaultValue: 'Cache hit' }),
                headerClassName: styles.requestEventsNumericHeader,
                className: styles.requestEventsNumericCell,
                cell: (row) => row.cacheHitRateLabel,
            },
            {
                key: 'thinking',
                header: t('usage_stats.request_events_thinking_column', { defaultValue: 'Thinking record' }),
                className: styles.requestEventsThinkingCell,
                cell: (row) => row.thinkingRecorded ? (
                    <span className={`${styles.requestEventsThinkingBadge} ${row.thinkingNone ?
                                                                             styles.requestEventsThinkingNone :
                                                                             ''}`}>{row.thinkingLabel}</span>
                ) : (
                                   <span className={styles.requestEventsPlainMissing}
                                         title={missingMetadataTitle}>{notRecordedLabel}</span>
                               ),
            },
            {
                key: 'requestLog',
                header: requestLogLabel,
                cell: (row) => {
                    if (!row.requestId) {
                        return (
                            <span className={styles.requestEventsPlainMissing}
                                  title={missingMetadataTitle}>{notRecordedLabel}</span>
                        )
                    }
                    const stateLabel = requestLogStateLabel(row.requestLogState, t)
                    return (
                        <div className={styles.requestLogActions}>
                            <span className={styles.requestEventsRequestId} title={row.requestId}>{row.requestId}</span>
                            {row.requestLogState === 'available' ? (
                                <div className={styles.requestLogButtonRow}>
                                    <Button
                                        variant='secondary'
                                        size='xs'
                                        loading={requestLogPreviewing.has(row.requestId)}
                                        onClick={() => void previewRequestLog(row.requestId, row.requestLogHomeIp)}
                                    >
                                        {t('usage_stats.request_events_log_preview', { defaultValue: 'View log' })}
                                    </Button>
                                    <Button
                                        variant='ghost'
                                        size='xs'
                                        loading={requestLogDownloading.has(row.requestId)}
                                        onClick={() => void downloadRequestLog(row.requestId, row.requestLogHomeIp)}
                                    >
                                        {t('common.download')}
                                    </Button>
                                </div>
                            ) : (
                                 <span
                                     className={styles.requestEventsLogDisabled}
                                     title={stateLabel}
                                 >
                                     {stateLabel}
                                 </span>
                             )}
                        </div>
                    )
                },
            },
        ],
        [
            apiKeyLabel,
            downloadRequestLog,
            identityLabel,
            missingMetadataTitle,
            notRecordedLabel,
            previewRequestLog,
            renderSortableHeader,
            requestLogDownloading,
            requestLogLabel,
            requestLogPreviewing,
            t,
        ],
    )

    // First-load skeleton: page=1 + no data + still fetching = haven't shown
    // anything yet. Re-fetches (page change, filter change with prior data)
    // keep the table visible.
    if (isInitialLoading) {
        return (
            <Card title={t('usage_stats.request_events_title')}>
                <CardSkeleton variant='rows' rowCount={6} />
            </Card>
        )
    }

    return (
        <Card
            title={t('usage_stats.request_events_title')}
            extra={
                <div className={styles.requestEventsActions}>
                    <div className={styles.autoRefreshGroup}>
                        <ToggleSwitch
                            label={t('usage_stats.auto_refresh')}
                            checked={autoRefresh}
                            onChange={(value) => {
                                setAutoRefreshEnabled(value)
                                if (value) {
                                    setAutoRefreshClockMs(Date.now())
                                }
                            }}
                            disabled={activePreset !== '24h'}
                        />
                        <Select
                            value={String(autoRefreshInterval)}
                            options={USAGE_EVENTS_AUTO_REFRESH_INTERVALS}
                            onChange={(v) => setAutoRefreshIntervalOverride(Number(v))}
                            disabled={activePreset !== '24h'}
                            fullWidth={false}
                        />
                    </div>
                    <Button variant='ghost' size='sm' onClick={handleClearFilters} disabled={!hasActiveFilters}>
                        {t('usage_stats.clear_filters')}
                    </Button>
                    <Button
                        variant='secondary'
                        size='sm'
                        onClick={handleExportCsv}
                        disabled={fetching || totalCount === 0 || exportingFormat !== null}
                    >
                        {t('usage_stats.export_csv')}
                    </Button>
                    <Button
                        variant='secondary'
                        size='sm'
                        onClick={handleExportJson}
                        disabled={fetching || totalCount === 0 || exportingFormat !== null}
                    >
                        {t('usage_stats.export_json')}
                    </Button>
                </div>
            }
        >
            <div className={styles.requestEventsToolbar}>
                <div className={styles.requestEventsFilterItem}>
                    <input
                        type='text'
                        className={styles.requestEventsSearch}
                        placeholder={t('usage_stats.request_events_search_placeholder')}
                        value={searchInput}
                        onChange={(e) => setSearchInput(e.target.value)}
                    />
                </div>
            </div>

            {modelAliasError && (
                <div className='error-box'>
                    {t('usage_stats.request_events_alias_load_failed')}: {modelAliasError}
                </div>
            )}

            {isLoading && rows.length === 0 ? (
                <div className={styles.hint}>{t('common.loading')}</div>
            ) : !isLoading && fetchError && rows.length === 0 ? (
                <EmptyState title={t('usage_stats.request_events_error_title', '加载失败')} description={fetchError} />
            ) : totalCount === 0 ? (
                <EmptyState
                    title={t(
                        hasActiveFilters
                        ? 'usage_stats.request_events_no_result_title'
                        : 'usage_stats.request_events_empty_title',
                    )}
                    description={t(
                        hasActiveFilters
                        ? 'usage_stats.request_events_no_result_desc'
                        : 'usage_stats.request_events_empty_desc',
                    )}
                />
            ) : (
                    <div className={styles.cardLoadingShell}>
                        <div className={styles.requestEventsMeta}>
                            <span>{t('usage_stats.request_events_count', { count: totalCount })}</span>
                            <span className={styles.requestEventsLimitHint}>
                            {t('usage_stats.request_events_limit_hint', {
                                shown: rows.length,
                                total: totalCount,
                            })}
                        </span>
                            <span
                                className={`${styles.requestEventsRefreshingHint} ${
                                    isRefreshingRows ? '' : styles.requestEventsRefreshingHintIdle
                                }`}
                                aria-live='polite'
                            >
                            {t('common.loading')}
                        </span>
                        </div>

                        <Sheet
                            rows={rows}
                            columns={requestEventColumns}
                            rowKey={(row) => row.id}
                            status='ready'
                            tableWrapClassName={styles.requestEventsTableWrapper}
                            tableClassName={styles.table}
                        />

                        <Pagination
                            total={totalCount}
                            page={page}
                            pageSize={pageSize}
                            onPageChange={setPage}
                            onPageSizeChange={setPageSize}
                        />
                    </div>
                )}

            <Modal
                open={requestLogPreview !== null}
                onClose={() => {
                    ++requestLogPreviewSeqRef.current
                    activeRequestLogPreviewRef.current = null
                    setRequestLogPreview(null)
                    setRequestLogError('')
                }}
                title={
                    requestLogPreview
                    ? t('usage_stats.request_events_log_title', {
                        id: requestLogPreview.id,
                        defaultValue: `Request log ${requestLogPreview.id}`,
                    })
                    : ''
                }
                width={860}
                footer={
                    <>
                        <Button
                            variant='secondary'
                            onClick={() => {
                                ++requestLogPreviewSeqRef.current
                                activeRequestLogPreviewRef.current = null
                                setRequestLogPreview(null)
                                setRequestLogError('')
                            }}
                        >
                            {t('common.close')}
                        </Button>
                        <Button
                            onClick={() => {
                                if (requestLogPreview?.id) {
                                    void downloadRequestLog(requestLogPreview.id, requestLogPreview.homeIp)
                                }
                            }}
                            loading={requestLogPreview ? requestLogDownloading.has(requestLogPreview.id) : false}
                            disabled={!requestLogPreview?.id}
                        >
                            {t('common.download')}
                        </Button>
                    </>
                }
            >
                {requestLogError && <div className={styles.requestLogError}>{requestLogError}</div>}
                {requestLogPreviewing.size > 0 && !requestLogPreview?.content ? (
                    <div className={styles.hint}>{t('common.loading')}</div>
                ) : requestLogPreview?.content ? (
                    <>
                        <div className={styles.requestLogPreviewMeta}>
                            <span>
                                {t('usage_stats.request_events_log_lines', {
                                    count: requestLogPreview.totalLines,
                                    defaultValue: `${requestLogPreview.totalLines} lines`,
                                })}
                            </span>
                            {requestLogPreview.truncated && (
                                <span>
                                    {t('usage_stats.request_events_log_truncated', {
                                        defaultValue: 'Preview truncated, download for the full log',
                                    })}
                                </span>
                            )}
                        </div>
                        <pre className={styles.requestLogPreview}>{requestLogPreview.content}</pre>
                    </>
                ) : null}
            </Modal>
        </Card>
    )
}
