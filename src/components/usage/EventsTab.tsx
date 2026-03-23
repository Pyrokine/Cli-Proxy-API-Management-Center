import type {GeminiKeyConfig, OpenAIProviderConfig, ProviderKeyConfig} from '@/types'
import type {CredentialInfo} from '@/types/sourceInfo'
import {RequestEventsDetailsCard} from './RequestEventsDetailsCard'

interface EventsTabProps {
    usage: unknown;
    loading: boolean;
    authFileMapLoading: boolean;
    geminiKeys: GeminiKeyConfig[];
    claudeConfigs: ProviderKeyConfig[];
    codexConfigs: ProviderKeyConfig[];
    vertexConfigs: ProviderKeyConfig[];
    openaiProviders: OpenAIProviderConfig[];
    drillDownSearch?: string;
    authFileMap: Map<string, CredentialInfo>;
    dateRange: { from: string; to: string };
}

export function EventsTab({
                              usage,
                              loading,
                              authFileMapLoading,
                              geminiKeys,
                              claudeConfigs,
                              codexConfigs,
                              vertexConfigs,
                              openaiProviders,
                              drillDownSearch,
                              authFileMap,
                              dateRange,
                          }: EventsTabProps) {
    return (
        <RequestEventsDetailsCard
            usage={usage}
            loading={loading || authFileMapLoading}
            geminiKeys={geminiKeys}
            claudeConfigs={claudeConfigs}
            codexConfigs={codexConfigs}
            vertexConfigs={vertexConfigs}
            openaiProviders={openaiProviders}
            drillDownSearch={drillDownSearch}
            authFileMap={authFileMap}
            dateRange={dateRange}
        />
    )
}
