import type {
    CodexRateLimitResetCredit,
    CodexResetCreditCountEvidence,
    CodexResetCreditCountSource,
    CodexResetCreditCountState,
    CodexResetCreditDetailsState,
} from '@/types'

type CodexResetCreditPayloadState = 'valid' | 'missing' | 'invalid'
export type CodexResetCreditAvailability = 'available' | 'none' | 'missing' | 'invalid' | 'conflict'

interface CodexResetCreditsSummary {
    availableCount: CodexResetCreditCountState
    applicableAvailableCount: CodexResetCreditCountState
    credits: CodexRateLimitResetCredit[]
    payloadState: CodexResetCreditPayloadState
    detailsState: Exclude<CodexResetCreditDetailsState, 'error'>
}

interface ResolvedCodexResetCredits {
    availableCount: CodexResetCreditCountState
    applicableAvailableCount: CodexResetCreditCountState
    credits: CodexRateLimitResetCredit[]
    detailsState: CodexResetCreditDetailsState
}

const missingCount = (source: CodexResetCreditCountSource): CodexResetCreditCountState => ({
    state: 'missing',
    sources: [source],
})

const invalidCount = (source: CodexResetCreditCountSource): CodexResetCreditCountState => ({
    state: 'invalid',
    sources: [source],
})

const emptySummary = (
    source: CodexResetCreditCountSource,
    payloadState: CodexResetCreditPayloadState,
): CodexResetCreditsSummary => ({
    availableCount: missingCount(source),
    applicableAvailableCount: missingCount(source),
    credits: [],
    payloadState,
    detailsState: payloadState === 'invalid' ? 'invalid' : 'missing',
})

const asRecord = (value: unknown): Record<string, unknown> | null =>
    value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null

const own = (record: Record<string, unknown>, key: string): boolean =>
    Object.prototype.hasOwnProperty.call(record, key)

const nonNegativeInteger = (value: unknown): number | null => {
    if (typeof value === 'number') {
        return Number.isSafeInteger(value) && value >= 0 ? value : null
    }
    if (typeof value !== 'string' || !/^\d+$/.test(value.trim())) {
        return null
    }
    const parsed = Number(value.trim())
    return Number.isSafeInteger(parsed) ? parsed : null
}

const stringValue = (value: unknown): string | null => {
    if (typeof value === 'string') {
        const trimmed = value.trim()
        return trimmed ? trimmed : null
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value.toString()
    }
    return null
}

const countState = (
    record: Record<string, unknown>,
    snakeKey: string,
    camelKey: string,
    source: CodexResetCreditCountSource,
): CodexResetCreditCountState => {
    const values: Array<{ field: CodexResetCreditCountEvidence['field']; value: unknown }> = []
    if (own(record, snakeKey)) {
        values.push({ field: 'snake_case', value: record[snakeKey] })
    }
    if (own(record, camelKey)) {
        values.push({ field: 'camelCase', value: record[camelKey] })
    }
    if (values.length === 0) {
        return missingCount(source)
    }

    const evidence: CodexResetCreditCountEvidence[] = []
    for (const item of values) {
        const value = nonNegativeInteger(item.value)
        if (value === null) {
            return invalidCount(source)
        }
        evidence.push({ source, field: item.field, value })
    }
    if (new Set(evidence.map((item) => item.value)).size > 1) {
        return { state: 'conflict', evidence }
    }
    return { state: 'known', value: evidence[0]!.value, evidence }
}

type NormalizedCredit = {
    credit: CodexRateLimitResetCredit | null
    invalidEntry: boolean
}

const normalizeCredit = (value: unknown, index: number, nowMs: number): NormalizedCredit => {
    const record = asRecord(value)
    if (!record) {
        return { credit: null, invalidEntry: true }
    }
    const resetTypeValues: unknown[] = []
    if (own(record, 'reset_type')) {
        resetTypeValues.push(record.reset_type)
    }
    if (own(record, 'resetType')) {
        resetTypeValues.push(record.resetType)
    }
    const normalizedResetTypes = resetTypeValues.map((item) => stringValue(item))
    const uniqueResetTypes     = new Set(normalizedResetTypes.filter((item): item is string => item !== null))
    if (
        resetTypeValues.length === 0 ||
        normalizedResetTypes.some((item) => item === null) ||
        uniqueResetTypes.size !== 1
    ) {
        return { credit: null, invalidEntry: true }
    }
    if ([...uniqueResetTypes][0] !== 'codex_rate_limits') {
        return { credit: null, invalidEntry: false }
    }

    const status = stringValue(record.status)
    if (!status) {
        return { credit: null, invalidEntry: true }
    }
    if (status !== 'available') {
        return { credit: null, invalidEntry: false }
    }

    const expiryValues: unknown[] = []
    if (own(record, 'expires_at')) {
        expiryValues.push(record.expires_at)
    }
    if (own(record, 'expiresAt')) {
        expiryValues.push(record.expiresAt)
    }
    const normalizedExpiryValues                              = expiryValues.map((item) => stringValue(item))
    const uniqueExpiryValues                                  = new Set(normalizedExpiryValues.filter((item): item is string => item !==
                                                                                                                                null))
    const expiresAt                                           = uniqueExpiryValues.size === 1 ?
                                                                [...uniqueExpiryValues][0]! :
                                                                null
    let expiryState: CodexRateLimitResetCredit['expiryState'] = 'missing'
    if (expiryValues.length > 0) {
        const expiresAtMs = expiresAt === null ? Number.NaN : Date.parse(expiresAt)
        expiryState       = normalizedExpiryValues.some((item) => item === null) || uniqueExpiryValues.size !== 1 ||
                            !Number.isFinite(expiresAtMs)
                            ? 'invalid'
                            : expiresAtMs <= nowMs
                              ? 'expired'
                              : 'valid'
    }

    return {
        credit: {
            id: stringValue(record.id) ?? `reset-credit-${index + 1}`,
            status,
            grantedAt: stringValue(record.granted_at ?? record.grantedAt) ?? '',
            expiresAt,
            expiryState,
        },
        invalidEntry: false,
    }
}

export function normalizeCodexResetCreditsPayload(
    payload: unknown,
    source: CodexResetCreditCountSource = 'usage',
    nowMs                               = Date.now(),
): CodexResetCreditsSummary {
    if (payload === undefined || payload === null) {
        return emptySummary(source, 'missing')
    }

    let parsedPayload = payload
    if (typeof payload === 'string') {
        const trimmed = payload.trim()
        if (!trimmed) {
            return emptySummary(source, 'invalid')
        }
        try {
            parsedPayload = JSON.parse(trimmed)
        } catch {
            return emptySummary(source, 'invalid')
        }
    }

    const record = asRecord(parsedPayload)
    if (!record) {
        return emptySummary(source, 'invalid')
    }

    const hasExpectedShape                     =
              own(record, 'credits') ||
              own(record, 'available_count') ||
              own(record, 'availableCount') ||
              own(record, 'applicable_available_count') ||
              own(record, 'applicableAvailableCount')
    const hasNoFields                          = Object.keys(record).length === 0
    let invalidCreditEntries                   = own(record, 'credits') && !Array.isArray(record.credits)
    const credits: CodexRateLimitResetCredit[] = []
    if (Array.isArray(record.credits)) {
        record.credits.forEach((item, index) => {
            const normalized = normalizeCredit(item, index, nowMs)
            invalidCreditEntries ||= normalized.invalidEntry
            if (normalized.credit) {
                credits.push(normalized.credit)
            }
        })
    }

    return {
        availableCount: countState(record, 'available_count', 'availableCount', source),
        applicableAvailableCount: countState(
            record,
            'applicable_available_count',
            'applicableAvailableCount',
            source,
        ),
        credits,
        payloadState: (hasExpectedShape || hasNoFields) && !invalidCreditEntries ? 'valid' : 'invalid',
        detailsState: !own(record, 'credits')
                      ? 'missing'
                      : invalidCreditEntries
                        ? 'invalid'
                        : credits.length > 0
                          ? 'present'
                          : 'empty',
    }
}

const uniqueSources = (sources: CodexResetCreditCountSource[]): CodexResetCreditCountSource[] =>
    Array.from(new Set(sources))

const countSources = (state: CodexResetCreditCountState): CodexResetCreditCountSource[] =>
    state.state === 'known' || state.state === 'conflict'
    ? state.evidence.map((item) => item.source)
    : state.sources

const mergeCountStates = (
    usage: CodexResetCreditCountState,
    details: CodexResetCreditCountState,
): CodexResetCreditCountState => {
    const evidence = [usage, details].flatMap((state) =>
                                                  state.state === 'known' || state.state === 'conflict' ?
                                                  state.evidence :
                                                      [],
    )
    if (
        usage.state === 'conflict' ||
        details.state === 'conflict' ||
        new Set(evidence.map((item) => item.value)).size > 1
    ) {
        return { state: 'conflict', evidence }
    }

    const invalidSources = [usage, details].flatMap((state) =>
                                                        state.state === 'invalid' ? state.sources : [],
    )
    if (invalidSources.length > 0) {
        return { state: 'invalid', sources: uniqueSources(invalidSources) }
    }

    const known = [usage, details].filter(
        (state): state is Extract<CodexResetCreditCountState, { state: 'known' }> => state.state === 'known',
    )
    if (known.length > 0) {
        return {
            state: 'known',
            value: known[0]!.value,
            evidence,
        }
    }
    return {
        state: 'missing',
        sources: uniqueSources([...countSources(usage), ...countSources(details)]),
    }
}

export const codexResetCreditAvailability = (
    availableCount: CodexResetCreditCountState | null | undefined,
): CodexResetCreditAvailability => {
    switch (availableCount?.state) {
        case 'known':
            return availableCount.value > 0 ? 'available' : 'none'
        case 'invalid':
            return 'invalid'
        case 'conflict':
            return 'conflict'
        default:
            return 'missing'
    }
}

export const canUseCodexResetCredit = (
    availableCount: CodexResetCreditCountState | null | undefined,
): boolean => codexResetCreditAvailability(availableCount) === 'available'

export async function runCodexResetCreditAction(
    readAvailableCount: () => CodexResetCreditCountState | null | undefined,
    action: () => Promise<void>,
): Promise<CodexResetCreditAvailability> {
    const availability = codexResetCreditAvailability(readAvailableCount())
    if (availability !== 'available') {
        return availability
    }
    await action()
    return availability
}

export function resolveCodexResetCredits(
    usagePayload: unknown,
    detailsPayload: unknown,
    nowMs = Date.now(),
): ResolvedCodexResetCredits {
    const usage                                      = normalizeCodexResetCreditsPayload(usagePayload, 'usage', nowMs)
    const details                                    = normalizeCodexResetCreditsPayload(
        detailsPayload,
        'details',
        nowMs,
    )
    const detailsState: CodexResetCreditDetailsState =
              details.payloadState === 'missing'
              ? 'missing'
              : details.payloadState === 'invalid'
                ? 'invalid'
                : details.detailsState

    const usageAvailableCount    = usage.payloadState === 'invalid' ? invalidCount('usage') : usage.availableCount
    const detailsAvailableCount  = details.payloadState === 'invalid' ? invalidCount('details') : details.availableCount
    const usageApplicableCount   =
              usage.payloadState === 'invalid' ? invalidCount('usage') : usage.applicableAvailableCount
    const detailsApplicableCount =
              details.payloadState === 'invalid' ? invalidCount('details') : details.applicableAvailableCount

    return {
        availableCount: mergeCountStates(usageAvailableCount, detailsAvailableCount),
        applicableAvailableCount: mergeCountStates(usageApplicableCount, detailsApplicableCount),
        credits: details.credits,
        detailsState,
    }
}
