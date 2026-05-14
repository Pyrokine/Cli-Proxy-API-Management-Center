import type { UsageSummary } from '@/services/api/usage'
import type { GeminiKeyConfig, OpenAIProviderConfig, ProviderKeyConfig } from '@/types'
import type { CredentialInfo } from '@/types/sourceInfo'
import type { ChartDimension, ModelPrice } from '@/utils/usage'
import { summaryToApiKeyStats, summaryToModelStats } from '@/utils/usage/summaryHelpers'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { CredentialStatsCard } from './CredentialStatsCard'
import type { UsagePayload } from './hooks/useUsageData'
import { ModelStatsCard } from './ModelStatsCard'
import styles from './OverviewTab.module.scss'
import { ServiceHealthCard } from './ServiceHealthCard'
import { TokenBreakdownChart } from './TokenBreakdownChart'
import { UnifiedTrendChart } from './UnifiedTrendChart'

export interface CredentialContext {
    loading: boolean
    geminiKeys: GeminiKeyConfig[]
    claudeConfigs: ProviderKeyConfig[]
    codexConfigs: ProviderKeyConfig[]
    vertexConfigs: ProviderKeyConfig[]
    openaiProviders: OpenAIProviderConfig[]
    authFileMap: Map<string, CredentialInfo>
}

interface OverviewTabProps {
    usage: UsagePayload | null
    loading: boolean
    usageLoading?: boolean
    summaryError?: string
    heatmapLoading?: boolean
    heatmapError?: string
    heatmapReady?: boolean
    isMobile: boolean
    chartDimension: ChartDimension
    summary?: UsageSummary | null
    heatmapSummary?: UsageSummary | null
    fromMs: number
    toMs: number
    modelPrices?: Record<string, ModelPrice>
    credentials?: CredentialContext
    aliases?: Record<string, string>
    /** Refresh handler propagated to ServiceHealthCard so the user can pull
     *  fresh time_series without scrolling back to the top filter bar. */
    onRefresh?: () => void
    refreshing?: boolean
}

export function OverviewTab({
    usage,
    loading,
    usageLoading,
    summaryError,
    heatmapLoading,
    heatmapError,
    heatmapReady,
    isMobile,
    chartDimension,
    summary,
    heatmapSummary,
    fromMs,
    toMs,
    modelPrices,
    credentials,
    aliases,
    onRefresh,
    refreshing,
}: OverviewTabProps) {
    const { t } = useTranslation()

    const modelStats = useMemo(() => {
        if (summary?.by_model && Object.keys(summary.by_model).length > 0) {
            return summaryToModelStats(summary.by_model)
        }
        return []
    }, [summary])

    const apiKeyStats = useMemo(() => {
        if (summary?.by_api_key && Object.keys(summary.by_api_key).length > 0) {
            return summaryToApiKeyStats(summary.by_api_key, aliases)
        }
        return []
    }, [summary, aliases])

    const hasPrices = modelPrices ? Object.keys(modelPrices).length > 0 : false
    const hasCredentialData = !!summary?.by_credential && Object.keys(summary.by_credential).length > 0

    return (
        <>
            {/* Three metrics side by side */}
            <div className={styles.metricsGrid}>
                <UnifiedTrendChart
                    summary={summary ?? null}
                    loading={loading}
                    error={summaryError}
                    chartDimension={chartDimension}
                    isMobile={isMobile}
                    metric="requests"
                />
                <UnifiedTrendChart
                    summary={summary ?? null}
                    loading={loading}
                    error={summaryError}
                    chartDimension={chartDimension}
                    isMobile={isMobile}
                    metric="tokens"
                />
                <UnifiedTrendChart
                    summary={summary ?? null}
                    loading={loading}
                    error={summaryError}
                    chartDimension={chartDimension}
                    isMobile={isMobile}
                    metric="cost"
                />
            </div>

            <ServiceHealthCard
                loading={heatmapLoading ?? loading}
                summary={heatmapReady ? heatmapSummary : null}
                fromMs={fromMs}
                toMs={toMs}
                error={heatmapError}
                onRefresh={onRefresh}
                refreshing={refreshing}
            />

            {modelStats.length > 0 && (
                <ModelStatsCard modelStats={modelStats} loading={loading} hasPrices={hasPrices} />
            )}

            {apiKeyStats.length > 0 && (
                <ModelStatsCard
                    modelStats={apiKeyStats}
                    loading={loading}
                    hasPrices={hasPrices}
                    nameHeader={t('usage_stats.api_key')}
                    cardTitle={t('usage_stats.api_key_stats')}
                />
            )}

            {hasCredentialData && credentials?.authFileMap && (
                <CredentialStatsCard
                    usage={usage}
                    loading={(usageLoading ?? loading) || credentials.loading}
                    geminiKeys={credentials.geminiKeys}
                    claudeConfigs={credentials.claudeConfigs}
                    codexConfigs={credentials.codexConfigs}
                    vertexConfigs={credentials.vertexConfigs}
                    openaiProviders={credentials.openaiProviders}
                    authFileMap={credentials.authFileMap}
                    summary={summary}
                    aliases={aliases}
                />
            )}

            <TokenBreakdownChart summary={summary ?? null} loading={loading} isMobile={isMobile} />
        </>
    )
}
