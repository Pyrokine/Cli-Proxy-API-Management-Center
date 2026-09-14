/**
 * 自定义请求头处理工具
 */

export interface HeaderEntry {
    key: string
    value: string
}

export function buildHeaderObject(
    input?: HeaderEntry[] | Record<string, string | undefined | null>,
): Record<string, string> {
    if (!input) {
        return {}
    }

    if (Array.isArray(input)) {
        return input.reduce<Record<string, string>>((acc, item) => {
            const key   = item?.key?.trim()
            const value = item?.value?.trim()
            if (key && value !== undefined && value !== null && value !== '') {
                acc[key] = value
            }
            return acc
        }, {})
    }

    return Object.entries(input).reduce<Record<string, string>>((acc, [rawKey, rawValue]) => {
        const key   = rawKey?.trim()
        const value = typeof rawValue === 'string' ? rawValue.trim() : rawValue
        if (key && value !== undefined && value !== null && value !== '') {
            acc[key] = String(value)
        }
        return acc
    }, {})
}

export function headersToEntries(headers?: Record<string, string | undefined | null>): HeaderEntry[] {
    if (!headers || typeof headers !== 'object') {
        return []
    }
    return Object.entries(headers)
                 .filter(([, value]) => value !== undefined && value !== null && value !== '')
                 .map(([key, value]) => ({ key, value: String(value) }))
}

export const hasHeader = (headers: Record<string, string>, name: string) => {
    const target = name.toLowerCase()
    return Object.keys(headers).some((key) => key.toLowerCase() === target)
}

const headerValuesByName = (entries: HeaderEntry[]) => {
    const values = new Map<string, string[]>()
    entries.forEach((entry) => {
        const name = entry.key.trim().toLowerCase()
        if (!name) {
            return
        }
        const current = values.get(name) ?? []
        current.push(entry.value)
        values.set(name, current)
    })
    values.forEach((items) => items.sort())
    return values
}

export const getChangedHeaderNames = (previous: HeaderEntry[], next: HeaderEntry[]): string[] => {
    const before = headerValuesByName(previous)
    const after  = headerValuesByName(next)
    const names  = new Set([...before.keys(), ...after.keys()])
    return Array.from(names).filter(
        (name) => JSON.stringify(before.get(name) ?? []) !== JSON.stringify(after.get(name) ?? []),
    )
}

export const normalizeHeaderEntries = (entries: HeaderEntry[]) =>
    (entries ?? [])
        .map((entry) => ({
            key: String(entry?.key ?? '').trim(),
            value: String(entry?.value ?? '').trim(),
        }))
        .filter((entry) => entry.key || entry.value)
        .sort((a, b) => {
            const byKey = a.key.toLowerCase().localeCompare(b.key.toLowerCase())
            if (byKey !== 0) {
                return byKey
            }
            return a.value.localeCompare(b.value)
        })
