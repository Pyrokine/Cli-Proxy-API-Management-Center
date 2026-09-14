import {createSharedClock} from '@/utils/time/sharedClock'
import {describe, expect, test} from 'bun:test'

describe('shared clock', () => {
    test('shares one timer and clears it after the last subscriber', () => {
        let created  = 0
        let cleared  = 0
        const timers = new Map<number, () => void>()
        const clock  = createSharedClock({
                                             now: () => 1000,
                                             setTimer: (callback) => {
                                                 created += 1
                                                 timers.set(created, callback)
                                                 return created
                                             },
                                             clearTimer: (id) => {
                                                 cleared += 1
                                                 timers.delete(id as number)
                                             },
                                         })

        const offA = clock.subscribe(() => {
        })
        const offB = clock.subscribe(() => {
        })
        expect(created).toBe(1)
        expect(clock.subscriberCount()).toBe(2)

        offA()
        expect(cleared).toBe(0)
        offB()
        expect(cleared).toBe(1)
        expect(clock.subscriberCount()).toBe(0)
    })

    test('keeps the snapshot stable until the shared timer ticks', () => {
        let now     = 1000
        let tick    = () => {
        }
        const clock = createSharedClock({
                                            now: () => now,
                                            setTimer: (callback) => {
                                                tick = callback
                                                return 1
                                            },
                                        })
        clock.subscribe(() => {
        })
        const initial = clock.getSnapshot()
        now += 60_000
        expect(clock.getSnapshot()).toBe(initial)
        tick()
        expect(clock.getSnapshot()).toBe(now)
    })
})
