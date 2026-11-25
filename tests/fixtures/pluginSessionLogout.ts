import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {installTestLockManager} from './browserLockManager'
import {installMemoryStorageEnvironment} from './memoryStorage'

const scenario   = process.argv[2]
const tokenFor   = (key: string) => createHash('sha256').update(key).digest('hex')
const firstToken = tokenFor('first-synthetic-key')
const nextToken  = tokenFor('next-synthetic-key')
const oldOrigin  = 'https://old.synthetic.invalid/proxy'
installTestLockManager()
installMemoryStorageEnvironment(true)

const deletion                                               = Promise.withResolvers<Response>()
const deletionStarted                                        = Promise.withResolvers<void>()
const requests: Array<{ url: string; options: RequestInit }> = []
globalThis.fetch                                             =
    (async (input: string | URL | Request, options: RequestInit = {}) => {
        const url  = String(input)
        const path = new URL(url).pathname
        requests.push({ url, options })
        if (options.method === 'POST' && path.endsWith('/management/session')) {
            const key = new Headers(options.headers).get('Authorization')?.replace(/^Bearer /, '')
            assert.ok(key)
            if (scenario === 'old-backend') {
                return new Response(null, { status: 404 })
            }
            return Response.json({ session_token: tokenFor(key) }, { status: 201 })
        }
        if (options.method === 'POST' && path.endsWith('/resource/plugins/session')) {
            assert.equal(new Headers(options.headers).get('Authorization'), null)
            assert.ok(new Headers(options.headers).get('X-CPA-Management-Session-Token'))
            return new Response(null, { status: 204 })
        }
        assert.equal(options.method, 'DELETE')
        assert.equal(url, `${oldOrigin}/v0/management/session`)
        assert.equal(options.credentials, 'omit')
        assert.equal(options.redirect, 'error')
        assert.equal(new Headers(options.headers).get('Authorization'), null)
        assert.equal(new Headers(options.headers).get('X-CPA-Management-Session-Token'), firstToken)
        deletionStarted.resolve()
        return deletion.promise
    }) as typeof fetch

const [{ useAuthStore }, { useConfigStore }, { useNotificationStore }, { secureStorage }] = await Promise.all([
                                                                                                                  import('../../src/stores/useAuthStore'),
                                                                                                                  import('../../src/stores/useConfigStore'),
                                                                                                                  import('../../src/stores/useNotificationStore'),
                                                                                                                  import('../../src/services/storage/secureStorage'),
                                                                                                              ])
await useAuthStore.persist.rehydrate()
useConfigStore.setState({ fetchConfig: async () => ({}) })
useAuthStore.setState({
                          refreshServerVersion: async () => {
                          },
                      })
const auth  = () => useAuthStore.getState()
const login = (managementKey: string, apiBase = oldOrigin) => auth().login({
                                                                               apiBase,
                                                                               managementKey,
                                                                               rememberPassword: true,
                                                                           })

if (scenario === 'old-backend') {
    await assert.rejects(login('first-synthetic-key'), (error: unknown) =>
        (error as { backendCode?: string }).backendCode === 'management_session_unsupported')
    assert.equal(auth().isAuthenticated, false)
    assert.equal(localStorage.getItem('cli-proxy-auth:credentials'), null)
    assert.equal(requests.length, 1)
} else {
    await login('first-synthetic-key')
    const finished = auth().logout()
    assert.equal(auth().isAuthenticated, false)
    assert.equal(auth().sessionToken, '')
    await deletionStarted.promise
    assert.equal(await auth().restoreSession(), false)

    if (scenario === 'late-success' || scenario === 'late-401' || scenario === 'late-network-failure') {
        await login('next-synthetic-key')
    }
    if (scenario === 'late-network-failure') {
        deletion.reject(new TypeError('Synthetic network failure'))
    } else {
        const status = scenario === 'late-401' ? 401 : scenario === 'unsupported-logout' ? 404 : 204
        deletion.resolve(new Response(null, { status }))
    }
    await finished
    assert.equal(requests.filter(({ options }) => options.method === 'DELETE').length, 1)
    const warnings = useNotificationStore.getState().notifications.filter((entry) => entry.type === 'warning')
    assert.equal(warnings.length, scenario === 'late-network-failure' || scenario === 'unsupported-logout' ? 1 : 0)
    if (scenario.startsWith('late-')) {
        const stored = await secureStorage.getItem<{ sessionToken: string; managementKey?: string }>(
            'cli-proxy-auth:credentials', { persistent: true },
        )
        assert.equal(auth().isAuthenticated, true)
        assert.equal(auth().sessionToken, nextToken)
        assert.equal(stored?.sessionToken, nextToken)
        assert.equal(stored?.managementKey, undefined)
    } else {
        assert.equal(auth().isAuthenticated, false)
        assert.equal(localStorage.getItem('cli-proxy-auth:credentials'), null)
    }
}

console.log(`plugin-session-logout:${scenario}=PASS`)
