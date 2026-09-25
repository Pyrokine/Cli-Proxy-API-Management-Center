import {afterEach, describe, expect, spyOn, test} from 'bun:test'
import {readFileSync} from 'node:fs'
import {createNotificationTimer} from '@/components/common/notificationTimer'
import {useNotificationStore} from '@/stores/useNotificationStore'

const initialState = useNotificationStore.getInitialState()
afterEach(() => useNotificationStore.setState(initialState, true))

function createClock() {
    let now = 0
    let nextId = 0
    const scheduled = new Map<number, {callback: () => void; at: number}>()
    const clock = {
        now: () => now,
        schedule: (callback: () => void, delay: number) => {
            const id = ++nextId
            scheduled.set(id, {callback, at: now + delay})
            return id
        },
        cancel: (handle: unknown) => { scheduled.delete(handle as number) },
    }
    return {
        clock,
        pending: () => scheduled.size,
        advance: (elapsed: number) => {
            const end = now + elapsed
            while (true) {
                const due = [...scheduled.entries()].filter(([, entry]) => entry.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
                if (!due) {
                    break
                }
                now = due[1].at
                scheduled.delete(due[0])
                due[1].callback()
            }
            now = end
        },
    }
}

describe('notification readable-time expiry', () => {
    test('does not schedule while being created and expires exactly once after start', () => {
        const clock = createClock()
        let expired = 0
        const timer = createNotificationTimer(1000, () => ++expired, clock.clock)
        expect(clock.pending()).toBe(0)
        timer.start()
        timer.start()
        expect(clock.pending()).toBe(1)
        clock.advance(999)
        expect(expired).toBe(0)
        clock.advance(1)
        expect(expired).toBe(1)
        timer.start()
        timer.setPaused('hover', false)
        clock.advance(10000)
        expect(expired).toBe(1)
        expect(clock.pending()).toBe(0)
    })

    test('overlapping hover, focus and hidden pauses resume only when all are cleared', () => {
        const clock = createClock()
        let expired = 0
        const timer = createNotificationTimer(1000, () => ++expired, clock.clock)
        timer.start()
        clock.advance(250)
        timer.setPaused('hover', true)
        timer.setPaused('hover', true)
        timer.setPaused('focus', true)
        timer.setPaused('hidden', true)
        expect(clock.pending()).toBe(0)
        clock.advance(50000)
        timer.setPaused('hover', false)
        timer.setPaused('hidden', false)
        timer.setPaused('hidden', false)
        expect(clock.pending()).toBe(0)
        expect(expired).toBe(0)
        timer.setPaused('focus', false)
        expect(clock.pending()).toBe(1)
        clock.advance(749)
        expect(expired).toBe(0)
        clock.advance(1)
        expect(expired).toBe(1)
    })

    test('effect cleanup and restart retain the remaining time', () => {
        const clock = createClock()
        let expired = 0
        const timer = createNotificationTimer(1000, () => ++expired, clock.clock)
        timer.start()
        clock.advance(400)
        timer.stop()
        expect(clock.pending()).toBe(0)
        clock.advance(9000)
        timer.start()
        timer.stop()
        timer.start()
        clock.advance(599)
        expect(expired).toBe(0)
        clock.advance(1)
        expect(expired).toBe(1)
    })

    test('starting in a hidden tab does not consume readable time', () => {
        const clock = createClock()
        let expired = 0
        const timer = createNotificationTimer(1000, () => ++expired, clock.clock)
        timer.setPaused('hidden', true)
        timer.start()
        clock.advance(10000)
        expect(expired).toBe(0)
        timer.setPaused('hidden', false)
        clock.advance(1000)
        expect(expired).toBe(1)
    })

    test('dispose cancels pending expiry and prevents restart', () => {
        const clock = createClock()
        let expired = 0
        const timer = createNotificationTimer(1000, () => ++expired, clock.clock)
        timer.start()
        clock.advance(300)
        timer.dispose()
        timer.start()
        timer.setPaused('focus', false)
        clock.advance(10000)
        expect(clock.pending()).toBe(0)
        expect(expired).toBe(0)
    })

    test('persistent notifications never create automatic removal timers', () => {
        for (const duration of [0, -1]) {
            const clock = createClock()
            let expired = 0
            const timer = createNotificationTimer(duration, () => ++expired, clock.clock)
            timer.start()
            timer.setPaused('hover', true)
            timer.setPaused('hover', false)
            clock.advance(10000)
            expect(clock.pending()).toBe(0)
            expect(expired).toBe(0)
        }
    })

    test('store queues all durations without scheduling a background timeout', () => {
        const timeout = spyOn(globalThis, 'setTimeout')
        try {
            for (const duration of [undefined, 0, -1, 100]) {
                useNotificationStore.getState().showNotification('Synthetic notification', 'info', duration)
            }
            const notifications = useNotificationStore.getState().notifications
            expect(notifications).toHaveLength(4)
            expect(new Set(notifications.map(({id}) => id)).size).toBe(4)
            expect(notifications.slice(1).map(({duration}) => duration)).toEqual([0, -1, 100])
            expect(timeout).not.toHaveBeenCalled()
        } finally {
            timeout.mockRestore()
        }
    })

    test('removing a toast preserves other toasts, confirmation and notification history', () => {
        const store = useNotificationStore.getState()
        store.showNotification('First', 'info', 0)
        store.showNotification('Second', 'error', -1)
        store.addPersistentNotification('History', 'info', 'connection')
        let confirmations = 0
        store.showConfirmation({message: 'Synthetic confirmation', onConfirm: () => { ++confirmations }})
        store.setConfirmationLoading(true)
        const before = useNotificationStore.getState()
        const [first, second] = before.notifications
        store.removeNotification(first!.id)
        store.removeNotification(first!.id)
        const after = useNotificationStore.getState()
        expect(after.notifications).toEqual([second])
        expect(after.persistentNotifications).toBe(before.persistentNotifications)
        expect(after.confirmation).toBe(before.confirmation)
        expect(after.confirmation.isOpen).toBe(true)
        expect(after.confirmation.isLoading).toBe(true)
        expect(confirmations).toBe(0)
    })

    test('history deduplication and clearing remain independent of toast lifetime', () => {
        const store = useNotificationStore.getState()
        store.showNotification('Visible toast', 'info', 0)
        store.addPersistentNotification('First update', 'info', 'version', {dedupeKey: 'synthetic'})
        const original = useNotificationStore.getState().persistentNotifications[0]!
        store.markAsRead(original.id)
        store.addPersistentNotification('Latest update', 'warning', 'version', {dedupeKey: 'synthetic'})
        const updated = useNotificationStore.getState().persistentNotifications
        expect(updated).toHaveLength(1)
        expect(updated[0]).toMatchObject({id: original.id, timestamp: original.timestamp, read: true, message: 'Latest update'})
        expect(store.unreadCount()).toBe(0)
        store.clearAllPersistent()
        expect(useNotificationStore.getState().persistentNotifications).toHaveLength(0)
        expect(useNotificationStore.getState().notifications).toHaveLength(1)
    })

    test('view owns both readable-time expiry and exit cleanup', () => {
        const store = readFileSync(new URL('../src/stores/useNotificationStore.ts', import.meta.url), 'utf8')
        const view = readFileSync(new URL('../src/components/common/NotificationContainer.tsx', import.meta.url), 'utf8')
        expect(store).not.toContain('setTimeout(')
        expect(view).toContain('createNotificationTimer(')
        expect(view).toContain('readableTimer.start()')
        expect(view).toContain('readableTimer.stop()')
        expect(view).toContain("document.removeEventListener('visibilitychange', syncVisibility)")
        expect(view).toContain('clearTimeout(exitTimer)')
        expect(view).toContain('inert={isExiting || undefined}')
        expect(view).toContain("aria-label={t('common.close')}")
        expect(view).toContain("type === 'error' ? 'alert' : 'status'")
        expect(view).toContain('event.stopPropagation()')
        expect(view).toContain('returnFocusRef.current')
    })
})
