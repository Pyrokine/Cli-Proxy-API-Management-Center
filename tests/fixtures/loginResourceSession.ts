import axios, {AxiosError} from 'axios'
import assert from 'node:assert/strict'
import {createInterface} from 'node:readline'
import {installTestLockManager} from './browserLockManager'
import {installMemoryStorageEnvironment} from './memoryStorage'

installTestLockManager()
installMemoryStorageEnvironment(true)
const lines                 = createInterface({ input: process.stdin })[Symbol.asyncIterator]()
const bootstrap             = JSON.parse((await lines.next()).value!) as {
    apiBase: string; managementKey: string; cookie: string; rotationStatus?: number
}
const supportsRotation      = !bootstrap.rotationStatus
let cookie                  = bootstrap.cookie
const rotations: string[]   = []
const warnings: unknown[][] = []
const originalWarn          = console.warn
console.warn                = (...values: unknown[]) => {
    warnings.push(values);
    originalWarn(...values)
}

async function transport(url: string, options: RequestInit = {}): Promise<Response> {
    const headers = Object.fromEntries(new Headers(options.headers).entries())
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

globalThis.fetch                        =
    Object.assign(
        (input: string | URL | Request, options?: RequestInit) => transport(String(input), options),
        {
            preconnect: () => {
            },
        },
    ) as typeof fetch
axios.defaults.adapter                  = async (config) => {
    const response = await transport(`${config.baseURL}${config.url}`, {
        method: config.method?.toUpperCase(),
        headers: config.headers.toJSON() as Record<string, string>,
        body: config.data,
    })
    const result   = {
        data: await response.text(), status: response.status, statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()), config,
    }
    if (response.status >= 400) {
        throw new AxiosError('Synthetic management request failed', undefined, config, undefined, result)
    }
    return result
}
const [{ useAuthStore }, { apiClient }] = await Promise.all([
                                                                import('../../src/stores/useAuthStore'),
                                                                import('../../src/services/api/client'),
                                                            ])
await useAuthStore.persist.rehydrate()
const credentials = { ...bootstrap, rememberPassword: true }
if (bootstrap.rotationStatus === 500) {
    await assert.rejects(
        useAuthStore.getState().login(credentials),
        (error: unknown) => (error as { status?: number }).status === 500,
    )
    assert.equal(useAuthStore.getState().isAuthenticated, false)
    assert.equal(localStorage.getItem('cli-proxy-auth:credentials'), null)
    assert.equal(cookie, bootstrap.cookie)
    process.stdout.write(`${JSON.stringify({ done: true, rotations })}\n`)
    process.exit(0)
}
await useAuthStore.getState().login(credentials)
assert.equal(useAuthStore.getState().isAuthenticated, true)
assert.equal(rotations.length, supportsRotation ? 1 : 0)
if (supportsRotation) {
    assert.notEqual(rotations[0], bootstrap.cookie)
}
const generation = apiClient.getAuthGeneration()
await useAuthStore.getState().login(credentials)
assert.equal(useAuthStore.getState().isAuthenticated, true)
assert.ok(apiClient.getAuthGeneration() > generation)
assert.equal(rotations.length, supportsRotation ? 2 : 0)
if (supportsRotation) {
    assert.notEqual(rotations[1], rotations[0])
}

const restored = useAuthStore
restored.setState({ isAuthenticated: false, managementKey: '', sessionRestoreStatus: 'idle' })
apiClient.setConfig({ apiBase: '', managementKey: '' })
await restored.persist.rehydrate()
assert.equal(await restored.getState().restoreSession(), true)
assert.equal(rotations.length, supportsRotation ? 3 : 0)
if (supportsRotation) {
    assert.notEqual(rotations[2], rotations[1])
}
assert.equal(restored.getState().managementKey, credentials.managementKey)
assert.equal(
    warnings.filter((values) => values[0] === 'Server does not support plugin resource session rotation').length,
    supportsRotation ? 0 : 3,
)
restored.getState().logout()
assert.equal(restored.getState().isAuthenticated, false)
const { pluginsApi } = await import('../../src/services/api/plugins')
await pluginsApi.waitForResourceSessionRevocation(bootstrap.apiBase)
assert.equal(cookie, 'cpa_plugin_resource_session=')
assert.equal(await restored.getState().restoreSession(), false)
await assert.rejects(
    restored.getState().login({ ...credentials, managementKey: 'synthetic-invalid-password' }),
    (error: unknown) => (error as { status?: number }).status === 401,
)
assert.equal(restored.getState().isAuthenticated, false)
assert.equal(restored.getState().managementKey, '')
assert.equal(await restored.getState().restoreSession(), false)
process.stdout.write(`${JSON.stringify({ done: true, rotations })}\n`)
process.exit(0)
