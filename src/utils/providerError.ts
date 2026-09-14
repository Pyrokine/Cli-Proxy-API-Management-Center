import {redactSensitiveText} from '@/utils/redaction'

export interface ParsedProviderError {
    code?: string
    type?: string
    message: string
    httpStatus?: number
    model?: string
    effectScope?: string
    effectKey?: string
    planType?: string
    nextRetryAfter?: string
    stateGeneration?: number
    observedAt?: string
    resetAt?: string
    resetsInSeconds?: number
    rawDetails?: string
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
    value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null

const decodeJSONLayers = (value: unknown): unknown => {
    let decoded = value
    for (let depth = 0; depth < 4 && typeof decoded === 'string'; depth += 1) {
        const trimmed = decoded.trim()
        if (!trimmed) {
            return ''
        }
        try {
            decoded = JSON.parse(trimmed)
        } catch {
            return trimmed
        }
    }
    return decoded
}

const collectErrorRecords = (value: unknown): Record<string, unknown>[] => {
    const records: Record<string, unknown>[] = []
    const visited                            = new Set<Record<string, unknown>>()
    const visit                              = (candidate: unknown, depth: number) => {
        if (depth > 4) {
            return
        }
        const record = asRecord(decodeJSONLayers(candidate))
        if (!record || visited.has(record)) {
            return
        }
        visited.add(record)
        records.push(record)
        for (const key of ['error', 'body', 'response', 'data', 'message']) {
            const child = record[key]
            if (asRecord(child) || asRecord(decodeJSONLayers(child))) {
                visit(child, depth + 1)
            }
        }
    }
    visit(value, 0)
    return records
}

const stringValue = (value: unknown): string | undefined => {
    if (typeof value !== 'string') {
        return undefined
    }
    const trimmed = value.trim()
    return trimmed || undefined
}

const firstString = (records: Record<string, unknown>[], keys: string[]): string | undefined => {
    for (const record of records) {
        for (const key of keys) {
            const value = stringValue(record[key])
            if (value) {
                return value
            }
        }
    }
    return undefined
}

const firstReadableMessage = (records: Record<string, unknown>[]): string | undefined => {
    for (const record of records) {
        const value = stringValue(record.message)
        if (value && typeof decodeJSONLayers(value) === 'string') {
            return redactSensitiveText(value)
        }
    }
    return undefined
}

const numberValue = (value: unknown): number | undefined => {
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : undefined
    }
    if (typeof value !== 'string' || !value.trim()) {
        return undefined
    }
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
}

const firstNumber = (records: Record<string, unknown>[], keys: string[]): number | undefined => {
    for (const record of records) {
        for (const key of keys) {
            const value = numberValue(record[key])
            if (value !== undefined) {
                return value
            }
        }
    }
    return undefined
}

const millisecondsToISOString = (milliseconds: number): string | undefined => {
    const date = new Date(milliseconds)
    return Number.isFinite(date.getTime()) ? date.toISOString() : undefined
}

const instantValue = (value: unknown): string | undefined => {
    const numeric = numberValue(value)
    let milliseconds: number
    if (numeric !== undefined && numeric >= 0) {
        milliseconds = numeric < 1_000_000_000_000 ? numeric * 1000 : numeric
    } else if (typeof value === 'string' && value.trim()) {
        milliseconds = Date.parse(value.trim())
    } else {
        return undefined
    }
    return Number.isFinite(milliseconds) ? millisecondsToISOString(milliseconds) : undefined
}

const firstInstant = (records: Record<string, unknown>[], keys: string[]): string | undefined => {
    for (const record of records) {
        for (const key of keys) {
            const value = instantValue(record[key])
            if (value) {
                return value
            }
        }
    }
    return undefined
}

const inferEffectScope = (
    code: string | undefined,
    type: string | undefined,
    model: string | undefined,
): string | undefined => {
    const kind = `${type ?? ''} ${code ?? ''}`.trim().toLowerCase()
    if (kind.includes('usage_limit') || kind.includes('rate_limit') || kind.includes('quota')) {
        return 'quota_family'
    }
    if (model && (kind.includes('not_found') || kind.includes('unsupported') || kind.includes('unavailable'))) {
        return 'exact_model'
    }
    return undefined
}

const rawProviderDetails = (value: unknown): string | undefined => {
    const decoded        = decodeJSONLayers(value)
    const record         = asRecord(decoded)
    let details: unknown = decoded
    if (record) {
        const decodedMessage = decodeJSONLayers(record.message)
        if (asRecord(decodedMessage) || Array.isArray(decodedMessage)) {
            details = decodedMessage
        }
    }
    if (!asRecord(details) && !Array.isArray(details)) {
        return undefined
    }
    try {
        return redactSensitiveText(JSON.stringify(details, null, 2))
    } catch {
        return undefined
    }
}

export function parseProviderError(value: unknown): ParsedProviderError | null {
    if (value === undefined || value === null || value === '') {
        return null
    }
    const decoded            = decodeJSONLayers(value)
    const records            = collectErrorRecords(decoded)
    const rootText           = typeof decoded === 'string' ? redactSensitiveText(decoded) : undefined
    const code               = firstString(records, ['code'])
    const type               = firstString(records, ['type', 'error_type', 'errorType'])
    const model              = firstString(records, ['model', 'model_id', 'modelId'])
    const observedAt         = firstInstant(records, ['observed_at', 'observedAt', 'updated_at', 'updatedAt'])
    const resetsInSecondsRaw = firstNumber(records, ['resets_in_seconds', 'resetsInSeconds'])
    const resetsInSeconds    = resetsInSecondsRaw !== undefined && Number.isSafeInteger(resetsInSecondsRaw) &&
                               resetsInSecondsRaw >= 0
                               ? resetsInSecondsRaw
                               : undefined
    let resetAt              = firstInstant(records, ['resets_at', 'resetsAt', 'reset_at', 'resetAt'])
    if (!resetAt && observedAt && resetsInSeconds !== undefined) {
        resetAt = millisecondsToISOString(Date.parse(observedAt) + resetsInSeconds * 1000)
    }
    const httpStatusRaw      = firstNumber(records, ['http_status', 'httpStatus', 'status_code', 'statusCode'])
    const httpStatus         = httpStatusRaw !== undefined && Number.isInteger(httpStatusRaw) &&
                               httpStatusRaw >= 100 && httpStatusRaw <= 599
                               ? httpStatusRaw
                               : undefined
    const stateGenerationRaw = firstNumber(records, ['state_generation', 'stateGeneration'])
    const stateGeneration    = stateGenerationRaw !== undefined && Number.isSafeInteger(stateGenerationRaw) &&
                               stateGenerationRaw >= 0
                               ? stateGenerationRaw
                               : undefined
    const effectScope        = firstString(records, ['effect_scope', 'effectScope']) ??
                               inferEffectScope(code, type, model)
    const effectKey          = firstString(records, [
        'effect_key',
        'effectKey',
        'quota_family',
        'quotaFamily',
    ]) ?? (effectScope === 'exact_model' ? model : undefined)
    const message            = firstReadableMessage(records) ?? rootText ?? type ?? code ?? 'Request failed'

    return {
        code,
        type,
        message,
        httpStatus,
        model,
        effectScope,
        effectKey,
        planType: firstString(records, ['plan_type', 'planType']),
        nextRetryAfter: firstInstant(records, ['next_retry_after', 'nextRetryAfter']),
        stateGeneration,
        observedAt,
        resetAt,
        resetsInSeconds,
        rawDetails: rawProviderDetails(value),
    }
}

export const isModelScopedProviderError = (error: ParsedProviderError | null | undefined): boolean =>
    error?.effectScope === 'exact_model' || error?.effectScope === 'quota_family'
