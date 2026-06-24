/**
 * 配置相关类型定义
 * 与基线 /config 返回结构保持一致（内部使用驼峰形式）
 */

import type {AmpcodeConfig} from './ampcode'
import type {GeminiKeyConfig, OpenAIProviderConfig, ProviderKeyConfig} from './provider'

export interface QuotaExceededConfig {
    switchProject?: boolean
    switchPreviewModel?: boolean
    antigravityCredits?: boolean
}

export interface RemoteManagementConfig {
    allowRemote?: boolean
    secretKey?: string
    disableControlPanel?: boolean
    autoUpdatePanel?: boolean
    autoUpdateCPA?: boolean
    autoCheckUpdate?: boolean
    checkInterval?: number
    panelGithubRepository?: string
    cpaGithubRepository?: string
}

export interface UsageRetentionConfig {
    days?: number
    maxDbSizeMb?: number
    warningThresholdPct?: number
}

export interface QuotaRefreshConfig {
    enabled?: boolean
    interval?: number
    maxInterval?: number
}

export interface PluginInstanceConfig {
    enabled?: boolean
    priority?: number

    [key: string]: unknown
}

export interface PluginsConfig {
    enabled?: boolean
    dir?: string
    configs?: Record<string, PluginInstanceConfig>
}

export interface Config {
    debug?: boolean
    proxyUrl?: string
    requestRetry?: number
    quotaExceeded?: QuotaExceededConfig
    usageStatisticsEnabled?: boolean
    requestLog?: boolean
    loggingToFile?: boolean
    logsMaxTotalSizeMb?: number
    errorLogsMaxFiles?: number
    usageRetention?: UsageRetentionConfig
    wsAuth?: boolean
    forceModelPrefix?: boolean
    routingStrategy?: string
    routingSessionAffinity?: boolean
    routingSessionAffinityTTL?: string
    apiKeys?: string[]
    ampcode?: AmpcodeConfig
    geminiApiKeys?: GeminiKeyConfig[]
    codexApiKeys?: ProviderKeyConfig[]
    claudeApiKeys?: ProviderKeyConfig[]
    vertexApiKeys?: ProviderKeyConfig[]
    openaiCompatibility?: OpenAIProviderConfig[]
    oauthExcludedModels?: Record<string, string[]>
    autoRefreshInterval?: number
    modelRefreshInterval?: number
    quotaRefresh?: QuotaRefreshConfig
    remoteManagement?: RemoteManagementConfig
    plugins?: PluginsConfig
    raw?: Record<string, unknown>
}

export type RawConfigSection =
    | 'debug'
    | 'proxy-url'
    | 'request-retry'
    | 'quota-exceeded'
    | 'usage-statistics-enabled'
    | 'request-log'
    | 'logging-to-file'
    | 'logs-max-total-size-mb'
    | 'error-logs-max-files'
    | 'usage-retention'
    | 'ws-auth'
    | 'force-model-prefix'
    | 'routing/strategy'
    | 'api-keys'
    | 'ampcode'
    | 'gemini-api-key'
    | 'codex-api-key'
    | 'claude-api-key'
    | 'vertex-api-key'
    | 'openai-compatibility'
    | 'oauth-excluded-models'
    | 'auto-refresh-interval'
    | 'model-refresh-interval'
    | 'quota-refresh'
    | 'remote-management'
    | 'plugins'
