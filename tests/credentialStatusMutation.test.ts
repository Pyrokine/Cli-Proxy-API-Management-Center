import {afterEach, describe, expect, mock, test} from 'bun:test'
import {
    applyAuthFileMutation, authFileMutationNames, authFileMutationQuotaKeys, authFileStatusQuotaKeys,
    type AuthFileMutation,
} from '@/components/credentials/credentialsDataLifecycle'
import {captureQuotaRequestClaim, commitQuotaSnapshot, useQuotaStore} from '@/stores/useQuotaStore'
import type {AuthFileItem} from '@/types/authFile'
import {sourceCallback} from './sourceCallbacks'

const originalQuota = useQuotaStore.getState()
afterEach(() => useQuotaStore.setState(originalQuota, true))

const prepare = () => {
    useQuotaStore.getState().clearQuotaCache()
    const files: AuthFileItem[] = [
        {name: 'shared.json', type: 'devin', authIndex: 'a', disabled: false},
        {name: 'shared.json', type: 'devin', authIndex: 'b', disabled: false},
        {name: 'other.json', type: 'devin', authIndex: 'c', disabled: true},
    ]
    const authFilesRef = {current: files}
    const setAuthFiles = mock()
    const setSummaryCount = mock()
    const loadAll = mock(async () => {})
    const invalidateAuthFileDerivedCaches = mock()
    const completeMutation = sourceCallback<(mutation: AuthFileMutation | AuthFileMutation[]) => Promise<void>>(
        'components/credentials/hooks/useCredentialsData.ts', 'completeMutation', {
            authFilesRef, requestTrackerRef: {current: {invalidate: mock()}}, setAuthFiles, setSummaryCount,
            loadAll, invalidateAuthFileDerivedCaches, authFileMutationNames, authFileMutationQuotaKeys,
            authFileStatusQuotaKeys, applyAuthFileMutation, useQuotaStore, setLoading: mock(), setRefreshing: mock(),
        },
    )
    const keys = files.map((file) => authFileStatusQuotaKeys(files, {
        kind: 'status', names: [file.name], authIndex: file.authIndex, disabled: true,
    })[0])
    for (const [index, key] of keys.entries()) {
        commitQuotaSnapshot(captureQuotaRequestClaim(3), 3, {key, metadata: {
            fileName: files[index].name, type: 'devin', backendGeneration: 4, backendStateRevision: 8,
            status: 'success', freshness: 'fresh', successfulEmpty: true, observedAt: '2026-10-19T01:00:00Z',
        }})
    }
    return {files, keys, authFilesRef, setAuthFiles, setSummaryCount, loadAll, invalidateAuthFileDerivedCaches, completeMutation}
}

const batchAction = (fixture: ReturnType<typeof prepare>, setStatus: (...args: unknown[]) => Promise<unknown>) =>
    sourceCallback<(disabled: boolean) => Promise<void>>('pages/CredentialsPage.tsx', 'handleBatchSetDisabled', {
        selectedVisibleCount: fixture.files.length, selectedVisibleAuthFiles: fixture.files, batchBusy: false,
        apiClient: {getAuthGeneration: () => 3},
        useAuthFileStatusStore: {getState: () => ({requests: new Map()})},
        authFilesApi: {setStatus}, completeMutation: fixture.completeMutation,
        markRefreshed: mock(), showNotification: mock(), t: (key: string) => key,
    })

describe('credential status mutation quota preservation', () => {
    test('batch partial success updates exact identities once and leaves failed same-file siblings untouched', async () => {
        const fixture = prepare()
        const before = useQuotaStore.getState()
        const oldClaim = captureQuotaRequestClaim(3)
        const setStatus = mock(async (...args: unknown[]) => {
            if (args[2] === 'b') {
                throw new Error('fixture rejection')
            }
            return {status: 'ok', disabled: args[2] === 'a'}
        })
        await batchAction(fixture, setStatus)(true)
        expect(setStatus.mock.calls).toEqual([
            ['shared.json', true, 'a'], ['shared.json', true, 'b'], ['other.json', true, 'c'],
        ])
        expect(fixture.authFilesRef.current).toEqual([
            {...fixture.files[0], disabled: true}, fixture.files[1], {...fixture.files[2], disabled: false},
        ])
        expect(fixture.authFilesRef.current[1]).toBe(fixture.files[1])
        expect(fixture.setAuthFiles).toHaveBeenCalledTimes(1)
        expect(fixture.setSummaryCount).toHaveBeenCalledTimes(1)
        expect(fixture.loadAll).toHaveBeenCalledTimes(1)
        expect(fixture.loadAll).toHaveBeenCalledWith({background: true})
        expect(fixture.invalidateAuthFileDerivedCaches.mock.calls).toEqual([
            [['shared.json'], []], [['other.json'], []],
        ])
        const after = useQuotaStore.getState()
        for (const [index, key] of fixture.keys.entries()) {
            expect(after.quotaMetadata[key]).toBe(before.quotaMetadata[key])
            expect(after.subjectVersions[key]).toEqual({
                ...before.subjectVersions[key], localGeneration: before.subjectVersions[key].localGeneration + (index === 1 ? 0 : 1),
            })
            expect(commitQuotaSnapshot(oldClaim, 3, {key, metadata: before.quotaMetadata[key]}))
                .toBe(index === 1 ? 'committed' : 'stale_subject')
        }
    })

    test('single status and batched status share the cache-preserving completion path', async () => {
        const fixture = prepare()
        const before = useQuotaStore.getState()
        await fixture.completeMutation({kind: 'status', names: ['shared.json'], authIndex: 'a', disabled: true})
        expect(fixture.authFilesRef.current[0].disabled).toBe(true)
        expect(fixture.authFilesRef.current[1]).toBe(fixture.files[1])
        expect(useQuotaStore.getState().quotaMetadata[fixture.keys[0]]).toBe(before.quotaMetadata[fixture.keys[0]])
        expect(fixture.invalidateAuthFileDerivedCaches).toHaveBeenCalledWith(['shared.json'], [])
        expect(fixture.loadAll).toHaveBeenCalledTimes(1)
    })

    test('a failed single status response reconciles a write that already reached the server', async () => {
        const fixture = prepare()
        const before = useQuotaStore.getState()
        const showNotification = mock()
        fixture.loadAll.mockImplementation(async () => {
            fixture.authFilesRef.current = fixture.files.map((file, index) => index === 0 ? {...file, disabled: true} : file)
        })
        const toggle = sourceCallback<(file: AuthFileItem, disabled: boolean) => Promise<void>>(
            'components/credentials/hooks/useVendorActions.ts', 'toggleAuthFile', {
                apiClient: {getAuthGeneration: () => 3},
                authFilesApi: {setStatus: mock(async () => {throw new Error('runtime sync failed')})},
                completeMutation: fixture.completeMutation, showNotification, t: (key: string) => key,
            },
        )
        await toggle(fixture.files[0], true)
        expect(showNotification).toHaveBeenCalledWith('runtime sync failed', 'error')
        expect(fixture.loadAll).toHaveBeenCalledTimes(1)
        expect(fixture.authFilesRef.current[0].disabled).toBe(true)
        expect(useQuotaStore.getState()).toBe(before)
        expect(fixture.invalidateAuthFileDerivedCaches).not.toHaveBeenCalled()
    })

    test('an entirely failed status batch preserves quota and reconciles uncertain server state once', async () => {
        const fixture = prepare()
        const before = useQuotaStore.getState()
        await batchAction(fixture, mock(async () => {throw new Error('fixture rejection')}))(true)
        expect(fixture.authFilesRef.current).toBe(fixture.files)
        expect(useQuotaStore.getState()).toBe(before)
        expect(fixture.loadAll).toHaveBeenCalledTimes(1)
        expect(fixture.loadAll).toHaveBeenCalledWith({background: true})
        expect(fixture.setAuthFiles).not.toHaveBeenCalled()
        expect(fixture.invalidateAuthFileDerivedCaches).not.toHaveBeenCalled()
    })
})
