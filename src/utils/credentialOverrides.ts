import type {RequestScopedErrorRule} from '@/types'

export const getCredentialRetryValidationKey = (value: number | undefined) =>
    value !== undefined && !Number.isSafeInteger(value) ? 'auth_files.request_retry_invalid' : undefined

export const REQUEST_SCOPED_ERROR_ACTIONS = ['stop', 'stop-and-cooldown', 'continue', 'continue-and-cooldown'] as const

type ErrorRuleOrigin = {
    rule?: RequestScopedErrorRule
    match?: boolean[]
    matchRegex?: boolean[]
}

const errorRuleOrigins = new WeakMap<RequestScopedErrorRule, ErrorRuleOrigin>()

export const readRequestScopedErrorRule = (rule: RequestScopedErrorRule): RequestScopedErrorRule => {
    errorRuleOrigins.set(rule, {
        rule,
        match: rule.match?.map((value) => value.length === 0),
        matchRegex: rule.matchRegex?.map((value) => value.length === 0),
    })
    return rule
}

export const updateRequestScopedErrorRule = (
    rule: RequestScopedErrorRule,
    patch: Partial<RequestScopedErrorRule>,
    conditionIndices?: number[],
): RequestScopedErrorRule => {
    const origin = errorRuleOrigins.get(rule) ?? {}
    const updated = {...rule, ...patch}
    const nextOrigin = {...origin}
    for (const field of ['match', 'matchRegex'] as const) {
        if (patch[field] !== undefined) {
            nextOrigin[field] = patch[field]?.map((_, index) =>
                origin[field]?.[conditionIndices?.[index] ?? index] ?? false)
        }
    }
    errorRuleOrigins.set(updated, nextOrigin)
    return updated
}

export const getRequestScopedErrorsValidationKey = (
    rules?: RequestScopedErrorRule[],
    original?: RequestScopedErrorRule[],
): string | undefined => {
    if (!rules) {
        return undefined
    }
    for (const [index, rule] of rules.entries()) {
        const origin = errorRuleOrigins.get(rule)
        const baseline = original ?? (origin?.rule ? [origin.rule] : undefined)
        if (baseline?.some((previous) => JSON.stringify(previous) === JSON.stringify(rule))) {
            continue
        }
        const previous = origin
            ? baseline?.find((entry) => origin.rule && JSON.stringify(entry) === JSON.stringify(origin.rule))
            : original?.[index]
        if (!Number.isSafeInteger(rule.status) || (rule.status ?? 0) <= 0) {
            return 'ai_providers.error_rules_invalid_status'
        }
        const normalizedAction = typeof rule.action === 'string' ? rule.action.trim().toLowerCase() : ''
        if (!REQUEST_SCOPED_ERROR_ACTIONS.some((action) => action === normalizedAction)) {
            return 'ai_providers.error_rules_invalid_action'
        }
        if (![...(rule.match ?? []), ...(rule.matchRegex ?? [])].some((value) => value.length > 0) &&
            !(previous && JSON.stringify(rule.match ?? []) === JSON.stringify(previous.match ?? []) &&
                JSON.stringify(rule.matchRegex ?? []) === JSON.stringify(previous.matchRegex ?? []))) {
            return 'ai_providers.error_rules_invalid_match'
        }
        for (const field of ['match', 'matchRegex'] as const) {
            if (rule[field]?.some((value, matchIndex) =>
                value.length === 0 && !(previous && (origin
                    ? origin[field]?.[matchIndex]
                    : previous[field]?.[matchIndex] === '')))) {
                return 'ai_providers.error_rules_invalid_match'
            }
        }
    }
    return undefined
}
