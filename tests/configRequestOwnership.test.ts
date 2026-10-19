import {describe, expect, mock, test} from 'bun:test'
import {readFileSync} from 'node:fs'
import {ConfigEditorRevisionState} from '@/pages/configEditorRevision'
import {decodeVisualConfigYaml, encodeVisualConfigYaml} from '@/hooks/visualConfigCodec'
import {parseDocument, parse} from 'yaml'
import {sourceCallback, sourceInitializer} from './sourceCallbacks'

const PAGE = 'pages/ConfigPage.tsx'

function deferred<T>() {
    let resolve!: (value: T) => void
    let reject!: (reason: unknown) => void
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise
        reject = rejectPromise
    })
    return {promise, resolve, reject}
}

function editorScope(serverYaml = 'debug: false\n', draft = 'debug: true\n') {
    let generation = 1
    const authGeneration = generation
    const mountedRef = {current: true}
    let decoded = decodeVisualConfigYaml(serverYaml)
    let next = decodeVisualConfigYaml(draft).values
    let baselineYaml = serverYaml
    const revisions = new ConfigEditorRevisionState(() => generation)
    revisions.acceptServerRevision()
    revisions.resetSource(serverYaml)
    revisions.markDraftChanged()
    const state: Record<string, unknown> = {content: draft, dirty: true, saving: false, loading: false}
    const setter = (key: string) => mock((value: unknown) => {state[key] = value})
    const prepared = {
        revision: revisions.snapshot(), origin: 'visual', content: draft,
        serverYaml, diffOriginalYaml: serverYaml, serverEtag: 'fixture-etag',
    }
    const scope = {
        authGeneration,
        mountedRef,
        isCurrentConnection: () => mountedRef.current && authGeneration === generation,
        apiClient: {getAuthGeneration: () => generation},
        revisionStateRef: {current: revisions},
        preparedSaveRef: {current: prepared as typeof prepared | null},
        runtimeRequestSequenceRef: {current: 0},
        isDirtyRef: {current: true},
        activeTab: 'visual', visualParseError: null, saveNeedsReload: false,
        disableControls: false,
        configFileApi: {
            fetchConfigYaml: mock(async () => ({content: serverYaml, etag: 'latest-etag'})),
            saveConfigYaml: mock(async () => ({})),
            validateConfigYaml: mock(async () => ({valid: true, errors: [], warnings: []})),
        },
        logsApi: {fetchLogSize: mock(async () => ({total_bytes: 10}))},
        usageApi: {getDBSize: mock(async () => ({size_bytes: 20}))},
        artifactsApi: {fetchImageArtifactCacheSize: mock(async () => ({total_bytes: 30}))},
        clearConfigCache: mock(() => {}), fetchConfig: mock(async () => {}),
        allowNextNavigation: mock(() => {}), showNotification: mock(() => {}),
        apiErrorStatus: sourceCallback<(error: unknown) => number | undefined>(PAGE, 'apiErrorStatus', {}),
        readCommercialModeFromYaml: sourceCallback<(yaml: string) => boolean>(PAGE, 'readCommercialModeFromYaml', {
            parseYaml: parse,
        }),
        parseDocument,
        t: (key: string) => key,
        setContent: setter('content'), setDirty: setter('dirty'), setLoading: setter('loading'),
        setSaving: setter('saving'), setError: setter('error'), setDiffModalOpen: setter('diffModalOpen'),
        setDiffOriginalYaml: setter('diffOriginalYaml'), setMergedYaml: setter('mergedYaml'),
        setValidationWarnings: setter('validationWarnings'), setValidationErrors: setter('validationErrors'),
        setRuntimeInfo: setter('runtimeInfo'),
        setSaveNeedsReload: mock((value: boolean) => {
            state.saveNeedsReload = value
            scope.saveNeedsReload = value
        }),
        clearPreparedSave: mock(() => {}),
        applyVisualChangesToYaml: (yaml: string) => encodeVisualConfigYaml(
            yaml, next, decoded.values, decoded.apiKeysStorage, baselineYaml,
        ),
        loadVisualValuesFromYaml: mock((yaml: string, apiKeysSource = yaml) => {
            baselineYaml = yaml
            decoded = decodeVisualConfigYaml(yaml, apiKeysSource)
            next = decoded.values
            return {ok: true}
        }),
    }
    scope.isCurrentConnection = sourceInitializer<() => boolean>(PAGE, 'isCurrentConnection', {
        ...scope, useCallback: <T>(callback: T) => callback,
    })
    scope.clearPreparedSave.mockImplementation(() => {
        scope.preparedSaveRef.current = null
        scope.setDiffModalOpen(false)
    })
    return {scope, state, switchConnection: () => {generation += 1}}
}

const confirm = (scope: Record<string, unknown>) => sourceInitializer<() => Promise<void>>(PAGE, 'handleConfirmSave', scope)
const prepare = (scope: Record<string, unknown>) => sourceInitializer<() => Promise<void>>(PAGE, 'handleSave', scope)

describe('config connection ownership', () => {
    test('binds snapshots, request generations and previews to A through A-B-A transitions', () => {
        let generation = 1
        const revisions = new ConfigEditorRevisionState(() => generation)
        const load = revisions.beginLoad()
        const prepared = revisions.snapshot()
        const save = revisions.beginSave()
        generation += 2
        expect(revisions.isCurrentGeneration(load)).toBe(false)
        expect(revisions.isCurrentGeneration(save)).toBe(false)
        expect(revisions.isCurrentRequest(save)).toBe(false)
        expect(revisions.matches(prepared)).toBe(false)
    })

    for (const outcome of ['success', 'error'] as const) {
        test(`does not publish a late configuration load ${outcome} from a prior connection`, async () => {
            const {scope, switchConnection} = editorScope()
            const response = deferred<{content: string; etag: string}>()
            scope.configFileApi.fetchConfigYaml.mockImplementation(() => response.promise)
            const load = sourceCallback<(discard?: boolean) => Promise<void>>(PAGE, 'loadConfig', scope)
            const pending = load(true)
            scope.setLoading.mockClear()
            scope.setError.mockClear()
            switchConnection()
            switchConnection()
            if (outcome === 'success') {
                response.resolve({content: 'debug: false\nproxy-url: old-connection\n', etag: 'old'})
            } else {
                response.reject(new Error('old connection failure'))
            }
            await pending
            expect(scope.setContent).not.toHaveBeenCalled()
            expect(scope.loadVisualValuesFromYaml).not.toHaveBeenCalled()
            expect(scope.setError).not.toHaveBeenCalled()
            expect(scope.setLoading).not.toHaveBeenCalled()
        })
    }

    test('does not send an old connection preview or modify the replacement editor', async () => {
        const {scope, switchConnection} = editorScope()
        const preview = scope.preparedSaveRef.current!
        switchConnection()
        await confirm(scope)()
        expect(scope.configFileApi.saveConfigYaml).not.toHaveBeenCalled()
        expect(scope.preparedSaveRef.current).toBe(preview)
        expect(scope.revisionStateRef.current.matches(preview.revision)).toBe(false)
        expect(scope.setDiffModalOpen).not.toHaveBeenCalled()
    })

    test('does not begin a new preview using a prior connection draft', async () => {
        const {scope, switchConnection} = editorScope()
        switchConnection()
        await prepare(scope)()
        expect(scope.configFileApi.fetchConfigYaml).not.toHaveBeenCalled()
        expect(scope.configFileApi.validateConfigYaml).not.toHaveBeenCalled()
    })

    test('does not publish a preview after the connection changes during validation', async () => {
        const {scope, switchConnection} = editorScope()
        const validation = deferred<{valid: boolean; errors: []; warnings: []}>()
        scope.configFileApi.validateConfigYaml.mockImplementation(() => validation.promise)
        const pending = prepare(scope)()
        await Promise.resolve()
        await Promise.resolve()
        expect(scope.configFileApi.validateConfigYaml).toHaveBeenCalledTimes(1)
        switchConnection()
        validation.resolve({valid: true, errors: [], warnings: []})
        await pending
        expect(scope.preparedSaveRef.current).toBeNull()
        expect(scope.setMergedYaml).not.toHaveBeenCalled()
        expect(scope.showNotification).not.toHaveBeenCalled()
    })

    test('stops conflict recovery before validation when the readback belongs to another connection', async () => {
        const {scope, switchConnection} = editorScope()
        const readback = deferred<{content: string; etag: string}>()
        scope.configFileApi.saveConfigYaml.mockRejectedValue(Object.assign(new Error('config changed'), {status: 412}))
        scope.configFileApi.fetchConfigYaml.mockImplementation(() => readback.promise)
        const pending = confirm(scope)()
        await Promise.resolve()
        await Promise.resolve()
        expect(scope.configFileApi.fetchConfigYaml).toHaveBeenCalledTimes(1)
        switchConnection()
        readback.resolve({content: 'debug: false\nproxy-url: new-connection\n', etag: 'new'})
        await pending
        expect(scope.configFileApi.validateConfigYaml).not.toHaveBeenCalled()
        expect(scope.setDiffOriginalYaml).not.toHaveBeenCalled()
    })

    test('does not publish runtime sizes from an older request or connection', async () => {
        for (const cause of ['request', 'connection']) {
            const {scope, switchConnection} = editorScope()
            const delayed = deferred<{total_bytes: number}>()
            scope.logsApi.fetchLogSize.mockImplementationOnce(() => delayed.promise)
            const load = sourceCallback<() => Promise<void>>(PAGE, 'loadRuntimeInfo', scope)
            const pending = load()
            if (cause === 'request') {
                await load()
            } else {
                switchConnection()
            }
            scope.setRuntimeInfo.mockClear()
            delayed.resolve({total_bytes: 999})
            await pending
            expect(scope.setRuntimeInfo).not.toHaveBeenCalled()
        }
    })

    test('clears the prior connection draft and preview before loading another connection', () => {
        const {scope, state, switchConnection} = editorScope()
        switchConnection()
        const queued: Array<() => void> = []
        const loadConfig = mock(() => {})
        const loadRuntimeInfo = mock(() => {})
        const effect = sourceCallback<() => () => void>(PAGE, 'useEffect', {
            ...scope, authGeneration: 2, connectionStatus: 'connected',
            ConfigEditorRevisionState, loadConfig, loadRuntimeInfo,
            queueMicrotask: (callback: () => void) => queued.push(callback),
        }, 'const revisions = revisionStateRef')
        const teardown = effect()
        queued.forEach((callback) => callback())
        expect(scope.revisionStateRef.current.snapshot().authGeneration).toBe(2)
        expect(scope.preparedSaveRef.current).toBeNull()
        expect(scope.isDirtyRef.current).toBe(false)
        expect(state.content).toBe('')
        expect(state.dirty).toBe(false)
        expect(state.saveNeedsReload).toBe(false)
        expect(loadConfig).toHaveBeenCalledTimes(1)
        expect(loadRuntimeInfo).toHaveBeenCalledTimes(1)
        const pending = scope.revisionStateRef.current.beginLoad()
        teardown()
        expect(scope.revisionStateRef.current.isCurrentGeneration(pending)).toBe(false)
    })

    test('does not start queued loads after teardown', () => {
        const {scope} = editorScope()
        const queued: Array<() => void> = []
        const loadConfig = mock(() => {})
        const loadRuntimeInfo = mock(() => {})
        const effect = sourceCallback<() => () => void>(PAGE, 'useEffect', {
            ...scope, authGeneration: 1, connectionStatus: 'connected',
            ConfigEditorRevisionState, loadConfig, loadRuntimeInfo,
            queueMicrotask: (callback: () => void) => queued.push(callback),
        }, 'const revisions = revisionStateRef')
        const teardown = effect()
        teardown()
        queued.forEach((callback) => callback())
        expect(loadConfig).not.toHaveBeenCalled()
        expect(loadRuntimeInfo).not.toHaveBeenCalled()
        expect(scope.preparedSaveRef.current).toBeNull()
        expect(scope.runtimeRequestSequenceRef.current).toBe(1)
    })

    test('saves and refreshes normally in the current connection', async () => {
        const {scope, state} = editorScope()
        scope.configFileApi.fetchConfigYaml.mockResolvedValue({content: 'debug: true\n', etag: 'new'})
        await confirm(scope)()
        expect(scope.configFileApi.saveConfigYaml).toHaveBeenCalledWith('debug: true\n', 'fixture-etag')
        expect(state.dirty).toBe(false)
        expect(state.content).toBe('debug: true\n')
        expect(scope.isDirtyRef.current).toBe(false)
    })
})

describe('config rendered-action ownership', () => {
    const actions = [
        ['loadConfig', [true]],
        ['loadRuntimeInfo', []],
        ['handleSave', []],
        ['handleConfirmSave', []],
        ['handleChange', ['debug: stale\n']],
        ['handleVisualChange', [{debug: false}]],
        ['handleTabChange', ['source']],
        ['handleReload', []],
    ] as const

    for (const cause of ['replacement', 'unmount'] as const) {
        for (const [name, args] of actions) {
            test(`an old ${name} never consumes the ${cause} editor`, async () => {
                const {scope, state, switchConnection} = editorScope()
                const setVisualValues = mock(() => {})
                const setActiveTab = mock(() => {})
                const showConfirmation = mock(() => {})
                const actionScope = {
                    ...scope, content: 'debug: true\n', isDirty: true, visualDirty: true,
                    useCallback: <T>(callback: T) => callback,
                    hasVisualValidationErrors: false, setVisualValues, setActiveTab, showConfirmation,
                    localStorage: {setItem: mock(() => {})},
                    markDraftChanged: sourceCallback<() => void>(PAGE, 'markDraftChanged', scope),
                    loadConfig: sourceCallback<(discard?: boolean) => Promise<void>>(PAGE, 'loadConfig', scope),
                    loadRuntimeInfo: sourceCallback<() => Promise<void>>(PAGE, 'loadRuntimeInfo', scope),
                }
                const action = sourceInitializer<(...args: unknown[]) => Promise<void> | void>(PAGE, name, actionScope)
                if (cause === 'replacement') {
                    switchConnection()
                    switchConnection()
                    const revisions = new ConfigEditorRevisionState(() => scope.apiClient.getAuthGeneration())
                    revisions.acceptServerRevision()
                    revisions.resetSource('debug: false\n')
                    scope.revisionStateRef.current = revisions
                    scope.preparedSaveRef.current = {...scope.preparedSaveRef.current!, revision: revisions.snapshot()}
                } else {
                    scope.mountedRef.current = false
                    scope.revisionStateRef.current.invalidate()
                }
                const revision = scope.revisionStateRef.current.snapshot()
                const preview = scope.preparedSaveRef.current
                const before = {...state}
                await action(...args)
                expect(scope.configFileApi.fetchConfigYaml).not.toHaveBeenCalled()
                expect(scope.configFileApi.validateConfigYaml).not.toHaveBeenCalled()
                expect(scope.configFileApi.saveConfigYaml).not.toHaveBeenCalled()
                expect(scope.logsApi.fetchLogSize).not.toHaveBeenCalled()
                expect(scope.usageApi.getDBSize).not.toHaveBeenCalled()
                expect(scope.artifactsApi.fetchImageArtifactCacheSize).not.toHaveBeenCalled()
                expect(setVisualValues).not.toHaveBeenCalled()
                expect(setActiveTab).not.toHaveBeenCalled()
                expect(showConfirmation).not.toHaveBeenCalled()
                expect(scope.showNotification).not.toHaveBeenCalled()
                expect(scope.loadVisualValuesFromYaml).not.toHaveBeenCalled()
                expect(scope.preparedSaveRef.current).toBe(preview)
                expect(scope.revisionStateRef.current.snapshot()).toEqual(revision)
                expect(state).toEqual(before)
            })
        }
    }

    test('an old reload confirmation never discards a replacement draft', () => {
        const {scope, state, switchConnection} = editorScope()
        const showConfirmation = mock((dialog: {onConfirm: () => void}) => dialog)
        const actionScope = {
            ...scope, isDirty: true, showConfirmation,
            loadConfig: sourceCallback<(discard?: boolean) => Promise<void>>(PAGE, 'loadConfig', scope),
            loadRuntimeInfo: sourceCallback<() => Promise<void>>(PAGE, 'loadRuntimeInfo', scope),
        }
        sourceCallback<() => void>(PAGE, 'handleReload', actionScope)()
        expect(showConfirmation).toHaveBeenCalledTimes(1)
        const dialog = showConfirmation.mock.calls[0]![0]
        switchConnection()
        switchConnection()
        const revisions = new ConfigEditorRevisionState(() => scope.apiClient.getAuthGeneration())
        revisions.acceptServerRevision()
        revisions.resetSource('debug: false\n')
        revisions.markDraftChanged()
        scope.revisionStateRef.current = revisions
        const before = {...state}
        dialog.onConfirm()
        expect(scope.configFileApi.fetchConfigYaml).not.toHaveBeenCalled()
        expect(scope.logsApi.fetchLogSize).not.toHaveBeenCalled()
        expect(state).toEqual(before)
    })
})

describe('config queued-effect ownership', () => {
    test('subscribes to generation even when connection fields return to their previous values', () => {
        const {scope, switchConnection} = editorScope()
        const useAuthStore = mock((selector: (state: object) => number) => selector({}))
        expect(sourceInitializer<number>(PAGE, 'authGeneration', {...scope, useAuthStore})).toBe(1)
        switchConnection()
        switchConnection()
        expect(useAuthStore.mock.calls[0]![0]({})).toBe(3)
        expect(scope.isCurrentConnection()).toBe(false)
    })

    test('mount cleanup invalidates callbacks and setup restores the mounted flag', () => {
        const {scope} = editorScope()
        const effect = sourceCallback<() => () => void>(PAGE, 'useEffect', scope, 'mountedRef.current = true')
        const cleanup = effect()
        expect(scope.isCurrentConnection()).toBe(true)
        cleanup()
        expect(scope.isCurrentConnection()).toBe(false)
        effect()
        expect(scope.isCurrentConnection()).toBe(true)
    })

    for (const kind of ['parse-error', 'field-tab', 'field-navigation'] as const) {
        for (const cause of ['connection', 'unmount', 'current'] as const) {
            test(`${kind} queue consumes only the ${cause} owner`, () => {
                const {scope, switchConnection} = editorScope()
                const queued: Array<() => void> = []
                const setActiveTab = mock(() => {})
                const handleTabChange = mock(() => {})
                const setFieldJumpRequest = mock(() => {})
                const navigate = mock(() => {})
                const localStorage = {setItem: mock(() => {})}
                const pendingFieldRequestRef = {current: ''}
                const effectScope = {
                    ...scope, activeTab: kind === 'field-tab' ? 'source' : 'visual',
                    visualParseError: kind === 'parse-error' ? 'fixture parse error' : null,
                    requestedField: {fieldId: 'debug'}, loading: false, saving: false,
                    location: {key: 'fixture', pathname: '/config', search: '?field=debug', hash: ''},
                    pendingFieldRequestRef, handledFieldRequestRef: {current: ''},
                    setActiveTab, handleTabChange, setFieldJumpRequest, navigate, localStorage,
                    queueMicrotask: (callback: () => void) => queued.push(callback),
                }
                const token = kind === 'parse-error' ? 'message: visualParseError' : 'const requestKey'
                sourceCallback<() => void>(PAGE, 'useEffect', effectScope, token)()
                expect(queued).toHaveLength(1)
                if (cause === 'connection') {
                    switchConnection()
                    switchConnection()
                    pendingFieldRequestRef.current = 'replacement'
                } else if (cause === 'unmount') {
                    scope.mountedRef.current = false
                }
                queued.forEach((callback) => callback())
                if (cause === 'current') {
                    if (kind === 'parse-error') {
                        expect(setActiveTab).toHaveBeenCalledWith('source')
                        expect(localStorage.setItem).toHaveBeenCalledWith('config-management:tab', 'source')
                        expect(scope.showNotification).toHaveBeenCalledTimes(1)
                    } else if (kind === 'field-tab') {
                        expect(handleTabChange).toHaveBeenCalledWith('visual')
                        expect(pendingFieldRequestRef.current).toBe('')
                    } else {
                        expect(setFieldJumpRequest).toHaveBeenCalledTimes(1)
                        expect(scope.allowNextNavigation).toHaveBeenCalledTimes(1)
                        expect(navigate).toHaveBeenCalledWith({pathname: '/config', search: '', hash: ''}, {replace: true})
                    }
                } else {
                    expect(setActiveTab).not.toHaveBeenCalled()
                    expect(handleTabChange).not.toHaveBeenCalled()
                    expect(setFieldJumpRequest).not.toHaveBeenCalled()
                    expect(navigate).not.toHaveBeenCalled()
                    expect(scope.allowNextNavigation).not.toHaveBeenCalled()
                    expect(scope.showNotification).not.toHaveBeenCalled()
                    expect(localStorage.setItem).not.toHaveBeenCalled()
                    if (cause === 'connection') {
                        expect(pendingFieldRequestRef.current).toBe('replacement')
                    }
                }
            })
        }
    }
})

describe('config committed-write recovery', () => {
    test('uses the readback as the new baseline after a committed runtime-sync error', async () => {
        const {scope, state} = editorScope()
        scope.configFileApi.saveConfigYaml.mockRejectedValue(Object.assign(new Error('runtime_sync_failed'), {
            status: 503, data: {error: 'runtime_sync_failed', generation: 2},
        }))
        scope.configFileApi.fetchConfigYaml.mockResolvedValue({content: 'debug: true\n', etag: 'committed'})
        await confirm(scope)()
        expect(scope.configFileApi.fetchConfigYaml).toHaveBeenCalledTimes(1)
        expect(state.content).toBe('debug: true\n')
        expect(state.dirty).toBe(false)
        expect(scope.isDirtyRef.current).toBe(false)
        expect(scope.applyVisualChangesToYaml('debug: true\nproxy-url: later\n')).toBe('debug: true\nproxy-url: later\n')
        expect(scope.showNotification).not.toHaveBeenCalledWith('config_management.save_success', 'success')
        expect(scope.showNotification).toHaveBeenCalledWith('config_management.save_committed_runtime_failed', 'error')
    })

    test('does not replay already-committed payload or ICE deletions on the next visual edit', async () => {
        const baseline = 'debug: false\npayload:\n  default:\n    - models: [{name: first}]\n      params: {temperature: 0}\n    - models: [{name: second}]\n      params: {temperature: 1}\ncodex:\n  live-media-relay:\n    ice-servers:\n      - urls: ["stun:first.example.org"]\n      - urls: ["stun:second.example.org"]\n'
        const draft = 'debug: false\npayload:\n  default:\n    - models: [{name: second}]\n      params: {temperature: 1}\ncodex:\n  live-media-relay:\n    ice-servers:\n      - urls: ["stun:second.example.org"]\n'
        const {scope} = editorScope(baseline, draft)
        scope.configFileApi.saveConfigYaml.mockRejectedValue(Object.assign(new Error('runtime_sync_failed'), {
            status: 503, data: {error: 'runtime_sync_failed', generation: 2},
        }))
        scope.configFileApi.fetchConfigYaml.mockResolvedValue({content: draft, etag: 'committed'})
        await confirm(scope)()
        const result = scope.applyVisualChangesToYaml(draft + 'proxy-url: later\n')
        expect(parse(result)).toEqual({...parse(draft), 'proxy-url': 'later'})
        expect(scope.revisionStateRef.current.sourceDirty).toBe(false)
    })

    test('preserves a rejected 422 draft and its preview', async () => {
        const {scope, state} = editorScope()
        scope.configFileApi.saveConfigYaml.mockRejectedValue(Object.assign(new Error('invalid config'), {status: 422}))
        await confirm(scope)()
        expect(state.content).toBe('debug: true\n')
        expect(state.dirty).toBe(true)
        expect(scope.isDirtyRef.current).toBe(true)
        expect(scope.loadVisualValuesFromYaml).not.toHaveBeenCalled()
        expect(scope.preparedSaveRef.current).not.toBeNull()
    })

    test('preserves an uncertain draft even when the server can be read again', async () => {
        const {scope, state} = editorScope()
        scope.configFileApi.saveConfigYaml.mockRejectedValue(new Error('response lost'))
        scope.configFileApi.fetchConfigYaml.mockResolvedValue({content: 'debug: true\n', etag: 'changed'})
        await confirm(scope)()
        expect(state.content).toBe('debug: true\n')
        expect(state.dirty).toBe(true)
        expect(state.diffOriginalYaml).toBe('debug: true\n')
        expect(state.saveNeedsReload).toBe(true)
        expect(scope.preparedSaveRef.current).toBeNull()
        expect(scope.loadVisualValuesFromYaml).not.toHaveBeenCalled()
        expect(scope.showNotification).not.toHaveBeenCalledWith('config_management.save_success', 'success')
    })

    for (const mode of ['source', 'visual'] as const) {
        test(`preserves the attempted ${mode} draft until the uncertain result is explicitly reloaded`, async () => {
            const {scope, state} = editorScope()
            scope.activeTab = mode
            scope.preparedSaveRef.current!.origin = mode
            scope.revisionStateRef.current.editSource('debug: true\n')
            scope.configFileApi.saveConfigYaml.mockRejectedValue(new Error('response lost'))
            scope.configFileApi.fetchConfigYaml.mockResolvedValue({content: 'debug: true\n', etag: 'changed'})
            await confirm(scope)()
            expect(state.saveNeedsReload).toBe(true)
            const revision = scope.revisionStateRef.current.snapshot()
            const setVisualValues = mock(() => {})
            const changeScope = {...scope, setVisualValues,
                markDraftChanged: sourceCallback<() => void>(PAGE, 'markDraftChanged', scope)}
            if (mode === 'source') {
                sourceCallback<(value: string) => void>(PAGE, 'handleChange', changeScope)('debug: false\n')
            } else {
                sourceCallback<(values: {debug: boolean}) => void>(PAGE, 'handleVisualChange', changeScope)({debug: false})
            }
            expect(state.content).toBe('debug: true\n')
            expect(state.dirty).toBe(true)
            expect(setVisualValues).not.toHaveBeenCalled()
            expect(scope.revisionStateRef.current.snapshot()).toEqual(revision)
            const isDirty = sourceInitializer<boolean>(PAGE, 'isDirty', {dirty: state.dirty, visualDirty: false})
            expect(isDirty).toBe(true)
            const showConfirmation = mock((dialog: {onConfirm: () => void}) => dialog)
            const loadConfig = mock(sourceCallback<(discard?: boolean) => Promise<void>>(PAGE, 'loadConfig', scope))
            sourceCallback<() => void>(PAGE, 'handleReload', {...scope, isDirty, showConfirmation,
                loadConfig, loadRuntimeInfo: mock(async () => {})})()
            expect(loadConfig).not.toHaveBeenCalled()
            expect(showConfirmation).toHaveBeenCalledTimes(1)
            const dialog = showConfirmation.mock.calls[0]?.[0] as {onConfirm: () => void}
            dialog.onConfirm()
            expect(loadConfig).toHaveBeenCalledWith(true)
            await loadConfig.mock.results[0]?.value
            expect(state.saveNeedsReload).toBe(false)
            expect(state.dirty).toBe(false)
            expect(state.content).toBe('debug: true\n')
        })
    }

    test('connects uncertain-save state to both editors and CodeMirror read-only behavior', () => {
        const page = readFileSync(new URL('../src/pages/ConfigPage.tsx', import.meta.url), 'utf8')
        const visual = page.slice(page.indexOf('<VisualConfigEditor'), page.indexOf('/>', page.indexOf('<VisualConfigEditor')))
        const source = page.slice(page.indexOf('<CodeMirror'), page.indexOf('/>', page.indexOf('<CodeMirror')))
        expect(visual).toMatch(/disabled=\{[^}]*saveNeedsReload[^}]*\}/)
        expect(source).toMatch(/editable=\{[^}]*!saveNeedsReload[^}]*\}/)
        expect(source).toContain('readOnly={saveNeedsReload}')
    })

    test('requires a successful explicit reload to leave uncertain-save state', async () => {
        const {scope, state} = editorScope()
        scope.configFileApi.saveConfigYaml.mockRejectedValue(new Error('response lost'))
        scope.configFileApi.fetchConfigYaml.mockRejectedValue(new Error('readback unavailable'))
        await confirm(scope)()
        expect(state.saveNeedsReload).toBe(true)
        const reload = sourceCallback<(discard: boolean) => Promise<void>>(PAGE, 'loadConfig', scope)
        await reload(true)
        expect(state.saveNeedsReload).toBe(true)
        expect(state.dirty).toBe(true)
        scope.configFileApi.fetchConfigYaml.mockResolvedValue({content: 'debug: true\n', etag: 'latest'})
        await reload(true)
        expect(state.saveNeedsReload).toBe(false)
        expect(state.dirty).toBe(false)
        expect(state.content).toBe('debug: true\n')
        expect(scope.revisionStateRef.current.snapshot().draftBaseRevision)
            .toBe(scope.revisionStateRef.current.snapshot().serverRevision)
    })

    test('does not publish committed recovery or start a cache refresh after a connection change', async () => {
        const {scope, switchConnection} = editorScope()
        const readback = deferred<{content: string; etag: string}>()
        scope.configFileApi.saveConfigYaml.mockRejectedValue(Object.assign(new Error('runtime_sync_failed'), {
            status: 503, data: {error: 'runtime_sync_failed', generation: 2},
        }))
        scope.configFileApi.fetchConfigYaml.mockImplementation(() => readback.promise)
        const pending = confirm(scope)()
        await Promise.resolve()
        await Promise.resolve()
        expect(scope.configFileApi.fetchConfigYaml).toHaveBeenCalledTimes(1)
        switchConnection()
        readback.resolve({content: 'debug: true\n', etag: 'old-connection'})
        await pending
        expect(scope.loadVisualValuesFromYaml).not.toHaveBeenCalled()
        expect(scope.clearConfigCache).not.toHaveBeenCalled()
        expect(scope.fetchConfig).not.toHaveBeenCalled()
        expect(scope.showNotification).not.toHaveBeenCalled()
    })

    test('has save-recovery messages in every shipped locale', () => {
        for (const language of ['en', 'ru', 'zh-CN', 'zh-TW']) {
            const content = JSON.parse(readFileSync(new URL(`../src/i18n/locales/${language}.json`, import.meta.url), 'utf8'))
            expect(content.config_management.save_committed_runtime_failed).toBeTruthy()
            expect(content.config_management.save_result_uncertain).toBeTruthy()
        }
    })

    test('preserves the draft but prevents another PUT after uncertain save and failed readback', async () => {
        const {scope, state} = editorScope()
        scope.configFileApi.saveConfigYaml.mockRejectedValue(new Error('response lost'))
        scope.configFileApi.fetchConfigYaml.mockRejectedValue(new Error('readback unavailable'))
        await confirm(scope)()
        expect(state.content).toBe('debug: true\n')
        expect(state.dirty).toBe(true)
        expect(state.saveNeedsReload).toBe(true)
        expect(scope.preparedSaveRef.current).toBeNull()
        scope.configFileApi.fetchConfigYaml.mockClear()
        await prepare(scope)()
        expect(scope.configFileApi.fetchConfigYaml).not.toHaveBeenCalled()
        expect(scope.configFileApi.saveConfigYaml).toHaveBeenCalledTimes(1)
        await confirm(scope)()
        expect(scope.configFileApi.saveConfigYaml).toHaveBeenCalledTimes(1)
    })
})
