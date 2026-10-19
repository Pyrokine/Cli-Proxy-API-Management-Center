import type {ModelEntry} from '@/components/ui/modelInputListUtils'
import type {ApiKeyEntry, CredentialOverrides, GeminiKeyConfig, ProviderKeyConfig, RequestScopedErrorRule} from '@/types'
import type {HeaderEntry} from '@/utils/headers'

export type {ModelEntry} from '@/components/ui/modelInputListUtils'

export interface OpenAIFormState extends CredentialOverrides {
    requestScopedErrors?: RequestScopedErrorRule[]
    name: string
    priority?: number
    prefix: string
    baseUrl: string
    headers: HeaderEntry[]
    authIndex?: string
    modelEntries: ModelEntry[]
    apiKeyEntries: ApiKeyEntry[]
    disabled?: boolean
    supportPromptCacheKey?: boolean
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
