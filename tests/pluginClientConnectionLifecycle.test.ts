import {Sheet} from '@/components/common/Sheet'
import {Card} from '@/components/ui/Card'
import '@/i18n'
import {
    getGitHubRepositorySlug,
    isValidManualReleaseTag,
    supportsPluginVersionSelection,
} from '@/pages/pluginReleaseVersions'
import {
    buildRepositoryURL,
    getPluginConfirmToken,
    isDefaultPluginStoreSource,
    isOfficialPlugin,
    resolvePluginAssetURL,
} from '@/pages/pluginResources'
import {apiClient} from '@/services/api/client'
import {encodePluginConfigPatch, pluginConfigFieldMatches} from '@/services/api/pluginConfigJSON'
import {
    type PluginEntry,
    pluginsApi,
    pluginStoreApi,
    type PluginStoreEntry,
    type PluginStoreResponse,
} from '@/services/api/plugins'
import {getErrorMessage} from '@/utils/helpers'
import {AxiosError, type AxiosInstance} from 'axios'
import {describe, expect, mock, test} from 'bun:test'
import {readFileSync} from 'node:fs'
import React, {type ReactElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {sourceCallback, sourceInitializer} from './sourceCallbacks'

const managementPage               = 'pages/PluginManagementPage.tsx'
const storePage                    = 'pages/PluginStorePage.tsx'
const pollingFile                  = 'pages/pluginPolling.ts'
const plugin: PluginEntry          = {
    id: 'fixture', path: '', configured: true, registered: true, enabled: true, effective_enabled: true,
    supports_oauth: false, logo: '', config: {}, config_fields: [], menus: [], metadata: null,
}
const entry: PluginStoreEntry      = {
    store_id: 'fixture-store',
    source_id: 'fixture-source',
    source_name: 'Fixture',
    source_url: 'https://fixture.example',
    id: plugin.id,
    name: 'Fixture',
    description: '',
    author: '',
    version: '1.0.0',
    repository: 'https://github.com/example/fixture',
    install_type: 'github-release',
    auth_required: false,
    auth_configured: true,
    installed: true,
    installed_version: '1.0.0',
    path: '',
    configured: true,
    registered: true,
    enabled: true,
    effective_enabled: true,
    update_available: true,
}
const listing: PluginStoreResponse = { plugins_enabled: true, plugins_dir: 'fixtures', sources: [], plugins: [entry] }
const installResult                = { status: 'ok', source_id: entry.source_id, restart_required: false }
const effects                      = [
    'setData',
    'setLoading',
    'setError',
    'setSavingPluginID',
    'setDeletingPluginID',
    'setDeletePluginTarget',
    'setEditingPlugin',
    'setConfigDraft',
    'setConfigError',
    'setConfigReadState',
    'setSavingConfig',
    'showNotification',
    'setInstallingKey',
    'setInstallEntry',
    'setInstallVersion',
    'setReleaseVersions',
    'setReleaseVersionsError',
    'setReleaseVersionsLoading',
    'setGateEntry',
    'setGateIsUpdate',
    'setGateRequestedVersion',
    'setGateStep',
    'setGateTyped',
    'setRestartRequiredKeys',
    'clearConfigCache',
    'notifyPluginResourcesChanged',
] as const

function context() {
    let generation   = 1
    const mountedRef = { current: true }
    const writes     = Object.fromEntries(effects.map((name) => [
        name, mock((_value?: unknown) => {
        }),
    ]))
    const scope      = {
        ...writes, authGeneration: 1, apiClient: { getAuthGeneration: () => generation }, mountedRef,
        isCurrentConnection: () => mountedRef.current && generation === 1,
        t: (key: string) => key, getErrorMessage,
    }
    return {
        scope, writes, change: (next = 2) => {
            generation = next
        },
        clearWrites: () => Object.values(writes).forEach((write) => write.mockClear()),
        expectNoWrites: () => Object.values(writes).forEach((write) => expect(write).not.toHaveBeenCalled()),
    }
}

function management(request = mock(async (..._args: unknown[]) => ({ restart_required: false }))) {
    const current           = context()
    const list              = { plugins_enabled: true, plugins_dir: 'fixtures', plugins: [] }
    const publishPluginList = mock()
    const write             = async (...args: unknown[]) => {
        const result   = await request(...args)
        const callback = args[args.length - 1] as (snapshot: typeof list) => void
        if (current.scope.isCurrentConnection()) {
            callback(list)
        }
        return result
    }
    const scope             = {
        configReadState: 'ready', ...current.scope,
        pluginsApi: {
            setEnabled: write, deletePlugin: write, patchConfig: write,
            getConfig: async () => ({ enabled: 'false' }),
        },
        publishPluginList,
        confirmPluginRuntime: mock(async () => list),
        notifyConfigSaved: sourceCallback(managementPage, 'notifyConfigSaved', current.scope),
        hasSavedPluginConfig: sourceCallback(managementPage, 'hasSavedPluginConfig', {}),
        deletePluginTarget: plugin, editingPlugin: { ...plugin, config: { enabled: 'true' } },
        savingConfig: false, deletingPluginID: null, configDraft: { enabled: 'false' },
        encodePluginConfigPatch, pluginConfigFieldMatches,
        closeConfig: () => current.writes.setEditingPlugin(null),
    }
    return { ...current, scope, request, publishPluginList }
}

const mutationActions = ['handleTogglePlugin', 'handleDeletePlugin', 'handleSaveConfig'] as const

function mutate(flow: ReturnType<typeof management>, action: typeof mutationActions[number]) {
    const callback = sourceCallback<(plugin?: PluginEntry, enabled?: boolean) => Promise<void>>(
        managementPage,
        action,
        flow.scope,
    )
    return action === 'handleTogglePlugin' ? callback(plugin, false) : callback()
}

function store() {
    const current             = context()
    const list                = mock(async () => listing)
    const install             = mock(async () => installResult)
    const releases            = mock(async () => [{ tagName: 'v1.0.0', name: 'Fixture', prerelease: false }])
    const poll                = mock(async () => ({ response: listing, plugin: entry, timedOut: false }))
    const scope               = {
        ...current.scope,
        pluginStoreApi: { list, install },
        fetchPluginReleaseVersions: releases,
        waitForPluginStoreState: poll,
        loadAbortRef: { current: null as AbortController | null },
        releaseAbortRef: { current: null as AbortController | null },
        installAbortRef: { current: null as AbortController | null },
        isAbortError: (error: unknown) => error instanceof DOMException && error.name === 'AbortError',
        // noinspection JSUnusedGlobalSymbols
        'pluginStoreErrorRestartRequired': (error: unknown) => Boolean((error as {
            details?: { restart_required?: boolean }
        })?.details?.restart_required),
        supportsPluginVersionSelection,
        getGitHubRepositorySlug,
        isValidManualReleaseTag,
        storeEntryKey: (item: PluginStoreEntry) => item.store_id || `${item.source_id}/${item.id}`,
        // noinspection JSUnusedGlobalSymbols
        'pluginVersionMatches': (left: string, right: string) => left.replace(/^v/i, '') === right.replace(/^v/i, ''),
        installEntry: entry,
        installVersion: 'v1.0.0',
        installingKey: '', loading: false, error: '',
        gateEntry: entry,
        gateIsUpdate: true,
        gateRequestedVersion: 'v1.0.0',
        gateStep: 3,
        gateTyped: getPluginConfirmToken(entry),
        getPluginConfirmToken,
        // noinspection JSUnusedGlobalSymbols
        'isOfficialPlugin': () => true,
    }
    const runInstall          = sourceCallback<(
        item: PluginStoreEntry,
        update: boolean,
        version?: string,
    ) => Promise<void>>(
        storePage,
        'runInstall',
        { ...scope, loadStore: sourceCallback(storePage, 'loadStore', scope) },
    )
    const closeGate           = sourceInitializer<() => void>(storePage, 'closeGate', scope)
    const loadReleaseVersions = sourceCallback<(item: PluginStoreEntry) => Promise<void>>(
        storePage,
        'loadReleaseVersions',
        scope,
    )
    return {
        ...current,
        scope: { ...scope, runInstall, closeGate, loadReleaseVersions },
        list,
        install,
        releases,
        poll,
        runInstall,
    }
}

function readStore(flow: ReturnType<typeof store>, release = false) {
    return release
           ?
           sourceCallback<(item: PluginStoreEntry) => Promise<void>>(
               storePage,
               'loadReleaseVersions',
               flow.scope,
           )(
               entry)
           :
           sourceCallback<() => Promise<void>>(storePage, 'loadStore', flow.scope)()
}

function polling() {
    let generation                     = 1
    const scheduled: Array<() => void> = []
    const timerReady                   = Promise.withResolvers<void>()
    const list                         = mock(async (_config?: { signal?: AbortSignal }) => listing)
    const abortError                   = sourceInitializer<() => DOMException>(pollingFile, 'abortError', {})
    const throwIfAborted               = sourceInitializer<(signal?: AbortSignal) => void>(
        pollingFile,
        'throwIfAborted',
        { abortError },
    )
    const wait                         = sourceInitializer<(ms: number, signal?: AbortSignal) => Promise<void>>(
        pollingFile,
        'wait',
        {
            throwIfAborted, abortError, window: {
                setTimeout: (work: () => void) => {
                    scheduled.push(work);
                    timerReady.resolve();
                    return scheduled.length
                },
                clearTimeout: mock(),
            },
        },
    )
    const callback                     = sourceCallback<(
        id: string,
        source: string,
        predicate: (item: PluginStoreEntry) => boolean,
        timeout?: number,
        interval?: number,
        signal?: AbortSignal,
        generation?: number,
    ) => Promise<{ timedOut: boolean; plugin: PluginStoreEntry | null }>>(
        pollingFile, 'waitForPluginStoreState', {
            apiClient: { getAuthGeneration: () => generation },
            pluginStoreApi: { list },
            throwIfAborted,
            wait,
            abortError,
            PLUGIN_STATE_TIMEOUT_MS: 15000,
            PLUGIN_STATE_INTERVAL_MS: 500,
        },
    )
    return {
        list, scheduled, timerReady, callback, change: () => {
            generation = 3
        },
    }
}

function renderPage(file: string, values: Record<string, unknown>, nextGeneration = 3) {
    const text = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')

    const componentName = file === managementPage ? 'PluginManagementPage' : 'PluginStorePage'

    const component = text.slice(text.indexOf(`export function ${componentName}`))

    const names = [...component.matchAll(/const \[(?<state>\w+),\s*\w+]\s*=\s*useState/g)].map(
        (match) => match[1])

    const states: Record<string, unknown> = {}

    let index = 0

    let generation = 1

    const noop = () => null

    const scope = {
        React,
        apiClient: { getAuthGeneration: () => generation },
        pluginsApi: { list: mock() },
        pluginStoreApi: { list: mock() },
        useTranslation: () => ({ t: (key: string) => key }),
        useNavigate: () => mock(),
        useAuthStore: (selector: (state: unknown) => unknown) => selector({
                                                                              apiBase: 'https://fixture.example',
                                                                              managementKey: 'fixture-key',
                                                                              connectionStatus: 'connected',
                                                                          }),
        useNotificationStore: () => ({ showNotification: mock() }),
        useConfigStore: () => mock(),
        useState: (initial: unknown) => {
            const name = names[index++]
            if (!(name in states)) {
                states[name] = typeof initial === 'function' ? (initial as () => unknown)() : initial
            }
            return [
                states[name], (next: unknown) => {
                    states[name] =
                        typeof next === 'function' ? (next as (current: unknown) => unknown)(states[name]) : next
                },
            ]
        },
        useRef: (initial: unknown) => ({ current: initial }),
        useEffect: noop,
        useHeaderRefresh: noop,
        useCallback: (work: unknown) => work,
        useMemo: (work: () => unknown) => work(),
        Sheet,
        Card,
        Button: ({ children, disabled }: { children: React.ReactNode; disabled?: boolean }) =>
            React.createElement('button', { disabled }, children),
        Input: noop,
        Modal: noop,
        Select: noop,
        ToggleSwitch: noop,
        OAuthLoginAction: noop,
        IconDownload: noop,
        IconExternalLink: noop,
        IconGithub: noop,
        IconRefreshCw: noop,
        IconSearch: noop,
        IconSettings: noop,
        IconShield: noop,
        IconSlidersHorizontal: noop,
        EmptyState: ({ title, description, action }: {
            title: string;
            description?: string;
            action?: React.ReactNode
        }) =>
            React.createElement('div', null, title, description, action),
        Link: noop,
        styles: {},
        configInput: sourceCallback(managementPage, 'configInput', {}),
        EMPTY_PLUGIN_STORE_ENTRIES: [],
        // noinspection JSUnusedGlobalSymbols
        'pluginTitle': () => 'Fixture',
        // noinspection JSUnusedGlobalSymbols
        'storeEntryTitle': () => 'Fixture',
        supportsPluginVersionSelection,
        getPluginConfirmToken,
        // noinspection JSUnusedGlobalSymbols
        'buildGitHubReleasesPageURL': () => '',
        isValidManualReleaseTag,
        normalizePluginVersion: (value: string) => value,
        getGitHubRepositorySlug,
        storeEntryKey: sourceInitializer(storePage, 'storeEntryKey', {}),
        formatPluginVersion: sourceInitializer(
            storePage,
            'formatPluginVersion',
            { normalizePluginVersion: (value: string) => value },
        ),
        isOfficialPlugin,
        isDefaultPluginStoreSource,
        buildRepositoryURL,
        resolvePluginAssetURL,
        StoreLogo: noop,
    }

    const page = sourceCallback<() => ReactElement>(file, componentName, scope)
    page()
    Object.assign(states, values)
    generation = nextGeneration
    index      = 0
    const view = page()
    return { states, view }
}

for (const [status, code, message] of [
    [409, 'plugin_delete_requires_restart', 'plugin_management.delete_restart_required'],
    [503, 'plugin_runtime_sync_failed', 'plugin_management.delete_partial'],
] as const) {
    test(`publishes the live list after committed deletion returns ${status}`, async () => {
        const flow            = management()
        const instance        = (apiClient as unknown as { instance: AxiosInstance }).instance
        const adapter         = instance.defaults.adapter
        const calls: string[] = []
        const live            = {
            plugins_enabled: true, plugins_dir: 'fixtures', plugins: status === 409 ?
                [{ ...plugin, path: '', configured: false, enabled: false, effective_enabled: false }] : [],
        }
        apiClient.setConfig({ apiBase: 'https://fixture.invalid', sessionToken: '' })
        instance.defaults.adapter = async (config) => {
            calls.push(`${config.method} ${config.url}`)
            if (config.method === 'delete' && config.url === '/plugins/fixture') {
                const receipt = {
                    mutation_id: config.headers['X-CPA-Mutation-ID'], request_id: 'fixture',
                    outcome: 'partial', confirmed_effect: true, audit_available: true,
                    effects: [{ kind: 'plugin.deleted', target: 'plugin' }],
                }
                throw new AxiosError('synthetic post-commit failure', 'ERR_BAD_RESPONSE', config, undefined, {
                    config, status, statusText: code, headers: { 'X-CPA-Mutation-Result': JSON.stringify(receipt) },
                    data: {
                        error: code,
                        file_deleted: true,
                        configured_removed: true,
                        restart_required: status === 409,
                    },
                })
            }
            if (config.method === 'get' && config.url === '/plugins') {
                return { config, status: 200, statusText: 'OK', headers: {}, data: live }
            }
            throw new Error(`Unexpected request ${config.method} ${config.url}`)
        }
        try {
            await sourceCallback<() => Promise<void>>(
                managementPage,
                'handleDeletePlugin',
                { ...flow.scope, pluginsApi },
            )()
            expect(calls).toEqual(['delete /plugins/fixture', 'get /plugins'])
            expect(flow.publishPluginList).toHaveBeenCalledWith(live)
            expect(flow.writes.setDeletePluginTarget).toHaveBeenCalledWith(null)
            expect(flow.writes.showNotification).toHaveBeenCalledWith(message, 'warning')
        } finally {
            instance.defaults.adapter = adapter
            apiClient.setConfig({ apiBase: '', sessionToken: '' })
        }
    })
}

for (const [outcome, errorCode] of [
    ['partial', 'runtime_sync_failed'], ['partial', 'plugin_install_finalize_failed'], ['uncertain', null],
] as const) {
    test(`refreshes the store after ${errorCode ?? outcome} installation without replaying the write`, async () => {
        const flow            = store()
        const instance        = (apiClient as unknown as { instance: AxiosInstance }).instance
        const adapter         = instance.defaults.adapter
        const calls: string[] = []
        let id: string | undefined
        const receipt         = () => ({
            mutation_id: id, request_id: 'fixture', outcome, audit_available: true,
            confirmed_effect: true, effects: [
                {
                    kind: errorCode === 'runtime_sync_failed' ? 'plugin.published' : 'configuration.persisted',
                    target: errorCode === 'runtime_sync_failed' ? 'plugin' : 'configuration',
                },
            ],
        })
        apiClient.setConfig({ apiBase: 'https://fixture.invalid', sessionToken: '' })
        instance.defaults.adapter = async (config) => {
            calls.push(`${config.method} ${config.url}`)
            if (config.method === 'post' && config.url?.startsWith('/plugin-store/fixture/install?')) {
                id            = String(config.headers['X-CPA-Mutation-ID'])
                const headers = { 'X-CPA-Mutation-Result': JSON.stringify(receipt()) }
                if (errorCode) {
                    throw new AxiosError('synthetic post-commit failure', 'ERR_BAD_RESPONSE', config, undefined, {
                        config, status: 503, statusText: 'Unavailable', headers,
                        data: { error: errorCode, restart_required: errorCode === 'plugin_install_finalize_failed' },
                    })
                }
                return { config, status: 200, statusText: 'OK', headers, data: { status: 'installed' } }
            }
            if (config.method === 'get') {
                const data = config.url === '/plugin-store' ? listing : config.url === `/mutations/${id}` ? receipt() :
                                                                        config.url === '/plugins' ?
                                                                            { plugins: [plugin] } :
                                                                        undefined
                if (data) {
                    return { config, status: 200, statusText: 'OK', headers: {}, data }
                }
            }
            throw new Error(`Unexpected request ${config.method} ${config.url}`)
        }
        try {
            const scope   = { ...flow.scope, pluginStoreApi }
            const install = sourceCallback<(value: PluginStoreEntry, update: boolean) => Promise<void>>(
                storePage,
                'runInstall',
                {
                    ...scope,
                    loadStore: sourceCallback(
                        storePage,
                        'loadStore',
                        scope,
                    ),
                },
            )
            await install(entry, true)
            expect(calls.filter((call) => call.startsWith('post'))).toHaveLength(1)
            expect(calls.filter((call) => call === 'get /plugin-store')).toHaveLength(1)
            expect(flow.writes.setData).toHaveBeenCalledWith(listing)
            expect(flow.writes.showNotification).toHaveBeenCalledWith(outcome === 'partial' ?
                                                                      'plugin_store.install_partial' :
                                                                      expect.stringContaining(id!), 'warning')
            if (errorCode === 'plugin_install_finalize_failed') {
                expect(flow.writes.showNotification).toHaveBeenCalledWith(
                    'plugin_store.restart_required_notice',
                    'warning',
                )
            }
        } finally {
            instance.defaults.adapter = adapter
            apiClient.setConfig({ apiBase: '', sessionToken: '' })
        }
    })
}

test('store renders unknown values on a failed first read, real zero on success, and a marked stale list', () => {
    const failed = renderToStaticMarkup(renderPage(
        storePage,
        { data: null, loading: false, error: 'HTTP 502' },
        1,
    ).view)
    expect(failed).toContain('<strong>—</strong>')
    expect(failed).not.toContain('<strong>0</strong>')
    expect(failed).toContain('plugin_store.load_failed')
    expect(failed).toContain('common.retry')
    expect(failed).not.toContain('plugin_store.no_plugins')
    const empty = renderToStaticMarkup(renderPage(
        storePage,
        { data: { ...listing, plugins: [] }, loading: false },
        1,
    ).view)
    expect(empty).toContain('<strong>0</strong>')
    expect(empty).toContain('<strong>fixtures</strong>')
    expect(empty).toContain('plugin_store.no_plugins')
    const stale = renderToStaticMarkup(renderPage(
        storePage,
        { data: listing, loading: false, error: 'HTTP 429' },
        1,
    ).view)
    expect(stale).toContain('plugin_store.stale')
    expect(stale).toContain('Fixture')
    expect(stale).toContain('<button disabled="">plugin_store.update</button>')
})

describe('plugin management connection ownership', () => {
    for (const action of mutationActions) {
        test(`${action} publishes its current successful result`, async () => {
            const flow = management()
            await mutate(flow, action)
            expect(flow.request).toHaveBeenCalledTimes(1)
            if (action === 'handleDeletePlugin') {
                expect(flow.publishPluginList).toHaveBeenCalledWith(expect.objectContaining({ plugins: [] }))
            } else {
                expect(flow.scope.confirmPluginRuntime).toHaveBeenCalledTimes(1)
            }
            expect(flow.writes.showNotification).toHaveBeenCalledWith(
                action === 'handleDeletePlugin' ? 'plugin_management.delete_success' : 'plugin_management.save_success',
                'success',
            )
            if (action === 'handleSaveConfig') {
                expect(flow.request).toHaveBeenCalledWith(plugin.id, '{"enabled":false}', expect.any(Function))
            }
        })
        test(`${action} still exposes a current failure`, async () => {
            const flow = management(mock(async () => {
                throw new Error('Fixture mutation failed')
            }))
            await mutate(flow, action)
            expect(flow.publishPluginList).not.toHaveBeenCalled()
            if (action === 'handleSaveConfig') {
                expect(flow.writes.setConfigError).toHaveBeenLastCalledWith('Fixture mutation failed')
            } else {
                expect(flow.writes.showNotification).toHaveBeenCalledWith(expect.stringContaining(
                    'Fixture mutation failed'), 'error')
            }
        })
        for (const generation of [2, 3]) {
            test(`${action} refuses an old confirmation at generation ${generation}`, async () => {
                const flow = management()
                flow.change(generation)
                await mutate(flow, action)
                expect(flow.request).not.toHaveBeenCalled()
                flow.expectNoWrites()
            })
            for (const success of [true, false]) {
                test(
                    `${action} ignores an old ${success ? 'success' : 'failure'} at generation ${generation}`,
                    async () => {
                        const response = Promise.withResolvers<{ restart_required: boolean }>()
                        const flow     = management(mock(() => response.promise))
                        const pending  = mutate(flow, action)
                        flow.change(generation)
                        flow.clearWrites()
                        if (success) {
                            response.resolve({ restart_required: true })
                        } else {
                            response.reject(new Error('Old fixture mutation failed'))
                        }
                        await pending
                        flow.expectNoWrites()
                        expect(flow.publishPluginList).not.toHaveBeenCalled()
                    },
                )
            }
        }
        test(`${action} does not announce results after unmount`, async () => {
            const response                = Promise.withResolvers<{ restart_required: boolean }>()
            const flow                    = management(mock(() => response.promise))
            const pending                 = mutate(flow, action)
            flow.scope.mountedRef.current = false
            flow.clearWrites()
            response.resolve({ restart_required: true })
            await pending
            flow.expectNoWrites()
            expect(flow.publishPluginList).not.toHaveBeenCalled()
        })
    }

    for (const name of ['openConfig', 'closeConfig', 'closeDelete']) {
        test(`${name} cannot change a new connection's selection`, () => {
            const flow     = management()
            const callback = sourceCallback<(item: PluginEntry) => void>(managementPage, name, flow.scope)
            flow.change(3)
            callback(plugin)
            flow.expectNoWrites()
        })
    }

    test('a plugin list error stays distinct from a confirmed empty and disabled list', () => {
        const failure = renderToStaticMarkup(renderPage(managementPage, {
            data: null, status: 'error', error: 'plugin_config_encode_failed',
        }, 1).view)
        expect(failure).toContain('role="alert"')
        expect(failure).toContain('plugin_config_encode_failed')
        expect(failure).not.toContain('plugin_management.global_disabled_title')
        expect(failure).not.toContain('plugin_management.empty_title')
        expect(failure).not.toContain('<strong>common.no</strong>')
        expect(failure).not.toContain('<strong>0</strong>')
        expect(failure).not.toContain('plugin_management.search_placeholder')

        const failedRefresh = renderToStaticMarkup(renderPage(managementPage, {
            data: { plugins_enabled: false, plugins_dir: 'fixtures', plugins: [], authGeneration: 1 },
            status: 'error', error: 'synthetic refresh error',
        }, 1).view)
        expect(failedRefresh).toContain('role="alert"')
        expect(failedRefresh).toContain('synthetic refresh error')
        expect(failedRefresh).not.toContain('plugin_management.global_disabled_title')
        expect(failedRefresh).not.toContain('<strong>common.no</strong>')
        expect(failedRefresh).not.toContain('<strong>0</strong>')

        const empty = renderToStaticMarkup(renderPage(managementPage, {
            data: { plugins_enabled: false, plugins_dir: 'fixtures', plugins: [], authGeneration: 1 },
            status: 'empty',
        }, 1).view)
        expect(empty).toContain('plugin_management.global_disabled_title')
        expect(empty).toContain('plugin_management.empty_title')
        expect(empty).toContain('<strong>common.no</strong>')
        expect(empty).toContain('<strong>fixtures</strong>')
        expect(empty).toContain('<strong>0</strong>')
        expect(empty).not.toContain('role="alert"')
    })

    test('a new connection discards config and delete selections and mutation busy state before commit', () => {
        const { states } = renderPage(managementPage, {
            configReadState: 'ready',
            editingPlugin: plugin,
            deletePluginTarget: plugin,
            configDraft: { old: '{}' },
            configError: 'Old error',
            savingConfig: true,
            savingPluginID: plugin.id,
            deletingPluginID: plugin.id,
            oauthSelection: { id: plugin.id, authGeneration: 1 },
            data: { ...listing, authGeneration: 1 },
            storeLogos: { entries: [entry] },
        })
        for (const name of
            [
                'editingPlugin',
                'deletePluginTarget',
                'savingPluginID',
                'deletingPluginID',
                'oauthSelection',
                'data',
                'storeLogos',
            ]) {
            expect(states[name]).toBeNull()
        }
        expect(states.configDraft).toEqual({})
        expect(states.configError).toBeNull()
        expect(states.savingConfig).toBe(false)
    })
})

describe(
    'plugin store connection ownership',
    () => {
        for (const release of [false, true]) {
            const name = release ? 'release versions' : 'store list'
            test(
                `${name} publishes the current result`,
                async () => {
                    const flow = store()
                    await readStore(flow, release)
                    expect(release ? flow.writes.setReleaseVersions : flow.writes.setData).toHaveBeenLastCalledWith(
                        release ?
                        await flow.releases() :
                        listing)
                    expect(release ? flow.writes.setReleaseVersionsLoading : flow.writes.setLoading)
                        .toHaveBeenLastCalledWith(
                            false)
                },
            )
            test(`${name} refuses a retained callback before sending`, async () => {
                const flow = store()
                flow.change(3)
                await readStore(flow, release)
                expect(release ? flow.releases : flow.list).not.toHaveBeenCalled()
                flow.expectNoWrites()
            })
            for (const staleCause of ['connection', 'ABA', 'abort', 'unmount']) {
                for (const success of [true, false]) {
                    test(`${name} ignores its old ${success ? 'success' : 'failure'} after ${staleCause}`, async () => {
                        const flow     = store()
                        const response = Promise.withResolvers<never>()
                        if (release) {
                            flow.releases.mockImplementation(() => response.promise)
                        } else {
                            flow.list.mockImplementation(() => response.promise)
                        }
                        const pending = readStore(flow, release)
                        if (staleCause === 'abort') {
                            (release ? flow.scope.releaseAbortRef : flow.scope.loadAbortRef).current?.abort()
                        } else if (staleCause === 'unmount') {
                            flow.scope.mountedRef.current = false
                        } else {
                            flow.change(staleCause === 'ABA' ? 3 : 2)
                        }
                        flow.clearWrites()
                        if (success) {
                            response.resolve((release ? [] : listing) as never)
                        } else {
                            response.reject(new Error('Old fixture read failed'))
                        }
                        await pending
                        flow.expectNoWrites()
                    })
                }
            }
        }

        test(
            'current installation keeps source/version, checks configured and runtime states, and announces success',
            async () => {
                const flow = store()
                await flow.runInstall(entry, true, 'v1.0.0')
                expect(flow.install).toHaveBeenCalledWith(
                    entry.id,
                    { sourceId: entry.source_id, version: 'v1.0.0' },
                    expect.objectContaining({ signal: expect.any(AbortSignal) }),
                )
                expect(flow.poll).toHaveBeenCalledTimes(2)
                expect(flow.writes.clearConfigCache).toHaveBeenCalledTimes(1)
                expect(flow.writes.notifyPluginResourcesChanged).toHaveBeenCalledTimes(1)
                expect(flow.writes.showNotification).toHaveBeenCalledWith('plugin_store.update_success', 'success')
                expect(flow.writes.setInstallingKey).toHaveBeenLastCalledWith('')
            },
        )

        test('an old install callback cannot send or abort a new installation', async () => {
            const flow                         = store()
            const newer                        = new AbortController()
            flow.scope.installAbortRef.current = newer
            flow.change(3)
            await flow.runInstall(entry, false)
            expect(flow.install).not.toHaveBeenCalled()
            expect(newer.signal.aborted).toBe(false)
            flow.expectNoWrites()
        })

        for (const phase of ['install', 'configuration poll', 'runtime poll']) {
            for (const success of [true, false]) {
                test(`ignores an old ${success ? 'success' : 'failure'} in ${phase}`, async () => {
                    const flow     = store()
                    const response = Promise.withResolvers<never>()
                    const ready    = Promise.withResolvers<void>()
                    const wait     = () => {
                        ready.resolve();
                        return response.promise
                    }
                    if (phase === 'install') {
                        flow.install.mockImplementation(wait)
                    } else if (phase === 'configuration poll') {
                        flow.poll.mockImplementationOnce(wait)
                    } else {
                        flow.poll.mockImplementationOnce(async () => ({
                            response: listing,
                            plugin: entry,
                            timedOut: false,
                        })).mockImplementationOnce(wait)
                    }
                    const pending = flow.runInstall(entry, false)
                    await ready.promise
                    flow.change(3)
                    flow.clearWrites()
                    if (success) {
                        response.resolve((phase === 'install' ?
                                          installResult :
                            { response: listing, plugin: entry, timedOut: false }) as never)
                    } else {
                        response.reject(new Error('Old fixture install failed'))
                    }
                    await pending
                    flow.expectNoWrites()
                    expect(flow.poll).toHaveBeenCalledTimes(phase === 'install' ?
                                                            0 :
                                                            phase === 'configuration poll' ? 1 : 2)
                })
            }
        }

        for (const result of ['pending', 'restart', 'disabled', 'restart error']) {
            test(`current installation preserves its ${result} notice`, async () => {
                const flow = store()
                if (result === 'pending') {
                    flow.poll.mockResolvedValue({ response: listing, plugin: entry, timedOut: true })
                } else if (result === 'restart') {
                    flow.install.mockResolvedValue({ ...installResult, restart_required: true })
                } else if (result === 'disabled') {
                    flow.poll.mockResolvedValue({
                                                    response: { ...listing, plugins_enabled: false },
                                                    plugin: entry,
                                                    timedOut: false,
                                                })
                } else {
                    flow.install.mockRejectedValue({ details: { restart_required: true } })
                }
                await flow.runInstall(entry, false)
                expect(flow.writes.showNotification).toHaveBeenCalledWith(
                    result === 'pending' ? 'plugin_store.status_pending' : result === 'disabled'
                                                                           ?
                                                                           'plugin_store.global_disabled_hint' :
                                                                           'plugin_store.restart_required_notice',
                    'warning',
                )
                expect(flow.writes.setInstallingKey).toHaveBeenLastCalledWith('')
                expect(flow.writes.notifyPluginResourcesChanged).not.toHaveBeenCalled()
            })
        }

        test('current installation failures still reject and display their error', async () => {
            const flow = store()
            flow.install.mockRejectedValue(new Error('Fixture install failed'))
            expect(flow.runInstall(entry, false)).rejects.toThrow('Fixture install failed')
            expect(flow.writes.showNotification).toHaveBeenCalledWith('Fixture install failed', 'error')
            expect(flow.writes.setInstallingKey).toHaveBeenLastCalledWith('')
        })

        for (const name of
            ['openInstallOptions', 'closeInstallOptions', 'closeGate', 'confirmInstallOptions', 'confirmGate']) {
            test(`${name} cannot reuse an old connection's installation selection`, async () => {
                const flow     = store()
                const callback = sourceInitializer<(item?: PluginStoreEntry) => void | Promise<void>>(
                    storePage,
                    name,
                    flow.scope,
                )
                flow.change(3)
                await callback(entry)
                expect(flow.install).not.toHaveBeenCalled()
                expect(flow.releases).not.toHaveBeenCalled()
                flow.expectNoWrites()
            })
        }

        for (const name of ['confirmInstallOptions', 'confirmGate']) {
            test(
                `${name} does not clear the new connection's selection after its old installation resolves`,
                async () => {
                    const flow     = store()
                    const response = Promise.withResolvers<typeof installResult>()
                    flow.install.mockImplementation(() => response.promise)
                    const pending = sourceInitializer<() => Promise<void>>(storePage, name, flow.scope)()
                    flow.change(3)
                    flow.clearWrites()
                    response.resolve(installResult)
                    await pending
                    flow.expectNoWrites()
                },
            )
        }

        test('the install owner passes its generation to both polling calls', async () => {
            const flow = store()
            await flow.runInstall(entry, false)
            for (const args of flow.poll.mock.calls as unknown[][]) {
                expect(args[6]).toBe(1)
            }
        })

        test('a new connection discards store results, selected versions, confirmation progress and busy state', () => {
            const { states } = renderPage(storePage, {
                data: listing,
                error: 'Old error',
                installingKey: entry.store_id,
                installEntry: entry,
                installVersion: 'v9.9.9',
                releaseVersions: [{ tagName: 'v9.9.9' }],
                releaseVersionsError: 'Old release error',
                releaseVersionsLoading: true,
                gateEntry: entry,
                gateStep: 3,
                gateTyped: 'old fixture',
                gateRequestedVersion: 'v9.9.9',
                restartRequiredKeys: [entry.store_id],
            })
            expect(states.data).toBeNull()
            expect(states.installEntry).toBeNull()
            expect(states.gateEntry).toBeNull()
            for (const name of
                [
                    'error',
                    'installingKey',
                    'installVersion',
                    'releaseVersionsError',
                    'gateTyped',
                    'gateRequestedVersion',
                ]) {
                expect(states[name]).toBe('')
            }
            expect(states.releaseVersions).toEqual([])
            expect(states.restartRequiredKeys).toEqual([])
            expect(states.releaseVersionsLoading).toBe(false)
            expect(states.gateStep).toBe(1)
        })
    },
)

describe('plugin install polling connection ownership', () => {
    test('each store read uses the remaining polling budget', async () => {
        let now                                  = 1000
        const budgets: Array<number | undefined> = []
        const controller                         = new AbortController()
        const callback                           = sourceCallback<(
            id: string,
            source: string,
            predicate: (item: PluginStoreEntry) => boolean,
            timeout?: number,
            interval?: number,
            signal?: AbortSignal,
        ) => Promise<{ timedOut: boolean; plugin: PluginStoreEntry | null }>>(
            pollingFile, 'waitForPluginStoreState', {
                apiClient: { getAuthGeneration: () => 1 },
                pluginStoreApi: {
                    list: async (config: { signal?: AbortSignal; timeout?: number }) => {
                        expect(config.signal).toBe(controller.signal)
                        budgets.push(config.timeout)
                        now += 1000
                        return { ...listing, plugins: [{ ...entry, registered: budgets.length > 1 }] }
                    },
                },
                Date: { now: () => now }, wait: async (duration: number) => {
                    now += duration
                },
                throwIfAborted: () => {
                }, abortError: () => new DOMException('aborted', 'AbortError'),
                PLUGIN_STATE_TIMEOUT_MS: 15000, PLUGIN_STATE_INTERVAL_MS: 500,
            },
        )
        const result                             = await callback(
            entry.id, entry.source_id, (item) => item.registered,
            undefined, undefined, controller.signal,
        )
        expect(budgets).toEqual([15000, 13500])
        expect(result.timedOut).toBe(false)
        expect(result.plugin?.registered).toBe(true)
    })
    test('current matched state is returned without another request', async () => {
        const flow      = polling()
        const predicate = mock(() => true)
        const result    = await flow.callback(entry.id, entry.source_id, predicate)
        expect(result.plugin).toEqual(entry)
        expect(result.timedOut).toBe(false)
        expect(flow.list).toHaveBeenCalledTimes(1)
    })
    test('current unmatched state keeps the actual timeout result', async () => {
        const flow   = polling()
        const result = await flow.callback(entry.id, entry.source_id, () => false, 0)
        expect(result.timedOut).toBe(true)
        expect(flow.list).toHaveBeenCalledTimes(1)
    })
    test('a supplied old install generation is rejected before requesting another server', async () => {
        const flow = polling()
        flow.change()
        expect(flow.callback(entry.id, entry.source_id, () => true, undefined, undefined, undefined, 1))
            .rejects
            .toMatchObject({ name: 'AbortError' })
        expect(flow.list).not.toHaveBeenCalled()
    })
    test('the first old response never reaches the completion predicate', async () => {
        const flow     = polling()
        const response = Promise.withResolvers<PluginStoreResponse>()
        flow.list.mockImplementation(() => response.promise)
        const predicate = mock(() => true)
        const pending   = flow.callback(entry.id, entry.source_id, predicate)
        flow.change()
        response.resolve(listing)
        expect(pending).rejects.toMatchObject({ name: 'AbortError' })
        expect(predicate).not.toHaveBeenCalled()
        expect(flow.list).toHaveBeenCalledTimes(1)
    })
    test('a generation change during the wait never requests a list from the new connection', async () => {
        const flow = polling()
        flow.list.mockImplementationOnce(async () => listing).mockImplementation(async () => {
            throw new Error('New connection list was requested')
        })
        const pending = flow.callback(entry.id, entry.source_id, () => false)
        await flow.timerReady.promise
        flow.change()
        flow.scheduled[0]()
        expect(pending).rejects.toMatchObject({ name: 'AbortError' })
        expect(flow.list).toHaveBeenCalledTimes(1)
    })
    test('explicit cancellation before the first request remains effective', async () => {
        const flow       = polling()
        const controller = new AbortController()
        controller.abort()
        expect(flow.callback(entry.id, entry.source_id, () => true, undefined, undefined, controller.signal))
            .rejects
            .toMatchObject({ name: 'AbortError' })
        expect(flow.list).not.toHaveBeenCalled()
    })
})

for (const page of [managementPage, storePage]) {
    test(`${page} subscribes to the actual authentication generation`, () => {
        const apiClient    = { getAuthGeneration: () => 3 }
        const useAuthStore = mock((select: () => unknown) => select())
        expect(sourceInitializer<number>(page, 'authGeneration', { apiClient, useAuthStore })).toBe(3)
        expect(useAuthStore).toHaveBeenCalledTimes(1)
    })
    test(`${page} cleanup invalidates the mounted owner and aborts its controllers`, () => {
        const current         = context()
        const loadAbortRef    = { current: new AbortController() }
        const installAbortRef = { current: new AbortController() }
        const releaseAbortRef = { current: new AbortController() }
        const effect          = sourceCallback<() => () => void>(page, 'useEffect', {
            ...current.scope, loadAbortRef, installAbortRef, releaseAbortRef,
        }, 'mountedRef.current = true')
        const cleanup         = effect()
        expect(current.scope.mountedRef.current).toBe(true)
        cleanup()
        expect(current.scope.mountedRef.current).toBe(false)
        if (page === storePage) {
            for (const ref of [loadAbortRef, installAbortRef, releaseAbortRef]) {
                expect(ref.current.signal.aborted).toBe(true)
            }
        }
    })
    test(`${page} owns callbacks with the authentication generation and mounted lifetime`, () => {
        const current   = context()
        const isCurrent = sourceCallback<() => boolean>(page, 'isCurrentConnection', current.scope)
        expect(isCurrent()).toBe(true)
        current.change(3)
        expect(isCurrent()).toBe(false)
        current.change(1)
        current.scope.mountedRef.current = false
        expect(isCurrent()).toBe(false)
    })
}
