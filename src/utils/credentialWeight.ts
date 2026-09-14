export const MAX_CREDENTIAL_WEIGHT = 1_000_000

export type CredentialWeightError = 'integer' | 'max'

export const validateCredentialWeight = (value: number | undefined): CredentialWeightError | null => {
    if (value === undefined) {
        return null
    }
    if (!Number.isSafeInteger(value)) {
        return 'integer'
    }
    return value > MAX_CREDENTIAL_WEIGHT ? 'max' : null
}

export const readCredentialWeight = (value: unknown): number | undefined => {
    const normalized =
              typeof value === 'number'
              ? value
              : typeof value === 'string' && /^[+-]?\d+$/.test(value.trim())
                ? Number(value.trim())
                : undefined
    return validateCredentialWeight(normalized) === null ? normalized : undefined
}

export const validateCredentialWeightText = (value: string): CredentialWeightError | null => {
    const trimmed = value.trim()
    if (!trimmed) {
        return null
    }
    if (!/^[+-]?\d+$/.test(trimmed)) {
        return 'integer'
    }
    return validateCredentialWeight(Number(trimmed))
}

export const parseCredentialWeightText = (value: string): number | undefined => {
    if (validateCredentialWeightText(value)) {
        return undefined
    }
    const trimmed = value.trim()
    return trimmed ? Number(trimmed) : undefined
}

export const getCredentialWeightValidationKey = (weight: number | undefined): string | undefined => {
    const error = validateCredentialWeight(weight)
    if (error === 'integer') {
        return 'ai_providers.weight_integer_error'
    }
    if (error === 'max') {
        return 'ai_providers.weight_max_error'
    }
    return undefined
}
