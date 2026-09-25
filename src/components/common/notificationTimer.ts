interface TimerClock {
    now: () => number
    schedule: (callback: () => void, delay: number) => unknown
    cancel: (handle: unknown) => void
}

const clock: TimerClock = {
    now: () => performance.now(),
    schedule: (callback, delay) => setTimeout(callback, delay),
    cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

export function createNotificationTimer(duration: number, onExpire: () => void, timing: TimerClock = clock) {
    let remaining = duration
    let startedAt = 0
    let handle: unknown
    let running = false
    let active = false
    let finished = false
    const pauses = new Set<string>()

    function stopCountdown() {
        if (!running) {
            return
        }
        remaining = Math.max(0, remaining - Math.max(0, timing.now() - startedAt))
        timing.cancel(handle)
        running = false
    }

    function resumeCountdown() {
        if (!active || finished || running || pauses.size || !(duration > 0)) {
            return
        }
        startedAt = timing.now()
        running = true
        handle = timing.schedule(() => {
            running = false
            active = false
            finished = true
            remaining = 0
            onExpire()
        }, remaining)
    }

    return {
        start() {
            active = true
            resumeCountdown()
        },
        setPaused(reason: 'hover' | 'focus' | 'hidden', paused: boolean) {
            if (finished) {
                return
            }
            if (paused) {
                pauses.add(reason)
                stopCountdown()
            } else {
                pauses.delete(reason)
                resumeCountdown()
            }
        },
        stop() {
            active = false
            stopCountdown()
        },
        dispose() {
            active = false
            finished = true
            stopCountdown()
            pauses.clear()
        },
    }
}
