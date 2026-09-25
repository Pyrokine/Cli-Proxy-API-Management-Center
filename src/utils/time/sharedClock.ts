import {MINUTE_MS, SECOND_MS} from './durations'

interface SharedClock {
    subscribe(listener: () => void): () => void

    getSnapshot(): number
}

interface SharedClockOptions {
    intervalMs?: number
    now?: () => number
    setTimer?: (callback: () => void, intervalMs: number) => unknown
    clearTimer?: (timerId: unknown) => void
}

interface TestableSharedClock extends SharedClock {
    subscriberCount(): number
}

export function createSharedClock(options: SharedClockOptions = {}): TestableSharedClock {
    const {
              intervalMs = MINUTE_MS,
              now        = Date.now,
              setTimer   = (callback, delay) => setInterval(callback, delay),
              clearTimer = (timerId) => clearInterval(timerId as ReturnType<typeof setInterval>),
          }              = options
    const listeners      = new Set<() => void>()
    let current          = now()
    let timerId: unknown = null

    const tick = () => {
        current = now()
        listeners.forEach((listener) => listener())
    }

    return {
        subscribe(listener) {
            listeners.add(listener)
            if (timerId === null) {
                current = now()
                timerId = setTimer(tick, intervalMs)
            }
            let subscribed = true
            return () => {
                if (!subscribed) {
                    return
                }
                subscribed = false
                listeners.delete(listener)
                if (listeners.size === 0 && timerId !== null) {
                    clearTimer(timerId)
                    timerId = null
                }
            }
        },
        getSnapshot() {
            return current
        },
        subscriberCount() {
            return listeners.size
        },
    }
}

export const SECOND_CLOCK: SharedClock = createSharedClock({intervalMs: SECOND_MS})
export const MINUTE_CLOCK: SharedClock = createSharedClock()
