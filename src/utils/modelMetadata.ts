import type {ModelAlias, ModelThinking} from '@/types'

type ModelMetadata = Pick<ModelAlias,
    'maxContextLength' | 'thinking' | 'displayName' | 'forceMapping' | 'isCompat' |
    'supportConfigurationUpdate' | 'useMaxCompletionTokens' | 'image' |
    'inputModalities' | 'outputModalities'>

const MAX_CONTEXT_LENGTH_KEYS = ['maxContextLength', 'max-context-length', 'max_context_length'] as const
const BOOLEAN_MODEL_FIELDS = [
    ['forceMapping', 'force-mapping'],
    ['isCompat', 'is-compat'],
    ['supportConfigurationUpdate', 'support-configuration-update'],
    ['useMaxCompletionTokens', 'use-max-completion-tokens'],
    ['image', 'image'],
] as const
const ZERO_ALLOWED_KEYS       = ['zeroAllowed', 'zero_allowed', 'zero-allowed'] as const
const DYNAMIC_ALLOWED_KEYS    = ['dynamicAllowed', 'dynamic_allowed', 'dynamic-allowed'] as const

const isRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value)

const readOwnValue = (
    record: Record<string, unknown>,
    keys: readonly string[],
): { found: boolean; value: unknown } => {
    for (const key of keys) {
        if (Object.prototype.hasOwnProperty.call(record, key)) {
            return { found: true, value: record[key] }
        }
    }
    return { found: false, value: undefined }
}

const normalizeInteger = (value: unknown): number | undefined => {
    if (typeof value === 'number') {
        return Number.isInteger(value) ? value : undefined
    }
    if (typeof value !== 'string' || value.trim() === '') {
        return undefined
    }
    const parsed = Number(value)
    return Number.isInteger(parsed) ? parsed : undefined
}

const normalizeMaxContextLength = (value: unknown): number | undefined => {
    const parsed = normalizeInteger(value)
    return parsed !== undefined && parsed > 0 ? parsed : undefined
}

const normalizeBoolean = (value: unknown): boolean | undefined =>
    typeof value === 'boolean' ? value : undefined

const normalizeLevels = (value: unknown): string[] | undefined => {
    if (!Array.isArray(value)) {
        return undefined
    }
    const levels = value.map((level) => String(level ?? '').trim()).filter(Boolean)
    return levels.length ? levels : undefined
}

export const normalizeModelThinking = (value: unknown): ModelThinking | undefined => {
    if (!isRecord(value)) {
        return undefined
    }

    const thinking: ModelThinking = {}
    const min                     = normalizeInteger(value.min)
    const max                     = normalizeInteger(value.max)
    const zeroAllowed             = readOwnValue(value, ZERO_ALLOWED_KEYS)
    const dynamicAllowed          = readOwnValue(value, DYNAMIC_ALLOWED_KEYS)
    const levels                  = readOwnValue(value, ['levels'])

    if (min !== undefined) {
        thinking.min = min
    }
    if (max !== undefined) {
        thinking.max = max
    }
    if (zeroAllowed.found) {
        const normalized = normalizeBoolean(zeroAllowed.value)
        if (normalized !== undefined) {
            thinking.zeroAllowed = normalized
        }
    }
    if (dynamicAllowed.found) {
        const normalized = normalizeBoolean(dynamicAllowed.value)
        if (normalized !== undefined) {
            thinking.dynamicAllowed = normalized
        }
    }
    if (levels.found) {
        const normalized = normalizeLevels(levels.value)
        if (normalized !== undefined) {
            thinking.levels = normalized
        }
    }

    return Object.keys(thinking).length > 0 ? thinking : undefined
}

export const normalizeModelMetadata = (value: unknown): ModelMetadata => {
    if (!isRecord(value)) {
        return {}
    }

    const metadata: ModelMetadata = {}
    const maxContextLength        = readOwnValue(value, MAX_CONTEXT_LENGTH_KEYS)
    if (maxContextLength.found) {
        const normalized = normalizeMaxContextLength(maxContextLength.value)
        if (normalized !== undefined) {
            metadata.maxContextLength = normalized
        }
    }
    const thinking = normalizeModelThinking(value.thinking)
    if (thinking) {
        metadata.thinking = thinking
    }
    const displayName = readOwnValue(value, ['displayName', 'display-name', 'display_name'])
    if (typeof displayName.value === 'string' && displayName.value.trim()) {
        metadata.displayName = displayName.value.trim()
    }
    for (const [field, wireName] of BOOLEAN_MODEL_FIELDS) {
        const normalized = normalizeBoolean(readOwnValue(value, [field, wireName]).value)
        if (normalized !== undefined) {
            metadata[field] = normalized
        }
    }
    const inputModalities = readOwnValue(value, ['inputModalities', 'input-modalities'])
    const outputModalities = readOwnValue(value, ['outputModalities', 'output-modalities'])
    if (inputModalities.found && Array.isArray(inputModalities.value) &&
        inputModalities.value.every((item) => typeof item === 'string')) {
        metadata.inputModalities = [...inputModalities.value]
    }
    if (outputModalities.found && Array.isArray(outputModalities.value) &&
        outputModalities.value.every((item) => typeof item === 'string')) {
        metadata.outputModalities = [...outputModalities.value]
    }
    return metadata
}

export const normalizeModelMetadataFromManagement = (value: unknown): ModelMetadata => {
    const metadata = normalizeModelMetadata(value)
    if (!isRecord(value) || !isRecord(value.thinking)) {
        return metadata
    }
    const thinking    = metadata.thinking ?? {}
    metadata.thinking = {
        min: thinking.min ?? 0,
        max: thinking.max ?? 0,
        zeroAllowed: thinking.zeroAllowed ?? false,
        dynamicAllowed: thinking.dynamicAllowed ?? false,
        ...(thinking.levels ? { levels: thinking.levels } : {}),
    }
    return metadata
}

export const normalizeModelEntriesForSignature = (
    entries: Array<{
        name: string
        alias?: string
        maxContextLength?: number
        thinking?: ModelThinking
        maxContextLengthDraft?: string
        thinkingMinDraft?: string
        thinkingMaxDraft?: string
    }>,
    options: {
        normalizeName?: (name: string) => string
        aliasFallbackToName?: boolean
    } = {},
): Array<Record<string, unknown>> => {
    const normalizeName = options.normalizeName ?? ((name: string) => String(name ?? '').trim())
    return (entries ?? []).reduce<Array<Record<string, unknown>>>((acc, entry) => {
        const name = normalizeName(entry?.name ?? '')
        let alias  = String(entry?.alias ?? '').trim()
        if (name && options.aliasFallbackToName && !alias) {
            alias = name
        } else if (name && alias === name && !options.aliasFallbackToName) {
            alias = ''
        }
        if (!name) {
            return acc
        }
        const numericDrafts = [entry.maxContextLengthDraft, entry.thinkingMinDraft, entry.thinkingMaxDraft]
        acc.push({
            name,
            alias,
            ...normalizeModelMetadata(entry),
            ...(numericDrafts.some((draft) => draft !== undefined) ? {numericDrafts} : {}),
        })
        return acc
    }, [])
}

const serializeThinking = (
    value: unknown,
    zeroAllowedKey: 'zero_allowed' | 'zero-allowed',
    dynamicAllowedKey: 'dynamic_allowed' | 'dynamic-allowed',
): Record<string, unknown> | undefined => {
    const thinking = normalizeModelThinking(value)
    if (!thinking) {
        return undefined
    }

    const output: Record<string, unknown> = {}
    if (thinking.min !== undefined) {
        output.min = thinking.min
    }
    if (thinking.max !== undefined) {
        output.max = thinking.max
    }
    if (thinking.zeroAllowed !== undefined) {
        output[zeroAllowedKey] = thinking.zeroAllowed
    }
    if (thinking.dynamicAllowed !== undefined) {
        output[dynamicAllowedKey] = thinking.dynamicAllowed
    }
    if (thinking.levels !== undefined) {
        output.levels = thinking.levels
    }
    return output
}

export const serializeModelMetadataForManagement = (value: unknown): Record<string, unknown> => {
    const metadata                        = normalizeModelMetadata(value)
    const output: Record<string, unknown> = {}
    if (metadata.maxContextLength !== undefined) {
        output['max-context-length'] = metadata.maxContextLength
    }
    if (metadata.displayName !== undefined) {
        output['display-name'] = metadata.displayName
    }
    for (const [field, wireName] of BOOLEAN_MODEL_FIELDS) {
        if (metadata[field] !== undefined) {
            output[wireName] = metadata[field]
        }
    }
    if (metadata.inputModalities !== undefined) {
        output['input-modalities'] = metadata.inputModalities
    }
    if (metadata.outputModalities !== undefined) {
        output['output-modalities'] = metadata.outputModalities
    }
    const thinking = serializeThinking(metadata.thinking, 'zero_allowed', 'dynamic_allowed')
    if (thinking) {
        output.thinking = thinking
    }
    return output
}

export const serializeModelThinkingForManagement = (value: unknown): Record<string, unknown> => {
    const thinking = serializeThinking(value, 'zero_allowed', 'dynamic_allowed')
    return thinking ? { thinking } : {}
}

export const rewriteModelMetadataForYaml = (value: unknown): unknown => {
    if (!isRecord(value)) {
        return value
    }

    const output: Record<string, unknown> = { ...value }
    MAX_CONTEXT_LENGTH_KEYS.forEach((key) => delete output[key])
    const metadata = normalizeModelMetadata(value)
    if (metadata.maxContextLength !== undefined) {
        output['max-context-length'] = metadata.maxContextLength
    }

    if (isRecord(value.thinking)) {
        const thinkingOutput: Record<string, unknown> = { ...value.thinking }
        ZERO_ALLOWED_KEYS.forEach((key) => delete thinkingOutput[key])
        DYNAMIC_ALLOWED_KEYS.forEach((key) => delete thinkingOutput[key])
        const thinking = serializeThinking(metadata.thinking, 'zero-allowed', 'dynamic-allowed')
        if (thinking) {
            Object.assign(thinkingOutput, thinking)
        }
        if (Object.keys(thinkingOutput).length > 0) {
            output.thinking = thinkingOutput
        } else {
            delete output.thinking
        }
    }

    return output
}
