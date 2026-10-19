import {afterEach, describe, expect, mock, spyOn, test} from 'bun:test'
import {readFileSync} from 'node:fs'
import {authFilesApi} from '@/services/api/authFiles'
import {apiClient} from '@/services/api/client'
import {authFileStatusRequestKey, useAuthFileStatusStore} from '@/stores/useAuthFileStatusStore'
import {sourceCallback, sourceInitializer} from './sourceCallbacks'

type StatusResponse = {status: string; disabled: boolean}

function deferred<T>() {
    let resolve!: (value: T) => void
    let reject!: (reason: unknown) => void
    const promise = new Promise<T>((accept, decline) => {resolve = accept; reject = decline})
    return {promise, resolve, reject}
}

afterEach(() => useAuthFileStatusStore.setState({requests: new Map()}))

describe('credential status request identity', () => {
    test('shares pending ownership and rejects overlap for the same connection and credential', async () => {
        const generation = spyOn(apiClient, 'getAuthGeneration').mockReturnValue(1)
        const response = deferred<StatusResponse>()
        const request = spyOn(apiClient, 'patch').mockImplementationOnce(<T>() => response.promise as Promise<T>)
            .mockResolvedValue({status: 'ok', disabled: true})
        const pending = authFilesApi.setStatus('shared.json', true, 'a')
        try {
            expect(useAuthFileStatusStore.getState().requests.has(authFileStatusRequestKey(1, 'shared.json', 'a'))).toBe(true)
            await expect(authFilesApi.setStatus(' shared.json ', false, ' a ')).rejects.toThrow()
            expect(request).toHaveBeenCalledTimes(1)
        } finally {
            response.resolve({status: 'ok', disabled: true})
            await pending
            request.mockRestore()
            generation.mockRestore()
        }
        expect(useAuthFileStatusStore.getState().requests.size).toBe(0)
    })

    test('separates runtime identities and old generations without clearing a newer request', async () => {
        const generation = spyOn(apiClient, 'getAuthGeneration').mockReturnValue(1)
        const old = deferred<StatusResponse>()
        const newer = deferred<StatusResponse>()
        const request = spyOn(apiClient, 'patch').mockImplementationOnce(<T>() => old.promise as Promise<T>)
            .mockImplementationOnce(<T>() => newer.promise as Promise<T>).mockResolvedValue({status: 'ok', disabled: true})
        const first = authFilesApi.setStatus('shared.json', true, 'a')
        generation.mockReturnValue(3)
        const second = authFilesApi.setStatus('shared.json', true, 'a')
        try {
            await authFilesApi.setStatus('shared.json', true, 'b')
            expect(request).toHaveBeenCalledTimes(3)
            expect(useAuthFileStatusStore.getState().requests.size).toBe(2)
            old.resolve({status: 'ok', disabled: true})
            await first
            expect(useAuthFileStatusStore.getState().requests.has(authFileStatusRequestKey(3, 'shared.json', 'a'))).toBe(true)
            expect(useAuthFileStatusStore.getState().requests.size).toBe(1)
        } finally {
            old.resolve({status: 'ok', disabled: true})
            newer.resolve({status: 'ok', disabled: true})
            await Promise.all([first, second])
            request.mockRestore()
            generation.mockRestore()
        }
        expect(useAuthFileStatusStore.getState().requests.size).toBe(0)
    })

    test('cleans failed requests and rejects responses that did not apply the requested status', async () => {
        const generation = spyOn(apiClient, 'getAuthGeneration').mockReturnValue(1)
        const request = spyOn(apiClient, 'patch').mockRejectedValueOnce(new Error('timeout'))
            .mockResolvedValueOnce({status: 'ok', disabled: false})
            .mockResolvedValueOnce({status: 'error', disabled: true})
        try {
            await expect(authFilesApi.setStatus('shared.json', true, 'a')).rejects.toThrow('timeout')
            expect(useAuthFileStatusStore.getState().requests.size).toBe(0)
            await expect(authFilesApi.setStatus('shared.json', true, 'a')).rejects.toThrow()
            expect(useAuthFileStatusStore.getState().requests.size).toBe(0)
            await expect(authFilesApi.setStatus('shared.json', true, 'a')).rejects.toThrow()
            expect(useAuthFileStatusStore.getState().requests.size).toBe(0)
        } finally {
            request.mockRestore()
            generation.mockRestore()
        }
    })

    for (const mode of ['single', 'batch'] as const) {
        for (const outcome of ['success', 'error'] as const) {
            test(`ignores a late ${mode} status ${outcome} after A-B-A connection changes`, async () => {
                const generation = spyOn(apiClient, 'getAuthGeneration').mockReturnValue(1)
                const response = deferred<StatusResponse>()
                const request = spyOn(apiClient, 'patch').mockImplementation(<T>() => response.promise as Promise<T>)
                const completeMutation = mock(async () => {})
                const showNotification = mock(() => {})
                const markRefreshed = mock(() => {})
                const setBatchBusy = mock(() => {})
                const file = {name: 'shared.json', authIndex: 'a', disabled: true}
                const scope = {authFilesApi, apiClient, useAuthFileStatusStore, completeMutation,
                    showNotification, markRefreshed, setBatchBusy, batchBusy: false,
                    selectedVisibleCount: 1, selectedVisibleAuthFiles: [file], t: (key: string) => key}
                const pending = mode === 'single'
                    ? sourceCallback<(credential: typeof file, disabled: boolean) => Promise<void>>(
                        'components/credentials/hooks/useVendorActions.ts', 'toggleAuthFile', scope)(file, false)
                    : sourceCallback<(disabled: boolean) => Promise<void>>(
                        'pages/CredentialsPage.tsx', 'handleBatchSetDisabled', scope)(false)
                generation.mockReturnValue(3)
                setBatchBusy.mockClear()
                try {
                    if (outcome === 'success') {
                        response.resolve({status: 'ok', disabled: false})
                    } else {
                        response.reject(new Error('old connection failure'))
                    }
                    await pending
                    expect(completeMutation).not.toHaveBeenCalled()
                    expect(showNotification).not.toHaveBeenCalled()
                    expect(markRefreshed).not.toHaveBeenCalled()
                    expect(setBatchBusy).not.toHaveBeenCalled()
                    expect(useAuthFileStatusStore.getState().requests.size).toBe(0)
                } finally {
                    request.mockRestore()
                    generation.mockRestore()
                }
            })
        }
    }

    test('publishes a current single request with its full runtime identity', async () => {
        const generation = spyOn(apiClient, 'getAuthGeneration').mockReturnValue(1)
        const request = spyOn(apiClient, 'patch').mockResolvedValue({status: 'ok', disabled: false})
        const completeMutation = mock(async () => {})
        const showNotification = mock(() => {})
        try {
            await sourceCallback<(file: {name: string; authIndex: string}, disabled: boolean) => Promise<void>>(
                'components/credentials/hooks/useVendorActions.ts', 'toggleAuthFile',
                {authFilesApi, apiClient, completeMutation, showNotification, t: (key: string) => key},
            )({name: 'shared.json', authIndex: 'a'}, false)
            expect(completeMutation).toHaveBeenCalledWith({kind: 'status', names: ['shared.json'], authIndex: 'a', disabled: false})
            expect(showNotification).not.toHaveBeenCalled()
        } finally {
            request.mockRestore()
            generation.mockRestore()
        }
    })

    test('does not publish a single status that the server did not apply', async () => {
        const generation = spyOn(apiClient, 'getAuthGeneration').mockReturnValue(1)
        const request = spyOn(apiClient, 'patch').mockResolvedValue({status: 'ok', disabled: true})
        const completeMutation = mock(async () => {})
        const showNotification = mock(() => {})
        try {
            await sourceCallback<(file: {name: string; authIndex: string}, disabled: boolean) => Promise<void>>(
                'components/credentials/hooks/useVendorActions.ts', 'toggleAuthFile',
                {authFilesApi, apiClient, completeMutation, showNotification, t: (key: string) => key},
            )({name: 'shared.json', authIndex: 'a'}, false)
            expect(completeMutation).not.toHaveBeenCalled()
            expect(showNotification).toHaveBeenCalledTimes(1)
            expect(showNotification).toHaveBeenCalledWith(expect.any(String), 'error')
            expect(useAuthFileStatusStore.getState().requests.size).toBe(0)
        } finally {
            request.mockRestore()
            generation.mockRestore()
        }
    })

    test('rejects another batch while a current credential status request is pending', async () => {
        const generation = spyOn(apiClient, 'getAuthGeneration').mockReturnValue(1)
        const response = deferred<StatusResponse>()
        const request = spyOn(apiClient, 'patch').mockImplementation(<T>() => response.promise as Promise<T>)
        const completeMutation = mock(async () => {})
        const showNotification = mock(() => {})
        const markRefreshed = mock(() => {})
        const pending = authFilesApi.setStatus('first.json', false, 'a')
        try {
            await sourceCallback<(disabled: boolean) => Promise<void>>(
                'pages/CredentialsPage.tsx', 'handleBatchSetDisabled', {
                    authFilesApi, apiClient, useAuthFileStatusStore, completeMutation, showNotification,
                    markRefreshed, batchBusy: false, selectedVisibleCount: 1,
                    selectedVisibleAuthFiles: [{name: 'second.json', authIndex: 'b'}], t: (key: string) => key,
                },
            )(false)
            expect(request).toHaveBeenCalledTimes(1)
            expect(completeMutation).not.toHaveBeenCalled()
            expect(markRefreshed).not.toHaveBeenCalled()
            expect(showNotification).toHaveBeenCalledWith('credentials.status_update_in_progress', 'warning')
            expect(useAuthFileStatusStore.getState().requests.size).toBe(1)
        } finally {
            response.resolve({status: 'ok', disabled: false})
            await pending
            request.mockRestore()
            generation.mockRestore()
        }
    })

    test('reports a current batch partial result with each runtime identity', async () => {
        const generation = spyOn(apiClient, 'getAuthGeneration').mockReturnValue(1)
        const request = spyOn(apiClient, 'patch').mockResolvedValueOnce({status: 'ok', disabled: false})
            .mockResolvedValueOnce({status: 'ok', disabled: true})
        const completeMutation = mock(async () => {})
        const showNotification = mock(() => {})
        const markRefreshed = mock(() => {})
        const t = mock((key: string, values?: unknown) => `${key}:${JSON.stringify(values)}`)
        try {
            await sourceCallback<(disabled: boolean) => Promise<void>>(
                'pages/CredentialsPage.tsx', 'handleBatchSetDisabled', {
                    authFilesApi, apiClient, useAuthFileStatusStore, completeMutation, showNotification,
                    markRefreshed, batchBusy: false, selectedVisibleCount: 2, t,
                    selectedVisibleAuthFiles: [
                        {name: 'shared.json', authIndex: 'a'}, {name: 'shared.json', authIndex: 'b'},
                    ],
                },
            )(false)
            expect(request.mock.calls.map((args) => args[1])).toEqual([
                {name: 'shared.json', disabled: false, auth_index: 'a'},
                {name: 'shared.json', disabled: false, auth_index: 'b'},
            ])
            expect(completeMutation).toHaveBeenCalledWith({kind: 'reload', names: ['shared.json', 'shared.json']})
            expect(markRefreshed).toHaveBeenCalledTimes(1)
            expect(t).toHaveBeenCalledWith('credentials.batch_status_partial', {
                success: 1, total: 2, details: expect.stringContaining('shared.json (b)'),
            })
            expect(showNotification).toHaveBeenCalledWith(expect.stringContaining('credentials.batch_status_partial'), 'warning')
            expect(useAuthFileStatusStore.getState().requests.size).toBe(0)
        } finally {
            request.mockRestore()
            generation.mockRestore()
        }
    })

    test('does not announce an old batch after the connection changes during reload', async () => {
        const generation = spyOn(apiClient, 'getAuthGeneration').mockReturnValue(1)
        const request = spyOn(apiClient, 'patch').mockResolvedValue({status: 'ok', disabled: false})
        const reloadStarted = deferred<void>()
        const reload = deferred<void>()
        const completeMutation = mock(() => {reloadStarted.resolve(); return reload.promise})
        const showNotification = mock(() => {})
        const markRefreshed = mock(() => {})
        const pending = sourceCallback<(disabled: boolean) => Promise<void>>(
            'pages/CredentialsPage.tsx', 'handleBatchSetDisabled', {
                authFilesApi, apiClient, useAuthFileStatusStore, completeMutation, showNotification,
                markRefreshed, batchBusy: false, selectedVisibleCount: 1,
                selectedVisibleAuthFiles: [{name: 'shared.json', authIndex: 'a'}], t: (key: string) => key,
            },
        )(false)
        try {
            await reloadStarted.promise
            generation.mockReturnValue(3)
            reload.resolve()
            await pending
            expect(completeMutation).toHaveBeenCalledTimes(1)
            expect(showNotification).not.toHaveBeenCalled()
            expect(markRefreshed).not.toHaveBeenCalled()
            expect(useAuthFileStatusStore.getState().requests.size).toBe(0)
        } finally {
            reload.resolve()
            request.mockRestore()
            generation.mockRestore()
        }
    })

    test('consumes shared pending state in the target card and the batch toolbar', () => {
        const request = {generation: 1, name: 'shared.json', authIndex: 'a'}
        useAuthFileStatusStore.setState({requests: new Map([[authFileStatusRequestKey(1, request.name, request.authIndex), request]])})
        const select = (selector: (state: ReturnType<typeof useAuthFileStatusStore.getState>) => boolean) => selector(useAuthFileStatusStore.getState())
        for (const [generation, index, pending] of [[1, 'a', true], [1, 'b', false], [3, 'a', false]] as const) {
            expect(sourceInitializer<boolean>('components/credentials/VendorSection.tsx', 'statusChanging', {
                useAuthFileStatusStore: select, authFileStatusRequestKey, authGeneration: generation,
                authIndex: index, file: {name: 'shared.json', authIndex: index},
            })).toBe(pending)
        }
        const card = readFileSync(new URL('../src/components/credentials/VendorSection.tsx', import.meta.url), 'utf8')
        expect(card).toContain('disableControls={disableControls || statusChanging || quotaResetting}')
        const connectionGeneration = spyOn(apiClient, 'getAuthGeneration').mockReturnValue(1)
        try {
            expect(sourceInitializer<boolean>('pages/CredentialsPage.tsx', 'statusChangeBusy', {
                useAuthFileStatusStore: select, apiClient,
            })).toBe(true)
            connectionGeneration.mockReturnValue(3)
            expect(sourceInitializer<boolean>('pages/CredentialsPage.tsx', 'statusChangeBusy', {
                useAuthFileStatusStore: select, apiClient,
            })).toBe(false)
        } finally {
            connectionGeneration.mockRestore()
        }
        const page = readFileSync(new URL('../src/pages/CredentialsPage.tsx', import.meta.url), 'utf8')
        expect(page).toContain('tokenRefreshBusy || statusChangeBusy')
    })
})
