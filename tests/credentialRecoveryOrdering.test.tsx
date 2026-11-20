import {filterAuthFiles, sortAuthFilesByRecovery} from '@/components/credentials/authFileListLogic'
import {authFileSelectionKey} from '@/components/credentials/credentialsDataLifecycle'
import {buildPluginQuotaIdentity} from '@/components/credentials/pluginQuota'
import {AuthFileCardWithQuota} from '@/components/credentials/VendorSection'
import {Pagination} from '@/components/ui/Pagination'
import {downloadAuthFilesBatch} from '@/features/authFiles/batchDownload'
import {useQuotaStore} from '@/stores/useQuotaStore'
import type {XaiBillingSummary} from '@/types'
import type {AuthFileItem} from '@/types/authFile'
import {quotaCredentialKey} from '@/utils/quota/credentialKey'
import {createSharedClock} from '@/utils/time/sharedClock'
import {describe, expect, test} from 'bun:test'
import React, {type ReactElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import ts from 'typescript'
import {sourceCallback, sourceExpression, sourceInitializer} from './sourceCallbacks'

const pagePath   = 'pages/CredentialsPage.tsx'
const now        = Date.parse('2099-11-11T10:00:00Z')
const file       = (provider: string, authIndex = provider): AuthFileItem => ({
    name: `${provider}-${authIndex}.json`,
    type: provider,
    authIndex,
})
const key        = (entry: AuthFileItem) => quotaCredentialKey(entry.type, entry.name, entry.authIndex)
const window     = (resetAtMs: number | null) => ({
    id: 'weekly',
    label: 'Weekly',
    usedPercent: 90,
    resetLabel: '',
    resetAtMs,
})
const emptyState = (): ReturnType<typeof useQuotaStore.getState> => ({
    ...useQuotaStore.getInitialState(), cacheGeneration: 0, subjectVersions: {}, quotaMetadata: {},
    claudeQuota: {}, codexQuota: {}, devinQuota: {}, antigravityQuota: {}, geminiCliQuota: {}, kimiQuota: {},
    xaiQuota: {}, metaQuota: {}, pluginQuota: {},
})
const t          = (value: string) => value
const billing    = (periodType: 'weekly' | 'monthly', resetAtMs: number): XaiBillingSummary => ({
    periodType, resetAtMs, usagePercent: 90, productUsage: [], used: null, includedUsed: null,
    monthlyLimit: null, remaining: null, onDemandEnabled: null, onDemandCap: null, onDemandUsed: null,
    onDemandUsedPercent: null, usedPercent: null, prepaidBalance: null, amountUnit: 'unknown', currency: null,
    source: null, valueSource: {}, auxiliaryErrors: [],
})

const scheduler = {
    getLastRefreshTime: () => null, getNextRefreshTime: () => null, getStatus: () => 'idle',
    isRefreshing: () => false, isAutoRefreshEnabled: () => false, refreshNow: () => {
    }, refreshMany: () => {
    },
}

describe('credential recovery ordering in the consolidated page', () => {
    test('sorts across all providers, corrects server clock skew, and preserves equal and unknown input order', () => {
        const state                             = emptyState()
        const entries                           = [
            'claude',
            'codex',
            'devin',
            'antigravity',
            'gemini-cli',
            'kimi',
            'xai',
            'meta',
            'other',
        ].map((provider) => file(provider))
        state.claudeQuota[key(entries[0])]      =
            { status: 'success', windows: [window(now + 7000), window(now + 9000)] }
        state.codexQuota[key(entries[1])]       = { status: 'success', windows: [window(now + 6000)] }
        state.devinQuota[key(entries[2])]       =
            {
                status: 'success',
                windows: [{ id: 'daily', remainingPercent: 10, periodHours: 24, resetAtMs: now + 5000 }],
            }
        state.antigravityQuota[key(entries[3])] =
            {
                status: 'success',
                serverTimeOffsetMs: 10000,
                groups: [{ id: 'a', label: 'A', models: [], remainingFraction: 0.1, resetAtMs: now + 11000 }],
            }
        state.geminiCliQuota[key(entries[4])]   =
            {
                status: 'success',
                buckets: [
                    {
                        id: 'g',
                        label: 'G',
                        remainingFraction: 0.1,
                        remainingAmount: null,
                        resetTime: undefined,
                        tokenType: null,
                        resetAtMs: now + 2000,
                    },
                ],
            }
        state.kimiQuota[key(entries[5])]        =
            { status: 'success', rows: [{ id: 'k', used: 9, limit: 10, resetAtMs: now + 2000 }] }
        state.xaiQuota[key(entries[6])]         = { status: 'success', billing: billing('weekly', now + 3000) }
        const original                          = [...entries]
        expect(sortAuthFilesByRecovery(entries, state, now, 7).map((entry) => entry.type)).toEqual([
                                                                                                       'antigravity',
                                                                                                       'gemini-cli',
                                                                                                       'kimi',
                                                                                                       'xai',
                                                                                                       'devin',
                                                                                                       'codex',
                                                                                                       'claude',
                                                                                                       'meta',
                                                                                                       'other',
                                                                                                   ])
        expect(entries).toEqual(original)
    })

    test(
        'ignores expired and invalid windows, loading/error data, subscription expiry, and monthly billing rollover',
        () => {
            const state   = emptyState()
            const entries = ['past', 'invalid', 'loading', 'error', 'codex', 'xai', 'ready'].map((provider) => file(
                provider))
            for (const [index, resetAtMs] of [now, NaN, now + 1, now + 1].entries()) {
                state.claudeQuota[key(entries[index])] =
                    {
                        status: index === 2 ? 'loading' : index === 3 ? 'error' : 'success',
                        windows: [window(resetAtMs)],
                    }
            }
            state.codexQuota[key(entries[4])]  =
                { status: 'success', windows: [], subscriptionActiveUntil: new Date(now + 1).toISOString() }
            state.xaiQuota[key(entries[5])]    = { status: 'success', billing: billing('monthly', now + 1) }
            state.claudeQuota[key(entries[6])] =
                { status: 'success', windows: [window(now - 1), window(Infinity), window(now + 60000)] }
            expect(sortAuthFilesByRecovery(entries, state, now, 7)).toEqual([entries[6], ...entries.slice(0, 6)])
            expect(sortAuthFilesByRecovery(entries, state, now + 60000, 7)).toEqual(entries)
        },
    )

    test('retains available reset-credit expiry without promoting unavailable credits', () => {
        const state                    = emptyState()
        const codex                    = file('codex')
        const claude                   = file('claude')
        state.codexQuota[key(codex)]   = {
            status: 'success', windows: [window(now + 5000)], rateLimitResetCredits: [
                {
                    id: 'used',
                    status: 'used',
                    grantedAt: '',
                    expiresAt: new Date(now + 1).toISOString(),
                    expiryState: 'valid',
                },
                {
                    id: 'available',
                    status: 'available',
                    grantedAt: '',
                    expiresAt: new Date(now + 1000).toISOString(),
                    expiryState: 'valid',
                },
            ],
        }
        state.claudeQuota[key(claude)] = { status: 'success', windows: [window(now + 2000)] }
        expect(sortAuthFilesByRecovery([claude, codex], state, now, 7)).toEqual([codex, claude])
        expect(sortAuthFilesByRecovery([claude, codex], state, now + 1000, 7)).toEqual([claude, codex])
    })

    test('ignores a plugin observation belonging to an earlier credential or connection', () => {
        const state                    = emptyState()
        const plugin                   = { ...file('plugin'), supportsQuota: true }
        const claude                   = file('claude')
        state.pluginQuota[key(plugin)] = {
            identity: 'earlier-connection', loading: false, payload: {
                groups: [{ buckets: [{ remainingFraction: 0.1, resetTime: new Date(now + 1000).toISOString() }] }],
            },
        }
        state.claudeQuota[key(claude)] = { status: 'success', windows: [window(now + 2000)] }
        expect(sortAuthFilesByRecovery([plugin, claude], state, now, 7)).toEqual([claude, plugin])
        state.pluginQuota[key(plugin)].identity = buildPluginQuotaIdentity(plugin, 7, JSON.stringify([0, 0, 0]))
        expect(sortAuthFilesByRecovery([plugin, claude], state, now, 7)).toEqual([plugin, claude])
        expect(sortAuthFilesByRecovery([plugin, claude], state, now, 8)).toEqual([claude, plugin])
        expect(sortAuthFilesByRecovery([{ ...plugin, updatedAt: 'new-revision' }, claude], state, now, 7))
            .toEqual([claude, { ...plugin, updatedAt: 'new-revision' }])
        state.cacheGeneration = 1
        expect(sortAuthFilesByRecovery([plugin, claude], state, now, 7)).toEqual([claude, plugin])
        state.cacheGeneration              = 0
        state.subjectVersions[key(plugin)] =
            {
                localGeneration: 0,
                backendGeneration: 1,
                backendStateRevision: 1,
                minimumBackendGeneration: 0,
                tombstone: false,
            }
        expect(sortAuthFilesByRecovery([plugin, claude], state, now, 7)).toEqual([claude, plugin])
    })

    test('uses the same identity search and status filters before globally sorting and paginating', () => {
        const state                   = emptyState()
        const first                   = file('claude', 'first')
        const second                  = file('codex', 'second')
        const third                   = file('claude', 'third')
        const disabled                = {
            ...file('claude', 'disabled'),
            status: ' DISABLED ',
            statusMessage: 'rejected',
        }
        state.claudeQuota[key(first)] = { status: 'success', windows: [window(now + 3000)] }
        state.codexQuota[key(second)] = { status: 'success', windows: [window(now + 1000)] }
        state.claudeQuota[key(third)] = { status: 'success', windows: [window(now + 2000)] }
        const vendorData              = new Map([
                                                    ['claude', { authFiles: [first, third, disabled] }],
                                                    ['codex', { authFiles: [second] }],
                                                ])
        const scope                   = {
            quotaState: state,
            visibleVendors: [{ id: 'claude', label: 'Claude' }, { id: 'codex', label: 'Codex' }],
            vendorData,
            searchQuery: '',
            statusFilter: 'available',
            typeFilter: 'auth-file',
            quotaStatusMap: {},
            t,
            filterAuthFiles,
            // noinspection JSUnusedGlobalSymbols
            'sortAuthFilesByRecovery': sortAuthFilesByRecovery,
            quotaNowMs: now,
            apiClient: { getAuthGeneration: () => 7 },
        }
        const sort                    = (extra: Record<string, unknown> = {}) => sourceCallback<() => AuthFileItem[]>(
            pagePath,
            'sortedQuotaFiles',
            { ...scope, ...extra },
        )()
        const sortedQuotaFiles        = sort()
        expect(sortedQuotaFiles).toEqual([second, third, first])
        expect(sort({ statusFilter: 'disabled-problem' })).toEqual([disabled])
        expect(sort({ typeFilter: 'api-key' })).toEqual([])
        expect(sort({ searchQuery: 'third' })).toEqual([third])
        expect(sort({ searchQuery: 'Claude' })).toEqual([third, first])
        const slice = sourceCallback<() => AuthFileItem[]>(
            pagePath,
            'paginatedQuotaFiles',
            { sortedQuotaFiles, safeQuotaPage: 2, quotaPageSize: 2 },
        )
        expect(slice()).toEqual([first])
        const visible = sourceCallback<() => string[]>(pagePath, 'visibleAuthFileKeys', {
            quotaSort: 'soonest', sortedQuotaFiles, authFileSelectionKey,
        })()
        expect(visible).toEqual([second, third, first].map(authFileSelectionKey))
        expect(new Set(visible).size).toBe(3)
    })

    test('the page renders the sorted page through the existing quota card and one global pager', () => {
        const entries = [file('codex'), file('claude')]

        const selections: string[] = []

        const pages: number[] = []

        const sizes: number[] = []

        const operations: unknown[][] = []

        const fragment = sourceExpression<ReactElement>(
            pagePath,
            (node, tree) => ts.isJsxFragment(node) &&
                            node.getText(tree).includes('paginatedQuotaFiles.map'),
            {
                React,
                styles: { quotaGrid: 'quota-grid' },
                loading: false,
                authFiles: entries,
                paginatedQuotaFiles: entries,
                sortedQuotaFiles: [
                    ...entries,
                    file('other'),
                ],
                AuthFileCardWithQuota,
                authFileSelectionKey,
                quotaScheduler: scheduler,
                safeQuotaPage: 2,
                quotaPageSize: 2,
                disableFileControls: false,
                toggleAuthFile: async (...args: unknown[]) => {
                    operations.push(['toggle', ...args])
                },
                openPrefixProxyEditor: (entry: AuthFileItem) => {
                    operations.push(['edit', entry])
                },
                deleteAuthFile: (name: string) => {
                    operations.push(['delete', name])
                },
                downloadAuthFile: async (name: string) => {
                    operations.push(['download', name])
                },
                // noinspection JSUnusedGlobalSymbols
                'setModelsFileKey': (identity: string) => operations.push(['models', identity]),
                handleRefresh: async () => {
                },
                selectedItems: new Set([
                                           authFileSelectionKey(entries[0]),
                                       ]),
                // noinspection JSUnusedGlobalSymbols
                'handleToggleSelect': (identity: string) => selections.push(identity),
                config: { usageStatisticsEnabled: false },
                authIndexUsageLoadFailed: true,
                authIndexTimeSeries: {},
                authIndexUsageWindow: {},
                Pagination,
                setQuotaPage: (page: number) => pages.push(page),
                // noinspection JSUnusedGlobalSymbols
                'setQuotaPageSize': (size: number) => sizes.push(size),
                t,
            },
        )

        const children = React.Children.toArray((fragment.props as {
            children: React.ReactNode
        }).children) as ReactElement<Record<string, unknown>>[]

        const grid = children[0]

        const cards = grid.props.children as ReactElement<React.ComponentProps<typeof AuthFileCardWithQuota>>[]
        expect(cards.map((card) => card.type)).toEqual([AuthFileCardWithQuota, AuthFileCardWithQuota])
        expect(cards.map((card) => card.props.file)).toEqual(entries)
        expect(cards.map((card) => card.props.position)).toEqual([3, 4])
        expect(cards[0].props.selected).toBe(true)
        cards[1].props.onSelect?.()
        expect(selections).toEqual([authFileSelectionKey(entries[1])])
        void cards[0].props.onToggle(entries[0], true)
        void cards[0].props.onEdit(entries[0])
        cards[0].props.onDelete(entries[0].name)
        void cards[0].props.onDownload(entries[0].name)
        cards[0].props.onModels?.()
        expect(operations).toEqual([
                                       ['toggle', entries[0], true], ['edit', entries[0]], ['delete', entries[0].name],
                                       ['download', entries[0].name], ['models', authFileSelectionKey(entries[0])],
                                   ])
        const pager = children.find((child) => child.type === Pagination)!
        expect(pager.props).toMatchObject({ total: 3, page: 2, pageSize: 2 })
        ;(pager.props.onPageSizeChange as (size: number) => void)(48)
        expect(sizes).toEqual([48])
        expect(pages).toEqual([1])
        const html = renderToStaticMarkup(fragment)
        expect(html).toContain('quota-grid')
        expect(html).toContain('codex')
        expect(html).toContain('claude')
    })

    test('connects file actions and the original editor mutation callback without losing the auth-index', async () => {
        const refresh              = async () => {
        }
        const mutations: unknown[] = []
        const completeMutation     = async (value: unknown) => {
            mutations.push(value)
        }
        const actions              = {
            toggleAuthFile: async () => {
            }, deleteAuthFile: () => {
            }, downloadAuthFile: async () => {
            },
        }
        const bound                = sourceExpression<typeof actions>(
            pagePath,
            (node, tree) => ts.isCallExpression(node) &&
                            node.expression.getText(tree) ===
                            'useVendorActions', {
                handleRefresh: refresh, completeMutation,
                useVendorActions: (
                    vendor: string,
                    onRefresh: unknown,
                    onMutation: unknown,
                ) => {
                    expect(vendor).toBe('other')
                    expect(onRefresh).toBe(refresh)
                    expect(onMutation).toBe(completeMutation)
                    return actions
                },
            },
        )
        expect(bound).toBe(actions)
        let save!: (name: string, fields: object, authIndex: string) => Promise<void>
        sourceExpression(
            pagePath,
            (node, tree) => ts.isCallExpression(node) &&
                            node.expression.getText(tree) ===
                            'useAuthFilesPrefixProxyEditor', {
                disableFileControls: false, completeMutation,
                useAuthFilesPrefixProxyEditor: (options: {
                    disableControls: boolean;
                    completeMutation: typeof save
                }) => {
                    expect(options.disableControls).toBe(false)
                    save = options.completeMutation
                    return {}
                },
            },
        )
        await save('same.json', { priority: 3 }, 'stable-auth-index')
        expect(mutations).toEqual([
                                      {
                                          kind: 'fields',
                                          name: 'same.json',
                                          fields: { priority: 3 },
                                          authIndex: 'stable-auth-index',
                                      },
                                  ])
    })

    test('a single-file download stops saving when the connection changes during its response', async () => {
        let generation           = 1
        const saved: string[]    = []
        const notices: unknown[] = []
        const download           = sourceCallback<(name: string) => Promise<void>>(
            'components/credentials/hooks/useVendorActions.ts',
            'downloadAuthFile',
            {
                apiClient: { getAuthGeneration: () => generation },
                authFilesApi: {
                    download: async () => {
                        generation = 2;
                        return new Blob(['synthetic'])
                    },
                },
                downloadAuthFilesBatch: (
                    names: string[],
                    fetch: (name: string) => Promise<Blob>,
                    _save: unknown,
                    isCurrent?: () => boolean,
                ) =>
                    downloadAuthFilesBatch(names, fetch, (name) => saved.push(name), isCurrent),
                showNotification: (...args: unknown[]) => notices.push(args), t,
            },
        )
        await download('synthetic.json')
        expect(saved).toEqual([])
        expect(notices).toEqual([])
    })

    test('connects the visible sorting selector and preserves manual API-key groups in recovery mode', () => {
        const sorts: string[] = []
        const pages: number[] = []
        const control         = sourceExpression<ReactElement<{
            onChange: (value: string) => void;
            ariaLabel: string
        }>>(
            pagePath,
            (node, tree) => ts.isJsxSelfClosingElement(node) &&
                            node.tagName.getText(tree) ===
                            'Select' &&
                            node.getText(tree).includes('value={quotaSort}'), {
                React,
                Select: () => null,
                quotaSort: 'grouped',
                t,
                // noinspection JSUnusedGlobalSymbols
                'setQuotaSort': (value: string) => sorts.push(value),
                setQuotaPage: (value: number) => pages.push(value),
            },
        )
        expect(control.props.ariaLabel).toBe('auth_files.sort_label')
        control.props.onChange('soonest')
        control.props.onChange('grouped')
        expect(sorts).toEqual(['soonest', 'grouped'])
        expect(pages).toEqual([1, 1])
        const vendors    = [{ id: 'claude' }, { id: 'codex' }]
        const vendorData = new Map([['claude', { apiKeys: ['synthetic'] }], ['codex', { apiKeys: [] }]])
        for (const quotaSort of ['grouped', 'soonest']) {
            const visible = sourceExpression(pagePath, (node, tree) => ts.isCallExpression(node) &&
                                                                       ts.isPropertyAccessExpression(node.expression) &&
                                                                       node.expression.expression.getText(tree) ===
                                                                       'visibleVendors' &&
                                                                       node.expression.name.text ===
                                                                       'filter', {
                                                 visibleVendors: vendors, vendorData, quotaSort,
                                             })
            expect(visible).toEqual(quotaSort === 'grouped' ? vendors : [vendors[0]])
        }
        expect(sourceInitializer<number>(
            pagePath,
            'safeQuotaPage',
            { quotaPage: 9, sortedQuotaFiles: [1, 2, 3], quotaPageSize: 2 },
        )).toBe(2)
        expect(sourceInitializer<number>(
            pagePath,
            'safeQuotaPage',
            { quotaPage: 9, sortedQuotaFiles: [], quotaPageSize: 2 },
        )).toBe(1)
    })

    test('migrates soonest preferences once and saves sort, page size, and other filters together', () => {
        const local: Record<string, string> = {
            'authFilesPage.uiState': JSON.stringify({
                                                        sortMode: 'soonest',
                                                        search: 'legacy',
                                                        pageSize: 9,
                                                    }),
        }
        const storage                       = {
            getItem: (name: string) => local[name] ?? null,
            setItem: (name: string, value: string) => {
                local[name] = value
            },
        }
        const scope                         = {
            localStorage: storage,
            sessionStorage: { getItem: () => null },
            CREDENTIALS_UI_STATE_KEY: 'current',
        }
        const load                          = sourceCallback<() => Record<string, unknown>>(
            pagePath,
            'loadCredentialsUIState',
            scope,
        )
        const initialUIState                = load()
        expect(initialUIState).toMatchObject({ quotaSort: 'soonest', searchQuery: 'legacy', pageSize: 9 })
        const save = sourceCallback<() => void>(pagePath, 'useEffect', {
            ...scope, initialUIState, quotaSort: 'grouped', quotaPageSize: 48,
            searchQuery: 'current', statusFilter: 'disabled', typeFilter: 'auth-file', selectedVendors: ['claude'],
        }, 'legacyPreferencesMigrated: true')
        save()
        local['authFilesPage.uiState'] = JSON.stringify({ sortMode: 'soonest', pageSize: 3 })
        expect(load()).toMatchObject({
                                         quotaSort: 'grouped',
                                         pageSize: 48,
                                         searchQuery: 'current',
                                         statusFilter: 'disabled',
                                         selectedVendors: ['claude'],
                                     })
    })

    test(
        'subscribes to the shared minute clock only while recovery ordering is visible and releases it on exit',
        () => {
            let timers  = 0
            let clears  = 0
            const clock = createSharedClock({
                                                now: () => now, setTimer: () => {
                    ++timers;
                    return 1
                }, clearTimer: () => {
                    ++clears
                },
                                            })
            for (const [quotaSort, activeTab] of
                [['grouped', 'credentials'], ['soonest', 'inspection'], ['soonest', 'credentials']]) {
                const subscribe   = sourceCallback<(listener: () => void) => () => void>(
                    pagePath,
                    'subscribeQuotaClock',
                    {
                        quotaSort,
                        activeTab,
                        MINUTE_CLOCK: clock,
                    },
                )
                const unsubscribe = subscribe(() => {
                })
                expect(clock.subscriberCount()).toBe(quotaSort === 'soonest' && activeTab === 'credentials' ? 1 : 0)
                unsubscribe()
                expect(clock.subscriberCount()).toBe(0)
            }
            expect(timers).toBe(1)
            expect(clears).toBe(1)
            expect(sourceInitializer<[string, () => number]>(pagePath, 'quotaNowMs', {
                useSyncExternalStore: (subscribe: unknown, snapshot: unknown) => [subscribe, snapshot],
                subscribeQuotaClock: 'visible-only', MINUTE_CLOCK: clock,
            })).toEqual(['visible-only', clock.getSnapshot])
        },
    )

    test('provides the grouped and recovery labels in all four locales', async () => {
        for (const locale of ['en', 'ru', 'zh-CN', 'zh-TW']) {
            const messages = await Bun.file(new URL(`../src/i18n/locales/${locale}.json`, import.meta.url)).json()
            expect(messages.credentials.sort_grouped).toBeTruthy()
            expect(messages.credentials.quota_soonest_recovery).toBeTruthy()
        }
    })
})
