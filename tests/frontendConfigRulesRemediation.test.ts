import {getVisualConfigValidationErrors} from '@/hooks/useVisualConfig'
import {ConfigEditorRevisionState} from '@/pages/configEditorRevision'
import {DEFAULT_VISUAL_VALUES} from '@/types/visualConfig'
import {hasExcludedModelRule, isModelExcludedByWildcardRule, toggleExcludedModelRule} from '@/utils/excludedModels'
import {expect, test} from 'bun:test'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {sourceCallback, sourceInitializer} from './sourceCallbacks'

const noop = () => {
}
const t    = (key: string) => key

test('local config discard restores the accepted source and visual baseline without a network call', () => {
    const revision = new ConfigEditorRevisionState(() => 1)
    revision.acceptServerRevision();
    revision.resetSource('port: 8317\n');
    revision.markDraftChanged();
    revision.editSource('port: 9999\n')
    const pending                                         = revision.beginSave()
    const updates: Array<[string, unknown]>               = []
    const confirmations: Array<{ onConfirm: () => void }> = []
    const preparedSaveRef                                 = { current: { synthetic: true } as unknown }
    const isDirtyRef                                      = { current: true }
    const discard                                         = sourceCallback<() => void>(
        'pages/ConfigPage.tsx',
        'handleDiscard',
        {
            isCurrentConnection: () => true,
            loading: false,
            saving: false,
            saveNeedsReload: false,
            isDirty: true,
            revisionStateRef: { current: revision },
            preparedSaveRef,
            isDirtyRef,
            t,
            showConfirmation: (action: {
                onConfirm: () => void
            }) => confirmations.push(action),
            setDiffModalOpen: (value: boolean) => updates.push(['diff', value]),
            setDiffOriginalYaml: (value: string) => updates.push(['original', value]),
            setContent: (value: string) => updates.push(['source', value]),
            setDirty: (value: boolean) => updates.push(['dirty', value]),
            setMergedYaml: (value: string) => updates.push(['merged', value]),
            setError: noop,
            setValidationWarnings: noop,
            setValidationErrors: noop,
            loadVisualValuesFromYaml: (
                value: string,
                baseline: string,
            ) => updates.push([
                                  'visual',
                                  [
                                      value,
                                      baseline,
                                  ],
                              ]),
        },
    )
    discard()
    expect(updates).toEqual([])
    expect(isDirtyRef.current).toBe(true)
    confirmations[0].onConfirm()
    expect(updates).toContainEqual(['source', 'port: 8317\n'])
    expect(updates).toContainEqual(['visual', ['port: 8317\n', 'port: 8317\n']])
    expect(preparedSaveRef.current).toBeNull()
    expect(isDirtyRef.current).toBe(false)
    expect(revision.isCurrentGeneration(pending)).toBe(false)
    expect(revision.materializeSource((value) => value)).toBe('port: 8317\n')
})

test('discard retains the original server baseline revision and rejects changed confirmations', () => {
    const revision = new ConfigEditorRevisionState(() => 1)
    revision.acceptServerRevision();
    revision.resetSource('old accepted');
    revision.markDraftChanged();
    revision.observeServerRevision()
    const before = revision.snapshot()
    expect(revision.discardSource()).toBe('old accepted')
    expect(revision.snapshot()).toMatchObject({
                                                  serverRevision: before.serverRevision,
                                                  draftBaseRevision: before.draftBaseRevision,
                                              })
    const confirmations: Array<{ onConfirm: () => void }> = []
    sourceCallback<() => void>('pages/ConfigPage.tsx', 'handleDiscard', {
        isCurrentConnection: () => true,
        loading: false,
        saving: false,
        saveNeedsReload: false,
        isDirty: true,
        revisionStateRef: { current: revision },
        t,
        showConfirmation: (action: { onConfirm: () => void }) => confirmations.push(action),
    })()
    revision.markDraftChanged()
    expect(confirmations[0].onConfirm).toThrow('config_management.confirmation_changed')
})

test('unknown save outcomes keep the established confirmed network reload path', () => {
    let confirmations = 0
    sourceCallback<() => void>('pages/ConfigPage.tsx', 'handleDiscard', {
        isCurrentConnection: () => true,
        loading: false,
        saving: false,
        saveNeedsReload: true,
        isDirty: true,
        showConfirmation: () => {
            ++confirmations
        },
    })()
    expect(confirmations).toBe(0)
    const actions: Array<{ onConfirm: () => void }> = [];
    const loads: boolean[]                          = []
    sourceCallback<() => void>('pages/ConfigPage.tsx', 'handleReload', {
        isCurrentConnection: () => true,
        isDirty: true,
        t,
        showConfirmation: (action: { onConfirm: () => void }) => actions.push(action),
        loadConfig: (discard: boolean) => {
            loads.push(discard)
        },
        loadRuntimeInfo: noop,
    })()
    expect(loads).toEqual([])
    actions[0].onConfirm()
    expect(loads).toEqual([true])
})

test('OAuth alias validation checks the whole channel graph before unrelated relay validation', () => {
    const cases = [
        ['codex: [{name: source, alias: ""}]', 'oauth_alias_empty'],
        ['codex: [{name: source, alias: SOURCE}]', 'oauth_alias_self'],
        ['codex: [{name: a, alias: same}, {name: b, alias: SAME}]', 'oauth_alias_conflict'],
        ['codex: [{name: a, alias: b}, {name: b, alias: c}, {name: c, alias: a}]', 'oauth_alias_cycle'],
        ['codex: [{name: a, alias: b, fork: "true"}]', 'oauth_alias_invalid'],
        ['Codex: []\ncodex: []', 'oauth_alias_invalid'],
        ['[invalid]', 'oauth_alias_invalid'],
    ] as const
    for (const [text, error] of cases) {
        expect(getVisualConfigValidationErrors({
                                                   ...DEFAULT_VISUAL_VALUES,
                                                   oauthModelAliasText: text,
                                               }).oauthModelAliasText).toBe(error)
    }
    expect(getVisualConfigValidationErrors({
                                               ...DEFAULT_VISUAL_VALUES,
                                               oauthModelAliasText: (
                                                   'codex: [{name: upstream, alias: friendly, fork: false, future: {' +
                                                   'keep: true}}]\nclaude: [{name: other, alias: friendly}]'
                                               ),
                                           }).oauthModelAliasText).toBeUndefined()
    const legacy = { ...DEFAULT_VISUAL_VALUES, oauthModelAliasText: 'codex: [{name: same, alias: same}]' }
    expect(getVisualConfigValidationErrors({ ...legacy, port: '9000' }, legacy).oauthModelAliasText).toBeUndefined()
})

test('OAuth exclusion YAML validates shape and empty rules while keeping wildcard spelling intact', () => {
    for (const text of ['[invalid]', 'codex: text', 'codex: ["", valid]', 'codex: [42]']) {
        expect(getVisualConfigValidationErrors({
                                                   ...DEFAULT_VISUAL_VALUES,
                                                   oauthExcludedModelsText: text,
                                               }).oauthExcludedModelsText).toBe('oauth_exclusions_invalid')
    }
    expect(getVisualConfigValidationErrors({
                                               ...DEFAULT_VISUAL_VALUES,
                                               oauthExcludedModelsText: 'codex: [Claude-*, Unknown-Model]\nclaude: []',
                                           }).oauthExcludedModelsText).toBeUndefined()
})

test('shared YAML fields associate visible validation errors with their actual textarea', () => {
    const FieldShell = sourceCallback<React.ComponentType<{ children: React.ReactNode }>>(
        'components/config/VisualConfigEditor.tsx',
        'FieldShell',
        { React, styles: {} },
    )
    const TextArea   = sourceCallback<React.ComponentType<{
        label: string;
        value: string;
        error: string;
        hint: string;
        onChange: () => void
    }>>('components/config/VisualConfigEditor.tsx', 'TextAreaField', {
        React, FieldShell, styles: {}, useId: () => 'synthetic-field',
    })
    const html       = renderToStaticMarkup(React.createElement(
        TextArea,
        {
            label: 'Aliases',
            value: '{}',
            error: 'Alias conflict',
            hint: 'Source model',
            onChange: noop,
        },
    ))
    expect(html).toContain('aria-invalid="true"')
    expect(html).toContain('synthetic-field-error')
    expect(html).toContain('aria-describedby="synthetic-field-hint synthetic-field-error"')
    expect(html).toContain('Alias conflict')
})

test('bulk exclusion changes only matching exact rules and preserves wildcard locks and hidden rules', () => {
    const rules               = ['Visible', 'Hidden', 'Claude-*', 'Unknown-Rule']
    const results: string[][] = []
    const apply               = sourceInitializer<(excluded: boolean) => void>(
        'features/authFiles/components/AuthFileExcludedModelsField.tsx',
        'applyVisible',
        {
            rules,
            visibleModels: [{ id: 'Visible' }, { id: 'Claude-Model' }],
            hasExcludedModelRule,
            isModelExcludedByWildcardRule,
            // noinspection JSUnusedGlobalSymbols
            'toggleExcludedModelRule': toggleExcludedModelRule,
            commit: (value: string[]) => results.push(value),
        },
    )
    apply(false)
    expect(results[0]).toEqual(['Hidden', 'Claude-*', 'Unknown-Rule'])
    apply(true)
    expect(results[1]).toEqual(rules)
    const merged = sourceInitializer<(models: Array<{ id: string }>, rules: string[]) => Array<{ id: string }>>(
        'features/authFiles/components/AuthFileExcludedModelsField.tsx',
        'mergeConfiguredModels',
        {},
    )
    expect(merged([{ id: 'Model-A' }, { id: 'model-a' }], []).map((model) => model.id)).toEqual(['Model-A', 'model-a'])
})

test('exclusion retry invalidates only the selected credential catalog and triggers a new load', () => {
    const invalidated: string[][] = [];
    let retry                     = 0
    const reload                  = sourceInitializer<() => void>(
        'features/authFiles/components/AuthFileExcludedModelsField.tsx',
        'reload',
        {
            fileName: 'synthetic.json',
            // noinspection JSUnusedGlobalSymbols
            'invalidateAuthFileModelsCache': (names: string[]) => invalidated.push(names),
            // noinspection JSUnusedGlobalSymbols
            'setRetry': (update: (value: number) => number) => {
                retry = update(retry)
            },
        },
    )
    reload()
    expect(invalidated).toEqual([['synthetic.json']])
    expect(retry).toBe(1)
})

test('discard confirmations reject load or save operations started after the dialog opened', () => {
    for (const operation of ['beginLoad', 'beginSave'] as const) {
        const revision = new ConfigEditorRevisionState(() => 1)
        revision.acceptServerRevision();
        revision.resetSource('accepted')
        const actions: Array<{ onConfirm: () => void }> = []
        sourceCallback<() => void>('pages/ConfigPage.tsx', 'handleDiscard', {
            isCurrentConnection: () => true,
            loading: false,
            saving: false,
            saveNeedsReload: false,
            isDirty: true,
            revisionStateRef: { current: revision },
            t,
            showConfirmation: (action: { onConfirm: () => void }) => actions.push(action),
        })()
        const request = revision[operation]()
        expect(actions[0].onConfirm).toThrow('config_management.confirmation_changed')
        expect(revision.isCurrentRequest(request)).toBe(true)
    }
})
