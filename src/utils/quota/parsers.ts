/**
 * Normalization and parsing functions for quota data.
 */

function normalizeStringValue(value: unknown): string | null {
    if (typeof value === 'string') {
        const trimmed = value.trim()
        return trimmed ? trimmed : null
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value.toString()
    }
    return null
}

export function normalizePlanType(value: unknown): string | null {
    const normalized = normalizeStringValue(value)
    if (!normalized) {
        return null
    }

    const compact = normalized.toLowerCase().replace(/[^a-z0-9]+/g, '')

    if (!compact) {
        return null
    }
    if (compact === 'chatgptplus' || compact === 'plus') {
        return 'plus'
    }
    if (compact === 'chatgptpro' || compact === 'pro') {
        return 'pro'
    }
    if (compact === 'chatgptprolite' || compact === 'prolite') {
        return 'prolite'
    }
    if (compact === 'team' || compact === 'chatgptteam') {
        return 'team'
    }
    if (compact === 'free' || compact === 'chatgptfree') {
        return 'free'
    }
    if (compact === 'legacy') {
        return 'legacy'
    }
    if (compact === 'standard') {
        return 'standard'
    }
    if (compact === 'ultra') {
        return 'ultra'
    }
    if (compact === 'max') {
        return 'max'
    }

    return compact
}
