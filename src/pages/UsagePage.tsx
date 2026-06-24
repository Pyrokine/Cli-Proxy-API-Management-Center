import {LoadingSpinner} from '@/components/ui/LoadingSpinner'
import {Tabs} from '@/components/ui/Tabs'
import {EventsTab, FilterBar, OverviewTab, SettingsTab, useUsageData, useUsageSummary} from '@/components/usage'
import {useAuthFileMap} from '@/components/usage/hooks/useAuthFileMap'
import type {UsagePayload} from '@/components/usage/hooks/useUsageData'
import {useHeaderRefresh} from '@/hooks/useHeaderRefresh'
import {useMediaQuery} from '@/hooks/useMediaQuery'
import {apiKeyAliasApi} from '@/services/api/apiKeys'
import {providersApi} from '@/services/api/providers'
import {usageApi} from '@/services/api/usage'
import {useConfigStore} from '@/stores'
import type {OpenAIProviderConfig} from '@/types'
import {toLocalDateTimeString} from '@/utils/format'
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
const ALL_PRESET_PLACEHOLDER_FROM = '2020-01-01T00:00'

type UsageTab = 'overview' | 'events' | 'settings'

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
        from: toLocalDateTimeString(new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)),
        to: toLocalDateTimeString(now),
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
    const [aliases, setAliases]                                 = useState<Record<string, string>>({})
    const [activeTab, setActiveTabState]                        = useState<UsageTab>(() => initActiveTab())
    const usageStatsTabActive                                   = activeTab !== 'settings'
    const { authFileMap, authFileMapLoading }                   = useAuthFileMap(usageStatsTabActive)
    const [fallbackNowMs]                                       = useState(() => Date.now())
    const [liveWindowAnchorMs, setLiveWindowAnchorMs]           = useState(() => Date.now())
    const [summaryRefreshToken, setSummaryRefreshToken]         = useState(0)
    const [eventsRefreshToken, setEventsRefreshToken]           = useState(0)
    const [eventsVisibleDateRange, setEventsVisibleDateRange]   = useState<{ from: string; to: string } | null>(null)
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

    const handleDateRangeChange = useCallback((from: string, to: string, preset?: string) => {
        // When "all" is selected, start from an epoch placeholder so the first
        // summary request can discover the real earliest point, then converge the
        // window to that point once data arrives.
        if (preset === 'all') {
            setDateRange({ from: ALL_PRESET_PLACEHOLDER_FROM, to, preset: 'all' })
        } else {
            setDateRange({ from, to, preset: preset ?? '' })
        }
    }, [])

    // Refresh button: re-fetch data and, for time-relative presets, slide the
    // window so it ends at "now" instead of the locked-in initial timestamp.
    // Custom (no preset) ranges stay untouched in absolute time, but still need
    // a manual reload because the params object does not change by itself.
    const handleRefresh = useCallback(() => {
        const refreshAnchorMs = Date.now()
        setLiveWindowAnchorMs(refreshAnchorMs)
        let shouldReloadSummary = false
        let shouldReloadEvents  = false

        setDateRange((prev) => {
            const now    = new Date(refreshAnchorMs)
            const nowStr = toLocalDateTimeString(now)
            switch (prev.preset) {
                case '24h':
                    return {
                        ...prev,
                        from: toLocalDateTimeString(new Date(now.getTime() - 24 * 60 * 60 * 1000)),
                        to: nowStr,
                    }
                case '7d':
                    return {
                        ...prev,
                        from: toLocalDateTimeString(new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)),
                        to: nowStr,
                    }
                case '30d':
                    return {
                        ...prev,
                        from: toLocalDateTimeString(new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)),
                        to: nowStr,
                    }
                case 'all':
                    return { ...prev, to: nowStr }
                default:
                    shouldReloadSummary = true
                    shouldReloadEvents  = activeTab === 'events'
                    return prev
            }
        })

        if (needsRawUsage) {
            void loadUsage().catch(() => {
            })
        }
        if (shouldReloadSummary) {
            setSummaryRefreshToken((prev) => prev + 1)
        }
        if (shouldReloadEvents) {
            setEventsRefreshToken((prev) => prev + 1)
        }
    }, [activeTab, loadUsage, needsRawUsage])

    const isAllPreset                                     = dateRange.preset === 'all'
    const allSummaryResolutionKey                         = useMemo(
        () =>
            [dateRange.to, selectedModels.join(','), selectedApiKeys.join(','), selectedCredentials.join(',')].join(
                '|',
            ),
        [dateRange.to, selectedModels, selectedApiKeys, selectedCredentials],
    )
    const [allSummaryResolution, setAllSummaryResolution] = useState<{ key: string; from: string; resolved: boolean }>({
                                                                                                                           key: '',
                                                                                                                           from: '',
                                                                                                                           resolved: false,
                                                                                                                       })
    const [allSummaryResolving, setAllSummaryResolving]   = useState(false)
    const allSummaryResolved                              =
              isAllPreset && allSummaryResolution.key === allSummaryResolutionKey && allSummaryResolution.resolved
    const resolvedAllFrom                                 = allSummaryResolved ? allSummaryResolution.from : ''
    const effectiveDateFrom                               = isAllPreset ?
                                                            (resolvedAllFrom || ALL_PRESET_PLACEHOLDER_FROM) :
                                                            dateRange.from
    const effectiveDateTo                                 = dateRange.to
    const effectiveRangeReady                             = !isAllPreset || allSummaryResolved
    const granularityRangeFrom                            = effectiveDateFrom || dateRange.from
    const hourWindowHours                                 = calcHourWindow(granularityRangeFrom, effectiveDateTo)
    const summaryGranularity: 'hourly' | 'daily'          = (hourWindowHours ?? 0) > 7 * 24 ? 'daily' : 'hourly'
    const hasSelectionFilters                             =
              selectedModels.length > 0 || selectedCredentials.length > 0 || selectedApiKeys.length > 0

    useEffect(() => {
        if (!isAllPreset) {
            const frameId = requestAnimationFrame(() => {
                setAllSummaryResolution((prev) => (prev.key || prev.from || prev.resolved ?
                    { key: '', from: '', resolved: false } :
                                                   prev))
                setAllSummaryResolving(false)
            })
            return () => cancelAnimationFrame(frameId)
        }
        if (allSummaryResolved) {
            return
        }

        let cancelled    = false
        const controller = new AbortController()
        const frameId    = requestAnimationFrame(() => {
            setAllSummaryResolving(true)
        })

        void usageApi
            .getEvents(
                {
                    from: ALL_PRESET_PLACEHOLDER_FROM,
                    to: effectiveDateTo,
                    page: 1,
                    page_size: 1,
                    model: selectedModels.length > 0 ? selectedModels.join(',') : undefined,
                    source: selectedCredentials.length > 0 ? selectedCredentials.join(',') : undefined,
                    api_key: selectedApiKeys.length > 0 ? selectedApiKeys.join(',') : undefined,
                    sort: 'timestamp',
                    order: 'asc',
                },
                { signal: controller.signal },
            )
            .then((response) => {
                if (cancelled) {
                    return
                }
                const timestamp    = response.events[0]?.timestamp
                const resolvedFrom = timestamp ? toLocalDateTimeString(new Date(timestamp)) : ''
                setAllSummaryResolution((prev) =>
                                            prev.key ===
                                            allSummaryResolutionKey &&
                                            prev.from ===
                                            resolvedFrom &&
                                            prev.resolved
                                            ? prev
                                            : { key: allSummaryResolutionKey, from: resolvedFrom, resolved: true },
                )
            })
            .catch(() => {
            })
            .finally(() => {
                if (!cancelled) {
                    setAllSummaryResolving(false)
                }
            })

        return () => {
            cancelled = true
            controller.abort()
            cancelAnimationFrame(frameId)
        }
    }, [
                  isAllPreset,
                  allSummaryResolved,
                  allSummaryResolutionKey,
                  effectiveDateTo,
                  selectedModels,
                  selectedCredentials,
                  selectedApiKeys,
              ])

    const rangeResolutionLoading = isAllPreset && allSummaryResolving && resolvedAllFrom.length === 0

    // Summary API (pre-aggregated data from backend)
    const summaryParams = useMemo(
        () => ({
            from: effectiveDateFrom,
            to: effectiveDateTo,
            granularity: summaryGranularity,
            model: selectedModels.length > 0 ? selectedModels.join(',') : undefined,
            api_key: selectedApiKeys.length > 0 ? selectedApiKeys.join(',') : undefined,
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
              reload: reloadSummary,
          }             = useUsageSummary(summaryParams, {
        enabled: usageStatsTabActive && effectiveRangeReady,
    })

    const liveSummaryRange = useMemo(() => {
        const fromMs = new Date(effectiveDateFrom).getTime()
        const toMs   = new Date(effectiveDateTo).getTime()
        if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) {
            return {
                from: toLocalDateTimeString(new Date(liveWindowAnchorMs - 60 * 60 * 1000)),
                to: toLocalDateTimeString(new Date(liveWindowAnchorMs)),
            }
        }
        return {
            from: toLocalDateTimeString(new Date(Math.max(fromMs, toMs - 60 * 60 * 1000))),
            to: toLocalDateTimeString(new Date(toMs)),
        }
    }, [effectiveDateFrom, effectiveDateTo, liveWindowAnchorMs])

    const liveSummaryParams = useMemo(
        () => ({
            from: liveSummaryRange.from,
            to: liveSummaryRange.to,
            granularity: 'hourly' as const,
            model: selectedModels.length > 0 ? selectedModels.join(',') : undefined,
            api_key: selectedApiKeys.length > 0 ? selectedApiKeys.join(',') : undefined,
            credential: selectedCredentials.length > 0 ? selectedCredentials.join(',') : undefined,
            groups: chartDimension === 'total' ? ('none' as const) : ('all' as const),
        }),
        [liveSummaryRange, selectedModels, selectedApiKeys, selectedCredentials, chartDimension],
    )
    const {
              summary: liveSummary,
              loading: liveSummaryLoading,
              reload: reloadLiveSummary,
          }                 = useUsageSummary(liveSummaryParams, {
        enabled: usageStatsTabActive && effectiveRangeReady,
    })

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
    const filterOptionsParams                                                   = useMemo(
        () => ({
            from: effectiveDateFrom,
            to: effectiveDateTo,
            granularity: summaryGranularity,
            groups: 'none' as const,
        }),
        [effectiveDateFrom, effectiveDateTo, summaryGranularity],
    )
    const { summary: filterOptionsSummary, reload: reloadFilterOptionsSummary } = useUsageSummary(filterOptionsParams, {
        enabled: usageStatsTabActive && effectiveRangeReady && hasSelectionFilters,
    })

    // 健康监测: 跟顶部 dateRange + 维度筛选, 但 granularity 固定 hourly
    // 主 summary 在 >7 天窗口下用 daily 粒度防折线图过密, 那样每天只能映射
    // 到 1 个 hour cell, grid 几乎全 idle,独立请求保证每天 24 cells 都能填上
    const heatmapSummaryParams = useMemo(
        () => ({
            from: effectiveDateFrom,
            to: effectiveDateTo,
            granularity: 'hourly' as const,
            model: selectedModels.length > 0 ? selectedModels.join(',') : undefined,
            api_key: selectedApiKeys.length > 0 ? selectedApiKeys.join(',') : undefined,
            credential: selectedCredentials.length > 0 ? selectedCredentials.join(',') : undefined,
            groups: 'none' as const,
        }),
        [effectiveDateFrom, effectiveDateTo, selectedModels, selectedApiKeys, selectedCredentials],
    )
    const {
              summary: heatmapSummary,
              loading: heatmapSummaryLoading,
              error: heatmapSummaryError,
              reload: reloadHeatmapSummary,
          }                    = useUsageSummary(heatmapSummaryParams, {
        enabled: usageStatsTabActive && effectiveRangeReady,
    })

    useEffect(() => {
        if (summaryRefreshToken === 0 || !effectiveRangeReady) {
            return
        }

        const token   = summaryRefreshToken
        const reloads = [reloadSummary(), reloadHeatmapSummary(), reloadLiveSummary()]
        if (hasSelectionFilters) {
            reloads.push(reloadFilterOptionsSummary())
        }

        void Promise.all(reloads).finally(() => {
            setSummaryRefreshToken((current) => (current === token ? 0 : current))
        })
    }, [
                  summaryRefreshToken,
                  effectiveRangeReady,
                  reloadSummary,
                  reloadFilterOptionsSummary,
                  reloadHeatmapSummary,
                  reloadLiveSummary,
                  hasSelectionFilters,
              ])

    const eventsDateRange                    = useMemo(
        () => ({ from: effectiveDateFrom, to: effectiveDateTo }),
        [effectiveDateFrom, effectiveDateTo],
    )
    const handleEventsVisibleDateRangeChange = useCallback((range: { from: string; to: string }) => {
        setEventsVisibleDateRange((prev) => {
            if (prev?.from === range.from && prev?.to === range.to) {
                return prev
            }
            return range
        })
    }, [])

    const combinedSummaryLoading  = (usageStatsTabActive && rangeResolutionLoading) || summaryLoading
    const combinedSummaryError    = summaryError
    const combinedHeatmapLoading  = (usageStatsTabActive && rangeResolutionLoading) || heatmapSummaryLoading
    const combinedHeatmapError    = heatmapSummaryError
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
                    dateFrom={
                        activeTab === 'events' ? eventsVisibleDateRange?.from || effectiveDateFrom : effectiveDateFrom
                    }
                    dateTo={activeTab === 'events' ? eventsVisibleDateRange?.to || dateRange.to : effectiveDateTo}
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
                    summary={summary}
                    optionsSummary={hasSelectionFilters ? filterOptionsSummary : summary}
                    aliases={aliases}
                    authFileMap={authFileMap}
                    onExport={() =>
                        handleExport({
                                         from: effectiveDateFrom,
                                         to: effectiveDateTo,
                                         model: selectedModels.length > 0 ? selectedModels.join(',') : undefined,
                                         api_key: selectedApiKeys.length > 0 ? selectedApiKeys.join(',') : undefined,
                                         credential: selectedCredentials.length > 0 ?
                                                     selectedCredentials.join(',') :
                                                     undefined,
                                     })
                    }
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
                accept='.json,application/json'
                style={{ display: 'none' }}
                onChange={handleImportChange}
            />

            {error && <div className={styles.errorBox}>{error}</div>}

            {activeTab === 'overview' && (
                <OverviewTab
                    usage={filteredUsage}
                    loading={combinedSummaryLoading}
                    usageLoading={loading || rangeResolutionLoading}
                    summaryError={combinedSummaryError}
                    heatmapLoading={combinedHeatmapLoading}
                    heatmapError={combinedHeatmapError}
                    isMobile={isMobile}
                    chartDimension={chartDimension}
                    summary={summary}
                    liveSummary={liveSummary}
                    heatmapSummary={heatmapSummary}
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

            {activeTab === 'events' && (
                <EventsTab
                    enabled={effectiveRangeReady}
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
                    onVisibleDateRangeChange={handleEventsVisibleDateRangeChange}
                    selectedModels={selectedModels}
                    selectedCredentials={selectedCredentials}
                    selectedApiKeys={selectedApiKeys}
                    selectedStatus={selectedEventStatus}
                    onSelectedStatusChange={setSelectedEventStatus}
                />
            )}

            {activeTab === 'settings' && <SettingsTab />}
        </div>
    )
}
