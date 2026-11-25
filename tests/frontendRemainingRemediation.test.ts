import {Sheet} from '@/components/common/Sheet'
import {findConfigFieldById, getVisualConfigSectionId} from '@/components/config/configSearchIndex'
import {shouldFinalizeOAuthAttempt} from '@/components/credentials/oauthAttempts'
import {Button} from '@/components/ui/Button'
import {Pagination} from '@/components/ui/Pagination'
import {
    createUsageEventExport,
    USAGE_EVENT_EXPORT_PAGE_SIZE,
    UsageEventExportLimitError,
} from '@/components/usage/usageEventExport'
import {usePagination} from '@/hooks/usePagination'
import {ModelCheckboxList} from '@/pages/ModelCheckboxList'
import {collectPluginResourceEntries, resolvePluginAssetURL} from '@/pages/pluginResources'
import {prepareApiCallAuth} from '@/services/api/apiCall'
import {MANAGEMENT_SESSION_HEADER} from '@/services/api/client'
import {DEFAULT_VISUAL_VALUES} from '@/types/visualConfig'
import {normalizeApiBase} from '@/utils/connection'
import {buildHeaderObject, hasHeader} from '@/utils/headers'
import {getErrorMessage} from '@/utils/helpers'
import {parseXaiQuotaPayload} from '@/utils/quota/xaiBilling'
import {safeExternalUrl} from '@/utils/validation'
import {describe, expect, test} from 'bun:test'
import {createInstance} from 'i18next'
import {readFileSync} from 'node:fs'
import React, {createElement, type ReactElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import ts from 'typescript'
import {sourceCallback, sourceExpression, sourceInitializer} from './sourceCallbacks'

const noop      = () => {
}
const translate = (key: string) => key
const eventFile = 'components/usage/RequestEventsDetailsCard.tsx'

describe('remaining frontend remediation contracts', () => {
    test('publishes real OAuth phases and refreshes credentials only after final success', () => {
        const phases: string[] = []
        let result!: (value: { status: string; phase: string }) => boolean
        let successes          = 0
        const attempt          = {
            signal: new AbortController().signal, invalidate: noop,
            poll: (_request: unknown, receive: typeof result) => {
                result = receive
            },
        }
        const poll             = sourceCallback<(state: string, nonce: string, attempt: object) => void>(
            'components/credentials/OAuthLoginAction.tsx',
            'startPolling',
            {
                oauthApi: {}, setPhase: (value: string) => phases.push(value), setStatus: noop, setError: noop,
                setOauthState: noop, setUserCode: noop, nonceRef: { current: 'synthetic' }, onSuccess: () => {
                    successes++
                },
                t: translate, POLL_INTERVAL: 2000, shouldFinalizeOAuthAttempt,
            },
        )
        poll('state', 'nonce', attempt)
        for (const phase of ['accepted', 'exchanging', 'publishing_file', 'publishing_auth']) {
            expect(result({ status: 'wait', phase })).toBe(true)
            expect(successes).toBe(0)
        }
        expect(result({ status: 'ok', phase: 'success' })).toBe(false)
        expect(phases).toEqual(['accepted', 'exchanging', 'publishing_file', 'publishing_auth', 'success'])
        expect(successes).toBe(1)
    })

    test('localizes invalid authorization URLs and each real OAuth phase in all four languages', async () => {
        const messages = sourceInitializer<Record<string, string>>(
            'components/credentials/OAuthLoginAction.tsx',
            'oauthPhaseMessages',
            {},
        )
        for (const language of ['en', 'ru', 'zh-CN', 'zh-TW']) {
            const instance = createInstance()
            await instance.init({
                                    lng: language,
                                    resources: {
                                        [language]: {
                                            translation: JSON.parse(readFileSync(new URL(
                                                `../src/i18n/locales/${language}.json`,
                                                import.meta.url,
                                            ), 'utf8')),
                                        },
                                    },
                                })
            for (const phase of ['accepted', 'exchanging', 'publishing_file', 'publishing_auth', 'saving']) {
                expect(instance.t(messages[phase])).not.toBe(messages[phase])
            }
            const errors: string[] = []
            const attempt          = { signal: new AbortController().signal, isCurrent: () => true, invalidate: noop }
            const start            = sourceCallback<() => Promise<void>>(
                'components/credentials/OAuthLoginAction.tsx',
                'startAuth',
                {
                    attemptsRef: { current: { begin: () => attempt } },
                    provider: 'codex',
                    plugin: false,
                    needsProjectId: false,
                    projectId: '',
                    generateNonce: () => 'synthetic',
                    nonceRef: { current: '' },
                    setCallbackAccepted: noop,
                    setPhase: noop,
                    setCancelSubmitting: noop,
                    setOauthState: noop,
                    setUserCode: noop,
                    setStatus: noop,
                    setError: (value: string) => errors.push(value),
                    oauthApi: {
                        startAuth: async () => ({
                            url: 'javascript:invalid',
                            state: 'state',
                        }),
                    },
                    safeExternalUrl,
                    t: instance.t.bind(instance),
                    startPolling: () => {
                        throw new Error('invalid URL must not poll')
                    },
                },
            )
            await start()
            expect(errors[errors.length - 1]).toBe(instance.t('credentials.oauth_invalid_url'))
        }
    })

    test('infers xAI subscription from the retained minor-unit limits and preserves explicit plans', () => {
        for (const [limit, expected] of [[15000, 'supergrok'], [150000, 'supergrokheavy']] as const) {
            expect(parseXaiQuotaPayload({
                                            schema_version: 1,
                                            normalized: { monthly_limit: limit, amount_unit: 'cents' },
                                        })?.planType).toBe(expected)
            expect(parseXaiQuotaPayload({ monthly_limit_cents: limit })?.planType).toBe(expected)
            expect(parseXaiQuotaPayload({
                                            schema_version: 1,
                                            normalized: { monthly_limit: limit, amount_unit: 'dollars' },
                                        })?.planType).toBeNull()
            expect(parseXaiQuotaPayload({
                                            schema_version: 1,
                                            normalized: {
                                                monthly_limit: limit,
                                                amount_unit: 'cents',
                                                plan_name: 'Explicit',
                                            },
                                        })?.planType).toBe('Explicit')
        }
    })

    test('surfaces duplicate Codex authentication headers without sending a connectivity request', async () => {
        const errors: string[] = []
        let requests           = 0
        const run              = sourceInitializer<() => Promise<void>>(
            'pages/AiProvidersCodexEditPage.tsx',
            'runCodexConnectivityTest',
            {
                isTesting: false,
                form: {
                    baseUrl: 'https://fixture.invalid',
                    apiKey: 'synthetic',
                    authIndex: 'fixture',
                    headers: [
                        {
                            key: 'Authorization',
                            value: 'Bearer a',
                        },
                        {
                            key: 'authorization',
                            value: 'Bearer b',
                        },
                    ],
                },
                testModel: 'synthetic-model',
                availableModels: [],
                DEFAULT_CODEX_TEST_MODEL: 'default',
                buildHeaderObject,
                hasHeader,
                prepareApiCallAuth,
                getErrorMessage,
                t: translate,
                buildCodexResponsesEndpoint: () => 'https://fixture.invalid/responses',
                showTestError: (value: string) => errors.push(value),
                runConnectivityTest: () => {
                    requests++
                },
            },
        )
        await run()
        expect(requests).toBe(0)
        expect(errors[0]).toContain('Duplicate credential header')
    })

    test('keeps system cache settings usable when storage is denied and reports failed writes', () => {
        const [initial] = sourceInitializer<[{ value: string; error: string }]>(
            'pages/SystemPage.tsx',
            'modelsCachePreference',
            {
                useState: (read: () => unknown) => [read()],
                localStorage: {
                    getItem: () => {
                        throw new Error('storage denied')
                    },
                },
                getErrorMessage,
            },
        )
        expect(initial).toEqual({ value: '30000', error: 'storage denied' })
        let current  = initial
        let fail     = true
        let reloads  = 0
        const change = sourceInitializer<(value: string) => void>('pages/SystemPage.tsx', 'changeModelsCacheExpiry', {
            localStorage: {
                setItem: () => {
                    if (fail) {
                        throw new Error('write denied')
                    }
                },
            }, getErrorMessage,
            // noinspection JSUnusedGlobalSymbols
            'setModelsCachePreference': (next: typeof current | ((previous: typeof current) => typeof current)) => {
                current = typeof next === 'function' ? next(current) : next
            },
            window: {
                location: {
                    reload: () => {
                        reloads++
                    },
                },
            },
        })
        change('0')
        expect(current).toEqual({ value: '30000', error: 'write denied' })
        expect(reloads).toBe(0)
        fail = false
        change('0')
        expect(current).toEqual({ value: '0', error: '' })
        expect(reloads).toBe(1)
    })

    test(
        'maps controls to their sections, directs quota refresh to inspection, and keeps snapshots out of dirty sections',
        () => {
            expect(Object.keys(DEFAULT_VISUAL_VALUES).filter((field) => !getVisualConfigSectionId(field)))
                .toEqual(['yamlFields'])
            for (const field of ['quotaRefreshEnabled', 'quotaRefreshInterval', 'quotaRefreshMaxInterval']) {
                expect(findConfigFieldById(field)).toMatchObject({
                                                                     sectionId: 'quota',
                                                                     destination: '/credentials?tab=inspection#quota-refresh-settings',
                                                                 })
            }
            const dirtySections = sourceCallback<() => Set<string>>(
                'components/config/VisualConfigEditor.tsx',
                'dirtySections',
                {
                    values: {
                        ...DEFAULT_VISUAL_VALUES,
                        port: '9001',
                        requestRetry: '4',
                        yamlFields: { 'quota-refresh.enabled': { source: 'yaml', value: true } },
                    },
                    baselineValues: DEFAULT_VISUAL_VALUES,
                    // noinspection JSUnusedGlobalSymbols
                    'getVisualConfigSectionId': getVisualConfigSectionId,
                },
            )()
            expect([...dirtySections].sort()).toEqual(['connectivity', 'network'])
            const nav = sourceInitializer<ReactElement>('components/config/VisualConfigEditor.tsx', 'navContent', {
                React,
                styles: {},
                sections: [
                    {
                        id: 'network',
                        title: 'Network',
                        description: 'Routing',
                        errorCount: 2,
                        icon: () => null,
                    },
                ],
                activeSectionId: 'network',
                dirtySections,
                handleSectionJump: noop,
                t: (key: string, options?: { count?: number }) => key.endsWith('nav_errors') ?
                                                                  `${options?.count} errors` :
                                                                  'Unsaved changes',
            })
            expect(renderToStaticMarkup(nav)).toContain('aria-label="Network · Routing · 2 errors · Unsaved changes"')
        },
    )

    test('paginates discovery models and notification items through the shared controls', () => {
        const models = Array.from({ length: 23 }, (_, index) => ({ name: `model-${index}` }))
        const html   = renderToStaticMarkup(createElement(ModelCheckboxList, {
            models,
            selected: new Set<string>(),
            missingModelNames: new Set(models.map((model) => model.name)),
            onToggle: noop,
        }))
        expect(html).toContain('model-19')
        expect(html).not.toContain('model-20')
        const items         = Array.from(
            { length: 12 },
            (_, index) => ({
                id: String(index),
                source: 'release',
                type: 'info',
                read: false,
                message: `Message ${index}`,
                timestamp: Date.now(),
            }),
        )
        const scope         = {
            React, ...React, styles: {}, useTranslation: () => ({ t: translate }), Button, Pagination, usePagination,
            IconBell: () => null, IconCheckCheck: () => null, IconTrash2: () => null,
        }
        const item          = sourceCallback('components/common/NotificationCenter.tsx', 'NotificationItem', {
            React,
            styles: {},
            PERSISTENT_NOTIFICATION_SOURCES: { release: { labelKey: 'Release' } },
            formatRelativeTime: () => 'now',
        })
        const store         = {
            panelOpen: true,
            persistentNotifications: items,
            togglePanel: noop,
            closePanel: noop,
            markAsRead: noop,
            markAllAsRead: noop,
            clearAllPersistent: noop,
            // noinspection JSUnusedGlobalSymbols
            'unreadCount': () => 12,
        }
        const Center        = sourceCallback<React.ComponentType>(
            'components/common/NotificationCenter.tsx',
            'NotificationCenter',
            {
                ...scope,
                NotificationItem: item,
                useNotificationStore: (selector: (value: typeof store) => unknown) => selector(store),
            },
        )
        const notifications = renderToStaticMarkup(createElement(Center))
        expect(notifications).toContain('Message 4')
        expect(notifications).not.toContain('Message 5')
    })

    test('connects model-management pagination to the actual shared table', () => {
        const rows  = Array.from({ length: 30 }, (_, index) => ({ key: String(index), name: `Catalog item ${index}` }))
        const table = sourceExpression<ReactElement>(
            'pages/ModelManagementPage.tsx',
            (node, tree) => ts.isJsxSelfClosingElement(node) &&
                            node.tagName.getText(tree) ===
                            'Sheet' &&
                            node.getText(tree)
                                .includes('visibleTreeTableRows'),
            {
                React,
                Sheet,
                visibleTreeTableRows: rows,
                modelColumns: [
                    {
                        key: 'name',
                        header: 'Model',
                        cell: (row: { name: string }) => row.name,
                    },
                ],
                treeStatus: 'ready',
                error: '',
                loadAll: noop,
                treeEmptyText: '',
                treeEmptyHint: '',
                modelTree: [],
                modelRows: rows,
                requestableRows: rows,
                enabledCount: rows.length,
                styles: {},
                t: translate,
                Input: () => null,
                searchValue: '',
                setSearchValue: noop,
                refreshing: false,
                renderModelTreeRow: undefined,
            },
        )
        const html  = renderToStaticMarkup(table)
        expect(html).toContain('Catalog item 24')
        expect(html).not.toContain('Catalog item 25')
    })

    test('retains populated event rows while displaying and clearing refresh failure feedback', () => {
        const requestEventColumns   = [{ key: 'name', header: 'Name', cell: (row: { name: string }) => row.name }]
        const renderRequestEventRow = sourceCallback<(row: { id: string; name: string }) => ReactElement>(
            eventFile, 'renderRequestEventRow', {
                React,
                Fragment: React.Fragment,
                styles: {},
                requestDetails: null,
                requestEventColumns,
                RequestObservationDetails: () => null,
                renderRequestLog: noop,
                requestLogLabel: 'Request log',
                t: translate,
            },
        )
        const render                = (fetchError: string | null) => sourceExpression<ReactElement>(
            eventFile,
            (
                node,
                tree,
            ) => ts.isConditionalExpression(node) &&
                 node.condition.getText(tree) ===
                 'isLoading && rows.length === 0',
            {
                React,
                styles: {},
                isLoading: false,
                rows: [
                    {
                        id: 'fixture',
                        name: 'Retained event',
                    },
                ],
                totalCount: 101,
                fetchError,
                fetching: false,
                eventsData: { page: fetchError ? 1 : 2, page_size: 50, total_pages: 3 },
                accessiblePages: 3,
                hasActiveFilters: false,
                t: (key: string, params?: { requested?: number; shown?: number }) =>
                    key === 'usage_stats.request_events_page_load_failed'
                    ? `${key}: requested ${params?.requested}, showing ${params?.shown}` : key,
                isRefreshingRows: false,
                requestEventColumns,
                renderRequestEventRow,
                Sheet,
                Pagination: ({ page }: { page: number }) => createElement('span', { 'data-page': page }),
                page: 2,
                pageSize: 50,
                setPage: noop,
                setPageSize: noop,
            },
        )
        const failed                = renderToStaticMarkup(render('Synthetic refresh failure'))
        expect(failed).toContain('role="alert"')
        expect(failed).toContain('Synthetic refresh failure')
        expect(failed).toContain('Retained event')
        const recovered = renderToStaticMarkup(render(null))
        expect(recovered).not.toContain('role="alert"')
        expect(recovered).toContain('Retained event')
    })

    test('exports full event identity without replacing it with display aliases or masked keys', async () => {
        const event = {
            timestamp: '2026-10-23T10:00:00Z',
            model: 'fixture-model',
            source: 'fixture-source',
            auth_index: 'fixture-auth',
            api_key: 'stable-key-id',
            raw_api_key: 'synthetic-raw-key',
            api_key_alias: 'My alias',
            tokens: {},
            failed: false,
            cost: 0,
        }
        for (const format of ['json', 'csv'] as const) {
            let blob: Blob | undefined
            const exportEvents = sourceCallback<(format: string) => Promise<void>>(eventFile, 'exportEvents', {
                exportControllerRef: { current: null },
                setExportingFormat: noop,
                sourceInfoMap: {},
                authFileMap: new Map(),
                i18n: { language: 'en' },
                noApiKeyLabel: '',
                notRecordedLabel: '',
                modelAliasLookup: {},
                t: translate,
                aliases: {},
                eventToRow: () => ({
                    apiKeyMasked: 'My alias',
                    user: 'Fixture',
                    requestId: '',
                    completed: null,
                    cost: 0,
                }),
                createUsageEventExport,
                UsageEventExportLimitError,
                USAGE_EVENT_EXPORT_PAGE_SIZE,
                USAGE_EVENT_CSV_HEADER: sourceInitializer(eventFile, 'USAGE_EVENT_CSV_HEADER', {}),
                usageApi: {
                    getEvents: async () => ({
                        events: [event],
                        page: 1,
                        page_size: 500,
                        total: 1,
                        total_pages: 1,
                    }),
                },
                buildExportParams: () => ({ page: 1 }),
                normalizeUsageThinking: () => null,
                sanitizeUpstreamUrl: sourceCallback(eventFile, 'sanitizeUpstreamUrl', {}),
                observedRequestSpeed: sourceCallback(eventFile, 'observedRequestSpeed', {}),
                encodeCsv: sourceInitializer(eventFile, 'encodeCsv', {}),
                downloadBlob: (value: { blob: Blob }) => {
                    blob = value.blob
                },
                showNotification: noop,
            })
            await exportEvents(format)
            expect(blob).toBeDefined()
            const text = await blob!.text()
            expect(text).toContain('stable-key-id')
            expect(text).toContain('synthetic-raw-key')
            if (format === 'json') {
                expect(text).toContain('My alias')
                expect(text).toContain('raw_api_key')
            } else {
                expect(text).toContain('raw_api_key')
            }
        }
    })

    test('header refresh dispatches each registered plugin page loader including resource preflight', async () => {
        const shared                      = globalThis as unknown as {
            activeHeaderRefreshHandler?: (() => void | Promise<void>) | null
        }
        const previous                    = shared.activeHeaderRefreshHandler
        shared.activeHeaderRefreshHandler = null
        const requests: string[]          = []
        const frames: string[]            = []
        const entry                       = {
            id: 'fixture',
            effective_enabled: true,
            metadata: { name: 'Fixture' },
            logo: '',
            menus: [{ path: '/v0/resource/plugins/fixture/index.html', menu: 'Fixture', description: 'Fixture' }],
        }
        const common                      = {
            isCurrentConnection: () => true,
            setLoading: noop,
            setError: noop,
            setData: noop,
            t: translate,
            getErrorMessage,
            authGeneration: 7,
            apiClient: { getAuthGeneration: () => 7 },
        }
        const sessionToken                = 'a'.repeat(64)
        const resourceScope               = {
            ...common,
            loadSeqRef: { current: 0 },
            loadAbortRef: { current: null },
            pluginID: 'fixture',
            resourceKey: entry.menus[0].path,
            pluginsApi: {
                list: async () => {
                    requests.push('resource-list');
                    return { plugins: [entry] }
                },
            },
            collectPluginResourceEntries,
            resolvePluginAssetURL,
            apiBase: 'https://fixture.invalid/cpa',
            sessionToken,
            MANAGEMENT_SESSION_HEADER,
            // noinspection JSUnusedGlobalSymbols
            'setIframeSrc': (value: string) => {
                if (value) {
                    frames.push(value)
                }
            },
            trustedPluginResourceURL: sourceInitializer(
                'pages/PluginResourcePage.tsx',
                'trustedPluginResourceURL',
                {
                    normalizeApiBase,
                    pluginResourcePathPrefix: '/v0/resource/plugins/',
                    window: { location: { origin: 'https://fixture.invalid' } },
                },
            ),
            fetch: async (url: string, options: RequestInit) => {
                expect(url).toBe('https://fixture.invalid/cpa/v0/resource/plugins/fixture/index.html')
                expect(options).toEqual({
                                            credentials: 'include',
                                            headers: { [MANAGEMENT_SESSION_HEADER]: sessionToken },
                                            redirect: 'error',
                                            signal: expect.any(AbortSignal),
                                        })
                requests.push('resource-preflight')
                return { ok: true }
            },
        }
        const pages                       = [
            {
                file: 'pages/PluginManagementPage.tsx',
                loader: 'fetchPlugins',
                scope: {
                    ...common,
                    requestSequence: { current: 0 },
                    setStatus: noop,
                    setRefreshing: noop,
                    pluginsApi: {
                        list: async () => {
                            requests.push('management');
                            return { plugins: [entry] }
                        },
                    },
                },
            },
            {
                file: 'pages/PluginStorePage.tsx',
                loader: 'loadStore',
                scope: {
                    ...common, loadAbortRef: { current: null }, pluginStoreApi: {
                        list: async () => {
                            requests.push('store');
                            return { plugins: [] }
                        },
                    }, isAbortError: () => false,
                },
            },
            { file: 'pages/PluginResourcePage.tsx', loader: 'loadResource', scope: resourceScope },
        ]
        try {
            const trigger = sourceInitializer<() => Promise<void>>(
                'hooks/useHeaderRefresh.ts',
                'triggerHeaderRefresh',
                {},
            )
            for (const page of pages) {
                const handler = sourceCallback<() => Promise<void>>(page.file, page.loader, page.scope)
                let cleanup: (() => void) | undefined
                sourceExpression(
                    page.file,
                    (node, tree) => ts.isCallExpression(node) &&
                                    node.expression.getText(tree) ===
                                    'useHeaderRefresh',
                    {
                        [page.loader]: handler,
                        useHeaderRefresh: (registered: typeof handler) => {
                            cleanup =
                                sourceCallback<() => () => void>(
                                    'hooks/useHeaderRefresh.ts',
                                    'useEffect',
                                    { handler: registered },
                                )()
                        },
                    },
                )
                await trigger()
                cleanup!()
                const count = requests.length
                await trigger()
                expect(requests.length).toBe(count)
            }
            expect(requests).toEqual(['management', 'store', 'resource-list', 'resource-preflight'])
            expect(frames).toEqual(['https://fixture.invalid/cpa/v0/resource/plugins/fixture/index.html'])
        } finally {
            if (previous === undefined) {
                delete shared.activeHeaderRefreshHandler
            } else {
                shared.activeHeaderRefreshHandler = previous
            }
        }
    })
})
