import styles from '@/pages/UsagePage.module.scss'
import type {UsageSummary} from '@/services/api/usage'
import type {GeminiKeyConfig, OpenAIProviderConfig, ProviderKeyConfig} from '@/types'
import type {CredentialInfo} from '@/types/sourceInfo'
import {getApiStats, type ModelPrice} from '@/utils/usage'
import {useMemo} from 'react'
import {ApiDetailsCard} from './ApiDetailsCard'
import {CredentialStatsCard} from './CredentialStatsCard'
import type {UsagePayload} from './hooks/useUsageData'

interface CredentialsTabProps {
    usage: UsagePayload | null;
    loading: boolean;
    authFileMapLoading: boolean;
    modelPrices: Record<string, ModelPrice>;
    geminiKeys: GeminiKeyConfig[];
    claudeConfigs: ProviderKeyConfig[];
    codexConfigs: ProviderKeyConfig[];
    vertexConfigs: ProviderKeyConfig[];
    openaiProviders: OpenAIProviderConfig[];
    authFileMap: Map<string, CredentialInfo>;
    summary?: UsageSummary | null;
}

export function CredentialsTab({
                                   usage,
                                   loading,
                                   authFileMapLoading,
                                   modelPrices,
                                   geminiKeys,
                                   claudeConfigs,
                                   codexConfigs,
                                   vertexConfigs,
                                   openaiProviders,
                                   authFileMap,
                                   summary,
                               }: CredentialsTabProps) {
    const apiStats        = useMemo(() => getApiStats(usage, modelPrices), [usage, modelPrices])
    const hasPrices       = Object.keys(modelPrices).length > 0
    const combinedLoading = loading || authFileMapLoading

    return (
        <>
            <CredentialStatsCard
                usage={usage}
                loading={combinedLoading}
                geminiKeys={geminiKeys}
                claudeConfigs={claudeConfigs}
                codexConfigs={codexConfigs}
                vertexConfigs={vertexConfigs}
                openaiProviders={openaiProviders}
                authFileMap={authFileMap}
                summary={summary}
            />
            <div className={styles.detailsGrid}>
                <ApiDetailsCard apiStats={apiStats} loading={loading} hasPrices={hasPrices} />
            </div>
        </>
    )
}
