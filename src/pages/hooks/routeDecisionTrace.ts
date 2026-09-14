import type {RequestLogState} from '@/services/api/usage'

type RouteDecisionCandidateScope = 'complete' | 'selected_only' | 'unknown'
export type RouteDecisionQuotaStatus = 'fresh' | 'stale' | 'unknown' | ''

type RouteDecisionTraceStatus =
    | 'idle'
    | 'loading'
    | 'ready'
    | 'pending'
    | 'lifecycle'
    | 'missing_request_id'
    | 'not_found'
    | 'not_recorded'
    | 'truncated'
    | 'invalid'
    | 'unavailable'

export type RouteDecisionCooldown = Readonly<{
    known: boolean
    active: boolean
    indefinite: boolean
    retryAfterMs: number | null
    reason: string
    effectKey: string
    stateGeneration: number | null
    resetAuthority: string
}>

type RouteDecisionCooldowns = Readonly<{
    exactModel: RouteDecisionCooldown
    quotaFamily: RouteDecisionCooldown
    credential: RouteDecisionCooldown
    provider: RouteDecisionCooldown
}>

type RouteDecisionCandidate = Readonly<{
    provider: string
    model: string
    targetModel: string
    authIndex: string
    priority: number
    effectiveWeight: number
    native: boolean | null
    converted: boolean | null
    affinity: string
    cooldowns: RouteDecisionCooldowns
    quotaStatus: RouteDecisionQuotaStatus
    quotaHeadroom: number | null
    quotaResetAfterMs: number | null
    inFlight: number | null
    matchedRules: string[]
    excludedReasons: string[]
    selected: boolean
}>

type RouteDecisionSelection = Readonly<{
    provider: string
    model: string
    targetModel: string
    authIndex: string
    matchedRule: string
}>

export type RouteDecisionSnapshot = Readonly<{
    strategy: string
    requestedModel: string
    routedModel: string
    providers: string[]
    affinity: string
    matchedRule: string
    candidateScope: RouteDecisionCandidateScope
    candidates: RouteDecisionCandidate[]
    selected: RouteDecisionSelection | null
    truncatedCandidates: number
}>

type RouteDecisionTraceStateBase = Readonly<{
    attempt: number | null
    omittedEvents: number
    invalidLines: number
    requestLogTruncated: boolean
    requestLogState: RequestLogState | ''
    message: string
}>

type RouteDecisionTraceNonReadyStatus = Exclude<RouteDecisionTraceStatus, 'ready'>

export type RouteDecisionTraceState =
    | Readonly<RouteDecisionTraceStateBase & {
    status: 'ready'
    decision: RouteDecisionSnapshot
}>
    | Readonly<RouteDecisionTraceStateBase & {
    status: RouteDecisionTraceNonReadyStatus
    decision: null
}>

const ROUTE_TRACE_MARKER = '=== ROUTE TRACE ==='

export const requestLogStateToRouteDecisionStatus = (
    requestLogState: RequestLogState,
): RouteDecisionTraceNonReadyStatus => {
    switch (requestLogState) {
        case 'pending':
            return 'pending'
        case 'disabled':
        case 'not_captured':
        case 'publish_failed':
        case 'expired':
        case 'legacy_unknown':
            return 'lifecycle'
        case 'available':
            return 'not_recorded'
    }
}

const emptyCooldown = (): RouteDecisionCooldown => ({
    known: false,
    active: false,
    indefinite: false,
    retryAfterMs: null,
    reason: '',
    effectKey: '',
    stateGeneration: null,
    resetAuthority: '',
})

export const createRouteDecisionTraceState = (
    status: RouteDecisionTraceStatus,
    overrides: Partial<RouteDecisionTraceStateBase> & { decision?: RouteDecisionSnapshot | null } = {},
): RouteDecisionTraceState => ({
    status,
    decision: status === 'ready' ? overrides.decision ?? null : null,
    attempt: null,
    omittedEvents: 0,
    invalidLines: 0,
    requestLogTruncated: false,
    requestLogState: '',
    message: '',
    ...overrides,
}) as RouteDecisionTraceState

const asRecord = (value: unknown): Record<string, unknown> | null =>
    value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null

const stringValue = (value: unknown): string => typeof value === 'string' ? value.trim() : ''

const finiteNumber = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) ? value : null

const nonNegativeInteger = (value: unknown): number => {
    const number = finiteNumber(value)
    return number !== null && Number.isInteger(number) && number >= 0 ? number : 0
}

const nullableBoolean = (value: unknown): boolean | null => typeof value === 'boolean' ? value : null

const nullableNonNegativeNumber = (value: unknown): number | null => {
    const number = finiteNumber(value)
    return number !== null && number >= 0 ? number : null
}

const nullableUnitNumber = (value: unknown): number | null => {
    const number = finiteNumber(value)
    return number !== null && number >= 0 && number <= 1 ? number : null
}

const quotaStatus = (value: unknown): RouteDecisionQuotaStatus => {
    const status = stringValue(value)
    return status === 'fresh' || status === 'stale' || status === 'unknown' ? status : ''
}

const stringArray = (value: unknown): string[] =>
    Array.isArray(value)
    ? value.map(stringValue).filter((entry) => entry !== '')
    : []

const parseCooldown = (value: unknown): RouteDecisionCooldown => {
    const record = asRecord(value)
    if (!record) {
        return emptyCooldown()
    }
    return {
        known: record.known === true,
        active: record.active === true,
        indefinite: record.indefinite === true,
        retryAfterMs: nullableNonNegativeNumber(record.retry_after_ms),
        reason: stringValue(record.reason),
        effectKey: stringValue(record.effect_key),
        stateGeneration: nullableNonNegativeNumber(record.state_generation),
        resetAuthority: stringValue(record.reset_authority),
    }
}

const parseCandidate = (value: unknown): RouteDecisionCandidate | null => {
    const record    = asRecord(value)
    const authIndex = stringValue(record?.auth_index)
    if (!record || !authIndex) {
        return null
    }
    const cooldowns = asRecord(record.cooldowns)
    return {
        provider: stringValue(record.provider),
        model: stringValue(record.model),
        targetModel: stringValue(record.target_model),
        authIndex,
        priority: finiteNumber(record.priority) ?? 0,
        effectiveWeight: finiteNumber(record.effective_weight) ?? 0,
        native: nullableBoolean(record.native),
        converted: nullableBoolean(record.converted),
        affinity: stringValue(record.affinity),
        cooldowns: {
            exactModel: parseCooldown(cooldowns?.exact_model),
            quotaFamily: parseCooldown(cooldowns?.quota_family),
            credential: parseCooldown(cooldowns?.credential),
            provider: parseCooldown(cooldowns?.provider),
        },
        quotaStatus: quotaStatus(record.quota_status),
        quotaHeadroom: nullableUnitNumber(record.quota_headroom),
        quotaResetAfterMs: nullableNonNegativeNumber(record.quota_reset_after_ms),
        inFlight: nullableNonNegativeNumber(record.in_flight),
        matchedRules: stringArray(record.matched_rules),
        excludedReasons: stringArray(record.excluded_reasons),
        selected: record.selected === true,
    }
}

const parseSelection = (value: unknown): RouteDecisionSelection | null => {
    if (value === null || value === undefined) {
        return null
    }
    const record    = asRecord(value)
    const authIndex = stringValue(record?.auth_index)
    if (!record || !authIndex) {
        return null
    }
    return {
        provider: stringValue(record.provider),
        model: stringValue(record.model),
        targetModel: stringValue(record.target_model),
        authIndex,
        matchedRule: stringValue(record.matched_rule),
    }
}

const parseCandidateScope = (value: unknown): RouteDecisionCandidateScope => {
    const scope = stringValue(value)
    return scope === 'complete' || scope === 'selected_only' ? scope : 'unknown'
}

const parseDecision = (value: unknown): RouteDecisionSnapshot | null => {
    const record   = asRecord(value)
    const strategy = stringValue(record?.strategy)
    if (!record || !strategy || !Array.isArray(record.candidates)) {
        return null
    }
    const candidates        = record.candidates.map(parseCandidate)
    const selected          = parseSelection(record.selected)
    const selectedMalformed = record.selected !== null && record.selected !== undefined && selected === null
    if (candidates.some((candidate) => candidate === null) || selectedMalformed) {
        return null
    }
    return {
        strategy,
        requestedModel: stringValue(record.requested_model),
        routedModel: stringValue(record.routed_model),
        providers: stringArray(record.providers),
        affinity: stringValue(record.affinity),
        matchedRule: stringValue(record.matched_rule),
        candidateScope: parseCandidateScope(record.candidate_scope),
        candidates: candidates as RouteDecisionCandidate[],
        selected,
        truncatedCandidates: nonNegativeInteger(record.truncated_candidates),
    }
}

const routeTraceLines = (content: string): string[] | null => {
    const lines = content.split(/\r?\n/)
    for (let index = lines.length - 1; index >= 0; --index) {
        if (lines[index].trim() === ROUTE_TRACE_MARKER) {
            return lines.slice(index + 1)
        }
    }
    return null
}

export function parseRouteDecisionTrace(content: string, requestLogTruncated: boolean): RouteDecisionTraceState {
    const lines = routeTraceLines(content)
    if (!lines) {
        return createRouteDecisionTraceState(requestLogTruncated ? 'truncated' : 'not_recorded', {
            requestLogTruncated,
        })
    }

    let decision: RouteDecisionSnapshot | null = null
    let attempt: number | null                 = null
    let omittedEvents                          = 0
    let invalidLines                           = 0
    let sawRouteDecision                       = false
    let lastRouteDecisionInvalid               = false
    for (const rawLine of lines) {
        const line = rawLine.trim()
        if (!line) {
            continue
        }
        let parsed: unknown
        try {
            parsed = JSON.parse(line)
        } catch {
            ++invalidLines
            continue
        }
        const record = asRecord(parsed)
        if (!record) {
            ++invalidLines
            continue
        }
        if ('truncated_events' in record) {
            omittedEvents += nonNegativeInteger(record.truncated_events)
            continue
        }
        if (stringValue(record.action) !== 'route.decision') {
            continue
        }
        sawRouteDecision     = true
        const parsedDecision = parseDecision(record.decision)
        if (!parsedDecision) {
            decision                 = null
            attempt                  = null
            lastRouteDecisionInvalid = true
            ++invalidLines
            continue
        }
        decision                 = parsedDecision
        lastRouteDecisionInvalid = false
        const parsedAttempt      = finiteNumber(record.attempt)
        attempt                  = parsedAttempt !== null && Number.isInteger(parsedAttempt) && parsedAttempt > 0
                                   ? parsedAttempt
                                   : null
    }

    if (sawRouteDecision && lastRouteDecisionInvalid) {
        return createRouteDecisionTraceState('invalid', {
            invalidLines,
            omittedEvents,
            requestLogTruncated,
        })
    }
    if (decision) {
        return createRouteDecisionTraceState('ready', {
            decision,
            attempt,
            omittedEvents,
            invalidLines,
            requestLogTruncated,
        })
    }
    if (requestLogTruncated || omittedEvents > 0) {
        return createRouteDecisionTraceState('truncated', {
            omittedEvents,
            invalidLines,
            requestLogTruncated,
        })
    }
    return createRouteDecisionTraceState(invalidLines > 0 ? 'invalid' : 'not_recorded', { invalidLines })
}
