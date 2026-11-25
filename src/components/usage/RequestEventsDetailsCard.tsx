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
import {apiClient} from '@/services/api/client'
import {logsApi, PendingRequestLogError} from '@/services/api/logs'
import {
    type EventsParams,
    type EventsResponse,
    type PricingReceipt,
    type RequestLogState,
    type RequestSpeed,
    type RequestSpeedSource,
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
import {formatDateTime, formatNumber, maskApiKey} from '@/utils/format'
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
import {Fragment, type ReactNode, useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {Link} from 'react-router'
import styles from './RequestEventsDetailsCard.module.scss'
import {
    createUsageEventExport,
    MAX_USAGE_EVENT_EXPORT_EVENTS,
    USAGE_EVENT_EXPORT_PAGE_SIZE,
    UsageEventExportLimitError,
} from './usageEventExport'

const STATUS_ALL              = ''
const DEFAULT_PAGE_SIZE       = 50
const LEGACY_MAX_EVENT_OFFSET = 100_000
const USAGE_EVENT_CSV_HEADER  = [
    'timestamp',
    'model',
    'speed',
    'speed_observation_source',
    'service_tier',
    'request_service_tier',
    'response_service_tier',
    'request_speed',
    'response_speed',
    'client_model',
    'upstream_url',
    'response_url',
    'response_url_source',
    'response_url_status',
    'upstream_next_hop_status',
    'cache_read_reported',
    'cache_write_reported',
    'upstream_model',
    'response_model',
    'response_provider',
    'response_provider_source',
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
    'cost_status',
    'cost_reason',
    'billing_metadata',
    'pricing_receipt',
    'raw_api_key',
    'import_data',
]

function formatRequestThinkingLabel(
    thinking: UsageThinking | null,
    reasoningEffort: string | null | undefined,
    lang: string,
    notRecordedLabel: string,
): string {
    if (thinking) {
        const label = formatThinkingLabel(thinking, lang)
        if (label !== '-') {
            return label
        }
    }
    return reasoningEffort?.trim() || notRecordedLabel
}

type RequestEventRow = {
    id: string
    detailsId: string
    timestamp: string
    timestampMs: number
    timestampLabel: string
    model: string
    clientModel: string
    upstreamUrl: string
    responseUrl: string
    responseUrlLabel: string
    responseUrlSourceLabel: string
    upstreamNextHopLabel: string
    upstreamModel: string
    responseModel: string
    responseProvider: string
    responseProviderSource: string
    requestServiceTier: string
    responseServiceTier: string
    requestSpeed: string
    responseSpeed: string
    speed: RequestSpeed
    speedLabel: string
    speedSource: 'speed' | RequestSpeedSource
    speedSourceLabel: string
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
    costReason: string
    pricingReceiptTitle: string
}

interface RequestEventsDetailsCardProps {
    enabled?: boolean
    rangeLoading?: boolean
    onClearFilters?: () => void
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
    selectedSpeed?: RequestSpeed | ''
    onSelectedSpeedChange?: (speed: RequestSpeed | '') => void
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
    speedFilter: RequestSpeed | '' = '',
): void {
    params.api_key_identity = 'canonical'
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
    if (speedFilter) {
        params.speed = speedFilter
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

function formatPricingReason(reason: string | undefined, t: ReturnType<typeof useTranslation>['t']): string {
    if (!reason) {
        return ''
    }
    let translated = false
    const parts    = reason.split(';').map((part) => {
        switch (part.trim()) {
            case 'billing region was not reported':
            case 'The actual processing geography required for this model was not reported':
                translated = true
                return t('usage_stats.request_events_pricing_region_missing')
            case 'Additional billable operations were not fully reported for this request':
            case 'additional billing quantities or rates are incomplete':
                translated = true
                return t('usage_stats.request_events_pricing_charges_incomplete')
            default:
                return part.trim()
        }
    })
    return translated ? [...new Set(parts.filter(Boolean))].join('\n') : reason
}

function formatPricingReceiptTitle(
    receipt: PricingReceipt,
    currentCost: number | null,
    lang: string,
    t: ReturnType<typeof useTranslation>['t'],
): string {
    const receiptCostMicro = nonNegativeNumber(receipt.cost_micro) ?? 0
    const receiptCost      = receiptCostMicro / 1_000_000
    const currency         = receipt.currency || 'USD'
    const lines            =
              [
                  `${t(
                      'usage_stats.request_events_pricing_provider',
                      { defaultValue: 'Provider' },
                  )}: ${receipt.provider || '-'}`,
                  `${t('usage_stats.request_events_pricing_model', { defaultValue: 'Model' })}: ${
                      receipt.model ||
                      '-'} → ${
                      receipt.canonical_model ||
                      '-'}`,
                  `${t('usage_stats.request_events_pricing_source', { defaultValue: 'Source' })}: ${receipt.source ||
                                                                                                    '-'}`,
                  `${t(
                      'usage_stats.request_events_pricing_revision',
                      { defaultValue: 'Revision' },
                  )}: ${receipt.price_revision ||
                        '-'}`,
                  `${t(
                      'usage_stats.request_events_pricing_request_cost',
                      { defaultValue: 'Request-time cost' },
                  )}: ${receipt.cost_status === 'unpriced'
                        ? t('usage_stats.request_events_pricing_unpriced')
                        : formatEventCost(receiptCost, lang, currency)}`,
                  `${t(
                      'usage_stats.request_events_pricing_current_cost',
                      { defaultValue: 'Current cost' },
                  )}: ${currentCost === null
                        ? t('usage_stats.request_events_pricing_unpriced')
                        : formatEventCost(currentCost, lang)}`,
              ]
    const effectiveRange   = [receipt.effective_from, receipt.effective_until].filter(Boolean).join(' → ')
    if (effectiveRange) {
        lines.push(`${t(
            'usage_stats.request_events_pricing_effective',
            { defaultValue: 'Effective' },
        )}: ${effectiveRange}`)
    }
    lines.push(
        `${t('usage_stats.request_events_actual_speed')}: ${t(
            `usage_stats.request_events_speed_${receipt.speed ?? 'unknown'}`,
        )}`,
        `${t('usage_stats.request_events_pricing_speed_source')}: ${receipt.speed_source
                                                                    ?
                                                                    t(`usage_stats.request_events_speed_source_${receipt.speed_source}`)
                                                                    :
                                                                    t('usage_stats.request_events_not_recorded')}`,
        `${t('usage_stats.request_events_pricing_speed_multiplier')}: ${typeof receipt.speed_multiplier === 'number'
                                                                        ?
                                                                        `×${receipt.speed_multiplier}`
                                                                        :
                                                                        t('usage_stats.request_events_not_recorded')}`,
    )
    if (receipt.speed_rate_source) {
        lines.push(`${t('usage_stats.request_events_pricing_speed_rate_source')}: ${receipt.speed_rate_source}`)
    }
    const speedEffectiveRange = [receipt.speed_effective_from, receipt.speed_effective_until].filter(Boolean)
                                                                                             .join(' → ')
    if (speedEffectiveRange) {
        lines.push(`${t('usage_stats.request_events_pricing_speed_effective')}: ${speedEffectiveRange}`)
    }
    const contextInputTokens = numberFromValue(receipt.billing_metadata?.context_input_tokens)
    if (contextInputTokens !== null) {
        lines.push(`${t('usage_stats.request_events_pricing_context_input')}: ${formatNumber(
            contextInputTokens,
            lang,
        )}`)
    }
    if (receipt.billing_metadata?.region) {
        lines.push(`${t('usage_stats.request_events_pricing_region')}: ${receipt.billing_metadata.region}`)
    }
    receipt.line_items.forEach((item) => {
        const tokens      = numberFromValue(item.tokens) ?? 0
        const itemCost    = (numberFromValue(item.cost_micro) ?? 0) / 1_000_000
        const rateLabel   = item.priced && typeof item.rate_per_million === 'number'
                            ?
                            `${item.rate_per_million}/${t(
                                'usage_stats.request_events_pricing_million_tokens',
                                { defaultValue: 'MTok' },
                            )}`
                            :
                            t('usage_stats.request_events_pricing_unpriced', { defaultValue: 'Unpriced' })
        const rateDetails = [
            typeof item.base_rate_per_million === 'number'
            ? `${t('usage_stats.request_events_pricing_base_rate')}: ${item.base_rate_per_million}`
            : '',
            typeof item.speed_multiplier === 'number'
            ? `${t('usage_stats.request_events_pricing_speed_multiplier')}: ×${item.speed_multiplier}`
            : '',
        ].filter(Boolean).join(' · ')
        const modality    = item.modality ? t(
            `usage_stats.request_events_pricing_modality_${item.modality.toLowerCase()}`,
            { defaultValue: item.modality },
        ) : ''
        const label       = `${pricingLineItemLabel(item.category, t)}${modality ? ` (${modality})` : ''}`
        const costLabel   = item.priced ? formatEventCost(itemCost, lang, currency)
                                        : t('usage_stats.request_events_pricing_unpriced')
        lines.push(
            `${label}: ${formatNumber(tokens, lang)} × ${rateLabel} = ${costLabel} [${item.rate_source}]` +
            (rateDetails ? ` (${rateDetails})` : ''),
        )
    })
    receipt.additional_line_items?.forEach((item) => {
        const kind = t(`usage_stats.request_events_pricing_charge_${item.kind}`, { defaultValue: item.kind })
        const unit = t(`usage_stats.request_events_pricing_unit_${item.unit}`, { defaultValue: item.unit })
        const rate = item.priced && typeof item.price === 'number' && typeof item.per_units === 'number'
                     ? `${formatEventCost(item.price, lang, currency)} / ${formatNumber(item.per_units, lang)} ${unit}`
                     : t('usage_stats.request_events_pricing_unpriced')
        const cost = item.priced ? formatEventCost((numberFromValue(item.cost_micro) ?? 0) / 1_000_000, lang, currency)
                                 : t('usage_stats.request_events_pricing_unpriced')
        lines.push(`${kind}${item.resolution ? ` (${item.resolution})` : ''}: ` +
                   `${formatNumber(item.quantity, lang)} ${unit} × ${rate} = ${cost} [${item.rate_source}]`)
    })
    if (receipt.cost_reason) {
        lines.push(formatPricingReason(receipt.cost_reason, t))
    }
    return lines.join('\n')
}

function nonNegativeNumber(value: number | string | null | undefined): number | null {
    const parsed = numberFromValue(value)
    return parsed === null ? null : Math.max(parsed, 0)
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

function sanitizeUpstreamUrl(value: string | null | undefined): string {
    if (!value?.trim()) {
        return ''
    }
    try {
        const url = new URL(value)
        if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) {
            return ''
        }
        url.username        = ''
        url.password        = ''
        url.hash            = ''
        const sensitiveName = /authorization|api[-_]?key|token|secret|credential|password|passwd|cookie|signature/i
        const sensitivePart = /(?:^|[-_])(key|code|state|sig)(?:$|[-_])/i
        for (const key of Array.from(url.searchParams.keys())) {
            const normalized = key.replace(/([a-z])([A-Z])/g, '$1_$2')
            if (sensitiveName.test(normalized) || sensitivePart.test(normalized)) {
                url.searchParams.set(key, '***')
            }
        }
        return url.toString()
    } catch {
        return ''
    }
}

function observedRequestSpeed(event: UsageEvent): Pick<RequestEventRow, 'speed' | 'speedSource'> {
    // Match the server's strings.TrimSpace, including U+0085 and excluding U+FEFF.
    const normalize                            = (value: string | null | undefined) => (value ?? '').replace(
        /^[\t-\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\t-\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/g,
        '',
    ).toLowerCase()
    const speeds: Record<string, RequestSpeed> = Object.assign(Object.create(null), {
        standard: 'standard', fast: 'fast', ultrafast: 'ultrafast', flex: 'flex', batch: 'batch',
    })
    if (event.speed != null) {
        return { speed: speeds[event.speed] ?? 'unknown', speedSource: 'speed' }
    }
    const responseSpeed = normalize(event.response_speed)
    const usesSpeed     = normalize(event.provider) === 'claude' ||
                          normalize(event.executor_type) === 'claudeexecutor' ||
                          normalize(event.request_speed) !== '' || responseSpeed !== ''
    const value         = usesSpeed ? responseSpeed : normalize(event.response_service_tier)
    if (!usesSpeed) {
        speeds.priority = 'fast'
        speeds.default  = 'standard'
    }
    const speed = speeds[value]
    return speed
           ? { speed, speedSource: usesSpeed ? 'response_speed' : 'response_service_tier' }
           : { speed: 'unknown', speedSource: 'unknown' }
}

const REQUEST_OBSERVATION_GROUPS = [
    {
        title: 'usage_stats.request_events_cpa_observed',
        fallback: 'Observed by CPA',
        fields: [
            ['clientModel', 'usage_stats.request_events_client_model', 'Client-requested model'],
            ['upstreamUrl', 'usage_stats.request_events_upstream_url', 'CPA request target'],
            ['responseUrlLabel', 'usage_stats.request_events_redirect_target', 'Final response URL'],
            ['responseUrlSourceLabel', 'usage_stats.request_events_response_url_source', 'Response URL source'],
            ['upstreamModel', 'usage_stats.request_events_upstream_model', 'Forwarded model'],
            ['requestServiceTier', 'usage_stats.request_events_requested_tier', 'Requested tier'],
            ['requestSpeed', 'usage_stats.request_events_requested_speed', 'Requested speed'],
        ],
    },
    {
        title: 'usage_stats.request_events_upstream_reported',
        fallback: 'Reported by upstream',
        fields: [
            ['responseModel', 'usage_stats.request_events_response_model', 'Returned model'],
            ['responseProvider', 'usage_stats.request_events_response_provider', 'Reported channel'],
            ['responseProviderSource', 'usage_stats.request_events_response_provider_source', 'Channel source'],
            ['responseServiceTier', 'usage_stats.request_events_returned_tier', 'Returned tier'],
            ['responseSpeed', 'usage_stats.request_events_returned_speed', 'Returned speed'],
            ['upstreamNextHopLabel', 'usage_stats.request_events_next_hop', 'Upstream next hop'],
        ],
    },
] as const

function RequestObservationDetails({ row, t, children }: {
    row: RequestEventRow
    t: ReturnType<typeof useTranslation>['t']
    children?: ReactNode
}) {
    const unknown    = t('usage_stats.request_events_observation_unknown', { defaultValue: 'Unknown' })
    const completion = row.completed === null
                       ?
                       t('usage_stats.request_events_not_recorded')
                       :
                       t(row.completed ?
                         'usage_stats.request_events_completed' :
                         'usage_stats.request_events_incomplete')
    const groups     = [
        {
            title: t('usage_stats.request_events_identity'),
            fields: [
                [t('usage_stats.request_events_timestamp'), row.timestampLabel],
                [t('usage_stats.model_name'), row.model],
                [t('usage_stats.credential_name'), row.user],
                [t('usage_stats.request_events_provider'), row.sourceType || unknown],
                [t('usage_stats.request_events_api_key'), row.apiKeyMasked],
                [t('usage_stats.request_events_auth_index'), row.authIndex],
                [t('usage_stats.request_events_thinking_column'), row.thinkingLabel],
            ],
        },
        {
            title: t('usage_stats.tokens_count'),
            fields: [
                [t('usage_stats.total_tokens'), row.totalTokensLabel],
                [t('usage_stats.input_tokens'), row.inputTokensLabel],
                [t('usage_stats.output_tokens'), row.outputTokensLabel],
                [t('usage_stats.reasoning_tokens'), row.reasoningTokensLabel],
                [t('usage_stats.cached_tokens'), row.cachedTokensLabel],
                [t('usage_stats.request_events_cache_read_short'), row.cacheReadTokensLabel],
                [t('usage_stats.request_events_cache_write_short'), row.cacheWriteTokensLabel],
                [t('usage_stats.request_events_cache_hit_rate'), row.cacheHitRateLabel],
            ],
        },
        {
            title: t('usage_stats.request_events_duration'),
            fields: [
                [
                    t('usage_stats.request_events_result'),
                    `${t(row.failed ? 'stats.failure' : 'stats.success')} · ${completion}`,
                ],
                [t('usage_stats.request_events_total_duration'), row.totalDurationLabel],
                [t('usage_stats.request_events_recorded_latency'), row.latencyLabel],
                [t('usage_stats.request_events_ttfb'), row.timeToFirstByteLabel],
                [t('usage_stats.request_events_throughput'), row.throughputLabel],
            ],
        },
    ]
    return (
        <div className={styles.requestObservationDetails}>
            {groups.map(({ title, fields }) => (
                <section key={title}>
                    <h3>{title}</h3>
                    <dl>
                        {fields.map(([label, value]) => (
                            <Fragment key={label}>
                                <dt>{label}</dt>
                                <dd>{value}</dd>
                            </Fragment>
                        ))}
                    </dl>
                </section>
            ))}
            <section>
                <h3>{t('usage_stats.request_events_actual_speed')}</h3>
                <span className={row.speed === 'unknown'
                                 ?
                                 styles.requestEventsPlainMissing :
                                 styles.requestEventsThinkingBadge}>{row.speedLabel}</span>
                <p className={styles.requestEventsSubline}>{row.speedSourceLabel}</p>
                {row.modelAliasRelations.map((relation) => <p key={relation}>{relation}</p>)}
            </section>
            {REQUEST_OBSERVATION_GROUPS.map(({ title, fallback, fields }) => (
                <section key={title}>
                    <h3>{t(title, { defaultValue: fallback })}</h3>
                    <dl>
                        {fields.map(([field, key, label]) => (
                            <Fragment key={key}>
                                <dt>{t(key, { defaultValue: label })}</dt>
                                <dd>{row[field] || unknown}</dd>
                            </Fragment>
                        ))}
                    </dl>
                </section>
            ))}
            <section className={styles.requestPricingSection}>
                <h3>{t('usage_stats.request_events_cost')}</h3>
                <div className={styles.requestEventsMetricPrimary}>{row.costLabel}</div>
                {row.costReason && <p className={styles.requestEventsCostReason}>{row.costReason}</p>}
                <h3>{t('usage_stats.request_events_pricing_receipt')}</h3>
                {row.pricingReceiptTitle
                 ? <div className={styles.requestPricingReceipt}>{row.pricingReceiptTitle}</div>
                 : <span>{t('usage_stats.request_events_pricing_receipt_missing')}</span>}
            </section>
            {children}
        </div>
    )
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
    const timestampMs                                   = Date.parse(event.timestamp)
    const date                                          = Number.isNaN(timestampMs) ? null : new Date(timestampMs)
    const sourceRaw                                     = event.source || ''
    const authIndex                                     = event.auth_index || '-'
    const sourceInfo                                    = resolveSourceDisplay(
        sourceRaw,
        event.auth_index,
        sourceInfoMap,
        authFileMap,
        event.provider,
    )
    const rawApiKey                                     = event.api_key || ''
    const alias                                         = event.api_key_alias?.trim() ||
                                                          aliases?.[rawApiKey]?.trim() ||
                                                          ''
    const sourceDisplay                                 = aliases?.[sourceRaw]?.trim() ||
                                                          aliases?.[sourceInfo.displayName]?.trim() ||
                                                          sourceInfo.displayName.trim()
    const hasSourceDisplay                              = sourceDisplay !== '' && sourceDisplay !== '-'
    const maskedApiKey                                  = displayApiKey(rawApiKey, alias, noApiKeyLabel)
    const sourceBase                                    =
              hasSourceDisplay && sourceDisplay !== maskedApiKey ?
              sourceDisplay :
              alias || sourceDisplay || noApiKeyLabel
    const providerLabel                                 = (event.provider?.trim() || sourceInfo.type || '').trim()
    const providerDisplay                               = providerLabel ? channelLabel(providerLabel) : ''
    const latencyMs                                     = extractLatencyMs(event)
    const timeToFirstByteMs                             = numberFromValue(event.time_to_first_byte_ms)
    const totalDurationMs                               = numberFromValue(event.total_duration_ms)
    const requestId                                     = typeof event.request_id === 'string' ?
                                                          event.request_id.trim() :
                                                          ''
    const requestLogState                               = normalizeRequestLogState(event.request_log_state)
    const requestLogHomeIp                              = typeof event.request_log_home_ip === 'string' ?
                                                          event.request_log_home_ip.trim() :
                                                          ''
    const tokenMetrics                                  = resolveUsageTokenMetrics(event.tokens)
    const inputTokens                                   = tokenMetrics.inputTokens
    const outputTokens                                  = tokenMetrics.outputTokens
    const reasoningTokens                               = tokenMetrics.reasoningTokens
    const cachedTokens                                  = event.cache_read_reported ===
                                                          false ||
                                                          event.cache_write_reported ===
                                                          false
                                                          ? null : tokenMetrics.cachedTokens
    const cacheReadTokens                               = event.cache_read_reported === false ?
                                                          null :
                                                          tokenMetrics.cacheReadTokens
    const cacheWriteTokens                              = event.cache_write_reported === false ?
                                                          null :
                                                          tokenMetrics.cacheWriteTokens
    const totalTokens                                   = tokenMetrics.totalTokens
    const cacheHitTokens                                = event.cache_read_reported === false ?
                                                          null :
                                                          tokenMetrics.cacheHitTokens
    const cacheHitRate                                  = inputTokens !==
                                                          null &&
                                                          cacheHitTokens !==
                                                          null &&
                                                          inputTokens >
                                                          0
                                                          ? (cacheHitTokens / inputTokens) * 100
                                                          : null
    const throughputTokens                              =
              totalDurationMs !== null && totalDurationMs > 0 && outputTokens !== null
              ? outputTokens / (totalDurationMs / 1000)
              : null
    const cost                                          = nonNegativeNumber(event.cost) ?? 0
    const pricingReceipt                                = event.pricing_receipt
    const pricingReceiptTitle                           = pricingReceipt
                                                          ? formatPricingReceiptTitle(
            pricingReceipt, event.cost_status === 'unpriced' ? null : cost, lang, t,
        )
                                                          : ''
    const thinking                                      = normalizeUsageThinking(event.thinking)
    const { speed, speedSource }                        = observedRequestSpeed(event)
    const speedLabel                                    = t(
        `usage_stats.request_events_speed_${speed}`,
        { defaultValue: speed },
    )
    const speedSourceLabel                              = t(`usage_stats.request_events_speed_source_${speedSource}`)
    const hasRequestMetadata                            =
              event.metadata_recorded === true &&
              (requestId !== '' ||
               timeToFirstByteMs !== null ||
               totalDurationMs !== null ||
               typeof event.completed === 'boolean')
    const responseUrl                                   = sanitizeUpstreamUrl(event.response_url)
    const responseUrlStatusKeys: Record<string, string> = {
        observed: 'usage_stats.request_events_response_url_unavailable',
        no_response: 'usage_stats.request_events_response_url_no_response',
        unavailable: 'usage_stats.request_events_response_url_unavailable',
        not_provided: 'usage_stats.request_events_response_url_not_provided',
        connection_reused: 'usage_stats.request_events_response_url_connection_reused',
    }
    const responseUrlSourceKeys: Record<string, string> = {
        http_response_request_url: 'usage_stats.request_events_response_url_source_http',
        ws_handshake_request_url: 'usage_stats.request_events_response_url_source_websocket',
        ws_connection_handshake_url: 'usage_stats.request_events_response_url_source_connection',
        bridge_final_url: 'usage_stats.request_events_response_url_source_bridge',
    }
    const responseUrlStatusKey                          = responseUrlStatusKeys[event.response_url_status ?? '']
    const responseUrlSourceKey                          = responseUrlSourceKeys[event.response_url_source ?? '']

    return {
        id: `${requestId || event.timestamp}-${event.model}-${sourceRaw}-${authIndex}-${index}`,
        detailsId: `usage-request-details-${index}`,
        timestamp: event.timestamp,
        timestampMs: Number.isNaN(timestampMs) ? 0 : timestampMs,
        timestampLabel: date ? formatDateTime(date, lang) : event.timestamp || '-',
        model: event.model || '-',
        clientModel: event.client_model?.trim() || '',
        upstreamUrl: sanitizeUpstreamUrl(event.upstream_url),
        responseUrl,
        responseUrlLabel: responseUrl || (responseUrlStatusKey ? t(responseUrlStatusKey) : notRecordedLabel),
        responseUrlSourceLabel: responseUrlSourceKey ? t(responseUrlSourceKey) : notRecordedLabel,
        upstreamNextHopLabel: event.upstream_next_hop_status === 'not_reported'
                              ? t('usage_stats.request_events_next_hop_not_reported') : notRecordedLabel,
        upstreamModel: event.upstream_model?.trim() || '',
        responseModel: event.response_model?.trim() || '',
        responseProvider: event.response_provider?.trim() || '',
        responseProviderSource: event.response_provider_source?.trim() || '',
        requestServiceTier: event.request_service_tier?.trim() || event.service_tier?.trim() || '',
        responseServiceTier: event.response_service_tier?.trim() || '',
        requestSpeed: event.request_speed?.trim() || '',
        responseSpeed: event.response_speed?.trim() || '',
        speed,
        speedLabel,
        speedSource,
        speedSourceLabel,
        modelAliasRelations: resolveModelAliasRelations(event.model || '', modelAliasLookup),
        sourceRaw: sourceRaw || '-',
        source: sourceDisplay,
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
        cacheHitRateLabel: event.cache_read_reported === false
                           ? t('usage_stats.request_events_cache_not_reported')
                           : formatPercent(cacheHitRate, lang, notRecordedLabel),
        throughputTokensPerSecond: throughputTokens,
        throughputLabel: formatThroughput(throughputTokens, lang, notRecordedLabel),
        thinking,
        thinkingLabel: formatRequestThinkingLabel(thinking, event.reasoning_effort, lang, notRecordedLabel),
        thinkingRecorded: Boolean(thinking || event.reasoning_effort?.trim()),
        thinkingNone: isNoThinkingUsage(thinking),
        failed: event.failed,
        inputTokens,
        inputTokensLabel: formatTokenValue(inputTokens, lang, notRecordedLabel),
        outputTokens,
        outputTokensLabel: formatTokenValue(outputTokens, lang, notRecordedLabel),
        reasoningTokens,
        reasoningTokensLabel: formatTokenValue(reasoningTokens, lang, notRecordedLabel),
        cachedTokens,
        cachedTokensLabel: event.cache_read_reported === false
                           ? t('usage_stats.request_events_cache_not_reported')
                           : event.cache_write_reported === false
                             ? t('usage_stats.request_events_cache_write_not_reported')
                             : formatTokenValue(cachedTokens, lang, notRecordedLabel),
        cacheReadTokens,
        cacheReadTokensLabel: event.cache_read_reported === false
                              ? t('usage_stats.request_events_cache_not_reported')
                              : formatTokenValue(cacheReadTokens, lang, notRecordedLabel),
        cacheWriteTokens,
        cacheWriteTokensLabel: event.cache_write_reported === false
                               ? t('usage_stats.request_events_cache_write_not_reported')
                               : formatTokenValue(cacheWriteTokens, lang, notRecordedLabel),
        totalTokens,
        totalTokensLabel: formatTokenValue(totalTokens, lang, notRecordedLabel),
        cost,
        costLabel: event.cost_status === 'unpriced' ?
                   t('usage_stats.request_events_pricing_unpriced') :
                   formatEventCost(cost, lang),
        costReason: formatPricingReason(event.cost_reason, t),

        pricingReceiptTitle,
    }
}

export function RequestEventsDetailsCard({
                                             enabled = true,
                                             rangeLoading,
                                             onClearFilters,
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
                                             selectedSpeed,
                                             onSelectedSpeedChange,
                                         }: RequestEventsDetailsCardProps) {
    const { t, i18n }      = useTranslation()
    const config           = useConfigStore((state) => state.config)
    const showNotification = useNotificationStore((state) => state.showNotification)

    // Shared filters come from FilterBar; free-text search is specific to this table.
    const topModels      = useMemo(() => selectedModels ?? [], [selectedModels])
    const topCredentials = useMemo(() => selectedCredentials ?? [], [selectedCredentials])
    const topApiKeys     = useMemo(() => selectedApiKeys ?? [], [selectedApiKeys])

    const statusFilter                  = selectedStatus ?? STATUS_ALL
    const speedFilter                   = selectedSpeed ?? ''
    const [searchInput, setSearchInput] = useState('')
    const debouncedSearch               = useDebounce(searchInput, 300)
    const searchQuery                   = searchInput.trim() ? debouncedSearch : ''
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
                                                                               state?: RequestLogState | ''
                                                                               message?: string
                                                                               observations?: RequestEventRow
                                                                           } | null>(null)
    const [requestDetails, setRequestDetails]                   = useState<RequestEventRow | null>(null)
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
        const nowMs = Math.max(autoRefreshClockMs, Date.parse(dateRange.to) || 0)
        return {
            from: new Date(nowMs - 24 * 60 * 60 * 1000).toISOString(),
            to: new Date(nowMs).toISOString(),
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
        speedFilter,
        searchQuery,
        sortField,
        sortDir,
        dateRange.from,
        dateRange.to,
    ].join('|')
    const [prevPageResetSig, setPrevPageResetSig] = useState(pageResetSignature)
    if (prevPageResetSig !== pageResetSignature) {
        setPrevPageResetSig(pageResetSignature)
        setPage(1)
    }

    const eventsParams                                            = useMemo<EventsParams>(() => {
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
            speedFilter,
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
                                                                                              speedFilter,
                                                                                              searchQuery,
                                                                                          ])
    const eventsRequestSignature                                  = useMemo(
        () => JSON.stringify([eventsParams, refreshToken]),
        [eventsParams, refreshToken],
    )
    const [previousDetailsSignature, setPreviousDetailsSignature] = useState(eventsRequestSignature)
    if (previousDetailsSignature !== eventsRequestSignature) {
        setPreviousDetailsSignature(eventsRequestSignature)
        setRequestDetails(null)
    }

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
                    const lastPage = data.accessible_pages ?? data.total_pages
                    if (lastPage > 0 && data.page > lastPage) {
                        setPage(lastPage)
                    } else {
                        setEventsData(data)
                        setFetchError('')
                    }
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
        if (!scheduleEligible || requestLogPreview !== null || requestDetails !== null || exportingFormat !== null) {
            return
        }
        const intervalId = window.setInterval(() => {
            const busy = Boolean(eventsRequestControllerRef.current) ||
                         requestLogPreview !== null || requestDetails !== null ||
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
                  requestDetails,
                  sortDir,
                  sortField,
              ])

    useEffect(
        () => () => {
            exportControllerRef.current?.abort()
        },
        [pageResetSignature],
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
    const isLoading        = rangeLoading || fetching
    const accessiblePages  = eventsData && (eventsData.accessible_pages ??
                                            Math.min(
                                                eventsData.total_pages,
                                                Math.floor(LEGACY_MAX_EVENT_OFFSET / eventsData.page_size) + 1,
                                            ))
    const canExport        = enabled && !fetching && !fetchError && totalCount > 0 && exportingFormat === null &&
                             searchInput.trim() === searchQuery.trim()

    const hasActiveFilters =
              statusFilter !== STATUS_ALL ||
              speedFilter !== '' ||
              searchInput.trim() !== '' ||
              topModels.length > 0 ||
              topCredentials.length > 0 ||
              topApiKeys.length > 0

    const handleClearFilters = () => {
        if (onClearFilters) {
            onClearFilters()
        } else {
            onSelectedStatusChange?.(STATUS_ALL)
            onSelectedSpeedChange?.('')
        }
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
                speedFilter,
            )
            return params
        },
        [
            effectiveDateRange,
            topModels,
            topCredentials,
            topApiKeys,
            statusFilter,
            speedFilter,
            searchQuery,
            sortField,
            sortDir,
        ],
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
                                                                  { ...buildExportParams(page), export: true },
                                                                  { signal },
                                                              ),
                                                              formatCsvRow: (event, index) => {
                                                                  const row = formatRow(event, index)
                                                                  return [
                                                                      event.timestamp,
                                                                      event.model,
                                                                      row.speed,
                                                                      row.speedSource,
                                                                      event.service_tier ?? '',
                                                                      row.requestServiceTier,
                                                                      row.responseServiceTier,
                                                                      row.requestSpeed,
                                                                      row.responseSpeed,
                                                                      row.clientModel,
                                                                      row.upstreamUrl,
                                                                      row.responseUrl,
                                                                      event.response_url_source ?? '',
                                                                      event.response_url_status ?? '',
                                                                      event.upstream_next_hop_status ?? '',
                                                                      typeof event.cache_read_reported === 'boolean' ?
                                                                      String(event.cache_read_reported) :
                                                                      '',
                                                                      typeof event.cache_write_reported === 'boolean' ?
                                                                      String(event.cache_write_reported) :
                                                                      '',
                                                                      row.upstreamModel,
                                                                      row.responseModel,
                                                                      row.responseProvider,
                                                                      row.responseProviderSource,
                                                                      event.source,
                                                                      event.auth_index ?? '',
                                                                      event.provider ?? '',
                                                                      event.api_key,
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
                                                                      event.cost_status ?? '',
                                                                      event.cost_reason ?? '',
                                                                      event.billing_metadata ?
                                                                      JSON.stringify(event.billing_metadata) :
                                                                      '',
                                                                      event.pricing_receipt ?
                                                                      JSON.stringify(event.pricing_receipt) :
                                                                      '',
                                                                      event.raw_api_key ?? '',
                                                                      event.import_data ?? '',
                                                                  ]
                                                                      .map((value) => encodeCsv(value))
                                                                      .join(',')
                                                              },
                                                              formatJsonEvent: (event) => {
                                                                  const { speed, speedSource } = observedRequestSpeed(
                                                                      event)
                                                                  return {
                                                                      ...event,
                                                                      speed,
                                                                      speed_observation_source: speedSource,
                                                                      upstream_url:
                                                                          sanitizeUpstreamUrl(event.upstream_url) ||
                                                                          undefined,
                                                                      response_url:
                                                                          sanitizeUpstreamUrl(event.response_url) ||
                                                                          undefined,
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

    const previewRequestLog = useCallback(async (
        requestId: string,
        homeIp: string,
        observations?: RequestEventRow,
    ) => {
        if (!requestId) {
            return
        }
        const seq                          = ++requestLogPreviewSeqRef.current
        const generation                   = apiClient.getAuthGeneration()
        const isCurrent                    = () => requestLogPreviewSeqRef.current ===
                                                   seq &&
                                                   activeRequestLogPreviewRef.current ===
                                                   requestId &&
                                                   generation ===
                                                   apiClient.getAuthGeneration()
        activeRequestLogPreviewRef.current = requestId
        setRequestLogPreview((previous) => previous?.id === requestId && previous.homeIp === homeIp ? previous :
            { id: requestId, homeIp, content: '', truncated: false, totalLines: 0, observations })
        setRequestLogError('')
        setRequestLogPreviewing((prev) => new Set(prev).add(requestId))
        try {
            const preview = await logsApi.previewRequestLogById(requestId, 300, homeIp || undefined)
            if (isCurrent()) {
                setRequestLogPreview({
                                         id: requestId,
                                         homeIp: preview.requestLogHomeIp || homeIp,
                                         content: redactSensitiveText(preview.content),
                                         truncated: preview.truncated,
                                         totalLines: preview.total_lines,
                                         state: preview.requestLogState,
                                         message: redactSensitiveText(preview.message ?? ''),
                                         observations,
                                     })
            }
        } catch (err) {
            if (isCurrent()) {
                setRequestLogError(redactSensitiveText(errorMessage(err)) || t('notification.load_failed'))
            }
        } finally {
            setRequestLogPreviewing((prev) => {
                const next = new Set(prev)
                next.delete(requestId)
                return next
            })
        }
    }, [t])

    const downloadRequestLog = useCallback(async (requestId: string, homeIp: string) => {
        if (!requestId) {
            return
        }
        const generation = apiClient.getAuthGeneration()
        setRequestLogError('')
        setRequestLogDownloading((prev) => new Set(prev).add(requestId))
        try {
            const response = await logsApi.downloadRequestLogById(requestId, homeIp || undefined)
            const content  = redactSensitiveText(await responseDataToText(response.data))
            if (generation === apiClient.getAuthGeneration()) {
                downloadBlob({
                                 filename: safeRequestLogFilename(requestId),
                                 blob: new Blob([content], { type: 'text/plain' }),
                             })
            }
        } catch (err) {
            if (generation !== apiClient.getAuthGeneration()) {
                return
            }
            if (err instanceof PendingRequestLogError) {
                const { preview } = err
                setRequestLogPreview((prev) => ({
                    ...(prev?.id === requestId && prev.homeIp === homeIp ? prev : {
                        id: requestId, content: '', truncated: false, totalLines: 0,
                    }),
                    homeIp: preview.requestLogHomeIp || homeIp,
                    state: preview.requestLogState,
                    message: redactSensitiveText(preview.message ?? ''),
                }))
            } else {
                setRequestLogError(redactSensitiveText(errorMessage(err)) || t('notification.download_failed'))
                setRequestLogPreview((prev) => prev ?? {
                    id: requestId, homeIp, content: '', truncated: false, totalLines: 0,
                })
            }
        } finally {
            setRequestLogDownloading((prev) => {
                const next = new Set(prev)
                next.delete(requestId)
                return next
            })
        }
    }, [t])

    const renderSortableHeader = useCallback((field: SortField, label: string) => (
        <button type='button' className={styles.sortHeaderButton} onClick={() => handleSort(field)}>
            {label}
            {sortField === field ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
        </button>
    ), [handleSort, sortDir, sortField])

    const renderRequestLog = useCallback((row: RequestEventRow) => {
        if (!row.requestId) {
            return <span className={styles.requestEventsPlainMissing}
                         title={missingMetadataTitle}>{notRecordedLabel}</span>
        }
        const stateLabel = requestLogStateLabel(row.requestLogState, t)
        return (
            <div className={styles.requestLogActions}>
                <span className={styles.requestEventsRequestId}>{row.requestId}</span>
                {row.requestLogState === 'available' ? (
                    <div className={styles.requestLogButtonRow}>
                        <Button variant='secondary' size='sm'
                                loading={requestLogPreviewing.has(row.requestId)}
                                onClick={() => void previewRequestLog(row.requestId, row.requestLogHomeIp, row)}>
                            {t('usage_stats.request_events_log_preview')}
                        </Button>
                        <Button variant='ghost' size='sm'
                                loading={requestLogDownloading.has(row.requestId)}
                                onClick={() => void downloadRequestLog(row.requestId, row.requestLogHomeIp)}>
                            {t('common.download')}
                        </Button>
                    </div>
                ) : (
                     <div className={styles.requestLogButtonRow}>
                         <span className={styles.requestEventsLogDisabled}>{stateLabel}</span>
                         {row.requestLogState === 'pending' && <Button variant='secondary' size='sm'
                                                                       loading={requestLogPreviewing.has(row.requestId)}
                                                                       onClick={() => void previewRequestLog(
                                                                           row.requestId,
                                                                           row.requestLogHomeIp,
                                                                           row,
                                                                       )}>
                             {t('usage_stats.request_events_log_preview')}
                         </Button>}
                     </div>
                 )}
            </div>
        )
    }, [
                                             downloadRequestLog,
                                             missingMetadataTitle,
                                             notRecordedLabel,
                                             previewRequestLog,
                                             requestLogDownloading,
                                             requestLogPreviewing,
                                             t,
                                         ])

    const requestEventColumns = useMemo<SheetColumn<RequestEventRow>[]>(
        () => [
            {
                key: 'timestamp',
                header: renderSortableHeader('timestampMs', t('usage_stats.request_events_timestamp')),
                headerClassName: `${styles.sortableHeader} ${styles.requestEventsTimestamp}`,
                className: styles.requestEventsTimestamp,
                cell: (row) => <time dateTime={row.timestamp}>{row.timestampLabel}</time>,
            },
            {
                key: 'model',
                header: renderSortableHeader('model', t('usage_stats.request_events_request_summary')),
                headerClassName: `${styles.sortableHeader} ${styles.requestEventsModelCell}`,
                className: styles.requestEventsModelCell,
                cell: (row) => (
                    <div className={styles.requestEventsSummaryStack}>
                        <div className={styles.requestEventsModelPrimary}>{row.model}</div>
                        {row.clientModel && row.clientModel !== row.model && (
                            <div className={styles.requestEventsSubline}>
                                {t('usage_stats.request_events_client_model')}: {row.clientModel}
                            </div>
                        )}
                        <div className={styles.requestEventsSubline}>
                            {t('usage_stats.request_events_thinking_column')}: {row.thinkingLabel}
                        </div>
                        <div className={styles.requestEventsResultLine}>
                            <span className={styles.requestEventsSubline}>
                                {t('usage_stats.request_events_service_class')}
                            </span>
                            <span title={row.speedSourceLabel} className={row.speed === 'unknown'
                                                                          ?
                                                                          styles.requestEventsPlainMissing :
                                                                          styles.requestEventsThinkingBadge}>
                                {row.speedLabel}
                            </span>
                            {(row.requestSpeed || row.requestServiceTier) &&
                             (row.requestSpeed ? row.requestSpeed !== row.responseSpeed
                                               : row.requestServiceTier !== row.responseServiceTier) && (
                                 <span className={styles.requestEventsSubline}>
                                        {t(row.requestSpeed ? 'usage_stats.request_events_requested_speed'
                                                            : 'usage_stats.request_events_requested_tier')}:
                                     {' '}{row.requestSpeed || row.requestServiceTier}
                                    </span>
                             )}
                        </div>
                        {row.upstreamUrl && <div className={styles.requestEventsSubline}>
                            {t('usage_stats.request_events_upstream_url')}: {new URL(row.upstreamUrl).host}
                        </div>}
                        {row.responseUrl && row.responseUrl !== row.upstreamUrl && (
                            <div className={styles.requestEventsSubline}>
                                {t('usage_stats.request_events_redirect_target')}: {new URL(row.responseUrl).host}
                            </div>
                        )}
                        {row.upstreamModel && row.upstreamModel !== row.model && (
                            <div className={styles.requestEventsSubline}>
                                {t('usage_stats.request_events_upstream_model')}: {row.upstreamModel}
                            </div>
                        )}
                        {row.responseModel && row.responseModel !== (row.upstreamModel || row.model) && (
                            <div className={styles.requestEventsSubline}>
                                {t('usage_stats.request_events_response_model')}: {row.responseModel}
                            </div>
                        )}
                    </div>
                ),
            },
            {
                key: 'identity',
                header: `${identityLabel} / ${apiKeyLabel}`,
                headerClassName: styles.requestEventsCallerCell,
                className: styles.requestEventsCallerCell,
                cell: (row) => (
                    <div className={styles.requestEventsIdentityStack}>
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
                header: t('usage_stats.request_events_result_duration'),
                headerClassName: styles.requestEventsResultCell,
                className: styles.requestEventsResultCell,
                cell: (row) => (
                    <div className={styles.requestEventsSummaryStack}>
                        <div className={styles.requestEventsResultLine}>
                            <span className={row.failed ?
                                             styles.requestEventsResultFailed :
                                             styles.requestEventsResultSuccess}>
                                {row.failed ? t('stats.failure') : t('stats.success')}
                            </span>
                            <span className={styles.requestEventsSubline}>
                                {row.completed === null ? notRecordedLabel : t(row.completed
                                                                               ?
                                                                               'usage_stats.request_events_completed' :
                                                                               'usage_stats.request_events_incomplete')}
                            </span>
                        </div>
                        <div className={styles.requestEventsSubline}>
                            {row.totalDurationMs !== null
                             ? `${t('usage_stats.request_events_total_duration')}: ${row.totalDurationLabel}`
                             : row.latencyMs !== null
                               ? `${t('usage_stats.request_events_recorded_latency')}: ${row.latencyLabel}`
                               : notRecordedLabel}
                        </div>
                        <div className={styles.requestEventsSubline}>
                            {t('usage_stats.request_events_ttfb')}: {row.timeToFirstByteLabel}
                        </div>
                        <div className={styles.requestEventsSubline}>
                            {t('usage_stats.request_events_throughput')}: {row.throughputLabel}
                        </div>
                    </div>
                ),
            },
            {
                key: 'tokens',
                header: renderSortableHeader('totalTokens', t('usage_stats.request_events_usage_cost')),
                headerClassName: `${styles.sortableHeader} ${styles.requestEventsTokenCell}`,
                className: styles.requestEventsTokenCell,
                cell: (row) => (
                    <div className={styles.requestEventsSummaryStack}>
                        <div className={styles.requestEventsResultLine}>
                            <span className={styles.requestEventsMetricPrimary}>{row.costLabel}</span>
                        </div>
                        {row.failed && row.totalTokens === 0
                         ? <span className={styles.requestEventsNoUsage}>{renderFailedNoUsage(t)}</span>
                         : <span className={styles.requestEventsMetricPrimary}>
                                {t('usage_stats.total_tokens')}: {row.totalTokensLabel}
                            </span>}
                        <div className={styles.requestEventsSubline}>
                            {t('usage_stats.request_events_input_short')}: {row.inputTokensLabel}
                            {' · '}{t('usage_stats.request_events_output_short')}: {row.outputTokensLabel}
                            {' · '}{t('usage_stats.request_events_reasoning_short')}: {row.reasoningTokensLabel}
                        </div>
                        <div className={styles.requestEventsSubline}>
                            {t('usage_stats.request_events_cache_read_short')}: {row.cacheReadTokensLabel}
                            {' · '}{t('usage_stats.request_events_cache_write_short')}: {row.cacheWriteTokensLabel}
                        </div>
                        <div className={styles.requestEventsSubline}>
                            {t('usage_stats.request_events_cache_hit_rate')}: {row.cacheHitRateLabel}
                        </div>
                    </div>
                ),
            },
            {
                key: 'details',
                header: t('usage_stats.request_events_observation_details'),
                headerClassName: styles.requestEventsDetailsCell,
                className: styles.requestEventsDetailsCell,
                cell: (row) => (
                    <Button variant='ghost' size='sm'
                            aria-expanded={requestDetails?.id === row.id}
                            aria-controls={row.detailsId}
                            aria-label={`${t('usage_stats.request_events_observation_details')} · ${row.model} · ${row.timestampLabel}`}
                            onClick={() => setRequestDetails((current) => current?.id === row.id ? null : row)}>
                        {t(requestDetails?.id === row.id ? 'common.collapse' : 'common.expand')}
                    </Button>
                ),
            },
        ],
        [apiKeyLabel, identityLabel, notRecordedLabel, renderSortableHeader, requestDetails, t],
    )

    const renderRequestEventRow = useCallback((row: RequestEventRow) => (
        <Fragment>
            <tr>
                {requestEventColumns.map((column) => (
                    <td key={column.key} className={column.className}>{column.cell(row)}</td>
                ))}
            </tr>
            {requestDetails?.id === row.id && (
                <tr className={styles.requestEventsDetailsRow}>
                    <td colSpan={requestEventColumns.length}>
                        <div id={row.detailsId}>
                            <RequestObservationDetails row={row} t={t}>
                                <section className={styles.requestLogSection}>
                                    <h3>{requestLogLabel}</h3>
                                    {renderRequestLog(row)}
                                </section>
                            </RequestObservationDetails>
                        </div>
                    </td>
                </tr>
            )}
        </Fragment>
    ), [renderRequestLog, requestDetails, requestEventColumns, requestLogLabel, t])

    // First-load skeleton: page=1 + no data + still fetching = haven't shown
    // anything yet. Re-fetches (page change, filter change with prior data)
    // keep the table visible.
    if (isInitialLoading) {
        return (
            <Card title={t('usage_stats.request_events_title')} className={styles.eventsCard}>
                <CardSkeleton variant='rows' rowCount={6} />
            </Card>
        )
    }

    return (
        <Card
            className={styles.eventsCard}
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

            <div className={styles.requestEventsGuide}>
                <details>
                    <summary>{t('usage_stats.request_events_field_guide_title')}</summary>
                    <p>{t('usage_stats.request_events_metric_guide')}</p>
                    <p>{t('usage_stats.request_events_speed_hint')}</p>
                    <p>{t('usage_stats.request_events_cost_guide')}</p>
                </details>
                <p>
                    {t(config?.requestLog
                       ? 'usage_stats.request_events_log_enabled_guide'
                       : 'usage_stats.request_events_log_disabled_guide')}{' '}
                    <Link to='/logs'>{t('logs.title')}</Link>
                </p>
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
                        {!fetching && fetchError && <div className='error-box' role='alert'>
                            {t('usage_stats.request_events_page_load_failed', {
                                requested: page, shown: eventsData?.page ?? page,
                                defaultValue: 'Could not load page {{requested}}; ' +
                                              'showing the last loaded results (page {{shown}})',
                            })}: {fetchError}
                        </div>}
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
                            className={styles.eventsSheet}
                            rows={rows}
                            columns={requestEventColumns}
                            rowKey={(row) => row.id}
                            renderRow={renderRequestEventRow}
                            status='ready'
                            tableWrapClassName={styles.requestEventsTableWrapper}
                            tableClassName={styles.table}
                        />

                        {accessiblePages != null && eventsData && accessiblePages < eventsData.total_pages && (
                            <div className={styles.hint}>{t('usage_stats.request_events_paging_limit', {
                                maxPage: formatNumber(accessiblePages, i18n.language),
                                defaultValue: 'Pages 1–{{maxPage}} are available; ' +
                                              'narrow the time range or filters to see more matches',
                            })}</div>
                        )}
                        <Pagination
                            total={totalCount}
                            page={eventsData?.page ?? page}
                            pageSize={eventsData?.page_size ?? pageSize}
                            maxPage={accessiblePages ?? undefined}
                            onPageChange={setPage}
                            onPageSizeChange={setPageSize}
                        />
                    </div>
                )}

            <Modal
                open={requestLogPreview !== null}
                closeDisabled={requestLogPreview !== null && requestLogDownloading.has(requestLogPreview.id)}
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
                            disabled={requestLogPreview !== null && requestLogDownloading.has(requestLogPreview.id)}
                            onClick={() => {
                                ++requestLogPreviewSeqRef.current
                                activeRequestLogPreviewRef.current = null
                                setRequestLogPreview(null)
                                setRequestLogError('')
                            }}
                        >
                            {t('common.close')}
                        </Button>
                        {requestLogPreview && (requestLogPreview.state === 'pending' || requestLogError) && (
                            <Button variant='secondary' loading={requestLogPreviewing.has(requestLogPreview.id)}
                                    onClick={() => void previewRequestLog(
                                        requestLogPreview.id, requestLogPreview.homeIp, requestLogPreview.observations,
                                    )}>
                                {t('common.retry')}
                            </Button>
                        )}
                        <Button
                            onClick={() => {
                                if (requestLogPreview?.id) {
                                    void downloadRequestLog(requestLogPreview.id, requestLogPreview.homeIp)
                                }
                            }}
                            loading={requestLogPreview ? requestLogDownloading.has(requestLogPreview.id) : false}
                            disabled={!requestLogPreview?.id || requestLogPreviewing.has(requestLogPreview.id) ||
                                      Boolean(requestLogPreview.state && requestLogPreview.state !== 'available')}
                        >
                            {t('common.download')}
                        </Button>
                    </>
                }
            >
                {requestLogPreview?.observations && (
                    <RequestObservationDetails row={requestLogPreview.observations} t={t} />
                )}
                {requestLogError && <div className={styles.requestLogError} role='alert'>{requestLogError}</div>}
                {requestLogPreview?.state && requestLogPreview.state !== 'available' && (
                    <div className={styles.hint} role='status'>
                        {requestLogStateLabel(requestLogPreview.state, t)}
                        {requestLogPreview.message && <> · {requestLogPreview.message}</>}
                    </div>
                )}
                {requestLogPreview && requestLogPreviewing.has(requestLogPreview.id) && !requestLogPreview.content ? (
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
