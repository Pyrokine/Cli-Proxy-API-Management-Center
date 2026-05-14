export type PayloadParamValueType = 'string' | 'number' | 'boolean' | 'json'
export type PayloadParamValidationErrorCode =
    | 'payload_invalid_number'
    | 'payload_invalid_boolean'
    | 'payload_invalid_json'

export type VisualConfigFieldPath =
    | 'port'
    | 'logsMaxTotalSizeMb'
    | 'requestRetry'
    | 'maxRetryCredentials'
    | 'maxRetryInterval'
    | 'streaming.keepaliveSeconds'
    | 'streaming.bootstrapRetries'
    | 'streaming.nonstreamKeepaliveInterval'

export type VisualConfigValidationErrorCode = 'port_range' | 'non_negative_integer'

export type VisualConfigValidationErrors = Partial<Record<VisualConfigFieldPath, VisualConfigValidationErrorCode>>

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

export type VisualConfigValues = {
    host: string
    port: string
    tlsEnable: boolean
    tlsCert: string
    tlsKey: string
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
    apiKeysText: string
    debug: boolean
    commercialMode: boolean
    loggingToFile: boolean
    logsMaxTotalSizeMb: string
    usageStatisticsEnabled: boolean
    proxyUrl: string
    forceModelPrefix: boolean
    requestRetry: string
    maxRetryCredentials: string
    maxRetryInterval: string
    quotaSwitchProject: boolean
    quotaSwitchPreviewModel: boolean
    routingStrategy: 'round-robin' | 'fill-first'
    routingSessionAffinity: boolean
    routingSessionAffinityTTL: string
    wsAuth: boolean
    allowQueryAuth: boolean
    corsAllowedOrigins: string
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
    apiKeysText: '',
    debug: false,
    commercialMode: false,
    loggingToFile: false,
    logsMaxTotalSizeMb: '',
    usageStatisticsEnabled: false,
    proxyUrl: '',
    forceModelPrefix: false,
    requestRetry: '',
    maxRetryCredentials: '',
    maxRetryInterval: '',
    quotaSwitchProject: true,
    quotaSwitchPreviewModel: true,
    routingStrategy: 'round-robin',
    routingSessionAffinity: false,
    routingSessionAffinityTTL: '',
    wsAuth: true,
    allowQueryAuth: false,
    corsAllowedOrigins: '',
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
