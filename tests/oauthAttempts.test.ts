import {describe, expect, test} from 'bun:test'
import {createOAuthAttempts} from '@/components/credentials/oauthAttempts'

function deferred<T>() {
    let resolve!: (value: T) => void
    let reject!: (error: Error) => void
    const promise = new Promise<T>((res, rej) => {
        resolve = res
        reject  = rej
    })
    return {promise, resolve, reject}
}

function setup() {
    let nextId     = 0
    let generation = 1
    const tasks    = new Map<number, {callback: () => void; delay: number}>()
    const attempts = createOAuthAttempts({
        setTimeout: (callback, delay) => {
            tasks.set(++nextId, {callback, delay})
            return nextId
        },
        clearTimeout: (id) => {
            tasks.delete(id)
        },
        getGeneration: () => generation,
    })
    const tick = () => {
        const pending = [...tasks.entries()]
        for (const [id, task] of pending) {
            tasks.delete(id)
            task.callback()
        }
    }
    return {
        attempts,
        tasks,
        tick,
        setGeneration: (value: number) => {
            generation = value
        },
    }
}

const flush = async () => {
    await Promise.resolve()
    await Promise.resolve()
}

describe('OAuth attempt lifecycle', () => {
    test('waits for each request before scheduling the next poll', async () => {
        const {attempts, tasks, tick} = setup()
        const response = deferred<string>()
        let requests = 0
        attempts.begin('devin').poll(
            () => {
                requests++
                return response.promise
            },
            (result) => result === 'wait',
            () => {},
            3000,
        )

        tick()
        tick()
        expect(requests).toBe(1)
        expect(tasks.size).toBe(0)
        response.resolve('wait')
        await flush()
        expect(tasks.size).toBe(1)
        tick()
        expect(requests).toBe(2)
    })

    test('a failed status request can resume the same attempt after an accepted callback', async () => {
        const {attempts, tasks, tick} = setup()
        const results: string[] = []
        const attempt = attempts.begin('codex')
        let requests = 0
        let errors   = 0
        const poll = () => attempt.poll(
            async () => {
                requests++
                if (requests === 1) {
                    throw new Error('Request failed with status code 502')
                }
                return requests === 2 ? 'wait' : 'ok'
            },
            (result) => {
                results.push(result)
                return result === 'wait'
            },
            () => errors++,
            3000,
        )

        expect(attempt.isPolling()).toBe(false)
        poll()
        expect(attempt.isPolling()).toBe(true)
        tick()
        await flush()
        expect(errors).toBe(1)
        expect(attempt.isPolling()).toBe(false)
        expect(tasks.size).toBe(0)

        poll()
        poll()
        expect(attempt.isPolling()).toBe(true)
        expect(tasks.size).toBe(1)
        tick()
        await flush()
        expect(results).toEqual(['wait'])
        expect(attempt.isPolling()).toBe(true)
        tick()
        await flush()
        expect(results).toEqual(['wait', 'ok'])
        expect(attempt.isPolling()).toBe(false)
        expect(tasks.size).toBe(0)
    })

    test('an invalidated OAuth attempt never restarts polling', () => {
        const {attempts, tasks} = setup()
        const old = attempts.begin('codex')
        old.poll(async () => 'wait', () => true, () => {}, 3000)
        expect(old.isPolling()).toBe(true)
        const next = attempts.begin('codex')
        expect(old.isPolling()).toBe(false)
        old.poll(async () => 'wait', () => true, () => {}, 3000)
        expect(tasks.size).toBe(0)
        expect(next.isPolling()).toBe(false)
    })

    test('a new attempt makes late poll and callback results inert', async () => {
        const {attempts, tasks, tick} = setup()
        const poll = deferred<string>()
        const callback = deferred<void>()
        let effects = 0
        const login = attempts.begin('devin')
        login.poll(
            () => poll.promise,
            () => {
                effects++
                return true
            },
            () => effects++,
            3000,
        )
        const submission = callback.promise.then(() => {
            if (login.isCurrent()) {
                effects++
            }
        })
        tick()

        const cancellation = attempts.begin('devin')
        poll.resolve('ok')
        callback.resolve()
        await submission
        await flush()

        expect(effects).toBe(0)
        expect(tasks.size).toBe(0)
        expect(login.signal.aborted).toBe(true)
        expect(cancellation.isCurrent()).toBe(true)
    })

    test('provider flow disposal makes old poll and callback results inert', async () => {
        const {attempts, tasks, tick} = setup()
        const poll = deferred<string>()
        const callback = deferred<void>()
        let effects = 0
        const devin = attempts.begin('devin')
        devin.poll(
            () => poll.promise,
            () => {
                effects += 1
                return false
            },
            () => effects++,
            3000,
        )
        const callbackSubmission = callback.promise.then(() => {
            if (devin.isCurrent()) {
                effects += 1
            }
        })
        tick()

        attempts.invalidateAll()
        const codex = attempts.begin('codex')
        poll.resolve('ok')
        callback.resolve()
        await callbackSubmission
        await flush()

        expect(devin.signal.aborted).toBe(true)
        expect(codex.isCurrent()).toBe(true)
        expect(effects).toBe(0)
        expect(tasks.size).toBe(0)
    })

    test('cleanup aborts requests and clears every timer', async () => {
        const {attempts, tasks, tick} = setup()
        const response = deferred<string>()
        let effects = 0
        const devin = attempts.begin('devin')
        devin.poll(() => response.promise, () => {
            effects++
            return true
        }, () => effects++, 3000)
        tick()
        attempts.begin('codex').schedule(() => effects++, 3000)
        attempts.invalidateAll()
        response.reject(new Error('late failure'))
        await flush()

        expect(devin.signal.aborted).toBe(true)
        expect(tasks.size).toBe(0)
        expect(effects).toBe(0)
    })

    test('an authentication generation change makes scheduled and in-flight work inert', async () => {
        const {attempts, tasks, tick, setGeneration} = setup()
        const response = deferred<string>()
        let effects = 0
        const attempt = attempts.begin('devin')
        attempt.poll(
            () => response.promise,
            () => {
                effects++
                return true
            },
            () => effects++,
            3000,
        )
        tick()
        setGeneration(2)
        response.resolve('ok')
        await flush()

        expect(attempt.isCurrent()).toBe(false)
        expect(effects).toBe(0)
        expect(tasks.size).toBe(0)
        attempt.invalidate()
        expect(attempt.signal.aborted).toBe(true)
    })

    test('a new generation can claim the same owner without the old attempt deleting it', () => {
        const {attempts, setGeneration} = setup()
        const oldAttempt = attempts.begin('devin')
        setGeneration(2)
        const currentAttempt = attempts.begin('devin')

        expect(oldAttempt.signal.aborted).toBe(true)
        expect(oldAttempt.isCurrent()).toBe(false)
        expect(currentAttempt.isCurrent()).toBe(true)
        oldAttempt.invalidate()
        expect(attempts.get('devin')).toBe(currentAttempt)
        expect(currentAttempt.signal.aborted).toBe(false)
    })

    test('separate OAuth action owners remain independent for the same provider', () => {
        const firstOwner = setup().attempts
        const secondOwner = setup().attempts
        const first = firstOwner.begin('devin')
        const second = secondOwner.begin('devin')
        const replacement = firstOwner.begin('devin')

        expect(first.isCurrent()).toBe(false)
        expect(first.signal.aborted).toBe(true)
        expect(second.isCurrent()).toBe(true)
        expect(second.signal.aborted).toBe(false)
        expect(replacement.isCurrent()).toBe(true)
    })
})
