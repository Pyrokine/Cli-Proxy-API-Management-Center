import type {
    PayloadParamEntry,
    PayloadParamValidationErrorCode,
    PayloadParamValueType,
    PayloadRule,
    VisualConfigValidationErrorCode,
    VisualConfigValidationErrors,
    VisualConfigValues,
} from '@/types/visualConfig'
import {DEFAULT_VISUAL_VALUES} from '@/types/visualConfig'
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

export function getVisualConfigValidationErrors(values: VisualConfigValues): VisualConfigValidationErrors {
    const errors: VisualConfigValidationErrors = {}
    for (const [field, contract] of Object.entries(VISUAL_INTEGER_FIELDS)) {
        try {
            parseVisualConfigInteger(integerFieldValue(values, field), contract.minimum, contract.maximum)
        } catch {
            errors[field as keyof VisualConfigValidationErrors] = field === 'port'
                ? 'port_range'
                : field === 'redisUsageQueueRetentionSeconds'
                  ? 'integer_range_1_3600'
                  : contract.minimum < 0 || contract.maximum < Number.MAX_SAFE_INTEGER
                    ? 'payload_invalid_number'
                    : 'non_negative_integer'
        }
    }
    errors.quotaRefreshInterval = getQuotaRefreshIntervalError(values)
    errors.quotaRefreshMaxInterval = getQuotaRefreshMaxIntervalError(values)
    return errors
}

export function getPayloadParamValidationError(param: PayloadParamEntry): PayloadParamValidationErrorCode | undefined {
    const trimmedValue = param.value.trim()
    if (!trimmedValue) {
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

function hasPayloadParamValidationErrors(rules: PayloadRule[]): boolean {
    return rules.some((rule) => rule.params.some((param) => getPayloadParamValidationError(param) !== undefined))
}

export function useVisualConfig() {
    const [visualValues, setVisualValuesState]    = useState<VisualConfigValues>({
                                                                                     ...DEFAULT_VISUAL_VALUES,
                                                                                 })
    const [baselineValues, setBaselineValues]     = useState<VisualConfigValues>({
                                                                                     ...DEFAULT_VISUAL_VALUES,
                                                                                 })
    const [apiKeysStorage, setApiKeysStorage]     = useState<ApiKeysStorageMetadata>(DEFAULT_API_KEYS_STORAGE_METADATA)
    const apiKeysTextRef                          = useRef(DEFAULT_VISUAL_VALUES.apiKeysText)
    const [visualParseError, setVisualParseError] = useState<string | null>(null)

    const validationErrors                 = useMemo(
        () => getVisualConfigValidationErrors(visualValues),
        [visualValues],
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
            hasPayloadParamValidationErrors(visualValues.payloadOverrideRawRules),
        [
            visualValues.payloadDefaultRules,
            visualValues.payloadDefaultRawRules,
            visualValues.payloadOverrideRules,
            visualValues.payloadOverrideRawRules,
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
            encodeVisualConfigYaml(currentYaml, visualValues, baselineValues, apiKeysStorage),
        [apiKeysStorage, baselineValues, visualValues],
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
