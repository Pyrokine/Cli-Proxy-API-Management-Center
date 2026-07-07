/**
 * Formatting functions for quota display.
 */

import {getEffectiveTimezone} from '@/stores/useTimezoneStore'

const shanghaiDateTimeFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
})

export function formatQuotaResetTime(value?: string): string {
    if (!value) {
        return '-'
    }
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) {
        return '-'
    }
    const timeZone = getEffectiveTimezone()
    return date.toLocaleString(undefined, {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        ...(timeZone ? { timeZone } : {}),
    })
}

export function formatShanghaiDateTime(value: string): string {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) {
        return ''
    }
    return shanghaiDateTimeFormatter.format(date).replace(',', '')
}
