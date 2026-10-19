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
    if (compact === 'selfservebusinessprolite' || compact === 'businesspremium') {
        return 'business_premium'
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
    if (compact === 'freetier') {
        return 'free'
    }
    if (compact === 'g1protier') {
        return 'pro'
    }
    if (compact === 'ultra' || compact === 'g1ultratier') {
        return 'ultra'
    }
    if (compact === 'ultralite' || compact === 'g1ultralitetier') {
        return 'ultralite'
    }
    if (compact === 'max') {
        return 'max'
    }
    if (compact === 'xpremiumplus' || /^x[\s_-]*premium\s*\+$/i.test(normalized)) {
        return 'xpremiumplus'
    }
    if (compact === 'supergrok') {
        return 'supergrok'
    }
    if (compact === 'supergrokheavy') {
        return 'supergrokheavy'
    }

    return compact
}

export function normalizeCodexAccountCredits(value: unknown): { balance: string | null; unlimited: boolean } {
    const credits = value !== null && typeof value === 'object' && !Array.isArray(value) ?
                    value as Record<string, unknown> : null
    const raw     = credits?.balance
    const amount  = typeof raw === 'number' && Number.isFinite(raw) ? String(raw) :
                    typeof raw === 'string' ? raw.trim() : null
    return {
        balance: amount && /^\d+(?:\.\d+)?$/.test(amount) && Number.isFinite(Number(amount)) ? amount : null,
        unlimited: credits?.unlimited === true,
    }
}
