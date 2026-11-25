import assert from 'node:assert/strict'
import {createInterface} from 'node:readline'
import {installTestLockManager} from './browserLockManager'
import {installMemoryStorageEnvironment} from './memoryStorage'

installTestLockManager()
installMemoryStorageEnvironment(true)
const lines                   = createInterface({ input: process.stdin })[Symbol.asyncIterator]()
const bootstrap               = JSON.parse((await lines.next()).value!) as {
    apiBase: string; managementKey: string; cookie: string; rotationStatus?: number
}
const supportsRotation        = !bootstrap.rotationStatus
let cookie                    = bootstrap.cookie
const rotations: string[]     = []
const submittedKeys: string[] = []
const retiredTokens: string[] = []
const warnings: unknown[][]   = []
const originalWarn            = console.warn
console.warn                  = (...values: unknown[]) => {
    warnings.push(values);
    originalWarn(...values)
}

async function transport(url: string, options: RequestInit = {}): Promise<Response> {
    const headers = Object.fromEntries(new Headers(options.headers).entries())
    if (headers.authorization) {
        assert.equal(new URL(url).pathname, '/v0/management/session')
        assert.equal(options.method, 'POST')
        submittedKeys.push(headers.authorization)
    }
    if (options.method === 'DELETE') {
        assert.equal(new URL(url).pathname, '/v0/management/session')
        assert.ok(headers['x-cpa-management-session-token'])
        retiredTokens.push(headers['x-cpa-management-session-token']!)
    }
    if (cookie && new URL(url).pathname.startsWith('/v0/resource/plugins/')) {
        headers.cookie = cookie
    }
    process.stdout.write(`${JSON.stringify({
                                               method: options.method ?? 'GET',
                                               url,
                                               headers,
                                               body: options.body ?? '',
                                           })}\n`)
    const line = await lines.next()
    assert.equal(line.done, false)
    const result          = JSON.parse(line.value!) as {
        status: number;
        headers: Record<string, string[]>;
        body: string
    }
    const responseHeaders = new Headers()
    for (const [name, values] of Object.entries(result.headers)) {
        for (const value of values) {
            responseHeaders.append(name, value)
        }
    }
    const issued = responseHeaders.get('Set-Cookie')
    if (issued) {
        cookie = issued.split(';', 1)[0]!
        if (options.method === 'POST' && result.status === 204) {
            rotations.push(cookie)
        }
    }
    return new Response(result.status === 204 ? null : result.body, { status: result.status, headers: responseHeaders })
}

globalThis.fetch                                           = Object.assign(
    async (input: string | URL | Request, options?: RequestInit) => {
        const request = new Request(input, options)
        const url     = new URL(request.url)
        assert.equal(request.redirect, 'error')
        if (!(input instanceof Request)) {
            assert.equal(options?.credentials, url.pathname.startsWith('/v0/resource/plugins/') ? 'include' : 'omit')
        }
        if (url.pathname.startsWith('/v0/management/') && !url.pathname.endsWith('/session')) {
            assert.ok(request.headers.get('X-CPA-Management-Session-Token'))
        }
        return transport(request.url, {
            method: request.method,
            headers: request.headers,
            body: request.body ? await request.text() : undefined,
        })
    },
    {
        preconnect: () => {
        },
    },
) as typeof fetch
const [{ useAuthStore }, { apiClient }, { secureStorage }] = await Promise.all([
                                                                                   import('../../src/stores/useAuthStore'),
                                                                                   import('../../src/services/api/client'),
                                                                                   import('../../src/services/storage/secureStorage'),
                                                                               ])
await useAuthStore.persist.rehydrate()
const credentials = { apiBase: bootstrap.apiBase, managementKey: bootstrap.managementKey, rememberPassword: true }
const auth        = () => useAuthStore.getState()
if (bootstrap.rotationStatus === 500) {
    await assert.rejects(auth().login(credentials), (error: unknown) => (error as { status?: number }).status === 500)
    assert.equal(auth().isAuthenticated, false)
    assert.equal(auth().sessionToken, '')
    assert.equal(localStorage.getItem('cli-proxy-auth:credentials'), null)
    assert.equal(cookie, bootstrap.cookie)
    assert.equal(retiredTokens.length, 1)
    process.stdout.write(`${JSON.stringify({ done: true })}\n`)
    process.exit(0)
}
await auth().login(credentials)
assert.equal(auth().isAuthenticated, true)
assert.equal(rotations.length, supportsRotation ? 1 : 0)
const firstToken = auth().sessionToken
const generation = apiClient.getAuthGeneration()
await auth().login(credentials)
assert.equal(auth().isAuthenticated, true)
assert.ok(apiClient.getAuthGeneration() > generation)
assert.equal(rotations.length, supportsRotation ? 2 : 0)
if (supportsRotation) {
    assert.notEqual(rotations[0], bootstrap.cookie)
    assert.notEqual(rotations[1], rotations[0])
}
assert.notEqual(auth().sessionToken, firstToken)
const currentToken = auth().sessionToken
const stored       = await secureStorage.getItem(
    'cli-proxy-auth:credentials',
    { persistent: true },
) as Record<string, unknown>
assert.equal(stored.sessionToken, currentToken)
assert.equal(stored.managementKey, undefined)
assert.equal(stored.version, 2)

useAuthStore.setState({ isAuthenticated: false, sessionToken: '', sessionRestoreStatus: 'idle' })
apiClient.setConfig({ apiBase: '' })
await useAuthStore.persist.rehydrate()
assert.equal(await auth().restoreSession(), true)
assert.equal(rotations.length, supportsRotation ? 2 : 0)
assert.equal(auth().sessionToken, currentToken)
assert.equal(submittedKeys.length, 2)
assert.equal(
    warnings.filter((values) => values[0] === 'Server does not support plugin resource session rotation').length,
    supportsRotation ? 0 : 2,
)
await auth().logout()
assert.equal(auth().isAuthenticated, false)
assert.deepEqual(retiredTokens, [firstToken, currentToken])
assert.equal(await auth().restoreSession(), false)
await assert.rejects(
    auth().login({ ...credentials, managementKey: 'synthetic-invalid-password' }),
    (error: unknown) => (error as { status?: number }).status === 401,
)
assert.equal(auth().isAuthenticated, false)
assert.equal(auth().sessionToken, '')
assert.equal(await auth().restoreSession(), false)
process.stdout.write(`${JSON.stringify({ done: true })}\n`)
process.exit(0)
