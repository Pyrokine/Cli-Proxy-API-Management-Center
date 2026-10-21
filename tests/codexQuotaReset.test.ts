import {afterEach, beforeEach, describe, expect, mock, spyOn, test} from 'bun:test'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {CredentialCard} from '@/components/credentials/CredentialCard'
import i18n from '@/i18n'
import {apiClient} from '@/services/api/client'
import {quotaApi} from '@/services/api/quota'
import {useAuthFileRefreshStore} from '@/stores/useAuthFileRefreshStore'
import {authFileStatusRequestKey, useAuthFileStatusStore} from '@/stores/useAuthFileStatusStore'
import {useNotificationStore} from '@/stores/useNotificationStore'
import {areQuotaSubjectsCurrent, captureQuotaRequestClaim, useQuotaStore} from '@/stores/useQuotaStore'
import type {CodexResetCreditCountState, QuotaFreshness} from '@/types'
import {parseCodexResetCreditProbe, runCodexResetCreditAction} from '@/utils/quota/codexResetCredits'
import {quotaCredentialKey} from '@/utils/quota/credentialKey'
import {sourceCallback, sourceInitializer} from './sourceCallbacks'

const key = quotaCredentialKey('codex', 'fixture.json', 'fixture-index')
const originalQuota = useQuotaStore.getState()
const originalRefresh = useAuthFileRefreshStore.getState()
const originalStatus = useAuthFileStatusStore.getState()
const originalConfirmation = useNotificationStore.getState().confirmation
const known = (value: number): CodexResetCreditCountState => ({state: 'known', value, evidence: []})
const t = i18n.getFixedT('en')
const availabilityMessage = sourceCallback<(availability: string, translate: typeof t) => string | null>(
    'components/credentials/VendorSection.tsx', 'codexResetCreditAvailabilityMessage', {},
)
const probeResponse = (count: number | null = 2, data: Record<string, unknown> = {}, availability = count === 0 ? 'none' : 'available') => ({
    purpose: 'codex_reset_credit', auth_index: 'fixture-index', generation: 1,
    checked_at: new Date().toISOString(), availability,
    data: {rate_limit_reset_credits: {...(count === null ? {} : {available_count: count}), applicable_available_count: 0}, ...data},
})
let currentProbe: unknown
let readProbe: () => Promise<unknown>
let submitReset: () => Promise<unknown>
const installTransport = () => spyOn(apiClient, 'post').mockImplementation(async <T>(url: string): Promise<T> => {
    if (url === '/quota/fetch') {
        return await readProbe() as T
    }
    if (url === '/reset-quota') {
        return await submitReset() as T
    }
    throw new Error(`Unexpected request: ${url}`)
})
let post: ReturnType<typeof installTransport>
const reads = () => post.mock.calls.filter(([path]) => path === '/quota/fetch')
const consumes = () => post.mock.calls.filter(([path]) => path === '/reset-quota')

beforeEach(() => {
    currentProbe = probeResponse()
    readProbe = async () => currentProbe
    submitReset = async () => ({status: 'ok', auth_index: 'fixture-index'})
    post = installTransport()
})
afterEach(() => {
    useNotificationStore.setState({confirmation: originalConfirmation})
    useQuotaStore.setState(originalQuota, true)
    useAuthFileRefreshStore.setState(originalRefresh, true)
    useAuthFileStatusStore.setState(originalStatus, true)
    post.mockRestore()
})

const prepare = (
    count: CodexResetCreditCountState | undefined = known(3),
    freshness: QuotaFreshness = 'fresh',
    applicableCount: CodexResetCreditCountState = known(0),
) => {
    useAuthFileRefreshStore.setState({request: null})
    useAuthFileStatusStore.setState({requests: new Map()})
    useQuotaStore.setState({
        cacheGeneration: 0, subjectVersions: {},
        codexQuota: {[key]: {status: 'success', windows: [],
            rateLimitResetCreditsAvailableCount: count, rateLimitResetCreditsApplicableAvailableCount: applicableCount}},
        quotaMetadata: {[key]: {fileName: 'fixture.json', type: 'codex', backendGeneration: 1,
            backendStateRevision: 1, status: 'success', freshness, successfulEmpty: false,
            observedAt: new Date(Date.now() - 86_400_000).toISOString()}},
    })
    const showNotification = mock()
    const refreshNow = mock(async () => {})
    const onRefresh = mock(async () => {})
    const controller = {current: null as AbortController | null}
    const disabled = {current: false}
    const setProbe = mock()
    const scope = {
        apiClient, quotaApi, useQuotaStore, useAuthFileRefreshStore, useAuthFileStatusStore, authFileStatusRequestKey,
        captureQuotaRequestClaim, areQuotaSubjectsCurrent, useNotificationStore, parseCodexResetCreditProbe,
        codexResetCreditAvailabilityMessage: availabilityMessage, runCodexResetCreditAction,
        authGeneration: apiClient.getAuthGeneration(), authIndex: 'fixture-index', quotaKey: key,
        isCodexProvider: true, isPluginQuota: false, file: {name: 'fixture.json', disabled: false},
        quotaResetting: false, setQuotaResetGeneration: mock(), codexResetController: controller,
        resetControlsDisabledRef: disabled, pluginQuotaIdentity: 'fixture-identity',
        pluginQuotaIdentityRef: {current: 'fixture-identity'}, setCodexResetProbe: setProbe,
        formatAuthFileDisplayName: (name: string) => name, showNotification,
        showConfirmation: useNotificationStore.getState().showConfirmation,
        scheduler: {refreshNow}, onRefresh, t,
    }
    const handle = sourceCallback<() => Promise<void>>('components/credentials/VendorSection.tsx', 'handleResetQuota', scope)
    return {handle, showNotification, refreshNow, onRefresh, controller, disabled, setProbe, scope}
}

function deferred<T>() {
    let resolve!: (value: T) => void
    const promise = new Promise<T>((done) => { resolve = done })
    return {promise, resolve}
}

const confirmation = () => {
    expect(useNotificationStore.getState().confirmation.isOpen).toBe(true)
    return useNotificationStore.getState().confirmation.options!
}

describe('explicit Codex quota reset', () => {
    test('sends one exact identity and rejects a mismatched result without retrying', async () => {
        await expect(quotaApi.reset(' fixture-index ')).resolves.toBeUndefined()
        expect(consumes()[0]).toEqual(['/reset-quota', {auth_index: 'fixture-index'}, {signal: undefined}])
        submitReset = async () => ({status: 'ok', auth_index: 'other-index'})
        await expect(quotaApi.reset('fixture-index')).rejects.toThrow(i18n.t('auth_files.quota_reset_invalid_response'))
        expect(consumes()).toHaveLength(2)
    })

    test('rejects an empty identity before making a request', async () => {
        await expect(quotaApi.reset(' ')).rejects.toThrow(i18n.t('auth_files.quota_reset_manual_missing_auth_index'))
        expect(post).not.toHaveBeenCalled()
    })

    test('queries current reset credits before offering a cached-credit confirmation', async () => {
        const fixture = prepare(known(1))
        await fixture.handle()
        confirmation()
        expect(reads()).toHaveLength(1)
        expect(reads()[0]?.[1]).toEqual({auth_index: 'fixture-index', provider: 'codex', purpose: 'codex_reset_credit'})
        expect(consumes()).toHaveLength(0)
        expect(fixture.setProbe.mock.calls[0]?.[0].probe.availableCount).toMatchObject({state: 'known', value: 2})
        expect(useQuotaStore.getState().codexQuota[key]?.rateLimitResetCreditsAvailableCount).toEqual(known(1))
    })

    for (const count of [known(0), {state: 'missing', sources: []}, {state: 'invalid', sources: []},
        {state: 'conflict', evidence: []}] satisfies CodexResetCreditCountState[]) {
        test(`checks the provider rather than permanently rejecting a cached ${count.state} count`, async () => {
            const fixture = prepare(count)
            await fixture.handle()
            confirmation()
            expect(reads()).toHaveLength(1)
            expect(consumes()).toHaveLength(0)
        })
    }

    for (const freshness of ['fresh', 'stale', 'partial', 'outdated'] as const) {
        test(`uses a new check instead of yesterday's ${freshness} snapshot`, async () => {
            const fixture = prepare(known(1), freshness)
            await fixture.handle()
            confirmation()
            expect(reads()).toHaveLength(1)
            expect(consumes()).toHaveLength(0)
            expect(useQuotaStore.getState().quotaMetadata[key]?.freshness).toBe(freshness)
        })
    }

    for (const [name, payload] of [
        ['zero', probeResponse(0)],
        ['missing', probeResponse(null, {}, 'missing')],
        ['invalid', probeResponse(null, {rate_limit_reset_credits: {available_count: -1}}, 'invalid')],
        ['conflict', probeResponse(1, {rate_limit_reset_credits_details: {available_count: 2}}, 'conflict')],
        ['expired', probeResponse(1, {rate_limit_reset_credits_details: {available_count: 1, credits: [
            {id: 'expired', reset_type: 'codex_rate_limits', status: 'available', expires_at: '2000-01-01T00:00:00Z'},
        ]}}, 'conflict')],
        ['consumed', probeResponse(1, {rate_limit_reset_credits_details: {available_count: 1, credits: [
            {id: 'used', reset_type: 'codex_rate_limits', status: 'consumed'},
        ]}}, 'conflict')],
        ['legacy capability', {groups: [], summary: []}],
        ['wrong identity', {...probeResponse(), auth_index: 'other-index'}],
        ['wrong generation', {...probeResponse(), generation: 0}],
        ['inconsistent result', {...probeResponse(0), availability: 'available'}],
    ] as const) {
        test(`blocks confirmation when the current check returns ${name}`, async () => {
            const fixture = prepare(known(1))
            currentProbe = payload
            await fixture.handle()
            expect(useNotificationStore.getState().confirmation.isOpen).toBe(false)
            expect(fixture.showNotification).toHaveBeenCalledTimes(1)
            expect(fixture.controller.current).toBeNull()
            expect(consumes()).toHaveLength(0)
        })
    }

    test('retains a subscription error without denying independently checked reset credits', async () => {
        const fixture = prepare(known(1), 'partial')
        useQuotaStore.setState((state) => ({codexQuota: {...state.codexQuota,
            [key]: {...state.codexQuota[key]!, subscriptionError: 'codex subscription returned status 403'}}}))
        await fixture.handle()
        await confirmation().onConfirm()
        expect(reads()).toHaveLength(2)
        expect(consumes()).toHaveLength(1)
        expect(useQuotaStore.getState().codexQuota[key]?.subscriptionError).toContain('403')
    })

    for (const count of [1, 2, 4]) {
        test(`confirms ${count} owned credits with zero applicable credits and submits exactly once`, async () => {
            currentProbe = probeResponse(count)
            const fixture = prepare(known(count))
            await fixture.handle()
            const options = confirmation()
            expect(options.message).toContain('one available reset credit')
            expect(consumes()).toHaveLength(0)
            await options.onConfirm()
            expect(reads()).toHaveLength(2)
            expect(consumes()).toHaveLength(1)
            expect(consumes()[0]?.[1]).toEqual({auth_index: 'fixture-index'})
            expect(fixture.refreshNow).toHaveBeenCalledWith(key)
            expect(fixture.onRefresh).toHaveBeenCalledTimes(1)
            expect(useQuotaStore.getState().codexQuota[key]?.rateLimitResetCreditsAvailableCount).toBeUndefined()
            await expect(options.onConfirm()).rejects.toThrow()
            expect(consumes()).toHaveLength(1)
        })
    }

    test('cancels confirmation without consuming or clearing the displayed count', async () => {
        const fixture = prepare(known(1))
        await fixture.handle()
        const options = confirmation()
        options.onCancel?.()
        useNotificationStore.getState().hideConfirmation()
        await expect(options.onConfirm()).rejects.toThrow()
        expect(consumes()).toHaveLength(0)
        expect(useQuotaStore.getState().codexQuota[key]?.rateLimitResetCreditsAvailableCount).toEqual(known(1))
        expect(fixture.controller.current).toBeNull()
    })

    for (const [name, response] of [['spent', probeResponse(0)], ['expired', probeResponse(1, {
        rate_limit_reset_credits_details: {available_count: 1, credits: [
            {id: 'expired', reset_type: 'codex_rate_limits', status: 'available', expires_at: '2000-01-01T00:00:00Z'},
        ]},
    }, 'conflict')]] as const) {
        test(`rechecks before submitting when credits become ${name} while confirmation is open`, async () => {
            const fixture = prepare(known(1))
            await fixture.handle()
            const options = confirmation()
            currentProbe = response
            await expect(options.onConfirm()).rejects.toThrow()
            expect(reads()).toHaveLength(2)
            expect(consumes()).toHaveLength(0)
            expect(useQuotaStore.getState().codexQuota[key]?.rateLimitResetCreditsAvailableCount).toEqual(known(1))
        })
    }

    test('does not use quota freshness as a substitute for the second current check', async () => {
        const fixture = prepare(known(1))
        await fixture.handle()
        useQuotaStore.setState((state) => ({quotaMetadata: {...state.quotaMetadata,
            [key]: {...state.quotaMetadata[key]!, freshness: 'stale'}}}))
        await confirmation().onConfirm()
        expect(reads()).toHaveLength(2)
        expect(consumes()).toHaveLength(1)
    })

    test('ignores a late first check after cancellation or unmount', async () => {
        const pending = deferred<unknown>()
        readProbe = () => pending.promise
        const fixture = prepare()
        const action = fixture.handle()
        fixture.controller.current?.abort()
        pending.resolve(probeResponse())
        await action
        expect(useNotificationStore.getState().confirmation.isOpen).toBe(false)
        expect(fixture.showNotification).not.toHaveBeenCalled()
        expect(consumes()).toHaveLength(0)
        expect(fixture.controller.current).toBeNull()
    })

    test('does not replace a newer confirmation when the first check arrives late', async () => {
        const pending = deferred<unknown>()
        readProbe = () => pending.promise
        const fixture = prepare()
        const action = fixture.handle()
        const other = {message: 'newer confirmation', onConfirm: mock()}
        useNotificationStore.getState().showConfirmation(other)
        pending.resolve(probeResponse())
        await action
        expect(confirmation()).toBe(other)
        expect(fixture.setProbe).not.toHaveBeenCalled()
        expect(consumes()).toHaveLength(0)
    })

    test('invalidates counts only after the exact consuming request is confirmed', async () => {
        const accepted = deferred<unknown>()
        const entered = deferred<void>()
        submitReset = async () => {
            entered.resolve()
            return accepted.promise
        }
        const fixture = prepare(known(2))
        await fixture.handle()
        const action = confirmation().onConfirm()
        await entered.promise
        expect(useQuotaStore.getState().codexQuota[key]?.rateLimitResetCreditsAvailableCount).toEqual(known(2))
        accepted.resolve({status: 'ok', auth_index: 'fixture-index'})
        await action
        expect(useQuotaStore.getState().codexQuota[key]?.rateLimitResetCreditsAvailableCount).toBeUndefined()
        expect(consumes()).toHaveLength(1)
    })

    test('a completed reset does not let a delayed refresh close another confirmation', async () => {
        const refreshed = deferred<void>()
        const entered = deferred<void>()
        const fixture = prepare()
        fixture.refreshNow.mockImplementation(async () => {
            entered.resolve()
            await refreshed.promise
        })
        await fixture.handle()
        const action = confirmation().onConfirm()
        await entered.promise
        const other = {message: 'another action after reset', onConfirm: mock()}
        useNotificationStore.getState().showConfirmation(other)
        refreshed.resolve()
        await expect(action).rejects.toThrow()
        expect(confirmation()).toBe(other)
        expect(consumes()).toHaveLength(1)
        expect(fixture.onRefresh).not.toHaveBeenCalled()
    })

    test('blocks duplicate clicks while a read-only check is pending', async () => {
        const pending = deferred<unknown>()
        readProbe = () => pending.promise
        const fixture = prepare()
        const first = fixture.handle()
        await fixture.handle()
        expect(reads()).toHaveLength(1)
        pending.resolve(probeResponse())
        await first
        confirmation()
        expect(consumes()).toHaveLength(0)
    })

    test('blocks concurrent confirmation callbacks during the second check', async () => {
        const fixture = prepare()
        await fixture.handle()
        const options = confirmation()
        const pending = deferred<unknown>()
        readProbe = () => pending.promise
        const first = options.onConfirm()
        await expect(options.onConfirm()).rejects.toThrow()
        pending.resolve(probeResponse())
        await first
        expect(consumes()).toHaveLength(1)
    })

    for (const change of ['credential', 'backend generation', 'connection', 'identity', 'disabled', 'token refresh', 'status change'] as const) {
        test(`rejects ${change} changes while confirmation is open`, async () => {
            const fixture = prepare()
            await fixture.handle()
            const options = confirmation()
            let generation: ReturnType<typeof spyOn> | undefined
            try {
                if (change === 'credential') {
                    useQuotaStore.getState().clearQuotaSubjects([key])
                } else if (change === 'backend generation') {
                    useQuotaStore.setState({subjectVersions: {[key]: {localGeneration: 0, backendGeneration: 2, backendStateRevision: 1, minimumBackendGeneration: 0, tombstone: false}}})
                } else if (change === 'connection') {
                    generation = spyOn(apiClient, 'getAuthGeneration').mockReturnValue(apiClient.getAuthGeneration() + 1)
                } else if (change === 'identity') {
                    fixture.scope.pluginQuotaIdentityRef.current = 'replacement'
                } else if (change === 'disabled') {
                    fixture.disabled.current = true
                } else if (change === 'token refresh') {
                    useAuthFileRefreshStore.setState({request: {generation: apiClient.getAuthGeneration()} as never})
                } else {
                    useAuthFileStatusStore.setState({requests: new Map([[authFileStatusRequestKey(apiClient.getAuthGeneration(), 'fixture.json', 'fixture-index'), {generation: apiClient.getAuthGeneration(), name: 'fixture.json', authIndex: 'fixture-index'}]])})
                }
                await expect(options.onConfirm()).rejects.toThrow()
                expect(consumes()).toHaveLength(0)
            } finally {
                generation?.mockRestore()
            }
        })
    }

    test('rejects a different native generation returned by the second query', async () => {
        const fixture = prepare()
        await fixture.handle()
        const options = confirmation()
        currentProbe = {...probeResponse(), generation: 2}
        await expect(options.onConfirm()).rejects.toThrow()
        expect(consumes()).toHaveLength(0)
    })

    test('keeps another confirmation when a delayed check completes', async () => {
        const fixture = prepare()
        await fixture.handle()
        const previous = confirmation()
        const pending = deferred<unknown>()
        readProbe = () => pending.promise
        const action = previous.onConfirm()
        const other = {message: 'other operation', onConfirm: mock()}
        useNotificationStore.getState().showConfirmation(other)
        pending.resolve(probeResponse())
        await expect(action).rejects.toThrow()
        expect(confirmation()).toBe(other)
        expect(consumes()).toHaveLength(0)
    })

    test('a failed first check releases the action without authorizing consumption', async () => {
        const fixture = prepare()
        readProbe = async () => { throw new Error('fixture timeout') }
        await fixture.handle()
        expect(fixture.controller.current).toBeNull()
        expect(consumes()).toHaveLength(0)
        expect(fixture.showNotification.mock.calls[0]?.[0]).toContain('No reset was submitted')
        readProbe = async () => probeResponse()
        await fixture.handle()
        confirmation()
    })

    test('does not consume again when the post-reset quota refresh fails', async () => {
        const fixture = prepare()
        fixture.refreshNow.mockRejectedValue(new Error('fixture usage read failure'))
        await fixture.handle()
        await expect(confirmation().onConfirm()).resolves.toBeUndefined()
        expect(consumes()).toHaveLength(1)
        expect(fixture.showNotification.mock.calls.map((call) => call[1])).toEqual(['success', 'warning'])
        expect(fixture.onRefresh).not.toHaveBeenCalled()
    })

    test('disables an uncertain submission without clearing the count or replaying it', async () => {
        const error = new Error('fixture request timeout')
        submitReset = async () => { throw error }
        const fixture = prepare()
        await fixture.handle()
        const options = confirmation()
        await expect(options.onConfirm()).rejects.toBe(error)
        expect(confirmation().confirmDisabled).toBe(true)
        expect(fixture.showNotification.mock.calls[0]?.[1]).toBe('error')
        expect(fixture.refreshNow).not.toHaveBeenCalled()
        expect(useQuotaStore.getState().codexQuota[key]?.rateLimitResetCreditsAvailableCount).toEqual(known(3))
        await expect(options.onConfirm()).rejects.toThrow()
        expect(consumes()).toHaveLength(1)
    })

    test('renders a read-only check action without a token-renewal button', () => {
        const state = sourceInitializer<{isResetting: boolean; onReset: () => void; disabled: boolean; title: string}>(
            'components/credentials/VendorSection.tsx', 'quotaResetState', {
                quotaResetting: false, handleResetQuota: mock(), authIndex: 'fixture-index', file: {disabled: false},
                tokenRefreshBusy: false, statusChanging: false, t,
            },
        )
        const html = renderToStaticMarkup(createElement(CredentialCard, {
            category: 'auth-file', title: 'fixture.json', controlLabel: 'Codex fixture-index', quotaResetState: state,
        }))
        expect(html).toContain(i18n.t('auth_files.quota_reset_codex_title'))
        expect(html).toContain(t('auth_files.quota_reset_codex_hint'))
        expect(html).not.toContain(t('credentials.manual_token_refresh'))
    })
})
