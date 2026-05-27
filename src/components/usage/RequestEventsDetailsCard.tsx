import {CardSkeleton} from '@/components/common/CardSkeleton'
import {Button} from '@/components/ui/Button'
import {Card} from '@/components/ui/Card'
import {EmptyState} from '@/components/ui/EmptyState'
import {Pagination} from '@/components/ui/Pagination'
import {Select} from '@/components/ui/Select'
import {ToggleSwitch} from '@/components/ui/ToggleSwitch'
import {useDebounce} from '@/hooks/useDebounce'
import {useMediaQuery} from '@/hooks/useMediaQuery'
import styles from '@/pages/UsagePage.module.scss'
import {type EventsResponse, usageApi, type UsageEvent, type UsageThinking} from '@/services/api/usage'
import {useConfigStore} from '@/stores'
import type {GeminiKeyConfig, OpenAIProviderConfig, ProviderKeyConfig} from '@/types'
import type {CredentialInfo} from '@/types/sourceInfo'
import {AUTO_REFRESH_INTERVALS, DEFAULT_AUTO_REFRESH_MS, resolveAutoRefreshMs} from '@/utils/autoRefresh'
import {downloadBlob} from '@/utils/download'
import {formatDateTime, formatNumber, maskApiKey, toLocalDateTimeSecondsString} from '@/utils/format'
import {buildSourceInfoMap, resolveSourceDisplay} from '@/utils/sourceResolver'
import {extractLatencyMs, formatDurationMs, formatThinkingLabel, normalizeUsageThinking} from '@/utils/usage'
import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'

const STATUS_ALL        = ''
const STATUS_SUCCESS    = 'success'
const STATUS_FAILURE    = 'failure'
const DEFAULT_PAGE_SIZE = 50

type RequestEventRow = {
    id: string
    timestamp: string
    timestampMs: number
    timestampLabel: string
    model: string
    sourceRaw: string
    source: string
    sourceType: string
    sourceLabel: string
    authIndex: string
    apiKey: string
    apiKeyMasked: string
    user: string
    latencyMs: number | null
    latencyLabel: string
    thinking: UsageThinking | null
    thinkingLabel: string
    failed: boolean
    inputTokens: number
    outputTokens: number
    reasoningTokens: number
    cachedTokens: number
    totalTokens: number
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

/** Append shared filter fields to a params object. Multi-value arrays are joined by comma,
 *  matching the summary endpoint convention; the events backend splits them back into a set. */
function applyFilters(
    params: Record<string, string | number>,
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
        params.api_key = selectedApiKeys.join(',')
    }
    if (searchQuery.trim()) {
        params.search = searchQuery.trim()
    }
    if (statusFilter) {
        params.status = statusFilter
    }
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

/** Map a UsageEvent from backend to a RequestEventRow */
function eventToRow(
    event: UsageEvent,
    index: number,
    sourceInfoMap: ReturnType<typeof buildSourceInfoMap>,
    authFileMap: Map<string, CredentialInfo>,
    lang: string,
    noApiKeyLabel: string,
    aliases?: Record<string, string>,
): RequestEventRow {
    const timestampMs         = Date.parse(event.timestamp)
    const date                = Number.isNaN(timestampMs) ? null : new Date(timestampMs)
    const sourceRaw           = event.source || ''
    const authIndex           = event.auth_index || '-'
    const sourceInfo          = resolveSourceDisplay(sourceRaw, event.auth_index, sourceInfoMap, authFileMap)
    const rawApiKey           = event.api_key || ''
    const alias               = rawApiKey && aliases?.[rawApiKey] ? aliases[rawApiKey] : ''
    const sourceDisplay       = sourceInfo.displayName.trim()
    const hasSourceDisplay    = sourceDisplay !== '' && sourceDisplay !== '-'
    const maskedApiKey        = rawApiKey ? aliases?.[rawApiKey] || maskApiKey(rawApiKey) : noApiKeyLabel
    const sourceBase          =
              hasSourceDisplay && sourceDisplay !== maskedApiKey ?
              sourceDisplay :
              alias || sourceDisplay || noApiKeyLabel
    const resolvedSourceLabel = sourceInfo.type ? `${sourceBase} (${sourceInfo.type})` : sourceBase
    const latencyMs           = extractLatencyMs(event)
    const thinking            = normalizeUsageThinking(event.thinking)

    return {
        id: `${event.timestamp}-${event.model}-${sourceRaw}-${authIndex}-${index}`,
        timestamp: event.timestamp,
        timestampMs: Number.isNaN(timestampMs) ? 0 : timestampMs,
        timestampLabel: date ? formatDateTime(date, lang) : event.timestamp || '-',
        model: event.model || '-',
        sourceRaw: sourceRaw || '-',
        source: sourceInfo.displayName,
        sourceType: sourceInfo.type,
        sourceLabel: resolvedSourceLabel,
        authIndex,
        apiKey: rawApiKey,
        apiKeyMasked: maskedApiKey,
        user: resolvedSourceLabel,
        latencyMs,
        latencyLabel: formatDurationMs(latencyMs, { locale: lang }),
        thinking,
        thinkingLabel: formatThinkingLabel(thinking, lang),
        failed: event.failed,
        inputTokens: Math.max(event.tokens?.input_tokens ?? 0, 0),
        outputTokens: Math.max(event.tokens?.output_tokens ?? 0, 0),
        reasoningTokens: Math.max(event.tokens?.reasoning_tokens ?? 0, 0),
        cachedTokens: Math.max(event.tokens?.cached_tokens ?? 0, 0),
        totalTokens: Math.max(event.tokens?.total_tokens ?? 0, 0),
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
                                         }: RequestEventsDetailsCardProps) {
    const { t, i18n } = useTranslation()
    const isMobile    = useMediaQuery('(max-width: 768px)')
    const config      = useConfigStore((state) => state.config)

    // Model / credential / api-key filters come from the top FilterBar via props;
    // only the result (status) filter and free-text search remain local since the
    // top bar has no equivalents for those.
    const topModels      = useMemo(() => selectedModels ?? [], [selectedModels])
    const topCredentials = useMemo(() => selectedCredentials ?? [], [selectedCredentials])
    const topApiKeys     = useMemo(() => selectedApiKeys ?? [], [selectedApiKeys])

    const [statusFilter, setStatusFilter]   = useState(STATUS_ALL)
    const [searchInput, setSearchInput]     = useState('')
    const searchQuery                       = useDebounce(searchInput, 300)
    const [sortField, setSortField]         = useState<SortField>('timestampMs')
    const [sortDir, setSortDir]             = useState<SortDir>('desc')
    const [page, setPage]                   = useState(1)
    const [pageSize, setPageSize]           = useState(DEFAULT_PAGE_SIZE)
    const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set())

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
    const [autoRefreshClockMs, setAutoRefreshClockMs]                   = useState(() => Date.now())

    // Server-side data
    const [eventsData, setEventsData] = useState<EventsResponse | null>(null)
    const [fetching, setFetching]     = useState(false)
    const [fetchError, setFetchError] = useState<string>('')
    const fetchIdRef                  = useRef(0)

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

    const sourceInfoMap = useMemo(
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

    const fetchSignature                  = `${page}|${pageSize}|${pageResetSignature}|${effectiveDateRange.from}|${effectiveDateRange.to}`
    const [prevFetchSig, setPrevFetchSig] = useState(fetchSignature)
    if (prevFetchSig !== fetchSignature) {
        setPrevFetchSig(fetchSignature)
        setFetching(true)
    }

    // Fetch events from backend
    useEffect(() => {
        if (!enabled) {
            return
        }

        const fetchId = ++fetchIdRef.current

        const params: Record<string, string | number> = {
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

        usageApi
            .getEvents(params as never)
            .then((data) => {
                if (fetchIdRef.current === fetchId) {
                    setEventsData(data)
                    setFetchError('')
                }
            })
            .catch((err: unknown) => {
                if (fetchIdRef.current === fetchId) {
                    setEventsData(null)
                    setFetchError(err instanceof Error ? err.message : 'request failed')
                }
            })
            .finally(() => {
                if (fetchIdRef.current === fetchId) {
                    setFetching(false)
                }
            })
    }, [
                  enabled,
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

    useEffect(() => {
        const timeoutId = window.setTimeout(() => {
            setAutoRefreshClockMs(Date.now())
        }, 0)
        if (!autoRefresh || autoRefreshInterval <= 0) {
            return () => window.clearTimeout(timeoutId)
        }
        const intervalId = window.setInterval(() => {
            setAutoRefreshClockMs(Date.now())
        }, autoRefreshInterval)
        return () => {
            window.clearTimeout(timeoutId)
            window.clearInterval(intervalId)
        }
    }, [activePreset, autoRefresh, autoRefreshInterval, dateRange.from, dateRange.to])

    const noApiKeyLabel = t('usage_stats.filter_api_key_none')
    const identityLabel = t('usage_stats.request_events_identity', { defaultValue: 'Identity' })
    const apiKeyLabel   = t('usage_stats.request_events_api_key', { defaultValue: 'API Key' })

    const rows = useMemo<RequestEventRow[]>(() => {
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
                                             aliases,
                                         ),
        )
    }, [enabled, eventsData, sourceInfoMap, authFileMap, i18n.language, noApiKeyLabel, aliases])

    const totalCount = enabled ? (eventsData?.total ?? 0) : 0
    const isLoading  = !enabled || fetching

    const statusOptions = useMemo(
        () => [
            { value: STATUS_ALL, label: t('usage_stats.filter_all') },
            { value: STATUS_SUCCESS, label: t('stats.success') },
            { value: STATUS_FAILURE, label: t('stats.failure') },
        ],
        [t],
    )

    const hasActiveFilters = statusFilter !== STATUS_ALL || searchInput.trim() !== ''

    const handleClearFilters = () => {
        setStatusFilter(STATUS_ALL)
        setSearchInput('')
    }

    const buildExportParams = useCallback(
        (page: number): Record<string, string | number> => {
            const params: Record<string, string | number> = {
                page,
                page_size: 500,
                sort: toBackendSortField(sortField),
                order: sortDir,
            }
            applyFilters(
                params,
                dateRange.from,
                dateRange.to,
                topModels,
                topCredentials,
                topApiKeys,
                searchQuery,
                statusFilter,
            )
            return params
        },
        [dateRange, topModels, topCredentials, topApiKeys, statusFilter, searchQuery, sortField, sortDir],
    )

    /** Fetch all pages of events for export. Backend caps at 500 per page. */
    const fetchAllEvents = useCallback(async (): Promise<UsageEvent[]> => {
        const allEvents: UsageEvent[] = []
        let currentPage               = 1

        while (true) {
            const data = await usageApi.getEvents(buildExportParams(currentPage) as never)
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

    const handleExportCsv = useCallback(async () => {
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
                'raw_api_key',
                'user',
                'result',
                'latency_ms',
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
                const row = eventToRow(e, index, sourceInfoMap, authFileMap, i18n.language, noApiKeyLabel, aliases)
                return [
                    e.timestamp,
                    e.model,
                    e.source,
                    e.auth_index ?? '',
                    e.provider ?? '',
                    row.apiKeyMasked,
                    // R-547:raw api_key 与 auth_index 落 CSV,导入时
                    // fingerprint(timestamp+model+source+auth_index+api_key)
                    // 才能与原行一致,避免再导入产生重复或丢失，masked
                    // 列保留给人眼,raw 列保留给机器，
                    e.api_key ?? '',
                    row.user,
                    e.failed ? 'failed' : 'success',
                    row.latencyMs ?? '',
                    row.thinking?.intensity ?? '',
                    row.thinking?.mode ?? '',
                    row.thinking?.level ?? '',
                    row.thinking?.budget ?? '',
                    e.tokens?.input_tokens ?? 0,
                    e.tokens?.output_tokens ?? 0,
                    e.tokens?.reasoning_tokens ?? 0,
                    e.tokens?.cached_tokens ?? 0,
                    e.tokens?.total_tokens ?? 0,
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
    }, [fetchAllEvents, sourceInfoMap, authFileMap, i18n.language, noApiKeyLabel, aliases])

    const handleExportJson = useCallback(async () => {
        try {
            const events = await fetchAllEvents()
            if (!events.length) {
                return
            }

            const content  = JSON.stringify(
                events.map((event) => {
                    const thinking = normalizeUsageThinking(event.thinking)
                    return {
                        ...event,
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
    }, [fetchAllEvents])

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

    const sortArrow = (field: SortField) => {
        if (sortField !== field) {
            return ''
        }
        return sortDir === 'asc' ? ' ↑' : ' ↓'
    }

    const toggleCard = useCallback((id: string) => {
        setExpandedCards((prev) => {
            const next = new Set(prev)
            if (next.has(id)) {
                next.delete(id)
            } else {
                next.add(id)
            }
            return next
        })
    }, [])

    const renderSortableHeader = (field: SortField, label: string, title?: string) => (
        <th
            key={field}
            className={styles.sortableHeader}
            onClick={() => handleSort(field)}
            aria-sort={sortField === field ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
            title={title}
        >
            {label}
            {sortArrow(field)}
        </th>
    )

    // First-load skeleton: page=1 + no data + still fetching = haven't shown
    // anything yet. Re-fetches (page change, filter change with prior data)
    // keep the table visible.
    if (fetching && !eventsData) {
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
                <div className={styles.requestEventsFilterItem}>
                    <span className={styles.requestEventsFilterLabel}>{t('usage_stats.request_events_result')}</span>
                    <Select
                        value={statusFilter}
                        options={statusOptions}
                        onChange={setStatusFilter}
                        className={styles.requestEventsSelect}
                        ariaLabel={t('usage_stats.request_events_result')}
                        fullWidth={false}
                    />
                </div>
            </div>

            {isLoading && rows.length === 0 ? (
                <div className={styles.hint}>{t('common.loading')}</div>
            ) : !isLoading && fetchError ? (
                <EmptyState title={t('usage_stats.request_events_error_title', '加载失败')} description={fetchError} />
            ) : totalCount === 0 ? (
                <EmptyState
                    title={t('usage_stats.request_events_empty_title')}
                    description={t('usage_stats.request_events_empty_desc')}
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
                                    isLoading && rows.length > 0 ? '' : styles.requestEventsRefreshingHintIdle
                                }`}
                                aria-live='polite'
                            >
                            {t('common.loading')}
                        </span>
                        </div>

                        {isMobile ? (
                            <div className={styles.eventCardList}>
                                {rows.map((row) => {
                                    const expanded = expandedCards.has(row.id)
                                    return (
                                        <div
                                            key={row.id}
                                            className={`${styles.eventCard} ${expanded ?
                                                                              styles.eventCardExpanded :
                                                                              ''}`}
                                            onClick={() => toggleCard(row.id)}
                                            role='button'
                                            tabIndex={0}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter' || e.key === ' ') {
                                                    e.preventDefault()
                                                    toggleCard(row.id)
                                                }
                                            }}
                                        >
                                            <div className={styles.eventCardHeader}>
                                                <span className={styles.eventCardTime}>{row.timestampLabel}</span>
                                                <span
                                                    className={
                                                        row.failed
                                                        ? styles.requestEventsResultFailed
                                                        : styles.requestEventsResultSuccess
                                                    }
                                                >
                                                {row.failed ? t('stats.failure') : t('stats.success')}
                                            </span>
                                            </div>
                                            <div className={styles.eventCardBody}>
                                                <span className={styles.eventCardModel}>{row.model}</span>
                                                <span className={styles.eventCardTokens}>
                                                {formatNumber(row.totalTokens, i18n.language)} tokens
                                            </span>
                                            </div>
                                            {expanded && (
                                                <div className={styles.eventCardDetails}>
                                                    {(
                                                        [
                                                            [identityLabel, row.user],
                                                            [apiKeyLabel, row.apiKeyMasked],
                                                            [t('usage_stats.time'), row.latencyLabel],
                                                            [t('usage_stats.thinking_intensity'), row.thinkingLabel],
                                                            [
                                                                t('usage_stats.input_tokens'),
                                                                formatNumber(row.inputTokens, i18n.language),
                                                            ],
                                                            [
                                                                t('usage_stats.output_tokens'),
                                                                formatNumber(row.outputTokens, i18n.language),
                                                            ],
                                                            [
                                                                t('usage_stats.reasoning_tokens'),
                                                                formatNumber(row.reasoningTokens, i18n.language),
                                                            ],
                                                            [
                                                                t('usage_stats.cached_tokens'),
                                                                formatNumber(row.cachedTokens, i18n.language),
                                                            ],
                                                        ] as const
                                                    ).map(([label, value]) => (
                                                        <div key={label} className={styles.eventCardDetailRow}>
                                                            <span className={styles.eventCardDetailLabel}>{label}</span>
                                                            <span>{value}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    )
                                })}
                            </div>
                        ) : (
                             <div className={styles.requestEventsTableWrapper}>
                                 <table className={styles.table}>
                                     <thead>
                                     <tr>
                                         {renderSortableHeader(
                                             'timestampMs',
                                             t('usage_stats.request_events_timestamp'),
                                         )}
                                         {renderSortableHeader('model', t('usage_stats.model_name'))}
                                         <th>{identityLabel}</th>
                                         <th>{apiKeyLabel}</th>
                                         <th>{t('usage_stats.request_events_result')}</th>
                                         <th>{t('usage_stats.time')}</th>
                                         <th>{t('usage_stats.thinking_intensity')}</th>
                                         {renderSortableHeader('inputTokens', t('usage_stats.input_tokens'))}
                                         {renderSortableHeader('outputTokens', t('usage_stats.output_tokens'))}
                                         {renderSortableHeader(
                                             'reasoningTokens',
                                             t('usage_stats.reasoning_tokens'),
                                             t('usage_stats.reasoning_tokens_hint', {
                                                 defaultValue:
                                                     'Only Claude extended thinking produces reasoning tokens. Other models always show 0.',
                                             }),
                                         )}
                                         {renderSortableHeader('cachedTokens', t('usage_stats.cached_tokens'))}
                                         {renderSortableHeader('totalTokens', t('usage_stats.total_tokens'))}
                                     </tr>
                                     </thead>
                                     <tbody>
                                     {rows.map((row) => (
                                         <tr key={row.id}>
                                             <td title={row.timestamp} className={styles.requestEventsTimestamp}>
                                                 {row.timestampLabel}
                                             </td>
                                             <td className={styles.modelCell}>{row.model}</td>
                                             <td className={styles.requestEventsSourceCell} title={row.user}>
                                                 {row.user}
                                             </td>
                                             <td className={styles.requestEventsApiKey} title={row.apiKeyMasked}>
                                                 {row.apiKeyMasked}
                                             </td>
                                             <td>
                                                <span
                                                    className={
                                                        row.failed
                                                        ? styles.requestEventsResultFailed
                                                        : styles.requestEventsResultSuccess
                                                    }
                                                >
                                                    {row.failed ? t('stats.failure') : t('stats.success')}
                                                </span>
                                             </td>
                                             <td>{row.latencyLabel}</td>
                                             <td>
                                                <span
                                                    className={
                                                        row.thinking
                                                        ? styles.requestEventsThinkingBadge
                                                        : styles.requestEventsThinkingEmpty
                                                    }
                                                >
                                                    {row.thinkingLabel}
                                                </span>
                                             </td>
                                             <td>{formatNumber(row.inputTokens, i18n.language)}</td>
                                             <td>{formatNumber(row.outputTokens, i18n.language)}</td>
                                             <td>{formatNumber(row.reasoningTokens, i18n.language)}</td>
                                             <td>{formatNumber(row.cachedTokens, i18n.language)}</td>
                                             <td>{formatNumber(row.totalTokens, i18n.language)}</td>
                                         </tr>
                                     ))}
                                     </tbody>
                                 </table>
                             </div>
                         )}

                        <Pagination
                            total={totalCount}
                            page={page}
                            pageSize={pageSize}
                            onPageChange={setPage}
                            onPageSizeChange={setPageSize}
                        />
                    </div>
                )}
        </Card>
    )
}
