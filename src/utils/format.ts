/**
 * 格式化工具函数
 * 从原项目 src/utils/string.js 迁移
 */

import { getEffectiveTimezone } from '@/stores/useTimezoneStore'

const resolveDefaultLocale = (): string | undefined => {
    const fromDocument = typeof document !== 'undefined' ? document.documentElement?.lang?.trim() : ''
    if (fromDocument) {
        return fromDocument
    }
    const fromNavigator = typeof navigator !== 'undefined' ? navigator.language?.trim() : ''
    return fromNavigator || undefined
}

/**
 * 隐藏 API Key 中间部分，保留前 2 位和后 2 位便于识别
 */
export function maskApiKey(key: string): string {
    const trimmed = String(key || '').trim()
    if (!trimmed) {
        return ''
    }

    if (trimmed.length <= 4) {
        return '***'
    }

    return trimmed.slice(0, 2) + '****' + trimmed.slice(-2)
}

/**
 * 格式化文件大小
 */
export function formatFileSize(bytes: number): string {
    if (bytes === 0) {
        return '0 B'
    }

    const units = ['B', 'KB', 'MB', 'GB']
    const k = 1024
    const i = Math.floor(Math.log(bytes) / Math.log(k))

    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${units[i]}`
}

/**
 * 格式化日期时间
 */
export function formatDateTime(date: string | Date, locale?: string): string {
    if (typeof date === 'string' && (!date.trim() || date.trim().toLowerCase() === 'unknown')) {
        return '-'
    }

    const d = typeof date === 'string' ? new Date(date) : date

    if (isNaN(d.getTime())) {
        return '-'
    }

    const resolvedLocale = locale?.trim() || resolveDefaultLocale()
    const timeZone = getEffectiveTimezone()
    return d.toLocaleString(resolvedLocale, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
        ...(timeZone ? { timeZone } : {}),
    })
}

// formatLogTimestamp converts a backend log timestamp ("YYYY-MM-DD HH:MM:SS",
// always UTC because the cli-proxy-api server runs with TZ=UTC) into a
// localized string honoring the user's timezone preference. Without the
// explicit "Z" suffix new Date() would parse the string as the *browser's*
// local time, double-shifting requests recorded in UTC and leaving the logs
// view 8 hours behind for users in Asia/Shanghai.
export function formatLogTimestamp(raw: string | undefined, locale?: string): string {
    if (!raw) {
        return ''
    }
    const trimmed = raw.trim()
    if (!trimmed) {
        return ''
    }
    // Already an ISO string with timezone designator? Hand off as-is.
    if (/[Tt]/.test(trimmed) && (/[Zz]$/.test(trimmed) || /[+-]\d\d:?\d\d$/.test(trimmed))) {
        return formatDateTime(trimmed, locale)
    }
    // "YYYY-MM-DD HH:MM:SS" → treat as UTC.
    const utc = trimmed.replace(' ', 'T') + 'Z'
    const d = new Date(utc)
    if (isNaN(d.getTime())) {
        return raw
    }
    return formatDateTime(d, locale)
}

/**
 * 将 Unix 时间戳（秒/毫秒/微秒/纳秒）格式化为本地时间字符串
 */
export function formatUnixTimestamp(value: unknown, locale?: string): string {
    if (value === null || value === undefined || value === '') {
        return ''
    }

    const asNumber = typeof value === 'number' ? value : Number(value)
    const date = (() => {
        if (!Number.isFinite(asNumber) || Number.isNaN(asNumber)) {
            return new Date(String(value))
        }

        const abs = Math.abs(asNumber)

        // 秒：常见 10 位（~1e9）
        if (abs < 1e11) {
            return new Date(asNumber * 1000)
        }

        // 毫秒：常见 13 位（~1e12）
        if (abs < 1e14) {
            return new Date(asNumber)
        }

        // 微秒：常见 16 位（~1e15）
        if (abs < 1e17) {
            return new Date(Math.round(asNumber / 1000))
        }

        // 纳秒：常见 19 位（~1e18）
        return new Date(Math.round(asNumber / 1e6))
    })()

    if (Number.isNaN(date.getTime())) {
        return ''
    }
    const timeZone: string | undefined = getEffectiveTimezone() || undefined
    const opts: Intl.DateTimeFormatOptions = {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
        ...(timeZone ? { timeZone } : {}),
    }
    return locale ? date.toLocaleString(locale, opts) : date.toLocaleString(undefined, opts)
}

/**
 * 智能展示 API Key：有配置别名 → 显示别名；无别名 → 脱敏展示
 */
export function formatKeyDisplay(key: string, aliases?: Record<string, string>): string {
    const alias = aliases?.[key]
    return alias ?? maskApiKey(key)
}

export function formatNumber(value: number, locale?: string): string {
    const resolvedLocale = locale?.trim() || resolveDefaultLocale()
    return new Intl.NumberFormat(resolvedLocale).format(value)
}

/**
 * 从可能包含多种格式的 API Key 列表中提取并去重
 */
export function normalizeApiKeyList(input: unknown): string[] {
    if (!Array.isArray(input)) {
        return []
    }
    const seen = new Set<string>()
    const keys: string[] = []

    input.forEach((item) => {
        const record =
            item !== null && typeof item === 'object' && !Array.isArray(item) ? (item as Record<string, unknown>) : null
        const value =
            typeof item === 'string'
                ? item
                : record
                  ? (record['api-key'] ?? record['apiKey'] ?? record.key ?? record.Key)
                  : ''
        const trimmed = String(value ?? '').trim()
        if (!trimmed || seen.has(trimmed)) {
            return
        }
        seen.add(trimmed)
        keys.push(trimmed)
    })

    return keys
}

/**
 * 将 Date 转为 datetime-local 输入框所需的 "YYYY-MM-DDTHH:mm" 格式
 */
export function toLocalDateTimeString(date: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0')
    const datePart = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    const timePart = `${pad(date.getHours())}:${pad(date.getMinutes())}`
    return `${datePart}T${timePart}`
}

export function toLocalDateTimeSecondsString(date: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0')
    const datePart = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    const timePart = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
    return `${datePart}T${timePart}`
}
