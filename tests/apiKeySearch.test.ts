import i18n from '@/i18n'
import {apiKeysApi} from '@/services/api/apiKeys'
import {apiClient} from '@/services/api/client'
import {AxiosError, type AxiosInstance, type InternalAxiosRequestConfig} from 'axios'
import {afterEach, beforeEach, expect, test} from 'bun:test'
import * as React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import ts from 'typescript'
import {sourceCallback, sourceExpression, sourceInitializer} from './sourceCallbacks'

const file                      = 'components/config/VisualConfigEditorBlocks.tsx'
const CONFIG_SECRET_PLACEHOLDER = sourceInitializer<RegExp>(file, 'CONFIG_SECRET_PLACEHOLDER', {})
const instance                  = (apiClient as unknown as { instance: AxiosInstance }).instance
const originalAdapter           = instance.defaults.adapter
const references                = Array.from(
    { length: 23 },
    (_, index) => `__CLI_PROXY_CONFIG_SECRET_${index.toString(16).padStart(
        32,
        '0',
    )}__`,
)
const value                     = references.join('\n')
const query                     = 'synthetic-middle-fragment'
const settle                    = () => new Promise<void>((resolve) => setImmediate(resolve))
const response                  = (config: InternalAxiosRequestConfig, data: unknown) => ({
    config,
    data,
    headers: {},
    status: 200,
    statusText: 'OK',
})
const payload                   = (matches: string[]) => ({ 'api-keys': references, 'api-key-matches': matches })

beforeEach(() => apiClient.setConfig({ apiBase: 'https://management.synthetic.invalid', managementKey: '' }))
afterEach(() => {
    instance.defaults.adapter = originalAdapter;
    apiClient.setConfig({ apiBase: '', managementKey: '' })
})

function wire(data: unknown) {
    const calls: InternalAxiosRequestConfig[] = []
    instance.defaults.adapter                 = async (config) => {
        calls.push(config)
        expect(config.method).toBe('get')
        expect(config.url).toBe('/api-keys')
        expect(config.headers['X-CPA-Mutation-ID']).toBeUndefined()
        return response(config, data)
    }
    return calls
}

type SearchState = {
    query: string;
    value: string;
    aliasesText: string;
    generation: number;
    signal: AbortSignal;
    matches: Set<string>;
    error: string
}

function effect(overrides: Record<string, unknown> = {}) {
    const updates: Array<SearchState | null> = []
    const scope                              = {
        apiClient, apiKeysApi, query, value, aliasesText: '{}', searchGeneration: apiClient.getAuthGeneration(),
        needsSavedSearch: true, connectionStatus: 'connected', apiBase: 'https://management.synthetic.invalid',
        // noinspection JSUnusedGlobalSymbols
        'setSavedKeySearch': (state: SearchState | null) => updates.push(state),
        visualT: (key: string) => i18n.t(`config_management.visual.${key}`), ...overrides,
    }
    const cleanup                            = sourceCallback<() => (() => void) | undefined>(
        file,
        'useEffect',
        scope,
        'apiKeysApi.search',
    )()
    return { scope, updates, cleanup }
}

function filtered(scope: Record<string, unknown>, state: SearchState | null, aliases: Record<string, string> = {}) {
    const currentSavedKeySearch = sourceInitializer<SearchState | null>(
        file,
        'currentSavedKeySearch',
        { ...scope, savedKeySearch: state },
    )
    return sourceInitializer<Array<{ key: string; index: number }>>(file, 'filteredKeys', {
        useMemo: (callback: () => unknown) => callback(), apiKeys: String(scope.value).split('\n').filter(Boolean),
        searchQuery: scope.query, aliases, currentSavedKeySearch, CONFIG_SECRET_PLACEHOLDER,
    })
}

for (const term of ['sk-synthetic-complete-key-0000000000', query, '']) {
    test(
        `SDK consumes opaque search references for ${term || 'an empty query'} without changing the list contract`,
        async () => {
            const calls      = wire(payload(term ? [references[2]] : references))
            const controller = new AbortController()
            expect(await apiKeysApi.search(term, { signal: controller.signal })).toEqual(term ?
                                                                                             [references[2]] :
                                                                                         references)
            expect(calls[0].params).toEqual({ api_key_search: term })
            expect(calls[0].signal).toBe(controller.signal)
            expect(calls).toHaveLength(1)
        },
    )
}

test('SDK preserves zero matches and ordinary list still has no search parameter', async () => {
    const calls = wire(payload([]))
    expect(await apiKeysApi.search('not-present')).toEqual([])
    expect(await apiKeysApi.list()).toEqual(references)
    expect(calls[1].params).toBeUndefined()
})

for (const data of [
    null,
    references,
    { 'api-keys': references },
    { ...payload([]), 'api-key-matches': 'invalid' },
    payload(['sk-synthetic-plaintext']),
    payload(['__CLI_PROXY_CONFIG_SECRET_ffffffffffffffffffffffffffffffff__']),
    { 'api-keys': ['sk-synthetic-plaintext'], 'api-key-matches': ['sk-synthetic-plaintext'] },
    payload([123 as unknown as string]),
]) {
    test(`invalid search response stays a visible failure: ${JSON.stringify(data).slice(0, 75)}`, async () => {
        const calls = wire(data)
        expect(apiKeysApi.search(query))
            .rejects
            .toThrow(i18n.t('config_management.visual.api_keys.search_failed'))
        expect(calls).toHaveLength(1)
    })
}

for (const term of ['sk-synthetic-complete-key-0000000000', query]) {
    test(`actual effect and filter consume saved Key matches for ${term}`, async () => {
        const calls = wire(payload([references[4]]))
        const run   = effect({ query: term })
        await settle()
        expect(filtered(run.scope, run.updates[run.updates.length - 1] ?? null)).toEqual([
                                                                                             {
                                                                                                 key: references[4],
                                                                                                 index: 4,
                                                                                             },
                                                                                         ])
        expect(calls[0].params).toEqual({ api_key_search: term })
        run.cleanup?.()
    })
}

test('new unsaved keys and current aliases remain local matches with no saved-key lookup', async () => {
    const calls = wire(payload([]))
    const draft = 'sk-new-synthetic-middle-fragment-key'
    const run   = effect({ value: draft, needsSavedSearch: false, query: 'middle-fragment' })
    expect(filtered(run.scope, null)).toEqual([{ key: draft, index: 0 }])
    expect(filtered({ ...run.scope, query: 'Primary' }, null, { [draft]: 'Primary' })).toEqual([
                                                                                                   {
                                                                                                       key: draft,
                                                                                                       index: 0,
                                                                                                   },
                                                                                               ])
    await settle()
    expect(calls).toHaveLength(0)
    expect(run.updates).toEqual([])
})

for (const alias of ['Renamed', '']) {
    test(
        `a saved Key leaves its old alias search after the draft alias is ${alias ? 'renamed' : 'cleared'}`,
        async () => {
            const calls   = wire(payload([]))
            const initial = effect({ query: 'OriginalAlias', aliasesText: 'OriginalAlias' })
            await settle()
            const previous = initial.updates[initial.updates.length - 1] ?? null
            expect(filtered(initial.scope, previous, { [references[0]]: 'OriginalAlias' }))
                .toEqual([{ key: references[0], index: 0 }])
            initial.cleanup?.()
            const renamed = effect({ query: 'OriginalAlias', aliasesText: alias })
            expect(filtered(renamed.scope, previous, { [references[0]]: alias })).toEqual([])
            await settle()
            expect(filtered(
                renamed.scope,
                renamed.updates[renamed.updates.length - 1] ?? null,
                { [references[0]]: alias },
            )).toEqual([])
            expect(calls).toHaveLength(2)
            renamed.cleanup?.()
        },
    )
}

test('network failure produces the actual localized alert instead of a successful empty search', async () => {
    instance.defaults.adapter = async (config) => {
        throw new AxiosError('synthetic network failure', 'ERR_NETWORK', config)
    }
    const run                 = effect()
    await settle()
    const currentSavedKeySearch = run.updates[run.updates.length - 1]
    expect(currentSavedKeySearch?.error).toBe(i18n.t('config_management.visual.api_keys.search_failed'))
    const alert = sourceExpression<React.ReactElement>(
        file, (node, tree) => ts.isJsxElement(node) &&
                              node.openingElement.getText(tree).includes('role=\'alert\'') &&
                              node.getText(tree).includes('currentSavedKeySearch.error'),
        { React, currentSavedKeySearch },
    )
    expect(renderToStaticMarkup(alert)).toContain('role="alert"')
    expect(renderToStaticMarkup(alert)).toContain(currentSavedKeySearch?.error ?? 'missing')
    run.cleanup?.()
})

test('disconnected saved-key search visibly fails without issuing a request', async () => {
    const calls = wire(payload([]))
    const run   = effect({ connectionStatus: 'disconnected' })
    await settle()
    expect(run.updates[run.updates.length - 1]?.error).toBeTruthy()
    expect(calls).toHaveLength(0)
    run.cleanup?.()
})

for (const changed of ['query', 'value', 'aliasesText']) {
    test(`${changed} changes abort the previous lookup and retain only the latest actual consumer result`, async () => {
        let release: (data: unknown) => void      = () => {
        }
        const pending                             = new Promise<unknown>((resolve) => {
            release = resolve
        })
        const calls: InternalAxiosRequestConfig[] = []
        instance.defaults.adapter                 = async (config) => {
            calls.push(config)
            return response(config, calls.length === 1 ? await pending : payload([references[2]]))
        }
        const old                                 = effect()
        await settle()
        old.cleanup?.()
        const overrides = {
            [changed]: changed === 'value' ?
                       value + '\nsk-new-synthetic-draft-key' :
                       'changed-synthetic-query-or-alias',
        }
        const next      = effect(overrides)
        await settle()
        release(payload([references[1]]))
        await settle()
        expect(calls[0].signal?.aborted).toBe(true)
        expect(old.updates).toHaveLength(0)
        expect(filtered(next.scope, next.updates[next.updates.length - 1] ?? null).map((row) => row.key))
            .toEqual([references[2]])
        next.cleanup?.()
    })
}

test('a changed login generation discards a late lookup even before effect cleanup', async () => {
    let release: (data: unknown) => void = () => {
    }
    const pending                        = new Promise<unknown>((resolve) => {
        release = resolve
    })
    instance.defaults.adapter            = async (config) => response(config, await pending)
    const run                            = effect()
    await settle()
    apiClient.setConfig({ apiBase: 'https://other.synthetic.invalid', managementKey: '' })
    release(payload([references[1]]))
    await settle()
    expect(run.updates).toHaveLength(0)
    run.cleanup?.()
})

test('query, draft and generation snapshots hide already completed results immediately', async () => {
    wire(payload([references[1]]))
    const run = effect()
    await settle()
    const state = run.updates[run.updates.length - 1] ?? null
    for (const override of
        [
            { query: 'new-query' },
            { value: references[2] },
            { aliasesText: 'Renamed' },
            { searchGeneration: apiClient.getAuthGeneration() + 1 },
        ]) {
        expect(filtered({ ...run.scope, ...override }, state)).toEqual([])
    }
    run.cleanup?.()
    expect(filtered(run.scope, state)).toEqual([])
})

test('a raw saved-key match highlights only the hidden display value', () => {
    const subtitle = sourceExpression<React.ReactElement>(
        file, (node, tree) => ts.isJsxElement(node) &&
                              node.openingElement.getText(tree)
                                  .includes('className=\'item-subtitle\'') &&
                              node.getText(tree).includes('currentSavedKeySearch'),
        {
            React,
            redacted: true,
            currentSavedKeySearch: { matches: new Set([references[1]]) },
            item: { key: references[1] },
            styles: { searchHighlight: 'search-highlight' },
            visualT: (key: string) => i18n.t(`config_management.visual.${key}`),
        },
    )
    const html     = renderToStaticMarkup(subtitle)
    expect(html).toContain('<mark class="search-highlight">')
    expect(html).toContain(i18n.t('config_management.visual.api_keys.saved_key_hidden'))
    expect(html).not.toContain(query)
    expect(html).not.toContain(references[1])
})

test('actual alias highlighter and the editor pagination preserve case-insensitive marks and 20-item pages', () => {
    const highlight = sourceCallback<(text: string, query: string) => React.ReactNode>(file, 'highlightText', {
        React, Fragment: React.Fragment, styles: { searchHighlight: 'search-highlight' },
    })
    expect(renderToStaticMarkup(React.createElement('div', {}, highlight('PrimaryAlias', 'alias')))).toContain(
        '>Alias</mark>')
    for (const page of [1, 2]) {
        let stateIndex = 0
        const hook     = sourceCallback<(items: string[], size: number) => {
            currentItems: string[];
            pageSize: number
        }>('hooks/usePagination.ts', 'usePagination', {
            useState: (initial: unknown) => [
                stateIndex++ === 0 ? page : initial, () => {
                },
            ], useMemo: (callback: () => unknown) => callback(),
        })
        const paged    = sourceExpression<{ currentItems: string[]; pageSize: number }>(
            file,
            (
                node,
                tree,
            ) => ts.isCallExpression(node) &&
                 node.expression.getText(tree) ===
                 'usePagination' &&
                 node.arguments[0]?.getText(tree) ===
                 'filteredKeys',
            {
                filteredKeys: references,
                usePagination: hook,
            },
        )
        expect(paged.pageSize).toBe(20)
        expect(paged.currentItems).toEqual(references.slice((page - 1) * 20, page * 20))
    }
})

test('every supported language provides a search failure action', () => {
    for (const locale of ['zh-CN', 'zh-TW', 'en', 'ru']) {
        expect(i18n.getResource(locale, 'translation', 'config_management.visual.api_keys.search_failed')).toBeTruthy()
    }
})

for (const term of ['CONFIG', 'SECRET', '0000000000000000']) {
    test(`opaque reference text ${term} never matches a saved Key without a server match`, async () => {
        const saved = references.slice(0, 6)
        const calls = wire({ 'api-keys': saved, 'api-key-matches': [] })
        const run   = effect({ query: term, value: saved.join('\n') })
        await settle()
        const state = run.updates[run.updates.length - 1] ?? null
        expect(filtered(run.scope, state)).toEqual([])
        const draft = `sk-new-${term}-synthetic-draft-key`
        expect(filtered({ ...run.scope, value: saved.concat(draft).join('\n') }, state)).toEqual([
                                                                                                     {
                                                                                                         key: draft,
                                                                                                         index: 6,
                                                                                                     },
                                                                                                 ])
        expect(filtered(run.scope, state, { [saved[1]]: `Current-${term}-alias` })).toEqual([
                                                                                                {
                                                                                                    key: saved[1],
                                                                                                    index: 1,
                                                                                                },
                                                                                            ])
        expect(calls[0].params).toEqual({ api_key_search: term })
        run.cleanup?.()
    })
}

test('actual SDK accepts all 10000 matching opaque references with the original safety validation', async () => {
    const keys  = Array.from(
        { length: 10000 },
        (_, index) => `__CLI_PROXY_CONFIG_SECRET_${index.toString(16).padStart(32, '0')}__`,
    )
    const calls = wire({ 'api-keys': keys, 'api-key-matches': keys })
    expect(await apiKeysApi.search('synthetic-all-matches')).toEqual(keys)
    expect(calls).toHaveLength(1)
})
