import {
    MIN_USAGE_EVENTS_AUTO_REFRESH_MS,
    resolveUsageEventsAutoRefreshMs,
    shouldRefreshUsageEvents,
    USAGE_EVENTS_AUTO_REFRESH_INTERVALS,
} from '@/utils/autoRefresh'
import {describe, expect, it} from 'bun:test'

describe('usage events auto refresh', () => {
    it('shares all six intervals with a 3-second default and minimum', () => {
        expect(MIN_USAGE_EVENTS_AUTO_REFRESH_MS).toBe(3000)
        expect(resolveUsageEventsAutoRefreshMs(undefined)).toBe(3000)
        expect(resolveUsageEventsAutoRefreshMs(0)).toBe(3000)
        expect(resolveUsageEventsAutoRefreshMs(3)).toBe(3000)
        expect(resolveUsageEventsAutoRefreshMs(5)).toBe(5000)
        expect(resolveUsageEventsAutoRefreshMs(8)).toBe(8000)
        expect(resolveUsageEventsAutoRefreshMs(15)).toBe(15000)
        expect(resolveUsageEventsAutoRefreshMs(30)).toBe(30000)
        expect(resolveUsageEventsAutoRefreshMs(60)).toBe(60000)
        expect(USAGE_EVENTS_AUTO_REFRESH_INTERVALS.map((option) => option.value))
            .toEqual(['3000', '5000', '8000', '15000', '30000', '60000'])
    })

    it('allows refresh only for a visible first-page 24-hour timestamp view', () => {
        const eligible = {
            activePreset: '24h',
            enabled: true,
            page: 1,
            sortField: 'timestampMs',
            sortDir: 'desc',
            pageVisible: true,
            busy: false,
        }
        expect(shouldRefreshUsageEvents(eligible)).toBe(true)
        expect(shouldRefreshUsageEvents({ ...eligible, activePreset: '7d' })).toBe(false)
        expect(shouldRefreshUsageEvents({ ...eligible, activePreset: '30d' })).toBe(false)
        expect(shouldRefreshUsageEvents({ ...eligible, activePreset: 'all' })).toBe(false)
        expect(shouldRefreshUsageEvents({ ...eligible, activePreset: undefined })).toBe(false)
        expect(shouldRefreshUsageEvents({ ...eligible, enabled: false })).toBe(false)
        expect(shouldRefreshUsageEvents({ ...eligible, page: 2 })).toBe(false)
        expect(shouldRefreshUsageEvents({ ...eligible, sortField: 'model' })).toBe(false)
        expect(shouldRefreshUsageEvents({ ...eligible, sortDir: 'asc' })).toBe(false)
        expect(shouldRefreshUsageEvents({ ...eligible, pageVisible: false })).toBe(false)
        expect(shouldRefreshUsageEvents({ ...eligible, busy: true })).toBe(false)
    })
})
