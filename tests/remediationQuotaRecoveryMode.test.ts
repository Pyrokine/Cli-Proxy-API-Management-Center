import {apiClient} from '@/services/api/client'
import {quotaApi, type QuotaRefreshTask} from '@/services/api/quota'
import {afterEach, beforeEach, expect, mock, spyOn, test} from 'bun:test'
import {sourceCallback} from './sourceCallbacks'

const file                   = 'components/credentials/hooks/useBackendQuotaRegistration.ts'
const key                    = 'claude::synthetic-banned.json'
const task: QuotaRefreshTask = {
    id: 'synthetic-recovery-task', status: 'succeeded', created_at: '2026-11-09T00:00:00Z',
    summary: {
        total: 1,
        queued: 0,
        running: 0,
        succeeded: 1,
        failed: 0,
        skipped: 0,
        cancelled: 0,
        inconclusive: 0,
        interrupted: 0,
    },
    targets: [{ id: key, entry_key: key, status: 'succeeded' }],
}
let post: ReturnType<typeof spyOn<typeof apiClient, 'post'>>
beforeEach(() => {
    post = spyOn(apiClient, 'post').mockResolvedValue(task)
})
afterEach(() => post.mockRestore())

function actions() {
    const refreshMany = sourceCallback<(names: string[], allowRecovery?: boolean) => Promise<void>>(
        file,
        'refreshMany',
        {
            apiClient,
            quotaApi,
            captureQuotaRequestClaim: () => ({ connectionGeneration: apiClient.getAuthGeneration() }),
            areQuotaSubjectsCurrent: () => true,
            mounted: { current: true },
            metaRef: { current: {} },
            quotaEnabled: false,
            refreshControllersRef: { current: new Set<AbortController>() },
            setMeta: mock(),
            refreshMetaKeysForIdentifiers: () => [key],
            refreshMetaKeysForTask: () => [key],
            markQuotaMetaLoading: (value: unknown) => value,
            applyQuotaRefreshTaskToMeta: (value: unknown) => value,
            waitForQuotaRefreshTask: async (value: QuotaRefreshTask) => value,
            pollLatest: mock(async () => {
            }),
            i18n: { t: (value: string) => value },
            useNotificationStore: {
                getState: () => ({
                    addPersistentNotification: mock(),
                    showNotification: mock(),
                }),
            },
        },
    )
    const refreshNow  = sourceCallback<(name: string) => Promise<void>>(file, 'refreshNow', { refreshMany })
    return { refreshMany, refreshNow }
}

for (const allowRecovery of [undefined, false, true]) {
    test(`quota API preserves recovery mode ${String(allowRecovery)}, signal and mutation readback`, async () => {
        const controller = new AbortController()
        await quotaApi.refresh(
            [key],
            { signal: controller.signal, ...(allowRecovery === undefined ? {} : { allowRecovery }) },
        )
        expect(post).toHaveBeenCalledTimes(1)
        const [url, body, config] = post.mock.calls[0]
        expect(url).toBe('/quota/refresh')
        expect(body).toEqual({
                                 credentials: [key], ...(allowRecovery === undefined ?
                {} :
                { allow_recovery: allowRecovery }),
                             })
        expect(config?.signal).toBe(controller.signal)
        expect(config?.mutationReadback).toBeFunction()
    })
}

test('single-card refresh explicitly requests one recovery verification', async () => {
    await actions().refreshNow(key)
    expect(post).toHaveBeenCalledTimes(1)
    expect(post.mock.calls[0][1]).toEqual({ credentials: [key], allow_recovery: true })
})

for (const names of [[key], [key, 'codex::synthetic-exhausted.json'], [key, ` ${key} `]]) {
    test(`ordinary selected bulk stays protected after deduplication: ${names.length} identifiers`, async () => {
        await actions().refreshMany(names)
        expect(post).toHaveBeenCalledTimes(1)
        expect(post.mock.calls[0][1]).toEqual({
                                                  credentials: [...new Set(names.map((name) => name.trim()))],
                                                  allow_recovery: false,
                                              })
    })
}

for (const names of [[key], [key, 'codex::synthetic-exhausted.json']]) {
    test(`CredentialsPage selected bulk reaches protected quota API: ${names.length} targets`, async () => {
        const handleBatchRefresh = sourceCallback<() => Promise<void>>(
            'pages/CredentialsPage.tsx',
            'handleBatchRefresh',
            {
                selectedVisibleCount: names.length,
                selectedVisibleKeys: new Set(names),
                authFiles: [],
                authFileRefreshIdentifiers: () => ({
                    identifiers: names,
                    skippedDisabled: 0,
                    skippedUnsupported: 0,
                    skippedAmbiguous: 0,
                }),
                apiClient,
                quotaScheduler: actions(),
                setBatchGeneration: mock(),
                refresh: mock(async () => {
                }),
                markRefreshed: mock(),
                showNotification: mock(),
                t: (value: string) => value,
            },
        )
        await handleBatchRefresh()
        expect(post).toHaveBeenCalledTimes(1)
        expect(post.mock.calls[0][1]).toEqual({ credentials: names, allow_recovery: false })
    })
}

test('empty selection does not create a quota refresh task', async () => {
    await actions().refreshMany(['', ' '])
    expect(post).not.toHaveBeenCalled()
})

test('legacy no-argument quota request keeps its original body', async () => {
    await quotaApi.refresh()
    expect(post).toHaveBeenCalledTimes(1)
    expect(post.mock.calls[0][1]).toEqual({})
})
