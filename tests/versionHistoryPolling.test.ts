import {describe, expect, mock, test} from 'bun:test'
import type {UpdateStatus} from '../src/services/api/update'
import {sourceCallback, sourceInitializer} from './sourceCallbacks'

const file = 'components/system/VersionHistoryModal.tsx'
const interval = sourceInitializer<number>(file, 'UPDATE_POLL_INTERVAL', {})
const reconnectTimeout = sourceInitializer<number>(file, 'UPDATE_POLL_RECONNECT_TIMEOUT', {})
const replacing: UpdateStatus = {
    status: 'replacing', message: 'Restarting', target_version: 'v8.0.23-aug.3',
    current_version: '8.0.23-aug.2', percent: 80,
}
const done: UpdateStatus = {...replacing, status: 'done', message: 'Health checks passed', current_version: '8.0.23-aug.3', percent: 100}

type StatusReply = UpdateStatus | Error | Promise<UpdateStatus>

function harness(replies: StatusReply[], {
    open = true, target = 'cpa', initialStatus = replacing as UpdateStatus | null,
    updatingVersion = replacing.target_version as string | null, versionError = false,
}: {
    open?: boolean
    target?: string
    initialStatus?: UpdateStatus | null
    updatingVersion?: string | null
    versionError?: boolean
} = {}) {
    let now = 0
    let generation = 0
    let timerID = 0
    const timers = new Map<number, {at: number; callback: () => void}>()
    const state = {status: initialStatus, pollError: null as string | null, pollingReady: true, updatingVersion}
    const submittedUpdate = {current: initialStatus ? {
        authGeneration: generation, visible: true, status: initialStatus, pollError: null as string | null, pollingReady: true,
    } : null}
    const signals: AbortSignal[] = []
    const status = mock(async ({signal}: {signal: AbortSignal}) => {
        signals.push(signal)
        const reply = replies.shift()
        if (reply instanceof Error) {
            throw reply
        }
        if (reply === undefined) {
            throw new Error('Unexpected status request')
        }
        return await reply
    })
    const refreshServerVersion = mock(async () => {
        if (versionError) {
            throw new Error('Version unavailable')
        }
    })
    const trigger = mock(async () => undefined)
    const panelUpdate = mock(async () => undefined)
    const showNotification = mock((_message: string, _type: string) => undefined)
    const effect = sourceCallback<() => (() => void) | undefined>(file, 'useEffect', {
        open, target, pollingReady: true, isUpdating: initialStatus?.status === 'replacing', updateStatus: initialStatus,
        currentVersion: replacing.current_version, updatingVersion,
        UPDATE_POLL_INTERVAL: interval, UPDATE_POLL_RECONNECT_TIMEOUT: reconnectTimeout,
        AbortController, refreshServerVersion,
        authGeneration: generation, apiClient: {getAuthGeneration: () => generation}, submittedUpdate,
        updateApi: {status, trigger, panelUpdate}, showNotification,
        t: (key: string, values?: {error?: string}) => values?.error ? `${key}: ${values.error}` : key,
        setUpdateStatus: (value: UpdateStatus | null) => { state.status = value },
        setPollError: (value: string | null) => { state.pollError = value },
        setPollingReady: (value: boolean) => { state.pollingReady = value },
        setUpdatingVersion: (value: string | null) => { state.updatingVersion = value },
        setTimeout: (callback: () => void, delay: number) => {
            const id = ++timerID
            timers.set(id, {at: now + delay, callback})
            return id
        },
        clearTimeout: (id: number) => { timers.delete(id) },
    }, 'const controller')
    const cleanup = effect()
    const advance = async (milliseconds: number) => {
        const end = now + milliseconds
        while (true) {
            const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0]
            if (!next || next[1].at > end) {
                break
            }
            timers.delete(next[0])
            now = next[1].at
            next[1].callback()
            for (let i = 0; i < 8; ++i) {
                await Promise.resolve()
            }
        }
        now = end
    }
    return {state, status, signals, timers, trigger, panelUpdate, showNotification, refreshServerVersion, advance, cleanup, submittedUpdate,
        changeConnection: () => { ++generation }}
}

describe('backend update status recovery', () => {
    test('keeps installation state through three 502 responses and consumes the recovered terminal result', async () => {
        const view = harness([new Error('HTTP 502'), new Error('HTTP 502'), new Error('HTTP 502'), done])
        await view.advance(interval * 3)
        expect(view.state.status).toEqual(replacing)
        expect(view.state.pollError).toBe('HTTP 502')
        expect(view.state.pollingReady).toBe(true)
        expect(view.showNotification).not.toHaveBeenCalled()
        await view.advance(interval)
        expect(view.state.status).toEqual(done)
        expect(view.state.pollError).toBeNull()
        expect(view.state.pollingReady).toBe(false)
        expect(view.refreshServerVersion).toHaveBeenCalledTimes(1)
        expect(view.showNotification).toHaveBeenCalledWith(done.message, 'success')
        expect(view.status).toHaveBeenCalledTimes(4)
        expect(view.trigger).not.toHaveBeenCalled()
        expect(view.panelUpdate).not.toHaveBeenCalled()
        expect(view.timers.size).toBe(0)
        view.cleanup?.()
    })

    test('accepts only the requested attempt and target after a lost initial acknowledgement', async () => {
        const attemptID = '0123456789abcdef0123456789abcdef'
        const pending = {...replacing, attempt_id: attemptID}
        const matched = {...done, attempt_id: attemptID}
        const view = harness([
            {...done, attempt_id: 'another-attempt'},
            {...matched, target_version: 'v8.0.23-aug.1'},
            {...matched, status: 'idle'},
            matched,
        ], {initialStatus: pending})
        await view.advance(interval * 3)
        expect(view.state.status).toEqual(pending)
        expect(view.state.pollingReady).toBe(true)
        expect(view.showNotification).not.toHaveBeenCalled()
        expect(view.refreshServerVersion).not.toHaveBeenCalled()
        await view.advance(interval)
        expect(view.state.status).toEqual(matched)
        expect(view.state.pollingReady).toBe(false)
        expect(view.showNotification).toHaveBeenCalledWith(done.message, 'success')
        for (const [options] of view.status.mock.calls) {
            expect(options).toMatchObject({attemptID})
        }
        expect(view.trigger).not.toHaveBeenCalled()
        view.cleanup?.()
    })

    test('retains an acknowledged old-server ID and its terminal result for reopening', async () => {
        const attemptID = 'f'.repeat(32)
        const pending = {...replacing, attempt_id: attemptID}
        const completed = {...done, attempt_id: attemptID}
        const view = harness([new Error('HTTP 502'), completed], {initialStatus: pending})
        await view.advance(interval)
        expect(view.submittedUpdate.current).toMatchObject({status: pending, pollError: 'HTTP 502', pollingReady: true})
        await view.advance(interval)
        expect(view.submittedUpdate.current).toMatchObject({status: completed, pollError: null, pollingReady: false})
        for (const [options] of view.status.mock.calls) {
            expect(options).toMatchObject({attemptID})
        }
        expect(view.trigger).not.toHaveBeenCalled()
        view.cleanup?.()
    })

    test('rejects a same-version old-server success without the lost acknowledgement', async () => {
        const pending = {...replacing, attempt_id: 'a'.repeat(32)}
        const view = harness([{...done, attempt_id: 'b'.repeat(32)}], {initialStatus: pending})
        await view.advance(interval)
        expect(view.state.status).toEqual(pending)
        expect(view.submittedUpdate.current?.status).toEqual(pending)
        expect(view.state.pollError).toBe('version_history.status_attempt_unconfirmed')
        expect(view.refreshServerVersion).not.toHaveBeenCalled()
        expect(view.showNotification).not.toHaveBeenCalled()
        expect(view.trigger).not.toHaveBeenCalled()
        view.cleanup?.()
    })

    test('shows a real rollback error after a temporary connection failure', async () => {
        const failed: UpdateStatus = {...replacing, status: 'error', message: 'Previous version restored'}
        const view = harness([new Error('HTTP 502'), failed])
        await view.advance(interval * 2)
        expect(view.state.status).toEqual(failed)
        expect(view.state.pollError).toBeNull()
        expect(view.showNotification).toHaveBeenCalledWith(failed.message, 'error')
        expect(view.refreshServerVersion).not.toHaveBeenCalled()
        expect(view.timers.size).toBe(0)
        view.cleanup?.()
    })

    test('bounds reconnection, aborts a pending query and keeps the installation result unconfirmed', async () => {
        const pending = new Promise<UpdateStatus>(() => undefined)
        const view = harness([new Error('HTTP 502'), pending])
        await view.advance(interval + reconnectTimeout)
        expect(view.state.status).toEqual(replacing)
        expect(view.state.pollError).toBe('HTTP 502')
        expect(view.state.pollingReady).toBe(false)
        expect(view.signals.every((signal) => signal.aborted)).toBe(true)
        expect(view.showNotification).not.toHaveBeenCalled()
        expect(view.trigger).not.toHaveBeenCalled()
        expect(view.timers.size).toBe(0)
        view.cleanup?.()
    })

    test('gives a later connection interruption a fresh reconnection window', async () => {
        const view = harness([new Error('first'), replacing, new Error('second'), done])
        await view.advance(interval * 2)
        expect(view.state.pollError).toBeNull()
        expect(view.timers.size).toBe(1)
        await view.advance(interval * 2)
        expect(view.state.status).toEqual(done)
        expect(view.timers.size).toBe(0)
        view.cleanup?.()
    })

    test('reads a persisted terminal state when reopened without starting another installation', async () => {
        const view = harness([done], {initialStatus: null, updatingVersion: null})
        await view.advance(interval)
        expect(view.state.status).toEqual(done)
        expect(view.state.pollingReady).toBe(false)
        expect(view.refreshServerVersion).toHaveBeenCalledTimes(1)
        expect(view.showNotification).not.toHaveBeenCalled()
        expect(view.trigger).not.toHaveBeenCalled()
        view.cleanup?.()
    })

    test('keeps an active persisted attempt associated with its target after reopening', async () => {
        const pending = {...replacing, attempt_id: '0123456789abcdef0123456789abcdef'}
        const completed = {...done, attempt_id: pending.attempt_id}
        const view = harness([completed], {initialStatus: pending, updatingVersion: null})
        await view.advance(interval)
        expect(view.state.status).toEqual(completed)
        expect(view.state.pollingReady).toBe(false)
        expect(view.showNotification).not.toHaveBeenCalled()
        expect(view.refreshServerVersion).toHaveBeenCalledTimes(1)
        view.cleanup?.()
    })

    test('keeps a confirmed installation successful if version metadata refresh fails', async () => {
        const view = harness([done], {versionError: true})
        await view.advance(interval)
        expect(view.state.status).toEqual(done)
        expect(view.state.pollError).toBeNull()
        expect(view.state.pollingReady).toBe(false)
        expect(view.showNotification).toHaveBeenCalledWith('version_history.status_version_refresh_failed: Version unavailable', 'error')
        expect(view.showNotification).toHaveBeenCalledWith(done.message, 'success')
        expect(view.timers.size).toBe(0)
        view.cleanup?.()
    })

    test.each([401, 403])('stops status requests after HTTP %s without fabricating an installation failure', async (status) => {
        const error = Object.assign(new Error(`HTTP ${status}`), {status})
        const view = harness([error])
        await view.advance(interval)
        expect(view.state.status).toEqual(replacing)
        expect(view.state.pollingReady).toBe(false)
        expect(view.status).toHaveBeenCalledTimes(1)
        expect(view.showNotification).not.toHaveBeenCalled()
        view.cleanup?.()
        expect(view.timers.size).toBe(0)
    })

    test('clears polling and the reconnection deadline when closed', async () => {
        const view = harness([new Error('HTTP 502')])
        await view.advance(interval)
        expect(view.timers.size).toBe(2)
        view.cleanup?.()
        expect(view.timers.size).toBe(0)
        expect(view.signals[0]?.aborted).toBe(true)
        await view.advance(reconnectTimeout + interval)
        expect(view.status).toHaveBeenCalledTimes(1)
    })

    test('ignores a late result after close and permits a fresh status query on reopen', async () => {
        let resolve!: (value: UpdateStatus) => void
        const pending = new Promise<UpdateStatus>((complete) => { resolve = complete })
        const previous = harness([pending])
        await previous.advance(interval)
        previous.cleanup?.()
        const reopened = harness([done], {initialStatus: null, updatingVersion: null})
        resolve(done)
        await reopened.advance(interval)
        expect(previous.state.status).toEqual(replacing)
        expect(previous.showNotification).not.toHaveBeenCalled()
        expect(previous.timers.size).toBe(0)
        expect(reopened.state.status).toEqual(done)
        reopened.cleanup?.()
    })

    test('does not send an old polling request after the connection changes', async () => {
        const view = harness([])
        view.changeConnection()
        await view.advance(interval)
        expect(view.status).not.toHaveBeenCalled()
        expect(view.timers.size).toBe(0)
        view.cleanup?.()
    })

    test('ignores a terminal result from a previous connection', async () => {
        let resolve!: (value: UpdateStatus) => void
        const pending = new Promise<UpdateStatus>((complete) => { resolve = complete })
        const view = harness([pending])
        await view.advance(interval)
        view.changeConnection()
        resolve(done)
        for (let i = 0; i < 8; ++i) {
            await Promise.resolve()
        }
        expect(view.state.status).toEqual(replacing)
        expect(view.refreshServerVersion).not.toHaveBeenCalled()
        expect(view.showNotification).not.toHaveBeenCalled()
        expect(view.timers.size).toBe(0)
        view.cleanup?.()
    })

    test.each([{open: false, target: 'cpa'}, {open: true, target: 'panel'}])('does not query the backend with %j', async (options) => {
        const view = harness([], options)
        await view.advance(reconnectTimeout)
        expect(view.status).not.toHaveBeenCalled()
        expect(view.timers.size).toBe(0)
    })
})
