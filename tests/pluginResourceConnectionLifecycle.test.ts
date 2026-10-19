import {describe, expect, mock, test} from 'bun:test'
import type {PluginEntry} from '@/services/api/plugins'
import {collectPluginResourceEntries, pluginResourceKey, resolvePluginAssetURL} from '@/pages/pluginResources'
import {normalizeApiBase} from '@/utils/connection'
import {getErrorMessage} from '@/utils/helpers'
import {sourceCallback, sourceInitializer} from './sourceCallbacks'

const page = 'pages/PluginResourcePage.tsx'
const resource = '/v0/resource/plugins/fixture/index.html'
const plugin: PluginEntry = {
    id: 'fixture', path: '', configured: true, registered: true, enabled: true, effective_enabled: true,
    supports_oauth: false, logo: '', config: {}, config_fields: [], metadata: null,
    menus: [{path: resource, menu: 'Fixture', description: 'Fixture page'}],
}
const listing = {plugins_enabled: true, plugins_dir: 'fixtures', plugins: [plugin]}
const trustedPluginResourceURL = sourceInitializer<(src: string, apiBase: string) => URL | null>(
    page, 'trustedPluginResourceURL', {
        normalizeApiBase, pluginResourcePathPrefix: '/v0/resource/plugins/',
        window: {location: {origin: 'https://fixture.example'}},
    },
)

function setup() {
    let generation = 1
    const loading: boolean[] = []
    const errors: string[] = []
    const frames: string[] = []
    const list = mock(async (_options?: {signal?: AbortSignal}) => listing)
    const fetch = mock(async (_url: string, _options: RequestInit) => ({ok: true, status: 200, statusText: 'OK'}))
    const scope = {
        authGeneration: 1, apiClient: {getAuthGeneration: () => generation},
        apiBase: 'https://fixture.example', managementKey: 'fixture-key',
        pluginID: plugin.id, resourceKey: pluginResourceKey(resource),
        loadSeqRef: {current: 0}, loadAbortRef: {current: null as AbortController | null},
        pluginsApi: {list}, collectPluginResourceEntries, resolvePluginAssetURL, trustedPluginResourceURL, getErrorMessage, fetch,
        setLoading: (value: boolean) => loading.push(value), setError: (value: string) => errors.push(value),
        setIframeSrc: (value: string) => frames.push(value), t: (key: string) => key,
    }
    return {
        scope, loading, errors, frames, list, fetch,
        callback: () => sourceCallback<(options?: {skipLeadingState?: boolean}) => Promise<void>>(page, 'loadResource', scope),
        replaceConnection: (value = 2) => {generation = value},
    }
}

function loadingEffect(flow: ReturnType<typeof setup>, loadResource: () => Promise<void>) {
    const setTimeout = mock(() => 7)
    const clearTimeout = mock()
    const effect = sourceCallback<() => () => void>(page, 'useEffect', {
        loadResource, loadSeqRef: flow.scope.loadSeqRef, loadAbortRef: flow.scope.loadAbortRef,
        window: {setTimeout, clearTimeout},
    })
    return {cleanup: effect(), setTimeout, clearTimeout}
}

describe('plugin resource request ownership', () => {
    test('the render owner records the actual authentication generation', () => {
        const generation = sourceInitializer<number>(page, 'authGeneration', {apiClient: {getAuthGeneration: () => 3}})
        expect(generation).toBe(3)
    })

    test('loads only the current registered resource and sends the fixture key to its trusted origin', async () => {
        const flow = setup()
        await flow.callback()()
        expect(flow.list).toHaveBeenCalledTimes(1)
        const signal = flow.list.mock.calls[0][0]?.signal
        expect(signal).toBeInstanceOf(AbortSignal)
        expect(flow.fetch).toHaveBeenCalledWith('https://fixture.example' + resource, {
            credentials: 'include', headers: {Authorization: 'Bearer fixture-key'}, signal,
        })
        expect(flow.frames).toEqual(['', 'https://fixture.example' + resource])
        expect(flow.errors).toEqual([''])
        expect(flow.loading).toEqual([true, false])
        expect(flow.scope.loadAbortRef.current).toBeNull()
    })

    for (const outcome of ['response', 'rejection']) {
        test(`current ${outcome} failure is visible and finishes loading`, async () => {
            const flow = setup()
            if (outcome === 'response') {
                flow.fetch.mockResolvedValue({ok: false, status: 503, statusText: 'Fixture unavailable'})
            } else {
                flow.fetch.mockRejectedValue(new Error('Fixture request failed'))
            }
            await flow.callback()()
            expect(flow.frames).toEqual([''])
            expect(flow.errors).toEqual(['', outcome === 'response' ? '503 Fixture unavailable' : 'Fixture request failed'])
            expect(flow.loading).toEqual([true, false])
        })
    }

    for (const change of ['connection', 'ABA']) {
        for (const outcome of ['success', 'failure']) {
            test(`ignores the old plugin list ${outcome} after ${change}`, async () => {
                const flow = setup()
                const pending = Promise.withResolvers<typeof listing>()
                flow.list.mockImplementation(() => pending.promise)
                const request = flow.callback()()
                flow.replaceConnection(change === 'ABA' ? 3 : 2)
                if (outcome === 'success') {
                    pending.resolve(listing)
                } else {
                    pending.reject(new Error('Old fixture list failed'))
                }
                await request
                expect(flow.fetch).not.toHaveBeenCalled()
                expect(flow.frames).toEqual([''])
                expect(flow.errors).toEqual([''])
                expect(flow.loading).toEqual([true])
            })
        }

        for (const outcome of ['success', 'response failure', 'rejection']) {
            test(`ignores the old resource ${outcome} after ${change}`, async () => {
                const flow = setup()
                const pending = Promise.withResolvers<{ok: boolean; status: number; statusText: string}>()
                const started = Promise.withResolvers<void>()
                flow.fetch.mockImplementation(() => {
                    started.resolve()
                    return pending.promise
                })
                const request = flow.callback()()
                await started.promise
                flow.replaceConnection(change === 'ABA' ? 3 : 2)
                if (outcome === 'rejection') {
                    pending.reject(new Error('Old fixture fetch failed'))
                } else {
                    pending.resolve({ok: outcome === 'success', status: outcome === 'success' ? 200 : 401, statusText: 'Old fixture'})
                }
                await request
                expect(flow.frames).toEqual([''])
                expect(flow.errors).toEqual([''])
                expect(flow.loading).toEqual([true])
            })
        }

        test(`a callback retained before ${change} sends no request`, async () => {
            const flow = setup()
            const callback = flow.callback()
            flow.replaceConnection(change === 'ABA' ? 3 : 2)
            await callback()
            expect(flow.list).not.toHaveBeenCalled()
            expect(flow.fetch).not.toHaveBeenCalled()
            expect(flow.loading).toEqual([])
            expect(flow.errors).toEqual([])
            expect(flow.frames).toEqual([])
        })
    }

    test('an old HTTP failure cannot replace a newer request result', async () => {
        const flow = setup()
        const pending = Promise.withResolvers<{ok: boolean; status: number; statusText: string}>()
        const started = Promise.withResolvers<void>()
        flow.fetch.mockImplementation(() => {
            started.resolve()
            return pending.promise
        })
        const request = flow.callback()()
        await started.promise
        ++flow.scope.loadSeqRef.current
        pending.resolve({ok: false, status: 401, statusText: 'Old fixture'})
        await request
        expect(flow.errors).toEqual([''])
        expect(flow.frames).toEqual([''])
        expect(flow.loading).toEqual([true])
    })

    test('loading effect cleanup cancels queued work and invalidates the in-flight owner', () => {
        const flow = setup()
        const controller = new AbortController()
        flow.scope.loadSeqRef.current = 4
        flow.scope.loadAbortRef.current = controller
        const effect = loadingEffect(flow, async () => {})
        effect.cleanup()
        expect(effect.clearTimeout).toHaveBeenCalledWith(7)
        expect(flow.scope.loadSeqRef.current).toBe(5)
        expect(controller.signal.aborted).toBe(true)
    })

    test('a disposed loading effect cannot publish the pending resource response', async () => {
        const flow = setup()
        const pending = Promise.withResolvers<{ok: boolean; status: number; statusText: string}>()
        const started = Promise.withResolvers<void>()
        flow.fetch.mockImplementation(() => {
            started.resolve()
            return pending.promise
        })
        const loadResource = flow.callback()
        const effect = loadingEffect(flow, loadResource)
        const request = loadResource()
        await started.promise
        const signal = flow.fetch.mock.calls[0][1].signal
        effect.cleanup()
        expect(signal?.aborted).toBe(true)
        pending.resolve({ok: true, status: 200, statusText: 'OK'})
        await request
        expect(flow.frames).toEqual([''])
        expect(flow.errors).toEqual([''])
        expect(flow.loading).toEqual([true])
    })

    test('a new request aborts the previous controller and keeps its own result', async () => {
        const flow = setup()
        const pending = Promise.withResolvers<typeof listing>()
        flow.list.mockImplementationOnce(() => pending.promise)
        const loadResource = flow.callback()
        const old = loadResource()
        const previous = flow.scope.loadAbortRef.current
        await loadResource()
        expect(previous?.signal.aborted).toBe(true)
        pending.resolve(listing)
        await old
        expect(flow.fetch).toHaveBeenCalledTimes(1)
        expect(flow.frames).toEqual(['', '', 'https://fixture.example' + resource])
        expect(flow.loading).toEqual([true, true, false])
    })

    for (const path of ['https://other.example/v0/resource/plugins/fixture/index.html', '/unrelated/index.html']) {
        test(`does not send authentication to an untrusted resource ${path}`, async () => {
            const flow = setup()
            flow.scope.resourceKey = path
            flow.list.mockResolvedValue({...listing, plugins: [{...plugin, menus: [{path, menu: 'Fixture', description: ''}]}]})
            await flow.callback()()
            expect(flow.fetch).not.toHaveBeenCalled()
            expect(flow.errors).toEqual(['', 'plugin_resource.invalid_src'])
            expect(flow.frames).toEqual([''])
        })
    }
})
