import {describe, expect, test} from 'bun:test'
import {readFileSync} from 'node:fs'
import {sourceCallback} from './sourceCallbacks'

const source = readFileSync(new URL('../src/pages/DashboardPage.tsx', import.meta.url), 'utf8')

function createHarness(connectionStatus = 'connected', pageLayerStatus = 'current') {
    const calls: unknown[][]      = []
    const loading: boolean[]      = []
    let keyReads                  = 0
    let authGeneration            = 1
    const modelsRequestGeneration = { current: 0 }
    let complete: (() => void) | undefined
    let reject: ((error: Error) => void) | undefined
    const pending                 = new Promise<void>((resolve, fail) => {
        complete = resolve;
        reject   = fail
    })
    const context                 = {
        apiClient: { getAuthGeneration: () => authGeneration },
        connectionStatus,
        pageLayerStatus,
        apiBase: 'https://management.example.invalid',
        modelsRequestGeneration,
        useCallback: (callback: () => Promise<void>) => callback,
        // noinspection JSUnusedGlobalSymbols
        'setModelsRequestLoading': (value: boolean) => loading.push(value),
        // noinspection JSUnusedGlobalSymbols
        'resolveApiKeys': async () => {
            ++keyReads;
            return ['synthetic-client-key']
        },
        // noinspection JSUnusedGlobalSymbols
        'fetchModelsFromStore': (...args: unknown[]) => {
            calls.push(args);
            return pending
        },
    }
    const fetchModels             = sourceCallback<(force?: boolean) => Promise<void>>(
        'pages/DashboardPage.tsx',
        'fetchModels',
        context,
    )
    return {
        fetchModels, calls, loading, modelsRequestGeneration, complete: () => complete?.(), keyReads: () => keyReads,
        changeConnection: () => {
            ++authGeneration
        }, fail: () => reject?.(new Error('synthetic model failure')),
    }
}

describe('dashboard runtime model inventory', () => {
    test('uses the management inventory and its loading and error state', () => {
        for (const selector of ['runtimeModels', 'runtimeLoading', 'runtimeError', 'fetchRuntimeModels']) {
            expect(source).toMatch(new RegExp(`useModelsStore\\(\\(state\\) => state\\.${selector}\\)`))
        }
        expect(source).not.toContain('useApiKeysResolver')
        expect(source).toMatch(/sublabel:\s*modelsError\s*\|\|/)
    })

    test('does not read or forward a client API key', async () => {
        const harness = createHarness()
        const request = harness.fetchModels()
        await Promise.resolve()
        expect(harness.keyReads()).toBe(0)
        expect(harness.calls).toEqual([['https://management.example.invalid', false]])
        harness.complete()
        await request
        expect(harness.loading).toEqual([true, false])
    })

    test('does not fetch for a disconnected or outgoing page', async () => {
        for (const [connection, page] of [['disconnected', 'current'], ['connected', 'outgoing']]) {
            const harness = createHarness(connection, page)
            await harness.fetchModels()
            expect(harness.calls).toEqual([])
            expect(harness.keyReads()).toBe(0)
        }
    })

    test('explicit header refresh forces the management inventory and reports its current failure', async () => {
        const harness = createHarness()
        const request = harness.fetchModels(true)
        expect(harness.calls).toEqual([['https://management.example.invalid', true]])
        harness.fail()
        expect(request).rejects.toThrow('synthetic model failure')
        expect(harness.loading).toEqual([true, false])
        expect(harness.keyReads()).toBe(0)
    })

    test('model completion from an older connection cannot change current loading', async () => {
        const harness = createHarness()
        const request = harness.fetchModels()
        harness.changeConnection()
        harness.complete()
        await request
        expect(harness.loading).toEqual([true])
    })

    test('late completion cannot clear a newer loading state', async () => {
        const harness = createHarness()
        const request = harness.fetchModels()
        await Promise.resolve()
        ++harness.modelsRequestGeneration.current
        harness.complete()
        await request
        expect(harness.loading).toEqual([true])
    })
})
