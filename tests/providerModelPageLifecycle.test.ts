import {describe, expect, mock, spyOn, test} from 'bun:test'
import {apiClient} from '@/services/api/client'
import type {ModelInfo} from '@/utils/models'
import {findMissingProviderModelNames} from '@/utils/providerModels'
import {sourceCallback, sourceInitializer} from './sourceCallbacks'

const file = 'pages/ProviderModelsPage.tsx'

function page() {
    const generation = spyOn(apiClient, 'getAuthGeneration').mockReturnValue(1)
    let resolve!: (value: ModelInfo[]) => void
    let reject!: (reason: unknown) => void
    const response = new Promise<ModelInfo[]>((accept, decline) => {resolve = accept; reject = decline})
    const fetchModels = mock(() => response)
    const updates: Array<[string, unknown]> = []
    const requestControllerRef = {current: null as AbortController | null}
    const requestGenerationRef = {current: 0}
    const scope = {
        apiClient, authGeneration: 1, initialLoading: false, requestControllerRef, requestGenerationRef,
        configuredModelEntries: [], findMissingProviderModelNames, fetchModels,
        buildErrorDiagnostic: undefined, fetchErrorLabel: 'failure', i18nPrefix: 'synthetic',
        t: (key: string) => key, buildEndpoint: () => 'https://fixture.invalid/v1/models',
        buildAutoFetchSignature: () => 'fixture', autoFetchSignatureRef: {current: ''}, canAutoFetch: () => true,
        setFetching: (value: boolean) => updates.push(['fetching', value]),
        setError: (value: string) => updates.push(['error', value]),
        setModels: (value: ModelInfo[]) => updates.push(['models', value]),
        setSelected: (value: Set<string>) => updates.push(['selected', value]),
        setEndpoint: (value: string) => updates.push(['endpoint', value]),
        setSearch: (value: string) => updates.push(['search', value]),
        setDiscoveryGeneration: (value: number) => updates.push(['generation', value]),
    }
    const doFetch = sourceCallback<() => Promise<void>>(file, 'doFetch', scope)
    return {scope: {...scope, doFetch}, doFetch, generation, resolve, reject, fetchModels, updates, requestControllerRef}
}

describe('shared provider model page result ownership', () => {
    for (const outcome of ['success', 'failure'] as const) {
        test(`ignores an old ${outcome} after a management connection change`, async () => {
            const current = page()
            try {
                const pending = current.doFetch()
                const before = [...current.updates]
                current.generation.mockReturnValue(3)
                if (outcome === 'success') {
                    current.resolve([{name: 'old-model'}])
                } else {
                    current.reject(new Error('synthetic old failure'))
                }
                await pending
                expect(current.updates).toEqual(before)
            } finally {
                current.generation.mockRestore()
            }
        })
    }

    test('old callbacks cannot start another model request', async () => {
        const current = page()
        try {
            current.generation.mockReturnValue(3)
            current.resolve([])
            await current.doFetch()
            expect(current.fetchModels).not.toHaveBeenCalled()
            expect(current.updates).toEqual([])
        } finally {
            current.generation.mockRestore()
        }
    })

    test('unmount prevents late pending-state updates', async () => {
        const current = page()
        try {
            const pending = current.doFetch()
            sourceCallback<() => () => void>(file, 'useEffect', current.scope, 'requestControllerRef.current?.abort()')()()
            const before = [...current.updates]
            current.resolve([{name: 'old-model'}])
            await pending
            expect(current.updates).toEqual(before)
            expect(current.requestControllerRef.current).toBeNull()
        } finally {
            current.generation.mockRestore()
        }
    })

    test('discarded auto-fetch effects do not make a request or update the page', async () => {
        const current = page()
        try {
            const cleanup = sourceCallback<() => (() => void) | void>(file, 'useEffect', current.scope, 0)()
            cleanup?.()
            sourceCallback<() => () => void>(file, 'useEffect', current.scope, 'requestControllerRef.current?.abort()')()()
            current.resolve([])
            await Promise.resolve()
            await Promise.resolve()
            expect(current.fetchModels).not.toHaveBeenCalled()
            expect(current.updates).toEqual([])
        } finally {
            current.generation.mockRestore()
        }
    })

    test('equivalent auto-fetch dependencies leave the current result and request untouched', async () => {
        const current = page()
        const doFetch = mock(async () => {})
        try {
            const scope = {...current.scope, doFetch}
            sourceCallback<() => (() => void) | void>(file, 'useEffect', scope, 0)()
            await Promise.resolve()
            const controller = new AbortController()
            current.requestControllerRef.current = controller
            const before = [...current.updates]
            sourceCallback<() => (() => void) | void>(file, 'useEffect', scope, 0)()
            await Promise.resolve()
            expect(controller.signal.aborted).toBe(false)
            expect(current.updates).toEqual(before)
            expect(doFetch).toHaveBeenCalledTimes(1)
        } finally {
            current.generation.mockRestore()
        }
    })

    test('old apply callbacks cannot merge models or navigate on another connection', () => {
        const current = page()
        const mergeDiscoveredModels = mock(() => {})
        const handleBack = mock(() => {})
        try {
            const scope = {...current.scope, sourceLoaded: true, models: [{name: 'synthetic'}], selected: new Set(['synthetic']), mergeDiscoveredModels, handleBack}
            const apply = sourceInitializer<() => void>(file, 'handleApply', scope)
            apply()
            expect(mergeDiscoveredModels).toHaveBeenCalledTimes(1)
            expect(handleBack).toHaveBeenCalledTimes(1)
            mergeDiscoveredModels.mockClear()
            handleBack.mockClear()
            current.generation.mockReturnValue(3)
            apply()
            expect(mergeDiscoveredModels).not.toHaveBeenCalled()
            expect(handleBack).not.toHaveBeenCalled()
        } finally {
            current.generation.mockRestore()
        }
    })

    test('current request failure remains visible and clears pending ownership', async () => {
        const current = page()
        try {
            const pending = current.doFetch()
            current.reject(new Error('synthetic current failure'))
            await pending
            expect(current.updates).toContainEqual(['error', 'failure: synthetic current failure'])
            expect(current.updates[current.updates.length - 1]).toEqual(['fetching', false])
            expect(current.requestControllerRef.current).toBeNull()
        } finally {
            current.generation.mockRestore()
        }
    })
})
