/**
 * AI 提供商相关类型
 * 基于原项目 src/modules/ai-providers.js
 */

export interface ModelThinking {
    min?: number
    max?: number
    zeroAllowed?: boolean
    dynamicAllowed?: boolean
    levels?: string[]
}

export interface ModelAlias {
    name: string
    alias?: string
    priority?: number
    testModel?: string
    maxContextLength?: number
    thinking?: ModelThinking
    displayName?: string
    forceMapping?: boolean
    isCompat?: boolean
    supportConfigurationUpdate?: boolean
    useMaxCompletionTokens?: boolean
    image?: boolean
    inputModalities?: string[]
    outputModalities?: string[]
}

export interface ApiKeyEntry {
    apiKey: string
    proxyUrl?: string
    headers?: Record<string, string>
    authIndex?: string
    weight?: number
}

export interface CloakConfig {
    mode?: string
    strictMode?: boolean
    sensitiveWords?: string[]
}

export interface CredentialOverrides {
    disableCooling?: boolean
    requestRetry?: number
}

export interface RequestScopedErrorRule {
    status?: number
    match?: string[]
    matchRegex?: string[]
    action?: string
}

export interface GeminiKeyConfig extends CredentialOverrides {
    requestScopedErrors?: RequestScopedErrorRule[]
    apiKey: string
    authIndex?: string
    priority?: number
    weight?: number
    prefix?: string
    baseUrl?: string
    proxyUrl?: string
    models?: ModelAlias[]
    headers?: Record<string, string>
    excludedModels?: string[]
}

export interface ProviderKeyConfig extends CredentialOverrides {
    requestScopedErrors?: RequestScopedErrorRule[]
    apiKey: string
    authIndex?: string
    priority?: number
    weight?: number
    prefix?: string
    baseUrl?: string
    websockets?: boolean
    alphaSearch?: boolean
    disableCodexCloaking?: boolean
    rebuildMidSystemMessage?: boolean
    proxyUrl?: string
    headers?: Record<string, string>
    models?: ModelAlias[]
    excludedModels?: string[]
    cloak?: CloakConfig
    fingerprintProfile?: string
}

export interface OpenAIProviderConfig extends CredentialOverrides {
    requestScopedErrors?: RequestScopedErrorRule[]
    name: string
    prefix?: string
    baseUrl: string
    apiKeyEntries: ApiKeyEntry[]
    headers?: Record<string, string>
    models?: ModelAlias[]
    priority?: number
    testModel?: string
    disabled?: boolean
    supportPromptCacheKey?: boolean
    authIndex?: string

    [key: string]: unknown
}
