import {getEffectiveTimezone} from '@/stores/useTimezoneStore'
import {DAY_MS, HOUR_MS, MINUTE_MS} from '@/utils/time/durations'

interface RelativeTimeParts {
    value: number
    unit: 'day' | 'hour' | 'minute'
}

interface ResetDisplay {
    absolute: string
    relative: string | null
}

export function relativeTimeParts(targetMs: number, nowMs: number): RelativeTimeParts {
    const delta         = targetMs - nowMs
    const sign          = delta < 0 ? -1 : 1
    const absoluteDelta = Math.abs(delta)

    if (absoluteDelta >= DAY_MS) {
        return { value: sign * Math.floor(absoluteDelta / DAY_MS), unit: 'day' }
    }
    if (absoluteDelta >= HOUR_MS) {
        return { value: sign * Math.floor(absoluteDelta / HOUR_MS), unit: 'hour' }
    }
    return { value: sign * Math.max(1, Math.floor(absoluteDelta / MINUTE_MS)), unit: 'minute' }
}

const relativeFormatters = new Map<string, Intl.RelativeTimeFormat>()

function relativeFormatter(locale?: string): Intl.RelativeTimeFormat {
    const key    = locale ?? ''
    const cached = relativeFormatters.get(key)
    if (cached) {
        return cached
    }

    let formatter: Intl.RelativeTimeFormat
    try {
        formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'always' })
    } catch {
        formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'always' })
    }
    relativeFormatters.set(key, formatter)
    return formatter
}

function formatRelativeInstant(targetMs: number, nowMs: number, locale?: string): string {
    const { value, unit } = relativeTimeParts(targetMs, nowMs)
    return relativeFormatter(locale).format(value, unit)
}

export function formatInstantShort(ms: number): string {
    if (!Number.isFinite(ms)) {
        return '-'
    }
    const timeZone = getEffectiveTimezone()
    return new Date(ms).toLocaleString(undefined, {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        ...(timeZone ? { timeZone } : {}),
    })
}

export function buildResetDisplay(
    absoluteLabel: string | undefined | null,
    resetAtMs: number | undefined | null,
    nowMs: number,
    locale?: string,
): ResetDisplay | null {
    const trimmed       = typeof absoluteLabel === 'string' ? absoluteLabel.trim() : ''
    const absolute      = trimmed && trimmed !== '-' ? trimmed : null
    const usableResetMs = typeof resetAtMs === 'number' && Number.isFinite(resetAtMs) ? resetAtMs : null

    if (absolute === null && usableResetMs === null) {
        return null
    }

    return {
        absolute: absolute ?? formatInstantShort(usableResetMs as number),
        relative: usableResetMs === null ? null : formatRelativeInstant(usableResetMs, nowMs, locale),
    }
}
