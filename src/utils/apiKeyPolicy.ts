import {type ApiKeyModelRule, type ApiKeyPolicyLimit, EMPTY_API_KEY_MODEL_RULE} from '@/types/visualConfig'

const MAX_POLICY_LIMIT = 9223372036854775807n

// noinspection JSNonASCIINames
const GO_DURATION_PART = /(?<number>\d+(?:\.\d*)?|\.\d+)(?<unit>ns|us|µs|μs|ms|s|m|h)/gy

const GO_DURATION_FACTORS: Record<string, bigint> = {
    ns: 1n,
    us: 1_000n,
    ms: 1_000_000n,
    s: 1_000_000_000n,
    m: 60_000_000_000n,
    h: 3_600_000_000_000n,
}

export type ApiKeyPolicyValidationErrorCode =
    | 'profile'
    | 'duration'
    | 'mapping'
    | 'mapping_duplicate'
    | 'window'
    | 'window_duplicate'
    | 'integer'
    | 'empty_limit'

type ApiKeyPolicyValidationResult =
    | { rule: ApiKeyModelRule; error?: never }
    | { rule?: never; error: ApiKeyPolicyValidationErrorCode }

export function cloneApiKeyModelRule(rule?: ApiKeyModelRule): ApiKeyModelRule {
    const source = rule ?? EMPTY_API_KEY_MODEL_RULE
    return {
        blockedModels: [...source.blockedModels],
        providers: [...source.providers],
        canonicalModels: [...source.canonicalModels],
        modelMappings: { ...source.modelMappings },
        policyProfile: source.policyProfile,
        reservationTtl: source.reservationTtl,
        limits: source.limits.map((limit) => ({ ...limit })),
    }
}

export function isApiKeyPolicyConfigured(rule?: ApiKeyModelRule): boolean {
    return Boolean(rule && (
        rule.providers.length > 0 ||
        rule.canonicalModels.length > 0 ||
        Object.keys(rule.modelMappings).length > 0 ||
        rule.policyProfile.trim() ||
        rule.reservationTtl.trim() ||
        rule.limits.length > 0
    ))
}

function normalizePolicyStringList(values: string[]): string[] {
    const seen = new Set<string>()
    return values.flatMap((value) => {
        const trimmed = value.trim()
        const key     = trimmed.toLowerCase()
        if (!trimmed || seen.has(key)) {
            return []
        }
        seen.add(key)
        return [trimmed]
    })
}

function parsePositiveGoDuration(value: string): bigint | null {
    let duration = value.trim()
    if (!duration || duration.length > 128) {
        return null
    }
    if (duration.startsWith('+')) {
        duration = duration.slice(1)
        if (!duration) {
            return null
        }
    }
    GO_DURATION_PART.lastIndex = 0
    let total                  = 0n
    let index                  = 0
    for (; ;) {
        const match = GO_DURATION_PART.exec(duration)
        if (!match) {
            break
        }
        if (match.index !== index) {
            return null
        }
        const [wholeRaw = '', fractionRaw = ''] = (match.groups?.number ?? '').split('.')
        const unit      = match.groups?.unit ?? ''
        const factor    = GO_DURATION_FACTORS[unit === 'µs' || unit === 'μs' ? 'us' : unit]
        if (factor === undefined) {
            return null
        }
        const whole    = BigInt(wholeRaw || '0')
        const fraction = fractionRaw
                         ? BigInt(fractionRaw) * factor / (10n ** BigInt(fractionRaw.length))
                         : 0n
        total += whole * factor + fraction
        if (total > MAX_POLICY_LIMIT) {
            return null
        }
        index = GO_DURATION_PART.lastIndex
    }
    return index === duration.length && total > 0n ? total : null
}

function parsePolicyLimitInteger(value: string): bigint | null {
    const trimmed = value.trim()
    if (!trimmed) {
        return 0n
    }
    if (trimmed.length > 19 || !/^\d+$/.test(trimmed)) {
        return null
    }
    const parsed = BigInt(trimmed)
    return parsed <= MAX_POLICY_LIMIT ? parsed : null
}

export function validateApiKeyPolicyDraft(
    draftRule: ApiKeyModelRule,
    mappings: Array<{ source: string; target: string }>,
    limitDrafts: ApiKeyPolicyLimit[],
): ApiKeyPolicyValidationResult {
    const profile = draftRule.policyProfile.trim()
    if (profile && !/^[A-Za-z0-9._-]{1,128}$/.test(profile)) {
        return { error: 'profile' }
    }
    const ttl = draftRule.reservationTtl.trim()
    if (ttl && parsePositiveGoDuration(ttl) === null) {
        return { error: 'duration' }
    }

    const modelMappings: Record<string, string> = {}
    const mappingSources                        = new Set<string>()
    for (const mapping of mappings) {
        const source = mapping.source.trim()
        const target = mapping.target.trim()
        if (!source && !target) {
            continue
        }
        if (!source || !target) {
            return { error: 'mapping' }
        }
        const normalizedSource = source.toLowerCase().replace(/^models\//, '')
        if (mappingSources.has(normalizedSource)) {
            return { error: 'mapping_duplicate' }
        }
        mappingSources.add(normalizedSource)
        modelMappings[source] = target
    }

    const limits: ApiKeyPolicyLimit[] = []
    const windows                     = new Set<bigint>()
    for (const limit of limitDrafts) {
        const window       = limit.window.trim()
        const requestsRaw  = limit.requests.trim()
        const tokensRaw    = limit.tokens.trim()
        const costMicroRaw = limit.costMicro.trim()
        if (!window && !requestsRaw && !tokensRaw && !costMicroRaw) {
            continue
        }
        const requests  = parsePolicyLimitInteger(requestsRaw)
        const tokens    = parsePolicyLimitInteger(tokensRaw)
        const costMicro = parsePolicyLimitInteger(costMicroRaw)
        if (requests === null || tokens === null || costMicro === null) {
            return { error: 'integer' }
        }
        const windowValue = parsePositiveGoDuration(window)
        if (windowValue === null) {
            return { error: 'window' }
        }
        if (windows.has(windowValue)) {
            return { error: 'window_duplicate' }
        }
        windows.add(windowValue)
        if (requests === 0n && tokens === 0n && costMicro === 0n) {
            return { error: 'empty_limit' }
        }
        limits.push({
                        window,
                        requests: requestsRaw,
                        tokens: tokensRaw,
                        costMicro: costMicroRaw,
                    })
    }

    return {
        rule: {
            ...cloneApiKeyModelRule(draftRule),
            providers: normalizePolicyStringList(draftRule.providers),
            canonicalModels: normalizePolicyStringList(draftRule.canonicalModels),
            modelMappings,
            policyProfile: profile,
            reservationTtl: ttl,
            limits,
        },
    }
}
