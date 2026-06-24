export type PayloadParamValueType = 'string' | 'number' | 'boolean' | 'json'
export type PayloadParamValidationErrorCode =
    | 'payload_invalid_number'
    | 'payload_invalid_boolean'
    | 'payload_invalid_json'

export type VisualConfigFieldPath =
    | 'port'
    | 'tlsHttpRedirectPort'
    | 'logsMaxTotalSizeMb'
    | 'errorLogsMaxFiles'
    | 'redisUsageQueueRetentionSeconds'
    | 'authAutoRefreshWorkers'
    | 'usageRetentionDays'
    | 'usageRetentionMaxDbSizeMb'
    | 'usageRetentionWarningThresholdPct'
    | 'autoRefreshInterval'
    | 'modelRefreshInterval'
    | 'requestRetry'
    | 'maxRetryCredentials'
    | 'maxRetryInterval'
    | 'quotaRefreshInterval'
    | 'quotaRefreshMaxInterval'
    | 'streaming.keepaliveSeconds'
    | 'streaming.bootstrapRetries'
    | 'streaming.nonstreamKeepaliveInterval'

export type VisualConfigValidationErrorCode =
    | 'port_range'
    | 'non_negative_integer'
    | 'quota_refresh_interval_range'
    | 'quota_refresh_max_interval_range'

export type VisualConfigValidationErrors = Partial<Record<VisualConfigFieldPath, VisualConfigValidationErrorCode>>

export type VisualConfigLogSizeInfo =
    | { status: 'loading' }
    | { status: 'error' }
    | { status: 'ready'; totalBytes: number; fileCount: number }

export type VisualConfigUsageDbSizeInfo =
    | { status: 'loading' }
    | { status: 'error' }
    | {
          status: 'ready'
          sizeBytes: number
          maxSizeBytes?: number
          warningThresholdPct?: number
          warning?: boolean
          capped?: boolean
      }

export type VisualConfigRuntimeInfo = {
    logSize: VisualConfigLogSizeInfo
    usageDbSize: VisualConfigUsageDbSizeInfo
}

export type PayloadParamEntry = {
    id: string
    path: string
    valueType: PayloadParamValueType
    value: string
}

export type PayloadModelEntry = {
    id: string
    name: string
    protocol?: string
}

export type PayloadRule = {
    id: string
    models: PayloadModelEntry[]
    params: PayloadParamEntry[]
}

export type PayloadFilterRule = {
    id: string
    models: PayloadModelEntry[]
    params: string[]
}

export interface StreamingConfig {
    keepaliveSeconds: string
    bootstrapRetries: string
    nonstreamKeepaliveInterval: string
}

export type ApiKeyModelRule = {
    blockedModels: string[]
}

export type VisualConfigValues = {
    host: string
    port: string
    tlsEnable: boolean
    tlsCert: string
    tlsKey: string
    tlsHttpRedirectPort: string
    tlsRequireForAuth: boolean
    tlsTrustForwardedProto: boolean
    rmAllowRemote: boolean
    rmSecretKey: string
    rmDisableControlPanel: boolean
    rmAutoUpdatePanel: boolean
    rmAutoUpdateCPA: boolean
    rmAutoCheckUpdate: boolean
    rmCheckInterval: string
    rmPanelRepo: string
    rmCpaRepo: string
    authDir: string
    usageDataDir: string
    usageStatisticsFile: string
    pluginsEnabled: boolean
    pluginsDir: string
    pluginConfigsText: string
    apiKeysText: string
    apiKeyAliasesText: string
    apiKeyRules: Record<string, ApiKeyModelRule>
    debug: boolean
    commercialMode: boolean
    loggingToFile: boolean
    requestLog: boolean
    pprofEnable: boolean
    pprofAddr: string
    logsMaxTotalSizeMb: string
    errorLogsMaxFiles: string
    redisUsageQueueRetentionSeconds: string
    usageStatisticsEnabled: boolean
    usageRetentionDays: string
    usageRetentionMaxDbSizeMb: string
    usageRetentionWarningThresholdPct: string
    autoRefreshInterval: string
    modelRefreshInterval: string
    proxyUrl: string
    forceModelPrefix: boolean
    enableGeminiCliEndpoint: boolean
    passthroughHeaders: boolean
    disableImageGeneration: 'off' | 'all' | 'chat'
    gptImage2BaseModel: string
    authAutoRefreshWorkers: string
    requestRetry: string
    maxRetryCredentials: string
    maxRetryInterval: string
    quotaSwitchProject: boolean
    quotaSwitchPreviewModel: boolean
    quotaAntigravityCredits: boolean
    disableCooling: boolean
    quotaRefreshEnabled: boolean
    quotaRefreshInterval: string
    quotaRefreshMaxInterval: string
    routingStrategy: 'round-robin' | 'fill-first'
    routingSessionAffinity: boolean
    routingSessionAffinityTTL: string
    wsAuth: boolean
    allowQueryAuth: boolean
    corsAllowedOrigins: string
    providerConfigText: string
    oauthExcludedModelsText: string
    oauthModelAliasText: string
    codexIdentityConfuse: boolean
    codexHeaderDefaultsText: string
    claudeHeaderDefaultsText: string
    ampcodeText: string
    payloadDefaultRules: PayloadRule[]
    payloadDefaultRawRules: PayloadRule[]
    payloadOverrideRules: PayloadRule[]
    payloadOverrideRawRules: PayloadRule[]
    payloadFilterRules: PayloadFilterRule[]
    streaming: StreamingConfig
}

export const makeClientId = () => {
    if (typeof globalThis.crypto?.randomUUID === 'function') {
        return globalThis.crypto.randomUUID()
    }
    return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

export const DEFAULT_VISUAL_VALUES: VisualConfigValues = {
    host: '',
    port: '',
    tlsEnable: false,
    tlsCert: '',
    tlsKey: '',
    tlsHttpRedirectPort: '',
    tlsRequireForAuth: false,
    tlsTrustForwardedProto: false,
    rmAllowRemote: false,
    rmSecretKey: '',
    rmDisableControlPanel: false,
    rmAutoUpdatePanel: false,
    rmAutoUpdateCPA: false,
    rmAutoCheckUpdate: false,
    rmCheckInterval: '',
    rmPanelRepo: '',
    rmCpaRepo: '',
    authDir: '',
    usageDataDir: '',
    usageStatisticsFile: '',
    pluginsEnabled: false,
    pluginsDir: 'plugins',
    pluginConfigsText: '',
    apiKeysText: '',
    apiKeyAliasesText: '',
    apiKeyRules: {},
    debug: false,
    commercialMode: false,
    loggingToFile: false,
    requestLog: false,
    pprofEnable: false,
    pprofAddr: '',
    logsMaxTotalSizeMb: '',
    errorLogsMaxFiles: '',
    redisUsageQueueRetentionSeconds: '',
    usageStatisticsEnabled: false,
    usageRetentionDays: '',
    usageRetentionMaxDbSizeMb: '',
    usageRetentionWarningThresholdPct: '',
    autoRefreshInterval: '',
    modelRefreshInterval: '',
    proxyUrl: '',
    forceModelPrefix: false,
    enableGeminiCliEndpoint: false,
    passthroughHeaders: false,
    disableImageGeneration: 'off',
    gptImage2BaseModel: '',
    authAutoRefreshWorkers: '',
    requestRetry: '',
    maxRetryCredentials: '',
    maxRetryInterval: '',
    quotaSwitchProject: true,
    quotaSwitchPreviewModel: true,
    quotaAntigravityCredits: false,
    disableCooling: false,
    quotaRefreshEnabled: false,
    quotaRefreshInterval: '',
    quotaRefreshMaxInterval: '',
    routingStrategy: 'round-robin',
    routingSessionAffinity: false,
    routingSessionAffinityTTL: '',
    wsAuth: true,
    allowQueryAuth: false,
    corsAllowedOrigins: '',
    providerConfigText: '',
    oauthExcludedModelsText: '',
    oauthModelAliasText: '',
    codexIdentityConfuse: false,
    codexHeaderDefaultsText: '',
    claudeHeaderDefaultsText: '',
    ampcodeText: '',
    payloadDefaultRules: [],
    payloadDefaultRawRules: [],
    payloadOverrideRules: [],
    payloadOverrideRawRules: [],
    payloadFilterRules: [],
    streaming: {
        keepaliveSeconds: '',
        bootstrapRetries: '',
        nonstreamKeepaliveInterval: '',
    },
}
