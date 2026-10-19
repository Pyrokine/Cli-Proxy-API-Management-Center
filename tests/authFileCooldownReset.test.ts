import {describe, expect, mock, spyOn, test} from 'bun:test'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {ConfirmationModal} from '@/components/common/ConfirmationModal'
import type {Button} from '@/components/ui/Button'
import i18n from '@/i18n'
import {authFilesApi} from '@/services/api/authFiles'
import {apiClient} from '@/services/api/client'
import {useNotificationStore} from '@/stores/useNotificationStore'
import {sourceCallback} from './sourceCallbacks'

describe('local credential cooldown reset', () => {
    test('sends only the exact auth index to the local routing endpoint', async () => {
        const post = spyOn(apiClient, 'post').mockResolvedValue({status: 'ok', auth_index: 'codex:one', models: []})
        try {
            await expect(authFilesApi.clearLocalCooldown(' codex:one ')).resolves.toBeUndefined()
            expect(post).toHaveBeenCalledTimes(1)
            expect(post).toHaveBeenCalledWith('/routing/cooldown/reset', {auth_index: 'codex:one'})
        } finally {
            post.mockRestore()
        }
    })

    test('rejects a missing identity before sending a request', async () => {
        const post = spyOn(apiClient, 'post').mockResolvedValue({status: 'ok'})
        try {
            await expect(authFilesApi.clearLocalCooldown('   ')).rejects.toThrow(
                'auth_files.cooldown_identity_required',
            )
            expect(post).not.toHaveBeenCalled()
        } finally {
            post.mockRestore()
        }
    })

    test('does not treat a mismatched or failed response as a cleared cooldown', async () => {
        const post = spyOn(apiClient, 'post').mockResolvedValueOnce({status: 'ok', auth_index: 'codex:other'})
            .mockResolvedValueOnce({status: 'failed', auth_index: 'codex:one'})
        try {
            await expect(authFilesApi.clearLocalCooldown('codex:one')).rejects.toThrow(
                'auth_files.cooldown_reset_invalid_response',
            )
            await expect(authFilesApi.clearLocalCooldown('codex:one')).rejects.toThrow(
                'auth_files.cooldown_reset_invalid_response',
            )
            expect(post).toHaveBeenCalledTimes(2)
            expect(post.mock.calls.every(([path]) => path === '/routing/cooldown/reset')).toBe(true)
        } finally {
            post.mockRestore()
        }
    })

    for (const outcome of ['success', 'failure'] as const) {
        test(`keeps the local cooldown confirmation disabled and loading until ${outcome}`, async () => {
            const pending = Promise.withResolvers<void>()
            const clear = spyOn(authFilesApi, 'clearLocalCooldown').mockReturnValue(pending.promise)
            const currentSnapshot = spyOn(React, 'useSyncExternalStore').mockImplementation(
                ((_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot()) as typeof React.useSyncExternalStore,
            )
            const consoleError = spyOn(console, 'error').mockImplementation(() => {})
            const onRefresh = mock(async () => {})
            const showNotification = mock()
            const before = useNotificationStore.getState().confirmation
            const handle = sourceCallback<() => void>('components/credentials/VendorSection.tsx', 'handleClearCooldown', {
                apiClient, authFilesApi, authGeneration: apiClient.getAuthGeneration(), authIndex: 'fixture-auth',
                file: {name: 'fixture.json'}, formatAuthFileDisplayName: (value: string) => value,
                showConfirmation: useNotificationStore.getState().showConfirmation,
                showNotification, onRefresh, t: i18n.getFixedT('en'),
            })
            const rendered = {modal: null as ReturnType<typeof ConfirmationModal>}
            const Probe = () => {
                rendered.modal = ConfirmationModal()
                return null
            }
            const render = () => {
                renderToStaticMarkup(React.createElement(Probe))
                if (!rendered.modal) {
                    throw new Error('confirmation was not rendered')
                }
                return rendered.modal
            }
            try {
                handle()
                const modal = render()
                const actions = React.Children.toArray(modal.props.children)[1] as React.ReactElement<{children: React.ReactNode}>
                const confirm = React.Children.toArray(actions.props.children)[1] as React.ReactElement<React.ComponentProps<typeof Button>>
                const work = (confirm.props.onClick as () => Promise<void>)()
                expect(clear).toHaveBeenCalledTimes(1)
                expect(clear).toHaveBeenCalledWith('fixture-auth')
                expect(useNotificationStore.getState().confirmation.isLoading).toBe(true)
                const loading = render()
                expect(loading.props.closeDisabled).toBe(true)
                const html = renderToStaticMarkup(React.createElement(React.Fragment, null, loading.props.children))
                const buttons = [...html.matchAll(/<button\b[^>]*>/g)]
                expect(buttons).toHaveLength(2)
                expect(buttons.every(([tag]) => tag.includes('disabled=""'))).toBe(true)
                expect(html).toContain('loading-spinner')
                if (outcome === 'success') {
                    pending.resolve()
                } else {
                    pending.reject(new Error('fixture cooldown failure'))
                }
                await work
                expect(useNotificationStore.getState().confirmation.isLoading).toBe(false)
                expect(useNotificationStore.getState().confirmation.isOpen).toBe(outcome === 'failure')
                expect(onRefresh).toHaveBeenCalledTimes(outcome === 'success' ? 1 : 0)
                expect(showNotification.mock.calls[0]?.[1]).toBe(outcome === 'success' ? 'success' : 'error')
            } finally {
                pending.resolve()
                clear.mockRestore()
                currentSnapshot.mockRestore()
                consoleError.mockRestore()
                useNotificationStore.setState({confirmation: before})
            }
        })
    }

    test('interpolates local cooldown failure labels in every supported locale', () => {
        for (const locale of ['en', 'ru', 'zh-CN', 'zh-TW']) {
            const t = i18n.getFixedT(locale)
            const message = t('credentials.cooldown_clear_failed', {name: 'fixture.json', message: 'fixture failure'})
            expect(message).toContain('fixture.json')
            expect(message).toContain('fixture failure')
            expect(message).not.toContain('{{')
            expect(message).not.toBe('credentials.cooldown_clear_failed')
        }
    })

    test('propagates transport failures without retrying or consuming reset credits', async () => {
        const error = new Error('local management endpoint unavailable')
        const post = spyOn(apiClient, 'post').mockRejectedValue(error)
        try {
            await expect(authFilesApi.clearLocalCooldown('codex:one')).rejects.toBe(error)
            expect(post).toHaveBeenCalledTimes(1)
            expect(post).toHaveBeenCalledWith('/routing/cooldown/reset', {auth_index: 'codex:one'})
        } finally {
            post.mockRestore()
        }
    })
})
