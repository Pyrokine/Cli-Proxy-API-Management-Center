import {Button} from '@/components/ui/Button'
import {
    parsePriceRules,
    priceBoundary,
    priceRulesSignature,
    priceRulesToInputs,
    withPriceRules,
} from '@/pages/modelPriceRules'
import {apiClient} from '@/services/api/client'
import {
    type ModelCatalogDefaultUpdateChange,
    type ModelCatalogDefaultUpdatePreview,
    type ModelCatalogPatchRequest,
    modelsApi,
} from '@/services/api/models'
import {REQUEST_SPEEDS} from '@/services/api/usage'
import type {AxiosInstance} from 'axios'
import {expect, spyOn, test} from 'bun:test'
import React, {type ReactElement} from 'react'
import ts from 'typescript'
import {sourceCallback, sourceExpression, sourceInitializer} from './sourceCallbacks'

const file                           = 'pages/ModelManagementPage.tsx'
const noop                           = () => undefined
const t                              = (key: string) => key
const scope: Record<string, unknown> = {
    React, Button, t, REQUEST_SPEEDS, parsePriceRules, priceBoundary, priceRulesSignature, priceRulesToInputs,
    withPriceRules, SPEED_RATE_BUCKETS: sourceInitializer(file, 'SPEED_RATE_BUCKETS', {}),
    styles: { recoveryWarning: 'catalog-warning', inlineHint: 'inline-hint' },
}
for (const name of [
    'modelKey', 'uniqueSorted', 'priceInput', 'priceToInputs', 'parseOptionalPrice', 'speedRatesToInputs',
    'speedRatesSignature', 'parseSpeedRates', 'parseAliases',
]) {
    scope[name] = sourceCallback(file, name, scope)
}

const row = {
    model: 'fixture-model', displayName: 'Original', provider: 'Fixture', channel: 'codex',
    catalogGroup: 'Fixture group', enabled: true, aliases: ['claude-alias', 'codex-alias'],
    price: { prompt: 2, status: 'partial' },
}

function editDraft(patch: object) {
    let draft = {}
    sourceCallback<(value: typeof row) => void>(file, 'openEditModal', {
        ...scope, setEditDraft: (value: object) => {
            draft = value
        },
    })(row)
    return { ...draft, ...patch }
}

async function save(patch: object) {
    const requests: ModelCatalogPatchRequest[] = []
    const notices: string[]                    = []
    await sourceCallback<() => Promise<void>>(file, 'saveEdit', {
        ...scope, editDraft: editDraft(patch), setSavingModel: noop, applyCatalogResponse: noop, setEditDraft: noop,
        showNotification: (message: string) => notices.push(message), observePriceRecalculation: noop,
        modelsApi: {
            patchModelCatalogModel: async (payload: ModelCatalogPatchRequest) => {
                requests.push(payload)
                return { models: [{ name: row.model, price: payload.price ?? row.price }] }
            },
        },
    })()
    return { requests, notices }
}

test('MAF-01/02: display-only and explicit disable submit exactly the edited fields', async () => {
    expect((await save({ displayName: '  Renamed  ' })).requests).toEqual([
                                                                              {
                                                                                  name: row.model,
                                                                                  display_name: 'Renamed',
                                                                              },
                                                                          ])
    expect((await save({ enabled: false })).requests).toEqual([{ name: row.model, enabled: false }])
    expect((await save({})).requests).toEqual([])
})

test('MAF-01: actual price changes keep legacy reference prices excluded from automatic billing', async () => {
    const { requests, notices } = await save({ prompt: '3' })
    expect(requests[0].price).toMatchObject({ prompt: 3, status: 'partial', auto_apply: false })
    expect(requests[0].price).not.toHaveProperty('completion')
    expect(notices).toEqual(['model_management.save_success'])
    const rules = priceRulesToInputs({ prompt: 2, request_scoped: false })
    expect(rules.requestScoped).toBe('false')
    expect(priceRulesSignature({ prompt: 2, request_scoped: false })).not.toBe(priceRulesSignature({ prompt: 2 }))
})

test('MAF-05: a missing alias channel blocks creation, and alias readback is required', async () => {
    const requests: ModelCatalogPatchRequest[] = []
    const notices: string[]                    = []
    let closed                                 = false
    let persisted                              = false
    const draft                                = {
        ...(scope.priceToInputs as (value: null) => object)(null),
        model: 'fixture-new', channel: ' ', provider: '', displayName: '', group: '', aliasesText: 'new-alias',
        priceRules: priceRulesToInputs(null, true), speedRates: [],
    }
    const add                                  = sourceCallback<() => Promise<void>>(file, 'handleAddModel', {
        ...scope, addDraft: draft, allModelNames: [], setSavingModel: noop, applyCatalogResponse: noop,
        setAddDraft: () => {
            closed = true
        }, showNotification: (message: string) => notices.push(message),
        observePriceRecalculation: noop,
        modelsApi: {
            patchModelCatalogModel: async (payload: ModelCatalogPatchRequest) => {
                requests.push(payload)
                return { models: [{ name: payload.name, aliases: persisted ? payload.aliases : [] }] }
            },
        },
    })
    await add()
    expect(requests).toEqual([])
    expect(closed).toBe(false)
    expect(notices[0]).toContain('alias_channel_required')
    draft.channel = ' CODEX '
    await add()
    expect(requests[0]).toMatchObject({
                                          channel: 'codex',
                                          alias_channel: 'codex',
                                          aliases: ['new-alias'],
                                          enabled: false,
                                      })
    expect(notices[1]).toContain('aliases_not_saved')
    expect(closed).toBe(false)
    persisted = true
    await add()
    expect(closed).toBe(true)
})

test('MAF-06: a failed refresh preserves catalogue rows and provides a separate retry alert', async () => {
    const catalog                                           = { models: [row], meta: { load_source: 'current' } }
    let loaded                                              = catalog
    const state: { error: string | null; loading: boolean } = { error: null, loading: false }
    let fail                                                = true
    const refresh                                           = sourceCallback<() => Promise<void>>(file, 'loadAll', {
        ...scope,
        setLoading: (value: boolean) => {
            state.loading = value
        },
        setError: (value: string | null) => {
            state.error = value
        },
        applyCatalogResponse: (value: typeof catalog) => {
            loaded = value
        },
        modelsApi: {
            fetchModelCatalog: async () => {
                if (fail) {
                    throw new Error('fixture read failed')
                }
                return { ...catalog, models: [] }
            },
        },
    })
    await refresh()
    expect(loaded.models).toEqual([row])
    expect(state.error).toBe('fixture read failed')
    const alert = sourceExpression<ReactElement<{ role: string; children: ReactElement[] }>>(file, (node, tree) =>
        ts.isJsxElement(node) && node.openingElement.tagName.getText(tree) === 'div' &&
        node.getText(tree).startsWith('<div className={styles.recoveryWarning} role=\'alert\'>'), {
                                                                                                 ...scope, ...state,
                                                                                                 loadAll: refresh,
                                                                                             })
    expect(alert.props.role).toBe('alert')
    expect(alert.props.children.find((child) => child.type === Button)).toBeDefined()
    fail = false
    await refresh()
    expect(state.error).toBeNull()
    expect(loaded.models).toEqual([])
})

const change: ModelCatalogDefaultUpdateChange                          = {
    id: 'changed:a',
    name: 'a',
    type: 'changed_default',
}
const next: ModelCatalogDefaultUpdateChange                            = { id: 'new:b', name: 'b', type: 'new_default' }
const revision                                                         = '"fixture-revision"'
const preview: ModelCatalogDefaultUpdatePreview & { revision: string } = {
    revision, changes: [change, next], current_defaults_version: 'old', latest_defaults_version: 'new',
}

test('MAF-07: a failed preview discards old actions and a missing revision blocks an unconditional apply', async () => {
    let loaded: ModelCatalogDefaultUpdatePreview | null = preview
    let changes                                         = preview.changes
    const state: { failure: string | null }             = { failure: null }
    let response: object | null                         = null
    const reload                                        = sourceCallback<() => Promise<void>>(
        file,
        'loadDefaultUpdatePreview',
        {
            ...scope,
            setUpdateLoading: noop,
            setUpdatePage: noop,
            setUpdatePreview: (value: typeof loaded) => {
                loaded  = value;
                changes =
                    value?.changes ??
                    []
            },
            setUpdateError: (value: string | null) => {
                state.failure =
                    value
            },
            modelsApi: {
                fetchDefaultUpdatePreview: async () => {
                    if (response ===
                        null) {
                        throw new Error('fixture preview failed')
                    }
                    return response
                },
            },
        },
    )
    await reload()
    expect(loaded).toBeNull()
    expect(changes).toEqual([])
    expect(state.failure).toContain('fixture preview failed')
    response = { ...preview, revision: undefined }
    await reload()
    expect(loaded).toBeNull()
    expect(state.failure).toContain('default_update_revision_missing')
    response = preview
    await reload()
    expect(loaded).toEqual(preview)
    expect(state.failure).toBeNull()
})

test('MAF-07/08: keep current advances the review; a conflict invalidates the preview', async () => {
    const calls: unknown[][]                            = []
    const notices: string[]                             = []
    let skipped                                         = new Set<string>()
    let active: ModelCatalogDefaultUpdatePreview | null = preview
    const state: { failure: string | null }             = { failure: null }
    let page                                            = 0
    let conflict                                        = false
    const apply                                         = () => sourceCallback<(
        item: ModelCatalogDefaultUpdateChange,
        action: string,
    ) => Promise<void>>(
        file, 'applyDefaultUpdate', {
            ...scope, updatePreview: active, updateChanges: preview.changes.filter((item) => !skipped.has(item.id)),
            updateApplying: false, setUpdateApplying: noop, applyCatalogResponse: noop, loadDefaultUpdatePreview: noop,
            setSkippedUpdateIds: (update: (previous: Set<string>) => Set<string>) => {
                skipped = update(skipped)
            },
            setUpdatePage: (update: (previous: number) => number) => {
                page = update(page)
            },
            setUpdatePreview: (value: typeof active) => {
                active = value
            },
            setUpdateError: (value: string | null) => {
                state.failure = value
            },
            showNotification: (message: string) => notices.push(message), observePriceRecalculation: noop,
            modelsApi: {
                applyDefaultUpdate: async (...args: unknown[]) => {
                    calls.push(args)
                    if (conflict) {
                        throw Object.assign(new Error('fixture conflict'), { status: 412 })
                    }
                    return { result: { applied: 0 }, catalog: { models: [] } }
                },
            },
        },
    )
    await apply()(change, 'keep_current')
    expect(calls[0]).toEqual([[{ name: 'a', action: 'keep_current' }], revision])
    expect(notices).toContain('model_management.default_update_skipped')
    expect(preview.changes.filter((item) => !skipped.has(item.id))[page]).toEqual(next)
    conflict = true
    await apply()(next, 'adopt')
    expect(active).toBeNull()
    expect(state.failure).toBe('model_management.default_update_conflict')
    await apply()(next, 'adopt')
    expect(calls).toHaveLength(2)

    const post = spyOn(apiClient, 'post').mockResolvedValue({})
    try {
        await (modelsApi.applyDefaultUpdate as (...args: unknown[]) => Promise<unknown>)([], revision)
        expect(post.mock.calls[0][2]).toMatchObject({ headers: { 'If-Match': revision } })
        await modelsApi.applyDefaultUpdate([])
        expect(post.mock.calls[1][2]).not.toHaveProperty('headers')
    } finally {
        post.mockRestore()
    }
})

test('MAF-08: the live client accepts a successful skip without inventing a mutation effect', async () => {
    const instance            = (apiClient as unknown as { instance: AxiosInstance }).instance
    const originalAdapter     = instance.defaults.adapter
    const calls: string[]     = []
    let receipt: object | undefined
    instance.defaults.adapter = async (config) => {
        calls.push(`${config.method} ${config.url}`)
        const respond = (data: unknown, headers = {}) => ({ config, data, headers, status: 200, statusText: 'OK' })
        if (config.method === 'post') {
            expect(config.headers.get('If-Match')).toBe(revision)
            receipt = {
                mutation_id: config.headers.get('X-CPA-Mutation-ID'), request_id: 'fixture-request',
                outcome: 'uncertain', confirmed_effect: false, effects: [], audit_available: true,
            }
            return respond({ result: { status: 'ok', applied: 0 }, catalog: { models: [] } }, {
                'X-CPA-Mutation-Result': JSON.stringify(receipt),
            })
        }
        return respond(config.url?.startsWith('/mutations/') ? receipt : { models: [] })
    }
    try {
        const skipped = await modelsApi.applyDefaultUpdate([{ name: 'a', action: 'keep_current' }], revision)
        expect(skipped.result).toEqual({ status: 'ok', applied: 0 })
        expect(calls).toEqual([
                                  'post /model-catalog/default-update/apply',
                                  expect.stringMatching(/^get \/mutations\//),
                                  'get /model-catalog',
                              ])
        await expect(modelsApi.applyDefaultUpdate([{ name: 'a', action: 'use_default' }], revision)).rejects.toThrow()
    } finally {
        instance.defaults.adapter = originalAdapter
    }
})

test('MAF-10: nested filtered counts describe only the models shown', () => {
    const leaf     = (label: string) => ({ label, provider: 'Fixture', leafCount: 1, kind: 'model' })
    const group    = { label: 'Group', provider: 'Fixture', leafCount: 2, children: [leaf('matched'), leaf('other')] }
    const tree     = [{ label: 'Fixture', provider: 'Fixture', leafCount: 2, children: [group] }]
    const filter   = sourceCallback<(rows: typeof tree, query: string) => typeof tree>(file, 'filterTreeTableRows', {})
    const filtered = filter(tree, 'matched')
    expect(filtered[0].leafCount).toBe(1)
    expect(filtered[0].children[0].leafCount).toBe(1)
    expect(filtered[0].children[0].children.map(({ label }) => label)).toEqual(['matched'])
    expect(filter(tree, 'Fixture')).toEqual(tree)
    expect(filter(tree, '')[0].leafCount).toBe(2)
})
