import {describe, expect, test} from 'bun:test'
import {isAuthFileUploadInFlight, withAuthFileUploadLock} from '@/features/authFiles/uploadLock'

const deferred = <T>() => {
    let resolve!: (value: T) => void
    let reject!: (reason?: unknown) => void
    const promise = new Promise<T>((res, rej) => {
        resolve = res
        reject  = rej
    })
    return { promise, resolve, reject }
}

describe('shared credential upload lock', () => {
    test('allows one upload across all vendor sections and releases after success', async () => {
        const pending = deferred<string>()
        const first   = withAuthFileUploadLock(() => pending.promise)
        await Promise.resolve()
        expect(isAuthFileUploadInFlight()).toBe(true)
        expect(await withAuthFileUploadLock(async () => 'second')).toEqual({ started: false })
        pending.resolve('first')
        expect(await first).toEqual({ started: true, value: 'first' })
        expect(isAuthFileUploadInFlight()).toBe(false)
    })

    test('releases the lock after upload failure', async () => {
        // noinspection ES6RedundantAwait
        await expect(withAuthFileUploadLock(async () => {
            throw new Error('upload failed')
        })).rejects.toThrow('upload failed')
        expect(isAuthFileUploadInFlight()).toBe(false)
        expect(await withAuthFileUploadLock(async () => 'retry')).toEqual({ started: true, value: 'retry' })
    })
})
