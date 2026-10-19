import {describe, expect, mock, test} from 'bun:test'
import React from 'react'
import {readFileSync} from 'node:fs'
import type {PluginEntry, PluginStoreEntry, PluginStoreResponse} from '@/services/api/plugins'
import {getErrorMessage} from '@/utils/helpers'
import {getGitHubRepositorySlug, isValidManualReleaseTag, supportsPluginVersionSelection} from '@/pages/pluginReleaseVersions'
import {buildRepositoryURL, getPluginConfirmToken, isDefaultPluginStoreSource, isOfficialPlugin, resolvePluginAssetURL} from '@/pages/pluginResources'
import {sourceCallback, sourceInitializer} from './sourceCallbacks'

const managementPage = 'pages/PluginManagementPage.tsx'
const storePage = 'pages/PluginStorePage.tsx'
const pollingFile = 'pages/pluginPolling.ts'
const plugin: PluginEntry = {
    id: 'fixture', path: '', configured: true, registered: true, enabled: true, effective_enabled: true,
    supports_oauth: false, logo: '', config: {}, config_fields: [], menus: [], metadata: null,
}
const entry: PluginStoreEntry = {
    store_id: 'fixture-store', source_id: 'fixture-source', source_name: 'Fixture', source_url: 'https://fixture.example',
    id: plugin.id, name: 'Fixture', description: '', author: '', version: '1.0.0', repository: 'https://github.com/example/fixture',
    install_type: 'github-release', auth_required: false, auth_configured: true, installed: true, installed_version: '1.0.0',
    path: '', configured: true, registered: true, enabled: true, effective_enabled: true, update_available: true,
}
const listing: PluginStoreResponse = {plugins_enabled: true, plugins_dir: 'fixtures', sources: [], plugins: [entry]}
const installResult = {status: 'ok', source_id: entry.source_id, restart_required: false}
const effects = ['setData', 'setLoading', 'setError', 'setSavingPluginID', 'setDeletingPluginID', 'setDeletePluginTarget',
    'setEditingPlugin', 'setConfigDraft', 'setJsonDraft', 'setConfigError', 'setSavingConfig', 'showNotification',
    'setInstallingKey', 'setInstallEntry', 'setInstallVersion', 'setReleaseVersions', 'setReleaseVersionsError',
    'setReleaseVersionsLoading', 'setGateEntry', 'setGateIsUpdate', 'setGateRequestedVersion', 'setGateStep', 'setGateTyped',
    'setRestartRequiredKeys', 'clearConfigCache', 'notifyPluginResourcesChanged'] as const

function context() {
    let generation = 1
    const mountedRef = {current: true}
    const writes = Object.fromEntries(effects.map((name) => [name, mock((_value?: unknown) => {})]))
    const scope = {
        ...writes, authGeneration: 1, apiClient: {getAuthGeneration: () => generation}, mountedRef,
        isCurrentConnection: () => mountedRef.current && generation === 1,
        t: (key: string) => key, getErrorMessage,
    }
    return {
        scope, writes, change: (next = 2) => {generation = next},
        clearWrites: () => Object.values(writes).forEach((write) => write.mockClear()),
        expectNoWrites: () => Object.values(writes).forEach((write) => expect(write).not.toHaveBeenCalled()),
    }
}

function management(request = mock(async () => ({restart_required: true}))) {
    const current = context()
    const fetchPlugins = mock(async () => {})
    const scope = {
        ...current.scope, pluginsApi: {setEnabled: request, deletePlugin: request, patchConfig: request}, fetchPlugins,
        deletePluginTarget: plugin, editingPlugin: plugin, savingConfig: false, deletingPluginID: null,
        configDraft: {enabled: false, remove: null, options: {fixture: true}}, jsonDraft: {}, stringifyConfigValue: JSON.stringify,
    }
    return {...current, scope, request, fetchPlugins}
}

const mutationActions = ['handleTogglePlugin', 'handleDeletePlugin', 'handleSaveConfig'] as const
function mutate(flow: ReturnType<typeof management>, action: typeof mutationActions[number]) {
    const callback = sourceCallback<(plugin?: PluginEntry, enabled?: boolean) => Promise<void>>(managementPage, action, flow.scope)
    return action === 'handleTogglePlugin' ? callback(plugin, false) : callback()
}

function store() {
    const current = context()
    const list = mock(async () => listing)
    const install = mock(async () => installResult)
    const releases = mock(async () => [{tagName: 'v1.0.0', name: 'Fixture', prerelease: false}])
    const poll = mock(async () => ({response: listing, plugin: entry, timedOut: false}))
    const scope = {
        ...current.scope, pluginStoreApi: {list, install}, fetchPluginReleaseVersions: releases, waitForPluginStoreState: poll,
        loadAbortRef: {current: null as AbortController | null}, releaseAbortRef: {current: null as AbortController | null},
        installAbortRef: {current: null as AbortController | null}, isAbortError: (error: unknown) => error instanceof DOMException && error.name === 'AbortError',
        pluginStoreErrorRestartRequired: (error: unknown) => Boolean((error as {details?: {restart_required?: boolean}})?.details?.restart_required),
        supportsPluginVersionSelection, getGitHubRepositorySlug, isValidManualReleaseTag,
        storeEntryKey: (item: PluginStoreEntry) => item.store_id || `${item.source_id}/${item.id}`,
        pluginVersionMatches: (left: string, right: string) => left.replace(/^v/i, '') === right.replace(/^v/i, ''),
        installEntry: entry, installVersion: 'v1.0.0', installingKey: '', gateEntry: entry, gateIsUpdate: true,
        gateRequestedVersion: 'v1.0.0', gateStep: 3, gateTyped: getPluginConfirmToken(entry), getPluginConfirmToken,
        isOfficialPlugin: () => true,
    }
    const runInstall = sourceCallback<(item: PluginStoreEntry, update: boolean, version?: string) => Promise<void>>(storePage, 'runInstall', scope)
    const closeGate = sourceInitializer<() => void>(storePage, 'closeGate', scope)
    const loadReleaseVersions = sourceCallback<(item: PluginStoreEntry) => Promise<void>>(storePage, 'loadReleaseVersions', scope)
    return {...current, scope: {...scope, runInstall, closeGate, loadReleaseVersions}, list, install, releases, poll, runInstall}
}

function readStore(flow: ReturnType<typeof store>, release = false) {
    return release
        ? sourceCallback<(item: PluginStoreEntry) => Promise<void>>(storePage, 'loadReleaseVersions', flow.scope)(entry)
        : sourceCallback<() => Promise<void>>(storePage, 'loadStore', flow.scope)()
}

function polling() {
    let generation = 1
    const scheduled: Array<() => void> = []
    const timerReady = Promise.withResolvers<void>()
    const list = mock(async (_config?: {signal?: AbortSignal}) => listing)
    const abortError = sourceInitializer<() => DOMException>(pollingFile, 'abortError', {})
    const throwIfAborted = sourceInitializer<(signal?: AbortSignal) => void>(pollingFile, 'throwIfAborted', {abortError})
    const wait = sourceInitializer<(ms: number, signal?: AbortSignal) => Promise<void>>(pollingFile, 'wait', {
        throwIfAborted, abortError, window: {
            setTimeout: (work: () => void) => {scheduled.push(work); timerReady.resolve(); return scheduled.length},
            clearTimeout: mock(),
        },
    })
    const callback = sourceCallback<(id: string, source: string, predicate: (item: PluginStoreEntry) => boolean,
        timeout?: number, interval?: number, signal?: AbortSignal, generation?: number) => Promise<{timedOut: boolean; plugin: PluginStoreEntry | null}>>(
        pollingFile, 'waitForPluginStoreState', {
            apiClient: {getAuthGeneration: () => generation}, pluginStoreApi: {list}, throwIfAborted, wait, abortError,
            PLUGIN_STATE_TIMEOUT_MS: 15000, PLUGIN_STATE_INTERVAL_MS: 500,
        },
    )
    return {list, scheduled, timerReady, callback, change: () => {generation = 3}}
}

function renderPage(file: string, values: Record<string, unknown>) {
    const text = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')
    const componentName = file === managementPage ? 'PluginManagementPage' : 'PluginStorePage'
    const component = text.slice(text.indexOf(`export function ${componentName}`))
    const names = [...component.matchAll(/const \[(\w+),\s*\w+\]\s*=\s*useState/g)].map((match) => match[1])
    const states: Record<string, unknown> = {}
    let index = 0
    let generation = 1
    const noop = () => null
    const scope = {
        React, apiClient: {getAuthGeneration: () => generation}, pluginsApi: {list: mock()}, pluginStoreApi: {list: mock()},
        useTranslation: () => ({t: (key: string) => key}), useNavigate: () => mock(),
        useAuthStore: (selector: (state: unknown) => unknown) => selector({apiBase: 'https://fixture.example', managementKey: 'fixture-key', connectionStatus: 'connected'}),
        useNotificationStore: () => ({showNotification: mock()}), useConfigStore: () => mock(),
        useState: (initial: unknown) => {
            const name = names[index++]
            if (!(name in states)) {
                states[name] = typeof initial === 'function' ? (initial as () => unknown)() : initial
            }
            return [states[name], (next: unknown) => {
                states[name] = typeof next === 'function' ? (next as (current: unknown) => unknown)(states[name]) : next
            }]
        },
        useRef: (initial: unknown) => ({current: initial}), useEffect: noop,
        useCallback: (work: unknown) => work, useMemo: (work: () => unknown) => work(),
        Sheet: noop, Card: noop, Button: noop, Input: noop, Modal: noop, Select: noop, ToggleSwitch: noop, OAuthLoginAction: noop,
        IconDownload: noop, IconExternalLink: noop, IconGithub: noop, IconRefreshCw: noop, IconSearch: noop, IconSettings: noop,
        IconShield: noop, IconSlidersHorizontal: noop, EmptyState: noop, Link: noop, styles: {},
        EMPTY_PLUGIN_STORE_ENTRIES: [], pluginTitle: () => 'Fixture', storeEntryTitle: () => 'Fixture',
        supportsPluginVersionSelection, getPluginConfirmToken, buildGitHubReleasesPageURL: () => '',
        isValidManualReleaseTag, normalizePluginVersion: (value: string) => value, getGitHubRepositorySlug,
        storeEntryKey: sourceInitializer(storePage, 'storeEntryKey', {}),
        formatPluginVersion: sourceInitializer(storePage, 'formatPluginVersion', {normalizePluginVersion: (value: string) => value}),
        isOfficialPlugin, isDefaultPluginStoreSource, buildRepositoryURL, resolvePluginAssetURL, StoreLogo: noop,
    }
    const page = sourceCallback<() => unknown>(file, file === managementPage ? 'PluginManagementPage' : 'PluginStorePage', scope)
    page()
    Object.assign(states, values)
    generation = 3
    index = 0
    page()
    return states
}

describe('plugin management connection ownership', () => {
    for (const action of mutationActions) {
        test(`${action} publishes its current successful result`, async () => {
            const flow = management()
            await mutate(flow, action)
            expect(flow.request).toHaveBeenCalledTimes(1)
            expect(flow.fetchPlugins).toHaveBeenCalledWith({silent: true})
            expect(flow.writes.showNotification).toHaveBeenCalledWith(
                action === 'handleDeletePlugin' ? 'plugin_management.delete_success' : 'plugin_management.save_success', 'success',
            )
            if (action === 'handleSaveConfig') {
                expect(flow.request).toHaveBeenCalledWith(plugin.id, flow.scope.configDraft)
            }
        })
        test(`${action} still exposes a current failure`, async () => {
            const flow = management(mock(async () => {throw new Error('Fixture mutation failed')}))
            await mutate(flow, action)
            expect(flow.fetchPlugins).not.toHaveBeenCalled()
            if (action === 'handleSaveConfig') {
                expect(flow.writes.setConfigError).toHaveBeenLastCalledWith('Fixture mutation failed')
            } else {
                expect(flow.writes.showNotification).toHaveBeenCalledWith(expect.stringContaining('Fixture mutation failed'), 'error')
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
                test(`${action} ignores an old ${success ? 'success' : 'failure'} at generation ${generation}`, async () => {
                    const response = Promise.withResolvers<{restart_required: boolean}>()
                    const flow = management(mock(() => response.promise))
                    const pending = mutate(flow, action)
                    flow.change(generation)
                    flow.clearWrites()
                    if (success) {
                        response.resolve({restart_required: true})
                    } else {
                        response.reject(new Error('Old fixture mutation failed'))
                    }
                    await pending
                    flow.expectNoWrites()
                    expect(flow.fetchPlugins).not.toHaveBeenCalled()
                })
            }
        }
        test(`${action} does not announce results after unmount`, async () => {
            const response = Promise.withResolvers<{restart_required: boolean}>()
            const flow = management(mock(() => response.promise))
            const pending = mutate(flow, action)
            flow.scope.mountedRef.current = false
            flow.clearWrites()
            response.resolve({restart_required: true})
            await pending
            flow.expectNoWrites()
            expect(flow.fetchPlugins).not.toHaveBeenCalled()
        })
    }

    for (const name of ['openConfig', 'closeConfig', 'closeDelete']) {
        test(`${name} cannot change a new connection's selection`, () => {
            const flow = management()
            const callback = sourceCallback<(item: PluginEntry) => void>(managementPage, name, flow.scope)
            flow.change(3)
            callback(plugin)
            flow.expectNoWrites()
        })
    }

    test('a new connection discards config and delete selections and mutation busy state before commit', () => {
        const states = renderPage(managementPage, {editingPlugin: plugin, deletePluginTarget: plugin, configDraft: {old: true},
            jsonDraft: {old: '{}'}, configError: 'Old error', savingConfig: true, savingPluginID: plugin.id, deletingPluginID: plugin.id,
            oauthSelection: {id: plugin.id, authGeneration: 1}, data: {...listing, authGeneration: 1}, storeLogos: {entries: [entry]}})
        for (const name of ['editingPlugin', 'deletePluginTarget', 'savingPluginID', 'deletingPluginID', 'oauthSelection', 'data', 'storeLogos']) {
            expect(states[name]).toBeNull()
        }
        expect(states.configDraft).toEqual({})
        expect(states.jsonDraft).toEqual({})
        expect(states.configError).toBeNull()
        expect(states.savingConfig).toBe(false)
    })
})

describe('plugin store connection ownership', () => {
    for (const release of [false, true]) {
        const name = release ? 'release versions' : 'store list'
        test(`${name} publishes the current result`, async () => {
            const flow = store()
            await readStore(flow, release)
            expect(release ? flow.writes.setReleaseVersions : flow.writes.setData).toHaveBeenLastCalledWith(release ? await flow.releases() : listing)
            expect(release ? flow.writes.setReleaseVersionsLoading : flow.writes.setLoading).toHaveBeenLastCalledWith(false)
        })
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
                    const flow = store()
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

    test('current installation keeps source/version, checks configured and runtime states, and announces success', async () => {
        const flow = store()
        await flow.runInstall(entry, true, 'v1.0.0')
        expect(flow.install).toHaveBeenCalledWith(entry.id, {sourceId: entry.source_id, version: 'v1.0.0'}, expect.objectContaining({signal: expect.any(AbortSignal)}))
        expect(flow.poll).toHaveBeenCalledTimes(2)
        expect(flow.writes.clearConfigCache).toHaveBeenCalledTimes(1)
        expect(flow.writes.notifyPluginResourcesChanged).toHaveBeenCalledTimes(1)
        expect(flow.writes.showNotification).toHaveBeenCalledWith('plugin_store.update_success', 'success')
        expect(flow.writes.setInstallingKey).toHaveBeenLastCalledWith('')
    })

    test('an old install callback cannot send or abort a new installation', async () => {
        const flow = store()
        const newer = new AbortController()
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
                const flow = store()
                const response = Promise.withResolvers<never>()
                const ready = Promise.withResolvers<void>()
                const wait = () => {ready.resolve(); return response.promise}
                if (phase === 'install') {
                    flow.install.mockImplementation(wait)
                } else if (phase === 'configuration poll') {
                    flow.poll.mockImplementationOnce(wait)
                } else {
                    flow.poll.mockImplementationOnce(async () => ({response: listing, plugin: entry, timedOut: false})).mockImplementationOnce(wait)
                }
                const pending = flow.runInstall(entry, false)
                await ready.promise
                flow.change(3)
                flow.clearWrites()
                if (success) {
                    response.resolve((phase === 'install' ? installResult : {response: listing, plugin: entry, timedOut: false}) as never)
                } else {
                    response.reject(new Error('Old fixture install failed'))
                }
                await pending
                flow.expectNoWrites()
                expect(flow.poll).toHaveBeenCalledTimes(phase === 'install' ? 0 : phase === 'configuration poll' ? 1 : 2)
            })
        }
    }

    for (const result of ['pending', 'restart', 'disabled', 'restart error']) {
        test(`current installation preserves its ${result} notice`, async () => {
            const flow = store()
            if (result === 'pending') {
                flow.poll.mockResolvedValue({response: listing, plugin: entry, timedOut: true})
            } else if (result === 'restart') {
                flow.install.mockResolvedValue({...installResult, restart_required: true})
            } else if (result === 'disabled') {
                flow.poll.mockResolvedValue({response: {...listing, plugins_enabled: false}, plugin: entry, timedOut: false})
            } else {
                flow.install.mockRejectedValue({details: {restart_required: true}})
            }
            await flow.runInstall(entry, false)
            expect(flow.writes.showNotification).toHaveBeenCalledWith(
                result === 'pending' ? 'plugin_store.status_pending' : result === 'disabled'
                    ? 'plugin_store.global_disabled_hint' : 'plugin_store.restart_required_notice', 'warning',
            )
            expect(flow.writes.setInstallingKey).toHaveBeenLastCalledWith('')
            expect(flow.writes.notifyPluginResourcesChanged).not.toHaveBeenCalled()
        })
    }

    test('current installation failures still reject and display their error', async () => {
        const flow = store()
        flow.install.mockRejectedValue(new Error('Fixture install failed'))
        await expect(flow.runInstall(entry, false)).rejects.toThrow('Fixture install failed')
        expect(flow.writes.showNotification).toHaveBeenCalledWith('Fixture install failed', 'error')
        expect(flow.writes.setInstallingKey).toHaveBeenLastCalledWith('')
    })

    for (const name of ['openInstallOptions', 'closeInstallOptions', 'closeGate', 'confirmInstallOptions', 'confirmGate']) {
        test(`${name} cannot reuse an old connection's installation selection`, async () => {
            const flow = store()
            const callback = sourceInitializer<(item?: PluginStoreEntry) => void | Promise<void>>(storePage, name, flow.scope)
            flow.change(3)
            await callback(entry)
            expect(flow.install).not.toHaveBeenCalled()
            expect(flow.releases).not.toHaveBeenCalled()
            flow.expectNoWrites()
        })
    }

    for (const name of ['confirmInstallOptions', 'confirmGate']) {
        test(`${name} does not clear the new connection's selection after its old installation resolves`, async () => {
            const flow = store()
            const response = Promise.withResolvers<typeof installResult>()
            flow.install.mockImplementation(() => response.promise)
            const pending = sourceInitializer<() => Promise<void>>(storePage, name, flow.scope)()
            flow.change(3)
            flow.clearWrites()
            response.resolve(installResult)
            await pending
            flow.expectNoWrites()
        })
    }

    test('the install owner passes its generation to both polling calls', async () => {
        const flow = store()
        await flow.runInstall(entry, false)
        for (const args of flow.poll.mock.calls as unknown[][]) {
            expect(args[6]).toBe(1)
        }
    })

    test('a new connection discards store results, selected versions, confirmation progress and busy state', () => {
        const states = renderPage(storePage, {data: listing, error: 'Old error', installingKey: entry.store_id, installEntry: entry,
            installVersion: 'v9.9.9', releaseVersions: [{tagName: 'v9.9.9'}], releaseVersionsError: 'Old release error',
            releaseVersionsLoading: true, gateEntry: entry, gateStep: 3, gateTyped: 'old fixture', gateRequestedVersion: 'v9.9.9',
            restartRequiredKeys: [entry.store_id]})
        expect(states.data).toBeNull()
        expect(states.installEntry).toBeNull()
        expect(states.gateEntry).toBeNull()
        for (const name of ['error', 'installingKey', 'installVersion', 'releaseVersionsError', 'gateTyped', 'gateRequestedVersion']) {
            expect(states[name]).toBe('')
        }
        expect(states.releaseVersions).toEqual([])
        expect(states.restartRequiredKeys).toEqual([])
        expect(states.releaseVersionsLoading).toBe(false)
        expect(states.gateStep).toBe(1)
    })
})

describe('plugin install polling connection ownership', () => {
    test('current matched state is returned without another request', async () => {
        const flow = polling()
        const predicate = mock(() => true)
        const result = await flow.callback(entry.id, entry.source_id, predicate)
        expect(result.plugin).toEqual(entry)
        expect(result.timedOut).toBe(false)
        expect(flow.list).toHaveBeenCalledTimes(1)
    })
    test('current unmatched state keeps the actual timeout result', async () => {
        const flow = polling()
        const result = await flow.callback(entry.id, entry.source_id, () => false, 0)
        expect(result.timedOut).toBe(true)
        expect(flow.list).toHaveBeenCalledTimes(1)
    })
    test('a supplied old install generation is rejected before requesting another server', async () => {
        const flow = polling()
        flow.change()
        await expect(flow.callback(entry.id, entry.source_id, () => true, undefined, undefined, undefined, 1)).rejects.toMatchObject({name: 'AbortError'})
        expect(flow.list).not.toHaveBeenCalled()
    })
    test('the first old response never reaches the completion predicate', async () => {
        const flow = polling()
        const response = Promise.withResolvers<PluginStoreResponse>()
        flow.list.mockImplementation(() => response.promise)
        const predicate = mock(() => true)
        const pending = flow.callback(entry.id, entry.source_id, predicate)
        flow.change()
        response.resolve(listing)
        await expect(pending).rejects.toMatchObject({name: 'AbortError'})
        expect(predicate).not.toHaveBeenCalled()
        expect(flow.list).toHaveBeenCalledTimes(1)
    })
    test('a generation change during the wait never requests a list from the new connection', async () => {
        const flow = polling()
        flow.list.mockImplementationOnce(async () => listing).mockImplementation(async () => {throw new Error('New connection list was requested')})
        const pending = flow.callback(entry.id, entry.source_id, () => false)
        await flow.timerReady.promise
        flow.change()
        flow.scheduled[0]()
        await expect(pending).rejects.toMatchObject({name: 'AbortError'})
        expect(flow.list).toHaveBeenCalledTimes(1)
    })
    test('explicit cancellation before the first request remains effective', async () => {
        const flow = polling()
        const controller = new AbortController()
        controller.abort()
        await expect(flow.callback(entry.id, entry.source_id, () => true, undefined, undefined, controller.signal)).rejects.toMatchObject({name: 'AbortError'})
        expect(flow.list).not.toHaveBeenCalled()
    })
})

for (const page of [managementPage, storePage]) {
    test(`${page} subscribes to the actual authentication generation`, () => {
        const apiClient = {getAuthGeneration: () => 3}
        const useAuthStore = mock((select: () => unknown) => select())
        expect(sourceInitializer<number>(page, 'authGeneration', {apiClient, useAuthStore})).toBe(3)
        expect(useAuthStore).toHaveBeenCalledTimes(1)
    })
    test(`${page} cleanup invalidates the mounted owner and aborts its controllers`, () => {
        const current = context()
        const loadAbortRef = {current: new AbortController()}
        const installAbortRef = {current: new AbortController()}
        const releaseAbortRef = {current: new AbortController()}
        const effect = sourceCallback<() => () => void>(page, 'useEffect', {
            ...current.scope, loadAbortRef, installAbortRef, releaseAbortRef,
        }, 'mountedRef.current = true')
        const cleanup = effect()
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
        const current = context()
        const isCurrent = sourceCallback<() => boolean>(page, 'isCurrentConnection', current.scope)
        expect(isCurrent()).toBe(true)
        current.change(3)
        expect(isCurrent()).toBe(false)
        current.change(1)
        current.scope.mountedRef.current = false
        expect(isCurrent()).toBe(false)
    })
}
