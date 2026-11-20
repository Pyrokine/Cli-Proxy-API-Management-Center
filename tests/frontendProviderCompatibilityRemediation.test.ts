import {decodeVisualConfigYaml, encodeVisualConfigYaml} from '@/hooks/visualConfigCodec'
import {expect, test} from 'bun:test'
import {readFileSync} from 'node:fs'
import React, {type ReactElement} from 'react'
import {matchRoutes, type RouteObject} from 'react-router'
import {compile} from 'sass'
import ts from 'typescript'
import {parse} from 'yaml'
import {sourceCallback, sourceExpression, sourceInitializer} from './sourceCallbacks'

const noop = () => {
}

test('removed provider URLs resolve to NotFound while canonical credential editors remain registered', () => {
    const file   = 'router/MainRoutes.tsx'
    const source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')
    const pages  = Object.fromEntries([...source.matchAll(/<(?<component>[A-Z]\w*)\s*\//g)].map((match) => [
        match[1],
        () => null,
    ]))
    const build  = sourceInitializer<(enabled: boolean) => RouteObject[]>(file, 'buildMainRoutes', { React, ...pages })
    for (const enabled of [false, true]) {
        const routes = build(enabled)
        for (const path of ['/ai-providers', '/ai-providers/openai/0', '/ai-providers/claude/0/models']) {
            const matches = matchRoutes(routes, path)!
            expect(matches[matches.length - 1].route.path).toBe('*')
        }
        for (const path of ['/credentials/openai/0', '/credentials/claude/new', '/credentials/meta/1']) {
            const matches = matchRoutes(routes, path)!
            expect(matches.every((match) => match.route.path !== '*')).toBe(true)
        }
    }
})

test('vendor sections initially expose existing API keys and OAuth files and keep empty vendors collapsed', () => {
    for (const [keys, files, expected] of [[1, 0, true], [0, 1, true], [0, 0, false]] as const) {
        const [expanded] = sourceInitializer<[boolean]>('components/credentials/VendorSection.tsx', 'expanded', {
            useState: (value: boolean) => [value], data: { apiKeys: Array(keys), authFiles: Array(files) },
        })
        expect(expanded).toBe(expected)
    }
})

test('legacy boolean image mode decodes losslessly and writes a current mode only when edited', () => {
    for (const value of [true, false]) {
        const yaml    = `disable-image-generation: ${value}\n`
        const decoded = decodeVisualConfigYaml(yaml)
        expect(decoded.values.disableImageGeneration).toBe(value ? 'all' : 'off')
        expect(encodeVisualConfigYaml(yaml, decoded.values, decoded.values, decoded.apiKeysStorage, yaml)).toBe(yaml)
        const next = { ...decoded.values, disableImageGeneration: 'chat' as const }
        expect(parse(encodeVisualConfigYaml(
            yaml,
            next,
            decoded.values,
            decoded.apiKeysStorage,
            yaml,
        ))['disable-image-generation']).toBe('chat')
    }
})

test('model list refresh preserves custom and Auto connectivity model choices', () => {
    for (const testModel of ['', 'custom-model', 'Listed']) {
        for (const availableModels of [[], ['Listed'], ['replacement']]) {
            const chosen: string[] = []
            const effect           = sourceCallback<() => void>('hooks/useProviderEditLayout.ts', 'useEffect', {
                resolvedLoading: false, testModel, availableModels,
                setTestModel: (value: string) => chosen.push(value), setTestStatus: noop, setTestMessage: noop,
            }, 'availableModels.length === 0')
            effect()
            expect(chosen).toEqual([])
        }
    }
})

test('model selector preserves case-sensitive model identities and their individual aliases', () => {
    const select = sourceCallback<(entries: Array<{ name: string; alias: string }>) => Array<{
        value: string;
        label: string
    }>>(
        'hooks/useModelSelectOptions.ts', 'useModelSelectOptions', { useMemo: (build: () => unknown) => build() },
    )
    expect(select([
                      { name: 'Model-A', alias: 'Upper' },
                      { name: 'model-a', alias: 'Lower' },
                      { name: ' Model-A ', alias: '' },
                  ])).toEqual([
                                  { value: 'Model-A', label: 'Model-A (Upper)' },
                                  { value: 'model-a', label: 'model-a (Lower)' },
                              ])
})

test(
    'credential list refresh action invokes quota scheduling and authoritative refresh without inference',
    async () => {
        const calls: string[]          = []
        const pending: Promise<void>[] = []
        const refresh                  = sourceCallback<() => Promise<void>>(
            'components/credentials/VendorSection.tsx',
            'handleQuotaRefresh',
            {
                apiClient: { getAuthGeneration: () => 1 },
                authGeneration: 1,
                quotaKey: 'synthetic-quota',
                scheduler: {
                    refreshNow: async (key: string) => {
                        calls.push(key)
                    },
                },
                onRefresh: async () => {
                    calls.push('authoritative-refresh')
                },
                showNotification: noop,
                t: (key: string) => key,
            },
        )
        const refreshState             = sourceInitializer<{ onRefresh: () => void }>(
            'components/credentials/VendorSection.tsx',
            'refreshState',
            {
                lastRefreshTime: null, nextRefreshTime: null, isRefreshing: false,
                scheduler: { isAutoRefreshEnabled: () => true }, schedulerStatus: 'idle',
                handleQuotaRefresh: () => {
                    const result = refresh();
                    pending.push(result);
                    return result
                },
            },
        )
        const button                   =
                  sourceExpression<
                      ReactElement<{ onClick: () => void; title: string }>>(
                      'components/credentials/CredentialCard.tsx',
                      (node, tree) => ts.isJsxElement(node) &&
                                      node.openingElement.tagName.getText(tree) ===
                                      'Button' &&
                                      node.openingElement.attributes.properties.some(
                                          (attribute) => ts.isJsxAttribute(
                                                             attribute) &&
                                      attribute.name.getText(tree) ===
                                      'onClick' &&
                                      attribute.initializer?.getText(tree) ===
                                      '{refreshState.onRefresh}'),
                      {
                          React,
                          Button: () => null,
                          IconRefreshCw: () => null,
                          refreshState,
                          disableControls: false,
                          quotaResetState: undefined,
                          styles: {},
                          t: (key: string) => key,
                      },
                  )
        expect(calls).toEqual([])
        expect(button.props.title).toBe('auth_files.quota_refresh_hint')
        button.props.onClick()
        await Promise.all(pending)
        expect(calls).toEqual(['synthetic-quota', 'authoritative-refresh'])
    },
)

test('language and theme menus use the same compiled 14px label size as shared navigation', () => {
    const css = compile(
        new URL('../src/styles/layout.scss', import.meta.url).pathname,
        { logger: { warn: noop, debug: noop } },
    ).css
    for (const selector of ['.language-menu-option', '.theme-card-label']) {
        const rule = css.split('}').find((part) => part.split('{')[0].trim().endsWith(selector))
        expect(rule).toBeDefined()
        expect(rule).toContain('font-size: 14px')
    }
})

test('version history consumes shared pagination and presents a valid page after releases shrink', () => {
    const file          = 'components/system/VersionHistoryModal.tsx'
    const scope         = { sortedReleases: ['first', 'second'], pageIndex: 5, PAGE_SIZE: 1, totalPages: 2 }
    const safePageIndex = sourceInitializer<number>(file, 'safePageIndex', scope)
    const pageReleases  = sourceInitializer<string[]>(file, 'pageReleases', { ...scope, safePageIndex })
    expect(safePageIndex).toBe(1)
    expect(pageReleases).toEqual(['second'])
    const selected: number[] = []
    const pagination         = sourceExpression<ReactElement<{
        page: number;
        total: number;
        pageSize: number;
        onPageChange: (page: number) => void
    }>>(
        file,
        (node, tree) => ts.isJsxSelfClosingElement(node) && node.tagName.getText(tree) === 'Pagination',
        {
            React,
            Pagination: () => null,
            totalReleases: 2,
            safePageIndex,
            PAGE_SIZE: 1,
            // noinspection JSUnusedGlobalSymbols
            'setPageIndex': (page: number) => selected.push(page),
        },
    )
    expect(pagination.props).toMatchObject({ page: 2, total: 2, pageSize: 1 })
    pagination.props.onPageChange(1)
    expect(selected).toEqual([0])
})

test('OAuth exclusion YAML edits retain original rule spelling at the frontend boundary', () => {
    const yaml    = 'oauth-excluded-models:\n  claude:\n    - Claude-*\n'
    const decoded = decodeVisualConfigYaml(yaml)
    expect(parse(decoded.values.oauthExcludedModelsText)).toEqual({ claude: ['Claude-*'] })
    const next  = { ...decoded.values, oauthExcludedModelsText: 'claude: [Claude-*, NEW-Model]' }
    const saved = parse(encodeVisualConfigYaml(yaml, next, decoded.values, decoded.apiKeysStorage, yaml))
    expect(saved['oauth-excluded-models']).toEqual({ claude: ['Claude-*', 'NEW-Model'] })
})
