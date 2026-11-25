import {groupVendorAuthFiles} from '@/components/credentials/hooks/useCredentialsData'
import {createVendorRegistry} from '@/components/credentials/hooks/useVendorRegistry'
import {createOAuthAttempts} from '@/components/credentials/oauthAttempts'
import {
    formatAuthFileDisplayName,
    inferProviderFromAuthFileName,
    normalizeAuthFileProvider,
    supportsAuthFileUsingApi,
    supportsAuthFileWebsockets,
} from '@/features/authFiles/constants'
import {apiClient} from '@/services/api/client'
import {oauthApi} from '@/services/api/oauth'
import {type PluginEntry, pluginsApi} from '@/services/api/plugins'
import {expect, mock, spyOn, test} from 'bun:test'
import React, {type ReactElement} from 'react'
import ts from 'typescript'
import {sourceCallback, sourceExpression, sourceInitializer} from './sourceCallbacks'

const aliases     = [
    ['anti-gravity', 'antigravity'], ['anti_gravity', 'antigravity'], ['grok', 'xai'],
    ['muse', 'meta'], ['x-ai', 'xai'], ['x.ai', 'xai'], ['x_ai', 'xai'], ['gemini_cli', 'gemini-cli'],
] as const
const icon        = () => null
const vendors     = createVendorRegistry({
                                             Gemini: icon,
                                             Claude: icon,
                                             Codex: icon,
                                             Meta: icon,
                                             Vertex: icon,
                                             OpenAI: icon,
                                             Kimi: icon,
                                             Qwen: icon,
                                             IFlow: icon,
                                             Grok: icon,
                                             Devin: icon,
                                             Generic: icon,
                                         })
const pluginEntry = (id: string, extra: Partial<PluginEntry> = {}): PluginEntry => ({
    id, path: '', configured: true, registered: true, enabled: true, effective_enabled: true,
    supports_oauth: true, logo: '', config: {}, config_fields: [], menus: [], metadata: null, ...extra,
})

for (const [alias, canonical] of aliases) {
    test(
        `AuthFile ${alias} metadata and filename reach the canonical vendor without changing credential identity`,
        () => {
            const input = ` ${alias.toUpperCase()} `
            expect(normalizeAuthFileProvider(input)).toBe(canonical)
            const name = `${alias.toUpperCase()}-fixture@example.invalid-plus.json`
            expect(inferProviderFromAuthFileName(name)).toBe(canonical)
            expect(formatAuthFileDisplayName(name)).toBe('fixture@example.invalid')
            const files  = [
                { name: 'first.json', provider: input, authIndex: 'first' },
                { name: 'second.json', type: input, authIndex: 'second' }, { name, authIndex: 'third' },
            ]
            const before = structuredClone(files)
            const target = vendors.find((vendor) => [...vendor.authFileTypes, ...vendor.oauthProviders].includes(
                canonical))
            expect(target).toBeDefined()
            const grouped = groupVendorAuthFiles(vendors, files)
            expect(grouped.get(target!.id)).toEqual(files)
            expect(grouped.get('other')).toEqual([])
            expect([...grouped.values()].flat()).toHaveLength(3)
            expect(grouped.get(target!.id)?.[0]).toBe(files[0])
            expect(files).toEqual(before)
            expect(supportsAuthFileUsingApi(input)).toBe(canonical === 'xai')
            expect(supportsAuthFileWebsockets(input)).toBe(canonical === 'xai')
        },
    )

    for (const declared of [true, false]) {
        test(
            `plugin ${declared ? 'declared' : 'legacy'} ${alias} reaches canonical OAuth login and callback requests`,
            async () => {
                const plugin         = declared ?
                                       pluginEntry(
                                           'different-binary',
                                           { oauth_provider: ` ${alias.toUpperCase()} ` },
                                       ) :
                                       pluginEntry(` ${alias.toUpperCase()} `)
                const get            = spyOn(apiClient, 'get')
                    .mockResolvedValueOnce({
                                               plugins_enabled: true,
                                               plugins_dir: 'plugins',
                                               plugins: [plugin],
                                           })
                    .mockResolvedValue({ url: 'https://login.invalid', state: 'synthetic-state' })
                const post           = spyOn(apiClient, 'post').mockResolvedValue({ status: 'ok' })
                const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
                const open           = mock()
                Object.defineProperty(globalThis, 'window', { configurable: true, value: { open } })
                const attempts = createOAuthAttempts({
                                                         setTimeout: () => 0, clearTimeout: () => {
                    }, getGeneration: () => 3,
                                                     })
                try {
                    const result         = await pluginsApi.list()
                    const oauthSelection = { id: plugin.id, authGeneration: 3 }
                    const oauthPlugin    = sourceInitializer<PluginEntry | undefined>(
                        'pages/PluginManagementPage.tsx',
                        'oauthPlugin',
                        {
                            pluginsEnabled: result.plugins_enabled,
                            currentData: { authGeneration: 3 },
                            oauthSelection,
                            plugins: result.plugins,
                        },
                    )
                    expect(oauthPlugin?.oauth_provider).toBe(canonical)
                    const action = sourceExpression<ReactElement<{
                        provider: string;
                        plugin: boolean;
                        disableControls: boolean
                    }>>(
                        'pages/PluginManagementPage.tsx', (node, tree) => ts.isJsxSelfClosingElement(node) &&
                                                                          node.tagName.getText(tree) ===
                                                                          'OAuthLoginAction', {
                            React, OAuthLoginAction: icon, oauthPlugin, oauthSelection,
                            connectionStatus: 'connected', savingPluginID: null, deletingPluginID: null,
                        })
                    expect(action.props.disableControls).toBe(false)
                    const scope = {
                        ...action.props, attemptsRef: { current: attempts }, nonceRef: { current: '' }, oauthApi,
                        generateNonce: () => 'synthetic-nonce', needsProjectId: false, projectId: '',
                        safeExternalUrl: (url: string) => url, setCallbackAccepted: mock(), setPhase: mock(),
                        setCancelSubmitting: mock(), setOauthState: mock(), setUserCode: mock(),
                        setStatus: mock(), setError: mock(), setUrl: mock(), startPolling: mock(),
                        t: (key: string) => key,
                    }
                    await sourceCallback<() => Promise<void>>(
                        'components/credentials/OAuthLoginAction.tsx',
                        'startAuth',
                        scope,
                    )()
                    const attempt = attempts.get(canonical)
                    expect(attempt?.isCurrent()).toBe(true)
                    const headers = { 'X-CPA-OAuth-Token': 'synthetic-nonce' }
                    expect(get).toHaveBeenLastCalledWith(`/${canonical}-auth-url`, {
                        params: { is_webui: true }, headers, signal: attempt?.signal,
                        mutationReadback: expect.any(Function),
                    })
                    expect(scope.setStatus).toHaveBeenLastCalledWith('waiting')
                    expect(scope.setError.mock.calls.map((call) => call[0])).toEqual([''])
                    expect(open).toHaveBeenCalledWith('https://login.invalid', '_blank', 'noopener,noreferrer')
                    const callback = sourceCallback<() => Promise<void>>(
                        'components/credentials/OAuthLoginAction.tsx',
                        'submitCallback', {
                            ...scope,
                            oauthState: 'synthetic-state',
                            callbackUrl: ' https://callback.invalid/?state=synthetic-state ',
                            setCallbackSubmitting: mock(),
                        },
                    )
                    await callback()
                    expect(post).toHaveBeenCalledWith('/oauth-callback', {
                        provider: canonical, redirect_url: 'https://callback.invalid/?state=synthetic-state',
                    }, { headers, signal: attempt?.signal, mutationReadback: expect.any(Function) })
                    expect(scope.setCallbackAccepted).toHaveBeenLastCalledWith(true)
                    expect(plugin.oauth_provider).toBe(declared ? ` ${alias.toUpperCase()} ` : undefined)
                } finally {
                    attempts.invalidateAll()
                    get.mockRestore()
                    post.mockRestore()
                    if (previousWindow) {
                        Object.defineProperty(globalThis, 'window', previousWindow)
                    } else {
                        Reflect.deleteProperty(globalThis, 'window')
                    }
                }
            },
        )
    }
}

test('AuthFile normalization retains custom providers, Cognition and authoritative metadata precedence', () => {
    expect(normalizeAuthFileProvider(' Cognition ')).toBe('devin')
    expect(inferProviderFromAuthFileName('cognition-fixture.json')).toBe('devin')
    expect(normalizeAuthFileProvider(' Custom_Provider ')).toBe('custom-provider')
    expect(normalizeAuthFileProvider('constructor')).toBe('constructor')
    expect(normalizeAuthFileProvider(null)).toBe('')
    expect(normalizeAuthFileProvider({ provider: 'grok' })).toBe('')
    const files  = [
        { name: 'anti-gravity-fixture.json', provider: 'unknown', type: 'x.ai' },
        { name: 'anti-gravity-fixture.json', provider: 'x.ai', type: 'codex' },
    ]
    const groups = groupVendorAuthFiles(vendors, files)
    expect(groups.get('other')).toEqual([files[0]])
    expect(groups.get('xai')).toEqual([files[1]])
})

test('plugin normalization preserves explicit declarations and rejects invalid or inherited legacy IDs', async () => {
    const declarations = [
        pluginEntry('grok', { oauth_provider: ' Custom_Provider ' }),
        pluginEntry('claude', { oauth_provider: 'claude' }),
        pluginEntry('gemini', { oauth_provider: 'gemini' }),
        pluginEntry('claude'),
        pluginEntry('gemini'),
        pluginEntry('grok', { oauth_provider: '' }),
        pluginEntry('grok', { oauth_provider: '../../unexpected' }),
        pluginEntry('grok', { oauth_provider: 'custom.provider' }),
        pluginEntry('grok', { oauth_provider: null as unknown as string }),
        pluginEntry('grok', { supports_oauth: false, oauth_provider: 'grok' }),
        ...['constructor', 'toString', '__proto__', 'custom-provider'].map((id) => pluginEntry(id)),
    ]
    const get          = spyOn(apiClient, 'get').mockResolvedValue({
                                                                       plugins_enabled: true,
                                                                       plugins_dir: 'plugins',
                                                                       plugins: declarations,
                                                                   })
    try {
        const result = await pluginsApi.list()
        expect(result.plugins.map((entry) => entry.oauth_provider)).toEqual([
                                                                                'custom-provider',
                                                                                'claude',
                                                                                'gemini',
                                                                                'anthropic',
                                                                                'gemini-cli',
                                                                                undefined,
                                                                                undefined,
                                                                                undefined,
                                                                                undefined,
                                                                                undefined,
                                                                                undefined,
                                                                                undefined,
                                                                                undefined,
                                                                                undefined,
                                                                            ])
    } finally {
        get.mockRestore()
    }
})
