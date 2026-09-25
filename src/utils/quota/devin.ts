import type {DevinQuotaState, DevinQuotaWindow} from '@/types'
import {resolveResetMs} from './resetInstants'

const asRecord = (value: unknown): Record<string, unknown> | null => {
    if (typeof value === 'string' && value.trim()) {
        try {
            return asRecord(JSON.parse(value))
        } catch {
            return null
        }
    }
    return value !== null && typeof value === 'object' && !Array.isArray(value) ?
           value as Record<string, unknown> :
           null
}

const parsePercent = (value: unknown): number | null => {
    const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN
    return Number.isFinite(number) && number >= 0 && number <= 100 ? number : null
}

const optionalString = (value: unknown): string | null =>
    typeof value === 'string' && value.trim() ? value.trim() : null

export function parseDevinQuotaPayload(data: unknown): DevinQuotaState | null {
    const record = asRecord(data)
    if (!record) {
        return null
    }

    const windows: DevinQuotaWindow[] = []
    for (const id of ['daily', 'weekly'] as const) {
        const present = record[`${id}_quota_present`] ?? record[`${id}QuotaPresent`]
        if (typeof present !== 'boolean') {
            return null
        }
        const remainingPercent = parsePercent(
            record[`${id}_quota_remaining_percent`] ?? record[`${id}QuotaRemainingPercent`],
        )
        if (present && remainingPercent === null) {
            return null
        }
        const resetAt = optionalString(record[`${id}_quota_reset_at`] ?? record[`${id}QuotaResetAt`])
        windows.push({
                         id,
                         remainingPercent: present ? remainingPercent : null,
                         resetAtMs: present ? resolveResetMs([resetAt]) : null,
                         periodHours: id === 'daily' ? 24 : 168,
                     })
    }

    return {
        status: 'success',
        windows,
        planType: optionalString(record.plan),
        planStart: optionalString(record.plan_start ?? record.planStart),
        planEnd: optionalString(record.plan_end ?? record.planEnd),
    }
}
