/**
 * Auto-refresh interval options shared by the usage events table and the logs page.
 * Default 3s matches the shortest cache-friendly refresh window; 60s is the longest
 * practical option before operators forget the page is live.
 */
export interface AutoRefreshOption {
    value: string
    label: string
}

export const AUTO_REFRESH_INTERVALS: readonly AutoRefreshOption[] = [
    { value: '3000', label: '3s' },
    { value: '5000', label: '5s' },
    { value: '8000', label: '8s' },
    { value: '15000', label: '15s' },
    { value: '30000', label: '30s' },
    { value: '60000', label: '60s' },
] as const

export const DEFAULT_AUTO_REFRESH_MS = 3000

export function resolveAutoRefreshMs(seconds?: number | null): number {
    if (seconds === undefined || seconds === null) {
        return DEFAULT_AUTO_REFRESH_MS
    }
    if (seconds <= 0) {
        return 0
    }
    return seconds * 1000
}
