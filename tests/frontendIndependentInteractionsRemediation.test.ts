import {ApiKeysCardEditor} from '@/components/config/VisualConfigEditorBlocks'
import {
    buildInteractionsEndpoint,
    buildInteractionsProbePayload,
    INTERACTIONS_API_REVISION,
} from '@/components/providers/utils'
import {IconEye, IconEyeOff} from '@/components/ui/icons'
import {Input} from '@/components/ui/Input'
import {decodeVisualConfigYaml, encodeVisualConfigYaml, updateApiKeysStorageMetadata} from '@/hooks/visualConfigCodec'
import {ProviderConnectionFields} from '@/pages/ProviderFormFields'
import {apiClient} from '@/services/api/client'
import {configFileApi} from '@/services/api/configFile'
import type {ModelCatalogRow} from '@/services/api/models'
import type {PluginEntry} from '@/services/api/plugins'
import {EMPTY_API_KEY_MODEL_RULE, isApiKeyModelRuleEmpty} from '@/types/visualConfig'
import {isModelGloballyExcluded} from '@/utils/modelTree'
import {calculateStatusBarDataFromSummaryPoints, rateToColor} from '@/utils/usage'
import {isValidApiKey} from '@/utils/validation'
import {expect, spyOn, test} from 'bun:test'
import {readFileSync} from 'node:fs'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import ts from 'typescript'
import {parse, parseDocument} from 'yaml'
import i18n from '../src/i18n'
import {sourceCallback, sourceExpression, sourceInitializer} from './sourceCallbacks'

interface CatalogEntry {
    model: string;
    enabled: boolean;
    requestable: boolean
}

const modelKey       = sourceCallback<(model: string) => string>(
    'components/config/VisualConfigEditorBlocks.tsx',
    'modelKey',
    {},
)
const catalogEntries = sourceCallback<(rows: ModelCatalogRow[]) => CatalogEntry[]>(
    'components/config/VisualConfigEditorBlocks.tsx',
    'catalogModelEntries',
    { modelKey },
)
const row            = (name: string, patch: Partial<ModelCatalogRow> = {}): ModelCatalogRow => ({
    id: name,
    name,
    provider: 'synthetic',
    channel: 'codex',
    group: 'text',
    user_created: false,
    enabled: true,
    runtime_available: true,
    requestable: true, ...patch,
})

test('API Key model access excludes explicitly disabled and non-requestable catalog models', () => {
    const entries     = catalogEntries([
                                           row('available'),
                                           row('disabled', { enabled: false, requestable: false }),
                                           row('offline', { requestable: false, runtime_available: false }),
                                           row('legacy'),
                                       ])
    const scope       = {
        catalogEntries: entries,
        globallyExcludedModelKeys: new Set(['legacy']),
        // noinspection JSUnusedGlobalSymbols
        'isModelGloballyExcluded': isModelGloballyExcluded,
    }
    const available   = sourceCallback<() => CatalogEntry[]>(
        'components/config/VisualConfigEditorBlocks.tsx',
        'availableModelEntries',
        scope,
    )()
    const unavailable = sourceCallback<() => string[]>(
        'components/config/VisualConfigEditorBlocks.tsx',
        'unavailableModelNames',
        scope,
    )()
    expect(available.map((entry) => entry.model)).toEqual(['available'])
    expect(unavailable).toEqual(['disabled', 'legacy', 'offline'])
    const notices: unknown[][] = []
    sourceCallback<(t: unknown, models: string[]) => string>(
        'components/config/VisualConfigEditorBlocks.tsx',
        'getModelLimitUnavailableSummary',
        {},
    )(
        (...args: unknown[]) => {
            notices.push(args);
            return 'notice'
        },
        unavailable,
    )
    expect(notices[0]).toMatchObject([
                                         'config_management.visual.api_keys.model_limit_unavailable_summary',
                                         { count: 3, models: 'disabled、legacy、offline' },
                                     ])
})

test('a canonical model is usable if any catalog row is enabled and requestable', () => {
    const entries = catalogEntries([
                                       row('shared', { provider: 'one', enabled: false, requestable: false }),
                                       row('shared', { provider: 'two' }),
                                       row('all-disabled', { enabled: false, requestable: false }),
                                   ])
    expect(entries.find((entry) => entry.model === 'shared')).toMatchObject({ enabled: true, requestable: true })
    expect(entries.find((entry) => entry.model === 'all-disabled')).toMatchObject({
                                                                                      enabled: false,
                                                                                      requestable: false,
                                                                                  })
})

test('saving Key rules preserves restrictions for catalog models that are currently unavailable or absent', () => {
    const saved: Array<Record<string, typeof EMPTY_API_KEY_MODEL_RULE>> = []

    const uniqueSorted = sourceCallback<(values: Iterable<string>) => string[]>(
        'components/config/VisualConfigEditorBlocks.tsx',
        'uniqueSorted',
        { modelKey },
    )
    sourceInitializer<() => void>('components/config/VisualConfigEditorBlocks.tsx', 'saveModelLimitRules', {
        modelLimitKey: 'synthetic-key',
        modelLimitCatalogReady: true,
        draftBlockedModels: new Set(['disabled', 'not-in-catalog']),
        modelRules: { 'synthetic-key': { ...EMPTY_API_KEY_MODEL_RULE, blockedModels: ['disabled', 'not-in-catalog'] } },
        EMPTY_API_KEY_MODEL_RULE,
        uniqueSorted,
        isApiKeyModelRuleEmpty,
        closeModelLimitModal: () => {
        },
        onModelRulesChange: (value: Record<string, typeof EMPTY_API_KEY_MODEL_RULE>) => saved.push(value),
    })()
    expect(saved[0]['synthetic-key'].blockedModels).toEqual(['disabled', 'not-in-catalog'])
})

const firstReference            = '__CLI_PROXY_CONFIG_SECRET_11111111111111111111111111111111__'
const secondReference           = '__CLI_PROXY_CONFIG_SECRET_22222222222222222222222222222222__'
const referenceYaml             = `api-keys: [${firstReference}, ${secondReference}]
api-key-aliases:
  ${firstReference}: original
api-key-rules:
  ${firstReference}:
    blocked-models: [original-model]
future-setting: preserved
`
const CONFIG_SECRET_PLACEHOLDER = /^__CLI_PROXY_CONFIG_SECRET_[0-9a-f]{32}__$/
const keyEditorFile             = 'components/config/VisualConfigEditorBlocks.tsx'

function referenceDraft(aliasValue: string, inputValue = '', keyIndex = 0, source = referenceYaml) {
    const decoded          = decodeVisualConfigYaml(source)
    let storage            = decoded.apiKeysStorage
    let next               = { ...decoded.values }
    const errors: string[] = []
    const scope            = {
        aliasConfigError: '', apiKeys: decoded.values.apiKeysText.split('\n'),
        renderApiKeyIds: ['first', 'second', 'root-only'], editingApiKeyId: ['first', 'second', 'root-only'][keyIndex],
        inputValue, aliasValue, aliasDocument: parseDocument(decoded.values.apiKeyAliasesText),
        aliases: parse(decoded.values.apiKeyAliasesText), modelRules: decoded.values.apiKeyRules,
        CONFIG_SECRET_PLACEHOLDER,
        // noinspection JSUnusedGlobalSymbols
        'isValidApiKey': isValidApiKey,
        validateAlias: sourceCallback<(alias: string) => string | null>(
            keyEditorFile,
            'validateAlias',
            { visualT: (key: string) => key },
        ),
        setFormError: (value: string) => errors.push(value), setAliasError: (value: string) => errors.push(value),
        visualT: (key: string) => key, t: (key: string) => key,
        updateApiKeys: (keys: string[], aliases: string) => {
            storage = updateApiKeysStorageMetadata(storage, next.apiKeysText, keys.join('\n'))
            next    = { ...next, apiKeysText: keys.join('\n'), apiKeyAliasesText: aliases }
        },
        onModelRulesChange: (apiKeyRules: typeof next.apiKeyRules) => {
            next = { ...next, apiKeyRules }
        },
        // noinspection JSUnusedGlobalSymbols
        'closeModal': () => {
        }, setApiKeyIds: () => {
        },
    }
    sourceInitializer<() => void>(keyEditorFile, 'handleSave', scope)()
    return {
        decoded, get next() {
            return next
        }, get storage() {
            return storage
        }, errors, scope,
    }
}

test(
    (
        'saved client keys retain edit, model access, policy and delete ' +
        'actions without exposing or copying opaque references'
    ),
    () => {
        const decoded = decodeVisualConfigYaml(referenceYaml)
        const html    = renderToStaticMarkup(React.createElement(ApiKeysCardEditor, {
            value: decoded.values.apiKeysText, aliasesText: decoded.values.apiKeyAliasesText,
            modelRules: decoded.values.apiKeyRules, onChange: () => {
            }, onModelRulesChange: () => {
            },
        }))
        expect(html).not.toContain(firstReference)
        expect(html).not.toContain(secondReference)
        expect(html.match(/class="item-actions"/g)).toHaveLength(2)
        expect(html).toContain('original')
        expect(html).not.toContain('>Copy<')
        const changes: unknown[] = []
        sourceInitializer<(id: string) => void>(keyEditorFile, 'openEditModal', {
            renderApiKeyIds: ['first'],
            apiKeys: [firstReference],
            aliases: { [firstReference]: 'original' },
            CONFIG_SECRET_PLACEHOLDER,
            // noinspection JSUnusedGlobalSymbols
            'setEditingApiKeyId': () => {
            },
            // noinspection JSUnusedGlobalSymbols
            'setInputValue': (value: string) => changes.push(value),
            setFormError: () => {
            },
            // noinspection JSUnusedGlobalSymbols
            'setApiKeyVisible': () => {
            },
            // noinspection JSUnusedGlobalSymbols
            'setAliasValue': (value: string) => changes.push(value),
            setAliasError: () => {
            },
            // noinspection JSUnusedGlobalSymbols
            'setModalOpen': () => {
            },
        })('first')
        expect(changes).toEqual(['', 'original'])
    },
)

test('saved client key alias can be added, renamed and cleared while its opaque identity remains unchanged', () => {
    for (const [index, alias] of [[0, 'renamed'], [1, 'new_alias'], [0, '']] as const) {
        const { decoded, next, errors } = referenceDraft(alias, '', index)
        expect(errors).toEqual([])
        const saved = parse(encodeVisualConfigYaml(
            referenceYaml,
            next,
            decoded.values,
            decoded.apiKeysStorage,
            referenceYaml,
        ))
        expect(saved['api-keys']).toEqual([firstReference, secondReference])
        expect(saved['api-key-aliases']?.[[firstReference, secondReference][index]]).toBe(alias || undefined)
        expect(saved['api-key-rules'][firstReference]['blocked-models']).toEqual(['original-model'])
        expect(saved['future-setting']).toBe('preserved')
    }
})

test(
    (
        'saved client key aliases, model access and policies reach ' +
        'prepared validation and the conditional YAML save together'
    ),
    async () => {
        const { decoded, next, errors } = referenceDraft('second', '', 1)
        expect(errors).toEqual([])
        sourceInitializer<() => void>(keyEditorFile, 'saveModelLimitRules', {
            modelLimitKey: secondReference, modelLimitCatalogReady: true,
            draftBlockedModels: new Set(['model-b']), modelRules: next.apiKeyRules,
            EMPTY_API_KEY_MODEL_RULE, isApiKeyModelRuleEmpty,
            uniqueSorted: (models: Iterable<string>) => [...models], closeModelLimitModal: () => {
            },
            onModelRulesChange: (apiKeyRules: typeof next.apiKeyRules) => {
                next.apiKeyRules = apiKeyRules
            },
        })()
        sourceInitializer<(rule: typeof EMPTY_API_KEY_MODEL_RULE) => void>(keyEditorFile, 'savePolicyRule', {
            policyKey: secondReference, modelRules: next.apiKeyRules, isApiKeyModelRuleEmpty,
            // noinspection JSUnusedGlobalSymbols
            'setPolicyKey': () => {
            },
            onModelRulesChange: (apiKeyRules: typeof next.apiKeyRules) => {
                next.apiKeyRules = apiKeyRules
            },
        })({ ...next.apiKeyRules[secondReference], providers: ['codex'] })
        next.apiKeysText = `${secondReference}\n${firstReference}`
        const yaml       = encodeVisualConfigYaml(
            referenceYaml,
            next,
            decoded.values,
            decoded.apiKeysStorage,
            referenceYaml,
        )
        const saved      = parse(yaml)
        expect(saved['api-keys']).toEqual([secondReference, firstReference])
        expect(saved['api-key-aliases'][secondReference]).toBe('second')
        expect(saved['api-key-rules'][secondReference]).toMatchObject({
                                                                          'blocked-models': ['model-b'],
                                                                          providers: ['codex'],
                                                                      })
        const post = spyOn(apiClient, 'post').mockResolvedValue({ valid: true, errors: [], warnings: [] })
        const put  = spyOn(apiClient, 'put').mockResolvedValue({ status: 'ok' })
        try {
            expect((await configFileApi.validateConfigYaml(yaml)).valid).toBe(true)
            await configFileApi.saveConfigYaml(yaml, '"synthetic-etag"')
            expect(post.mock.calls[0]?.[1]).toBe(yaml)
            expect(put.mock.calls[0]).toMatchObject([
                                                        '/config.yaml',
                                                        yaml,
                                                        { headers: { 'If-Match': '"synthetic-etag"' } },
                                                    ])
        } finally {
            post.mockRestore();
            put.mockRestore()
        }
    },
)

test(
    'saved client key replacement transfers aliases and policies; deletion removes only its matching draft entries',
    () => {
        const { decoded, next, errors } = referenceDraft('rotated', 'synthetic-replacement')
        expect(errors).toEqual([])
        expect(next.apiKeysText.split('\n')).toEqual(['synthetic-replacement', secondReference])
        expect(next.apiKeyRules['synthetic-replacement'].blockedModels).toEqual(['original-model'])
        expect(next.apiKeyRules[firstReference]).toBeUndefined()
        let removed = { ...decoded.values }
        sourceInitializer<(id: string) => void>(keyEditorFile, 'handleDelete', {
            aliasConfigError: '',
            apiKeys: [firstReference, secondReference],
            renderApiKeyIds: ['first', 'second'],
            aliasDocument: parseDocument(decoded.values.apiKeyAliasesText),
            modelRules: decoded.values.apiKeyRules,
            setApiKeyIds: () => {
            },
            updateApiKeys: (keys: string[], aliases: string) => {
                removed = { ...removed, apiKeysText: keys.join('\n'), apiKeyAliasesText: aliases }
            },
            onModelRulesChange: (apiKeyRules: typeof removed.apiKeyRules) => {
                removed = { ...removed, apiKeyRules }
            },
        })('first')
        const yaml = parse(encodeVisualConfigYaml(
            referenceYaml,
            removed,
            decoded.values,
            decoded.apiKeysStorage,
            referenceYaml,
        ))
        expect(yaml['api-keys']).toEqual([secondReference])
        expect(yaml['api-key-aliases']?.[firstReference]).toBeUndefined()
        expect(yaml['api-key-rules']?.[firstReference]).toBeUndefined()
        expect(parse(referenceYaml)['api-keys']).toEqual([firstReference, secondReference])
    },
)

test(
    (
        'sidebar shortcut help opens for keyboard focus, mouse hover and ' +
        'touch click while preserving the navigation action'
    ),
    () => {
        let visible   = false
        let collapsed = false
        const scope   = {
            React, sidebarHintRef: { current: null }, sidebarHintId: 'shortcut-help', sidebarHintVisible: visible,
            sidebarCollapsed: collapsed, sidebarToggleLabel: 'Collapse', sidebarShortcutLabel: 'Ctrl+B',
            headerIcons: { chevronLeft: null, chevronRight: null },
            setSidebarHintVisible: (value: boolean) => {
                visible = value
            },
            // noinspection JSUnusedGlobalSymbols
            'setSidebarCollapsed': (change: (value: boolean) => boolean) => {
                collapsed = change(collapsed)
            },
        }
        type Help = React.ReactElement<{
            onPointerEnter: (event: { pointerType: string }) => void
            onPointerLeave: (event: { pointerType: string }) => void
            children: [
                React.ReactElement<{
                    onFocus: () => void;
                    onBlur: () => void;
                    onClick: () => void;
                    'aria-describedby': string
                }>, React.ReactElement<{ hidden: boolean }>
            ]
        }>
        const render = () => {
            scope.sidebarHintVisible = visible;
            scope.sidebarCollapsed   = collapsed
            return sourceExpression<Help>(
                'components/layout/MainLayout.tsx',
                (node, tree) => ts.isJsxElement(node) &&
                                node.openingElement.attributes.properties.some((attribute) => ts.isJsxAttribute(
                                                                                                  attribute) &&
                                attribute.name.getText(tree) ===
                                'className' &&
                                attribute.initializer?.getText(tree) ===
                                '\'sidebar-toggle-wrap\''),
                scope,
            )
        }
        let help     = render()
        expect(help.props.children[1].props.hidden).toBe(true)
        help.props.children[0].props.onFocus()
        expect(render().props.children[1].props.hidden).toBe(false)
        help.props.children[0].props.onBlur()
        expect(visible).toBe(false)
        help.props.onPointerEnter({ pointerType: 'mouse' })
        expect(visible).toBe(true)
        help.props.onPointerLeave({ pointerType: 'mouse' })
        expect(visible).toBe(false)
        help.props.children[0].props.onClick()
        expect(collapsed).toBe(true)
        expect(visible).toBe(true)
        help = render()
        expect(renderToStaticMarkup(help)).toContain('Ctrl+B')
        expect(help.props.children[0].props['aria-describedby']).toBe('shortcut-help')
    },
)

test('sidebar help dismisses on outside pointer and Escape and removes listeners on cleanup', () => {
    const listeners = new Map<string, (event: { target?: object; key?: string }) => void>()
    const inside    = {};
    let visible     = true
    const cleanup   = sourceCallback<() => (() => void)>('components/layout/MainLayout.tsx', 'useEffect', {
        sidebarHintVisible: true, sidebarHintRef: { current: { contains: (value: object) => value === inside } },
        setSidebarHintVisible: (value: boolean) => {
            visible = value
        },
        document: {
            addEventListener: (type: string, fn: (event: { target?: object; key?: string }) => void) => listeners.set(
                type,
                fn,
            ),
            removeEventListener: (type: string) => listeners.delete(type),
        },
    }, 'handleSidebarHintOutside')()
    listeners.get('pointerdown')?.({ target: inside })
    expect(visible).toBe(true)
    listeners.get('pointerdown')?.({ target: {} })
    expect(visible).toBe(false)
    visible = true
    listeners.get('keydown')?.({ key: 'Escape' })
    expect(visible).toBe(false)
    cleanup()
    expect(listeners.size).toBe(0)
})

test(
    (
        'expanded string editing preserves the original callback and ' +
        'type, cancels without mutation, and restores the original input ' +
        'focus target'
    ),
    () => {
        const patches: unknown[] = []
        let draft: string | null = null
        const Button             = () => null;
        const Modal              = () => null
        const t                  = (key: string) => key
        type Props = {
            value: string;
            disabled?: boolean;
            'aria-label': string;
            placeholder: string;
            onChange: (event: { target: { value: string } }) => void
        }
        type EditorTree = React.ReactElement<{
            children: [
                React.ReactElement<{ id: string }>, React.ReactElement<{ onClick: () => void }>, React.ReactElement<{
                    open: boolean; onClose: () => void; returnFocusId: string; initialFocusId: string;
                    footer: React.ReactElement<{ children: Array<React.ReactElement<{ onClick: () => void }>> }>;
                    children: React.ReactElement<{
                        id: string;
                        onChange: (event: { target: { value: string } }) => void
                    }>
                }>
            ]
        }>
        const Editor       = sourceCallback<(props: Props) => EditorTree>(keyEditorFile, 'PayloadStringEditor', {
            React, Button, Modal, styles: {}, useTranslation: () => ({ t }), useId: () => 'original-input',
            useState: () => [
                draft, (value: string | null) => {
                    draft = value
                },
            ],
        })
        const payloadParam = {
            id: 'string',
            path: 'system',
            valueType: 'string' as const,
            value: 'long original '.repeat(50),
        }
        const field        = sourceCallback<(
            param: typeof payloadParam,
            t: unknown,
            disabled: boolean,
            onChange: (patch: unknown) => void,
            raw?: boolean,
        ) => React.ReactElement<Props>>(
            keyEditorFile, 'renderParamValueEditor', { React, styles: {}, PayloadStringEditor: Editor },
        )(payloadParam, t, false, (patch) => patches.push(patch))
        expect(field.type).toBe(Editor)
        let tree = Editor(field.props)
        tree.props.children[1].props.onClick()
        tree        = Editor(field.props)
        const modal = tree.props.children[2]
        expect(modal.props.open).toBe(true)
        expect(modal.props.returnFocusId).toBe(tree.props.children[0].props.id)
        expect(modal.props.initialFocusId).toBe(modal.props.children.props.id)
        modal.props.children.props.onChange({ target: { value: 'line one\nline two' } })
        modal.props.onClose()
        expect(patches).toEqual([])
        expect(draft).toBeNull()
        tree.props.children[1].props.onClick()
        tree = Editor(field.props)
        tree.props.children[2].props.children.props.onChange({ target: { value: 'line one\nline two' } })
        Editor(field.props).props.children[2].props.footer.props.children[1].props.onClick()
        expect(patches).toEqual([{ value: 'line one\nline two' }])
        expect(payloadParam.valueType).toBe('string')
        expect(draft).toBeNull()
    },
)

test('status buckets use actual counts for pointer, keyboard and touch disclosures and can collapse', () => {
    const file      = 'components/credentials/CredentialCard.tsx'
    const selection = { current: null as number | null }
    const statusBar = calculateStatusBarDataFromSummaryPoints([
                                                                  {
                                                                      time: new Date(1500).toISOString(),
                                                                      requests: 4,
                                                                      success: 3,
                                                                      failure: 1,
                                                                      tokens: {
                                                                          input: 40,
                                                                          output: 2,
                                                                          cached: 0,
                                                                          reasoning: 0,
                                                                          total: 42,
                                                                      },
                                                                      cost: 0,
                                                                      has_cost: false,
                                                                  },
                                                              ], 1000, 1000, 2)
    expect(statusBar).toMatchObject({ totalSuccess: 3, totalFailure: 1, successRate: 75 })
    expect(statusBar.blockDetails[0]).toMatchObject({ startTime: 1000, endTime: 2000, rate: 0.75, totalTokens: 42 })
    const scope = {
        React, statusBar, styles: {}, statusBucketId: 'bucket', activeStatusBucket: selection.current,
        setActiveStatusBucket: (change: number | null | ((current: number | null) => number | null)) => {
            selection.current = typeof change === 'function' ? change(selection.current) : change
        },
        formatDateTime: (value: Date) => String(value.getTime()), i18n: { language: 'en' },
        // noinspection JSUnusedGlobalSymbols
        'rateToColor': rateToColor,
        t: (key: string) => key,
    }
    type Bucket = React.ReactElement<{
        children: [
            React.ReactElement<{
                'aria-expanded': boolean; 'aria-describedby': string; 'aria-label': string; style: React.CSSProperties;
                onFocus: (event: { currentTarget: { matches: () => boolean } }) => void;
                onPointerEnter: (event: { pointerType: string }) => void; onClick: () => void;
            }>, React.ReactElement<{ id: string; hidden: boolean; children: string }>
        ]
    }>
    const render = () => {
        scope.activeStatusBucket = selection.current
        return sourceExpression<Bucket[]>(
            file,
            (node, tree) => ts.isCallExpression(node) &&
                            node.expression.getText(tree) ===
                            'statusBar.blockDetails.map',
            scope,
        )[0]
    }
    let bucket   = render()
    expect(bucket.props.children[0].props['aria-expanded']).toBe(false)
    bucket.props.children[0].props.onFocus({ currentTarget: { matches: () => true } })
    bucket = render()
    expect(bucket.props.children[0].props['aria-expanded']).toBe(true)
    expect(bucket.props.children[1].props.children).toContain('common.success: 3')
    expect(bucket.props.children[1].props.children).toContain('common.failure: 1')
    expect(bucket.props.children[1].props.children).toContain('credentials.status_block_tokens: 42')
    expect(bucket.props.children[0].props['aria-label']).toBe('1000 – 2000')
    expect(bucket.props.children[0].props.style).toEqual({ backgroundColor: rateToColor(0.75) })
    expect(bucket.props.children[0].props['aria-describedby']).toBe(bucket.props.children[1].props.id)
    const idle = sourceExpression<Bucket[]>(file, (node, tree) =>
        ts.isCallExpression(node) && node.expression.getText(tree) === 'statusBar.blockDetails.map', scope)[1]
    expect(idle.props.children[1].props.children).toContain('credentials.status_block_idle')
    expect(idle.props.children[1].props.children).not.toContain('credentials.status_block_tokens')
    expect(idle.props.children[0].props.style).toBeUndefined()
    bucket.props.children[0].props.onClick()
    expect(selection.current).toBeNull()
    bucket.props.children[0].props.onFocus({ currentTarget: { matches: () => false } })
    bucket.props.children[0].props.onPointerEnter({ pointerType: 'touch' })
    expect(selection.current).toBeNull()
    bucket.props.children[0].props.onClick()
    expect(render().props.children[1].props.hidden).toBe(false)
    render().props.children[0].props.onClick()
    expect(selection.current).toBeNull()
    render().props.children[0].props.onPointerEnter({ pointerType: 'mouse' })
    expect(selection.current).toBe(0)
    const listeners = new Map<string, (event: { target: object }) => void>();
    const inside    = {}
    const cleanup   = sourceCallback<() => () => void>(file, 'useEffect', {
        activeStatusBucket: 0, statusBarRef: { current: { contains: (value: object) => value === inside } },
        setActiveStatusBucket: scope.setActiveStatusBucket,
        document: {
            addEventListener: (key: string, fn: (event: { target: object }) => void) => listeners.set(key, fn),
            removeEventListener: (key: string) => listeners.delete(key),
        },
    }, 'closeStatusBucketOutside')()
    listeners.get('pointerdown')?.({ target: inside })
    expect(selection.current).toBe(0)
    listeners.get('pointerdown')?.({ target: {} })
    expect(selection.current).toBeNull()
    cleanup()
    expect(listeners.size).toBe(0)
    const bar         = sourceExpression<React.ReactElement<{
        onPointerLeave: (event: { pointerType: string }) => void;
        onBlur: (event: { currentTarget: { contains: (target: object) => boolean }; relatedTarget: object }) => void;
        onKeyDown: (event: { key: string; stopPropagation: () => void }) => void;
    }>>(
        file, (node, tree) => ts.isJsxElement(node) &&
                              node.openingElement.getText(tree).includes('ref={statusBarRef}'),
        {
            ...scope, statusBarRef: { current: null },
            // noinspection JSUnusedGlobalSymbols
            'statusRateClass': () => '',
        },
    )
    selection.current = 0
    bar.props.onPointerLeave({ pointerType: 'touch' })
    expect(selection.current).toBe(0)
    bar.props.onPointerLeave({ pointerType: 'mouse' })
    expect(selection.current).toBeNull()
    selection.current   = 0
    const currentTarget = { contains: (target: object) => target === inside }
    bar.props.onBlur({ currentTarget, relatedTarget: inside })
    expect(selection.current).toBe(0)
    bar.props.onBlur({ currentTarget, relatedTarget: {} })
    expect(selection.current).toBeNull()
    selection.current = 0
    let stopped       = 0
    bar.props.onKeyDown({
                            key: 'Enter', stopPropagation: () => {
            stopped += 1
        },
                        })
    expect(selection.current).toBe(0)
    expect(stopped).toBe(0)
    bar.props.onKeyDown({
                            key: 'Escape', stopPropagation: () => {
            stopped += 1
        },
                        })
    expect(selection.current).toBeNull()
    expect(stopped).toBe(1)
})

test('Devin sessions expose their five-minute lifetime and v7.3.1 condition in the real start/wait flow', () => {
    const file = 'components/credentials/OAuthLoginAction.tsx'
    for (const language of ['en', 'zh-CN', 'zh-TW', 'ru']) {
        const scope  = { React, plugin: false, provider: 'devin', styles: {}, t: i18n.getFixedT(language) }
        const notice = sourceInitializer<React.ReactElement | null>(file, 'devinSessionNotice', scope)
        const html   = renderToStaticMarkup(notice)
        expect(html).toContain('5')
        expect(html).toContain('v7.3.1')
        expect(sourceInitializer(file, 'devinSessionNotice', { ...scope, plugin: true })).toBeNull()
        expect(sourceInitializer(file, 'devinSessionNotice', { ...scope, provider: 'codex' })).toBeNull()
    }
    const source = readFileSync(new URL('../src/components/credentials/OAuthLoginAction.tsx', import.meta.url), 'utf8')
    expect(source.match(/\{devinSessionNotice}/g)).toHaveLength(2)
})

test(
    'Provider secret inputs opt out of password managers while the management login retains saved-password semantics',
    () => {
        const html = renderToStaticMarkup(React.createElement(ProviderConnectionFields, {
            form: { apiKey: 'synthetic-provider-key', headers: [] }, setForm: () => {
            }, disabled: false,
            apiKeyLabel: 'Provider key', baseUrlLabel: 'Endpoint', supportsErrorRules: false,
        }))
        expect(html.toLowerCase()).toContain('autocomplete="new-password"')
        expect(html.toLowerCase()).toContain('spellcheck="false"')
        expect(html.toLowerCase()).toContain('autocapitalize="none"')
        expect(html.toLowerCase()).toContain('autocorrect="off"')
        expect(html).toContain('data-lpignore="true"')
        expect(html).toContain('data-1p-ignore="true"')
        for (const showKey of [false, true]) {
            const element = sourceExpression<React.ReactElement<React.ComponentProps<typeof Input>>>(
                'pages/LoginPage.tsx',
                (node, tree) => ts.isJsxSelfClosingElement(node) && node.tagName.getText(tree) === 'Input' &&
                                node.attributes.properties.some((attribute) => ts.isJsxAttribute(attribute) &&
                                attribute.name.getText(tree) === 'label' &&
                                attribute.initializer?.getText(tree).includes('login.management_key_label') === true),
                {
                    React, Input, IconEye, IconEyeOff, showKey, styles: {},
                    t: i18n.getFixedT('en'), managementKey: 'synthetic-management-key',
                    // noinspection JSUnusedGlobalSymbols
                    'setManagementKey': () => {
                    },
                    // noinspection JSUnusedGlobalSymbols
                    'handleSubmitKeyDown': () => {
                    },
                    // noinspection JSUnusedGlobalSymbols
                    'setShowKey': () => {
                    },
                },
            )
            const login   = renderToStaticMarkup(element)
            expect(login).toContain('name="management-key"')
            expect(login.toLowerCase()).toContain('autocomplete="current-password"')
            expect(login).toContain(`type="${showKey ? 'text' : 'password'}"`)
            expect(login).toContain('value="synthetic-management-key"')
            expect(login).not.toContain('data-lpignore')
            expect(login).not.toContain('data-1p-ignore')
        }
        const openAI = readFileSync(new URL('../src/pages/AiProvidersOpenAIEditPage.tsx', import.meta.url), 'utf8')
        expect(openAI).toContain('data-lpignore=\'true\'')
        expect(openAI).toContain('data-1p-ignore=\'true\'')
        const custom = renderToStaticMarkup(React.createElement(
            Input,
            { ...{ 'data-lpignore': 'false' }, secret: true },
        ))
        expect(custom).toContain('data-lpignore="false"')
    },
)

test(
    'recent-success resource sorting displays the actual summary window instead of implying last-success timestamps',
    () => {
        const file   = 'components/credentials/VendorSection.tsx'
        const render = (window: { startMs: number } | undefined) => sourceExpression<React.ReactElement>(
            file,
            (
                node,
                tree,
            ) => ts.isJsxElement(node) &&
                 node.getText(tree)
                     .startsWith(/* language=TEXT */ '<div className=\'hint\' role=\'status\'>') &&
                 node.getText(tree)
                     .includes('credentials.recent_success_window'),
            {
                React,
                authIndexUsageWindow: window,
                formatDateTime: (value: Date) => value.toISOString(),
                t: (
                    key: string,
                    params?: {
                        from: string
                    },
                ) => `${key} ${params?.from ??
                               ''}`,
            },
        )
        expect(renderToStaticMarkup(render({ startMs: Date.parse('2026-11-01T02:00:00Z') }))).toContain(
            '2026-11-01T02:00:00.000Z')
        expect(renderToStaticMarkup(render(undefined))).toContain('credentials.recent_success_window_unavailable')
    },
)

const rootOnlyReference = '__CLI_PROXY_CONFIG_SECRET_33333333333333333333333333333333__'
const nestedSchemas     = [
    { name: 'scalar', field: 'api-key-entries', entries: [firstReference, secondReference] },
    {
        name: 'object',
        field: 'api-key-entries',
        entries: [
            { 'api-key': firstReference, label: 'first', priority: 7 },
            { 'api-key': secondReference, metadata: { region: 'test' } },
        ],
    },
    {
        name: 'mixed',
        field: 'api-key-entries',
        entries: [firstReference, { 'api-key': secondReference, metadata: { region: 'test' } }],
    },
    { name: 'legacy', field: 'api-keys', entries: [firstReference, secondReference] },
]

function structuredReferenceSource(schema: typeof nestedSchemas[number], withRoot: boolean) {
    return JSON.stringify({
                              ...(withRoot ? { 'api-keys': [firstReference, rootOnlyReference] } : {}),
                              auth: {
                                  providers: {
                                      'config-api-key': {
                                          [schema.field]: schema.entries,
                                          'future-setting': 'preserved',
                                      },
                                  },
                              },
                              'api-key-aliases': { [firstReference]: 'original' },
                              'api-key-rules': { [firstReference]: { 'blocked-models': ['original-model'] } },
                          })
}

const entryKey = (entry: string | Record<string, unknown>): string => typeof entry === 'string' ?
                                                                      entry :
                                                                      String(entry['api-key'])
for (const schema of nestedSchemas) {
    for (const withRoot of [false, true]) {
        test(
            `structured client reference ${schema.name}, root=${withRoot
            } preserves schema, metadata and key identity through edit/validate/If-Match`,
            async () => {
                const source = structuredReferenceSource(schema, withRoot)
                const flow   = referenceDraft('second', '', 1, source)
                expect(flow.errors).toEqual([])
                expect(flow.next.apiKeysText.split('\n')).toEqual(withRoot ?
                                                                      [
                                                                          firstReference,
                                                                          secondReference,
                                                                          rootOnlyReference,
                                                                      ] :
                                                                      [firstReference, secondReference])
                sourceInitializer<() => void>(keyEditorFile, 'saveModelLimitRules', {
                    modelLimitKey: secondReference,
                    modelLimitCatalogReady: true,
                    draftBlockedModels: new Set(['model-b']),
                    modelRules: flow.next.apiKeyRules,
                    EMPTY_API_KEY_MODEL_RULE,
                    isApiKeyModelRuleEmpty,
                    uniqueSorted: (models: Iterable<string>) => [...models],
                    closeModelLimitModal: () => {
                    },
                    onModelRulesChange: flow.scope.onModelRulesChange,
                })()
                flow.next.apiKeysText = flow.next.apiKeysText.split('\n').reverse().join('\n')
                const yaml            = encodeVisualConfigYaml(
                    source,
                    flow.next,
                    flow.decoded.values,
                    flow.storage,
                    source,
                )
                const output          = parse(yaml)
                const provider        = output.auth.providers['config-api-key']
                expect(provider['future-setting']).toBe('preserved')
                expect(provider[schema.field]).toEqual([...schema.entries].reverse())
                expect(output['api-keys']).toEqual(withRoot ? [rootOnlyReference, firstReference] : undefined)
                expect(output['api-key-aliases'][secondReference]).toBe('second')
                expect(output['api-key-rules'][secondReference]['blocked-models']).toEqual(['model-b'])
                const post = spyOn(apiClient, 'post').mockResolvedValue({ valid: true, errors: [], warnings: [] })
                const put  = spyOn(apiClient, 'put').mockResolvedValue({ status: 'ok' })
                try {
                    expect((await configFileApi.validateConfigYaml(yaml)).valid).toBe(true)
                    await configFileApi.saveConfigYaml(yaml, '"structured-etag"')
                    expect(post.mock.calls[0]?.[1]).toBe(yaml)
                    expect(put.mock.calls[0]).toMatchObject([
                                                                '/config.yaml',
                                                                yaml,
                                                                { headers: { 'If-Match': '"structured-etag"' } },
                                                            ])
                } finally {
                    post.mockRestore();
                    put.mockRestore()
                }
            },
        )
    }
}

test(
    'editing/deleting a nested key retains independent root keys, and root-only key edits stay in the root schema',
    () => {
        const schema = nestedSchemas[2]
        const source = structuredReferenceSource(schema, true)
        for (const index of [1, 2]) {
            const flow = referenceDraft('rotated', 'synthetic-rotated-key', index, source)
            expect(flow.errors).toEqual([])
            const output = parse(encodeVisualConfigYaml(source, flow.next, flow.decoded.values, flow.storage, source))
            const nested = output.auth.providers['config-api-key']['api-key-entries']
            expect(nested.map(entryKey)).toEqual(index === 1 ?
                                                     [firstReference, 'synthetic-rotated-key'] :
                                                     [firstReference, secondReference])
            expect(output['api-keys']).toEqual(index === 1 ?
                                                   [firstReference, rootOnlyReference] :
                                                   [firstReference, 'synthetic-rotated-key'])
        }
        const flow = referenceDraft('second', '', 1, source)
        sourceInitializer<(id: string) => void>(keyEditorFile, 'handleDelete', flow.scope)('second')
        const output = parse(encodeVisualConfigYaml(source, flow.next, flow.decoded.values, flow.storage, source))
        expect(output.auth.providers['config-api-key']['api-key-entries']).toEqual([firstReference])
        expect(output['api-keys']).toEqual([firstReference, rootOnlyReference])
    },
)

const pluginFixture: PluginEntry = {
    id: 'synthetic',
    path: '',
    configured: true,
    registered: true,
    enabled: true,
    effective_enabled: true,
    supports_oauth: false,
    logo: '',
    config: { limit: 1 },
    config_fields: [],
    menus: [],
    metadata: null,
}

test(
    (
        'plugin runtime polling waits for actual enabled state, reports ' +
        'timeout/loading failure and rejects stale ownership'
    ),
    async () => {
        const file         = 'pages/pluginPolling.ts'
        let now            = 0;
        let current        = true;
        let calls          = 0
        let load           = async () => {
            ++calls;
            return {
                plugins_enabled: true,
                plugins_dir: '',
                plugins: [{ ...pluginFixture, effective_enabled: calls > 1 }],
            }
        }
        const waitForState = sourceCallback<(
            id: string,
            predicate: (plugin: PluginEntry) => boolean,
            isCurrent: () => boolean,
            timeout?: number,
        ) => Promise<{ timedOut: boolean; plugin: PluginEntry }>>(file, 'waitForPluginRuntimeState', {
            pluginsApi: { list: () => load() },
            Date: { now: () => now },
            PLUGIN_STATE_TIMEOUT_MS: 15000,
            PLUGIN_STATE_INTERVAL_MS: 500,
            wait: async (duration: number) => {
                now += duration
            },
            abortError: () => new DOMException('aborted', 'AbortError'),
        })
        const settled      = await waitForState('synthetic', (plugin) => plugin.effective_enabled, () => current)
        expect(calls).toBe(2)
        expect(settled.timedOut).toBe(false)
        expect(settled.plugin.effective_enabled).toBe(true)
        calls = 0;
        now   = 0
        load  = async () => {
            ++calls;
            return { plugins_enabled: true, plugins_dir: '', plugins: [{ ...pluginFixture, effective_enabled: false }] }
        }
        expect((await waitForState('synthetic', (plugin) => plugin.effective_enabled, () => current, 1)).timedOut).toBe(
            true)
        load = async () => {
            throw new Error('runtime list failed')
        }
        expect(waitForState('synthetic', () => true, () => current)).rejects.toThrow('runtime list failed')
        load = async () => {
            current = false;
            return { plugins_enabled: true, plugins_dir: '', plugins: [pluginFixture] }
        }
        expect(waitForState('synthetic', () => true, () => current)).rejects.toThrow('aborted')
    },
)

for (const action of ['handleTogglePlugin', 'handleSaveConfig'] as const) {
    test(
        `${action
        } announces success only after the real runtime predicate passes and exposes post-save verification failures`,
        async () => {
            const file                 = 'pages/PluginManagementPage.tsx'
            const runtime              = Promise.withResolvers<void>()
            const notices: unknown[][] = [];
            const errors: unknown[]    = [];
            let closed                 = false
            let confirm: (
                id: string,
                predicate: (plugin: PluginEntry, response: { plugins_enabled: boolean }) => boolean,
            ) => Promise<void>         = async (_id, predicate) => {
                const updated = { ...pluginFixture, config: { limit: 2, options: { a: 1, z: 2 } } }
                expect(predicate(updated, { plugins_enabled: true })).toBe(true)
                expect(predicate({ ...updated, effective_enabled: false }, { plugins_enabled: true })).toBe(false)
                await runtime.promise
            }
            const scope                = {
                configReadState: 'ready',
                isCurrentConnection: () => true,
                pluginsApi: {
                    // noinspection JSUnusedGlobalSymbols
                    'setEnabled': async () => {
                    }, patchConfig: async () => {
                    },
                },
                confirmPluginRuntime: (
                    id: string,
                    predicate: (
                        plugin: PluginEntry,
                        response: { plugins_enabled: boolean },
                    ) => boolean,
                ) => confirm(id, predicate),
                setSavingPluginID: () => {
                },
                setSavingConfig: () => {
                },
                editingPlugin: pluginFixture,
                configDraft: { limit: 2, constructor: null, options: { z: 2, a: 1 } },
                jsonDraft: {},
                setConfigError: (value: unknown) => errors.push(value),
                showNotification: (...args: unknown[]) => notices.push(args),
                t: (key: string, value?: { message: string }) => key + (value ? `: ${value.message}` : ''),
                setEditingPlugin: () => {
                    closed = true
                },
                setConfigDraft: () => {
                },
                setJsonDraft: () => {
                },
                configValuesEqual: sourceCallback(file, 'configValuesEqual', {}),
            }
            const handler              = sourceCallback<(plugin?: PluginEntry, enabled?: boolean) => Promise<void>>(
                file,
                action,
                scope,
            )
            // noinspection ES6MissingAwait
            const pending              = action === 'handleTogglePlugin' ? handler(pluginFixture, true) : handler()
            await Promise.resolve();
            await Promise.resolve()
            expect(notices).toEqual([])
            expect(closed).toBe(false)
            runtime.resolve();
            await pending
            expect(notices[0]).toEqual(['plugin_management.save_success', 'success'])
            notices.length = 0;
            errors.length  = 0;
            closed         = false
            confirm        = async () => {
                throw new Error('runtime timeout')
            }
            await (action === 'handleTogglePlugin' ? handler(pluginFixture, true) : handler())
            expect(notices.some((notice) => notice[1] === 'success')).toBe(false)
            if (action === 'handleSaveConfig') {
                expect(errors).toContain('plugin_management.runtime_check_failed: runtime timeout')
                expect(closed).toBe(false)
            } else {
                expect(notices[0]).toEqual(['plugin_management.runtime_check_failed: runtime timeout', 'error'])
            }
        },
    )
}

test(
    (
        'plugin runtime publication consumes terminal metadata and ' +
        'invalidates older list results; object property order is ' +
        'immaterial'
    ),
    async () => {
        const file              = 'pages/PluginManagementPage.tsx'
        const configValuesEqual = sourceCallback<(left: unknown, right: unknown) => boolean>(
            file,
            'configValuesEqual',
            {},
        )
        expect(configValuesEqual({ z: { b: 2, a: 1 }, a: [1, 2] }, { a: [1, 2], z: { a: 1, b: 2 } })).toBe(true)
        expect(configValuesEqual({ a: 1 }, { a: 2 })).toBe(false)
        const sequence        = { current: 1 };
        const data: unknown[] = []
        const response        = { plugins_enabled: true, plugins_dir: '', plugins: [pluginFixture] }
        const confirm         = sourceCallback<(id: string, predicate: () => boolean) => Promise<void>>(
            file,
            'confirmPluginRuntime',
            {
                waitForPluginRuntimeState: async () => ({
                    response,
                    plugin: pluginFixture,
                    timedOut: false,
                }),
                isCurrentConnection: () => true,
                requestSequence: sequence,
                authGeneration: 7,
                t: (key: string) => key,
                setData: (value: unknown) => data.push(value),
                setStatus: () => {
                },
                setRefreshing: () => {
                },
                setError: () => {
                },
            },
        )
        await confirm('synthetic', () => true)
        expect(sequence.current).toBe(2)
        expect(data).toEqual([{ ...response, authGeneration: 7 }])
    },
)

test(
    (
        'the actual configuration validation API consumer rejects ' +
        'changed OAuth conflicts and permits legacy unchanged or final-' +
        'row deletion'
    ),
    async () => {
        const baseline = 'port: 8317\noauth-model-alias:\n  codex: [{name: upstream, alias: public}]\n'
        const post     = spyOn(apiClient, 'post').mockResolvedValue({ valid: true, errors: [], warnings: [] })
        try {
            for (const text of [
                'codex: [{name: a, alias: shared}, {name: b, alias: SHARED}]',
                'codex: [{name: same, alias: same}]',
                'codex: [{name: a, alias: b}, {name: b, alias: a}]',
                'codex: [{name: a, alias: ""}]',
            ]) {
                const candidate = `port: 8317\noauth-model-alias:\n  ${text}\n`
                const result    = await configFileApi.validateConfigYaml(candidate, baseline)
                expect(result.valid).toBe(false)
                expect(result.errors[0].field).toBe('oauth-model-alias')
                expect(post.mock.calls[post.mock.calls.length - 1]?.[1]).toBe(candidate)
            }
            expect((await configFileApi.validateConfigYaml('oauth-model-alias: {codex: []}\n', baseline)).valid).toBe(
                true)
            expect((await configFileApi.validateConfigYaml('port: 9000\n', baseline)).valid).toBe(true)
            expect((await configFileApi.validateConfigYaml('port: 9000\n', 'port: [\n')).valid).toBe(true)
            const legacy = 'port: 8317\noauth-model-alias: {codex: [{name: same, alias: same}]}\n'
            expect((await configFileApi.validateConfigYaml(legacy.replace('8317', '9000'), legacy)).valid).toBe(true)
            expect((await configFileApi.validateConfigYaml(legacy)).valid).toBe(true)
            const anchored = 'rules: &rules [{name: first, alias: public}]\noauth-model-alias: {codex: *rules}\n'
            expect((await configFileApi.validateConfigYaml(anchored, baseline)).valid).toBe(true)
        } finally {
            post.mockRestore()
        }
    },
)

test('Interactions probes preserve legacy management URLs, complete endpoints and caller prefixes', () => {
    for (const input of
        [
            'https://synthetic.invalid/cpa/v0/management',
            'https://synthetic.invalid/cpa/v0/management/',
            'https://synthetic.invalid/cpa/v1beta/models',
            'https://synthetic.invalid/cpa/v1beta/interactions/',
        ]) {
        expect(buildInteractionsEndpoint(input)).toBe('https://synthetic.invalid/cpa/v1beta/interactions')
    }
})

test('Interactions connectivity uses the normalized legacy endpoint in its actual request callback', async () => {
    const requests: Array<{ url: string; authIndex: string; data: string }> = []
    const run                                                               = sourceInitializer<() => Promise<void>>(
        'pages/AiProvidersInteractionsEditPage.tsx', 'runInteractionsConnectivityTest', {
            form: {
                baseUrl: 'https://synthetic.invalid/cpa/v0/management/', apiKey: '',
                authIndex: 'fixture-auth', headers: [], proxyUrl: '',
            },
            isTesting: false, resolvedTestModel: 'synthetic-model', availableModels: [],
            DEFAULT_INTERACTIONS_TEST_MODEL: 'synthetic-model', INTERACTIONS_TEST_TIMEOUT_MS: 30_000,
            INTERACTIONS_API_REVISION, buildInteractionsEndpoint, buildInteractionsProbePayload,
            buildHeaderObject: () => ({}), hasHeader: () => false,
            prepareApiCallAuth: () => ({ headers: {} }), t: (key: string) => key,
            getErrorMessage: String, showTestError: (message: string) => {
                throw new Error(message)
            },
            runConnectivityTest: (callback: () => Promise<unknown>) => callback(),
            apiCallApi: {
                request: async (request: { url: string; authIndex: string; data: string }) => {
                    requests.push(request)
                    return { status: 200 }
                },
            },
        },
    )
    await run()
    expect(requests).toHaveLength(1)
    expect(requests[0].url).toBe('https://synthetic.invalid/cpa/v1beta/interactions')
    expect(requests[0].authIndex).toBe('fixture-auth')
    expect(JSON.parse(requests[0].data)).toEqual({ model: 'synthetic-model', input: 'Hi' })
})

test(
    'date consumers truncate submillisecond precision before handing timestamps to a precision-limited browser engine',
    () => {
        class PrecisionLimitedDate extends Date {
            constructor(value: string | number) {
                if (typeof value === 'string' && /\.\d{4}/.test(value)) {
                    throw new Error('unsupported fractional precision')
                }
                super(value)
            }
        }

        const input         = '2026-11-05T12:30:45.123456789+08:00'
        const parseDateLike = sourceCallback<(value: string | number) => Date | null>(
            'components/credentials/VendorSection.tsx',
            'parseDateLike',
            { Date: PrecisionLimitedDate },
        )
        expect(parseDateLike(input)?.toISOString()).toBe('2026-11-05T04:30:45.123Z')
        const scope          = {
            Date: PrecisionLimitedDate,
            // noinspection JSUnusedGlobalSymbols
            'getEffectiveTimezone': () => 'UTC',
            // noinspection JSUnusedGlobalSymbols
            'resolveDefaultLocale': () => 'en-US',
        }
        const formatDateTime = sourceCallback<(value: string, locale: string) => string>(
            'utils/format.ts',
            'formatDateTime',
            scope,
        )
        expect(formatDateTime(input, 'en-US')).toContain('04:30:45')
        const formatUnixTimestamp = sourceCallback<(value: string, locale: string) => string>(
            'utils/format.ts',
            'formatUnixTimestamp',
            scope,
        )
        expect(formatUnixTimestamp(input, 'en-US')).toContain('04:30:45')
        const parseIsoToMs = sourceCallback<(value: unknown) => number | null>(
            'utils/quota/resetInstants.ts', 'parseIsoToMs', { Date: PrecisionLimitedDate },
        )
        for (const [value, expected] of [
            [input, '2026-11-05T04:30:45.123Z'],
            ['2026-11-05T04:30:45.123456Z', '2026-11-05T04:30:45.123Z'],
            ['2026-11-05T04:30:45.999999999Z', '2026-11-05T04:30:45.999Z'],
            ['2026-11-05T04:30:45.12Z', '2026-11-05T04:30:45.120Z'],
            ['2026-11-05T04:30:45Z', '2026-11-05T04:30:45.000Z'],
        ]) {
            expect(parseIsoToMs(value)).toBe(Date.parse(expected))
        }
        for (const value of ['', 'invalid', null, undefined, 123]) {
            expect(parseIsoToMs(value)).toBeNull()
        }
        const formatReset = sourceCallback<(value: string) => string>(
            'utils/quota/formatters.ts', 'formatQuotaResetTime',
            {
                parseIsoToMs,
                // noinspection JSUnusedGlobalSymbols
                'formatInstantShort': (value: number) => new Date(value).toISOString(),
            },
        )
        expect(formatReset(input)).toBe('2026-11-05T04:30:45.123Z')
    },
)

test('a stale confirmation cannot write a newly prepared configuration that failed validation', async () => {
    let cleared   = false
    const confirm = sourceExpression<() => Promise<void>>(
        'pages/ConfigPage.tsx',
        (node, tree) => ts.isArrowFunction(node) &&
                        node.getText(tree).includes('const prepared = preparedSaveRef.current') &&
                        node.getText(tree).includes('saveConfigYaml(prepared.content'),
        {
            isCurrentConnection: () => true,
            disableControls: false,
            saveNeedsReload: false,
            preparedSaveRef: { current: { validationPassed: false } },
            clearPreparedSave: () => {
                cleared = true
            },
            revisionStateRef: {
                current: {
                    beginSave: () => {
                        throw new Error('invalid save must not start')
                    },
                },
            },
            configFileApi: {
                saveConfigYaml: () => {
                    throw new Error('invalid save must not write')
                },
            },
        },
    )
    await confirm()
    expect(cleared).toBe(true)
})
