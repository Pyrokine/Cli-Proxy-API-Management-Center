import {describe, expect, mock, spyOn, test} from 'bun:test'
import {apiCallApi} from '@/services/api/apiCall'
import {apiClient} from '@/services/api/client'
import {modelsApi} from '@/services/api/models'
import {buildHeaderObject} from '@/utils/headers'
import type {ModelInfo} from '@/utils/models'
import {findMissingProviderModelNames} from '@/utils/providerModels'
import {sourceCallback, sourceInitializer} from './sourceCallbacks'

const file = 'hooks/useModelDiscovery.ts'

function deferred<T>() {
    let resolve!: (value: T) => void
    let reject!: (reason: unknown) => void
    const promise = new Promise<T>((accept, decline) => {resolve = accept; reject = decline})
    return {promise, resolve, reject}
}

function discovery() {
    const generation = spyOn(apiClient, 'getAuthGeneration').mockReturnValue(1)
    const response = deferred<ModelInfo[]>()
    const fetchModels = mock(() => response.promise)
    const updates: Array<[string, unknown]> = []
    const requestControllerRef = {current: null as AbortController | null}
    const requestIdRef = {current: 0}
    const scope = {
        apiClient, authGeneration: 1, open: true,
        formState: {apiKey: 'synthetic', baseUrl: 'https://fixture.invalid', proxyUrl: 'http://proxy.invalid', headers: [], modelEntries: []},
        requestIdRef, requestControllerRef, autoFetchSignatureRef: {current: ''},
        discoveryConfigRef: {current: {fetchModels, buildEndpoint: () => 'https://fixture.invalid/v1/models', canAutoFetch: () => true, buildErrorMessage: () => 'synthetic discovery failure'}},
        setFetching: (value: boolean) => updates.push(['fetching', value]),
        setError: (value: string) => updates.push(['error', value]),
        setDiscoveredModels: (value: ModelInfo[]) => updates.push(['models', value]),
        setSelected: (value: Set<string>) => updates.push(['selected', value]),
        setEndpoint: (value: string) => updates.push(['endpoint', value]),
        setSearch: (value: string) => updates.push(['search', value]),
        setDiscoveryGeneration: (value: number) => updates.push(['generation', value]),
        normalizeName: (name: string) => name.trim(), buildHeaderObject, findMissingProviderModelNames,
    }
    const fetch = sourceCallback<() => Promise<void>>(file, 'fetchDiscovery', scope)
    return {scope: {...scope, fetchDiscovery: fetch}, fetch, generation, response, fetchModels, updates, requestControllerRef, requestIdRef}
}

describe('provider model discovery lifecycle', () => {
    for (const outcome of ['success', 'failure'] as const) {
        test(`does not publish an old ${outcome} discovery after switching connections`, async () => {
            const current = discovery()
            try {
                const pending = current.fetch()
                const before = [...current.updates]
                current.generation.mockReturnValue(3)
                if (outcome === 'success') {
                    current.response.resolve([{name: 'old-model'}])
                } else {
                    current.response.reject(new Error('synthetic old failure'))
                }
                await pending
                expect(current.updates).toEqual(before)
            } finally {
                current.generation.mockRestore()
            }
        })
    }

    test('old discovery callbacks cannot dispatch on the current connection', async () => {
        const current = discovery()
        try {
            current.generation.mockReturnValue(3)
            current.response.resolve([])
            await current.fetch()
            expect(current.fetchModels).not.toHaveBeenCalled()
            expect(current.updates).toEqual([])
        } finally {
            current.generation.mockRestore()
        }
    })

    test('unmount does not publish completion or pending-state changes', async () => {
        const current = discovery()
        try {
            const pending = current.fetch()
            const cleanup = sourceCallback<() => () => void>(file, 'useEffect', current.scope, 'requestControllerRef.current?.abort()')()
            cleanup()
            const before = [...current.updates]
            current.response.resolve([{name: 'old-model'}])
            await pending
            expect(current.updates).toEqual(before)
            expect(current.requestControllerRef.current).toBeNull()
        } finally {
            current.generation.mockRestore()
        }
    })

    test('an auto-fetch queued by a discarded effect never dispatches', async () => {
        const current = discovery()
        try {
            const cleanup = sourceCallback<() => (() => void) | void>(file, 'useEffect', current.scope, 1)()
            cleanup?.()
            const unmount = sourceCallback<() => () => void>(file, 'useEffect', current.scope, 'requestControllerRef.current?.abort()')()
            unmount()
            current.response.resolve([])
            await Promise.resolve()
            await Promise.resolve()
            expect(current.fetchModels).not.toHaveBeenCalled()
            expect(current.updates).toEqual([])
        } finally {
            current.generation.mockRestore()
        }
    })

    test('equivalent input rerenders preserve the active discovery and displayed data', async () => {
        const current = discovery()
        const fetchDiscovery = mock(async () => {})
        try {
            const scope = {...current.scope, fetchDiscovery}
            sourceCallback<() => (() => void) | void>(file, 'useEffect', scope, 1)()
            await Promise.resolve()
            const controller = new AbortController()
            current.requestControllerRef.current = controller
            const before = [...current.updates]
            sourceCallback<() => (() => void) | void>(file, 'useEffect', {...scope, formState: {...scope.formState, modelEntries: []}}, 1)()
            await Promise.resolve()
            expect(controller.signal.aborted).toBe(false)
            expect(current.updates).toEqual(before)
            expect(fetchDiscovery).toHaveBeenCalledTimes(1)
        } finally {
            current.generation.mockRestore()
        }
    })

    test('stored identities and header entries independently invalidate discovery', async () => {
        const current = discovery()
        const fetchDiscovery = mock(async () => {})
        try {
            const scope = {...current.scope, fetchDiscovery, formState: {...current.scope.formState, authIndex: 'first', headers: [{key: 'a', value: 'b|c:d'}]}}
            sourceCallback<() => (() => void) | void>(file, 'useEffect', scope, 1)()
            await Promise.resolve()
            const first = scope.autoFetchSignatureRef.current
            sourceCallback<() => (() => void) | void>(file, 'useEffect', {...scope, formState: {...scope.formState, headers: [{key: 'a', value: 'b'}, {key: 'c', value: 'd'}]}}, 1)()
            await Promise.resolve()
            const second = scope.autoFetchSignatureRef.current
            expect(second).not.toBe(first)
            sourceCallback<() => (() => void) | void>(file, 'useEffect', {...scope, formState: {...scope.formState, authIndex: 'second'}}, 1)()
            await Promise.resolve()
            expect(scope.autoFetchSignatureRef.current).not.toBe(first)
            expect(fetchDiscovery).toHaveBeenCalledTimes(3)
        } finally {
            current.generation.mockRestore()
        }
    })

    test('discovery reruns when only the management connection changes', async () => {
        const current = discovery()
        const fetchDiscovery = mock(async () => {})
        try {
            const scope = {...current.scope, fetchDiscovery}
            sourceCallback<() => (() => void) | void>(file, 'useEffect', scope, 1)()
            await Promise.resolve()
            const first = scope.autoFetchSignatureRef.current
            current.generation.mockReturnValue(3)
            sourceCallback<() => (() => void) | void>(file, 'useEffect', {...scope, authGeneration: 3}, 1)()
            await Promise.resolve()
            expect(scope.autoFetchSignatureRef.current).not.toBe(first)
            expect(fetchDiscovery).toHaveBeenCalledTimes(2)
        } finally {
            current.generation.mockRestore()
        }
    })

    test('an old apply callback cannot merge models or close the current editor', () => {
        const current = discovery()
        const mergeDiscoveredModels = mock(() => {})
        const setOpen = mock(() => {})
        try {
            const apply = sourceInitializer<() => void>(file, 'applySelected', {...current.scope, sourceLoaded: true, discoveredModels: [{name: 'synthetic'}], selected: new Set(['synthetic']), mergeDiscoveredModels, setOpen})
            apply()
            expect(mergeDiscoveredModels).toHaveBeenCalledTimes(1)
            expect(setOpen).toHaveBeenCalledWith(false)
            mergeDiscoveredModels.mockClear()
            setOpen.mockClear()
            current.generation.mockReturnValue(3)
            apply()
            expect(mergeDiscoveredModels).not.toHaveBeenCalled()
            expect(setOpen).not.toHaveBeenCalled()
        } finally {
            current.generation.mockRestore()
        }
    })

    test('current discovery errors remain visible and clear the current pending state', async () => {
        const current = discovery()
        try {
            const pending = current.fetch()
            current.response.reject(new Error('synthetic current failure'))
            await pending
            expect(current.updates).toContainEqual(['error', 'synthetic discovery failure'])
            expect(current.updates[current.updates.length - 1]).toEqual(['fetching', false])
            expect(current.requestControllerRef.current).toBeNull()
        } finally {
            current.generation.mockRestore()
        }
    })
})

for (const provider of ['Claude', 'Gemini'] as const) {
    test(`${provider} discovery does not share an in-flight request across management connections`, async () => {
        const generation = spyOn(apiClient, 'getAuthGeneration').mockReturnValue(1)
        type Result = Awaited<ReturnType<typeof apiCallApi.request>>
        const firstResponse = deferred<Result>()
        const secondResponse = deferred<Result>()
        const request = spyOn(apiCallApi, 'request')
            .mockImplementationOnce(() => firstResponse.promise)
            .mockImplementationOnce(() => secondResponse.promise)
        let first: Promise<ModelInfo[]> | undefined
        let second: Promise<ModelInfo[]> | undefined
        try {
            const fetch = provider === 'Claude' ? modelsApi.fetchClaudeModelsViaApiCall : modelsApi.fetchGeminiModelsViaApiCall
            first = fetch('https://fixture.invalid', undefined, {}, undefined, 'synthetic-index')
            generation.mockReturnValue(3)
            second = fetch('https://fixture.invalid', undefined, {}, undefined, 'synthetic-index')
            expect(request).toHaveBeenCalledTimes(2)
            firstResponse.resolve({statusCode: 200, header: {}, bodyText: '', body: {data: [{id: 'first-model'}]}})
            secondResponse.resolve({statusCode: 200, header: {}, bodyText: '', body: {data: [{id: 'second-model'}]}})
            expect((await first).map((model) => model.name)).toEqual(['first-model'])
            expect((await second).map((model) => model.name)).toEqual(['second-model'])
        } finally {
            firstResponse.resolve({statusCode: 200, header: {}, bodyText: '', body: {data: []}})
            secondResponse.resolve({statusCode: 200, header: {}, bodyText: '', body: {data: []}})
            await Promise.all([first, second])
            request.mockRestore()
            generation.mockRestore()
        }
    })
}
