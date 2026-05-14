import type { ApiKeyEntry, GeminiKeyConfig, ProviderKeyConfig } from '@/types'
import type { HeaderEntry } from '@/utils/headers'

export interface ModelEntry {
    name: string
    alias: string
}

export interface OpenAIFormState {
    name: string
    priority?: number
    prefix: string
    baseUrl: string
    headers: HeaderEntry[]
    testModel?: string
    modelEntries: ModelEntry[]
    apiKeyEntries: ApiKeyEntry[]
    disabled?: boolean
}

export interface AmpcodeFormState {
    upstreamUrl: string
    upstreamApiKey: string
    forceModelMappings: boolean
    mappingEntries: ModelEntry[]
}

export type GeminiFormState = Omit<GeminiKeyConfig, 'headers' | 'models'> & {
    headers: HeaderEntry[]
    modelEntries: ModelEntry[]
    excludedText: string
}

export type ProviderFormState = Omit<ProviderKeyConfig, 'headers'> & {
    headers: HeaderEntry[]
    modelEntries: ModelEntry[]
    excludedText: string
}

export type VertexFormState = Omit<ProviderKeyConfig, 'headers' | 'excludedModels'> & {
    headers: HeaderEntry[]
    modelEntries: ModelEntry[]
}
