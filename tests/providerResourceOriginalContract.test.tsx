import {apiKeyMatchesStatus, buildManualKeyCardItems} from '@/components/credentials/apiKeyStatus'
import type {OpenAIProviderConfig, ProviderKeyConfig} from '@/types'
import {maskApiKey} from '@/utils/format'
import {expect, test} from 'bun:test'
import {readFileSync} from 'node:fs'
import React, {type ReactElement} from 'react'
import {compile} from 'sass'
import ts from 'typescript'
import {sourceCallback, sourceExpression, sourceInitializer} from './sourceCallbacks'

const file = 'components/credentials/VendorSection.tsx'
const noop = () => {
}
const t    = (key: string, options?: Record<string, unknown>) => options?.mode ? `${key}: ${options.mode}` : key

function card(
    vendor: string,
    config: OpenAIProviderConfig | ProviderKeyConfig,
    toggleApiKey: (index: string, disabled: boolean) => void = noop,
) {
    return sourceInitializer<(item: unknown) => ReactElement<{ tags: string[]; onToggle: (enabled: boolean) => void }>>(
        file,
        'renderApiKeyCard',
        {
            React, vendor: { id: vendor, label: vendor, editRoute: `/credentials/${vendor}` },
            authIndexUsageStats: {}, authIndexTimeSeries: {}, authIndexUsageWindow: undefined,
            usageStatisticsEnabled: true, authIndexUsageLoadFailed: false,
            resolveRuntimeState: () => ({ status: 'normal' }), resolveUsageError: () => undefined,
            providerEditTriggerId: () => 'synthetic-trigger', openProviderEditor: noop,
            aliasFor: () => undefined, maskApiKey, highlightMatch: (value: string) => value,
            onAliasChange: undefined, t, disableControls: false, manualStatusRequests: new Map(),
            authFileStatusRequestKey: () => 'synthetic-status', apiClient: { getAuthGeneration: () => 1 },
            toggleApiKey, deleteApiKey: noop, CredentialCard: () => null,
        },
    )(
        {
            config,
            configIndex: 0,
            entryIndex: vendor === 'openai' ? 0 : undefined,
            apiKey: 'synthetic',
            authIndex: 'synthetic-index',
        })
}

test('original resource metrics reach actual OpenAI cards including zero values and provider key totals', () => {
    for (const empty of [false, true]) {
        const tags = card('openai', {
            name: 'Synthetic', baseUrl: 'https://synthetic.invalid',
            models: empty ? [] : [{ name: 'Model-A' }, { name: 'Model-B' }],
            headers: empty ? {} : { 'X-One': 'one', 'X-Two': 'two' },
            apiKeyEntries: empty ?
                [] :
                [{ apiKey: 'synthetic-a' }, { apiKey: 'synthetic-b' }, { apiKey: 'synthetic-c' }],
        }).props.tags
        expect(tags).toContain(`${empty ? 0 : 2} credentials.models`)
        expect(tags).toContain(`${empty ? 0 : 2} common.custom_headers_label`)
        expect(tags).toContain(`${empty ? 0 : 3} credentials.api_keys`)
    }
})

test('original flat-provider metrics retain configured cloak modes and WebSocket flags', () => {
    for (const mode of ['auto', 'always', 'never']) {
        const tags = card(
            'claude',
            { apiKey: 'synthetic', models: [], headers: { 'X-One': 'one' }, cloak: { mode } },
        ).props.tags
        expect(tags).toContain('0 credentials.models')
        expect(tags).toContain('1 common.custom_headers_label')
        expect(tags).toContain(`credentials.cloak: ai_providers.claude_cloak_mode_${mode}`)
    }
    expect(card('codex', { apiKey: 'synthetic', websockets: true }).props.tags).toContain('WebSocket')
    expect(card('claude', { apiKey: 'synthetic' }).props.tags.some((tag) => tag.startsWith('credentials.cloak'))).toBe(
        false)
})

test('xAI card toggles preserve the original inverse-disabled write, refresh and error notification', async () => {
    for (const failed of [false, true]) {
        const calls: unknown[]         = [];
        const notices: string[]        = [];
        const pending: Promise<void>[] = []
        let reads                      = 0
        const toggle                   = sourceCallback<(index: string, disabled: boolean) => Promise<void>>(
            'components/credentials/hooks/useVendorActions.ts', 'toggleApiKey', {
                apiClient: { getAuthGeneration: () => 1 },
                authFilesApi: {
                    setStatus: async (...args: unknown[]) => {
                        calls.push(args);
                        if (failed) {
                            throw new Error('synthetic write failure')
                        }
                    },
                },
                onRefresh: async () => {
                    reads++
                }, showNotification: (_message: string, kind: string) => notices.push(kind), t,
            })
        card('xai', { apiKey: 'synthetic', authIndex: 'synthetic-index' }, (index, disabled) => {
            pending.push(toggle(index, disabled))
        }).props.onToggle(false)
        await Promise.all(pending)
        expect(calls).toEqual([['', true, 'synthetic-index']])
        expect(reads).toBe(1)
        expect(notices).toContain(failed ? 'error' : 'success')
        if (failed) {
            expect(notices).not.toContain('success')
        }
    }
})

function preferences(values: Record<string, string>, deniedKey?: string) {
    const storage             = new Map(Object.entries(values))
    const warnings: unknown[] = []
    const load                = sourceCallback<() => { selectedVendors?: string[]; typeFilter?: string }>(
        'pages/CredentialsPage.tsx', 'loadCredentialsUIState', {
            CREDENTIALS_UI_STATE_KEY: 'cpa-credentials-ui-state',
            localStorage: {
                getItem: (key: string) => storage.get(key) ?? null,
                setItem: (key: string, value: string) => {
                    if (key === deniedKey) {
                        throw new Error('synthetic storage denied')
                    }
                    storage.set(key, value)
                },
            },
            sessionStorage: { getItem: () => null }, console: { warn: (...args: unknown[]) => warnings.push(args) },
        })
    return { load, storage, warnings }
}

const legacy = {
    activeBrand: 'openaiCompatibility',
    filtersByBrand: {
        openaiCompatibility: {
            filter: 'original private',
            sortBy: 'recent-success',
            sortDir: 'desc',
            selectedModels: [' Model-A ', 'model-a', 'Model-A'],
        },
        claude: { filter: 'other', sortBy: 'name', sortDir: 'asc', selectedModels: ['Other'] },
    },
}

test('original per-brand preferences migrate without mixing brands or overwriting current choices', () => {
    const { load, storage } = preferences({ 'providersPage.uiState': JSON.stringify(legacy) })
    expect(load()).toMatchObject({ selectedVendors: ['openai'], typeFilter: 'api-key' })
    expect(JSON.parse(storage.get('cpa-credentials-openai-resource-filter')!)).toBe('original private')
    expect(JSON.parse(storage.get('cpa-credentials-openai-resource-sort')!)).toBe('recent-success')
    expect(JSON.parse(storage.get('cpa-credentials-openai-resource-direction')!)).toBe('desc')
    expect(JSON.parse(storage.get('cpa-credentials-openai-resource-models')!)).toEqual(['Model-A', 'model-a'])
    expect(JSON.parse(storage.get('cpa-credentials-claude-resource-models')!)).toEqual(['Other'])
    storage.set('cpa-credentials-openai-resource-filter', '"current"')
    storage.set('cpa-credentials-openai-resource-sort', '"priority"')
    storage.set('cpa-credentials-openai-resource-models', '[]')
    storage.set('cpa-credentials-ui-state', JSON.stringify({ selectedVendors: [], typeFilter: 'all' }))
    expect(load()).toMatchObject({ selectedVendors: [], typeFilter: 'all' })
    expect(storage.get('cpa-credentials-openai-resource-filter')).toBe('"current"')
    expect(storage.get('cpa-credentials-openai-resource-sort')).toBe('"priority"')
    expect(storage.get('cpa-credentials-openai-resource-models')).toBe('[]')
    expect(storage.get('providersPage.uiState')).toBe(JSON.stringify(legacy))
})

test('restored resource search uses the existing per-vendor storage hook and actual input', () => {
    const writes: unknown[]         = []
    const [value, setResourceQuery] = sourceInitializer<[string, (value: string) => void]>(file, 'setResourceQuery', {
        vendor: { id: 'openai' }, useLocalStorage: (key: string, initial: string) => {
            expect(key).toBe('cpa-credentials-openai-resource-filter')
            expect(initial).toBe('')
            return ['saved-filter', (next: string) => writes.push(next)]
        },
    })
    expect(value).toBe('saved-filter')
    const input = sourceExpression<ReactElement<{ onChange: (event: { target: { value: string } }) => void }>>(
        file,
        (node, tree) => ts.isJsxSelfClosingElement(node) && node.tagName.getText(tree) === 'Input' &&
                        node.attributes.properties.some((attribute) => ts.isJsxAttribute(attribute) &&
                        attribute.name.getText(tree) ===
                        'value' &&
                        attribute.initializer?.getText(tree) ===
                        '{resourceQuery}'),
        {
            React,
            Input: () => null,
            vendor: { label: 'OpenAI' },
            resourceQuery: value,
            setResourceQuery,
            disableControls: false,
            t,
        },
    )
    input.props.onChange({ target: { value: 'edited' } })
    expect(writes).toEqual(['edited'])
})

test('migrated per-brand text filters actual cards together with global filters and exact model choices', () => {
    const restored = preferences({ 'providersPage.uiState': JSON.stringify(legacy) })
    restored.load()
    const items               = buildManualKeyCardItems('openai', [
        {
            name: 'Original private',
            baseUrl: 'https://one.invalid',
            models: [{ name: 'Model-A' }],
            apiKeyEntries: [{ apiKey: 'synthetic-a', authIndex: 'a' }],
        },
        {
            name: 'Other',
            baseUrl: 'https://two.invalid',
            models: [{ name: 'model-a' }],
            apiKeyEntries: [{ apiKey: 'synthetic-b', authIndex: 'b' }],
        },
    ])
    const backendMaskedApiKey = sourceInitializer<(value: string) => string>(file, 'backendMaskedApiKey', {})
    const apiKeySearchTokens  = sourceInitializer<(value: string) => string[]>(
        file,
        'apiKeySearchTokens',
        {
            maskApiKey,
            backendMaskedApiKey,
        },
    )
    const joinSearchTokens    = sourceInitializer<(values: unknown[]) => string>(file, 'joinSearchTokens', {})
    const matchesSearchQuery  = sourceInitializer<(value: string, query: string, wildcard: RegExp | null) => boolean>(
        file,
        'matchesSearchQuery',
        {},
    )
    const modelSearchTokens   = sourceInitializer<(models: unknown[]) => string[]>(file, 'modelSearchTokens', {})
    const scope               = {
        typeFilter: 'api-key', manualKeyItems: items, accountHealthByAuthIndex: {},
        statusFilter: 'all', query: '', wildcardQuery: null,
        resourceQuery: JSON.parse(restored.storage.get('cpa-credentials-openai-resource-filter')!), selectedModels: [],
        resourceSort: 'name', resourceDirection: 'asc', aliasFor: () => undefined, authIndexUsageStats: {},
        vendor: { id: 'openai', label: 'OpenAI' }, maskApiKey,
        // noinspection JSUnusedGlobalSymbols
        'apiKeyMatchesStatus': apiKeyMatchesStatus,
        apiKeySearchTokens, joinSearchTokens, matchesSearchQuery, modelSearchTokens,
    }
    const read                = (overrides: Record<string, unknown> = {}) => sourceCallback<() => typeof items>(
        file,
        'filteredApiKeys',
        { ...scope, ...overrides },
    )()
    expect(read().map((item) => item.authIndex)).toEqual(['a'])
    expect(read({ query: 'other' })).toEqual([])
    expect(read({ selectedModels: ['Model-A'] }).map((item) => item.authIndex)).toEqual(['a'])
    expect(read({ selectedModels: ['model-a'] })).toEqual([])
    expect(read({ resourceQuery: '' })).toHaveLength(2)
})

test(
    'a provider preference write failure preserves current global preferences and reports the affected migration',
    () => {
        const { load, storage, warnings } = preferences(
            {
                'providersPage.uiState': JSON.stringify(legacy),
                'cpa-credentials-ui-state': JSON.stringify(
                    {
                        selectedVendors: ['codex'],
                        typeFilter: 'all',
                    }),
            }, 'cpa-credentials-openai-resource-sort')
        expect(load()).toMatchObject({ selectedVendors: ['codex'], typeFilter: 'all' })
        expect(storage.get('cpa-credentials-openai-resource-sort')).toBeUndefined()
        expect(storage.get('cpa-credentials-openai-resource-filter')).toBe('"original private"')
        expect(warnings).toHaveLength(1)
        expect(storage.get('providersPage.uiState')).toBe(JSON.stringify(legacy))
    },
)

test('resource tags keep translated values visible without hover and wrap long labels', () => {
    for (const language of ['en', 'ru', 'zh-CN', 'zh-TW']) {
        const locale = JSON.parse(readFileSync(
            new URL(`../src/i18n/locales/${language}.json`, import.meta.url),
            'utf8',
        ))
        expect(locale.credentials.cloak).toContain('{{mode}}')
    }
    const css = compile(
        new URL('../src/components/credentials/CredentialCard.module.scss', import.meta.url).pathname,
        { logger: { warn: noop, debug: noop } },
    ).css
    const tag = css.match(/\.tag\s*\{(?<body>[^}]+)}/)?.[1] ?? ''
    expect(tag).toContain('max-width: 100%')
    expect(tag).toContain('overflow-wrap: anywhere')
    expect(tag.lastIndexOf('white-space: normal')).toBeGreaterThan(tag.lastIndexOf('white-space: nowrap'))
})
