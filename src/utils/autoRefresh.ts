/**
 * Auto-refresh interval options shared by the usage events table and the logs page.
 * Default 3s matches the shortest cache-friendly refresh window; 60s is the longest
 * practical option before operators forget the page is live.
 */
interface AutoRefreshOption {
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

const DEFAULT_AUTO_REFRESH_MS = 3000

export function resolveAutoRefreshMs(seconds?: number | null): number {
    if (seconds === undefined || seconds === null) {
        return DEFAULT_AUTO_REFRESH_MS
    }
    if (seconds <= 0) {
        return 0
    }
    return seconds * 1000
}

export const MIN_USAGE_EVENTS_AUTO_REFRESH_MS = 30_000

export const USAGE_EVENTS_AUTO_REFRESH_INTERVALS = AUTO_REFRESH_INTERVALS.filter(
    (option) => Number(option.value) >= MIN_USAGE_EVENTS_AUTO_REFRESH_MS,
)

export function resolveUsageEventsAutoRefreshMs(seconds?: number | null): number {
    return Math.max(resolveAutoRefreshMs(seconds), MIN_USAGE_EVENTS_AUTO_REFRESH_MS)
}

interface UsageEventsAutoRefreshState {
    activePreset?: string
    enabled: boolean
    page: number
    sortField: string
    sortDir: string
    pageVisible: boolean
    busy: boolean
}

export function shouldRefreshUsageEvents(state: UsageEventsAutoRefreshState): boolean {
    return state.activePreset === '24h' &&
           state.enabled &&
           state.page === 1 &&
           state.sortField === 'timestampMs' &&
           state.sortDir === 'desc' &&
           state.pageVisible &&
           !state.busy
}
