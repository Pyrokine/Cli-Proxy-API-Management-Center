import {describe, expect, it} from 'bun:test'
import {
    MIN_USAGE_EVENTS_AUTO_REFRESH_MS,
    resolveUsageEventsAutoRefreshMs,
    shouldRefreshUsageEvents,
    USAGE_EVENTS_AUTO_REFRESH_INTERVALS,
} from '@/utils/autoRefresh'

describe('usage events auto refresh', () => {
    it('keeps every configured interval at or above 30 seconds', () => {
        expect(resolveUsageEventsAutoRefreshMs(undefined)).toBe(MIN_USAGE_EVENTS_AUTO_REFRESH_MS)
        expect(resolveUsageEventsAutoRefreshMs(3)).toBe(MIN_USAGE_EVENTS_AUTO_REFRESH_MS)
        expect(resolveUsageEventsAutoRefreshMs(30)).toBe(MIN_USAGE_EVENTS_AUTO_REFRESH_MS)
        expect(resolveUsageEventsAutoRefreshMs(60)).toBe(60_000)
        expect(USAGE_EVENTS_AUTO_REFRESH_INTERVALS.map((option) => option.value)).toEqual(['30000', '60000'])
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
