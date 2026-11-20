import {REQUEST_TIMEOUT_MS} from '@/utils/constants'
import assert from 'node:assert/strict'
import {installTestLockManager} from './browserLockManager'
import {installMemoryStorageEnvironment} from './memoryStorage'

const scenario = process.argv[2]
const locks    = installTestLockManager()
installMemoryStorageEnvironment(true)
const requests: Array<{ url: string; options: RequestInit }> = []
const response                                               = Promise.withResolvers<Response>()
const started                                                = Promise.withResolvers<void>()
const cookies                                                = new Map([['old.test', 'old-cookie']])
globalThis.fetch                                             =
    (async (input: string | URL | Request, options: RequestInit = {}) => {
        const url = String(input)
        if (options.method === 'POST') {
            assert.equal(new URL(url).pathname, '/v0/resource/plugins/session')
            cookies.set(new URL(url).hostname, configCalls === 0 ? 'old-cookie' : 'new-cookie')
            return new Response(null, { status: 204 })
        }
        requests.push({ url, options })
        started.resolve()
        const aborted = Promise.withResolvers<never>()
        const onAbort = () => aborted.reject(options.signal?.reason)
        options.signal?.addEventListener('abort', onAbort, { once: true })
        try {
            const result = await Promise.race([response.promise, aborted.promise])
            if (!options.signal?.aborted && result.status === 204) {
                cookies.delete(new URL(url).hostname)
            }
            return result
        } finally {
            options.signal?.removeEventListener('abort', onAbort)
        }
    }) as typeof fetch

const [
          { useAuthStore }, { useConfigStore }, { useNotificationStore }, { apiClient }, { pluginsApi }, {
        secureStorage,
    },
      ] =
          await Promise.all([
                                import('../../src/stores/useAuthStore'),
                                import('../../src/stores/useConfigStore'),
                                import('../../src/stores/useNotificationStore'),
                                import('../../src/services/api/client'),
                                import('../../src/services/api/plugins'),
                                import('../../src/services/storage/secureStorage'),
                            ])
await useAuthStore.persist.rehydrate()
let configCalls = 0
let nextOrigin  = 'https://old.test'
useConfigStore.setState({
                            fetchConfig: async () => {
                                ++configCalls
                                if (configCalls > 1) {
                                    cookies.set(new URL(nextOrigin).hostname, 'new-cookie')
                                }
                                return {}
                            },
                        })
useAuthStore.setState({
                          refreshServerVersion: async () => {
                          },
                      })
const login = (apiBase = 'https://old.test', managementKey = 'new-key') => useAuthStore.getState().login(
    {
        apiBase,
        managementKey,
        rememberPassword: true,
    })
await login('https://old.test', 'old-key')

const flush              = () => new Promise<void>((resolve) => setImmediate(resolve))
const warnings           = () => useNotificationStore.getState().notifications.filter((entry) => entry.type ===
                                                                                                 'warning')
const assertCurrentLogin = async (origin = 'https://old.test') => {
    const state = useAuthStore.getState()
    assert.equal(state.isAuthenticated, true)
    assert.equal(state.managementKey, 'new-key')
    assert.equal(state.apiBase, origin)
    assert.equal(state.rememberPassword, true)
    assert.equal(state.connectionStatus, 'connected')
    assert.equal(state.storageClearFailed, false)
    assert.equal(cookies.get(new URL(origin).hostname), 'new-cookie')
    assert.equal((await secureStorage.getItem<{ managementKey: string }>('cli-proxy-auth:credentials', {
        persistent: true,
    }))?.managementKey, 'new-key')
}

if (scenario === 'cross-tab' || scenario === 'shared-cookie-host') {
    const modulePath = '../../src/services/api/plugins.ts?logout-tab=other'
    const otherTab   = await import(modulePath) as typeof import('../../src/services/api/plugins')
    assert.notEqual(otherTab.pluginsApi, pluginsApi)
    const revocation = otherTab.pluginsApi.revokeResourceSession({
                                                                     apiBase: 'https://old.test',
                                                                     managementKey: 'old-key',
                                                                 })
    await started.promise
    nextOrigin         = scenario === 'shared-cookie-host' ? 'https://old.test:8443' : 'https://old.test'
    const currentLogin = login(nextOrigin)
    await flush()
    assert.equal(configCalls, 1)
    response.resolve(new Response(null, { status: 204 }))
    await Promise.all([revocation, currentLogin])
    await assertCurrentLogin(nextOrigin)
} else if (scenario === 'queued-timeout') {
    const release            = Promise.withResolvers<void>()
    const held               = locks.request('cpam:plugin-resource-session:old.test', () => release.promise)
    const originalSetTimeout = globalThis.setTimeout
    globalThis.setTimeout    = ((callback: TimerHandler, milliseconds?: number, ...args: unknown[]) =>
        originalSetTimeout(
            callback,
            milliseconds === REQUEST_TIMEOUT_MS ? 5 : milliseconds,
            ...args,
        )) as typeof setTimeout
    try {
        await assert.rejects(
            pluginsApi.revokeResourceSession({ apiBase: 'https://old.test', managementKey: 'old-key' }),
            /timed out/,
        )
        release.resolve()
        await held
        await flush()
        assert.equal(requests.length, 0)
        await login()
        await assertCurrentLogin()
    } finally {
        globalThis.setTimeout = originalSetTimeout
    }
} else {
    if (scenario === 'no-locks') {
        Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined })
    } else if (scenario === 'lock-failure') {
        Object.defineProperty(navigator, 'locks', {
            configurable: true, value: {
                request: async () => {
                    throw new Error('Fixture lock unavailable')
                },
            },
        })
    }
    if (scenario === 'cookie-only') {
        useAuthStore.setState({ managementKey: '' })
    }
    if (scenario === 'snapshot') {
        useAuthStore.setState({ apiBase: 'https://old.test/proxy/v0/management///' })
    }
    const originalSetTimeout = globalThis.setTimeout
    if (scenario === 'timeout') {
        globalThis.setTimeout = ((callback: TimerHandler, milliseconds?: number, ...args: unknown[]) =>
            originalSetTimeout(
                callback,
                milliseconds === REQUEST_TIMEOUT_MS ? 10 : milliseconds,
                ...args,
            )) as typeof setTimeout
    }
    try {
        useAuthStore.getState().logout()
        assert.equal(useAuthStore.getState().isAuthenticated, false)
        assert.equal(useAuthStore.getState().apiBase, '')
        assert.equal(useAuthStore.getState().managementKey, '')
        assert.equal(useAuthStore.getState().connectionStatus, 'disconnected')
        await started.promise
        assert.equal(requests.length, 1)
        const request = requests[0]!
        assert.equal(request.url, scenario === 'snapshot' ?
                                  'https://old.test/proxy/v0/resource/plugins/session' :
                                  'https://old.test/v0/resource/plugins/session')
        assert.equal(request.options.method, 'DELETE')
        assert.equal(request.options.credentials, 'include')
        assert.equal(request.options.redirect, 'error')
        assert.deepEqual(
            request.options.headers,
            scenario === 'cookie-only' ? undefined : { Authorization: 'Bearer old-key' },
        )
        assert.equal(apiClient.getAuthGeneration() > 0, true)
        assert.equal(await useAuthStore.getState().restoreSession(), false)

        if (scenario === 'snapshot') {
            apiClient.setConfig({ apiBase: 'https://other.test', managementKey: 'other-key' })
            response.resolve(new Response(null, { status: 204 }))
            await flush()
            assert.equal(warnings().length, 0)
            assert.equal(cookies.has('old.test'), false)
            assert.equal(localStorage.getItem('cli-proxy-auth:credentials'), null)
            useAuthStore.getState().logout()
            await flush()
            assert.equal(requests.length, 1)
        } else if (scenario === 'superseded-wait' || scenario === 'aba-wait') {
            const staleLogin = login('https://old.test', 'stale-key').catch((error: unknown) => error)
            await flush()
            assert.equal(configCalls, 1)
            nextOrigin = 'https://new.test'
            await login(nextOrigin)
            if (scenario === 'aba-wait') {
                nextOrigin = 'https://old.test'
            }
            const currentLogin = scenario === 'aba-wait' ? login(nextOrigin) : Promise.resolve()
            response.resolve(new Response(null, { status: 204 }))
            const staleError = await staleLogin
            assert.ok(staleError instanceof Error)
            assert.equal(staleError.name, 'AuthStorageSupersededError')
            await currentLogin
            await assertCurrentLogin(nextOrigin)
        } else if (scenario.startsWith('late-')) {
            nextOrigin = 'https://new.test'
            await login(nextOrigin)
            if (scenario === 'late-rejection') {
                response.reject(new TypeError('Fixture network failure'))
            } else {
                const status = scenario === 'late-success' ? 204 : 401
                response.resolve(new Response(null, { status, statusText: status === 401 ? 'Unauthorized' : '' }))
            }
            await flush()
            await assertCurrentLogin(nextOrigin)
            assert.equal(warnings().length, scenario === 'late-success' ? 0 : 1)
            if (warnings().length) {
                assert.match(warnings()[0]!.message, /https:\/\/old\.test/)
            }
        } else if (scenario === 'unsupported' || scenario === 'unexpected-success') {
            const status = scenario === 'unsupported' ? 404 : 200
            response.resolve(new Response(null, { status, statusText: status === 404 ? 'Not Found' : 'OK' }))
            await flush()
            assert.equal(warnings().length, 1)
            assert.match(warnings()[0]!.message, new RegExp(String(status)))
            assert.equal(useAuthStore.getState().isAuthenticated, false)
            assert.equal(cookies.get('old.test'), 'old-cookie')
        } else {
            const currentLogin = login('https://old.test/v0/management/')
            await flush()
            assert.equal(configCalls, 1)
            if (scenario !== 'timeout') {
                response.resolve(new Response(null, { status: scenario === 'same-connection-failure' ? 404 : 204 }))
            }
            await currentLogin
            if (scenario === 'timeout') {
                assert.equal(request.options.signal?.aborted, true)
                response.resolve(new Response(null, { status: 204 }))
                await flush()
                assert.equal(warnings().length, 1)
                assert.match(warnings()[0]!.message, /timed out/)
            } else {
                assert.equal(warnings().length, scenario === 'same-connection-failure' ? 1 : 0)
            }
            assert.equal(useAuthStore.getState().isAuthenticated, true)
            assert.equal(useAuthStore.getState().managementKey, 'new-key')
            assert.equal(cookies.get('old.test'), 'new-cookie')
            if (scenario !== 'no-locks' && scenario !== 'lock-failure') {
                await assertCurrentLogin()
            }
        }
    } finally {
        globalThis.setTimeout = originalSetTimeout
    }
}

console.log(`plugin-session-logout:${scenario}=PASS`)
