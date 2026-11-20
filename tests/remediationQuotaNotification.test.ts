import {
    QuotaRefreshTaskWaitTimeoutError,
    waitForQuotaRefreshTask,
} from '@/components/credentials/hooks/quotaRefreshTask'
import i18n from '@/i18n'
import type {QuotaRefreshTargetStatus, QuotaRefreshTask} from '@/services/api/quota'
import {type PersistentNotification, useNotificationStore} from '@/stores/useNotificationStore'
import {
    areQuotaSubjectsCurrent,
    captureQuotaRequestClaim,
    isQuotaRequestCurrent,
    quotaRequestClaimSignature,
    reconcileQuotaSubjects,
    useQuotaStore,
} from '@/stores/useQuotaStore'
import {PERSISTENT_NOTIFICATION_SOURCES} from '@/utils/notifications'
import {quotaCredentialKey} from '@/utils/quota/credentialKey'
import {afterEach, beforeEach, expect, mock, spyOn, test} from 'bun:test'
import React, {type ComponentType} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {sourceCallback, sourceInitializer} from './sourceCallbacks'

const file = 'components/credentials/hooks/useBackendQuotaRegistration.ts'
const key  = 'codex::synthetic-key-sentinel'
const noop = () => {
}
const task = (statuses: QuotaRefreshTargetStatus[], id = 'synthetic-refresh'): QuotaRefreshTask => ({
    id, created_at: '2026-11-09T00:00:00Z',
    status: statuses.every((value) => value === 'succeeded' || value === 'skipped') ? 'succeeded' :
            statuses.every((value) => value === 'cancelled') ? 'cancelled' : 'failed',
    summary: {
        total: statuses.length, queued: 0, running: 0,
        succeeded: statuses.filter((value) => value === 'succeeded').length,
        failed: statuses.filter((value) => value === 'failed').length,
        skipped: statuses.filter((value) => value === 'skipped').length,
        cancelled: statuses.filter((value) => value === 'cancelled').length,
        inconclusive: statuses.filter((value) => value === 'inconclusive').length,
        interrupted: statuses.filter((value) => value === 'interrupted').length,
    },
    targets: statuses.map((status, index) => ({ id: `${key}-${index}`, entry_key: key, status })),
    error: 'synthetic-token-sentinel',
})

function harness(result = task(['succeeded'])) {
    const mounted                        = { current: true }
    const metaRef                        = { current: {} }
    const refreshControllersRef          = { current: new Set<AbortController>() }
    let generation                       = 1
    const pollLatest                     = mock(async () => {
    })
    const refresh                        = mock(async (_names?: string[], _options?: { signal?: AbortSignal }) => ({
        ...result, status: 'queued' as const,
        targets: result.targets.map((target) => ({ ...target, status: 'queued' as const })),
    }))
    const fetchTask                      = mock(async () => result)
    const scope: Record<string, unknown> = { quotaCredentialKey }
    for (const name of [
        'metaForIdentifier', 'refreshMetaKeysForIdentifiers', 'refreshMetaKeysForTarget',
        'refreshMetaKeysForTask', 'emptyMetaForKey', 'markQuotaMetaLoading', 'quotaMetaStatusForTarget',
        'applyQuotaRefreshTaskToMeta',
    ]) {
        scope[name] = sourceCallback(file, name, { ...scope })
    }
    Object.assign(scope, {
        apiClient: { getAuthGeneration: () => generation }, captureQuotaRequestClaim, areQuotaSubjectsCurrent,
        mounted, metaRef, refreshControllersRef, quotaEnabled: false, setMeta: (update: (value: object) => object) => {
            metaRef.current = update(metaRef.current)
        }, quotaApi: { refresh }, pollLatest, i18n, useNotificationStore,
        waitForQuotaRefreshTask: (initial: QuotaRefreshTask, options: Parameters<typeof waitForQuotaRefreshTask>[1]) =>
            waitForQuotaRefreshTask(initial, {
                ...options, fetchTask, wait: async () => {
                },
            }),
    })
    const refreshMany = sourceCallback<(names: string[]) => Promise<void>>(file, 'refreshMany', scope)
    const refreshNow  = sourceCallback<(name: string) => Promise<void>>(file, 'refreshNow', { refreshMany })
    return {
        refreshMany, refreshNow, refresh, fetchTask, pollLatest, mounted, refreshControllersRef,
        changeGeneration: () => {
            generation += 1
        },
    }
}

function renderCenter() {
    const scope            = {
        React, styles: {}, PERSISTENT_NOTIFICATION_SOURCES,
        formatRelativeTime: () => 'Just now',
    }
    const NotificationItem = sourceCallback<ComponentType<{
        item: PersistentNotification;
        onClick: (id: string) => void;
        t: typeof i18n.t
    }>>(
        'components/common/NotificationCenter.tsx', 'NotificationItem', scope,
    )
    const Center           = sourceCallback<ComponentType>(
        'components/common/NotificationCenter.tsx',
        'NotificationCenter',
        {
            ...scope,
            NotificationItem,
            useTranslation: () => ({ t: i18n.t.bind(i18n) }),
            useNotificationStore: (select: (
                state: ReturnType<typeof useNotificationStore.getState>) => unknown) => select(
                useNotificationStore.getState()),
            usePagination: (items: PersistentNotification[]) => ({
                currentItems: items,
                currentPage: 1,
                pageSize: 5,
                goToPage: noop,
                setPageSize: noop,
            }),
            useRef: () => ({ current: null }),
            useEffect: noop,
            useCallback: (callback: unknown) => callback,
            Button: ({ children }: {
                children?: React.ReactNode
            }) => React.createElement('button', {}, children),
            IconBell: () => null,
            IconCheckCheck: () => null,
            IconTrash2: () => null,
            Pagination: () => null,
        },
    )
    return renderToStaticMarkup(React.createElement(Center))
}

let originalLanguage = i18n.language

beforeEach(async () => {
    originalLanguage = i18n.language

    useQuotaStore.getState().clearQuotaCache()
    useNotificationStore.setState({ notifications: [], persistentNotifications: [], panelOpen: true })
    await i18n.changeLanguage('en')
})

afterEach(async () => {
    await i18n.changeLanguage(originalLanguage)
})

test('manual single refresh completion reaches the actual notification store and center', async () => {
    const action = harness()
    await action.refreshNow(key)
    expect(action.refresh).toHaveBeenCalledTimes(1)
    expect(action.fetchTask).toHaveBeenCalledTimes(1)
    expect(useNotificationStore.getState().persistentNotifications).toMatchObject([
                                                                                      {
                                                                                          source: 'quota',
                                                                                          type: 'success',
                                                                                          read: false,
                                                                                      },
                                                                                  ])
    const [notice] = useNotificationStore.getState().persistentNotifications
    expect(notice.message).toBe('Quota refresh completed: 1/1 succeeded')
    expect(useNotificationStore.getState().notifications).toEqual([])
    expect(useNotificationStore.getState().unreadCount()).toBe(1)
    expect(renderCenter()).toContain(notice.message)
    expect(renderCenter()).toContain('Quota refresh')
    expect(notice.message).not.toContain('sentinel')
    expect(notice.message).not.toContain('synthetic-refresh')
})

test(
    'manual batch reports one counted result and preserves the existing failure toast',
    async () => {
        const action = harness(task(['succeeded', 'failed', 'skipped']))
        await action.refreshMany([key, key, ' codex::synthetic-second '])
        expect(action.refresh.mock.calls[0]?.[0]).toEqual([key, 'codex::synthetic-second'])
        const { persistentNotifications, notifications } = useNotificationStore.getState()
        expect(persistentNotifications).toHaveLength(1)
        expect(persistentNotifications[0]).toMatchObject(
            {
                source: 'quota', type: 'error',
                message:
                    'Quota refresh incomplete: 1 succeeded, 1 failed, 3 total',
            })
        expect(persistentNotifications[0].message).not.toContain('sentinel')
        expect(notifications).toHaveLength(1)
        expect(notifications[0]).toMatchObject({ type: 'error' })
        expect(notifications[0].message).toContain('synthetic-token-sentinel')
    },
)

test('reobserving the same refresh keeps one read item while a distinct action adds one', async () => {
    const action = harness()
    await action.refreshMany([key])
    const first = useNotificationStore.getState().persistentNotifications[0]
    expect(first).toBeDefined()
    useNotificationStore.getState().markAsRead(first.id)
    await action.refreshMany([key])
    expect(useNotificationStore.getState().persistentNotifications).toHaveLength(1)
    expect(useNotificationStore.getState().persistentNotifications[0]).toMatchObject({ id: first.id, read: true })
    await harness(task(['succeeded'], 'another-refresh')).refreshMany([key])
    expect(useNotificationStore.getState().persistentNotifications).toHaveLength(2)
    expect(useNotificationStore.getState().unreadCount()).toBe(1)
})

for (const change of ['auth', 'cache', 'subject', 'unmounted'] as const) {
    test(`completion from an outdated ${change} claim does not publish`, async () => {
        const action = harness(task(['failed']))
        action.fetchTask.mockImplementation(async () => {
            if (change === 'auth') {
                action.changeGeneration()
            }
            if (change === 'cache') {
                useQuotaStore.getState().clearQuotaCache()
            }
            if (change === 'subject') {
                useQuotaStore.getState().advanceQuotaSubjects([key])
            }
            if (change === 'unmounted') {
                action.mounted.current = false
            }
            return task(['failed'])
        })
        await action.refreshMany([key])
        expect(useNotificationStore.getState().persistentNotifications).toEqual([])
        expect(useNotificationStore.getState().notifications).toEqual([])
        expect(action.refreshControllersRef.current.size).toBe(0)
    })
}

test('cancellation retains its warning toast without adding a global result', async () => {
    await harness(task(['cancelled'])).refreshMany([key])
    expect(useNotificationStore.getState().persistentNotifications).toEqual([])
    expect(useNotificationStore.getState().notifications).toMatchObject([{ type: 'warning' }])
})

test('an aborted initial request does not publish a failure', async () => {
    const action = harness()
    action.refresh.mockImplementation(async () => {
        action.refreshControllersRef.current.forEach((controller) => controller.abort())
        throw new Error('synthetic cancelled request')
    })
    await action.refreshMany([key])
    expect(useNotificationStore.getState().persistentNotifications).toEqual([])
    expect(useNotificationStore.getState().notifications).toEqual([])
})

for (const phase of ['creation', 'wait'] as const) {
    test(`${phase} failure publishes a generic quota failure and retains the detailed toast`, async () => {
        const action = harness()
        const error  = phase === 'creation' ?
                       new Error('synthetic-token-sentinel') :
                       new QuotaRefreshTaskWaitTimeoutError('synthetic-refresh')
        const warn   = spyOn(console, 'warn').mockImplementation(noop)
        try {
            if (phase === 'creation') {
                action.refresh.mockRejectedValue(error)
            } else {
                action.fetchTask.mockRejectedValue(error)
            }
            await action.refreshMany([key])
            expect(useNotificationStore.getState().persistentNotifications).toMatchObject(
                [
                    {
                        source: 'quota',
                        type: 'error',
                        message: 'Quota refresh failed',
                    },
                ])
            expect(useNotificationStore.getState().notifications).toHaveLength(1)
            expect(useNotificationStore.getState().notifications[0].message).toContain(error.message)
        } finally {
            warn.mockRestore()
        }
    })
}

test('automatic quota polling and its registered interval do not publish global events', async () => {
    const scope: Record<string, unknown> = {
        captureQuotaRequestClaim,
        quotaRequestClaimSignature,
        isQuotaRequestCurrent,
        reconcileQuotaSubjects,
        useQuotaStore,
        apiClient: { getAuthGeneration: () => 1 },
        mounted: { current: true },
        pollPromiseRef: { current: null },
        quotaEnabledRef: { current: false },
        metaRef: { current: {} },
        setMeta: noop,
        setQuotaEnabled: noop,
        setPollIntervalMs: noop,
        quotaApi: { getStatus: async () => ({ enabled: true, interval_seconds: 60, credentials: {} }) },
        entryMetaFromMetadata: sourceInitializer(file, 'entryMetaFromMetadata', {}),
        useNotificationStore,
        i18n,
    }
    scope.quotaMetaSnapshot              = sourceInitializer(file, 'quotaMetaSnapshot', scope)
    const poll                           = sourceCallback<() => Promise<void>>(file, 'poll', scope)
    await poll()
    let intervalCallback: (() => Promise<void>) | undefined
    const cleanup = sourceCallback<() => () => void>(file, 'useEffect', {
        poll, pollIntervalMs: 60_000,
        window: {
            setInterval: (callback: () => Promise<void>) => {
                intervalCallback = callback;
                return 1
            }, clearInterval: noop,
        },
    }, 'window.setInterval')()
    expect(intervalCallback).toBeDefined()
    await intervalCallback!()
    cleanup()
    expect(useNotificationStore.getState().persistentNotifications).toEqual([])
})

test('existing quota history still renders and the catalogue defines manual events only', () => {
    useNotificationStore.getState().addPersistentNotification('Existing quota history', 'warning', 'quota')
    expect(renderCenter()).toContain('Existing quota history')
    expect(renderCenter()).toContain('Quota refresh')
    expect(PERSISTENT_NOTIFICATION_SOURCES.quota.trigger).toContain('manual')
    expect(PERSISTENT_NOTIFICATION_SOURCES.quota.trigger.toLowerCase()).not.toContain('polling')
    expect(Object.keys(PERSISTENT_NOTIFICATION_SOURCES)).toHaveLength(7)
})

test('all four locales translate quota action results without leaking identifiers', async () => {
    for (const language of ['en', 'zh-CN', 'zh-TW', 'ru']) {
        await i18n.changeLanguage(language)
        useNotificationStore.getState().clearAllPersistent()
        await harness().refreshMany([key])
        const [notice] = useNotificationStore.getState().persistentNotifications
        expect(notice).toBeDefined()
        expect(notice.message).not.toContain('notifications.')
        expect(notice.message).toContain('1/1')
        expect(notice.message).not.toContain('sentinel')
        expect(renderCenter()).toContain(notice.message)
    }
})
