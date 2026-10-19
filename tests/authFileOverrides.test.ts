import {describe, expect, mock, spyOn, test} from 'bun:test'
import {readFileSync} from 'node:fs'
import * as React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import type {PrefixProxyEditorState} from '@/features/authFiles/hooks/useAuthFilesPrefixProxyEditor'
import type {AuthFileItem} from '@/types/authFile'
import type {Modal} from '@/components/ui/Modal'
import {MemoryRouter} from 'react-router-dom'
import {
    readAuthFileDisableCooling,
    readAuthFileRequestRetry,
    supportsAuthFileWebsockets,
} from '@/features/authFiles/constants'
import {buildSafeAuthFileDisplayInfo} from '@/features/authFiles/identity'
import {applyAuthFileMutation} from '@/components/credentials/credentialsDataLifecycle'

const storage = {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
    clear: () => undefined,
    key: () => null,
    length: 0,
} satisfies Storage
Object.defineProperty(globalThis, 'localStorage', {value: storage, configurable: true})
Object.defineProperty(globalThis, 'sessionStorage', {value: storage, configurable: true})

const {buildAuthFileFieldsPatch, useAuthFilesPrefixProxyEditor} = await import('@/features/authFiles/hooks/useAuthFilesPrefixProxyEditor')
const {AuthFilesPrefixProxyEditorModal} = await import('@/features/authFiles/components/AuthFilesPrefixProxyEditorModal')
const {authFilesApi, normalizeAuthFilesResponse} = await import('@/services/api/authFiles')
const {apiClient} = await import('@/services/api/client')

const editor = (
    json: Record<string, unknown> = {},
    overrides: Partial<PrefixProxyEditorState> = {},
): PrefixProxyEditorState => ({
    fileName: 'synthetic.json', fileInfoText: '', loading: false, saving: false, readOnly: false,
    error: null, json, prefix: '', proxyUrl: '', priority: '', weight: '', weightError: null,
    note: '', noteTouched: false, headersText: '', headersTouched: false, headersError: null,
    supportsModelAliases: true, modelAliasesText: '', modelAliasesTouched: false, modelAliasesError: null,
    requestRulesText: '', requestRulesTouched: false, requestRulesError: null,
    disableCooling: readAuthFileDisableCooling(json), disableCoolingTouched: false,
    requestRetry: readAuthFileRequestRetry(json), requestRetryTouched: false,
    supportsWebsockets: false, websockets: false, websocketsTouched: false,
    supportsUsingApi: false, usingApi: false, usingApiTouched: false,
    excludedModelsText: '', excludedModelsTouched: false,
    ...overrides,
})
const patch = (state: PrefixProxyEditorState) => buildAuthFileFieldsPatch(state, (key) => key)
const normalize = (entry: Record<string, unknown>) =>
    normalizeAuthFilesResponse({files: [{name: 'synthetic.json', ...entry}]}).files[0]
const mutate = (file: AuthFileItem, fields: Parameters<typeof authFilesApi.patchFields>[1]) =>
    applyAuthFileMutation([file], {kind: 'fields', name: file.name, fields})[0]

describe('auth-file credential overrides', () => {
    test('untouched inherited settings never become explicit overrides', () => {
        expect(patch(editor())).toEqual({})
        expect(patch(editor({}, {disableCooling: false, requestRetry: 0}))).toEqual({})
        expect(patch(editor({disable_cooling: true, request_retry: 4}))).toEqual({})
    })

    test('distinguishes inherit from explicit cooling enable and retry zero', () => {
        expect(patch(editor({}, {
            disableCooling: false, disableCoolingTouched: true,
            requestRetry: 0, requestRetryTouched: true,
        }))).toEqual({disable_cooling: false, request_retry: 0})
        expect(patch(editor({disable_cooling: false, request_retry: 0}, {
            disableCooling: undefined, disableCoolingTouched: true,
            requestRetry: undefined, requestRetryTouched: true,
        }))).toEqual({disable_cooling: null, request_retry: null})
    })

    test('keeps override changes independent and does not materialize using_api', () => {
        expect(patch(editor({}, {disableCooling: true, disableCoolingTouched: true})))
            .toEqual({disable_cooling: true})
        expect(patch(editor({}, {requestRetry: 4, requestRetryTouched: true})))
            .toEqual({request_retry: 4})
        expect(patch(editor({disable_cooling: false, request_retry: 0}, {
            disableCoolingTouched: true, requestRetryTouched: true,
        }))).toEqual({})
    })

    test('negative safe integers restore inheritance and readonly editors never patch', () => {
        for (const requestRetry of [-1, Number.MIN_SAFE_INTEGER]) {
            expect(patch(editor({'request-retry': 3}, {requestRetry, requestRetryTouched: true})))
                .toEqual({request_retry: null})
        }
        expect(patch(editor({}, {
            readOnly: true, disableCooling: true, disableCoolingTouched: true,
            requestRetry: NaN, requestRetryTouched: true,
        }))).toEqual({})
    })

    test('validates retry input without silently dropping malformed edits', () => {
        for (const requestRetry of [NaN, Infinity, -Infinity, 1.5, -1.5,
            Number.MAX_SAFE_INTEGER + 1, Number.MIN_SAFE_INTEGER - 1]) {
            expect(() => patch(editor({}, {requestRetry, requestRetryTouched: true})))
                .toThrow('auth_files.request_retry_invalid')
        }
        expect(patch(editor({}, {requestRetry: Number.MAX_SAFE_INTEGER, requestRetryTouched: true})))
            .toEqual({request_retry: Number.MAX_SAFE_INTEGER})
    })

    test('canonical presence wins over every legacy alias including null and negative retry', () => {
        for (const value of [null, undefined]) {
            const file = normalize({
                disable_cooling: value, 'disable-cooling': true, disableCooling: true,
                request_retry: value, 'request-retry': 7, requestRetry: 8,
            })
            expect(file.disableCooling).toBeUndefined()
            expect(file.requestRetry).toBeUndefined()
            expect(readAuthFileDisableCooling(file)).toBeUndefined()
            expect(readAuthFileRequestRetry(file)).toBeUndefined()
        }
        expect(normalize({request_retry: -1, 'request-retry': 5}).requestRetry).toBeUndefined()
        expect(normalize({disable_cooling: false, 'disable-cooling': true}).disableCooling).toBe(false)
        expect(normalize({request_retry: 0, 'request-retry': 5}).requestRetry).toBe(0)
        expect(normalize({'disable-cooling': null, disableCooling: true}).disableCooling).toBeUndefined()
        expect(normalize({'request-retry': -1, requestRetry: 5}).requestRetry).toBeUndefined()
    })

    test('reads supported legacy aliases without changing global number or boolean semantics', () => {
        expect(normalize({'disable-cooling': 'false', 'request-retry': '3'}))
            .toMatchObject({disableCooling: false, requestRetry: 3})
        expect(normalize({disableCooling: true, requestRetry: 0}))
            .toMatchObject({disableCooling: true, requestRetry: 0})
        for (const value of [NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1, '1.5', 'NaN']) {
            expect(normalize({request_retry: value, 'request-retry': 3}).requestRetry).toBeUndefined()
        }
    })

    test('duplicate runtime rows cannot restore a cleared or inherited disk override', () => {
        for (const diskFields of [{}, {disable_cooling: null, request_retry: null}, {request_retry: -1}]) {
            const disk = {name: 'synthetic.json', source: 'file', ...diskFields}
            const runtime = {
                name: 'synthetic.json', source: 'memory',
                'disable-cooling': true, 'request-retry': 6,
            }
            for (const files of [[disk, runtime], [runtime, disk]]) {
                const [file] = normalizeAuthFilesResponse({files}).files
                expect(readAuthFileDisableCooling(file)).toBeUndefined()
                expect(readAuthFileRequestRetry(file)).toBeUndefined()
            }
        }
    })

    test('sends sparse API patches, explicit clears, and negative retry clears without real requests', async () => {
        const request = spyOn(apiClient, 'patch').mockResolvedValue({status: 'ok'})
        try {
            await authFilesApi.patchFields('synthetic.json', {disable_cooling: false, request_retry: 0})
            expect(request).toHaveBeenLastCalledWith('/auth-files/fields', {
                name: 'synthetic.json', disable_cooling: false, request_retry: 0,
            })
            await authFilesApi.patchFields('synthetic.json', {disable_cooling: null, request_retry: -1})
            expect(request).toHaveBeenLastCalledWith('/auth-files/fields', {
                name: 'synthetic.json', disable_cooling: null, request_retry: null,
            })
            await authFilesApi.patchFields('synthetic.json', {note: 'synthetic'})
            expect(request).toHaveBeenLastCalledWith('/auth-files/fields', {
                name: 'synthetic.json', note: 'synthetic',
            })
            for (const request_retry of [NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
                expect(() => authFilesApi.patchFields('synthetic.json', {request_retry}))
                    .toThrow('auth_files.request_retry_invalid')
            }
            expect(request).toHaveBeenCalledTimes(3)
        } finally {
            request.mockRestore()
        }
    })

    test('sends exact runtime identity for status and field mutations', async () => {
        const request = spyOn(apiClient, 'patch').mockResolvedValue({status: 'ok', disabled: true})
        try {
            await authFilesApi.setStatus('devin-shared.json', true, ' devin-a ')
            expect(request).toHaveBeenLastCalledWith('/auth-files/status', {
                name: 'devin-shared.json', disabled: true, auth_index: 'devin-a',
            })

            await authFilesApi.patchFields('devin-shared.json', {priority: 7}, ' devin-b ')
            expect(request).toHaveBeenLastCalledWith('/auth-files/fields', {
                name: 'devin-shared.json', 'auth-index': 'devin-b', priority: 7,
            })
            const batchPage = readFileSync(new URL('../src/pages/CredentialsPage.tsx', import.meta.url), 'utf8')
            expect(batchPage).toContain('authFilesApi.setStatus(file.name, disabled, file.authIndex)')
            expect(batchPage).not.toContain('authFilesApi.bulkDisable(')
            expect(batchPage).not.toContain('authFilesApi.bulkEnable(')
        } finally {
            request.mockRestore()
        }
    })

    test('cache clearing deletes every alias and stays inherited after normalization and editor reopen', () => {
        const file: AuthFileItem = {
            name: 'synthetic.json', disable_cooling: false, 'disable-cooling': true, disableCooling: true,
            request_retry: 0, 'request-retry': 7, requestRetry: 8,
        }
        expect(mutate(file, {})).toEqual(file)
        for (const request_retry of [null, -1]) {
            const cleared = mutate(file, {disable_cooling: null, request_retry})
            for (const key of ['disable_cooling', 'disable-cooling', 'disableCooling',
                'request_retry', 'request-retry', 'requestRetry']) {
                expect(Object.prototype.hasOwnProperty.call(cleared, key)).toBe(false)
            }
            const normalized = normalize(cleared)
            expect(normalized.disableCooling).toBeUndefined()
            expect(normalized.requestRetry).toBeUndefined()
            expect(patch(editor(normalized))).toEqual({})
        }
        const overridden = mutate(file, {disable_cooling: false, request_retry: 0})
        expect(normalize(overridden)).toMatchObject({disableCooling: false, requestRetry: 0})
        expect(patch(editor(overridden))).toEqual({})
        expect(file['request-retry']).toBe(7)
        expect(() => mutate(file, {request_retry: NaN})).toThrow('auth_files.request_retry_invalid')
    })

    test('sends credential policies only when edited, and clears them with empty arrays', () => {
        const aliases = [{name: 'gpt-5', alias: 'local-gpt', fork: true}]
        const rules = [{status: 429, match: ['quota'], action: 'stop'}]
        const original = {model_aliases: aliases, request_scoped_errors: rules}
        expect(patch(editor(original))).toEqual({})
        expect(patch(editor(original, {
            modelAliasesText: JSON.stringify(aliases), modelAliasesTouched: true,
            requestRulesText: JSON.stringify(rules), requestRulesTouched: true,
        }))).toEqual({})
        expect(patch(editor(original, {
            modelAliasesText: '', modelAliasesTouched: true,
            requestRulesText: '[]', requestRulesTouched: true,
        }))).toEqual({model_aliases: [], request_scoped_errors: []})
        expect(patch(editor({}, {
            modelAliasesText: JSON.stringify(aliases), modelAliasesTouched: true,
            requestRulesText: JSON.stringify(rules), requestRulesTouched: true,
        }))).toEqual({model_aliases: aliases, request_scoped_errors: rules})
        expect(patch(editor({}, {
            supportsModelAliases: false, modelAliasesText: JSON.stringify(aliases), modelAliasesTouched: true,
        }))).toEqual({})
    })

    test('explicitly clears non-array policies while preserving untouched opaque values', async () => {
        for (const aliasesKey of ['model_aliases', 'model-aliases']) {
            for (const rulesKey of ['request_scoped_errors', 'request-scoped-errors']) {
                for (const value of [{future: true}, 'future-format', null]) {
                    const original = {[aliasesKey]: value, [rulesKey]: value}
                    expect(patch(editor(original, {prefix: 'edited'}))).toEqual({prefix: 'edited'})
                    for (const text of ['', '[]']) {
                        const state = editor(original, {modelAliasesTouched: true, modelAliasesText: text,
                            requestRulesTouched: true, requestRulesText: text})
                        expect(patch(state)).toEqual({model_aliases: [], request_scoped_errors: []})
                        const request = spyOn(apiClient, 'patch').mockResolvedValue({status: 'ok'})
                        try {
                            await authFilesApi.patchFields(state.fileName, patch(state), 'synthetic-auth')
                            expect(request).toHaveBeenCalledWith('/auth-files/fields', {name: state.fileName,
                                'auth-index': 'synthetic-auth', model_aliases: [], request_scoped_errors: []})
                        } finally {
                            request.mockRestore()
                        }
                    }
                }
            }
        }
        expect(patch(editor({}, {modelAliasesTouched: true, requestRulesTouched: true}))).toEqual({})
    })

    test('preserves existing empty conditions and extension fields on status-only rule edits', () => {
        const original = {status: 429, action: ' Continue ', match: ['', ' quota '],
            'match-regexr': [''], future: {keep: true}}
        const changed = {...original, status: 503}
        for (const key of ['request_scoped_errors', 'request-scoped-errors']) {
            const state = editor({[key]: [original]}, {
                requestRulesTouched: true, requestRulesText: JSON.stringify([changed]),
            })
            expect(patch(state)).toEqual({request_scoped_errors: [changed]})
            expect(() => patch({...state, requestRulesText: JSON.stringify([
                {...changed, match: ['', ' quota ', '']},
            ])})).toThrow('auth_files.request_rules_invalid')
            expect(() => patch({...state, requestRulesText: JSON.stringify([changed, changed])}))
                .toThrow('auth_files.request_rules_invalid')
        }
    })

    test('preserves untouched legacy request rules while editing other rows', async () => {
        const legacy = [{}, {status: 0, action: 'legacy', match: ['']}]
        const added = {status: 429, action: 'continue', match: ['limit']}
        for (const key of ['request_scoped_errors', 'request-scoped-errors']) {
            const state = editor({[key]: legacy}, {
                requestRulesText: JSON.stringify([...legacy, added]), requestRulesTouched: true,
            })
            expect(patch(state)).toEqual({request_scoped_errors: [...legacy, added]})
            const request = spyOn(apiClient, 'patch').mockResolvedValue({status: 'ok'})
            try {
                await authFilesApi.patchFields(state.fileName, patch(state), 'synthetic-auth')
                expect(request).toHaveBeenCalledWith('/auth-files/fields', {
                    name: state.fileName, 'auth-index': 'synthetic-auth', request_scoped_errors: [...legacy, added],
                })
            } finally {
                request.mockRestore()
            }
            expect(() => patch({...state, requestRulesText: JSON.stringify([...legacy, {}])}))
                .toThrow('auth_files.request_rules_invalid')
            expect(() => patch({...state, requestRulesText: JSON.stringify([{}, {...legacy[1], status: 503}])}))
                .toThrow('auth_files.request_rules_invalid')
        }
    })

    test('preserves literal whitespace conditions but rejects new empty strings', () => {
        const rule = {status: 429, action: 'continue', match: [' \t\n ']}
        expect(patch(editor({}, {requestRulesText: JSON.stringify([rule]), requestRulesTouched: true})))
            .toEqual({request_scoped_errors: [rule]})
        for (const match of [[''], ['', 'limit']]) {
            expect(() => patch(editor({}, {
                requestRulesText: JSON.stringify([{...rule, match}]), requestRulesTouched: true,
            }))).toThrow('auth_files.request_rules_invalid')
        }
    })

    test('rejects malformed credential policies instead of sending a partial patch', () => {
        for (const modelAliasesText of ['{', '{}', '[{"name":"gpt-5","alias":"gpt-5"}]',
            '[{"name":"a","alias":"shared"},{"name":"b","alias":"shared"}]']) {
            expect(() => patch(editor({}, {modelAliasesText, modelAliasesTouched: true}))).toThrow()
        }
        for (const requestRulesText of ['{', '[{"status":429,"action":"stop"}]',
            '[{"status":429,"match":["quota"],"action":"invalid"}]']) {
            expect(() => patch(editor({}, {requestRulesText, requestRulesTouched: true}))).toThrow()
        }
    })

    test('edits WebSocket transport only for supported credential providers', async () => {
        for (const provider of ['codex', 'xai', 'x-ai', 'grok']) {
            expect(supportsAuthFileWebsockets(provider)).toBe(true)
        }
        expect(supportsAuthFileWebsockets('claude')).toBe(false)
        expect(normalize({websockets: 'true'}).websockets).toBe(true)
        expect(patch(editor({}, {
            supportsWebsockets: true, websockets: true, websocketsTouched: true,
        }))).toEqual({websockets: true})
        expect(patch(editor({websockets: true}, {
            supportsWebsockets: true, websockets: false, websocketsTouched: true,
        }))).toEqual({websockets: false})
        expect(patch(editor({websockets: true}, {
            supportsWebsockets: false, websockets: false, websocketsTouched: true,
        }))).toEqual({})
        expect(mutate(normalize({websockets: true}), {websockets: false}).websockets).toBe(false)
        const [disk] = normalizeAuthFilesResponse({files: [
            {name: 'synthetic.json', source: 'file'},
            {name: 'synthetic.json', source: 'memory', websockets: true},
        ]}).files
        expect(disk.websockets).toBeUndefined()
        const request = spyOn(apiClient, 'patch').mockResolvedValue({status: 'ok'})
        try {
            await authFilesApi.patchFields('synthetic.json', {websockets: false}, 'codex-1')
            expect(request).toHaveBeenLastCalledWith('/auth-files/fields', {
                name: 'synthetic.json', 'auth-index': 'codex-1', websockets: false,
            })
        } finally {
            request.mockRestore()
        }
    })

    test('safe display shows only normalized override values and no sensitive metadata', () => {
        expect(buildSafeAuthFileDisplayInfo({
            name: 'synthetic.json', 'disable-cooling': false, 'request-retry': 0,
            access_token: 'synthetic-secret', metadata: {request_retry: 99, token: 'synthetic-secret'},
        })).toEqual({name: 'synthetic.json', disableCooling: false, requestRetry: 0})
        expect(buildSafeAuthFileDisplayInfo({
            name: 'synthetic.json', disable_cooling: null, disableCooling: true,
            request_retry: -1, requestRetry: 3,
        })).toEqual({name: 'synthetic.json'})
    })
})


describe('auth-file override hook lifecycle', () => {
    test('preserves every untouched policy format when opening the production editor', async () => {
        const fixtures: Record<string, unknown>[] = [
            {},
            {model_aliases: null, request_scoped_errors: null},
            {model_aliases: {future: true}, request_scoped_errors: 'future-format'},
            {model_aliases: [null, 'unknown'], request_scoped_errors: [null, 'unknown']},
            {
                model_aliases: [{name: 'upstream', alias: 'public', fork: false,
                    'force-mapping': false, future: {retained: true}}],
                request_scoped_errors: [{status: 429, match: [], 'match-regexr': ['(?i)limit'],
                    action: ' Continue ', future: {retained: true}}],
            },
            {model_aliases: [{name: '', alias: 'imported-invalid', fork: 'future-value'}],
                request_scoped_errors: [{status: 0, action: 'future', match: [null]}]},
        ]
        let original: Record<string, unknown> = {}
        let state: PrefixProxyEditorState | null = null
        let hook!: ReturnType<typeof useAuthFilesPrefixProxyEditor>
        const originalUseState = React.useState
        const setState = (value: React.SetStateAction<PrefixProxyEditorState | null>) => {
            state = typeof value === 'function' ? value(state) : value
        }
        const useState = spyOn(React, 'useState').mockImplementation(((initial: unknown) =>
            initial === null ? [state, setState] : originalUseState(initial)
        ) as typeof React.useState)
        const download = spyOn(authFilesApi, 'downloadText').mockImplementation(async () => JSON.stringify(original))
        const request = spyOn(apiClient, 'patch').mockResolvedValue({status: 'ok'})
        const completeMutation = mock(async () => {})
        const Probe = () => {
            hook = useAuthFilesPrefixProxyEditor({disableControls: false, completeMutation})
            return null
        }
        const render = () => renderToStaticMarkup(React.createElement(Probe))
        try {
            for (const [index, fixture] of fixtures.entries()) {
                original = fixture
                const before = structuredClone(original)
                render()
                await hook.openPrefixProxyEditor({name: `fixture-${index}.json`, authIndex: `fixture-${index}`, type: 'codex'})
                render()
                const loaded = hook.prefixProxyEditor
                expect(loaded).toBeTruthy()
                if (!loaded) {
                    throw new Error('fixture editor was not loaded')
                }
                expect(loaded.modelAliasesError).toBeNull()
                expect(loaded.requestRulesError).toBeNull()
                expect(loaded.modelAliasesTouched).toBe(false)
                expect(loaded.requestRulesTouched).toBe(false)
                expect(loaded.json?.model_aliases).toEqual(original.model_aliases)
                expect(loaded.json?.request_scoped_errors).toEqual(original.request_scoped_errors)
                const projected = structuredClone(loaded.json)
                expect(patch(loaded)).toEqual({})
                expect(loaded.json).toEqual(projected)
                expect(original).toEqual(before)
                expect(hook.prefixProxyDirty).toBe(false)
                await hook.handlePrefixProxySave()
                expect(request).not.toHaveBeenCalled()
                expect(completeMutation).not.toHaveBeenCalled()
                hook.closePrefixProxyEditor()
            }
        } finally {
            useState.mockRestore()
            download.mockRestore()
            request.mockRestore()
        }
    })

    test('preserves an open draft and blocks all mutations while disabled, loading, saving or readonly', async () => {
        const draft = editor({prefix: 'original'}, {authIndex: 'synthetic-a', prefix: 'draft'})
        let state: PrefixProxyEditorState | null = draft
        let disableControls = false
        let hook!: ReturnType<typeof useAuthFilesPrefixProxyEditor>
        const originalUseState = React.useState
        const setState = (value: React.SetStateAction<PrefixProxyEditorState | null>) => {
            state = typeof value === 'function' ? value(state) : value
        }
        const useState = spyOn(React, 'useState').mockImplementation(((initial: unknown) =>
            initial === null ? [state, setState] : originalUseState(initial)
        ) as typeof React.useState)
        const request = spyOn(apiClient, 'patch').mockResolvedValue({status: 'ok'})
        const download = spyOn(authFilesApi, 'downloadText').mockResolvedValue('{}')
        const mutations: unknown[] = []
        const Probe = () => {
            hook = useAuthFilesPrefixProxyEditor({
                disableControls,
                completeMutation: async (name, fields, authIndex) => { mutations.push({name, fields, authIndex}) },
            })
            return null
        }
        const render = () => renderToStaticMarkup(React.createElement(Probe))
        try {
            render()
            expect(hook.prefixProxyDirty).toBe(true)
            for (const phase of ['disabled', 'loading', 'saving', 'readonly']) {
                disableControls = phase === 'disabled'
                state = {...draft, loading: phase === 'loading', saving: phase === 'saving', readOnly: phase === 'readonly'}
                render()
                const before = state
                for (const [field, value] of [
                    ['prefix', 'changed'], ['proxyUrl', 'https://synthetic.invalid'], ['priority', '3'],
                    ['weight', '4'], ['note', 'changed'], ['headersText', '{"x-test":"changed"}'],
                    ['excludedModelsText', 'changed'], ['modelAliasesText', '[]'], ['requestRulesText', '[]'],
                ] as const) {
                    hook.handlePrefixProxyChange(field, value)
                }
                hook.handlePrefixProxyBooleanChange('websockets', true)
                hook.handlePrefixProxyBooleanChange('usingApi', true)
                hook.handlePrefixProxyOverridesChange({disableCooling: true, requestRetry: 3})
                await hook.handlePrefixProxySave()
                expect(state).toBe(before)
                expect(request).not.toHaveBeenCalled()
                expect(mutations).toEqual([])
                if (disableControls) {
                    await hook.openPrefixProxyEditor({name: 'other.json', authIndex: 'synthetic-b'})
                    expect(state).toBe(before)
                    expect(download).not.toHaveBeenCalled()
                }
            }
            disableControls = false
            state = draft
            render()
            expect(hook.prefixProxyEditor?.prefix).toBe('draft')
            await hook.handlePrefixProxySave()
            expect(request).toHaveBeenCalledTimes(1)
            expect(request).toHaveBeenLastCalledWith('/auth-files/fields', {
                name: 'synthetic.json', 'auth-index': 'synthetic-a', prefix: 'draft',
            })
            expect(mutations).toEqual([{
                name: 'synthetic.json', authIndex: 'synthetic-a', fields: {prefix: 'draft'},
            }])
        } finally {
            useState.mockRestore()
            request.mockRestore()
            download.mockRestore()
        }
    })

    for (const phase of ['disabled', 'saving']) {
        test(`disables rendered mutation fields and save while ${phase}`, () => {
            let modal!: React.ReactElement<React.ComponentProps<typeof Modal>>
            const Probe = () => {
                modal = AuthFilesPrefixProxyEditorModal({
                    editor: editor({}, {saving: phase === 'saving', supportsWebsockets: true, supportsUsingApi: true}),
                    dirty: true, disableControls: phase === 'disabled', onClose: () => {},
                    onChange: () => {}, onBooleanChange: () => {}, onOverridesChange: () => {}, onSave: () => {},
                })
                return null
            }
            renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(Probe)))
            const html = renderToStaticMarkup(React.createElement(MemoryRouter, null, modal.props.children))
            const controls = [...html.matchAll(/<(?:input|textarea|select)\b[^>]*>/g)]
                .filter(([control]) => !/\breadonly=/i.test(control))
            expect(controls.length).toBeGreaterThanOrEqual(8)
            for (const [control] of controls) {
                expect(control).toContain('disabled=""')
            }
            const footer = modal.props.footer as React.ReactElement<{children: React.ReactNode}>
            const save = React.Children.toArray(footer.props.children)[1] as React.ReactElement<{disabled: boolean}>
            expect(save.props.disabled).toBe(true)
            expect(readFileSync(new URL('../src/pages/CredentialsPage.tsx', import.meta.url), 'utf8'))
                .toContain("connectionStatus !== 'connected'")
            expect(readFileSync(new URL('../src/components/credentials/VendorSection.tsx', import.meta.url), 'utf8'))
                .toMatch(/<AuthFilesPrefixProxyEditorModal[\s\S]*?disableControls=\{disableControls\}/)
        })
    }

    test('validates policy edits and clears the selected credential by auth index', async () => {
        let state: PrefixProxyEditorState | null = null
        let hook!: ReturnType<typeof useAuthFilesPrefixProxyEditor>
        const originalUseState = React.useState
        const setState = (value: React.SetStateAction<PrefixProxyEditorState | null>) => {
            state = typeof value === 'function' ? value(state) : value
        }
        const useState = spyOn(React, 'useState').mockImplementation(((initial: unknown) =>
            initial === null ? [state, setState] : originalUseState(initial)
        ) as typeof React.useState)
        const download = spyOn(authFilesApi, 'downloadText').mockImplementation(async (name) => JSON.stringify(
            name === 'meta.json' ? {type: 'meta', auth_kind: 'oauth', api_key: 'synthetic-minted-key'} :
            name === 'key.json' ? {type: 'claude', auth_kind: 'apikey', api_key: 'synthetic-key'} : {
                type: 'codex',
                model_aliases: [{name: 'gpt-5', alias: 'local-gpt'}],
                request_scoped_errors: [{status: 429, match: ['quota'], action: 'stop'}],
            },
        ))
        const request = spyOn(apiClient, 'patch').mockResolvedValue({status: 'ok'})
        const mutations: unknown[] = []
        const Probe = () => {
            hook = useAuthFilesPrefixProxyEditor({
                disableControls: false,
                completeMutation: async (name, fields, authIndex) => { mutations.push({name, fields, authIndex}) },
            })
            return null
        }
        const render = () => renderToStaticMarkup(React.createElement(Probe))
        try {
            render()
            await hook.openPrefixProxyEditor({name: 'shared.json', authIndex: 'codex-a', type: 'codex'})
            render()
            expect(hook.prefixProxyEditor).toMatchObject({
                authIndex: 'codex-a', supportsModelAliases: true,
                modelAliasesTouched: false, requestRulesTouched: false,
            })
            expect(hook.prefixProxyDirty).toBe(false)
            hook.handlePrefixProxyChange('modelAliasesText', '{')
            render()
            expect(hook.prefixProxyDirty).toBe(true)
            expect(hook.prefixProxyEditor?.modelAliasesError).toBeTruthy()
            await hook.handlePrefixProxySave()
            expect(request).not.toHaveBeenCalled()
            hook.handlePrefixProxyChange('modelAliasesText', '')
            hook.handlePrefixProxyChange('requestRulesText', '[]')
            render()
            expect(hook.prefixProxyDirty).toBe(true)
            await hook.handlePrefixProxySave()
            expect(request).toHaveBeenLastCalledWith('/auth-files/fields', {
                name: 'shared.json', 'auth-index': 'codex-a',
                model_aliases: [], request_scoped_errors: [],
            })
            expect(mutations).toEqual([{
                name: 'shared.json', authIndex: 'codex-a',
                fields: {model_aliases: [], request_scoped_errors: []},
            }])

            render()
            await hook.openPrefixProxyEditor({name: 'meta.json', type: 'meta'})
            render()
            expect(hook.prefixProxyEditor?.supportsModelAliases).toBe(true)
            hook.closePrefixProxyEditor()
            render()
            await hook.openPrefixProxyEditor({name: 'key.json', type: 'claude'})
            render()
            expect(hook.prefixProxyEditor?.supportsModelAliases).toBe(false)
        } finally {
            useState.mockRestore()
            download.mockRestore()
            request.mockRestore()
        }
    })

    test('keeps late same-file downloads bound to their runtime identity', async () => {
        let state: PrefixProxyEditorState | null = null
        let hook!: ReturnType<typeof useAuthFilesPrefixProxyEditor>
        const originalUseState = React.useState
        const setState = (value: React.SetStateAction<PrefixProxyEditorState | null>) => {
            state = typeof value === 'function' ? value(state) : value
        }
        const useState = spyOn(React, 'useState').mockImplementation(((initial: unknown) =>
            initial === null ? [state, setState] : originalUseState(initial)
        ) as typeof React.useState)
        const pending: Array<(value: string) => void> = []
        const download = spyOn(authFilesApi, 'downloadText').mockImplementation(
            () => new Promise<string>((resolve) => pending.push(resolve)),
        )
        const Probe = () => {
            hook = useAuthFilesPrefixProxyEditor({
                disableControls: false,
                completeMutation: async () => {},
            })
            return null
        }
        const render = () => renderToStaticMarkup(React.createElement(Probe))
        try {
            render()
            const first = hook.openPrefixProxyEditor({name: 'devin-shared.json', authIndex: 'devin-a'})
            render()
            const second = hook.openPrefixProxyEditor({name: 'devin-shared.json', authIndex: 'devin-b'})
            render()

            pending[0]?.(JSON.stringify({priority: 1}))
            await first
            render()
            expect(hook.prefixProxyEditor).toMatchObject({
                authIndex: 'devin-b', loading: true, priority: '',
            })

            pending[1]?.(JSON.stringify({priority: 2}))
            await second
            render()
            expect(hook.prefixProxyEditor).toMatchObject({
                authIndex: 'devin-b', loading: false, priority: '2',
            })
        } finally {
            useState.mockRestore()
            download.mockRestore()
        }
    })

    test('loads all branches, changes only touched fields, and blocks invalid retry without render errors', async () => {
        let state: PrefixProxyEditorState | null = null
        let hook!: ReturnType<typeof useAuthFilesPrefixProxyEditor>
        const originalUseState = React.useState
        const setState = (value: React.SetStateAction<PrefixProxyEditorState | null>) => {
            state = typeof value === 'function' ? value(state) : value
        }
        const useState = spyOn(React, 'useState').mockImplementation(((initial: unknown) =>
            initial === null ? [state, setState] : originalUseState(initial)
        ) as typeof React.useState)
        const download = spyOn(authFilesApi, 'downloadText').mockResolvedValue(JSON.stringify({
            disable_cooling: null, 'disable-cooling': true, request_retry: -1, 'request-retry': 5,
        }))
        const request = spyOn(apiClient, 'patch').mockResolvedValue({status: 'ok'})
        const mutations: unknown[] = []
        const Probe = () => {
            hook = useAuthFilesPrefixProxyEditor({
                disableControls: false,
                completeMutation: async (name, fields, authIndex) => { mutations.push({name, authIndex, fields}) },
            })
            return null
        }
        const render = () => renderToStaticMarkup(React.createElement(Probe))
        try {
            render()
            await hook.openPrefixProxyEditor({name: 'runtime.json', runtimeOnly: true})
            render()
            expect(hook.prefixProxyEditor).toMatchObject({
                readOnly: true, requestRetry: undefined, requestRetryTouched: false,
                disableCooling: undefined, disableCoolingTouched: false,
            })
            hook.handlePrefixProxyOverridesChange({disableCooling: false, requestRetry: 0})
            render()
            expect(hook.prefixProxyDirty).toBe(false)
            await hook.handlePrefixProxySave()
            expect(request).not.toHaveBeenCalled()
            expect(download).not.toHaveBeenCalled()
            hook.closePrefixProxyEditor()
            render()

            const loading = hook.openPrefixProxyEditor({name: 'synthetic.json', authIndex: 'devin-a'})
            render()
            expect(hook.prefixProxyEditor).toMatchObject({
                authIndex: 'devin-a', loading: true, requestRetryTouched: false, disableCoolingTouched: false,
            })
            await loading
            render()
            expect(hook.prefixProxyEditor).toMatchObject({
                loading: false, requestRetry: undefined, requestRetryTouched: false,
                disableCooling: undefined, disableCoolingTouched: false,
            })
            expect(hook.prefixProxyDirty).toBe(false)
            hook.handlePrefixProxyOverridesChange({disableCooling: false})
            render()
            expect(hook.prefixProxyEditor).toMatchObject({
                disableCooling: false, disableCoolingTouched: true, requestRetryTouched: false,
            })
            hook.handlePrefixProxyOverridesChange({requestRetry: NaN})
            expect(render).not.toThrow()
            expect(hook.prefixProxyDirty).toBe(true)
            await hook.handlePrefixProxySave()
            expect(request).not.toHaveBeenCalled()
            hook.handlePrefixProxyOverridesChange({requestRetry: 0})
            render()
            expect(hook.prefixProxyEditor).toMatchObject({
                disableCooling: false, requestRetry: 0, requestRetryTouched: true,
            })
            await hook.handlePrefixProxySave()
            expect(request).toHaveBeenLastCalledWith('/auth-files/fields', {
                name: 'synthetic.json', 'auth-index': 'devin-a', disable_cooling: false, request_retry: 0,
            })
            expect(mutations).toEqual([{
                name: 'synthetic.json',
                authIndex: 'devin-a',
                fields: {disable_cooling: false, request_retry: 0},
            }])
            render()
            expect(hook.prefixProxyEditor).toBeNull()
        } finally {
            useState.mockRestore()
            download.mockRestore()
            request.mockRestore()
        }
    })
})
