import {describe, expect, mock, spyOn, test} from 'bun:test'
import {apiClient} from '@/services/api/client'
import {sourceCallback, sourceInitializer} from './sourceCallbacks'

const vendorFile = 'components/credentials/hooks/useVendorActions.ts'
const pageFile = 'pages/CredentialsPage.tsx'
const fixture = {name: 'fixture.json', authIndex: 'fixture-auth'}
const success = {files: [fixture.name], deleted: 1, failed: [], downloaded: [fixture.name]}
type Confirmation = {onConfirm: () => Promise<void>}
type BatchSetter = number | null | ((previous: number | null) => number | null)

function context() {
    const generation = spyOn(apiClient, 'getAuthGeneration').mockReturnValue(1)
    const confirmation = {current: null as Confirmation | null}
    const batch = {current: null as number | null}
    const scope = {
        apiClient, batchBusy: false, selectedVisibleCount: 1, authFiles: [fixture],
        selectedVisibleAuthFiles: [fixture], selectedVisibleKeys: new Set(['fixture-key']),
        selectedPhysicalFileNames: () => [fixture.name],
        authFileRefreshIdentifiers: () => ({identifiers: ['fixture-key'], skippedDisabled: 0,
            skippedUnsupported: 0, skippedAmbiguous: 0}),
        t: (key: string) => key,
        showConfirmation: (value: Confirmation) => {confirmation.current = value},
        showNotification: mock(() => {}), completeMutation: mock(async () => {}),
        refresh: mock(async () => {}), onRefresh: mock(async () => {}),
        refreshCredentialInsights: mock(async () => {}), markRefreshed: mock(() => {}),
        setSelectedItems: mock(() => {}),
        setBatchGeneration: (value: BatchSetter) => {
            batch.current = typeof value === 'function' ? value(batch.current) : value
        },
        setBatchBusy: (value: boolean) => {batch.current = value ? 1 : null},
    }
    const confirm = () => {
        if (!confirmation.current) {
            throw new Error('missing credential confirmation')
        }
        return confirmation.current.onConfirm()
    }
    return {scope, generation, batch, confirm, restore: () => generation.mockRestore()}
}

const confirmedActions = ['deleteAuthFile', 'deleteApiKey', 'handleBatchDelete'] as const
const mutations = ['uploadAuthFile', ...confirmedActions] as const

function invoke(
    action: typeof mutations[number],
    scope: Record<string, unknown>,
    confirm: () => Promise<void>,
): Promise<void> {
    if (action === 'uploadAuthFile') {
        return sourceCallback<(file: File) => Promise<void>>(vendorFile, action, scope)(
            new File(['{}'], fixture.name, {type: 'application/json'}),
        )
    }
    if (action === 'handleBatchDelete') {
        sourceCallback<() => void>(pageFile, action, scope)()
    } else {
        sourceCallback<(name: string) => void>(vendorFile, action, scope)(fixture.name)
    }
    return confirm()
}

function mutationScope(action: typeof mutations[number], request: () => Promise<unknown>) {
    return {
        authFilesApi: {upload: request, deleteFile: request, deleteFiles: request},
        withAuthFileUploadLock: async (work: () => Promise<unknown>) => ({started: true, value: await work()}),
        API_KEY_DELETERS: {codex: request}, DELETE_CONFIRM_KEYS: {}, vendorId: 'codex',
        action,
    }
}

describe('credential mutation connection ownership', () => {
    for (const action of confirmedActions) {
        test(`${action} rejects a confirmation retained across A-B-A connections`, async () => {
            const current = context()
            const request = mock(async () => success)
            const scope = {...current.scope, ...mutationScope(action, request)}
            try {
                if (action === 'handleBatchDelete') {
                    sourceCallback<() => void>(pageFile, action, scope)()
                } else {
                    sourceCallback<(name: string) => void>(vendorFile, action, scope)(fixture.name)
                }
                current.generation.mockReturnValue(3)
                await expect(current.confirm()).rejects.toThrow('common.connection_changed')
                expect(request).not.toHaveBeenCalled()
                expect(current.scope.completeMutation).not.toHaveBeenCalled()
                expect(current.scope.showNotification).not.toHaveBeenCalled()
            } finally {
                current.restore()
            }
        })
    }

    for (const action of mutations) {
        for (const outcome of ['success', 'failure'] as const) {
            test(`${action} does not publish an old ${outcome} into a new connection`, async () => {
                const current = context()
                const response = Promise.withResolvers<unknown>()
                const request = mock(() => response.promise)
                try {
                    const pending = invoke(action, {...current.scope, ...mutationScope(action, request)}, current.confirm)
                    const settled = pending.catch(() => {})
                    expect(request).toHaveBeenCalledTimes(1)
                    current.generation.mockReturnValue(3)
                    current.batch.current = 3
                    if (outcome === 'success') {
                        response.resolve(success)
                    } else {
                        response.reject(new Error('synthetic old credential failure'))
                    }
                    await settled
                    expect(current.scope.completeMutation).not.toHaveBeenCalled()
                    expect(current.scope.showNotification).not.toHaveBeenCalled()
                    expect(current.scope.onRefresh).not.toHaveBeenCalled()
                    expect(current.scope.setSelectedItems).not.toHaveBeenCalled()
                    expect(current.scope.markRefreshed).not.toHaveBeenCalled()
                    expect(current.batch.current).toBe(3)
                } finally {
                    response.resolve(success)
                    current.restore()
                }
            })
        }
    }

    for (const action of mutations) {
        test(`${action} still publishes a successful current mutation`, async () => {
            const current = context()
            const request = mock(async () => success)
            try {
                await invoke(action, {...current.scope, ...mutationScope(action, request)}, current.confirm)
                expect(request).toHaveBeenCalledTimes(1)
                expect(current.scope.showNotification).toHaveBeenCalledWith(expect.any(String), 'success')
                if (action === 'deleteApiKey') {
                    expect(current.scope.onRefresh).toHaveBeenCalledTimes(1)
                } else {
                    expect(current.scope.completeMutation).toHaveBeenCalledWith({
                        kind: action === 'uploadAuthFile' ? 'upload' : 'delete', names: [fixture.name],
                    })
                }
                expect(current.batch.current).toBeNull()
            } finally {
                current.restore()
            }
        })
    }

    for (const action of mutations) {
        test(`${action} does not announce success after its reload changes connections`, async () => {
            const current = context()
            const request = mock(async () => success)
            const changeConnection = mock(async () => current.generation.mockReturnValue(3))
            try {
                await invoke(action, {...current.scope, ...mutationScope(action, request),
                    completeMutation: changeConnection, onRefresh: changeConnection}, current.confirm)
                expect(changeConnection).toHaveBeenCalledTimes(1)
                expect(current.scope.showNotification).not.toHaveBeenCalled()
                expect(current.scope.markRefreshed).not.toHaveBeenCalled()
            } finally {
                current.restore()
            }
        })
    }

    for (const action of ['handleBatchDownload', 'handleBatchRefresh'] as const) {
        for (const outcome of ['success', 'failure'] as const) {
            test(`${action} keeps new connection state after an old ${outcome}`, async () => {
                const current = context()
                const response = Promise.withResolvers<unknown>()
                const request = mock(() => response.promise)
                const scope = {...current.scope, downloadAuthFilesBatch: request,
                    authFilesApi: {download: mock()}, quotaScheduler: {refreshMany: request}}
                try {
                    const pending = sourceCallback<() => Promise<void>>(pageFile, action, scope)()
                    const settled = pending.catch(() => {})
                    current.generation.mockReturnValue(3)
                    current.batch.current = 3
                    if (outcome === 'success') {
                        response.resolve(success)
                    } else {
                        response.reject(new Error('synthetic old batch failure'))
                    }
                    await settled
                    expect(request).toHaveBeenCalledTimes(1)
                    expect(current.scope.refresh).not.toHaveBeenCalled()
                    expect(current.scope.markRefreshed).not.toHaveBeenCalled()
                    expect(current.scope.showNotification).not.toHaveBeenCalled()
                    expect(current.batch.current).toBe(3)
                } finally {
                    response.resolve(success)
                    current.restore()
                }
            })
        }
    }

    test('batch pending state belongs to its connection generation', () => {
        const current = context()
        try {
            for (const [active, pending, expected] of [[1, 1, true], [3, 1, false], [3, 3, true], [3, null, false]] as const) {
                current.generation.mockReturnValue(active)
                expect(sourceInitializer<boolean>(pageFile, 'batchBusy', {
                    apiClient, batchGeneration: pending,
                })).toBe(expected)
            }
        } finally {
            current.restore()
        }
    })

    test('credential reload does not mark a new connection as refreshed', async () => {
        const current = context()
        const response = Promise.withResolvers<void>()
        try {
            const pending = sourceCallback<(names: string[]) => Promise<void>>(pageFile, 'handleCredentialsChanged', {
                ...current.scope, completeMutation: () => response.promise,
            })([fixture.name])
            current.generation.mockReturnValue(3)
            response.resolve()
            await pending
            expect(current.scope.markRefreshed).not.toHaveBeenCalled()
        } finally {
            response.resolve()
            current.restore()
        }
    })

    test('unmount cancels the queued initial credentials load before it starts', () => {
        const queued: Array<() => void> = []
        const loadAll = mock(async () => {})
        const tracker = {invalidate: mock()}
        const cleanup = sourceCallback<() => () => void>('components/credentials/hooks/useCredentialsData.ts', 'useEffect', {
            loadAll, requestTrackerRef: {current: tracker}, queueMicrotask: (work: () => void) => queued.push(work),
        }, 'queueMicrotask')()
        cleanup()
        queued.forEach((work) => work())
        expect(tracker.invalidate).toHaveBeenCalledTimes(1)
        expect(loadAll).not.toHaveBeenCalled()
    })
})
