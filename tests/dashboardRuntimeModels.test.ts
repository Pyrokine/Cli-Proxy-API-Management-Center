import {describe, expect, test} from 'bun:test'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'

const source = readFileSync(new URL('../src/pages/DashboardPage.tsx', import.meta.url), 'utf8')
const start = source.indexOf('const fetchModels = useCallback(')
const end = source.indexOf('\n    useEffect(', start)
if (start < 0 || end < 0) {
    throw new Error('Dashboard model request callback not found')
}
const callbackSource = new Bun.Transpiler({loader: 'ts'}).transformSync(source.slice(start, end))

function createHarness(connectionStatus = 'connected', pageLayerStatus = 'current') {
    const calls: unknown[][] = []
    const loading: boolean[] = []
    let keyReads = 0
    const modelsRequestGeneration = {current: 0}
    let complete: (() => void) | undefined
    const pending = new Promise<void>((resolve) => { complete = resolve })
    const context = {
        connectionStatus,
        pageLayerStatus,
        apiBase: 'https://management.example.invalid',
        modelsRequestGeneration,
        useCallback: (callback: () => Promise<void>) => callback,
        setModelsRequestLoading: (value: boolean) => loading.push(value),
        resolveApiKeys: async () => { ++keyReads; return ['synthetic-client-key'] },
        fetchModelsFromStore: (...args: unknown[]) => { calls.push(args); return pending },
    }
    const fetchModels = runInNewContext(`${callbackSource}\nfetchModels`, context) as () => Promise<void>
    return {fetchModels, calls, loading, modelsRequestGeneration, complete: () => complete?.(), keyReads: () => keyReads}
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
        expect(harness.calls).toEqual([['https://management.example.invalid']])
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
