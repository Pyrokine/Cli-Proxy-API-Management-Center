import type { GeminiKeyConfig, OpenAIProviderConfig, ProviderKeyConfig } from '@/types'
import type { CredentialInfo } from '@/types/sourceInfo'
import { RequestEventsDetailsCard } from './RequestEventsDetailsCard'

interface EventsTabProps {
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
    selectedModels?: string[]
    selectedCredentials?: string[]
    selectedApiKeys?: string[]
}

export function EventsTab({
    enabled = true,
    refreshToken,
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
}: EventsTabProps) {
    return (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <RequestEventsDetailsCard
                enabled={enabled}
                refreshToken={refreshToken}
                geminiKeys={geminiKeys}
                claudeConfigs={claudeConfigs}
                codexConfigs={codexConfigs}
                vertexConfigs={vertexConfigs}
                openaiProviders={openaiProviders}
                drillDownSearch={drillDownSearch}
                authFileMap={authFileMap}
                dateRange={dateRange}
                activePreset={activePreset}
                aliases={aliases}
                autoRefreshConfigSeconds={autoRefreshConfigSeconds}
                onVisibleDateRangeChange={onVisibleDateRangeChange}
                selectedModels={selectedModels}
                selectedCredentials={selectedCredentials}
                selectedApiKeys={selectedApiKeys}
            />
        </div>
    )
}
