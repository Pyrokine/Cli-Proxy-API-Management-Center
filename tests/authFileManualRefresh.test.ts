import {describe, expect, mock, spyOn, test} from 'bun:test'
import {readFileSync} from 'node:fs'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {Sheet, type SheetColumn} from '@/components/common/Sheet'
import {NotificationContainer} from '@/components/common/NotificationContainer'
import {ConfirmationModal} from '@/components/common/ConfirmationModal'
import {Button} from '@/components/ui/Button'
import {useNotificationStore} from '@/stores/useNotificationStore'

import {
    applyAuthFileMutation, authFileMutationNames, authFileMutationQuotaKeys,
    createLatestCredentialsRequestTracker, type AuthFileMutation,
} from '@/components/credentials/credentialsDataLifecycle'
import {getCachedAuthFileModels, loadAuthFileModels} from '@/features/authFiles/authFileModelsCache'
import {invalidateAuthFileDerivedCaches} from '@/features/authFiles/cacheInvalidation'
import i18n from '@/i18n'
import {authFilesApi, type AuthFileRefreshBatchItem} from '@/services/api/authFiles'
import {apiClient} from '@/services/api/client'
import {useAuthFileRefreshStore} from '@/stores/useAuthFileRefreshStore'
import {useQuotaStore} from '@/stores/useQuotaStore'
import {quotaCredentialKey} from '@/utils/quota/credentialKey'
import {sourceCallback} from './sourceCallbacks'

const safeResult = {
    filename: 'shared.json',
    provider: 'devin',
    auth_index: 'devin-2',
    status: 'active',
    refreshed_at: '2026-09-16T00:00:00Z',
}

function singleRefreshAction(scope: Record<string, unknown>): () => Promise<unknown> {
    let work: Promise<unknown> = Promise.resolve()
    const runAction = scope.runAction as ((action: string, fn: (isCurrent: () => boolean) => Promise<unknown>) => Promise<unknown>) | undefined
        ?? sourceCallback<(action: string, fn: (isCurrent: () => boolean) => Promise<unknown>) => Promise<unknown>>(
            'components/credentials/AccountInspectionPanel.tsx', 'runAction', {
            ...scope, dataGeneration: scope.authGeneration, busyRequestRef: {current: null},
            fetchData: mock(async () => {}), setActionError: scope.setActionError ?? mock(), setBusyRequest: mock(),
        })
    const render = sourceCallback<(result: Record<string, unknown>) => React.ReactElement<React.ComponentProps<typeof Button>>>(
        'components/credentials/AccountInspectionPanel.tsx', 'renderRowActions', {
            ...scope, React, Button, rowKey: (result: {auth_index: string}) => result.auth_index,
            busyAction: null, tokenRefreshBusy: false,
            runAction: (action: string, fn: (isCurrent: () => boolean) => Promise<unknown>) => {
                work = runAction(action, fn)
                return work
            },
        },
    )
    const button = render({file_name: 'fixture-a.json', auth_index: 'fixture-auth', status: 'error', reason: 'token_expired'})
    return () => {
        const click = button.props.onClick as () => void
        click()
        return work
    }
}

describe('auth-file manual token refresh', () => {
    test('posts the exact credential identity and returns only the safe projection', async () => {
        const post = spyOn(apiClient, 'post').mockResolvedValue({
            ...safeResult,
            refreshed_at: '2026-09-16T00:00:00Z',
            metadata: {access_token: 'must-not-propagate'},
        })
        const patch = spyOn(apiClient, 'patch').mockResolvedValue({})
        try {
            await expect(authFilesApi.requestManualRefresh(' shared.json ', ' devin-2 ')).resolves.toEqual({
                ...safeResult,
                refreshed_at: '2026-09-16T00:00:00.000Z',
            })
            expect(post).toHaveBeenCalledWith('/auth-files/refresh', {
                name: 'shared.json',
                auth_index: 'devin-2',
            }, {timeout: 35_000})
            expect(patch).not.toHaveBeenCalled()
        } finally {
            post.mockRestore()
            patch.mockRestore()
        }
    })

    test('posts all:true for the backend bulk token refresh contract', async () => {
        const post = spyOn(apiClient, 'post').mockResolvedValue({
            results: [
                {...safeResult, success: true},
                {
                    ...safeResult,
                    auth_index: 'devin-3',
                    success: false,
                    error: 'credential_refresh_failed',
                    metadata: {refresh_token: 'must-not-propagate'},
                },
            ],
        })
        try {
            await expect(authFilesApi.requestManualRefreshAll()).resolves.toEqual({
                results: [
                    {...safeResult, refreshed_at: '2026-09-16T00:00:00.000Z', success: true},
                    {
                        ...safeResult,
                        auth_index: 'devin-3',
                        refreshed_at: '2026-09-16T00:00:00.000Z',
                        success: false,
                        error: 'credential_refresh_failed',
                    },
                ],
            })
            expect(post).toHaveBeenCalledWith('/auth-files/refresh', {all: true}, {timeout: 300_000})
        } finally {
            post.mockRestore()
        }
    })

    test('inspection action confirms the bulk request and retains per-account results', () => {
        const panel = readFileSync(new URL('../src/components/credentials/AccountInspectionPanel.tsx', import.meta.url), 'utf8')
        expect(panel).toContain('showConfirmation({')
        expect(panel).toContain('onConfirm: handleRefreshAllTokens')
        expect(panel).toContain('setTokenRefreshResults(result.results)')
        expect(panel).toMatch(/await fn\(isCurrent\)[\s\S]*?finally {\s*try {\s*if \(isCurrent\(\)\) {\s*await fetchData\(\)/)
        expect(panel).toMatch(/await authFilesApi\.requestManualRefreshAll\(\)[\s\S]*?finally {\s*if \(isCurrent\(\)\) {\s*await onCredentialsChanged\?\.\(\)/)
        expect(panel).toContain('rows={tokenRefreshResults}')
        expect(panel).toContain('onClick={() => setTokenRefreshResults(null)}')
        expect(panel).toContain('disabled={Boolean(busyAction) || tokenRefreshBusy}')
        const page = readFileSync(new URL('../src/pages/CredentialsPage.tsx', import.meta.url), 'utf8')
        const vendor = readFileSync(new URL('../src/components/credentials/VendorSection.tsx', import.meta.url), 'utf8')
        expect(page).toContain('onCredentialsChanged={handleCredentialsChanged}')
        expect(vendor).not.toContain('authFilesApi.requestManualRefresh')
        expect(vendor).toContain('disabled: !authIndex || file.disabled || tokenRefreshBusy')
        for (const locale of ['en', 'ru', 'zh-CN', 'zh-TW']) {
            const strings = JSON.parse(readFileSync(new URL(`../src/i18n/locales/${locale}.json`, import.meta.url), 'utf8'))
                .credentials
            expect(strings.manual_token_refresh_confirm).toBeTruthy()
            expect(strings.manual_token_refresh_results).toBeTruthy()
            expect(strings.manual_token_refresh_in_progress).toBeTruthy()
        }
    })

    test('preserves an empty successful batch so the UI can report no eligible credentials', async () => {
        const post = spyOn(apiClient, 'post').mockResolvedValue({results: []})
        try {
            await expect(authFilesApi.requestManualRefreshAll()).resolves.toEqual({results: []})
            expect(post).toHaveBeenCalledWith('/auth-files/refresh', {all: true}, {timeout: 300_000})
        } finally {
            post.mockRestore()
        }
    })

    test('does not issue an ambiguous file-level refresh', () => {
        const post = spyOn(apiClient, 'post').mockResolvedValue({})
        try {
            expect(() => authFilesApi.requestManualRefresh('shared.json')).toThrow(
                'auth_files.refresh_identity_required',
            )
            expect(post).not.toHaveBeenCalled()
        } finally {
            post.mockRestore()
        }
    })

    test('propagates refresh failures without falling back to metadata edits', async () => {
        const error = new Error('refresh failed')
        const post = spyOn(apiClient, 'post').mockRejectedValue(error)
        const patch = spyOn(apiClient, 'patch').mockResolvedValue({})
        try {
            await expect(authFilesApi.requestManualRefresh('shared.json', 'devin-2')).rejects.toBe(error)
            expect(post).toHaveBeenCalledTimes(1)
            expect(patch).not.toHaveBeenCalled()
        } finally {
            post.mockRestore()
            patch.mockRestore()
        }
    })
})

test('requires confirmation, renders bulk refresh results safely and closes the current result view', async () => {
    const results: AuthFileRefreshBatchItem[] = [
        {...safeResult, success: true},
        {...safeResult, auth_index: '<script>fixture</script>', filename: '<img src=x onerror=fixture>',
            success: false, error: '<svg onload=fixture>'},
    ]
    const refresh = spyOn(authFilesApi, 'requestManualRefreshAll').mockResolvedValue({results})
    const before = useNotificationStore.getState().notifications
    const beforeConfirmation = useNotificationStore.getState().confirmation
    const currentSnapshot = spyOn(React, 'useSyncExternalStore').mockImplementation(
        ((_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot()) as typeof React.useSyncExternalStore,
    )
    const view = {displayed: null as AuthFileRefreshBatchItem[] | null}
    const setTokenRefreshResults = (value: AuthFileRefreshBatchItem[] | null) => { view.displayed = value }
    const t = i18n.getFixedT('en')
    const handle = sourceCallback<() => Promise<void>>('components/credentials/AccountInspectionPanel.tsx', 'handleRefreshAllTokens', {
        authFilesApi, setTokenRefreshResults, t, onCredentialsChanged: mock(),
        showNotification: (message: string, type: 'success' | 'warning' | 'error') =>
            useNotificationStore.getState().showNotification(message, type, 0),
        runAction: async (_action: string, fn: (isCurrent: () => boolean) => Promise<unknown>) => { await fn(() => true) },
    })
    const columns = sourceCallback<() => SheetColumn<AuthFileRefreshBatchItem>[]>(
        'components/credentials/AccountInspectionPanel.tsx', 'tokenRefreshColumns', {
            React, t, styles: {}, formatTime: (value: string) => value,
        },
    )()
    try {
        useNotificationStore.setState({notifications: []})
        const panel = readFileSync(new URL('../src/components/credentials/AccountInspectionPanel.tsx', import.meta.url), 'utf8')
        const buttonStart = panel.indexOf("loading={busyAction === 'refresh-all-tokens'}")
        expect(buttonStart).toBeGreaterThanOrEqual(0)
        const button = panel.slice(buttonStart, panel.indexOf('</Button>', buttonStart))
        const openCallback = button.match(/onClick=\{([\s\S]*?)\}\s*>/)?.[1]
        if (!openCallback) {
            throw new Error('missing bulk refresh confirmation')
        }
        const open = new Function('showConfirmation', 't', 'handleRefreshAllTokens', `return (${openCallback})`)(
            useNotificationStore.getState().showConfirmation, t, handle,
        ) as () => void
        open()
        expect(refresh).not.toHaveBeenCalled()
        const rendered = {modal: null as ReturnType<typeof ConfirmationModal>}
        const Probe = () => {
            rendered.modal = ConfirmationModal()
            return null
        }
        renderToStaticMarkup(React.createElement(Probe))
        if (!rendered.modal) {
            throw new Error('bulk confirmation was not rendered')
        }
        const actions = React.Children.toArray(rendered.modal.props.children)[1] as React.ReactElement<{children: React.ReactNode}>
        const confirm = React.Children.toArray(actions.props.children)[1] as React.ReactElement<React.ComponentProps<typeof Button>>
        await (confirm.props.onClick as () => Promise<void>)()
        expect(useNotificationStore.getState().confirmation.isOpen).toBe(false)
        expect(view.displayed).toEqual(results)
        const html = renderToStaticMarkup(React.createElement(Sheet<AuthFileRefreshBatchItem>, {
            rows: results, columns, rowKey: (row) => row.auth_index, status: 'ready',
        }))
        expect(html).toContain('&lt;img')
        expect(html).toContain('&lt;script&gt;')
        expect(html).toContain('&lt;svg')
        for (const tag of ['<img src=x', '<script>fixture', '<svg onload=fixture']) {
            expect(html).not.toContain(tag)
        }
        const notification = renderToStaticMarkup(React.createElement(NotificationContainer))
        expect(notification).toContain('role="status"')
        expect(notification).toContain('Renewed 1 account(s); 1 failed')
        const closeCallback = panel.match(/onClick=\{(\(\) => setTokenRefreshResults\(null\))\}/)?.[1]
        expect(closeCallback).toBeTruthy()
        if (!closeCallback) {
            throw new Error('missing result close action')
        }
        const close = new Function('setTokenRefreshResults', `return (${closeCallback})`)(setTokenRefreshResults) as () => void
        close()
        expect(view.displayed).toBeNull()
        expect(refresh).toHaveBeenCalledTimes(1)
    } finally {
        refresh.mockRestore()
        currentSnapshot.mockRestore()
        useNotificationStore.setState({notifications: before, confirmation: beforeConfirmation})
    }
})

test('shows empty bulk eligibility in the actual result renderer and notification', async () => {
    const refresh = spyOn(authFilesApi, 'requestManualRefreshAll').mockResolvedValue({results: []})
    const currentSnapshot = spyOn(React, 'useSyncExternalStore').mockImplementation(
        ((_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot()) as typeof React.useSyncExternalStore,
    )
    const before = useNotificationStore.getState().notifications
    const setTokenRefreshResults = mock()
    const t = i18n.getFixedT('en')
    const handle = sourceCallback<() => Promise<void>>('components/credentials/AccountInspectionPanel.tsx', 'handleRefreshAllTokens', {
        authFilesApi, setTokenRefreshResults, t, onCredentialsChanged: mock(),
        showNotification: (message: string, type: 'success' | 'warning' | 'error') =>
            useNotificationStore.getState().showNotification(message, type, 0),
        runAction: async (_action: string, fn: (isCurrent: () => boolean) => Promise<unknown>) => { await fn(() => true) },
    })
    try {
        useNotificationStore.setState({notifications: []})
        await handle()
        const resultCalls = setTokenRefreshResults.mock.calls
        expect(resultCalls[resultCalls.length - 1]).toEqual([[]])
        const emptyText = t('credentials.manual_token_refresh_all_none')
        expect(renderToStaticMarkup(React.createElement(Sheet<AuthFileRefreshBatchItem>, {
            rows: [], columns: [], rowKey: (row, index) => `${row.filename}-${row.auth_index}-${index}`,
            status: 'empty', emptyText,
        }))).toContain(emptyText)
        const notification = renderToStaticMarkup(React.createElement(NotificationContainer))
        expect(notification).toContain('role="status"')
        expect(notification).toContain(emptyText)
        expect(refresh).toHaveBeenCalledTimes(1)
    } finally {
        refresh.mockRestore()
        currentSnapshot.mockRestore()
        useNotificationStore.setState({notifications: before})
    }
})

test('a stale bulk confirmation sends no request and leaves current results untouched', async () => {
    const generation = apiClient.getAuthGeneration()
    const getGeneration = spyOn(apiClient, 'getAuthGeneration').mockReturnValue(generation + 1)
    const refresh = spyOn(authFilesApi, 'requestManualRefreshAll').mockResolvedValue({results: []})
    const fetchData = mock(async () => {})
    const setActionError = mock()
    const setTokenRefreshResults = mock()
    const runAction = sourceCallback<(action: string, fn: (isCurrent: () => boolean) => Promise<unknown>) => Promise<void>>(
        'components/credentials/AccountInspectionPanel.tsx', 'runAction', {
            apiClient, authGeneration: generation, dataGeneration: generation, fetchData,
            setActionError, busyRequestRef: {current: null}, setBusyRequest: mock(),
            t: (key: string) => key,
        },
    )
    const handle = sourceCallback<() => Promise<void>>('components/credentials/AccountInspectionPanel.tsx', 'handleRefreshAllTokens', {
        authFilesApi, runAction, setTokenRefreshResults, showNotification: mock(),
        onCredentialsChanged: mock(), t: (key: string) => key,
    })
    try {
        await handle()
        expect(refresh).not.toHaveBeenCalled()
        expect(setTokenRefreshResults).not.toHaveBeenCalled()
        expect(fetchData).not.toHaveBeenCalled()
        expect(setActionError).toHaveBeenCalledWith('common.connection_changed')
    } finally {
        refresh.mockRestore()
        getGeneration.mockRestore()
    }
})

for (const response of [null, [], {}, {results: null}, {results: {}}, {results: [null]},
    {results: [safeResult]}, {results: [{...safeResult, success: 'true'}]},
    {results: [{...safeResult, success: true, auth_index: ''}]},
    {results: [{...safeResult, success: true, refreshed_at: 'invalid'}]},
    {results: [{...safeResult, success: true, provider: 4}]},
    {results: [{...safeResult, success: true, status: ''}]}]) {
    test(`rejects malformed bulk refresh response ${JSON.stringify(response)}`, async () => {
        const post = spyOn(apiClient, 'post').mockResolvedValue(response)
        try {
            await expect(authFilesApi.requestManualRefreshAll()).rejects.toThrow('auth_files.refresh_invalid_response')
            expect(post).toHaveBeenCalledTimes(1)
            expect(useAuthFileRefreshStore.getState().request).toBeNull()
        } finally {
            post.mockRestore()
            useAuthFileRefreshStore.setState({request: null})
        }
    })
}

for (const outcome of ['success', 'failure'] as const) {
    test(`ignores stale single token refresh ${outcome} and preserves the new connection busy state`, async () => {
        let generation = 1
        type Busy = {action: string; generation: number} | null
        let busy: Busy = null
        const getGeneration = spyOn(apiClient, 'getAuthGeneration').mockImplementation(() => generation)
        const pending = Promise.withResolvers<Awaited<ReturnType<typeof authFilesApi.requestManualRefresh>>>()
        const refresh = spyOn(authFilesApi, 'requestManualRefresh').mockReturnValue(pending.promise)
        const onRefresh = mock(async () => {})
        const showNotification = mock()
        const runAction = sourceCallback<(action: string, fn: (isCurrent: () => boolean) => Promise<unknown>) => Promise<void>>(
            'components/credentials/AccountInspectionPanel.tsx', 'runAction', {
                apiClient, authGeneration: 1, dataGeneration: 1, fetchData: mock(async () => {}), setActionError: mock(),
                busyRequestRef: {current: null}, t: (key: string) => key,
                setBusyRequest: (value: Busy | ((previous: Busy) => Busy)) => {
                    busy = typeof value === 'function' ? value(busy) : value
                },
            },
        )
        const handle = singleRefreshAction({apiClient, authFilesApi, authGeneration: 1, runAction,
            onCredentialsChanged: onRefresh, showNotification, t: (key: string) => key})
        try {
            const work = handle()
            expect<Busy>(busy).toEqual({generation: 1, action: 'refresh-fixture-auth'})
            generation = 2
            busy = {generation: 2, action: 'fixture-new-action'}
            if (outcome === 'success') {
                pending.resolve(safeResult)
            } else {
                pending.reject(new Error('fixture old connection failure'))
            }
            await work
            expect(onRefresh).not.toHaveBeenCalled()
            expect(showNotification).not.toHaveBeenCalled()
            expect<Busy>(busy).toEqual({generation: 2, action: 'fixture-new-action'})
        } finally {
            refresh.mockRestore()
            getGeneration.mockRestore()
        }
    })
}

for (const outcome of ['success', 'failure'] as const) {
    test(`ignores stale bulk token refresh ${outcome} without publishing results or refreshing the new connection`, async () => {
        let generation = 1
        type Busy = {action: string; generation: number} | null
        let busy: Busy = null
        const getGeneration = spyOn(apiClient, 'getAuthGeneration').mockImplementation(() => generation)
        const pending = Promise.withResolvers<Awaited<ReturnType<typeof authFilesApi.requestManualRefreshAll>>>()
        const refresh = spyOn(authFilesApi, 'requestManualRefreshAll').mockReturnValue(pending.promise)
        const fetchData = mock(async () => {})
        const onCredentialsChanged = mock(async () => {})
        const showNotification = mock()
        const setActionError = mock()
        const setTokenRefreshResults = mock()
        const runAction = sourceCallback<(action: string, fn: (isCurrent: () => boolean) => Promise<unknown>) => Promise<void>>(
            'components/credentials/AccountInspectionPanel.tsx', 'runAction', {
                apiClient, authGeneration: 1, dataGeneration: 1, fetchData, setActionError,
                busyRequestRef: {current: null},
                t: (key: string) => key,
                setBusyRequest: (value: Busy | ((previous: Busy) => Busy)) => {
                    busy = typeof value === 'function' ? value(busy) : value
                },
            },
        )
        const handle = sourceCallback<() => Promise<void>>('components/credentials/AccountInspectionPanel.tsx', 'handleRefreshAllTokens', {
            authFilesApi, runAction, setTokenRefreshResults, showNotification, onCredentialsChanged,
            t: (key: string) => key,
        })
        try {
            const work = handle()
            expect(setTokenRefreshResults).toHaveBeenCalledTimes(1)
            expect(setTokenRefreshResults).toHaveBeenCalledWith(null)
            generation = 2
            busy = {generation: 2, action: 'fixture-new-action'}
            if (outcome === 'success') {
                pending.resolve({results: [{...safeResult, success: true}]})
            } else {
                pending.reject(new Error('fixture old connection failure'))
            }
            await work
            expect(setTokenRefreshResults).toHaveBeenCalledTimes(1)
            expect(showNotification).not.toHaveBeenCalled()
            expect(onCredentialsChanged).not.toHaveBeenCalled()
            expect(fetchData).not.toHaveBeenCalled()
            expect(setActionError).toHaveBeenCalledTimes(1)
            expect<Busy>(busy).toEqual({generation: 2, action: 'fixture-new-action'})
        } finally {
            refresh.mockRestore()
            getGeneration.mockRestore()
        }
    })
}

for (const kind of ['single', 'all'] as const) {
    for (const outcome of ['success', 'failure', 'timeout', 'invalid response'] as const) {
        test(`serializes ${kind} token refresh and releases its state after ${outcome}`, async () => {
            const pending = Promise.withResolvers<unknown>()
            const post = spyOn(apiClient, 'post').mockReturnValue(pending.promise)
            const error = Object.assign(new Error(`fixture ${outcome}`), {code: 'ECONNABORTED'})
            try {
                const work = kind === 'all' ? authFilesApi.requestManualRefreshAll() :
                             authFilesApi.requestManualRefresh('shared.json', 'devin-2')
                expect(useAuthFileRefreshStore.getState().request).toEqual({
                    generation: apiClient.getAuthGeneration(),
                    target: kind === 'all' ? {all: true} : {name: 'shared.json', auth_index: 'devin-2'},
                })
                const busyMessage = i18n.t('credentials.manual_token_refresh_in_progress')
                await expect(authFilesApi.requestManualRefresh('other.json', 'other-auth')).rejects.toThrow(busyMessage)
                await expect(authFilesApi.requestManualRefreshAll()).rejects.toThrow(busyMessage)
                expect(post).toHaveBeenCalledTimes(1)
                if (outcome === 'failure' || outcome === 'timeout') {
                    pending.reject(error)
                    await expect(work).rejects.toBe(error)
                } else if (outcome === 'invalid response') {
                    pending.resolve({})
                    await expect(work).rejects.toThrow('auth_files.refresh_invalid_response')
                } else {
                    pending.resolve(kind === 'all' ? {results: []} : safeResult)
                    await work
                }
                expect(useAuthFileRefreshStore.getState().request).toBeNull()
                post.mockResolvedValue({results: []})
                await expect(authFilesApi.requestManualRefreshAll()).resolves.toEqual({results: []})
                expect(post).toHaveBeenCalledTimes(2)
            } finally {
                post.mockRestore()
                useAuthFileRefreshStore.setState({request: null})
            }
        })
    }
}

for (const outcome of ['success', 'failure'] as const) {
    test(`old token refresh ${outcome} cannot clear the new connection request`, async () => {
        let generation = 100
        const getGeneration = spyOn(apiClient, 'getAuthGeneration').mockImplementation(() => generation)
        const oldRequest = Promise.withResolvers<unknown>()
        const newRequest = Promise.withResolvers<unknown>()
        const post = spyOn(apiClient, 'post').mockReturnValueOnce(oldRequest.promise).mockReturnValueOnce(newRequest.promise)
        try {
            const oldWork = authFilesApi.requestManualRefreshAll()
            generation += 1
            const newWork = authFilesApi.requestManualRefresh('shared.json', 'devin-2')
            const current = useAuthFileRefreshStore.getState().request
            expect(current?.generation).toBe(101)
            if (outcome === 'success') {
                oldRequest.resolve({results: []})
                await oldWork
            } else {
                const error = new Error('fixture old request failed')
                oldRequest.reject(error)
                await expect(oldWork).rejects.toBe(error)
            }
            expect(useAuthFileRefreshStore.getState().request).toBe(current)
            newRequest.resolve(safeResult)
            await newWork
            expect(useAuthFileRefreshStore.getState().request).toBeNull()
            expect(post).toHaveBeenCalledTimes(2)
        } finally {
            post.mockRestore()
            getGeneration.mockRestore()
            useAuthFileRefreshStore.setState({request: null})
        }
    })
}

test('inspection actions remain exclusive through their data refresh', async () => {
    type Busy = {action: string; generation: number} | null
    let busy: Busy = null
    const generation = apiClient.getAuthGeneration()
    const busyRequestRef: {current: Busy} = {current: null}
    const operation = Promise.withResolvers<void>()
    const refreshed = Promise.withResolvers<void>()
    const fetchStarted = Promise.withResolvers<void>()
    const fetchData = mock(() => {
        fetchStarted.resolve()
        return refreshed.promise
    })
    const first = mock(() => operation.promise)
    const second = mock(async () => {})
    const runAction = sourceCallback<(action: string, fn: () => Promise<unknown>) => Promise<void>>(
        'components/credentials/AccountInspectionPanel.tsx', 'runAction', {
            apiClient, authGeneration: generation, dataGeneration: generation,
            busyRequestRef, fetchData, setActionError: mock(), t: (key: string) => key,
            setBusyRequest: (value: Busy | ((previous: Busy) => Busy)) => {
                busy = typeof value === 'function' ? value(busy) : value
            },
        },
    )
    const work = runAction('refresh-all-tokens', first)
    await runAction('refresh-single', second)
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).not.toHaveBeenCalled()
    operation.resolve()
    await fetchStarted.promise
    await runAction('enable-single', second)
    expect(second).not.toHaveBeenCalled()
    expect(busyRequestRef.current?.action).toBe('refresh-all-tokens')
    refreshed.resolve()
    await work
    expect(busyRequestRef.current).toBeNull()
    expect(busy).toBeNull()
    await runAction('refresh-single', second)
    expect(second).toHaveBeenCalledTimes(1)
})

for (const kind of ['single', 'all'] as const) {
    for (const outcome of ['success', 'failure', 'timeout'] as const) {
        test(`${kind} token refresh ${outcome} invalidates derived caches through the page callback`, async () => {
            invalidateAuthFileDerivedCaches()
            const files = [{name: 'fixture-a.json', type: 'codex', authIndex: 'fixture-auth'},
                           {name: 'fixture-b.json', type: 'codex', authIndex: 'other-auth'}]
            const firstKey = quotaCredentialKey('codex', files[0]!.name)
            const secondKey = quotaCredentialKey('codex', files[1]!.name)
            await loadAuthFileModels(files[0]!.name, async () => [{id: 'fixture-a-model'}])
            await loadAuthFileModels(files[1]!.name, async () => [{id: 'fixture-b-model'}])
            useQuotaStore.setState({codexQuota: {
                [firstKey]: {status: 'success', windows: []}, [secondKey]: {status: 'success', windows: []},
            }})
            const loadAll = mock(async () => {})
            const completeMutation = sourceCallback<(mutation: AuthFileMutation) => Promise<void>>(
                'components/credentials/hooks/useCredentialsData.ts', 'completeMutation', {
                    requestTrackerRef: {current: createLatestCredentialsRequestTracker()},
                    authFilesRef: {current: files}, authFileMutationQuotaKeys, authFileMutationNames,
                    applyAuthFileMutation, invalidateAuthFileDerivedCaches, loadAll,
                    setAuthFiles: mock(), setSummaryCount: mock(), setLoading: mock(), setRefreshing: mock(),
                },
            )
            const refreshCredentialInsights = mock(async () => {})
            const markRefreshed = mock()
            const onCredentialsChanged = mock(sourceCallback<(names?: string[]) => Promise<void>>(
                'pages/CredentialsPage.tsx', 'handleCredentialsChanged', {
                    apiClient, completeMutation, refreshCredentialInsights, markRefreshed,
                },
            ))
            const error = Object.assign(new Error(`fixture ${outcome}`), {code: 'ECONNABORTED'})
            const refresh = spyOn(authFilesApi, 'requestManualRefresh')
            const refreshAll = spyOn(authFilesApi, 'requestManualRefreshAll')
            if (outcome === 'success') {
                refresh.mockResolvedValue(safeResult)
                refreshAll.mockResolvedValue({results: []})
            } else {
                refresh.mockRejectedValue(error)
                refreshAll.mockRejectedValue(error)
            }
            const showNotification = mock()
            const setActionError = mock()
            const common = {apiClient, authGeneration: apiClient.getAuthGeneration(), authFilesApi,
                            onCredentialsChanged, showNotification, setActionError, t: (key: string) => key}
            try {
                const handle = kind === 'single' ? singleRefreshAction(common) : sourceCallback<() => Promise<void>>(
                    'components/credentials/AccountInspectionPanel.tsx', 'handleRefreshAllTokens', {
                        ...common, setTokenRefreshResults: mock(),
                        runAction: async (_action: string, fn: (isCurrent: () => boolean) => Promise<unknown>) => {
                            await fn(() => true)
                        },
                    },
                )
                if (kind === 'all' && outcome !== 'success') {
                    await expect(handle()).rejects.toBe(error)
                } else {
                    await handle()
                }
                expect(onCredentialsChanged).toHaveBeenCalledTimes(1)
                expect(onCredentialsChanged.mock.calls[0]).toEqual(kind === 'all' ? [] : [['fixture-a.json']])
                expect(getCachedAuthFileModels('fixture-a.json')).toBeNull()
                expect(useQuotaStore.getState().codexQuota[firstKey]).toBeUndefined()
                if (kind === 'all') {
                    expect(getCachedAuthFileModels('fixture-b.json')).toBeNull()
                    expect(useQuotaStore.getState().codexQuota[secondKey]).toBeUndefined()
                } else {
                    expect(getCachedAuthFileModels('fixture-b.json')).toEqual([{id: 'fixture-b-model'}])
                    expect(useQuotaStore.getState().codexQuota[secondKey]).toBeDefined()
                }
                expect(loadAll).toHaveBeenCalledTimes(1)
                expect(refreshCredentialInsights).toHaveBeenCalledTimes(1)
                expect(markRefreshed).toHaveBeenCalledTimes(1)
                if (kind === 'single' && outcome !== 'success') {
                    expect(setActionError.mock.calls[setActionError.mock.calls.length - 1]?.[0]).toBe(error.message)
                }
            } finally {
                refresh.mockRestore()
                refreshAll.mockRestore()
                invalidateAuthFileDerivedCaches()
            }
        })
    }
}
