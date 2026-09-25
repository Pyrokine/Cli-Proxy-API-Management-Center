import {describe, expect, test} from 'bun:test'
import {createOAuthAttempts} from '@/components/credentials/oauthAttempts'
import {apiClient} from '@/services/api/client'
import {AxiosError, type AxiosResponse} from 'axios'

interface DeferredTransport {
    deliver: () => void
    started: Promise<void>
}

function startDeferredRequest(status: number, signal: AbortSignal): {request: Promise<unknown>; transport: DeferredTransport} {
    let markStarted!: () => void
    const started = new Promise<void>((resolve) => {
        markStarted = resolve
    })
    let deliver!: () => void
    const request = apiClient.get('/get-auth-status', {
        signal,
        adapter: (config) => new Promise<AxiosResponse>((resolve, reject) => {
            deliver = () => {
                const response: AxiosResponse = {
                    config,
                    data: {status: 'ok'},
                    status,
                    statusText: String(status),
                    headers: {'X-CPA-Version': 'old-server'},
                }
                if (status === 401) {
                    reject(new AxiosError('Unauthorized', 'ERR_BAD_REQUEST', config, undefined, response))
                    return
                }
                resolve(response)
            }
            markStarted()
        }),
    })
    return {request, transport: {deliver: () => deliver(), started}}
}

function createAttempts() {
    return createOAuthAttempts({
        setTimeout: () => 0,
        clearTimeout: () => {},
        getGeneration: () => apiClient.getAuthGeneration(),
    })
}

describe('OAuth transport ownership', () => {
    for (const status of [200, 401]) {
        test(`aborted old request has no response side effects (${status})`, async () => {
            const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
            const events: string[] = []
            Object.defineProperty(globalThis, 'window', {
                configurable: true,
                value: {dispatchEvent: (event: Event) => events.push(event.type)},
            })
            apiClient.setConfig({apiBase: 'https://old.example', managementKey: 'old-key'})
            const attempts = createAttempts()
            const attempt = attempts.begin('devin')

            try {
                const {request, transport} = startDeferredRequest(status, attempt.signal)
                await transport.started
                attempts.invalidateAll()
                const current = attempts.begin('devin')
                transport.deliver()

                await expect(request).rejects.toHaveProperty('code', 'ERR_CANCELED')
                expect(events).toEqual([])
                expect(attempt.signal.aborted).toBe(true)
                expect(current.isCurrent()).toBe(true)
            } finally {
                attempts.invalidateAll()
                apiClient.setConfig({apiBase: '', managementKey: ''})
                if (originalWindow) {
                    Object.defineProperty(globalThis, 'window', originalWindow)
                } else {
                    Reflect.deleteProperty(globalThis, 'window')
                }
            }
        })

        test(`old authentication generation has no response side effects (${status})`, async () => {
            const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
            const events: string[] = []
            Object.defineProperty(globalThis, 'window', {
                configurable: true,
                value: {dispatchEvent: (event: Event) => events.push(event.type)},
            })
            apiClient.setConfig({apiBase: 'https://old.example', managementKey: 'old-key'})
            const attempts = createAttempts()
            const attempt = attempts.begin('devin')

            try {
                const {request, transport} = startDeferredRequest(status, attempt.signal)
                await transport.started
                apiClient.setConfig({apiBase: 'https://new.example', managementKey: 'new-key'})
                transport.deliver()

                if (status === 401) {
                    await expect(request).rejects.toMatchObject({status: 401})
                } else {
                    await expect(request).resolves.toEqual({status: 'ok'})
                }
                expect(events).toEqual([])
                expect(attempt.isCurrent()).toBe(false)
            } finally {
                attempts.invalidateAll()
                apiClient.setConfig({apiBase: '', managementKey: ''})
                if (originalWindow) {
                    Object.defineProperty(globalThis, 'window', originalWindow)
                } else {
                    Reflect.deleteProperty(globalThis, 'window')
                }
            }
        })
    }
})
