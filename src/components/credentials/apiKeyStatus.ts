import type {GeminiKeyConfig, OpenAIProviderConfig, ProviderKeyConfig} from '@/types'

type ApiKeyStatusFilter = 'all' | 'available' | 'exhausted' | 'error' | 'disabled'
export type ManualKeyConfig = GeminiKeyConfig | ProviderKeyConfig | OpenAIProviderConfig

export interface ManualKeyCardItem {
    config: ManualKeyConfig
    configIndex: number
    entryIndex?: number
    apiKey: string
    authIndex?: string
    disabled: boolean
}

type RuntimeStatus = {
                         status?: string
                         reason?: string
                     } | null | undefined

export function buildManualKeyCardItems(vendorId: string, values: ManualKeyConfig[]): ManualKeyCardItem[] {
    if (vendorId !== 'openai') {
        return values.map((config, configIndex) => {
            const key = config as GeminiKeyConfig | ProviderKeyConfig
            return {
                config,
                configIndex,
                apiKey: key.apiKey,
                authIndex: key.authIndex,
                disabled: false,
            }
        })
    }

    return values.flatMap((config, configIndex) => {
        const provider = config as OpenAIProviderConfig
        if (provider.apiKeyEntries.length === 0) {
            return [
                {
                    config,
                    configIndex,
                    apiKey: '',
                    authIndex: provider.authIndex,
                    disabled: Boolean(provider.disabled),
                },
            ]
        }
        return provider.apiKeyEntries.map((entry, entryIndex) => ({
            config,
            configIndex,
            entryIndex,
            apiKey: entry.apiKey,
            authIndex: entry.authIndex,
            disabled: Boolean(provider.disabled),
        }))
    })
}

export function apiKeyMatchesStatus(
    value: unknown,
    statusFilter: ApiKeyStatusFilter,
    runtimeStatus?: RuntimeStatus,
): boolean {
    if (statusFilter === 'all') {
        return true
    }

    const configuredDisabled = Boolean(
        value && typeof value === 'object' && 'disabled' in value && (value as { disabled?: unknown }).disabled,
    )
    const disabled           = configuredDisabled || runtimeStatus?.status === 'disabled'
    if (statusFilter === 'disabled') {
        return disabled
    }
    if (disabled) {
        return false
    }
    if (statusFilter === 'exhausted') {
        return runtimeStatus?.reason === 'quota_exceeded'
    }
    if (statusFilter === 'error') {
        return runtimeStatus?.status === 'unavailable' && runtimeStatus.reason !== 'quota_exceeded'
    }
    return runtimeStatus?.status !== 'unavailable'
}

export function filterApiKeysByStatus<T>(
    values: T[],
    statusFilter: ApiKeyStatusFilter,
    runtimeStatus?: (value: T) => RuntimeStatus,
): T[] {
    return values.filter((value) => apiKeyMatchesStatus(value, statusFilter, runtimeStatus?.(value)))
}
