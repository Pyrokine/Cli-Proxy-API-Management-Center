import {IconBot, IconKey, IconLayoutDashboard, IconScrollText, IconSettings} from '@/components/ui/icons'
import {LoadingSpinner} from '@/components/ui/LoadingSpinner'
import {type TabItem, Tabs} from '@/components/ui/Tabs'
import {
    CredentialsTab,
    EventsTab,
    FilterBar,
    ModelsTab,
    OverviewTab,
    SettingsTab,
    useChartData,
    useSparklines,
    useUsageData,
    useUsageSummary,
} from '@/components/usage'
import {useAuthFileMap} from '@/components/usage/hooks/useAuthFileMap'
import type {UsagePayload} from '@/components/usage/hooks/useUsageData'
import type {ChartDrillDownInfo} from '@/components/usage/UsageChart'
import {useHeaderRefresh} from '@/hooks/useHeaderRefresh'
import {useMediaQuery} from '@/hooks/useMediaQuery'
import {apiKeyAliasApi} from '@/services/api/apiKeys'
import {useConfigStore} from '@/stores'
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

const DATE_RANGE_STORAGE_KEY = 'cli-proxy-usage-date-range-v1'
const DEFAULT_CHART_LINES    = ['all']
const DEFAULT_PRESET         = '24h'

function initDateRange(): { from: string; to: string; preset: string } {
    try {
        if (typeof localStorage !== 'undefined') {
            const raw = localStorage.getItem(DATE_RANGE_STORAGE_KEY)
            if (raw) {
                const parsed = JSON.parse(raw) as { from?: string; to?: string; preset?: string }
                if (parsed.from && parsed.to) {
                    return { from: parsed.from, to: parsed.to, preset: parsed.preset ?? '' }
                }
            }
        }
    } catch {
        /* ignore */
    }

    // Default to 24h preset
    const now = new Date()
    return {
        from: toLocalDateTimeString(new Date(now.getTime() - 24 * 60 * 60 * 1000)),
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

const TAB_KEYS = {
    OVERVIEW: 'overview',
    MODELS: 'models',
    CREDENTIALS: 'credentials',
    EVENTS: 'events',
    SETTINGS: 'settings',
} as const

export function UsagePage() {
    const { t }                               = useTranslation()
    const isMobile                            = useMediaQuery('(max-width: 768px)')
    const config                              = useConfigStore((state) => state.config)
    const { authFileMap, authFileMapLoading } = useAuthFileMap()

    // Data hook
    const {
              usage,
              loading,
              error,
              lastRefreshedAt,
              modelPrices,
              setModelPrices,
              loadUsage,
              handleExport,
              handleImport,
              handleImportChange,
              importInputRef,
              exporting,
              importing,
          } = useUsageData()

    useHeaderRefresh(loadUsage)

    // Date range state
    const [dateRange, setDateRange]                     = useState(() => initDateRange())
    const [selectedModels, setSelectedModels]           = useState<string[]>([])
    const [selectedCredentials, setSelectedCredentials] = useState<string[]>([])
    const [chartDimension, setChartDimension]           = useState<ChartDimension>('total')
    const [aliases, setAliases]                         = useState<Record<string, string>>({})
    const [activeTab, setActiveTab]                     = useState<string>(TAB_KEYS.OVERVIEW)
    const [drillDownSearch, setDrillDownSearch]         = useState<string | undefined>()

    // noinspection DuplicatedCode
    useEffect(() => {
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
    }, [])

    // Persist date range
    useEffect(() => {
        try {
            localStorage.setItem(DATE_RANGE_STORAGE_KEY, JSON.stringify(dateRange))
        } catch {
            /* ignore */
        }
    }, [dateRange])

    const handleDateRangeChange = useCallback((from: string, to: string, preset?: string) => {
        setDateRange({ from, to, preset: preset ?? '' })
    }, [])

    // Filtered usage: date range → model/credential selection
    const timeFilteredUsage = useMemo(
        () => (usage ? filterUsageByDateRange(usage, dateRange.from, dateRange.to) : null),
        [usage, dateRange.from, dateRange.to],
    )
    const filteredUsage     = useMemo(
        () =>
            timeFilteredUsage
            ? (filterUsageBySelections(timeFilteredUsage, selectedModels, selectedCredentials) as UsagePayload)
            : null,
        [timeFilteredUsage, selectedModels, selectedCredentials],
    )

    const hourWindowHours = calcHourWindow(dateRange.from, dateRange.to)
    const nowMs           = lastRefreshedAt?.getTime() ?? 0

    // Sparklines
    // Summary API (pre-aggregated data from backend)
    const summaryParams = useMemo(() => ({ from: dateRange.from, to: dateRange.to }), [dateRange.from, dateRange.to])
    const { summary }   = useUsageSummary(summaryParams)

    // Sparklines
    const sparklines = useSparklines({ usage: filteredUsage, loading, nowMs, summary })

    // Chart data — 优先使用 summary 预聚合，credential 维度回退到前端聚合
    const chartData = useChartData({
                                       usage: filteredUsage,
                                       chartLines: DEFAULT_CHART_LINES,
                                       isMobile,
                                       hourWindowHours,
                                       dimension: chartDimension,
                                       aliases,
                                       summary,
                                   })

    // 图表钻取：点击数据点 → 切换到 Events tab 并按模型搜索
    const handleChartDrillDown = useCallback((info: ChartDrillDownInfo) => {
        const search = info.datasetLabel !== 'all' ? info.datasetLabel : ''
        setDrillDownSearch(search || undefined)
        setActiveTab(TAB_KEYS.EVENTS)
    }, [])

    const handleTabChange = useCallback((key: string) => {
        setActiveTab(key)
        if (key !== TAB_KEYS.EVENTS) {
            setDrillDownSearch(undefined)
        }
    }, [])

    // Tab items
    const tabItems = useMemo(
        (): TabItem[] => [
            {
                key: TAB_KEYS.OVERVIEW,
                label: t('usage_stats.tab_overview'),
                icon: <IconLayoutDashboard size={15} />,
            },
            { key: TAB_KEYS.MODELS, label: t('usage_stats.tab_models'), icon: <IconBot size={15} /> },
            {
                key: TAB_KEYS.CREDENTIALS,
                label: t('usage_stats.tab_credentials'),
                icon: <IconKey size={15} />,
            },
            {
                key: TAB_KEYS.EVENTS,
                label: t('usage_stats.tab_events'),
                icon: <IconScrollText size={15} />,
            },
            {
                key: TAB_KEYS.SETTINGS,
                label: t('usage_stats.tab_settings'),
                icon: <IconSettings size={15} />,
            },
        ],
        [t],
    )

    const renderTabContent = (activeKey: string) => {
        switch (activeKey) {
            case TAB_KEYS.OVERVIEW:
                return (
                    <OverviewTab
                        usage={filteredUsage}
                        unfilteredUsage={usage}
                        loading={loading}
                        nowMs={nowMs}
                        sparklines={sparklines}
                        chartData={chartData}
                        isMobile={isMobile}
                        chartDimension={chartDimension}
                        onChartDimensionChange={setChartDimension}
                        onChartDrillDown={handleChartDrillDown}
                        summary={summary}
                    />
                )
            case TAB_KEYS.MODELS:
                return (
                    <ModelsTab
                        usage={filteredUsage}
                        loading={loading}
                        modelPrices={modelPrices}
                        isMobile={isMobile}
                        hourWindowHours={hourWindowHours}
                        onChartDrillDown={handleChartDrillDown}
                        summary={summary}
                    />
                )
            case TAB_KEYS.CREDENTIALS:
                return (
                    <CredentialsTab
                        usage={filteredUsage}
                        loading={loading}
                        authFileMapLoading={authFileMapLoading}
                        modelPrices={modelPrices}
                        geminiKeys={config?.geminiApiKeys || []}
                        claudeConfigs={config?.claudeApiKeys || []}
                        codexConfigs={config?.codexApiKeys || []}
                        vertexConfigs={config?.vertexApiKeys || []}
                        openaiProviders={config?.openaiCompatibility || []}
                        authFileMap={authFileMap}
                        summary={summary}
                    />
                )
            case TAB_KEYS.EVENTS:
                return (
                    <EventsTab
                        usage={filteredUsage}
                        loading={loading}
                        authFileMapLoading={authFileMapLoading}
                        geminiKeys={config?.geminiApiKeys || []}
                        claudeConfigs={config?.claudeApiKeys || []}
                        codexConfigs={config?.codexApiKeys || []}
                        vertexConfigs={config?.vertexApiKeys || []}
                        openaiProviders={config?.openaiCompatibility || []}
                        drillDownSearch={drillDownSearch}
                        authFileMap={authFileMap}
                        dateRange={dateRange}
                    />
                )
            case TAB_KEYS.SETTINGS:
                return <SettingsTab usage={usage} modelPrices={modelPrices} onPricesChange={setModelPrices} />
            default:
                return null
        }
    }

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

            <FilterBar
                usage={usage}
                dateFrom={dateRange.from}
                dateTo={dateRange.to}
                activePreset={dateRange.preset || undefined}
                onDateRangeChange={handleDateRangeChange}
                selectedModels={selectedModels}
                onSelectedModelsChange={setSelectedModels}
                selectedCredentials={selectedCredentials}
                onSelectedCredentialsChange={setSelectedCredentials}
                onExport={handleExport}
                onImport={handleImport}
                onRefresh={() => void loadUsage().catch(() => {
                })}
                loading={loading}
                exporting={exporting}
                importing={importing}
                lastRefreshedAt={lastRefreshedAt}
            />

            <input
                ref={importInputRef}
                type='file'
                accept='.json,application/json'
                style={{ display: 'none' }}
                onChange={handleImportChange}
            />

            {error && <div className={styles.errorBox}>{error}</div>}

            <Tabs items={tabItems} activeKey={activeTab} onChange={handleTabChange}>
                {renderTabContent}
            </Tabs>
        </div>
    )
}
