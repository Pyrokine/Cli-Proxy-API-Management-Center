import type {ClaudeResetGrant, ClaudeResetGrants} from '@/types'

function record(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value) ?
           value as Record<string, unknown> : null
}

function timestamp(value: unknown): string | null | undefined {
    if (value === undefined || value === null) {
        return null
    }
    return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : undefined
}

function parseGrant(value: unknown): ClaudeResetGrant | null {
    const grant = record(value)
    if (!grant || typeof grant.id !== 'string' || !/^[a-z0-9_-]{1,40}$/.test(grant.id)) {
        return null
    }
    const total = grant.resets_total
    const left = grant.resets_left
    if (typeof total !== 'number' || !Number.isSafeInteger(total) || total < 0 ||
        typeof left !== 'number' || !Number.isSafeInteger(left) || left < 0 || left > total) {
        return null
    }
    const startsAt = timestamp(grant.starts_at)
    const endsAt = timestamp(grant.ends_at)
    const paused = grant.paused ?? false
    const usableNow = grant.usable_now ?? false
    if (startsAt === undefined || endsAt === undefined || typeof paused !== 'boolean' ||
        typeof usableNow !== 'boolean' ||
        (startsAt !== null && endsAt !== null && Date.parse(startsAt) > Date.parse(endsAt))) {
        return null
    }
    const label = typeof grant.label === 'string' ? grant.label
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) : ''
    return {id: grant.id, label, resetsTotal: total, resetsLeft: left, startsAt, endsAt, paused, usableNow}
}

export function parseClaudeResetGrants(value: unknown): ClaudeResetGrants {
    if (value === undefined || value === null) {
        return {state: 'missing'}
    }
    const block = record(value)
    if (!block || typeof block.eligible !== 'boolean') {
        return {state: 'invalid'}
    }
    const rawGrants = block.grants ?? []
    const weeklyResetsAt = timestamp(block.weekly_resets_at)
    const cooldownUntil = timestamp(block.cooldown_until)
    if (!Array.isArray(rawGrants) || weeklyResetsAt === undefined || cooldownUntil === undefined) {
        return {state: 'invalid'}
    }
    const grants: ClaudeResetGrant[] = []
    const seen = new Set<string>()
    let remaining = 0
    for (const rawGrant of rawGrants) {
        const grant = parseGrant(rawGrant)
        if (!grant || seen.has(grant.id) || !Number.isSafeInteger(remaining + grant.resetsLeft)) {
            return {state: 'invalid'}
        }
        seen.add(grant.id)
        remaining += grant.resetsLeft
        grants.push(grant)
    }
    return {state: 'present', eligible: block.eligible, grants, weeklyResetsAt, cooldownUntil}
}
