import {apiKeyMatchesStatus, buildManualKeyCardItems} from '@/components/credentials/apiKeyStatus'
import {filterAuthFiles} from '@/components/credentials/authFileListLogic'
import {normalizeAuthFileProvider} from '@/features/authFiles/constants'
import {authFileSelectionKey} from '@/features/authFiles/identity'
import {buildOpenAIProviderPatchRequest} from '@/services/api/providers'
import type {OpenAIProviderConfig} from '@/types'
import {isModelExcludedByRules} from '@/utils/excludedModels'
import {maskApiKey} from '@/utils/format'
import {expect, test} from 'bun:test'
import React, {type ReactElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import ts from 'typescript'
import {sourceCallback, sourceExpression, sourceInitializer} from './sourceCallbacks'

const noop     = () => {
}
const t        = (key: string) => key
const deferred = <T, >() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((accept) => {
        resolve = accept
    });
    return { promise, resolve }
}

function preferences(local: Record<string, string>, session: Record<string, string> = {}) {
    const localStorage   = {
        getItem: (key: string) => local[key] ?? null, setItem: (key: string, value: string) => {
            local[key] = value
        },
    }
    const sessionStorage = { getItem: (key: string) => session[key] ?? null }
    const scope          = { localStorage, sessionStorage, CREDENTIALS_UI_STATE_KEY: 'cpa-credentials-ui-state' }
    const load           = sourceCallback<() => Record<string, unknown>>(
        'pages/CredentialsPage.tsx',
        'loadCredentialsUIState',
        scope,
    )
    return { load, scope }
}

test('migrates valid ordinary preferences once, keeps new values, and retires compact preferences', () => {
    const local           = {
        'authFilesPage.uiState': JSON.stringify({
                                                    search: 'older',
                                                    filter: 'claude',
                                                    pageSize: 9,
                                                }),
    }
    const session         = {
        'authFilesPage.uiState': JSON.stringify({
                                                    search: 'legacy',
                                                    filter: 'codex',
                                                    problemOnly: true,
                                                    regularPageSize: 12,
                                                    compactMode: true,
                                                    compactPageSize: 30,
                                                    sortMode: 'priority',
                                                }),
    }
    const { load, scope } = preferences(local, session)
    const initial         = load()
    expect(initial).toMatchObject({
                                      searchQuery: 'legacy',
                                      selectedVendors: ['codex'],
                                      statusFilter: 'problem',
                                      typeFilter: 'auth-file',
                                      pageSize: 12,
                                      sortMode: 'priority',
                                  })
    expect(initial).not.toHaveProperty('compactMode')
    const save = sourceCallback<() => void>('pages/CredentialsPage.tsx', 'useEffect', {
        ...scope,
        initialUIState: initial,
        quotaSort: 'grouped',
        quotaPageSize: initial.pageSize,
        searchQuery: 'current',
        selectedVendors: [],
        statusFilter: 'all',
        typeFilter: 'all',
    }, 'legacyPreferencesMigrated: true')
    save()
    session['authFilesPage.uiState'] =
        JSON.stringify({ search: 'changed legacy', filter: 'xai', problemOnly: true, pageSize: 30 })
    expect(load()).toMatchObject({
                                     searchQuery: 'current',
                                     selectedVendors: [],
                                     statusFilter: 'all',
                                     typeFilter: 'all',
                                     pageSize: 12,
                                 })
})

test('validates migrated enums and page sizes and retains the disabled-problem intersection', () => {
    const current  = JSON.stringify({
                                        searchQuery: 'new',
                                        selectedVendors: ['xai', 42],
                                        statusFilter: 'invalid',
                                        typeFilter: 'invalid',
                                        pageSize: -1,
                                        sortMode: 'invalid',
                                    })
    const { load } = preferences(
        { 'cpa-credentials-ui-state': current },
        {
            'authFilesPage.uiState': JSON.stringify({
                                                        filter: 'disabled',
                                                        problemOnly: true,
                                                        pageSize: 9,
                                                    }),
        },
    )
    expect(load()).toMatchObject({
                                     searchQuery: 'new',
                                     selectedVendors: ['xai'],
                                     statusFilter: 'disabled-problem',
                                     typeFilter: 'auth-file',
                                 })
    expect(load().pageSize).toBe(9)
    expect(load().sortMode).toBeUndefined()
})

test('legacy problem filters use actual problem messages including the disabled intersection', () => {
    const files = [
        { name: 'normal' },
        { name: 'problem', statusMessage: 'upstream rejected' },
        { name: 'disabled-empty', disabled: true },
        { name: 'disabled-problem', disabled: true, statusMessage: 'upstream rejected' },
    ]
    for (const [statusFilter, expected] of
        [['problem', ['problem', 'disabled-problem']], ['disabled-problem', ['disabled-problem']]] as const) {
        const filter = sourceCallback<() => typeof files>(
            'components/credentials/VendorSection.tsx',
            'filteredAuthFiles',
            {
                data: { authFiles: files },
                statusFilter,
                typeFilter: 'auth-file',
                rawQuery: '',
                quotaStatusMap: {},
                filterAuthFiles,
                vendor: { id: 'codex', label: 'Codex' },
                t,
            },
        )
        expect(filter().map((file) => file.name)).toEqual([...expected])
    }
})

const configs: OpenAIProviderConfig[] = [
    {
        name: 'Zulu',
        baseUrl: 'https://z.invalid',
        priority: 8,
        models: [{ name: 'Model-A', alias: 'alias-a' }],
        apiKeyEntries: [{ apiKey: 'synthetic-z1', authIndex: 'z1' }, { apiKey: 'synthetic-z2', authIndex: 'z2' }],
    },
    {
        name: 'Alpha',
        baseUrl: 'https://a.invalid',
        priority: 1,
        models: [{ name: 'Model-B', alias: '' }],
        apiKeyEntries: [{ apiKey: 'synthetic-a', authIndex: 'a' }],
    },
]

test('resource models and all three bidirectional sorts preserve original config and entry identities', () => {
    const items = buildManualKeyCardItems('openai', configs)
    const scope = {
        typeFilter: 'api-key',
        manualKeyItems: items,
        accountHealthByAuthIndex: {},
        statusFilter: 'all',
        query: '',
        selectedModels: [],
        resourceQuery: '',
        resourceSort: 'name',
        resourceDirection: 'asc',
        aliasFor: () => undefined,
        maskApiKey,
        authIndexUsageStats: { z1: { success: 3 }, z2: { success: 8 }, a: { success: 1 } },
        // noinspection JSUnusedGlobalSymbols
        'apiKeyMatchesStatus': apiKeyMatchesStatus,
        modelSearchTokens: (models: OpenAIProviderConfig['models']) => models?.flatMap((model) => [
            model.name,
            model.alias,
        ]) ?? [],
    }
    const read  = (values: Record<string, unknown> = {}) => sourceCallback<() => typeof items>(
        'components/credentials/VendorSection.tsx',
        'filteredApiKeys',
        { ...scope, ...values },
    )()
    expect(read().map((item) => [item.configIndex, item.entryIndex])).toEqual([[1, 0], [0, 0], [0, 1]])
    expect(read({ resourceSort: 'priority' }).map((item) => item.authIndex)).toEqual(['a', 'z1', 'z2'])
    expect(read({ resourceSort: 'recent-success', resourceDirection: 'desc' }).map((item) => item.authIndex))
        .toEqual(['z2', 'z1', 'a'])
    expect(read({ selectedModels: ['alias-a'] }).map((item) => item.authIndex)).toEqual(['z1', 'z2'])
    expect(read({ selectedModels: ['model-a'] })).toEqual([])
    for (const mode of ['name', 'priority', 'recent-success']) {
        expect(read({ resourceSort: mode, resourceDirection: 'desc' })[0].configIndex).toBe(0)
    }
})

test('filtered resource card edit and delete callbacks retain their original config and key entry', () => {
    const item                 = buildManualKeyCardItems('openai', configs)[1]
    const edits: unknown[][]   = [];
    const deletes: unknown[][] = []
    const render               = sourceInitializer<(entry: typeof item) => ReactElement<{
        onEdit: () => void;
        onDelete: () => void;
        onToggle: (enabled: boolean) => void;
        disabled: boolean;
        tags?: string[]
    }>>('components/credentials/VendorSection.tsx', 'renderApiKeyCard', {
        React,
        vendor: { id: 'openai', label: 'OpenAI', editRoute: '/credentials/openai' },
        authIndexUsageStats: {},
        authIndexTimeSeries: {},
        authIndexUsageWindow: undefined,
        usageStatisticsEnabled: true,
        authIndexUsageLoadFailed: false,
        resolveRuntimeState: () => ({ status: 'normal' }),
        resolveUsageError: () => undefined,
        providerEditTriggerId: (_vendor: string, identity: string) => identity,
        openProviderEditor: (...args: unknown[]) => edits.push(args),
        aliasFor: () => undefined,
        maskApiKey,
        highlightMatch: (value: string) => value,
        onAliasChange: undefined,
        t,
        disableControls: false,
        manualStatusRequests: new Map(),
        authFileStatusRequestKey: () => 'status',
        apiClient: { getAuthGeneration: () => 1 },
        toggleApiKey: (...args: unknown[]) => edits.push(['toggle', ...args]),
        CredentialCard: () => null,
        deleteApiKey: (...args: unknown[]) => deletes.push(args),
    })
    const element              = render(item)
    element.props.onEdit();
    element.props.onDelete()
    expect(edits).toEqual([['/credentials/openai/0', '0-1']])
    expect(deletes).toEqual([['Zulu', 'https://z.invalid', item]])
    element.props.onToggle(false)
    expect(edits[1]).toEqual(['toggle', 'z2', true])
    const groupDisabled = render({
                                     ...item,
                                     disabled: true,
                                     config: { ...item.config as OpenAIProviderConfig, disabled: true },
                                 })
    expect(groupDisabled.props.disabled).toBe(false)
    expect(groupDisabled.props.tags).toContain(t('credentials.provider_group_disabled'))
    groupDisabled.props.onToggle(false)
    expect(edits[2]).toEqual(['toggle', 'z2', true])
})

test('deleting one OpenAI key waits for confirmation then patches only that original provider', async () => {
    const item                                               = buildManualKeyCardItems('openai', configs)[1]
    const actions: Array<{ onConfirm: () => Promise<void> }> = [];
    const patches: unknown[][]                               = [];
    let generation                                           = 1
    const remove                                             = sourceCallback<(
        name: string,
        base: string,
        target: typeof item,
    ) => void>('components/credentials/hooks/useVendorActions.ts', 'deleteApiKey', {
        vendorId: 'openai',
        API_KEY_DELETERS: {
            openai: () => {
                throw new Error('provider deletion was not requested')
            },
        },
        DELETE_CONFIRM_KEYS: {},
        apiClient: { getAuthGeneration: () => generation },
        showConfirmation: (action: { onConfirm: () => Promise<void> }) => actions.push(action),
        t,
        providersApi: {
            patchOpenAIProvider: async (...args: unknown[]) => {
                patches.push(args)
            },
        },
        onRefresh: async () => {
        },
        showNotification: noop,
    })
    remove('Zulu', 'https://z.invalid', item)
    expect(patches).toEqual([])
    await actions[0].onConfirm()
    expect(patches).toHaveLength(1)
    const next = { ...configs[0], apiKeyEntries: [configs[0].apiKeyEntries[0]] }
    expect(patches[0]).toEqual([0, next, configs[0]])
    expect(buildOpenAIProviderPatchRequest(0, next, configs[0])).toEqual(
        {
            index: 0,
            name: 'Zulu',
            value: { 'api-key-entries': [{ 'api-key': 'synthetic-z1' }] },
        })
    remove('Zulu', 'https://z.invalid', item);
    generation = 2
    expect(actions[1].onConfirm()).rejects.toThrow('common.connection_changed')
    expect(patches).toHaveLength(1)
})

test('removing a saved editor key changes the draft only after explicit confirmation', () => {
    let form                                              = { apiKeyEntries: [...configs[0].apiKeyEntries] }
    const confirmations: Array<{ onConfirm: () => void }> = []
    const remove                                          = sourceInitializer<(index: number) => void>(
        'pages/AiProvidersOpenAIEditPage.tsx',
        'removeEntry',
        {
            list: form.apiKeyEntries,
            form,
            hasIndexParam: true,
            authGeneration: 1,
            apiClient: { getAuthGeneration: () => 1 },
            t,
            setForm: (update: (value: typeof form) => typeof form) => {
                form = update(form)
            },
            keyTestStatuses: [],
            setDraftKeyTestStatuses: noop,
            setVisibleApiKeyRows: noop,
            // noinspection JSUnusedGlobalSymbols
            'idleKeyTestStatus': () => ({ status: 'idle', message: '' }),
            buildApiKeyEntry: () => ({ apiKey: '' }),
            showConfirmation: (action: { onConfirm: () => void }) => confirmations.push(action),
        },
    )
    remove(1)
    expect(form.apiKeyEntries).toHaveLength(2)
    confirmations[0].onConfirm()
    expect(form.apiKeyEntries).toEqual([configs[0].apiKeyEntries[0]])
})

test('supported-model loading ignores a closed viewer and classifies unsupported responses explicitly', async () => {
    for (const close of [false, true]) {
        const response          = deferred<Array<{ id: string; type: string }>>()
        const states: unknown[] = []
        const effect            = sourceCallback<() => () => void>(
            'features/authFiles/components/AuthFileModelsModal.tsx',
            'useEffect',
            {
                file: { name: 'synthetic.json' },
                generation: 1,
                identity: `1:${authFileSelectionKey({ name: 'synthetic.json' })}`,
                apiClient: { getAuthGeneration: () => 1 },
                t,
                loadAuthFileModels: () => response.promise,
                authFilesApi: { getModelsForAuthFile: noop },
                setState: (state: unknown) => states.push(state),
            },
        )
        const cleanup           = effect();
        await Promise.resolve()
        const before = [...states]
        if (close) {
            cleanup()
        }
        response.resolve([{ id: 'Model-A', type: 'chat' }]);
        await response.promise;
        await Promise.resolve()
        if (close) {
            expect(states).toEqual(before)
        } else {
            expect(states[states.length - 1]).toMatchObject({
                                                                loading: false,
                                                                models: [{ id: 'Model-A', type: 'chat' }],
                                                                error: null,
                                                            })
        }
    }
    const states: unknown[] = []
    sourceCallback<() => void>('features/authFiles/components/AuthFileModelsModal.tsx', 'useEffect', {
        file: { name: 'synthetic.json' },
        generation: 1,
        identity: `1:${authFileSelectionKey({ name: 'synthetic.json' })}`,
        apiClient: { getAuthGeneration: () => 1 },
        t,
        loadAuthFileModels: async () => {
            throw Object.assign(new Error('not found'), { status: 404 })
        },
        authFilesApi: { getModelsForAuthFile: noop },
        setState: (state: unknown) => states.push(state),
    })()
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    await Promise.resolve()
    expect(states[states.length - 1]).toMatchObject({ unsupported: true, loading: false, error: 'not found' })
})

test('supported-model view distinguishes loading, empty, unsupported and typed excluded models', () => {
    for (const variant of ['loading', 'empty', 'unsupported', 'models'] as const) {
        let stateIndex = 0
        const state    = {
            identity: `1:${authFileSelectionKey({ name: 'synthetic.json' })}`,
            models: variant === 'models' ? [{ id: 'Model-A', type: 'chat' }] : [],
            loading: variant === 'loading',
            error: variant === 'unsupported' ? '404' : null,
            unsupported: variant === 'unsupported',
        }
        const View     = sourceCallback<React.ComponentType<{
            file: { name: string; type: string };
            onClose: () => void
        }>>('features/authFiles/components/AuthFileModelsModal.tsx', 'AuthFileModelsModal', {
            React,
            useTranslation: () => ({ t }),
            useAuthStore: () => 1,
            useConfigStore: (select: (value: unknown) => unknown) => select({
                                                                                config: {
                                                                                    oauthExcludedModels: {
                                                                                        codex: ['Model-*'],
                                                                                    },
                                                                                },
                                                                            }),
            useNotificationStore: () => noop,
            useState: () => (++stateIndex === 1 ? [0, noop] : [state, noop]),
            useEffect: noop,
            usePagination: (models: unknown[]) => ({
                currentItems: models,
                currentPage: 1,
                pageSize: 20,
                goToPage: noop,
            }),
            normalizeAuthFileProvider,
            authFileSelectionKey,
            isModelExcludedByRules,
            Modal: ({ children }: { children: React.ReactNode }) => React.createElement('section', {}, children),
            EmptyState: ({ title }: { title: string }) => React.createElement('div', {}, title),
            Button: () => null,
            Pagination: () => null,
            styles: {},
        })
        const html     = renderToStaticMarkup(React.createElement(
            View,
            {
                file: { name: 'synthetic.json', type: 'codex' },
                onClose: noop,
            },
        ))
        if (variant === 'loading') {
            expect(html).toContain('auth_files.models_loading')
        }
        if (variant === 'empty') {
            expect(html).toContain('auth_files.models_empty')
        }
        if (variant === 'unsupported') {
            expect(html).toContain('auth_files.models_unsupported')
        }
        if (variant === 'models') {
            expect(html).toContain('Model-A');
            expect(html).toContain('chat');
            expect(html).toContain('auth_files.models_excluded_badge')
        }
    }
})

test('OAuth weight metadata includes its accessible scheduling explanation', () => {
    const fields: Array<{ id: string; label: string; value: string; description: string }> = []
    sourceExpression(
        'components/credentials/VendorSection.tsx',
        (node, tree) => ts.isCallExpression(node) &&
                        node.expression.getText(tree) ===
                        'fields.push' &&
                        Boolean(node.arguments[0]?.getText(tree).includes('id: \'weight\'')),
        { fields, file: { weight: 3 }, t },
    )
    expect(fields[0]).toMatchObject({ id: 'weight', value: '3', description: 'ai_providers.weight_hint' })
    const label = sourceExpression<ReactElement<{ title: string; tabIndex: number; 'aria-label': string }>>(
        'components/credentials/CredentialCard.tsx',
        (node, tree) => ts.isJsxElement(node) &&
                        node.openingElement.tagName.getText(tree) ===
                        'span' &&
                        node.openingElement.attributes.properties.some((attribute) => ts.isJsxAttribute(attribute) &&
                        attribute.name.getText(tree) ===
                        'title' &&
                        attribute.initializer?.getText(tree) ===
                        '{field.description}'),
        { React, styles: {}, field: fields[0] },
    )
    expect(label.props.tabIndex).toBe(0)
    expect(label.props.title).toBe('ai_providers.weight_hint')
    expect(label.props['aria-label']).toContain('ai_providers.weight_hint')
})

test('copying a supported model reports success or failure without changing its exact ID', async () => {
    for (const copied of [true, false]) {
        const values: string[]           = [];
        const notifications: unknown[][] = []
        const copy                       = sourceInitializer<(id: string) => Promise<void>>(
            'features/authFiles/components/AuthFileModelsModal.tsx',
            'copyModel',
            {
                generation: 1, apiClient: { getAuthGeneration: () => 1 }, t,
                copyToClipboard: async (value: string) => {
                    values.push(value);
                    return copied
                }, showNotification: (...args: unknown[]) => notifications.push(args),
            },
        )
        await copy('Model-A')
        expect(values).toEqual(['Model-A'])
        expect(notifications).toEqual([
                                          [
                                              copied ? 'common.copied' : 'credentials.models_copy_failed',
                                              copied ? 'success' : 'error',
                                          ],
                                      ])
    }
})

test('denied legacy session storage preserves independently readable current preferences', () => {
    const warnings: unknown[][] = []
    const load                  = sourceCallback<() => Record<string, unknown>>(
        'pages/CredentialsPage.tsx',
        'loadCredentialsUIState',
        {
            CREDENTIALS_UI_STATE_KEY: 'cpa-credentials-ui-state',
            console: {
                warn: (...args: unknown[]) => warnings.push(args),
            },
            localStorage: {
                getItem: (key: string) => key ===
                                          'cpa-credentials-ui-state' ?
                                          JSON.stringify({
                                                             searchQuery: 'current',
                                                             statusFilter: 'available',
                                                             selectedVendors: [],
                                                         }) :
                                          null,
            },
            sessionStorage: {
                getItem: () => {
                    throw new Error('synthetic storage denied')
                },
            },
        },
    )
    expect(load()).toMatchObject({ searchQuery: 'current', statusFilter: 'available', selectedVendors: [] })
    expect(warnings).toHaveLength(1)
})

test(
    'manual credential status writes use auth-index and refresh the resource after success or failure without replay',
    async () => {
        for (const failed of [false, true]) {
            const requests: unknown[][] = [];
            const notices: unknown[][]  = [];
            let reads                   = 0;
            let generation              = 1
            const toggle                = sourceCallback<(index: string, disabled: boolean) => Promise<void>>(
                'components/credentials/hooks/useVendorActions.ts',
                'toggleApiKey',
                {
                    apiClient: { getAuthGeneration: () => generation },
                    authFilesApi: {
                        setStatus: async (...args: unknown[]) => {
                            requests.push(args);
                            if (failed) {
                                throw new Error('uncertain write')
                            }
                        },
                    },
                    onRefresh: async () => {
                        ++reads
                    }, showNotification: (...args: unknown[]) => notices.push(args), t,
                },
            )
            await toggle('synthetic-auth-index', true)
            expect(requests).toEqual([['', true, 'synthetic-auth-index']])
            expect(reads).toBe(1)
            expect(notices.some((notice) => notice[1] === 'success')).toBe(!failed)
            const pending               = Promise.withResolvers<void>()
            const oldNotices: unknown[] = []
            const old                   = sourceCallback<(index: string, disabled: boolean) => Promise<void>>(
                'components/credentials/hooks/useVendorActions.ts',
                'toggleApiKey',
                {
                    apiClient: { getAuthGeneration: () => generation },
                    authFilesApi: { setStatus: () => pending.promise },
                    onRefresh: async () => {
                        throw new Error('old refresh must not run')
                    },
                    showNotification: (...args: unknown[]) => oldNotices.push(args),
                    t,
                },
            )
            const request               = old('synthetic-auth-index', false)
            generation                  = 2;
            pending.resolve();
            await request
            expect(oldNotices).toEqual([])
        }
    },
)

test('flat manual credential cards dispatch their stable auth-index and reflect the shared in-flight lock', () => {
    const item               = {
        config: { apiKey: 'synthetic-key' },
        configIndex: 4,
        apiKey: 'synthetic-key',
        authIndex: 'stable-index',
        disabled: false,
    }
    const calls: unknown[][] = []
    const scope              = {
        React,
        vendor: { id: 'gemini', label: 'Gemini', editRoute: '/credentials/gemini' },
        authIndexUsageStats: {},
        authIndexTimeSeries: {},
        authIndexUsageWindow: undefined,
        usageStatisticsEnabled: true,
        authIndexUsageLoadFailed: false,
        resolveRuntimeState: () => ({ status: 'normal' }),
        resolveUsageError: () => undefined,
        providerEditTriggerId: () => 'trigger',
        openProviderEditor: () => {
        },
        aliasFor: () => undefined,
        maskApiKey,
        highlightMatch: (value: string) => value,
        onAliasChange: undefined,
        t,
        disableControls: false,
        manualStatusRequests: new Map<string, unknown>(),
        authFileStatusRequestKey: (generation: number, name: string, index: string) => JSON.stringify([
                                                                                                          generation,
                                                                                                          name,
                                                                                                          index,
                                                                                                      ]),
        apiClient: { getAuthGeneration: () => 1 },
        toggleApiKey: (...args: unknown[]) => calls.push(args),
        CredentialCard: () => null,
        deleteApiKey: () => {
        },
    }
    const render             = () => sourceInitializer<(entry: typeof item) => ReactElement<{
        onToggle: (enabled: boolean) => void;
        disableControls: boolean
    }>>('components/credentials/VendorSection.tsx', 'renderApiKeyCard', scope)(item)
    render().props.onToggle(false)
    expect(calls).toEqual([['stable-index', true]])
    expect(render().props.disableControls).toBe(false)
    scope.manualStatusRequests.set(JSON.stringify([1, '', 'stable-index']), {})
    expect(render().props.disableControls).toBe(true)
})
