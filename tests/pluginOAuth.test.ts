import {describe, expect, mock, spyOn, test} from 'bun:test'
import {createOAuthAttempts} from '@/components/credentials/oauthAttempts'
import {apiClient} from '@/services/api/client'
import {oauthApi} from '@/services/api/oauth'
import {type PluginEntry, pluginsApi} from '@/services/api/plugins'
import {readFileSync} from 'node:fs'
import {sourceCallback, sourceInitializer} from './sourceCallbacks'

const pluginEntry = (id: string, overrides: Partial<PluginEntry> = {}): PluginEntry => ({
    id, path: '', configured: true, registered: true, enabled: true, effective_enabled: true,
    supports_oauth: true, logo: '', config: {}, config_fields: [], menus: [], metadata: null,
    ...overrides,
})

describe('plugin OAuth routing', () => {
    test('preserves declared providers and limits legacy inference to built-in aliases', async () => {
        const get = spyOn(apiClient, 'get').mockResolvedValue({
            plugins_enabled: true,
            plugins_dir: 'plugins',
            plugins: [
                pluginEntry('binary-name', {oauth_provider: ' Custom-Provider '}),
                pluginEntry('claude'),
                pluginEntry('claude', {oauth_provider: ''}),
                pluginEntry('different-binary', {oauth_provider: 'gemini-cli'}),
                pluginEntry('codex', {oauth_provider: '../../unexpected'}),
                pluginEntry('unknown-binary'),
                pluginEntry('without-oauth', {supports_oauth: false, oauth_provider: 'custom-provider'}),
            ],
        })
        try {
            const result = await pluginsApi.list()
            expect(result.plugins.map((plugin) => plugin.oauth_provider)).toEqual([
                'custom-provider', 'anthropic', undefined, 'gemini-cli', undefined, undefined, undefined,
            ])
        } finally {
            get.mockRestore()
        }
    })

    test('carries provider identity, nonce and cancellation through plugin login requests', async () => {
        const get = spyOn(apiClient, 'get').mockResolvedValue({status: 'wait'})
        const post = spyOn(apiClient, 'post').mockResolvedValue({status: 'ok'})
        const remove = spyOn(apiClient, 'delete').mockResolvedValue({status: 'ok', cancelled: true})
        const controller = new AbortController()
        try {
            await oauthApi.startAuth('custom-provider', {plugin: true, nonce: 'plugin-nonce', signal: controller.signal})
            expect(get).toHaveBeenLastCalledWith('/custom-provider-auth-url', {
                params: {is_webui: true, nonce: 'plugin-nonce'}, signal: controller.signal,
            })
            await oauthApi.getAuthStatus('plugin-state', 'plugin-nonce', controller.signal)
            expect(get).toHaveBeenLastCalledWith('/get-auth-status', {
                params: {state: 'plugin-state', nonce: 'plugin-nonce'}, signal: controller.signal,
            })
            await oauthApi.submitCallback('gemini-cli', 'https://callback.invalid/?state=plugin-state', controller.signal, true)
            expect(post).toHaveBeenLastCalledWith('/oauth-callback', {
                provider: 'gemini-cli', redirect_url: 'https://callback.invalid/?state=plugin-state',
            }, {signal: controller.signal})
            await oauthApi.cancelSession('plugin-state', 'plugin-nonce', controller.signal)
            expect(remove).toHaveBeenLastCalledWith('/oauth-session', {
                params: {state: 'plugin-state', nonce: 'plugin-nonce'}, signal: controller.signal,
            })
            await oauthApi.submitCallback('gemini-cli', 'https://callback.invalid/?state=builtin-state', controller.signal)
            expect(post).toHaveBeenLastCalledWith('/oauth-callback', {
                provider: 'gemini', redirect_url: 'https://callback.invalid/?state=builtin-state',
            }, {signal: controller.signal})
        } finally {
            get.mockRestore()
            post.mockRestore()
            remove.mockRestore()
        }
    })
})

const actionFile = 'components/credentials/OAuthLoginAction.tsx'
const pageFile = 'pages/PluginManagementPage.tsx'

function loginScope(provider: string) {
    const attempts = createOAuthAttempts({setTimeout: () => 0, clearTimeout: () => {}, getGeneration: () => 3})
    return {
        provider, plugin: true, attemptsRef: {current: attempts}, nonceRef: {current: 'plugin-nonce'}, oauthApi,
        oauthState: 'plugin-state', callbackUrl: ' https://callback.invalid/?state=plugin-state ',
        setUrl: mock(), setUserCode: mock(), setOauthState: mock(), setStatus: mock(), setError: mock(),
        setCallbackAccepted: mock(), setCallbackSubmitting: mock(), setCancelSubmitting: mock(),
        onSuccess: mock(), onCancel: mock(), startPolling: mock(), t: (key: string) => key,
    }
}

describe('plugin OAuth login consumers', () => {
    for (const provider of ['custom-provider', 'gemini-cli', 'xai', 'devin']) {
        test(`manual callback retains ${provider} identity without built-in transformations`, async () => {
            const submit = spyOn(oauthApi, 'submitCallback').mockResolvedValue({status: 'ok'})
            const scope = loginScope(provider)
            const attempt = scope.attemptsRef.current.begin(provider)
            const handle = sourceCallback<() => Promise<void>>(actionFile, 'submitCallback', scope)
            try {
                await handle()
                expect(submit).toHaveBeenCalledWith(provider, scope.callbackUrl.trim(), attempt.signal, true)
                expect(scope.setCallbackAccepted).toHaveBeenCalledWith(true)
                expect(scope.startPolling).toHaveBeenCalledWith('plugin-state', 'plugin-nonce', attempt)
                expect(scope.setCallbackSubmitting.mock.calls.map((call) => call[0])).toEqual([true, false])
            } finally {
                submit.mockRestore()
                scope.attemptsRef.current.invalidateAll()
            }
        })
    }

    for (const outcome of ['cancelled', 'pending', 'failed']) {
        test(`session cancellation ${outcome} preserves ownership and polling`, async () => {
            const remove = spyOn(oauthApi, 'cancelSession')
            if (outcome === 'failed') {
                remove.mockRejectedValue(new Error('synthetic cancellation failure'))
            } else {
                remove.mockResolvedValue({status: 'ok', cancelled: outcome === 'cancelled'})
            }
            const scope = loginScope('custom-provider')
            const previous = scope.attemptsRef.current.begin(scope.provider)
            const handle = sourceCallback<() => Promise<void>>(actionFile, 'handleCancel', scope)
            try {
                await handle()
                expect(previous.signal.aborted).toBe(true)
                expect(remove).toHaveBeenCalledTimes(1)
                const [state, nonce, signal] = remove.mock.calls[0]
                expect([state, nonce]).toEqual(['plugin-state', 'plugin-nonce'])
                if (outcome === 'cancelled') {
                    expect(signal?.aborted).toBe(true)
                    expect(scope.onCancel).toHaveBeenCalledTimes(1)
                    expect(scope.startPolling).not.toHaveBeenCalled()
                    expect(scope.nonceRef.current).toBe('')
                } else {
                    const current = scope.attemptsRef.current.get(scope.provider)
                    expect(current?.isCurrent()).toBe(true)
                    expect(scope.onCancel).not.toHaveBeenCalled()
                    expect(scope.startPolling).toHaveBeenCalledWith('plugin-state', 'plugin-nonce', current)
                    expect(scope.nonceRef.current).toBe('plugin-nonce')
                    if (outcome === 'failed') {
                        expect(scope.setError).toHaveBeenCalledWith('synthetic cancellation failure')
                    }
                }
            } finally {
                remove.mockRestore()
                scope.attemptsRef.current.invalidateAll()
            }
        })
    }

    test('cancelling while the login URL is loading aborts delivery before closing', async () => {
        let deliver!: (response: {url: string; state: string}) => void
        const start = spyOn(oauthApi, 'startAuth').mockImplementation(() => new Promise((resolve) => { deliver = resolve }))
        const remove = spyOn(oauthApi, 'cancelSession').mockResolvedValue({status: 'ok', cancelled: true})
        const open = mock()
        const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
        Object.defineProperty(globalThis, 'window', {configurable: true, value: {open}})
        const scope = {...loginScope('custom-provider'), oauthState: '', generateNonce: () => 'plugin-nonce',
            needsProjectId: false, projectId: '', safeExternalUrl: (url: string) => url}
        const startAuth = sourceCallback<() => Promise<void>>(actionFile, 'startAuth', scope)
        const cancel = sourceCallback<() => Promise<void>>(actionFile, 'handleCancel', scope)
        try {
            const request = startAuth()
            const signal = start.mock.calls[0][1]?.signal
            await cancel()
            expect(signal?.aborted).toBe(true)
            expect(scope.onCancel).toHaveBeenCalledTimes(1)
            expect(remove).not.toHaveBeenCalled()
            deliver({url: 'https://login.invalid', state: 'plugin-state'})
            await request
            expect(open).not.toHaveBeenCalled()
            expect(scope.setUrl).not.toHaveBeenCalled()
            expect(scope.startPolling).not.toHaveBeenCalled()
            const source = readFileSync(new URL('../src/components/credentials/OAuthLoginAction.tsx', import.meta.url), 'utf8')
            expect(source.slice(source.indexOf('// idle or starting'))).toContain('onClick={() => void handleCancel()}')
        } finally {
            start.mockRestore()
            remove.mockRestore()
            scope.attemptsRef.current.invalidateAll()
            if (originalWindow) {
                Object.defineProperty(globalThis, 'window', originalWindow)
            } else {
                Reflect.deleteProperty(globalThis, 'window')
            }
        }
    })
})

describe('plugin login selection ownership', () => {
    const plugin = pluginEntry('binary-name', {oauth_provider: 'custom-provider'})
    for (const scenario of ['current', 'old connection', 'global disabled', 'plugin disabled', 'no OAuth', 'no provider']) {
        test(`selection: ${scenario}`, () => {
            const selected = sourceInitializer<PluginEntry | undefined>(pageFile, 'oauthPlugin', {
                pluginsEnabled: scenario !== 'global disabled', currentData: {authGeneration: 3},
                oauthSelection: {id: plugin.id, authGeneration: scenario === 'old connection' ? 2 : 3},
                plugins: [{...plugin, effective_enabled: scenario !== 'plugin disabled',
                    supports_oauth: scenario !== 'no OAuth', oauth_provider: scenario === 'no provider' ? undefined : 'custom-provider'}],
            })
            expect(selected?.oauth_provider).toBe(scenario === 'current' ? 'custom-provider' : undefined)
        })
    }

    for (const staleCause of ['new request', 'new connection', 'unmount']) {
        for (const failure of [false, true]) {
            test(`ignores ${failure ? 'failed' : 'successful'} stale list after ${staleCause}`, async () => {
                let generation = 3
                const requestSequence = {current: 0}
                let resolve!: (value: Awaited<ReturnType<typeof pluginsApi.list>>) => void
                let reject!: (error: Error) => void
                const pending = new Promise<Awaited<ReturnType<typeof pluginsApi.list>>>((done, fail) => { resolve = done; reject = fail })
                const list = mock(() => pending)
                const setData = mock()
                const setStatus = mock()
                const setError = mock()
                const setRefreshing = mock()
                const fetchPlugins = sourceCallback<(options?: {silent?: boolean}) => Promise<void>>(pageFile, 'fetchPlugins', {
                    requestSequence, authGeneration: 3, isCurrentConnection: () => generation === 3,
                    apiClient: {getAuthGeneration: () => generation}, pluginsApi: {list},
                    setData, setStatus, setError, setRefreshing, t: (key: string) => key,
                })
                const request = fetchPlugins({silent: true})
                if (staleCause === 'new connection') {
                    ++generation
                } else if (staleCause === 'unmount') {
                    const clearTimeout = mock()
                    const effect = sourceCallback<() => () => void>(pageFile, 'useEffect', {
                        requestSequence, fetchPlugins, window: {setTimeout: () => 1, clearTimeout},
                    }, 'fetchPlugins')
                    effect()()
                    expect(clearTimeout).toHaveBeenCalledWith(1)
                } else {
                    ++requestSequence.current
                }
                if (failure) {
                    reject(new Error('old request failed'))
                } else {
                    resolve({plugins_enabled: true, plugins_dir: 'plugins', plugins: [plugin]})
                }
                await request
                expect(setData).not.toHaveBeenCalled()
                expect(setStatus).not.toHaveBeenCalled()
                expect(setError.mock.calls.map((call) => call[0])).toEqual([null])
                expect(setRefreshing.mock.calls.map((call) => call[0])).toEqual([true])
            })
        }
    }

    test('current list publishes the provider metadata and authentication generation', async () => {
        const data = {plugins_enabled: true, plugins_dir: 'plugins', plugins: [plugin]}
        const setData = mock()
        const setStatus = mock()
        const setRefreshing = mock()
        const fetchPlugins = sourceCallback<(options?: {silent?: boolean}) => Promise<void>>(pageFile, 'fetchPlugins', {
            requestSequence: {current: 0}, authGeneration: 3, isCurrentConnection: () => true,
            apiClient: {getAuthGeneration: () => 3}, pluginsApi: {list: async () => data},
            setData, setStatus, setError: mock(), setRefreshing, t: (key: string) => key,
        })
        await fetchPlugins({silent: true})
        expect(setData).toHaveBeenCalledWith({...data, authGeneration: 3})
        expect(setStatus).toHaveBeenCalledWith('ready')
        expect(setRefreshing.mock.calls.map((call) => call[0])).toEqual([true, false])
        const page = readFileSync(new URL('../src/pages/PluginManagementPage.tsx', import.meta.url), 'utf8')
        expect(page).toContain('provider={oauthPlugin.oauth_provider}')
        expect(page).toMatch(/<OAuthLoginAction[\s\S]*?\n\s+plugin\n/)
    })
})
