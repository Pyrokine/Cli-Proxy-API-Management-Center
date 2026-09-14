import {getNextAntigravityCountdownUpdateDelay, resolveAntigravityNowMs} from '@/utils/quota/antigravityCountdown'
import {describe, expect, test} from 'bun:test'

const MINUTE_MS = 60_000

describe('Antigravity countdown scheduling', () => {
    test('uses the provider clock offset supplied by the backend', () => {
        expect(resolveAntigravityNowMs(10 * MINUTE_MS, 2 * MINUTE_MS)).toBe(12 * MINUTE_MS)
        expect(resolveAntigravityNowMs(10 * MINUTE_MS, null)).toBe(10 * MINUTE_MS)
        expect(resolveAntigravityNowMs(10 * MINUTE_MS, Number.NaN)).toBe(10 * MINUTE_MS)
    })

    test('updates at the nearest rounded-minute boundary', () => {
        expect(getNextAntigravityCountdownUpdateDelay([10.5 * MINUTE_MS], 0)).toBe(30_000)
        expect(getNextAntigravityCountdownUpdateDelay([10 * MINUTE_MS], 0)).toBe(MINUTE_MS)
    })

    test('uses the earliest boundary and stops after expiry', () => {
        expect(getNextAntigravityCountdownUpdateDelay(
            [10.75 * MINUTE_MS, 3.25 * MINUTE_MS],
            0,
        )).toBe(15_000)
        expect(getNextAntigravityCountdownUpdateDelay([0, Number.NaN], MINUTE_MS)).toBeNull()
    })
})
