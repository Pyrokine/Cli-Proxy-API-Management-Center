export function parseIsoToMs(value: unknown): number | null {
    if (typeof value !== 'string') {
        return null
    }
    const trimmed = value.trim()
    if (!trimmed) {
        return null
    }
    const normalized = trimmed.replace(/(?<microseconds>\.\d{6})\d+/, '$<microseconds>')
    const parsed     = new Date(normalized).getTime()
    return Number.isFinite(parsed) ? parsed : null
}

function parseUnixToMs(value: unknown): number | null {
    const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim()) : Number.NaN
    if (!Number.isFinite(numeric) || numeric <= 0) {
        return null
    }
    return numeric < 1e11 ? numeric * 1000 : numeric
}

export function parseOffsetSecondsToMs(value: unknown, nowMs: number): number | null {
    const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim()) : Number.NaN
    if (!Number.isFinite(numeric) || numeric <= 0) {
        return null
    }
    return nowMs + numeric * 1000
}

export function resolveResetMs(candidates: readonly unknown[]): number | null {
    for (const candidate of candidates) {
        const iso = parseIsoToMs(candidate)
        if (iso !== null) {
            return iso
        }
        const unix = parseUnixToMs(candidate)
        if (unix !== null) {
            return unix
        }
    }
    return null
}
