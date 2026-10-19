import type {ClaudeQuotaWindow, ClaudeUsageLimit, KimiQuotaRow} from '@/types'
import {formatQuotaResetTime} from './formatters'
import {parseIsoToMs, parseOffsetSecondsToMs, resolveResetMs} from './resetInstants'

function asRecord(value: unknown): Record<string, unknown> | null {
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

function numberValue(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value
    }
    if (typeof value === 'string' && value.trim()) {
        const parsed = Number(value.trim())
        return Number.isFinite(parsed) ? parsed : null
    }
    return null
}

function integerValue(value: unknown): number | null {
    const parsed = numberValue(value)
    return parsed === null ? null : Math.floor(parsed)
}

function stringValue(value: unknown): string | null {
    if (typeof value === 'string') {
        const trimmed = value.trim()
        return trimmed || null
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        return String(value)
    }
    return null
}

function formatKimiResetDuration(totalSeconds: number): string {
    const totalMinutes = Math.floor(totalSeconds / 60)
    const days         = Math.floor(totalMinutes / 1440)
    const hours        = Math.floor((totalMinutes % 1440) / 60)
    const minutes      = totalMinutes % 60

    if (days > 0) {
        return `${days}d ${hours}h`
    }
    if (hours > 0 && minutes > 0) {
        return `${hours}h ${minutes}m`
    }
    if (hours > 0) {
        return `${hours}h`
    }
    if (minutes > 0) {
        return `${minutes}m`
    }
    return '<1m'
}

type KimiTimeUnit = 'second' | 'minute' | 'hour' | 'day' | 'week'

function normalizeKimiTimeUnit(rawUnit: unknown): KimiTimeUnit | null {
    const unit = typeof rawUnit === 'string' ? rawUnit.trim().toUpperCase().replace(/^TIME_UNIT_/, '') : ''
    if (unit === 'SECOND' || unit === 'SECONDS') {
        return 'second'
    }
    if (!unit || unit === 'MINUTE' || unit === 'MINUTES') {
        return 'minute'
    }
    if (unit === 'HOUR' || unit === 'HOURS') {
        return 'hour'
    }
    if (unit === 'DAY' || unit === 'DAYS') {
        return 'day'
    }
    if (unit === 'WEEK' || unit === 'WEEKS') {
        return 'week'
    }
    return null
}

function kimiDurationToken(duration: number, rawUnit: unknown): string {
    const unit = normalizeKimiTimeUnit(rawUnit)
    if (unit === 'second') {
        return `${duration}s`
    }
    if (unit === 'hour') {
        return `${duration}h`
    }
    if (unit === 'day') {
        return `${duration}d`
    }
    if (unit === 'week') {
        return `${duration}w`
    }
    if (unit === 'minute') {
        return duration % 60 === 0 ? `${duration / 60}h` : `${duration}m`
    }
    const visibleUnit = stringValue(rawUnit)
    return visibleUnit ? `${duration} ${visibleUnit}` : `${duration}m`
}

function kimiPeriodHours(label: string | undefined, duration: number | null, rawUnit: unknown): number | null {
    if (duration !== null && duration > 0) {
        const unit = normalizeKimiTimeUnit(rawUnit)
        if (unit === 'second') {
            return duration / 3600
        }
        if (unit === 'minute') {
            return duration / 60
        }
        if (unit === 'hour') {
            return duration
        }
        if (unit === 'day') {
            return duration * 24
        }
        if (unit === 'week') {
            return duration * 7 * 24
        }
        return null
    }

    const normalized = (label ?? '').toLowerCase()
    if (normalized.includes('weekly') || normalized.includes('week')) {
        return 7 * 24
    }
    if (normalized.includes('daily') || normalized.includes('day')) {
        return 24
    }
    if (normalized.includes('monthly') || normalized.includes('month')) {
        return 30 * 24
    }
    if (normalized.includes('5h') || normalized.includes('five hour')) {
        return 5
    }
    return null
}

interface KimiResetInfo {
    resetHint?: string
    resetAtMs: number | null
}

function kimiResetInfo(data: Record<string, unknown>, nowMs: number): KimiResetInfo {
    for (const key of ['reset_at', 'resetAt', 'reset_time', 'resetTime']) {
        const raw = stringValue(data[key])
        if (!raw) {
            continue
        }
        const resetAtMs = parseIsoToMs(raw)
        if (resetAtMs === null) {
            return { resetHint: raw, resetAtMs: null }
        }
        const deltaSeconds = Math.floor((resetAtMs - nowMs) / 1000)
        return {
            resetHint: deltaSeconds > 0 ? formatKimiResetDuration(deltaSeconds) : undefined,
            resetAtMs,
        }
    }

    for (const key of ['reset_in', 'resetIn', 'ttl']) {
        const raw       = data[key]
        const resetAtMs = parseOffsetSecondsToMs(raw, nowMs)
        if (resetAtMs !== null) {
            return {
                resetHint: formatKimiResetDuration(Math.floor((resetAtMs - nowMs) / 1000)),
                resetAtMs,
            }
        }
        const visible = stringValue(raw)
        if (visible) {
            return { resetHint: visible, resetAtMs: null }
        }
    }

    const resetHint = stringValue(data.reset_hint ?? data.resetHint) ?? undefined
    return { resetHint, resetAtMs: null }
}

interface KimiRowLabel {
    label?: string
    labelKey?: string
    labelParams?: Record<string, string | number>
}

function kimiLimitLabel(
    item: Record<string, unknown>,
    detail: Record<string, unknown>,
    window: Record<string, unknown>,
    index: number,
): KimiRowLabel {
    for (const key of ['name', 'title', 'scope']) {
        const label = stringValue(item[key] ?? detail[key])
        if (label) {
            return { label }
        }
    }

    const duration = integerValue(window.duration ?? item.duration ?? detail.duration)
    const timeUnit = window.timeUnit ?? window.time_unit ?? item.timeUnit ?? item.time_unit ??
                     detail.timeUnit ?? detail.time_unit
    if (duration !== null && duration > 0) {
        return {
            labelKey: 'kimi_quota.limit_window',
            labelParams: { duration: kimiDurationToken(duration, timeUnit) },
        }
    }
    return {
        labelKey: 'kimi_quota.limit_index',
        labelParams: { index: index + 1 },
    }
}

function toKimiRow(
    data: Record<string, unknown>,
    fallbackLabel: KimiRowLabel,
    id: string,
    nowMs: number,
    duration: number | null = null,
    timeUnit?: unknown,
): KimiQuotaRow | null {
    const limit = integerValue(data.limit)
    let used    = integerValue(data.used)
    if (used === null && limit !== null) {
        const remaining = integerValue(data.remaining)
        if (remaining !== null) {
            used = limit - remaining
        }
    }
    if (used === null && limit === null) {
        return null
    }

    const explicitLabel = stringValue(data.name ?? data.title ?? data.label)
    const reset         = kimiResetInfo(data, nowMs)
    const label         = explicitLabel ? { label: explicitLabel } : fallbackLabel
    return {
        id,
        ...label,
        used: used ?? 0,
        limit: limit ?? 0,
        resetHint: reset.resetHint,
        resetAtMs: reset.resetAtMs,
        periodHours: kimiPeriodHours(
            explicitLabel ?? fallbackLabel.label ?? fallbackLabel.labelKey,
            duration,
            timeUnit,
        ),
    }
}

export function buildKimiQuotaRows(payload: unknown, nowMs = Date.now()): KimiQuotaRow[] {
    const root                 = asRecord(payload)
    const rows: KimiQuotaRow[] = []
    const limits               = root?.limits

    if (Array.isArray(limits)) {
        limits.forEach((rawItem, index) => {
            const item = asRecord(rawItem)
            if (!item) {
                return
            }
            const detail   = asRecord(item.detail) ?? item
            const window   = asRecord(item.window) ?? {}
            const duration = integerValue(window.duration ?? item.duration ?? detail.duration)
            const timeUnit = window.timeUnit ?? window.time_unit ?? item.timeUnit ?? item.time_unit ??
                             detail.timeUnit ?? detail.time_unit
            const row      = toKimiRow(
                detail,
                kimiLimitLabel(item, detail, window, index),
                `limit-${index}`,
                nowMs,
                duration,
                timeUnit,
            )
            if (row) {
                rows.push(row)
            }
        })
    }

    const usage = asRecord(root?.usage)
    if (usage) {
        const summary = toKimiRow(usage, { labelKey: 'kimi_quota.weekly_limit' }, 'summary', nowMs)
        if (summary) {
            rows.push(summary)
        }
    }

    const monthly = asRecord(asRecord(root?.usages)?.limit_month_total)
    const monthlyRatio = numberValue(monthly?.used_ratio)
    if (monthly && monthlyRatio !== null && monthlyRatio >= 0) {
        const used = Math.round(monthlyRatio * 100)
        if (Number.isSafeInteger(used)) {
            const row = toKimiRow(
                {used, limit: 100, reset_time: monthly.reset_time},
                {labelKey: 'kimi_quota.monthly_limit'}, 'monthly', nowMs,
            )
            if (row) {
                rows.push(row)
            }
        }
    }

    if (rows.length > 0) {
        return rows
    }

    const legacyRows = Array.isArray(payload) ? payload : Array.isArray(root?.usages) ? root.usages : []
    return legacyRows.flatMap((rawRow, index) => {
        const row = asRecord(rawRow)
        if (!row) {
            return []
        }
        const id     = stringValue(row.id ?? row.name ?? row.label) ?? `row-${index}`
        const label  = stringValue(row.label ?? row.name ?? row.id) ?? id
        const mapped = toKimiRow(row, { label }, id, nowMs)
        return mapped ? [mapped] : []
    })
}

const claudeWindowDefinitions = [
    { key: 'five_hour', id: 'five-hour', labelKey: 'credentials.quota_window_five_hour', periodHours: 5 },
    { key: 'seven_day', id: 'seven-day', labelKey: 'credentials.quota_window_seven_day', periodHours: 168 },
    {
        key: 'seven_day_oauth_apps',
        id: 'seven-day-oauth-apps',
        labelKey: 'credentials.quota_window_seven_day_oauth_apps',
        periodHours: 168,
    },
    {
        key: 'seven_day_opus',
        id: 'seven-day-opus',
        labelKey: 'credentials.quota_window_seven_day_opus',
        periodHours: 168,
    },
    {
        key: 'seven_day_sonnet',
        id: 'seven-day-sonnet',
        labelKey: 'credentials.quota_window_seven_day_sonnet',
        periodHours: 168,
    },
    {
        key: 'seven_day_cowork',
        id: 'seven-day-cowork',
        labelKey: 'credentials.quota_window_seven_day_cowork',
        periodHours: 168,
    },
    {
        key: 'iguana_necktie',
        id: 'seven-day-fable',
        labelKey: 'credentials.quota_window_seven_day_fable',
        periodHours: 168,
    },
] as const

function findFableLimit(usage: Record<string, unknown>): ClaudeUsageLimit | null {
    if (!Array.isArray(usage.limits)) {
        return null
    }
    const candidates = usage.limits.filter((rawLimit): rawLimit is ClaudeUsageLimit => {
        const limit = asRecord(rawLimit)
        if (!limit) {
            return false
        }
        const kind        = stringValue(limit.kind)?.toLowerCase()
        const displayName = stringValue(asRecord(asRecord(limit.scope)?.model)?.display_name)?.toLowerCase()
        return kind === 'weekly_scoped' &&
               (displayName === 'fable' || displayName === 'fable 5') &&
               numberValue(limit.percent) !== null
    })
    return candidates.find((limit) => limit.is_active === true) ?? candidates[0] ?? null
}

export function buildClaudeQuotaWindows(
    usage: Record<string, unknown>,
    translate: (key: string) => string,
): ClaudeQuotaWindow[] {
    const windows: ClaudeQuotaWindow[] = []
    const fableLimit                   = findFableLimit(usage)

    for (const definition of claudeWindowDefinitions) {
        const window       = asRecord(usage[definition.key])
        const isCreditPool = definition.key === 'iguana_necktie' &&
                             ['limit_dollars', 'used_dollars', 'remaining_dollars']
                                 .some((key) => numberValue(window?.[key]) !== null)
        if (definition.key === 'iguana_necktie' && fableLimit && !isCreditPool) {
            continue
        }
        const usedPercent = numberValue(window?.utilization)
        if (!window || (usedPercent === null && !isCreditPool)) {
            continue
        }
        const reset    = stringValue(window.resets_at)
        const labelKey = isCreditPool ? 'claude_quota.cloud_session_credits' : definition.labelKey
        windows.push({
                         id: isCreditPool ? 'cloud-session-credits' : definition.id,
                         label: translate(labelKey),
                         labelKey,
                         usedPercent,
                         resetLabel: formatQuotaResetTime(reset ?? undefined),
                         resetAtMs: resolveResetMs([reset]),
                         periodHours: isCreditPool ? null : definition.periodHours,
                     })
    }

    if (fableLimit) {
        const usedPercent = numberValue(fableLimit.percent)
        if (usedPercent !== null) {
            const reset    = stringValue(fableLimit.resets_at)
            const labelKey = 'credentials.quota_window_seven_day_fable'
            windows.push({
                             id: 'seven-day-fable',
                             label: translate(labelKey),
                             labelKey,
                             usedPercent,
                             resetLabel: formatQuotaResetTime(reset ?? undefined),
                             resetAtMs: resolveResetMs([reset]),
                             periodHours: 168,
                         })
        }
    }

    return windows
}
