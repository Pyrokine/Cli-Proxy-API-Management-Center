import {EmptyState} from '@/components/ui/EmptyState'
import {LoadingSpinner} from '@/components/ui/LoadingSpinner'
import {Tabs} from '@/components/ui/Tabs'
import {
    EventsTab,
    FilterBar,
    OverviewTab,
    SettingsTab,
    usageSummaryRequestKey,
    useUsageData,
    useUsageSummary,
} from '@/components/usage'
import {useAuthFileMap} from '@/components/usage/hooks/useAuthFileMap'
import type {UsagePayload} from '@/components/usage/hooks/useUsageData'
import {useHeaderRefresh} from '@/hooks/useHeaderRefresh'
import {useMediaQuery} from '@/hooks/useMediaQuery'
import {apiKeyAliasApi} from '@/services/api/apiKeys'
import {providersApi} from '@/services/api/providers'
import {type RequestSpeed, usageApi} from '@/services/api/usage'
import {useConfigStore} from '@/stores'
import type {OpenAIProviderConfig} from '@/types'
import {type ChartDimension, filterUsageByDateRange, filterUsageBySelections} from '@/utils/usage'
import {
    CategoryScale,
    Chart as ChartJS,
    Filler,
    Legend,
    LinearScale,
    LineElement,
    PointElement,
    Title,
    Tooltip,
} from 'chart.js'
import {useCallback, useEffect, useMemo, useState} from 'react'
import {useTranslation} from 'react-i18next'
import styles from './UsagePage.module.scss'

// Register Chart.js components
ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler)

const DEFAULT_PRESET              = '30d'
const ACTIVE_TAB_STORAGE_KEY      = 'cli-proxy-usage-active-tab-v1'
// Earliest timestamp representable by the usage store's Unix nanoseconds.
const ALL_PRESET_PLACEHOLDER_FROM = '1677-09-21T00:12:43.145224192Z'

type UsageTab = 'overview' | 'events' | 'settings'
type UsageDateRange = { from: string; to: string }

function initActiveTab(): UsageTab {
    try {
        if (typeof localStorage !== 'undefined') {
            const raw = localStorage.getItem(ACTIVE_TAB_STORAGE_KEY)
            if (raw === 'overview' || raw === 'events' || raw === 'settings') {
                return raw
            }
        }
    } catch {
        /* ignore */
    }
    return 'overview'
}

function initDateRange(): { from: string; to: string; preset: string } {
    const now = new Date()
    return {
        from: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString(),
        to: now.toISOString(),
        preset: DEFAULT_PRESET,
    }
}

/** Calculate chart hour window from the date range span. */
function calcHourWindow(from: string, to: string): number | undefined {
    const fromMs = new Date(from).getTime()
    const toMs   = new Date(to).getTime()
    if (Number.isNaN(fromMs) || Number.isNaN(toMs)) {
        return undefined
    }
    const hours = (toMs - fromMs) / (60 * 60 * 1000)
    if (hours <= 0) {
        return undefined
    }
    return Math.ceil(hours)
}

export function UsagePage() {
    const { t }    = useTranslation()
    const isMobile = useMediaQuery('(max-width: 768px)')
    const config   = useConfigStore((state) => state.config)

    // Date range state
    const [dateRange, setDateRange]                             = useState(() => initDateRange())
    const [selectedModels, setSelectedModels]                   = useState<string[]>([])
    const [selectedCredentials, setSelectedCredentials]         = useState<string[]>([])
    const [selectedApiKeys, setSelectedApiKeys]                 = useState<string[]>([])
    const [selectedEventStatus, setSelectedEventStatus]         = useState('')
    const [selectedEventSpeed, setSelectedEventSpeed]           = useState<RequestSpeed | ''>('')
    const [aliases, setAliases]                                 = useState<Record<string, string>>({})
    const [activeTab, setActiveTabState]                        = useState<UsageTab>(() => initActiveTab())
    const usageStatsTabActive                                   = activeTab !== 'settings'
    const { authFileMap, authFileMapLoading }                   = useAuthFileMap(usageStatsTabActive)
    const [fallbackNowMs]                                       = useState(() => Date.now())
    const [liveWindowAnchorMs, setLiveWindowAnchorMs]           = useState(() => Date.now())
    const [summaryRefreshToken, setSummaryRefreshToken]         = useState(0)
    const [eventsRefreshToken, setEventsRefreshToken]           = useState(0)
    const [eventsVisibleDateRange, setEventsVisibleDateRange]   = useState<{
                                                                               base: UsageDateRange
                                                                               range: UsageDateRange
                                                                           } | null>(null)
    const [openaiProvidersForUsage, setOpenaiProvidersForUsage] = useState<OpenAIProviderConfig[] | null>(null)

    const needsRawUsage = false

    // Data hook
    const handleUsageViewsRefresh = useCallback(async () => {
        setLiveWindowAnchorMs(Date.now())
        setSummaryRefreshToken((prev) => prev + 1)
        setEventsRefreshToken((prev) => prev + 1)
    }, [])

    const {
              usage,
              loading,
              error,
              lastRefreshedAt,
              modelPrices,
              loadUsage,
              handleExport,
              handleImport,
              handleImportChange,
              backupPasswordDialog,
              importInputRef,
              exporting,
              importing,
          } = useUsageData({
                               enabled: needsRawUsage,
                               loadModelPricesEnabled: true,
                               onAfterImport: handleUsageViewsRefresh,
                               onAfterPricesSaved: handleUsageViewsRefresh,
                           })

    const setActiveTab = useCallback((next: UsageTab) => {
        setActiveTabState(next)
        setEventsVisibleDateRange(null)
        try {
            localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, next)
        } catch {
            /* ignore */
        }
    }, [])

    // Auto-derive chart dimension from filter state (priority: model > api_key > credential)
    const chartDimension: ChartDimension =
              selectedModels.length > 0
              ? 'model'
              : selectedApiKeys.length > 0
                ? 'api_key'
                : selectedCredentials.length > 0
                  ? 'credential'
                  : 'total'

    // noinspection DuplicatedCode
    useEffect(() => {
        if (!usageStatsTabActive) {
            return
        }
        let cancelled = false
        void apiKeyAliasApi
            .list()
            .then((data) => {
                if (!cancelled) {
                    setAliases(data)
                }
            })
            .catch((err) => {
                console.warn('Failed to load API key aliases:', err)
            })
        return () => {
            cancelled = true
        }
    }, [usageStatsTabActive])

    useEffect(() => {
        if (!usageStatsTabActive) {
            return
        }
        let cancelled = false
        void providersApi
            .getOpenAIProviders()
            .then((data) => {
                if (!cancelled) {
                    setOpenaiProvidersForUsage(data)
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setOpenaiProvidersForUsage(null)
                }
            })
        return () => {
            cancelled = true
        }
    }, [usageStatsTabActive, config?.openaiCompatibility])

    const clearUsageFilters = useCallback(() => {
        setSelectedModels([])
        setSelectedCredentials([])
        setSelectedApiKeys([])
        setSelectedEventStatus('')
        setSelectedEventSpeed('')
    }, [])

    const handleDateRangeChange = useCallback((from: string, to: string, preset?: string) => {
        setDateRange({ from, to, preset: preset ?? '' })
    }, [])

    const handleRefresh = useCallback(() => {
        const refreshAnchorMs = Date.now()
        setLiveWindowAnchorMs(refreshAnchorMs)

        setDateRange((prev) => {
            const days = prev.preset === '24h' ? 1 : prev.preset === '7d' ? 7 : prev.preset === '30d' ? 30 : 0
            if (days > 0) {
                return {
                    ...prev,
                    from: new Date(refreshAnchorMs - days * 24 * 60 * 60 * 1000).toISOString(),
                    to: new Date(refreshAnchorMs).toISOString(),
                }
            }
            return prev.preset === 'all' ? { ...prev, to: new Date(refreshAnchorMs).toISOString() } : prev
        })

        if (needsRawUsage) {
            void loadUsage().catch(() => {
            })
        }
        setSummaryRefreshToken((prev) => prev + 1)
        if (activeTab === 'events') {
            setEventsRefreshToken((prev) => prev + 1)
        }
    }, [activeTab, loadUsage, needsRawUsage])

    const isAllPreset                                     = dateRange.preset === 'all'
    const effectiveDateTo                                 = dateRange.to
    const allSummaryResolutionKey                         = JSON.stringify([
                                                                               effectiveDateTo,
                                                                               selectedModels,
                                                                               selectedApiKeys,
                                                                               selectedCredentials,
                                                                               summaryRefreshToken,
                                                                           ])
    const [allSummaryResolution, setAllSummaryResolution] = useState<{
                                                                         key: string
                                                                         from?: string
                                                                         error?: string
                                                                     } | null>(null)
    const resolvedAll                                     = isAllPreset &&
                                                            allSummaryResolution?.key ===
                                                            allSummaryResolutionKey
                                                            ? allSummaryResolution : null
    const rangeResolutionLoading                          = isAllPreset && !resolvedAll
    const rangeResolutionError                            = resolvedAll?.error
    const rangeEmpty                                      = isAllPreset &&
                                                            resolvedAll !==
                                                            null &&
                                                            !resolvedAll.from &&
                                                            !rangeResolutionError
    const effectiveDateFrom                               = isAllPreset ? resolvedAll?.from ?? '' : dateRange.from
    const effectiveRangeReady                             = !isAllPreset || Boolean(resolvedAll?.from)
    const hourWindowHours                                 = calcHourWindow(effectiveDateFrom, effectiveDateTo)
    const summaryGranularity: 'hourly' | 'daily'          = (hourWindowHours ?? 0) > 7 * 24 ? 'daily' : 'hourly'
    const hasSelectionFilters                             = selectedModels.length >
                                                            0 ||
                                                            selectedCredentials.length >
                                                            0 ||
                                                            selectedApiKeys.length >
                                                            0

    useEffect(() => {
        if (!isAllPreset || !usageStatsTabActive) {
            return
        }
        const controller = new AbortController()

        void usageApi
            .getEvents(
                {
                    from: ALL_PRESET_PLACEHOLDER_FROM,
                    to: effectiveDateTo,
                    page: 1,
                    page_size: 1,
                    api_key_identity: 'canonical',
                    model: selectedModels.length > 0 ? selectedModels.join(',') : undefined,
                    source: selectedCredentials.length > 0 ? selectedCredentials.join(',') : undefined,
                    api_key: selectedApiKeys.length > 0 ? selectedApiKeys : undefined,
                    sort: 'timestamp',
                    order: 'asc',
                    view: 'compact',
                },
                { signal: controller.signal },
            )
            .then((response) => {
                if (!controller.signal.aborted) {
                    const timestamp = response.events[0]?.timestamp
                    if (response.total > 0 && (!timestamp || !Number.isFinite(Date.parse(timestamp)))) {
                        throw new Error(t('usage_stats.range_start_unavailable', {
                            defaultValue: 'Could not find the first request time',
                        }))
                    }
                    setAllSummaryResolution({ key: allSummaryResolutionKey, from: timestamp })
                }
            })
            .catch((failure: unknown) => {
                if (!controller.signal.aborted) {
                    setAllSummaryResolution({
                                                key: allSummaryResolutionKey,
                                                error: failure instanceof Error ? failure.message : String(failure),
                                            })
                }
            })

        return () => controller.abort()
    }, [
                  isAllPreset, usageStatsTabActive, allSummaryResolutionKey, effectiveDateTo,
                  selectedModels, selectedCredentials, selectedApiKeys, t,
              ])

    // Summary API (pre-aggregated data from backend)
    const summaryParams = useMemo(
        () => ({
            from: effectiveDateFrom,
            to: effectiveDateTo,
            granularity: summaryGranularity,
            api_key_identity: 'canonical' as const,
            model: selectedModels.length > 0 ? selectedModels.join(',') : undefined,
            api_key: selectedApiKeys.length > 0 ? selectedApiKeys : undefined,
            credential: selectedCredentials.length > 0 ? selectedCredentials.join(',') : undefined,
            groups: chartDimension === 'total' ? ('none' as const) : ('all' as const),
        }),
        [
            effectiveDateFrom,
            effectiveDateTo,
            summaryGranularity,
            selectedModels,
            selectedApiKeys,
            selectedCredentials,
            chartDimension,
        ],
    )
    const {
              summary,
              loading: summaryLoading,
              error: summaryError,
          }             = useUsageSummary(summaryParams, {
        enabled: usageStatsTabActive && effectiveRangeReady,
        refreshToken: summaryRefreshToken,
    })

    const liveSummaryRange = useMemo(() => ({
        from: new Date(liveWindowAnchorMs - 60 * 60 * 1000).toISOString(),
        to: new Date(liveWindowAnchorMs).toISOString(),
    }), [liveWindowAnchorMs])

    const liveSummaryParams   = useMemo(
        () => ({
            from: liveSummaryRange.from,
            to: liveSummaryRange.to,
            granularity: 'hourly' as const,
            api_key_identity: 'canonical' as const,
            model: selectedModels.length > 0 ? selectedModels.join(',') : undefined,
            api_key: selectedApiKeys.length > 0 ? selectedApiKeys : undefined,
            credential: selectedCredentials.length > 0 ? selectedCredentials.join(',') : undefined,
            groups: chartDimension === 'total' ? ('none' as const) : ('all' as const),
        }),
        [liveSummaryRange, selectedModels, selectedApiKeys, selectedCredentials, chartDimension],
    )
    const reuseSummaryForLive = usageSummaryRequestKey(summaryParams) === usageSummaryRequestKey(liveSummaryParams)
    const {
              summary: requestedLiveSummary,
              loading: requestedLiveSummaryLoading,
              error: requestedLiveSummaryError,
          }                   = useUsageSummary(liveSummaryParams, {
        enabled: usageStatsTabActive && effectiveRangeReady && !reuseSummaryForLive,
        refreshToken: summaryRefreshToken,
    })
    const liveSummary         = reuseSummaryForLive ? summary : requestedLiveSummary
    const liveSummaryLoading  = reuseSummaryForLive ? summaryLoading : requestedLiveSummaryLoading
    const liveSummaryError    = reuseSummaryForLive ? summaryError : requestedLiveSummaryError

    // Filtered usage: date range → model/credential selection
    const timeFilteredUsage = useMemo(
        () => (usage && effectiveRangeReady ? filterUsageByDateRange(usage, effectiveDateFrom, effectiveDateTo) : null),
        [usage, effectiveRangeReady, effectiveDateFrom, effectiveDateTo],
    )
    const filteredUsage     = useMemo(() => {
        if (!timeFilteredUsage) {
            return null
        }
        return filterUsageBySelections(
            timeFilteredUsage,
            selectedModels,
            selectedCredentials,
            selectedApiKeys,
        ) as UsagePayload
    }, [timeFilteredUsage, selectedModels, selectedCredentials, selectedApiKeys])

    // Unfiltered summary used to populate the filter dropdowns so that selecting one
    // option does not cause the other options to disappear.
    const filterOptionsParams               = useMemo(
        () => ({
            from: effectiveDateFrom,
            to: effectiveDateTo,
            granularity: summaryGranularity,
            api_key_identity: 'canonical' as const,
            groups: 'none' as const,
        }),
        [effectiveDateFrom, effectiveDateTo, summaryGranularity],
    )
    const { summary: filterOptionsSummary } = useUsageSummary(filterOptionsParams, {
        enabled: usageStatsTabActive && effectiveRangeReady && hasSelectionFilters,
        refreshToken: summaryRefreshToken,
    })

    // Wide windows use daily buckets on servers that predate period.granularity, too.
    const heatmapSummaryParams   = useMemo(
        () => ({
            from: effectiveDateFrom,
            to: effectiveDateTo,
            granularity: Date.parse(effectiveDateTo) - Date.parse(effectiveDateFrom) > 1999 * 3600_000
                         ? 'daily' as const : 'hourly' as const,
            api_key_identity: 'canonical' as const,
            model: selectedModels.length > 0 ? selectedModels.join(',') : undefined,
            api_key: selectedApiKeys.length > 0 ? selectedApiKeys : undefined,
            credential: selectedCredentials.length > 0 ? selectedCredentials.join(',') : undefined,
            groups: 'none' as const,
        }),
        [effectiveDateFrom, effectiveDateTo, selectedModels, selectedApiKeys, selectedCredentials],
    )
    const reuseSummaryForHeatmap =
              usageSummaryRequestKey(summaryParams) === usageSummaryRequestKey(heatmapSummaryParams)
    const {
              summary: requestedHeatmapSummary,
              loading: requestedHeatmapSummaryLoading,
              error: requestedHeatmapSummaryError,
          }                      = useUsageSummary(heatmapSummaryParams, {
        enabled: usageStatsTabActive && effectiveRangeReady && !reuseSummaryForHeatmap,
        refreshToken: summaryRefreshToken,
    })
    const heatmapSummary         = reuseSummaryForHeatmap ? summary : requestedHeatmapSummary
    const heatmapSummaryLoading  = reuseSummaryForHeatmap ? summaryLoading : requestedHeatmapSummaryLoading
    const heatmapSummaryError    = reuseSummaryForHeatmap ? summaryError : requestedHeatmapSummaryError

    const eventsDateRange                    = useMemo(
        () => ({ from: effectiveDateFrom, to: effectiveDateTo }),
        [effectiveDateFrom, effectiveDateTo],
    )
    const handleEventsVisibleDateRangeChange = useCallback((range: UsageDateRange) => {
        setEventsVisibleDateRange({ base: eventsDateRange, range })
    }, [eventsDateRange])
    const visibleDateRange                   = activeTab ===
                                               'events' &&
                                               eventsVisibleDateRange?.base ===
                                               eventsDateRange
                                               ? eventsVisibleDateRange.range : eventsDateRange

    const combinedSummaryLoading  = (usageStatsTabActive && rangeResolutionLoading) || summaryLoading
    const combinedSummaryError    = rangeResolutionError ?? summaryError
    const combinedHeatmapLoading  = (usageStatsTabActive && rangeResolutionLoading) || heatmapSummaryLoading
    const combinedHeatmapError    = rangeResolutionError ?? heatmapSummaryError
    const resolvedOpenaiProviders = openaiProvidersForUsage ?? config?.openaiCompatibility ?? []

    const dateFromMs = useMemo(() => {
        const ms = new Date(effectiveDateFrom).getTime()
        return Number.isFinite(ms) ? ms : fallbackNowMs - 24 * 60 * 60 * 1000
    }, [effectiveDateFrom, fallbackNowMs])
    const dateToMs   = useMemo(() => {
        const ms = new Date(effectiveDateTo).getTime()
        return Number.isFinite(ms) ? ms : fallbackNowMs
    }, [effectiveDateTo, fallbackNowMs])

    useHeaderRefresh(handleRefresh)

    return (
        <div className={styles.container}>
            {loading && !usage && (
                <div className={styles.loadingOverlay} aria-busy='true'>
                    <div className={styles.loadingOverlayContent}>
                        <LoadingSpinner size={28} className={styles.loadingOverlaySpinner} />
                        <span className={styles.loadingOverlayText}>{t('common.loading')}</span>
                    </div>
                </div>
            )}

            <div className={styles.header}>
                <h1 className={styles.pageTitle}>{t('usage_stats.title')}</h1>
            </div>

            <Tabs
                className={styles.usageTabs}
                items={(['overview', 'events', 'settings'] as const).map((tab) => ({
                    value: tab,
                    label: t(`usage_stats.tab_${tab}`),
                }))}
                activeValue={activeTab}
                onChange={setActiveTab}
                ariaLabel={t('usage_stats.title')}
            />

            {activeTab !== 'settings' && (
                <FilterBar
                    usage={usage}
                    dateFrom={visibleDateRange.from}
                    dateTo={visibleDateRange.to}
                    activePreset={dateRange.preset || undefined}
                    onDateRangeChange={handleDateRangeChange}
                    selectedModels={selectedModels}
                    onSelectedModelsChange={setSelectedModels}
                    selectedCredentials={selectedCredentials}
                    onSelectedCredentialsChange={setSelectedCredentials}
                    selectedApiKeys={selectedApiKeys}
                    onSelectedApiKeysChange={setSelectedApiKeys}
                    selectedStatus={activeTab === 'events' ? selectedEventStatus : undefined}
                    onSelectedStatusChange={activeTab === 'events' ? setSelectedEventStatus : undefined}
                    selectedSpeed={activeTab === 'events' ? selectedEventSpeed : undefined}
                    onSelectedSpeedChange={activeTab === 'events' ? setSelectedEventSpeed : undefined}
                    summary={summary}
                    optionsSummary={hasSelectionFilters ? filterOptionsSummary : summary}
                    aliases={aliases}
                    authFileMap={authFileMap}
                    onExport={() =>
                        handleExport({
                                         from: visibleDateRange.from,
                                         to: visibleDateRange.to,
                                         model: selectedModels.length > 0 ? selectedModels.join(',') : undefined,
                                         api_key: selectedApiKeys.length > 0 ? selectedApiKeys : undefined,
                                         api_key_identity: 'canonical',
                                         credential: selectedCredentials.length > 0 ?
                                                     selectedCredentials.join(',') :
                                                     undefined,
                                         speed: activeTab === 'events' ? selectedEventSpeed : undefined,
                                     })
                    }
                    exportDisabled={!effectiveRangeReady || !visibleDateRange.from || !visibleDateRange.to}
                    onClearFilters={!effectiveRangeReady && hasSelectionFilters &&
             (activeTab === 'overview' || Boolean(rangeResolutionError)) ? clearUsageFilters : undefined}
                    onImport={handleImport}
                    onRefresh={handleRefresh}
                    loading={loading || rangeResolutionLoading}
                    exporting={exporting}
                    importing={importing}
                    lastRefreshedAt={lastRefreshedAt}
                />
            )}

            <input
                ref={importInputRef}
                type='file'
                accept='.json,.csv,application/json,text/csv'
                style={{ display: 'none' }}
                onChange={handleImportChange}
            />

            {backupPasswordDialog}

            {error && <div className={styles.errorBox}>{error}</div>}
            {rangeResolutionError && <div className={styles.errorBox} role='alert'>
                {t('notification.load_failed')}: {rangeResolutionError}
                <button type='button' className='btn btn-secondary' onClick={handleRefresh}>{t('common.retry')}</button>
            </div>}
            {liveSummaryError && !reuseSummaryForLive && <div className={styles.errorBox} role='alert'>
                {t('usage_stats.unified_latest_label')}: {liveSummaryError}
                <button type='button' className='btn btn-secondary' onClick={handleRefresh}>{t('common.retry')}</button>
            </div>}

            {activeTab === 'overview' && summaryError && summary && <div className={styles.errorBox} role='alert'>
                {summaryError} · {t('usage_stats.previous_results_shown', {
                defaultValue: 'Showing the last loaded results',
            })}
                <button type='button' className='btn btn-secondary' onClick={handleRefresh}>{t('common.retry')}</button>
            </div>}
            {activeTab === 'overview' && rangeEmpty && <EmptyState title={t('service_health.no_requests')} />}
            {activeTab === 'overview' && !rangeEmpty && (
                <OverviewTab
                    usage={filteredUsage}
                    loading={combinedSummaryLoading}
                    usageLoading={loading || rangeResolutionLoading || combinedSummaryLoading}
                    summaryError={combinedSummaryError}
                    heatmapLoading={combinedHeatmapLoading}
                    heatmapError={combinedHeatmapError}
                    isMobile={isMobile}
                    chartDimension={chartDimension}
                    summary={summary}
                    liveSummary={liveSummary}
                    heatmapSummary={heatmapSummary}
                    heatmapGranularity={heatmapSummaryParams.granularity}
                    fromMs={dateFromMs}
                    toMs={dateToMs}
                    modelPrices={modelPrices}
                    aliases={aliases}
                    onRefresh={handleRefresh}
                    refreshing={summaryLoading || heatmapSummaryLoading || liveSummaryLoading}
                    credentials={{
                        loading: authFileMapLoading,
                        geminiKeys: config?.geminiApiKeys || [],
                        claudeConfigs: config?.claudeApiKeys || [],
                        codexConfigs: config?.codexApiKeys || [],
                        vertexConfigs: config?.vertexApiKeys || [],
                        openaiProviders: resolvedOpenaiProviders,
                        authFileMap: authFileMap,
                    }}
                />
            )}

            {activeTab === 'events' && !rangeResolutionError && (
                <EventsTab
                    enabled={effectiveRangeReady}
                    rangeLoading={rangeResolutionLoading}
                    onClearFilters={clearUsageFilters}
                    refreshToken={eventsRefreshToken}
                    geminiKeys={config?.geminiApiKeys || []}
                    claudeConfigs={config?.claudeApiKeys || []}
                    codexConfigs={config?.codexApiKeys || []}
                    vertexConfigs={config?.vertexApiKeys || []}
                    openaiProviders={resolvedOpenaiProviders}
                    authFileMap={authFileMap}
                    dateRange={eventsDateRange}
                    activePreset={dateRange.preset || undefined}
                    aliases={aliases}
                    autoRefreshConfigSeconds={config?.autoRefreshInterval}
                    pauseAutoRefresh={Boolean(backupPasswordDialog)}
                    onVisibleDateRangeChange={handleEventsVisibleDateRangeChange}
                    selectedModels={selectedModels}
                    selectedCredentials={selectedCredentials}
                    selectedApiKeys={selectedApiKeys}
                    selectedStatus={selectedEventStatus}
                    onSelectedStatusChange={setSelectedEventStatus}
                    selectedSpeed={selectedEventSpeed}
                    onSelectedSpeedChange={setSelectedEventSpeed}
                />
            )}

            {activeTab === 'settings' && <SettingsTab />}
        </div>
    )
}
