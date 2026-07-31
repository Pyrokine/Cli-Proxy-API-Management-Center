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
    usageApi,
    type UsageEvent,
    type UsageThinking,
} from '@/services/api/usage'
import {useConfigStore} from '@/stores'
import type {GeminiKeyConfig, OpenAIProviderConfig, ProviderKeyConfig} from '@/types'
import type {OAuthModelAliasEntry} from '@/types/oauth'
import type {CredentialInfo} from '@/types/sourceInfo'
import {AUTO_REFRESH_INTERVALS, DEFAULT_AUTO_REFRESH_MS, resolveAutoRefreshMs} from '@/utils/autoRefresh'
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
} from '@/utils/usage'
import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'
import styles from './RequestEventsDetailsCard.module.scss'

const STATUS_ALL        = ''
const DEFAULT_PAGE_SIZE = 50

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
    totalTokens: number | null
    totalTokensLabel: string
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

function nonNegativeNumber(value: number | string | null | undefined): number | null {
    const parsed = numberFromValue(value)
    return parsed === null ? null : Math.max(parsed, 0)
}

function maxTokenValue(...values: Array<number | string | null | undefined>): number | null {
    const parsed = values.map(nonNegativeNumber).filter((value): value is number => value !== null)
    return parsed.length > 0 ? Math.max(...parsed) : null
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
    const timestampMs        = Date.parse(event.timestamp)
    const date               = Number.isNaN(timestampMs) ? null : new Date(timestampMs)
    const sourceRaw          = event.source || ''
    const authIndex          = event.auth_index || '-'
    const sourceInfo         = resolveSourceDisplay(sourceRaw, event.auth_index, sourceInfoMap, authFileMap)
    const rawApiKey          = event.api_key || ''
    const alias              = 'api_key_alias' in event
                               ? (event.api_key_alias || '').trim()
                               : resolveApiKeyAlias(rawApiKey, aliases)
    const sourceDisplay      = sourceInfo.displayName.trim()
    const hasSourceDisplay   = sourceDisplay !== '' && sourceDisplay !== '-'
    const maskedApiKey       = displayApiKey(rawApiKey, alias, noApiKeyLabel)
    const sourceBase         =
              hasSourceDisplay && sourceDisplay !== maskedApiKey ?
              sourceDisplay :
              alias || sourceDisplay || noApiKeyLabel
    const providerLabel      = (sourceInfo.type || event.provider || '').trim()
    const providerDisplay    = providerLabel ? channelLabel(providerLabel) : ''
    const latencyMs          = extractLatencyMs(event)
    const timeToFirstByteMs  = numberFromValue(event.time_to_first_byte_ms)
    const totalDurationMs    = numberFromValue(event.total_duration_ms)
    const requestId          = typeof event.request_id === 'string' ? event.request_id.trim() : ''
    const inputTokens        = nonNegativeNumber(event.tokens?.input_tokens)
    const outputTokens       = nonNegativeNumber(event.tokens?.output_tokens)
    const reasoningTokens    = nonNegativeNumber(event.tokens?.reasoning_tokens)
    const cachedTokens       = maxTokenValue(event.tokens?.cached_tokens, event.tokens?.cache_tokens)
    const tokenParts         = [inputTokens, outputTokens, reasoningTokens, cachedTokens]
    const totalTokens        = nonNegativeNumber(event.tokens?.total_tokens) ?? (
        tokenParts.some((value) => value !== null)
        ? tokenParts.reduce<number>((sum, value) => sum + (value ?? 0), 0)
        : null
    )
    const cacheHitRate       = inputTokens !== null && cachedTokens !== null && inputTokens > 0
                               ? (cachedTokens / inputTokens) * 100
                               : null
    const throughputTokens   =
              totalDurationMs !== null && totalDurationMs > 0 && outputTokens !== null
              ? outputTokens / (totalDurationMs / 1000)
              : null
    const thinking           = normalizeUsageThinking(event.thinking)
    const hasRequestMetadata =
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
        totalTokens,
        totalTokensLabel: formatTokenValue(totalTokens, lang, notRecordedLabel),
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
    const { t, i18n } = useTranslation()
    const config      = useConfigStore((state) => state.config)

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

    // Auto-refresh
    const configRefreshMs                                               = useMemo(
        () => resolveAutoRefreshMs(autoRefreshConfigSeconds ?? config?.autoRefreshInterval),
        [autoRefreshConfigSeconds, config?.autoRefreshInterval],
    )
    const [autoRefreshOverride, setAutoRefreshOverride]                 = useState<boolean | null>(null)
    const [autoRefreshIntervalOverride, setAutoRefreshIntervalOverride] = useState<number | null>(null)
    const autoRefresh                                                   = autoRefreshOverride ?? configRefreshMs > 0
    const autoRefreshInterval                                           =
              autoRefreshIntervalOverride ?? (configRefreshMs > 0 ? configRefreshMs : DEFAULT_AUTO_REFRESH_MS)
    const requestLogEnabled                                             = config?.requestLog === true
    const [autoRefreshClockMs, setAutoRefreshClockMs]                   = useState(() => Date.now())

    // Server-side data
    const [eventsData, setEventsData]                           = useState<EventsResponse | null>(null)
    const [settledRequestSignature, setSettledRequestSignature] = useState('')
    const [fetchError, setFetchError]                           = useState<string>('')
    const [requestLogPreview, setRequestLogPreview]             = useState<{
                                                                               id: string
                                                                               content: string
                                                                               truncated: boolean
                                                                               totalLines: number
                                                                           } | null>(null)
    const [requestLogError, setRequestLogError]                 = useState('')
    const [requestLogPreviewing, setRequestLogPreviewing]       = useState<Set<string>>(() => new Set())
    const [requestLogDownloading, setRequestLogDownloading]     = useState<Set<string>>(() => new Set())
    const [oauthModelAlias, setOauthModelAlias]                 = useState<Record<string, OAuthModelAliasEntry[]>>({})
    const [modelAliasError, setModelAliasError]                 = useState('')
    const fetchIdRef                                            = useRef(0)
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
        const to  = toLocalDateTimeSecondsString(now)
        switch (activePreset) {
            case '24h':
                return {
                    from: toLocalDateTimeSecondsString(new Date(now.getTime() - 24 * 60 * 60 * 1000)),
                    to,
                }
            case '7d':
                return {
                    from: toLocalDateTimeSecondsString(new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)),
                    to,
                }
            case '30d':
                return {
                    from: toLocalDateTimeSecondsString(new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)),
                    to,
                }
            case 'all':
                return {
                    from: dateRange.from,
                    to,
                }
            default:
                return { from: dateRange.from, to: dateRange.to }
        }
    }, [activePreset, autoRefresh, autoRefreshClockMs, dateRange.from, dateRange.to])

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
            return
        }

        const fetchId = ++fetchIdRef.current

        usageApi
            .getEvents(eventsParams)
            .then((data) => {
                if (fetchIdRef.current === fetchId) {
                    setEventsData(data)
                    setFetchError('')
                }
            })
            .catch((err: unknown) => {
                if (fetchIdRef.current === fetchId) {
                    setFetchError(err instanceof Error ? err.message : 'request failed')
                }
            })
            .finally(() => {
                if (fetchIdRef.current === fetchId) {
                    setSettledRequestSignature(eventsRequestSignature)
                }
            })
    }, [enabled, eventsParams, eventsRequestSignature])

    useEffect(() => {
        const timeoutId = window.setTimeout(() => {
            setAutoRefreshClockMs(Date.now())
        }, 0)
        if (!autoRefresh || autoRefreshInterval <= 0 || requestLogPreview !== null) {
            return () => window.clearTimeout(timeoutId)
        }
        const intervalId = window.setInterval(() => {
            setAutoRefreshClockMs(Date.now())
        }, autoRefreshInterval)
        return () => {
            window.clearTimeout(timeoutId)
            window.clearInterval(intervalId)
        }
    }, [activePreset, autoRefresh, autoRefreshInterval, dateRange.from, dateRange.to, requestLogPreview])

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
                page_size: 500,
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

    /** Fetch all pages of events for export. Backend caps at 500 per page. */
    const fetchAllEvents = useCallback(async (): Promise<UsageEvent[]> => {
        const allEvents: UsageEvent[] = []
        let currentPage               = 1

        while (true) {
            const data = await usageApi.getEvents(buildExportParams(currentPage))
            if (!data?.events?.length) {
                break
            }
            allEvents.push(...data.events)
            if (allEvents.length >= (data.total ?? 0)) {
                break
            }
            ++currentPage
        }

        return allEvents
    }, [buildExportParams])

    const handleExportCsv = useCallback(
        async () => {
            try {
                const events = await fetchAllEvents()
                if (!events.length) {
                    return
                }

                const csvHeader = [
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
                    'cached_tokens',
                    'total_tokens',
                ]
                const csvRows   = events.map((e, index) => {
                    const row = eventToRow(
                        e,
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
                    return [
                        e.timestamp,
                        e.model,
                        e.source,
                        e.auth_index ?? '',
                        e.provider ?? '',
                        row.apiKeyMasked,
                        row.user,
                        row.requestId,
                        e.failed ? 'failed' : 'success',
                        row.latencyMs ?? '',
                        row.timeToFirstByteMs ?? '',
                        row.totalDurationMs ?? '',
                        row.completed === null ? '' : String(row.completed),
                        row.cacheHitRate ?? '',
                        row.throughputTokensPerSecond ?? '',
                        row.thinking?.intensity ?? '',
                        row.thinking?.mode ?? '',
                        row.thinking?.level ?? '',
                        row.thinking?.budget ?? '',
                        row.inputTokens ?? '',
                        row.outputTokens ?? '',
                        row.reasoningTokens ?? '',
                        row.cachedTokens ?? '',
                        row.totalTokens ?? '',
                    ]
                        .map((v) => encodeCsv(v))
                        .join(',')
                })
                const content   = [csvHeader.join(','), ...csvRows].join('\n')
                const fileTime  = new Date().toISOString().replace(/[:.]/g, '-')
                downloadBlob({
                                 filename: `usage-events-${fileTime}.csv`,
                                 blob: new Blob([content], { type: 'text/csv;charset=utf-8' }),
                             })
            } catch {
                /* ignore */
            }
        },
        [
            fetchAllEvents,
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

    const handleExportJson = useCallback(
        async () => {
            try {
                const events = await fetchAllEvents()
                if (!events.length) {
                    return
                }

                const content  = JSON.stringify(
                    events.map((event, index) => {
                        const thinking  = normalizeUsageThinking(event.thinking)
                        const row       = eventToRow(
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
                        const safeEvent = { ...event } as Record<string, unknown>
                        delete safeEvent.raw_api_key
                        return {
                            ...safeEvent,
                            api_key: row.apiKeyMasked,
                            thinking: thinking ?? undefined,
                        }
                    }),
                    null,
                    2,
                )
                const fileTime = new Date().toISOString().replace(/[:.]/g, '-')
                downloadBlob({
                                 filename: `usage-events-${fileTime}.json`,
                                 blob: new Blob([content], { type: 'application/json;charset=utf-8' }),
                             })
            } catch {
                /* ignore */
            }
        },
        [
            fetchAllEvents,
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

    const previewRequestLog = useCallback(async (requestId: string) => {
        if (!requestId) {
            return
        }
        const seq                          = ++requestLogPreviewSeqRef.current
        activeRequestLogPreviewRef.current = requestId
        setRequestLogPreview({ id: requestId, content: '', truncated: false, totalLines: 0 })
        setRequestLogError('')
        setRequestLogPreviewing((prev) => new Set(prev).add(requestId))
        try {
            const preview = await logsApi.previewRequestLogById(requestId, 300)
            if (requestLogPreviewSeqRef.current === seq && activeRequestLogPreviewRef.current === requestId) {
                setRequestLogPreview({
                                         id: requestId,
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

    const downloadRequestLog = useCallback(async (requestId: string) => {
        if (!requestId) {
            return
        }
        setRequestLogError('')
        setRequestLogDownloading((prev) => new Set(prev).add(requestId))
        try {
            const response = await logsApi.downloadRequestLogById(requestId)
            const content  = redactSensitiveText(await responseDataToText(response.data))
            downloadBlob({
                             filename: safeRequestLogFilename(requestId),
                             blob: new Blob([content], { type: 'text/plain' }),
                         })
        } catch (err) {
            setRequestLogError(errorMessage(err) || 'request log download failed')
            setRequestLogPreview((prev) => prev ?? { id: requestId, content: '', truncated: false, totalLines: 0 })
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
                                           'usage_stats.request_events_cached_short',
                                           { defaultValue: '缓存' },
                                       )} {row.cachedTokensLabel}
                                       </div>
                                   </>
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
                cell: (row) => row.requestId ? (
                    <div className={styles.requestLogActions}>
                        <span className={styles.requestEventsRequestId} title={row.requestId}>{row.requestId}</span>
                        {requestLogEnabled || row.failed ? (
                            <div className={styles.requestLogButtonRow}>
                                <Button
                                    variant='secondary'
                                    size='xs'
                                    loading={requestLogPreviewing.has(row.requestId)}
                                    onClick={() => void previewRequestLog(row.requestId)}
                                >
                                    {t('usage_stats.request_events_log_preview', { defaultValue: 'View log' })}
                                </Button>
                                <Button
                                    variant='ghost'
                                    size='xs'
                                    loading={requestLogDownloading.has(row.requestId)}
                                    onClick={() => void downloadRequestLog(row.requestId)}
                                >
                                    {t('common.download')}
                                </Button>
                            </div>
                        ) : (
                             <span
                                 className={styles.requestEventsLogDisabled}
                                 title={t('usage_stats.request_events_log_disabled_hint', {
                                     defaultValue: 'Enable request-log in Logs or Config for new requests',
                                 })}
                             >
                            {t('usage_stats.request_events_log_disabled', { defaultValue: 'Request log off' })}
                        </span>
                         )}
                    </div>
                ) : (
                                   <span className={styles.requestEventsPlainMissing}
                                         title={missingMetadataTitle}>{notRecordedLabel}</span>
                               ),
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
            requestLogEnabled,
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
                            onChange={(value) => setAutoRefreshOverride(value)}
                        />
                        <Select
                            value={String(autoRefreshInterval)}
                            options={AUTO_REFRESH_INTERVALS}
                            onChange={(v) => setAutoRefreshIntervalOverride(Number(v))}
                            fullWidth={false}
                        />
                    </div>
                    <Button variant='ghost' size='sm' onClick={handleClearFilters} disabled={!hasActiveFilters}>
                        {t('usage_stats.clear_filters')}
                    </Button>
                    <Button variant='secondary' size='sm' onClick={handleExportCsv} disabled={totalCount === 0}>
                        {t('usage_stats.export_csv')}
                    </Button>
                    <Button variant='secondary' size='sm' onClick={handleExportJson} disabled={totalCount === 0}>
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
                                    void downloadRequestLog(requestLogPreview.id)
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
