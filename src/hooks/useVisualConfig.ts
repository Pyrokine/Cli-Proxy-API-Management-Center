import type {
    PayloadFilterRule,
    PayloadParamEntry,
    PayloadParamValidationErrorCode,
    PayloadParamValueType,
    PayloadRule,
    VisualConfigValidationErrorCode,
    VisualConfigValidationErrors,
    VisualConfigValues,
} from '@/types/visualConfig'
import {DEFAULT_VISUAL_VALUES} from '@/types/visualConfig'
import {parseGoDuration, parsePositiveGoDuration} from '@/utils/apiKeyPolicy'
import {useCallback, useMemo, useRef, useState} from 'react'
import {
    type ApiKeysStorageMetadata,
    areVisualConfigValuesEqual,
    decodeVisualConfigYaml,
    DEFAULT_API_KEYS_STORAGE_METADATA,
    encodeVisualConfigYaml,
    integerFieldValue,
    parseVisualConfigInteger,
    VISUAL_INTEGER_FIELDS,
    updateApiKeysStorageMetadata,
} from './visualConfigCodec'

export {hasImageArtifactCacheChanges} from './visualConfigCodec'

function deepClone<T>(value: T): T {
    if (typeof structuredClone === 'function') {
        return structuredClone(value)
    }
    return JSON.parse(JSON.stringify(value)) as T
}

function getNonNegativeIntegerError(value: string): VisualConfigValidationErrorCode | undefined {
    try {
        parseVisualConfigInteger(value)
        return undefined
    } catch {
        return 'non_negative_integer'
    }
}

function parseOptionalInteger(value: string): number | undefined {
    try {
        return parseVisualConfigInteger(value)
    } catch {
        return undefined
    }
}

function isLiteralIP(value: string): boolean {
    const ip = value.trim()
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip)) {
        return ip.split('.').every((part) => (part.length === 1 || !part.startsWith('0')) && Number(part) <= 255)
    }
    if (!ip.includes(':') || !/^[\da-f:.]+$/i.test(ip)) {
        return false
    }
    try {
        return new URL(`http://[${ip}]/`).hostname.startsWith('[')
    } catch {
        return false
    }
}

function isValidIceServerUrl(value: string): boolean {
    const url = value.trim()
    if (!/^(stun|stuns|turn|turns):/i.test(url) || /\s|%(?![\da-f]{2})/i.test(url)) {
        return false
    }
    try {
        new URL(url)
        return true
    } catch {
        return false
    }
}

function getQuotaRefreshIntervalError(values: VisualConfigValues): VisualConfigValidationErrorCode | undefined {
    const baseError = getNonNegativeIntegerError(values.quotaRefreshInterval)
    if (baseError || !values.quotaRefreshEnabled) {
        return baseError
    }
    const interval = parseOptionalInteger(values.quotaRefreshInterval) ?? 600
    if (interval < 60) {
        return 'quota_refresh_interval_range'
    }
    return undefined
}

function getQuotaRefreshMaxIntervalError(values: VisualConfigValues): VisualConfigValidationErrorCode | undefined {
    const baseError = getNonNegativeIntegerError(values.quotaRefreshMaxInterval)
    if (baseError || !values.quotaRefreshEnabled) {
        return baseError
    }
    const interval    = parseOptionalInteger(values.quotaRefreshInterval) ?? 600
    const maxInterval = parseOptionalInteger(values.quotaRefreshMaxInterval) ?? 1800
    if (maxInterval < 300 || maxInterval < interval) {
        return 'quota_refresh_max_interval_range'
    }
    return undefined
}

export function getVisualConfigValidationErrors(
    values: VisualConfigValues,
    baseline?: VisualConfigValues,
): VisualConfigValidationErrors {
    const errors: VisualConfigValidationErrors = {}
    for (const [field, contract] of Object.entries(VISUAL_INTEGER_FIELDS)) {
        try {
            parseVisualConfigInteger(integerFieldValue(values, field), contract.minimum, contract.maximum)
        } catch {
            errors[field as keyof VisualConfigValidationErrors] = field === 'port'
                ? 'port_range'
                : field === 'redisUsageQueueRetentionSeconds'
                  ? 'integer_range_1_3600'
                  : field === 'codexLiveMediaRelayUDPPortMin' || field === 'codexLiveMediaRelayUDPPortMax'
                    ? 'integer_range_0_65535'
                    : contract.minimum < 0 || contract.maximum < Number.MAX_SAFE_INTEGER
                      ? 'payload_invalid_number'
                      : 'non_negative_integer'
        }
    }
    errors.quotaRefreshInterval = getQuotaRefreshIntervalError(values)
    errors.quotaRefreshMaxInterval = getQuotaRefreshMaxIntervalError(values)
    const ttl = values.videoResultAuthCacheTTL.trim()
    if (ttl && (!baseline || values.videoResultAuthCacheTTL !== baseline.videoResultAuthCacheTTL) &&
        parsePositiveGoDuration(ttl) === null) {
        errors.videoResultAuthCacheTTL = 'positive_duration'
    }
    const idleTimeout = values.antigravityConnectionPoolIdleTimeout.trim()
    if (idleTimeout && (!baseline || idleTimeout !== baseline.antigravityConnectionPoolIdleTimeout.trim()) &&
        parseGoDuration(idleTimeout) === null) {
        errors.antigravityConnectionPoolIdleTimeout = 'invalid_duration'
    }
    if (!values.codexLiveMediaRelayEnabled) {
        return errors
    }
    const maxSessions = Number(values.codexLiveMediaRelayMaxSessions || 0)
    if (!errors.codexLiveMediaRelayMaxSessions && maxSessions < 0) {
        errors.codexLiveMediaRelayMaxSessions = 'non_negative_integer'
    }
    const publicIP = values.codexLiveMediaRelayPublicIP.trim()
    if (publicIP && !isLiteralIP(publicIP)) {
        errors.codexLiveMediaRelayPublicIP = 'invalid_ip'
    }
    if (!errors.codexLiveMediaRelayUDPPortMin && !errors.codexLiveMediaRelayUDPPortMax) {
        const min = Number(values.codexLiveMediaRelayUDPPortMin || 0)
        const max = Number(values.codexLiveMediaRelayUDPPortMax || 0)
        if ((min === 0) !== (max === 0) || min > max) {
            errors.codexLiveMediaRelayUDPPortMin = 'udp_port_pair'
            errors.codexLiveMediaRelayUDPPortMax = 'udp_port_pair'
        } else if (min > 0 && !errors.codexLiveMediaRelayMaxSessions &&
                   max - min + 1 < (maxSessions || 32) * 2) {
            errors.codexLiveMediaRelayUDPPortMin = 'udp_port_capacity'
            errors.codexLiveMediaRelayUDPPortMax = 'udp_port_capacity'
        }
    }
    if (values.codexLiveMediaRelayICEServers.some((server) => {
        const urls = server.urlsText.split(/\r?\n/).map((url) => url.trim()).filter(Boolean)
        return urls.length === 0 || urls.some((url) => !isValidIceServerUrl(url))
    })) {
        errors.codexLiveMediaRelayICEServers = 'invalid_ice_servers'
    }
    return errors
}

export function getPayloadParamValidationError(param: PayloadParamEntry): PayloadParamValidationErrorCode | undefined {
    const trimmedValue = param.value.trim()
    if (!trimmedValue) {
        if (param.valueType === 'boolean') {
            return 'payload_invalid_boolean'
        }
        if (param.valueType === 'json') {
            return 'payload_invalid_json'
        }
        return undefined
    }

    if (param.valueType === 'number') {
        const parsed = Number(trimmedValue)
        if (!Number.isFinite(parsed) || (Number.isInteger(parsed) && !Number.isSafeInteger(parsed))) {
            return 'payload_invalid_number'
        }
    }

    if (param.valueType === 'boolean') {
        if (trimmedValue !== 'true' && trimmedValue !== 'false') {
            return 'payload_invalid_boolean'
        }
    }

    if (param.valueType === 'json') {
        try {
            JSON.parse(trimmedValue)
        } catch {
            return 'payload_invalid_json'
        }
    }

    return undefined
}

function hasPayloadParamValidationErrors(rules: Array<PayloadRule | PayloadFilterRule>): boolean {
    const invalid = (param: PayloadParamEntry) => Boolean(param.path.trim()) && getPayloadParamValidationError(param) !== undefined
    return rules.some((rule) =>
        rule.params.some((param) => typeof param !== 'string' && invalid(param)) ||
        rule.models.some((model) => (model.match ?? []).some(invalid) || (model.notMatch ?? []).some(invalid)),
    )
}

export function useVisualConfig() {
    const [visualValues, setVisualValuesState]    = useState<VisualConfigValues>({
                                                                                     ...DEFAULT_VISUAL_VALUES,
                                                                                 })
    const [baselineValues, setBaselineValues]     = useState<VisualConfigValues>({
                                                                                     ...DEFAULT_VISUAL_VALUES,
                                                                                 })
    const [baselineYaml, setBaselineYaml]         = useState('')
    const [apiKeysStorage, setApiKeysStorage]     = useState<ApiKeysStorageMetadata>(DEFAULT_API_KEYS_STORAGE_METADATA)
    const apiKeysTextRef                          = useRef(DEFAULT_VISUAL_VALUES.apiKeysText)
    const [visualParseError, setVisualParseError] = useState<string | null>(null)

    const validationErrors                 = useMemo(
        () => getVisualConfigValidationErrors(visualValues, baselineValues),
        [visualValues, baselineValues],
    )
    const visualHasValidationErrors        = useMemo(
        () => Object.values(validationErrors).some(Boolean),
        [validationErrors],
    )
    const visualHasPayloadValidationErrors = useMemo(
        () =>
            hasPayloadParamValidationErrors(visualValues.payloadDefaultRules) ||
            hasPayloadParamValidationErrors(visualValues.payloadDefaultRawRules) ||
            hasPayloadParamValidationErrors(visualValues.payloadOverrideRules) ||
            hasPayloadParamValidationErrors(visualValues.payloadOverrideRawRules) ||
            hasPayloadParamValidationErrors(visualValues.payloadFilterRules),
        [
            visualValues.payloadDefaultRules,
            visualValues.payloadDefaultRawRules,
            visualValues.payloadOverrideRules,
            visualValues.payloadOverrideRawRules,
            visualValues.payloadFilterRules,
        ],
    )
    const visualDirty                      = useMemo(
        () => !areVisualConfigValuesEqual(visualValues, baselineValues),
        [baselineValues, visualValues],
    )

    const loadVisualValuesFromYaml = useCallback((yamlContent: string, apiKeysSourceYaml: string = yamlContent) => {
        try {
            const decoded          = decodeVisualConfigYaml(yamlContent, apiKeysSourceYaml)
            apiKeysTextRef.current = decoded.values.apiKeysText
            setVisualValuesState(decoded.values)
            setBaselineValues(deepClone(decoded.values))
            setBaselineYaml(yamlContent)
            setApiKeysStorage(decoded.apiKeysStorage)
            setVisualParseError(null)
            return { ok: true as const }
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Invalid YAML'
            setVisualParseError(message)
            return { ok: false as const, error: message }
        }
    }, [])

    const applyVisualChangesToYaml = useCallback(
        (currentYaml: string): string =>
            encodeVisualConfigYaml(currentYaml, visualValues, baselineValues, apiKeysStorage, baselineYaml),
        [apiKeysStorage, baselineValues, baselineYaml, visualValues],
    )

    const setVisualValues = useCallback((newValues: Partial<VisualConfigValues>) => {
        if (newValues.apiKeysText !== undefined && newValues.apiKeysText !== apiKeysTextRef.current) {
            const previousText     = apiKeysTextRef.current
            apiKeysTextRef.current = newValues.apiKeysText
            setApiKeysStorage((metadata) =>
                                  updateApiKeysStorageMetadata(metadata, previousText, newValues.apiKeysText!),
            )
        }
        setVisualValuesState((prev) => {
            const next: VisualConfigValues = { ...prev, ...newValues } as VisualConfigValues
            if (newValues.streaming) {
                next.streaming = { ...prev.streaming, ...newValues.streaming }
            }
            return next
        })
    }, [])

    return {
        visualValues,
        visualDirty,
        visualParseError,
        validationErrors,
        visualHasValidationErrors,
        visualHasPayloadValidationErrors,
        loadVisualValuesFromYaml,
        applyVisualChangesToYaml,
        setVisualValues,
    }
}

export const VISUAL_CONFIG_PROTOCOL_OPTIONS = [
    {
        value: '',
        labelKey: 'config_management.visual.payload_rules.provider_default',
        defaultLabel: 'Default',
    },
    {
        value: 'openai',
        labelKey: 'config_management.visual.payload_rules.provider_openai',
        defaultLabel: 'OpenAI',
    },
    {
        value: 'openai-response',
        labelKey: 'config_management.visual.payload_rules.provider_openai_response',
        defaultLabel: 'OpenAI Response',
    },
    {
        value: 'gemini',
        labelKey: 'config_management.visual.payload_rules.provider_gemini',
        defaultLabel: 'Gemini',
    },
    {
        value: 'claude',
        labelKey: 'config_management.visual.payload_rules.provider_claude',
        defaultLabel: 'Claude',
    },
    {
        value: 'codex',
        labelKey: 'config_management.visual.payload_rules.provider_codex',
        defaultLabel: 'Codex',
    },
    {
        value: 'antigravity',
        labelKey: 'config_management.visual.payload_rules.provider_antigravity',
        defaultLabel: 'Antigravity',
    },
] as const

export const VISUAL_CONFIG_PAYLOAD_VALUE_TYPE_OPTIONS = [
    {
        value: 'string',
        labelKey: 'config_management.visual.payload_rules.value_type_string',
        defaultLabel: 'String',
    },
    {
        value: 'number',
        labelKey: 'config_management.visual.payload_rules.value_type_number',
        defaultLabel: 'Number',
    },
    {
        value: 'boolean',
        labelKey: 'config_management.visual.payload_rules.value_type_boolean',
        defaultLabel: 'Boolean',
    },
    {
        value: 'json',
        labelKey: 'config_management.visual.payload_rules.value_type_json',
        defaultLabel: 'JSON',
    },
] as const satisfies ReadonlyArray<{
    value: PayloadParamValueType
    labelKey: string
    defaultLabel: string
}>
