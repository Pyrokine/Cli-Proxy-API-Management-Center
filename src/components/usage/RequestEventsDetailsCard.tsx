import {Button} from '@/components/ui/Button'
import {Card} from '@/components/ui/Card'
import {EmptyState} from '@/components/ui/EmptyState'
import {Pagination} from '@/components/ui/Pagination'
import {Select} from '@/components/ui/Select'
import {useDebounce} from '@/hooks/useDebounce'
import {useMediaQuery} from '@/hooks/useMediaQuery'
import styles from '@/pages/UsagePage.module.scss'
import {type EventsResponse, usageApi, type UsageEvent} from '@/services/api/usage'
import type {GeminiKeyConfig, OpenAIProviderConfig, ProviderKeyConfig} from '@/types'
import type {CredentialInfo} from '@/types/sourceInfo'
import {downloadBlob} from '@/utils/download'
import {formatDateTime, maskApiKey} from '@/utils/format'
import {buildSourceInfoMap, resolveSourceDisplay} from '@/utils/sourceResolver'
import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'

const ALL_FILTER        = '__all__'
const DEFAULT_PAGE_SIZE = 50

type RequestEventRow = {
    id: string;
    timestamp: string;
    timestampMs: number;
    timestampLabel: string;
    model: string;
    sourceRaw: string;
    source: string;
    sourceType: string;
    authIndex: string;
    apiKey: string;
    apiKeyMasked: string;
    failed: boolean;
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    cachedTokens: number;
    totalTokens: number;
};

interface RequestEventsDetailsCardProps {
    usage: unknown;
    loading: boolean;
    geminiKeys: GeminiKeyConfig[];
    claudeConfigs: ProviderKeyConfig[];
    codexConfigs: ProviderKeyConfig[];
    vertexConfigs: ProviderKeyConfig[];
    openaiProviders: OpenAIProviderConfig[];
    drillDownSearch?: string;
    authFileMap: Map<string, CredentialInfo>;
    dateRange: { from: string; to: string };
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
    | 'cachedTokens';
type SortDir = 'asc' | 'desc';

/** Append shared filter fields to a params object. */
function applyFilters(
    params: Record<string, string | number>,
    from: string,
    to: string,
    modelFilter: string,
    sourceFilter: string,
    searchQuery: string,
): void {
    if (from) {
        params.from = from
    }
    if (to) {
        params.to = to
    }
    if (modelFilter !== ALL_FILTER) {
        params.model = modelFilter
    }
    if (sourceFilter !== ALL_FILTER) {
        params.source = sourceFilter
    }
    if (searchQuery.trim()) {
        params.search = searchQuery.trim()
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
): RequestEventRow {
    const timestampMs = Date.parse(event.timestamp)
    const date        = Number.isNaN(timestampMs) ? null : new Date(timestampMs)
    const sourceRaw   = event.source || ''
    const authIndex   = event.auth_index || '-'
    const sourceInfo  = resolveSourceDisplay(sourceRaw, event.auth_index, sourceInfoMap, authFileMap)

    return {
        id: `${event.timestamp}-${event.model}-${sourceRaw}-${authIndex}-${index}`,
        timestamp: event.timestamp,
        timestampMs: Number.isNaN(timestampMs) ? 0 : timestampMs,
        timestampLabel: date ? formatDateTime(date, lang) : event.timestamp || '-',
        model: event.model || '-',
        sourceRaw: sourceRaw || '-',
        source: sourceInfo.displayName,
        sourceType: sourceInfo.type,
        authIndex,
        apiKey: '',
        apiKeyMasked: sourceRaw ? maskApiKey(sourceRaw) : '-',
        failed: event.failed,
        inputTokens: Math.max(event.tokens?.input_tokens ?? 0, 0),
        outputTokens: Math.max(event.tokens?.output_tokens ?? 0, 0),
        reasoningTokens: Math.max(event.tokens?.reasoning_tokens ?? 0, 0),
        cachedTokens: Math.max(event.tokens?.cached_tokens ?? 0, 0),
        totalTokens: Math.max(event.tokens?.total_tokens ?? 0, 0),
    }
}

export function RequestEventsDetailsCard({
                                             loading: parentLoading,
                                             geminiKeys,
                                             claudeConfigs,
                                             codexConfigs,
                                             vertexConfigs,
                                             openaiProviders,
                                             drillDownSearch,
                                             authFileMap,
                                             dateRange,
                                         }: RequestEventsDetailsCardProps) {
    const { t, i18n } = useTranslation()
    const isMobile    = useMediaQuery('(max-width: 768px)')

    const [modelFilter, setModelFilter]     = useState(ALL_FILTER)
    const [sourceFilter, setSourceFilter]   = useState(ALL_FILTER)
    const [searchInput, setSearchInput]     = useState('')
    const searchQuery                       = useDebounce(searchInput, 300)
    const [sortField, setSortField]         = useState<SortField>('timestampMs')
    const [sortDir, setSortDir]             = useState<SortDir>('desc')
    const [page, setPage]                   = useState(1)
    const [pageSize, setPageSize]           = useState(DEFAULT_PAGE_SIZE)
    const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set())

    // Server-side data
    const [eventsData, setEventsData] = useState<EventsResponse | null>(null)
    const [fetching, setFetching]     = useState(false)
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
    const filterSignature                   = [
        modelFilter,
        sourceFilter,
        searchQuery,
        sortField,
        sortDir,
        dateRange.from,
        dateRange.to,
    ].join('|')
    const [prevFilterSig, setPrevFilterSig] = useState(filterSignature)
    if (prevFilterSig !== filterSignature) {
        setPrevFilterSig(filterSignature)
        setPage(1)
    }

    // Track fetch params to set loading state
    const fetchSignature                  = `${page}|${pageSize}|${filterSignature}`
    const [prevFetchSig, setPrevFetchSig] = useState(fetchSignature)
    if (prevFetchSig !== fetchSignature) {
        setPrevFetchSig(fetchSignature)
        setFetching(true)
    }

    // Fetch events from backend
    useEffect(() => {
        const fetchId = ++fetchIdRef.current

        const params: Record<string, string | number> = {
            page,
            page_size: pageSize,
            sort: toBackendSortField(sortField),
            order: sortDir,
        }
        applyFilters(params, dateRange.from, dateRange.to, modelFilter, sourceFilter, searchQuery)

        usageApi
            .getEvents(params as never)
            .then((data) => {
                if (fetchIdRef.current === fetchId) {
                    setEventsData(data)
                }
            })
            .catch(() => {
                if (fetchIdRef.current === fetchId) {
                    setEventsData(null)
                }
            })
            .finally(() => {
                if (fetchIdRef.current === fetchId) {
                    setFetching(false)
                }
            })
    }, [page, pageSize, sortField, sortDir, dateRange.from, dateRange.to, modelFilter, sourceFilter, searchQuery])

    const rows = useMemo<RequestEventRow[]>(() => {
        if (!eventsData?.events) {
            return []
        }
        return eventsData.events.map((event, index) => eventToRow(
            event,
            index,
            sourceInfoMap,
            authFileMap,
            i18n.language,
        ))
    }, [eventsData, sourceInfoMap, authFileMap, i18n.language])

    const totalCount = eventsData?.total ?? 0
    const isLoading  = parentLoading || fetching

    // Derive model options from first page of data (or use a simple known models list)
    const modelOptions = useMemo(() => {
        const models = new Set<string>()
        if (eventsData?.events) {
            for (const e of eventsData.events) {
                if (e.model) {
                    models.add(e.model)
                }
            }
        }
        return [
            { value: ALL_FILTER, label: t('usage_stats.filter_all') },
            ...Array.from(models)
                    .sort()
                    .map((m) => ({ value: m, label: m })),
        ]
    }, [eventsData, t])

    const sourceOptions = useMemo(() => {
        const sources = new Set<string>()
        if (eventsData?.events) {
            for (const e of eventsData.events) {
                if (e.source) {
                    sources.add(e.source)
                }
            }
        }
        return [
            { value: ALL_FILTER, label: t('usage_stats.filter_all') },
            ...Array.from(sources)
                    .sort()
                    .map((s) => ({ value: s, label: s })),
        ]
    }, [eventsData, t])

    const hasActiveFilters = modelFilter !== ALL_FILTER || sourceFilter !== ALL_FILTER || searchInput.trim() !== ''

    const handleClearFilters = () => {
        setModelFilter(ALL_FILTER)
        setSourceFilter(ALL_FILTER)
        setSearchInput('')
    }

    const buildExportParams = useCallback((page: number): Record<string, string | number> => {
        const params: Record<string, string | number> = {
            page,
            page_size: 500,
            sort: toBackendSortField(sortField),
            order: sortDir,
        }
        applyFilters(params, dateRange.from, dateRange.to, modelFilter, sourceFilter, searchQuery)
        return params
    }, [dateRange, modelFilter, sourceFilter, searchQuery, sortField, sortDir])

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
                'api_key',
                'auth_index',
                'result',
                'input_tokens',
                'output_tokens',
                'reasoning_tokens',
                'cached_tokens',
                'total_tokens',
            ]
            const csvRows   = events.map((e) =>
                                             [
                                                 e.timestamp,
                                                 e.model,
                                                 e.source,
                                                 e.source ? maskApiKey(e.source) : '',
                                                 e.auth_index,
                                                 e.failed ? 'failed' : 'success',
                                                 e.tokens?.input_tokens ?? 0,
                                                 e.tokens?.output_tokens ?? 0,
                                                 e.tokens?.reasoning_tokens ?? 0,
                                                 e.tokens?.cached_tokens ?? 0,
                                                 e.tokens?.total_tokens ?? 0,
                                             ]
                                                 .map((v) => encodeCsv(v))
                                                 .join(','),
            )
            const content   = [csvHeader.join(','), ...csvRows].join('\n')
            const fileTime  = new Date().toISOString().replace(/[:.]/g, '-')
            downloadBlob({
                             filename: `usage-events-${fileTime}.csv`,
                             blob: new Blob([content], { type: 'text/csv;charset=utf-8' }),
                         })
        } catch {
            /* ignore */
        }
    }, [fetchAllEvents])

    const handleExportJson = useCallback(async () => {
        try {
            const events = await fetchAllEvents()
            if (!events.length) {
                return
            }

            const content  = JSON.stringify(events, null, 2)
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

    const renderSortableHeader = (field: SortField, label: string) => (
        <th
            key={field}
            className={styles.sortableHeader}
            onClick={() => handleSort(field)}
            aria-sort={sortField === field ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
        >
            {label}
            {sortArrow(field)}
        </th>
    )

    return (
        <Card
            title={t('usage_stats.request_events_title')}
            extra={
                <div className={styles.requestEventsActions}>
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
                    <span className={styles.requestEventsFilterLabel}>
                        {t('usage_stats.request_events_filter_model')}
                    </span>
                    <Select
                        value={modelFilter}
                        options={modelOptions}
                        onChange={setModelFilter}
                        className={styles.requestEventsSelect}
                        ariaLabel={t('usage_stats.request_events_filter_model')}
                        fullWidth={false}
                    />
                </div>
                <div className={styles.requestEventsFilterItem}>
                    <span className={styles.requestEventsFilterLabel}>
                        {t('usage_stats.request_events_filter_source')}
                    </span>
                    <Select
                        value={sourceFilter}
                        options={sourceOptions}
                        onChange={setSourceFilter}
                        className={styles.requestEventsSelect}
                        ariaLabel={t('usage_stats.request_events_filter_source')}
                        fullWidth={false}
                    />
                </div>
            </div>

            {isLoading && rows.length === 0 ? (
                <div className={styles.hint}>{t('common.loading')}</div>
            ) : totalCount === 0 ? (
                <EmptyState
                    title={t('usage_stats.request_events_empty_title')}
                    description={t('usage_stats.request_events_empty_desc')}
                />
            ) : (
                    <>
                        <div className={styles.requestEventsMeta}>
                            <span>{t('usage_stats.request_events_count', { count: totalCount })}</span>
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
                                                    className={row.failed ?
                                                               styles.requestEventsResultFailed :
                                                               styles.requestEventsResultSuccess}
                                                >
                        {row.failed ? t('stats.failure') : t('stats.success')}
                      </span>
                                            </div>
                                            <div className={styles.eventCardBody}>
                                                <span className={styles.eventCardModel}>{row.model}</span>
                                                <span className={styles.eventCardTokens}>
                                                    {row.totalTokens.toLocaleString()} tokens
                                                </span>
                                            </div>
                                            {expanded && (
                                                <div className={styles.eventCardDetails}>
                                                    {(
                                                        [
                                                            [
                                                                'usage_stats.request_events_source',
                                                                `${row.source}${row.sourceType ?
                                                                                ` (${row.sourceType})` :
                                                                                ''}`,
                                                            ],
                                                            ['usage_stats.request_events_api_key', row.apiKeyMasked],
                                                            ['usage_stats.request_events_auth_index', row.authIndex],
                                                            [
                                                                'usage_stats.input_tokens',
                                                                row.inputTokens.toLocaleString(),
                                                            ],
                                                            [
                                                                'usage_stats.output_tokens',
                                                                row.outputTokens.toLocaleString(),
                                                            ],
                                                            [
                                                                'usage_stats.reasoning_tokens',
                                                                row.reasoningTokens.toLocaleString(),
                                                            ],
                                                            [
                                                                'usage_stats.cached_tokens',
                                                                row.cachedTokens.toLocaleString(),
                                                            ],
                                                        ] as const
                                                    ).map(([labelKey, value]) => (
                                                        <div key={labelKey} className={styles.eventCardDetailRow}>
                            <span className={styles.eventCardDetailLabel}>
                              {t(
                                  labelKey,
                                  labelKey === 'usage_stats.request_events_api_key'
                                  ? { defaultValue: 'API Key' }
                                  : undefined,
                              )}
                            </span>
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
                                         <th>{t('usage_stats.request_events_source')}</th>
                                         <th>{t('usage_stats.request_events_api_key', { defaultValue: 'API Key' })}</th>
                                         <th>{t('usage_stats.request_events_auth_index')}</th>
                                         <th>{t('usage_stats.request_events_result')}</th>
                                         {renderSortableHeader('inputTokens', t('usage_stats.input_tokens'))}
                                         {renderSortableHeader('outputTokens', t('usage_stats.output_tokens'))}
                                         {renderSortableHeader('reasoningTokens', t('usage_stats.reasoning_tokens'))}
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
                                             <td className={styles.requestEventsSourceCell} title={row.source}>
                                                 <span>{row.source}</span>
                                                 {row.sourceType &&
                                                  <span className={styles.credentialType}>{row.sourceType}</span>}
                                             </td>
                                             <td className={styles.requestEventsApiKey} title={row.apiKeyMasked}>
                                                 {row.apiKeyMasked}
                                             </td>
                                             <td className={styles.requestEventsAuthIndex} title={row.authIndex}>
                                                 {row.authIndex}
                                             </td>
                                             <td>
                        <span
                            className={row.failed ?
                                       styles.requestEventsResultFailed :
                                       styles.requestEventsResultSuccess}
                        >
                          {row.failed ? t('stats.failure') : t('stats.success')}
                        </span>
                                             </td>
                                             <td>{row.inputTokens.toLocaleString()}</td>
                                             <td>{row.outputTokens.toLocaleString()}</td>
                                             <td>{row.reasoningTokens.toLocaleString()}</td>
                                             <td>{row.cachedTokens.toLocaleString()}</td>
                                             <td>{row.totalTokens.toLocaleString()}</td>
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
                    </>
                )}
        </Card>
    )
}
