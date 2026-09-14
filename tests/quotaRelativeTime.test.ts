import {buildResetDisplay, relativeTimeParts} from '@/utils/quota/relativeTime'
import {DAY_MS, HOUR_MS} from '@/utils/time/durations'
import {describe, expect, test} from 'bun:test'

const NOW = Date.parse('2026-08-02T12:00:00Z')

describe('quota relative time', () => {
    test('keeps past values signed instead of showing them as future', () => {
        expect(relativeTimeParts(NOW - 3 * DAY_MS, NOW)).toEqual({ value: -3, unit: 'day' })
        expect(relativeTimeParts(NOW - 2 * HOUR_MS, NOW)).toEqual({ value: -2, unit: 'hour' })
    })

    test('pairs an absolute label with a live relative label', () => {
        const display = buildResetDisplay('08-02 14:00', NOW + 2 * HOUR_MS, NOW, 'en')
        expect(display?.absolute).toBe('08-02 14:00')
        expect(display?.relative).toContain('2 hours')
    })

    test('derives a concrete absolute label when only the instant is known', () => {
        const display = buildResetDisplay(undefined, NOW + HOUR_MS, NOW, 'en')
        expect(display?.absolute).not.toBe('-')
        expect(display?.relative).toContain('1 hour')
    })
})
