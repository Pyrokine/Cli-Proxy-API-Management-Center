import {afterEach, describe, expect, mock, spyOn, test} from 'bun:test'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {CredentialCard} from '@/components/credentials/CredentialCard'
import i18n from '@/i18n'
import {apiClient} from '@/services/api/client'
import {quotaApi} from '@/services/api/quota'
import {useAuthFileRefreshStore} from '@/stores/useAuthFileRefreshStore'
import {useNotificationStore} from '@/stores/useNotificationStore'
import {areQuotaSubjectsCurrent, captureQuotaRequestClaim, useQuotaStore} from '@/stores/useQuotaStore'
import type {CodexResetCreditCountState, QuotaFreshness} from '@/types'
import {codexResetCreditAvailability, runCodexResetCreditAction} from '@/utils/quota/codexResetCredits'
import {quotaCredentialKey} from '@/utils/quota/credentialKey'
import {sourceCallback, sourceInitializer} from './sourceCallbacks'

const key = quotaCredentialKey('codex', 'fixture.json', 'fixture-index')
const originalQuota = useQuotaStore.getState()
const originalRefresh = useAuthFileRefreshStore.getState()
const originalConfirmation = useNotificationStore.getState().confirmation
const known = (value: number): CodexResetCreditCountState => ({state: 'known', value, evidence: []})
const t = i18n.getFixedT('en')
const availabilityMessage = sourceCallback<(availability: string, translate: typeof t) => string | null>(
    'components/credentials/VendorSection.tsx', 'codexResetCreditAvailabilityMessage', {},
)

afterEach(() => {
    useQuotaStore.setState(originalQuota, true)
    useAuthFileRefreshStore.setState(originalRefresh, true)
    useNotificationStore.setState({confirmation: originalConfirmation})
})

const prepare = (
    count: CodexResetCreditCountState | undefined = known(3),
    freshness: QuotaFreshness = 'fresh',
    applicableCount: CodexResetCreditCountState = known(0),
) => {
    useAuthFileRefreshStore.setState({request: null})
    useQuotaStore.setState({
        cacheGeneration: 0, subjectVersions: {},
        codexQuota: {[key]: {status: 'success', windows: [],
            rateLimitResetCreditsAvailableCount: count, rateLimitResetCreditsApplicableAvailableCount: applicableCount}},
        quotaMetadata: {[key]: {fileName: 'fixture.json', type: 'codex', backendGeneration: 1,
            backendStateRevision: 1, status: 'success', freshness, successfulEmpty: false}},
    })
    const showNotification = mock()
    const refreshNow = mock(async () => {})
    const onRefresh = mock(async () => {})
    const handle = sourceCallback<() => void>('components/credentials/VendorSection.tsx', 'handleResetQuota', {
        apiClient, quotaApi, useQuotaStore, useAuthFileRefreshStore, captureQuotaRequestClaim, areQuotaSubjectsCurrent,
        codexResetCreditAvailability, codexResetCreditAvailabilityMessage: availabilityMessage, runCodexResetCreditAction,
        authGeneration: apiClient.getAuthGeneration(), authIndex: 'fixture-index', quotaKey: key,
        isCodexProvider: true, isPluginQuota: false, disableControls: false, file: {name: 'fixture.json', disabled: false},
        tokenRefreshBusy: false, quotaResetting: false, setQuotaResetGeneration: mock(),
        formatAuthFileDisplayName: (name: string) => name, showNotification,
        showConfirmation: useNotificationStore.getState().showConfirmation,
        scheduler: {refreshNow}, onRefresh, t,
    })
    return {handle, showNotification, refreshNow, onRefresh}
}

describe('explicit Codex quota reset', () => {
    test('sends one exact identity and rejects a mismatched success response without retrying', async () => {
        const post = spyOn(apiClient, 'post').mockResolvedValueOnce({status: 'ok', auth_index: 'fixture-index'})
            .mockResolvedValueOnce({status: 'ok', auth_index: 'other-index'})
        try {
            await expect(quotaApi.reset(' fixture-index ')).resolves.toBeUndefined()
            expect(post).toHaveBeenNthCalledWith(1, '/reset-quota', {auth_index: 'fixture-index'})
            await expect(quotaApi.reset('fixture-index')).rejects.toThrow(i18n.t('auth_files.quota_reset_invalid_response'))
            expect(post).toHaveBeenCalledTimes(2)
        } finally {
            post.mockRestore()
        }
    })

    test('rejects an empty identity before making a request', async () => {
        const post = spyOn(apiClient, 'post').mockResolvedValue({status: 'ok'})
        try {
            await expect(quotaApi.reset(' ')).rejects.toThrow(i18n.t('auth_files.quota_reset_manual_missing_auth_index'))
            expect(post).not.toHaveBeenCalled()
        } finally {
            post.mockRestore()
        }
    })

    const unavailableCounts: CodexResetCreditCountState[] = [
        {state: 'missing', sources: []}, known(0), {state: 'invalid', sources: []}, {state: 'conflict', evidence: []},
    ]
    for (const count of unavailableCounts) {
        test(`does not offer reset with ${count?.state ?? 'missing'} account credits`, () => {
            const reset = spyOn(quotaApi, 'reset').mockResolvedValue(undefined)
            try {
                const fixture = prepare(count, 'fresh', known(2))
                fixture.handle()
                expect(useNotificationStore.getState().confirmation).toEqual(originalConfirmation)
                expect(fixture.showNotification).toHaveBeenCalledTimes(1)
                expect(reset).not.toHaveBeenCalled()
            } finally {
                reset.mockRestore()
            }
        })
    }

    for (const freshness of ['stale', 'partial', 'outdated'] as const) {
        test(`does not consume credits from a ${freshness} quota snapshot`, () => {
            const fixture = prepare(known(3), freshness)
            fixture.handle()
            expect(useNotificationStore.getState().confirmation).toEqual(originalConfirmation)
            expect(fixture.showNotification).toHaveBeenCalledTimes(1)
        })
    }

    test('cancels an owned-credit reset without sending a request or changing the count', () => {
        const reset = spyOn(quotaApi, 'reset').mockResolvedValue(undefined)
        try {
            const fixture = prepare(known(1), 'fresh', known(0))
            fixture.handle()
            expect(useNotificationStore.getState().confirmation.isOpen).toBe(true)
            useNotificationStore.getState().hideConfirmation()
            expect(useNotificationStore.getState().confirmation.isOpen).toBe(false)
            expect(useQuotaStore.getState().codexQuota[key]?.rateLimitResetCreditsAvailableCount).toMatchObject({
                state: 'known', value: 1,
            })
            expect(reset).not.toHaveBeenCalled()
        } finally {
            reset.mockRestore()
        }
    })

    test('requires confirmation for owned credits with zero applicable credits and refreshes only after success', async () => {
        const reset = spyOn(quotaApi, 'reset').mockResolvedValue(undefined)
        try {
            const fixture = prepare()
            fixture.handle()
            const confirmation = useNotificationStore.getState().confirmation.options!
            expect(reset).not.toHaveBeenCalled()
            expect(confirmation.message).toContain('one available reset credit')
            expect(confirmation.message).toContain('fixture.json')
            await confirmation.onConfirm()
            expect(reset).toHaveBeenCalledTimes(1)
            expect(reset).toHaveBeenCalledWith('fixture-index')
            expect(useQuotaStore.getState().codexQuota[key]?.rateLimitResetCreditsAvailableCount).toBeUndefined()
            expect(useQuotaStore.getState().codexQuota[key]?.rateLimitResetCreditsApplicableAvailableCount).toBeUndefined()
            expect(fixture.refreshNow).toHaveBeenCalledWith(key)
            expect(fixture.onRefresh).toHaveBeenCalledTimes(1)
            await expect(confirmation.onConfirm()).rejects.toThrow()
            expect(reset).toHaveBeenCalledTimes(1)
        } finally {
            reset.mockRestore()
        }
    })

    test('rechecks the owned count after confirmation opens even when applicable credits stay positive', async () => {
        const reset = spyOn(quotaApi, 'reset').mockResolvedValue(undefined)
        try {
            const fixture = prepare(known(1), 'fresh', known(0))
            fixture.handle()
            const confirmation = useNotificationStore.getState().confirmation.options!
            useQuotaStore.setState((state) => ({codexQuota: {
                ...state.codexQuota,
                [key]: {...state.codexQuota[key]!,
                    rateLimitResetCreditsAvailableCount: known(0),
                    rateLimitResetCreditsApplicableAvailableCount: known(2)},
            }}))
            await expect(confirmation.onConfirm()).rejects.toThrow()
            expect(reset).not.toHaveBeenCalled()
        } finally {
            reset.mockRestore()
        }
    })

    test('rechecks freshness after confirmation opens', async () => {
        const reset = spyOn(quotaApi, 'reset').mockResolvedValue(undefined)
        try {
            const fixture = prepare(known(1))
            fixture.handle()
            const confirmation = useNotificationStore.getState().confirmation.options!
            useQuotaStore.setState((state) => ({quotaMetadata: {
                ...state.quotaMetadata, [key]: {...state.quotaMetadata[key]!, freshness: 'stale'},
            }}))
            await expect(confirmation.onConfirm()).rejects.toThrow()
            expect(reset).not.toHaveBeenCalled()
        } finally {
            reset.mockRestore()
        }
    })

    test('rejects a changed credential or connection between opening and confirming', async () => {
        const reset = spyOn(quotaApi, 'reset').mockResolvedValue(undefined)
        try {
            const fixture = prepare()
            fixture.handle()
            useQuotaStore.getState().clearQuotaSubjects([key])
            await expect(useNotificationStore.getState().confirmation.options!.onConfirm()).rejects.toThrow()
            expect(reset).not.toHaveBeenCalled()
            const current = prepare()
            current.handle()
            const generation = spyOn(apiClient, 'getAuthGeneration').mockReturnValue(apiClient.getAuthGeneration() + 1)
            try {
                await expect(useNotificationStore.getState().confirmation.options!.onConfirm()).rejects.toThrow()
                expect(reset).not.toHaveBeenCalled()
            } finally {
                generation.mockRestore()
            }
        } finally {
            reset.mockRestore()
        }
    })

    test('does not consume again when the post-reset quota refresh fails', async () => {
        const reset = spyOn(quotaApi, 'reset').mockResolvedValue(undefined)
        try {
            const fixture = prepare()
            fixture.refreshNow.mockRejectedValue(new Error('fixture usage read failure'))
            fixture.handle()
            await expect(useNotificationStore.getState().confirmation.options!.onConfirm()).resolves.toBeUndefined()
            expect(reset).toHaveBeenCalledTimes(1)
            expect(fixture.showNotification.mock.calls.map((call) => call[1])).toEqual(['success', 'warning'])
            expect(fixture.onRefresh).not.toHaveBeenCalled()
        } finally {
            reset.mockRestore()
        }
    })

    test('invalidates the displayed count after an uncertain request result', async () => {
        const error = new Error('fixture request timeout')
        const reset = spyOn(quotaApi, 'reset').mockRejectedValue(error)
        try {
            const fixture = prepare()
            fixture.handle()
            const confirmation = useNotificationStore.getState().confirmation.options!
            await expect(confirmation.onConfirm()).rejects.toBe(error)
            expect(fixture.showNotification.mock.calls[0]?.[1]).toBe('error')
            expect(fixture.refreshNow).not.toHaveBeenCalled()
            await expect(confirmation.onConfirm()).rejects.toThrow()
            expect(reset).toHaveBeenCalledTimes(1)
        } finally {
            reset.mockRestore()
        }
    })

    test('renders a named reset action with no token-renewal button', () => {
        const state = sourceInitializer<{isResetting: boolean; onReset: () => void; disabled: boolean; title: string}>(
            'components/credentials/VendorSection.tsx', 'quotaResetState', {
                quotaResetting: false, handleResetQuota: mock(), authIndex: 'fixture-index', file: {disabled: false},
                tokenRefreshBusy: false, resetAvailability: 'available', codexResetCreditAvailabilityMessage: availabilityMessage, t,
            },
        )
        const html = renderToStaticMarkup(createElement(CredentialCard, {
            category: 'auth-file', title: 'fixture.json', controlLabel: 'Codex fixture-index', quotaResetState: state,
        }))
        expect(html).toContain(t('auth_files.quota_reset_codex_title'))
        expect(html).not.toContain('reset-credits-applicable')
        expect(html).not.toContain(t('credentials.manual_token_refresh'))
    })
})
