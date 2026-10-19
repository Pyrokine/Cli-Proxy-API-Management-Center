import {describe, expect, mock, spyOn, test} from 'bun:test'
import {apiClient} from '@/services/api/client'
import {buildProviderConnectivityTestSignature} from '@/hooks/useProviderConnectivityTestState'
import {sourceCallback} from './sourceCallbacks'

const file = 'hooks/useProviderConnectivityTestState.ts'
const messages = {running: 'running', success: 'success', failed: 'failed', timeout: 'timeout', unknownError: 'unknown'}
type Result = {statusCode: number}
type Run = (request: () => Promise<Result>, texts: typeof messages) => Promise<void>

function deferred<T>() {
    let resolve!: (value: T) => void
    let reject!: (reason: unknown) => void
    const promise = new Promise<T>((accept, decline) => {resolve = accept; reject = decline})
    return {promise, resolve, reject}
}

function probe() {
    const generation = spyOn(apiClient, 'getAuthGeneration').mockReturnValue(1)
    const previousConfigRef: {current: string | null} = {current: 'fixture'}
    const testRequestRef: {current: unknown} = {current: null}
    const updates: Array<[string, unknown]> = []
    const showNotification = mock(() => {})
    const showTestError = mock((message: string) => updates.push(['error', message]))
    const scope = {
        apiClient, authGeneration: 1, configSignature: 'fixture', previousConfigRef, testRequestRef,
        isTesting: false, showNotification, showTestError,
        setIsTesting: (value: boolean) => updates.push(['testing', value]),
        setTestStatus: (value: string) => updates.push(['status', value]),
        setTestMessage: (value: string) => updates.push(['message', value]),
        getApiCallErrorMessage: () => 'synthetic upstream error',
        getErrorMessage: (error: unknown) => error instanceof Error ? error.message : String(error),
    }
    return {
        run: sourceCallback<Run>(file, 'runConnectivityTest', scope), scope,
        generation, previousConfigRef, testRequestRef, updates, showNotification, showTestError,
        restore: () => generation.mockRestore(),
    }
}

describe('shared provider connectivity result ownership', () => {
    for (const boundary of ['connection', 'inputs', 'unmount'] as const) {
        for (const outcome of ['success', 'http-error', 'rejection'] as const) {
            test(`ignores an old ${outcome} probe after ${boundary}`, async () => {
                const current = probe()
                const response = deferred<Result>()
                try {
                    const pending = current.run(() => response.promise, messages)
                    const before = [...current.updates]
                    if (boundary === 'connection') {
                        current.generation.mockReturnValue(3)
                    } else if (boundary === 'inputs') {
                        current.previousConfigRef.current = 'changed'
                    } else {
                        current.testRequestRef.current = null
                    }
                    if (outcome === 'rejection') {
                        response.reject(new Error('synthetic old failure'))
                    } else {
                        response.resolve({statusCode: outcome === 'success' ? 200 : 503})
                    }
                    await pending
                    expect(current.updates).toEqual(before)
                    expect(current.showNotification).not.toHaveBeenCalled()
                    expect(current.showTestError).not.toHaveBeenCalled()
                } finally {
                    current.restore()
                }
            })
        }
    }

    test('rejects an old callback before making a request', async () => {
        const current = probe()
        const request = mock(async () => ({statusCode: 200}))
        try {
            current.generation.mockReturnValue(3)
            await current.run(request, messages)
            expect(request).not.toHaveBeenCalled()
            expect(current.updates).toEqual([])
            expect(current.showNotification).not.toHaveBeenCalled()
        } finally {
            current.restore()
        }
    })

    test('does not dispatch a duplicate probe before the next render', async () => {
        const current = probe()
        const response = deferred<Result>()
        const request = mock(() => response.promise)
        try {
            const first = current.run(request, messages)
            const second = current.run(request, messages)
            expect(request).toHaveBeenCalledTimes(1)
            response.resolve({statusCode: 200})
            await Promise.all([first, second])
            expect(current.showNotification).toHaveBeenCalledTimes(1)
            expect(current.testRequestRef.current).toBeNull()
            expect(current.updates[current.updates.length - 1]).toEqual(['testing', false])
        } finally {
            current.restore()
        }
    })

    test('old completion cannot clear a newer pending probe', async () => {
        const current = probe()
        const oldResponse = deferred<Result>()
        const newResponse = deferred<Result>()
        try {
            const first = current.run(() => oldResponse.promise, messages)
            current.previousConfigRef.current = 'changed'
            current.testRequestRef.current = null
            const next = sourceCallback<Run>(file, 'runConnectivityTest', {...current.scope, configSignature: 'changed'})
            const second = next(() => newResponse.promise, messages)
            const owner = current.testRequestRef.current
            const before = [...current.updates]
            oldResponse.resolve({statusCode: 200})
            await first
            expect(current.testRequestRef.current).toBe(owner)
            expect(current.updates).toEqual(before)
            expect(current.showNotification).not.toHaveBeenCalled()
            newResponse.resolve({statusCode: 204})
            await second
            expect(current.showNotification).toHaveBeenCalledTimes(1)
            expect(current.testRequestRef.current).toBeNull()
            expect(current.updates[current.updates.length - 1]).toEqual(['testing', false])
        } finally {
            current.restore()
        }
    })

    test('changing inputs invalidates pending ownership and resets the panel', async () => {
        const current = probe()
        const response = deferred<Result>()
        try {
            const pending = current.run(() => response.promise, messages)
            current.updates.length = 0
            sourceCallback<() => void>(file, 'useEffect', {...current.scope, configSignature: 'changed'})()
            expect(current.previousConfigRef.current).toBe('changed')
            expect(current.testRequestRef.current).toBeNull()
            expect(current.updates).toEqual([['testing', false], ['status', 'idle'], ['message', '']])
            const before = [...current.updates]
            response.resolve({statusCode: 200})
            await pending
            expect(current.updates).toEqual(before)
            expect(current.showNotification).not.toHaveBeenCalled()
        } finally {
            current.restore()
        }
    })

    test('unmount cleanup rejects old callbacks and late responses', async () => {
        const current = probe()
        const response = deferred<Result>()
        try {
            const pending = current.run(() => response.promise, messages)
            const cleanup = sourceCallback<() => () => void>(file, 'useEffect', current.scope, 'previousConfigRef.current = null')()
            cleanup()
            expect(current.previousConfigRef.current).toBeNull()
            expect(current.testRequestRef.current).toBeNull()
            const before = [...current.updates]
            const request = mock(async () => ({statusCode: 200}))
            await current.run(request, messages)
            response.resolve({statusCode: 200})
            await pending
            expect(request).not.toHaveBeenCalled()
            expect(current.updates).toEqual(before)
            expect(current.showNotification).not.toHaveBeenCalled()
        } finally {
            current.restore()
        }
    })

    test('validation callbacks cannot notify another connection', () => {
        const current = probe()
        try {
            const showError = sourceCallback<(message: string) => void>(file, 'showTestError', current.scope)
            showError('current validation')
            expect(current.showNotification).toHaveBeenCalledTimes(1)
            current.updates.length = 0
            current.showNotification.mockClear()
            current.generation.mockReturnValue(3)
            showError('old validation')
            expect(current.updates).toEqual([])
            expect(current.showNotification).not.toHaveBeenCalled()
        } finally {
            current.restore()
        }
    })

    test('distinct stored identities and proxies do not share a result signature', () => {
        const input = {apiKey: 'masked', baseUrl: 'https://fixture.invalid', testModel: 'synthetic', headers: [], modelEntries: []}
        const first = buildProviderConnectivityTestSignature({...input, authIndex: 'first', proxyUrl: 'http://proxy.invalid'})
        expect(first).not.toBe(buildProviderConnectivityTestSignature({...input, authIndex: 'second', proxyUrl: 'http://proxy.invalid'}))
        expect(first).not.toBe(buildProviderConnectivityTestSignature({...input, authIndex: 'first', proxyUrl: 'http://other.invalid'}))
    })

    for (const outcome of ['http-error', 'timeout', 'failure'] as const) {
        test(`reports a current ${outcome} without leaving pending ownership`, async () => {
            const current = probe()
            try {
                await current.run(async () => {
                    if (outcome === 'http-error') {
                        return {statusCode: 403}
                    }
                    throw new Error(outcome === 'timeout' ? 'synthetic timeout' : 'synthetic failure')
                }, messages)
                expect(current.showTestError).toHaveBeenCalledTimes(1)
                expect(current.showTestError).toHaveBeenCalledWith(outcome === 'timeout' ? 'timeout' : expect.stringContaining('failed:'))
                expect(current.testRequestRef.current).toBeNull()
                expect(current.updates[current.updates.length - 1]).toEqual(['testing', false])
            } finally {
                current.restore()
            }
        })
    }
})
