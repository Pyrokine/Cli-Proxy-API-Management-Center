import type {GeminiKeyConfig, OpenAIProviderConfig, ProviderKeyConfig} from '@/types'
import {hasExcludedModelRule} from '@/utils/excludedModels'

type ApiKeyStatusFilter = 'all' | 'available' | 'exhausted' | 'error' | 'disabled' | 'problem' | 'disabled-problem'
export type ManualKeyConfig = GeminiKeyConfig | ProviderKeyConfig | OpenAIProviderConfig

export interface ManualKeyCardItem {
    config: ManualKeyConfig
    configIndex: number
    entryIndex?: number
    apiKey: string
    aliasRef?: string
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
                ...(key.aliasRef ? { aliasRef: key.aliasRef } : {}),
                authIndex: key.authIndex,
                disabled: hasExcludedModelRule(key.excludedModels ?? [], '*'),
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
            ...(entry.aliasRef ? { aliasRef: entry.aliasRef } : {}),
            authIndex: entry.authIndex,
            disabled: Boolean(provider.disabled || entry.disabled),
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

    const configuredDisabled = value && typeof value === 'object' && 'disabled' in value ? value.disabled : undefined
    const disabled           = typeof configuredDisabled === 'boolean' ?
                               configuredDisabled :
                               runtimeStatus?.status === 'disabled'
    if (statusFilter === 'problem' || statusFilter === 'disabled-problem') {
        const hasProblem = runtimeStatus?.status === 'unavailable' && Boolean(runtimeStatus.reason)
        return hasProblem && (statusFilter !== 'disabled-problem' || disabled)
    }
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
