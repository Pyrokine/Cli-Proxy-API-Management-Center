import {expect, test} from 'bun:test'
import {sourceCallback} from './sourceCallbacks'

test('dashboard greeting uses the same selected timezone as the displayed date and time', () => {
    const timeOfDay = sourceCallback<(time: Date, timezone?: string) => string>(
        'pages/DashboardPage.tsx',
        'getTimeOfDay',
        {},
    )
    const instant   = new Date('2026-10-23T23:45:00Z')

    expect(timeOfDay(instant, 'Asia/Tokyo')).toBe('morning')
    expect(timeOfDay(instant, 'America/Los_Angeles')).toBe('afternoon')
    expect(timeOfDay(instant, 'UTC')).toBe('night')
    expect(timeOfDay(new Date('2026-10-24T00:00:00Z'), 'UTC')).toBe('night')
})
