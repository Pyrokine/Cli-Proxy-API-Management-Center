import {afterEach, beforeEach, describe, expect, mock, spyOn, test} from 'bun:test'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {CredentialCard} from '@/components/credentials/CredentialCard'
import i18n from '@/i18n'
import {parsePluginQuota, type PluginQuotaResult, type PluginQuotaView} from '@/components/credentials/pluginQuota'
import {groupVendorAuthFiles} from '@/components/credentials/hooks/useCredentialsData'
import type {VendorDefinition} from '@/components/credentials/hooks/useVendorRegistry'
import {apiClient} from '@/services/api/client'
import {normalizeAuthFilesResponse} from '@/services/api/authFiles'
import {quotaApi} from '@/services/api/quota'
import {areQuotaSubjectsCurrent, captureQuotaRequestClaim, commitQuotaSnapshot, useQuotaStore} from '@/stores/useQuotaStore'
import type {AuthFileItem} from '@/types/authFile'
import {quotaCredentialKey} from '@/utils/quota/credentialKey'
import {sourceCallback, sourceInitializer} from './sourceCallbacks'

const cardSource = 'components/credentials/VendorSection.tsx'
const pluginFile: AuthFileItem = {
    name: 'custom.json', type: 'custom', supportsQuota: true, quotaProvider: 'custom', authIndex: '7', disabled: false,
}
const quotaPayload = {
    subscription: {tierName: 'Pro'},
    summary: [{key: 'balance', label: 'Balance', value: 1234.5}],
    groups: [{displayName: 'Credits', buckets: [{window: 'monthly', remainingFraction: 0.8}]}],
}
type CurrentPluginQuota = (PluginQuotaResult & {data?: PluginQuotaView}) | null

function pluginQuotaHarness() {
    let connectionGeneration = 3
    spyOn(apiClient, 'getAuthGeneration').mockImplementation(() => connectionGeneration)
    const fetch = spyOn(quotaApi, 'fetchCredential').mockResolvedValue(quotaPayload)
    const store = Object.assign((selector: (state: ReturnType<typeof useQuotaStore.getState>) => unknown) =>
        selector(useQuotaStore.getState()), {getState: useQuotaStore.getState, setState: useQuotaStore.setState})
    return {
        fetch,
        changeConnection: () => { ++connectionGeneration },
        mount: (initialFile = pluginFile) => {
            let file = initialFile
            let pluginQuota: PluginQuotaResult | null = null
            let language = 'en'
            const pluginQuotaController = {current: null as AbortController | null}
            const pluginQuotaIdentityRef = {current: ''}
            const scope = (): Record<string, unknown> => {
                const quotaKey = quotaCredentialKey(String(file.type), file.name, file.authIndex)
                const values: Record<string, unknown> = {
                    file, quotaKey, pluginQuota, pluginQuotaController, pluginQuotaIdentityRef,
                    authIndex: String(file.authIndex ?? '').trim(), authGeneration: apiClient.getAuthGeneration(),
                    apiClient, useQuotaStore: store, captureQuotaRequestClaim, areQuotaSubjectsCurrent,
                    parsePluginQuota, i18n: {language}, t: (key: string) => key,
                    setPluginQuota: (value: PluginQuotaResult | null) => { pluginQuota = value },
                }
                values.cachedPluginQuota = sourceInitializer(cardSource, 'cachedPluginQuota', values)
                values.pluginQuotaGeneration = sourceInitializer(cardSource, 'pluginQuotaGeneration', values)
                values.pluginQuotaIdentity = sourceInitializer(cardSource, 'pluginQuotaIdentity', values)
                pluginQuotaIdentityRef.current = String(values.pluginQuotaIdentity)
                values.currentPluginQuota = sourceCallback<() => CurrentPluginQuota>(cardSource, 'currentPluginQuota', values)()
                return values
            }
            const cleanup = sourceCallback<() => () => void>(cardSource, 'useEffect', {pluginQuotaController}, 1)()
            return {
                view: () => scope().currentPluginQuota as CurrentPluginQuota,
                refresh: () => sourceCallback<() => Promise<void>>(cardSource, 'handlePluginQuotaRefresh', {
                    ...scope(), quotaApi,
                })(),
                unmount: cleanup,
                changeLanguage: (next: string) => { language = next },
                changeFile: (next: AuthFileItem) => { file = next; cleanup(); scope() },
                markup: () => {
                    const values = scope()
                    const current = values.currentPluginQuota as CurrentPluginQuota
                    return renderToStaticMarkup(createElement(CredentialCard, {
                        category: 'auth-file', title: file.name, controlLabel: 'custom 7',
                        quotaItems: current?.data?.items,
                        quotaSummary: sourceInitializer<Parameters<typeof CredentialCard>[0]['quotaSummary']>(cardSource, 'pluginQuotaSummary', values),
                        refreshState: sourceInitializer<Parameters<typeof CredentialCard>[0]['refreshState']>(cardSource, 'pluginRefreshState', {
                            ...values, handlePluginQuotaRefresh: () => undefined,
                        }),
                        quotaError: current?.error,
                        quotaFreshness: current?.error && current.data ? 'stale' : undefined,
                    }))
                },
            }
        },
    }
}

describe('generic plugin quota', () => {
    test('shows unrecognized plugin credentials in the other group without duplicating known providers', () => {
        const vendor = (id: string, authFileTypes: string[]): VendorDefinition => ({
            id, label: id, labelKey: id, icon: () => null, authFileTypes, oauthProviders: [],
            supportsFileUpload: false, supportsJsonImport: false, supportsCookieAuth: false,
        })
        const grouped = groupVendorAuthFiles([vendor('codex', ['codex']), vendor('other', [])], [
            {name: 'codex.json', type: 'codex', supportsQuota: true},
            {name: 'custom.json', type: 'custom', supportsQuota: true},
            {name: 'unknown.json', type: 'unknown'},
        ])
        expect(grouped.get('codex')?.map((file) => file.name)).toEqual(['codex.json'])
        expect(grouped.get('other')?.map((file) => file.name)).toEqual(['custom.json', 'unknown.json'])
    })

    test('normalizes advertised capability without exposing probe configuration', () => {
        const [plugin, probe, plain] = normalizeAuthFilesResponse({files: [
            {name: 'plugin.json', type: 'custom', supports_quota: true, quota_provider: 'custom', auth_index: '7'},
            {name: 'probe.json', type: 'other', supports_quota: true, auth_index: '8'},
            {name: 'plain.json', type: 'other', auth_index: '9'},
        ]}).files
        expect(plugin.supportsQuota).toBe(true)
        expect(plugin.quotaProvider).toBe('custom')
        expect(probe.supportsQuota).toBe(true)
        expect(probe.quotaProvider).toBeUndefined()
        expect(plain.supportsQuota).toBe(false)
    })

    test('sends only a user-requested credential fetch and never a reset', async () => {
        const post = spyOn(apiClient, 'post').mockResolvedValue({subscription: {plan: 'Pro'}})
        try {
            const payload = await quotaApi.fetchCredential('7', 'custom')
            expect(post).toHaveBeenCalledTimes(1)
            expect(post.mock.calls[0]?.[0]).toBe('/quota/fetch')
            expect(post.mock.calls[0]?.[1]).toEqual({auth_index: '7', provider: 'custom'})
            expect(parsePluginQuota(payload, 'en').plan).toBe('Pro')
            await quotaApi.fetchCredential('8')
            expect(post.mock.calls[1]?.[1]).toEqual({auth_index: '8'})
        } finally {
            post.mockRestore()
        }
    })

    test('renders plan, finite summary metrics, distinct buckets and escaped labels', () => {
        const result = parsePluginQuota({
            subscription: {tierName: 'Pro'},
            summary: [
                {key: 'balance', label: '<script>unsafe</script>', value: 42, format: 'currency', currency: 'USD'},
                {key: 'used', label: 'Used', value: 0},
            ],
            groups: [{displayName: 'Credits', buckets: [
                {window: 'monthly', description: 'Base', remainingFraction: 0.8},
                {window: 'monthly', description: 'Bonus', remainingFraction: 0},
            ]}],
        }, 'en')
        expect(result.plan).toBe('Pro')
        expect(result.summary.map((item) => item.value)).toEqual(['$42.00', '0'])
        expect(result.items.map((item) => [item.id, item.model, item.percent])).toEqual([
            ['plugin-0-0', 'Credits · Base', 80],
            ['plugin-0-1', 'Credits · Bonus', 0],
        ])
        const markup = renderToStaticMarkup(createElement(CredentialCard, {
            category: 'auth-file', title: 'plugin.json', controlLabel: 'custom 7',
            quotaItems: result.items,
            quotaSummary: [{id: 'plugin-plan', label: 'Plan', value: result.plan ?? ''}, ...result.summary],
        }))
        expect(markup).toContain('&lt;script&gt;unsafe&lt;/script&gt;')
        expect(markup).not.toContain('<script>unsafe</script>')
        expect(markup).toContain('Credits · Base')
        expect(markup).toContain('Credits · Bonus')
    })

    test('does not claim an empty quota when the plugin supplies only a plan', () => {
        const plan = parsePluginQuota({subscription: {tierName: 'Team'}, groups: [{displayName: 'Limits'}]}, 'en')
        const markup = renderToStaticMarkup(createElement(CredentialCard, {
            category: 'auth-file', title: 'custom.json', controlLabel: 'custom 7',
            quotaItems: plan.items,
            quotaSummary: [{id: 'plugin-plan', label: 'Plan', value: plan.plan ?? ''}],
            refreshState: {lastRefreshTime: new Date('2026-10-10T00:00:00Z'), nextRefreshTime: null,
                isRefreshing: false, autoRefreshEnabled: false, status: 'success', onRefresh: () => undefined},
        }))
        expect(markup).toContain('Team')
        expect(markup).not.toContain(i18n.t('credentials.quota_empty'))
    })

    test('rejects unusable or out-of-range results instead of reporting successful empty quota', () => {
        for (const payload of [null, {}, {summary: [{key: 'zero', label: 'Zero', value: Number.NaN}]},
                               {summary: [{key: 'balance', label: 'Balance', value: 2, format: 'currency'}]},
                               {groups: [{displayName: 'Limits', buckets: [{window: 'daily', remainingFraction: 2}]}]}]) {
            expect(() => parsePluginQuota(payload, 'en')).toThrow()
        }
        expect(parsePluginQuota({summary: [{key: 'zero', label: 'Zero', value: 0}]}, 'en').summary[0].value)
            .toBe('0')
    })
})

describe('generic plugin quota session cache', () => {
    beforeEach(() => useQuotaStore.getState().clearQuotaCache())
    afterEach(() => mock.restore())

    test('retains data and refresh time after remount without requesting quota on mount', async () => {
        const harness = pluginQuotaHarness()
        const card = harness.mount()
        expect(card.view()).toBeNull()
        expect(harness.fetch).not.toHaveBeenCalled()
        const refresh = card.refresh()
        expect(card.view()?.loading).toBe(true)
        expect(useQuotaStore.getState().pluginQuota).toEqual({})
        await refresh
        const refreshedAt = card.view()?.lastRefresh
        expect(refreshedAt).toBeInstanceOf(Date)
        expect(card.view()?.data?.items[0].percent).toBe(80)
        card.unmount()
        const remounted = harness.mount()
        expect(remounted.view()?.lastRefresh).toEqual(refreshedAt)
        expect(remounted.view()?.loading).toBe(false)
        expect(remounted.markup()).toContain('80%')
        expect(remounted.markup()).toContain('Pro')
        expect(harness.fetch).toHaveBeenCalledTimes(1)
        expect(harness.fetch.mock.calls[0]?.slice(0, 2)).toEqual(['7', 'custom'])
        remounted.unmount()
    })

    test('formats cached raw metrics for the current language without fetching again', async () => {
        const harness = pluginQuotaHarness()
        const card = harness.mount()
        await card.refresh()
        expect(card.view()?.data?.summary[0].value).toBe('1,234.5')
        card.changeLanguage('de')
        expect(card.view()?.data?.summary[0].value).toBe('1.234,5')
        expect(card.markup()).toContain('1.234,5')
        expect(harness.fetch).toHaveBeenCalledTimes(1)
        expect(Object.values(useQuotaStore.getState().pluginQuota)[0]?.payload).toEqual(quotaPayload)
        card.unmount()
    })

    for (const invalidate of ['connection', 'cache', 'subject', 'identity', 'disabled'] as const) {
        test(`hides invalidated data and rejects late requests after ${invalidate} changes`, async () => {
            const harness = pluginQuotaHarness()
            const card = harness.mount()
            await card.refresh()
            const originalKey = quotaCredentialKey('custom', pluginFile.name, '7')
            let resolve!: (payload: unknown) => void
            harness.fetch.mockImplementationOnce(() => new Promise((done) => { resolve = done }))
            const pending = card.refresh()
            expect(card.view()?.loading).toBe(true)
            if (invalidate === 'connection') {
                harness.changeConnection()
                useQuotaStore.getState().clearQuotaCache()
            } else if (invalidate === 'cache') {
                useQuotaStore.getState().clearQuotaCache()
            } else if (invalidate === 'subject') {
                useQuotaStore.getState().clearQuotaSubjects([originalKey])
            } else {
                card.changeFile(invalidate === 'identity'
                                ? {...pluginFile, authIndex: '8', modified: 1}
                                : {...pluginFile, disabled: true})
            }
            expect(card.view()).toBeNull()
            const cacheBefore = useQuotaStore.getState().pluginQuota
            resolve({subscription: {tierName: 'Old request'}})
            await pending
            expect(useQuotaStore.getState().pluginQuota).toBe(cacheBefore)
            expect(card.view()).toBeNull()
            card.unmount()
        })
    }

    test('keeps the newest refresh and discards cancelled and unmounted requests', async () => {
        const harness = pluginQuotaHarness()
        const card = harness.mount()
        let resolveFirst!: (payload: unknown) => void
        harness.fetch.mockImplementationOnce(() => new Promise((done) => { resolveFirst = done }))
        const first = card.refresh()
        const firstSignal = harness.fetch.mock.calls[0]?.[2]?.signal
        await card.refresh()
        expect(firstSignal?.aborted).toBe(true)
        resolveFirst({subscription: {tierName: 'Superseded'}})
        await first
        expect(card.view()?.data?.plan).toBe('Pro')
        let resolveUnmounted!: (payload: unknown) => void
        harness.fetch.mockImplementationOnce(() => new Promise((done) => { resolveUnmounted = done }))
        const pending = card.refresh()
        card.unmount()
        expect(harness.fetch.mock.calls[2]?.[2]?.signal?.aborted).toBe(true)
        const cacheBefore = useQuotaStore.getState().pluginQuota
        resolveUnmounted({subscription: {tierName: 'Unmounted'}})
        await pending
        expect(useQuotaStore.getState().pluginQuota).toBe(cacheBefore)
        const remounted = harness.mount()
        expect(remounted.view()?.loading).toBe(false)
        expect(remounted.view()?.data?.plan).toBe('Pro')
        expect(harness.fetch).toHaveBeenCalledTimes(3)
        remounted.unmount()
    })

    test('retains successful data and its timestamp when refresh fails or returns invalid data', async () => {
        const harness = pluginQuotaHarness()
        const card = harness.mount()
        await card.refresh()
        const refreshedAt = card.view()?.lastRefresh
        harness.fetch.mockRejectedValueOnce(new Error('quota unavailable'))
        await card.refresh()
        expect(card.view()?.error).toBe('quota unavailable')
        expect(card.view()?.data?.plan).toBe('Pro')
        expect(card.view()?.lastRefresh).toEqual(refreshedAt)
        expect(card.markup()).toContain('quota unavailable')
        harness.fetch.mockResolvedValueOnce({})
        await card.refresh()
        expect(card.view()?.error).toBe('plugin_quota.invalid_data')
        card.unmount()
        const remounted = harness.mount()
        expect(remounted.view()?.error).toBe('plugin_quota.invalid_data')
        expect(remounted.view()?.data?.plan).toBe('Pro')
        expect(remounted.view()?.lastRefresh).toEqual(refreshedAt)
        remounted.unmount()
    })

    test('does not replace another subject or accept a response from a changed backend binding', async () => {
        const harness = pluginQuotaHarness()
        const card = harness.mount()
        const key = quotaCredentialKey('custom', pluginFile.name, '7')
        const snapshot = (backendGeneration: number, backendStateRevision: number) => ({
            key, metadata: {fileName: pluginFile.name, type: 'custom', backendGeneration, backendStateRevision,
                            status: 'success', freshness: 'fresh' as const, successfulEmpty: false},
        })
        expect(commitQuotaSnapshot(captureQuotaRequestClaim(3), 3, snapshot(4, 1))).toBe('committed')
        await card.refresh()
        useQuotaStore.getState().clearQuotaSubjects(['custom::unrelated'])
        expect(card.view()?.data?.plan).toBe('Pro')
        expect(commitQuotaSnapshot(captureQuotaRequestClaim(3), 3, snapshot(4, 2))).toBe('committed')
        expect(card.view()?.data?.plan).toBe('Pro')
        let resolve!: (payload: unknown) => void
        harness.fetch.mockImplementationOnce(() => new Promise((done) => { resolve = done }))
        const pending = card.refresh()
        expect(commitQuotaSnapshot(captureQuotaRequestClaim(3), 3, snapshot(5, 1))).toBe('committed')
        resolve({subscription: {tierName: 'Stale binding'}})
        await pending
        expect(useQuotaStore.getState().pluginQuota[key]).toBeUndefined()
        expect(card.view()).toBeNull()
        card.unmount()
    })

    test('reports a missing index locally and does not request a disabled credential', async () => {
        const harness = pluginQuotaHarness()
        const missing = harness.mount({...pluginFile, authIndex: undefined})
        await missing.refresh()
        expect(missing.view()?.error).toBe('plugin_quota.missing_auth_index')
        expect(useQuotaStore.getState().pluginQuota).toEqual({})
        const disabled = harness.mount({...pluginFile, disabled: true})
        await disabled.refresh()
        expect(harness.fetch).not.toHaveBeenCalled()
        missing.unmount()
        disabled.unmount()
    })
})
