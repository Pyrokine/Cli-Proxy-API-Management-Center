import {describe, expect, test} from 'bun:test'
import {readFileSync} from 'node:fs'
import i18n from '@/i18n'
import {sourceCallback} from './sourceCallbacks'

const flowFile = 'components/credentials/VertexImportFlow.tsx'
const result = {status: 'ok', project_id: 'fixture-project', email: 'fixture@example.test',
    location: 'us-central1', 'auth-file': 'fixture-vertex.json', private_key: 'must-not-display'}

function importScope() {
    let generation = 1
    const mounted = {current: true}
    const importing = {current: false}
    const loading: boolean[] = []
    const notifications: Array<[string, string]> = []
    const requests: Array<[File, string | undefined]> = []
    let refreshed = 0
    const file = new File(['{}'], 'fixture.json', {type: 'application/json'})
    const scope = {
        mounted, importing, file, location: ' us-central1 ', disableControls: false,
        apiClient: {getAuthGeneration: () => generation},
        vertexApi: {importCredential: async (file: File, region?: string) => {
            requests.push([file, region])
            return result
        }},
        setLoading: (value: boolean) => loading.push(value),
        showNotification: (message: string, kind: string) => notifications.push([message, kind]),
        onSuccess: async () => {refreshed++},
        t: i18n.getFixedT('en'),
    }
    return {
        scope, loading, notifications, requests,
        refreshed: () => refreshed,
        replaceConnection: () => {generation++},
        callback: () => sourceCallback<() => Promise<void>>(flowFile, 'handleImport', scope),
    }
}

describe('Vertex import flow', () => {
    test('shows the safe import result and refreshes credentials once', async () => {
        const flow = importScope()
        await flow.callback()()
        expect(flow.requests).toEqual([[flow.scope.file, 'us-central1']])
        expect(flow.loading).toEqual([true, false])
        expect(flow.refreshed()).toBe(1)
        expect(flow.notifications).toHaveLength(1)
        expect(flow.notifications[0]?.[1]).toBe('success')
        for (const value of [result.project_id, result.email, result.location, result['auth-file']]) {
            expect(flow.notifications[0]?.[0]).toContain(value)
        }
        expect(flow.notifications[0]?.[0]).not.toContain(result.private_key)
        expect(flow.scope.importing.current).toBe(false)
    })

    test('rejects disabled, unmounted and duplicate imports before sending', async () => {
        for (const blocked of ['disabled', 'unmounted', 'duplicate']) {
            const flow = importScope()
            if (blocked === 'disabled') {
                flow.scope.disableControls = true
            }
            if (blocked === 'unmounted') {
                flow.scope.mounted.current = false
            }
            if (blocked === 'duplicate') {
                flow.scope.importing.current = true
            }
            await flow.callback()()
            expect(flow.requests).toHaveLength(0)
            expect(flow.notifications).toHaveLength(0)
            expect(flow.loading).toHaveLength(0)
        }
    })

    test('ignores success from a previous connection or closed flow', async () => {
        for (const outcome of ['connection', 'unmount']) {
            const flow = importScope()
            let settle: (value: typeof result) => void = () => undefined
            flow.scope.vertexApi.importCredential = () => new Promise((resolve) => {settle = resolve})
            const pending = flow.callback()()
            if (outcome === 'connection') {
                flow.replaceConnection()
            }
            if (outcome === 'unmount') {
                flow.scope.mounted.current = false
            }
            settle(result)
            await pending
            expect(flow.notifications).toHaveLength(0)
            expect(flow.refreshed()).toBe(0)
            expect(flow.scope.importing.current).toBe(false)
            expect(flow.loading).toEqual(outcome === 'connection' ? [true, false] : [true])
        }
    })

    test('shows current failures without exposing server details and ignores stale failures', async () => {
        for (const stale of [false, true]) {
            const flow = importScope()
            flow.scope.vertexApi.importCredential = async () => {
                if (stale) {
                    flow.replaceConnection()
                }
                throw new Error('private_key must-not-display')
            }
            await flow.callback()()
            expect(flow.refreshed()).toBe(0)
            expect(flow.notifications).toHaveLength(stale ? 0 : 1)
            if (!stale) {
                expect(flow.notifications[0]).toEqual([i18n.getFixedT('en')('common.error'), 'error'])
            }
            expect(flow.scope.importing.current).toBe(false)
        }
    })

    test('does not duplicate a request while the initial import is pending', async () => {
        const flow = importScope()
        let calls = 0
        let settle: (value: typeof result) => void = () => undefined
        flow.scope.vertexApi.importCredential = () => {
            calls++
            return new Promise((resolve) => {settle = resolve})
        }
        const callback = flow.callback()
        const first = callback()
        await callback()
        expect(calls).toBe(1)
        settle(result)
        await first
        expect(flow.refreshed()).toBe(1)
    })

    test('validates the selected extension and prevents a stale picker changing the flow', () => {
        for (const outcome of ['valid', 'invalid', 'connection', 'unmount']) {
            const files = [new File(['{}'], outcome === 'invalid' ? 'wrong.txt' : 'SERVICE.JSON')]
            const selected: Array<File | null> = []
            const notifications: string[] = []
            let generation = 1
            const mounted = {current: true}
            const input = {type: '', accept: '', files, onchange: () => undefined, click: () => undefined}
            const selectFile = sourceCallback<() => void>(flowFile, 'selectFile', {
                disableControls: false, importing: {current: false}, mounted,
                apiClient: {getAuthGeneration: () => generation},
                document: {createElement: () => input},
                setFile: (file: File | null) => selected.push(file),
                showNotification: (message: string) => notifications.push(message),
                t: i18n.getFixedT('en'),
            })
            selectFile()
            expect(input.accept).toBe('.json,application/json')
            if (outcome === 'connection') {
                generation++
            }
            if (outcome === 'unmount') {
                mounted.current = false
            }
            input.onchange()
            expect(selected).toEqual(outcome === 'invalid' ? [null] : outcome === 'valid' ? files : [])
            expect(notifications).toHaveLength(outcome === 'invalid' ? 1 : 0)
        }
    })

    test('invalidates the mounted owner on cleanup and disables import when controls are blocked', () => {
        const mounted = {current: false}
        const effect = sourceCallback<() => () => void>(flowFile, 'useEffect', {mounted})
        const cleanup = effect()
        expect(mounted.current).toBe(true)
        cleanup()
        expect(mounted.current).toBe(false)
        const source = readFileSync(new URL('../src/components/credentials/VertexImportFlow.tsx', import.meta.url), 'utf8')
        expect(source).toContain('disabled={!file || disableControls || loading}')
        for (const language of ['en', 'ru', 'zh-CN', 'zh-TW']) {
            const messages = JSON.parse(readFileSync(new URL(`../src/i18n/locales/${language}.json`, import.meta.url), 'utf8'))
            for (const key of ['success', 'file_required', 'result_project', 'result_email', 'result_location', 'result_file']) {
                expect(messages.vertex_import[key]).toBeTruthy()
            }
        }
    })
})
