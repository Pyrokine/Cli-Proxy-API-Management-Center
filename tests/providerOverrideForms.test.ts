import {describe, expect, mock, spyOn, test} from 'bun:test'
import {readFileSync} from 'node:fs'
import * as React from 'react'
import ts from 'typescript'
import * as providerUtils from '@/components/providers/utils'
import * as modelEntries from '@/components/ui/modelInputListUtils'
import {buildBaseSignatureFields, normalizeModelEntriesForSignature} from '@/hooks/useProviderEditForm'
import {apiClient} from '@/services/api/client'
import {findProviderConfigIndexByAuthIndex, providersApi} from '@/services/api/providers'
import {normalizeClaudeFingerprintProfile} from '@/services/api/transformers'
import type {CredentialOverrides, ProviderKeyConfig} from '@/types'
import {useClaudeEditDraftStore} from '@/stores/useClaudeEditDraftStore'
import {useOpenAIEditDraftStore} from '@/stores/useOpenAIEditDraftStore'
import {getCredentialRetryValidationKey} from '@/utils/credentialOverrides'
import {getCredentialWeightValidationKey} from '@/utils/credentialWeight'
import * as headers from '@/utils/headers'
import {getErrorMessage} from '@/utils/helpers'
import {normalizeModelThinking} from '@/utils/modelMetadata'

const transpiler = new Bun.Transpiler({loader: 'tsx', tsconfig: {compilerOptions: {jsx: 'react'}}})
const dependencies = {
    ...providerUtils, ...modelEntries, ...headers,
    buildBaseSignatureFields, normalizeModelEntriesForSignature, normalizeModelThinking,
    providersApi, findProviderConfigIndexByAuthIndex, normalizeClaudeFingerprintProfile,
    getCredentialWeightValidationKey, getCredentialRetryValidationKey, getErrorMessage,
    useCallback: <T,>(callback: T) => callback,
    t: (key: string) => key,
}

// 执行现有页面的表单配置和保存回调，不调用 React 页面中的网络或模型测试
function pageBinding<T>(page: string, name: string, extra: Record<string, unknown> = {}): T {
    const source = readFileSync(new URL(`../src/pages/${page}.tsx`, import.meta.url), 'utf8')
    const tree = ts.createSourceFile(page, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    let declaration: ts.VariableDeclaration | undefined
    const visit = (node: ts.Node) => {
        if (ts.isVariableDeclaration(node) && node.name.getText(tree) === name) {
            declaration = node
        }
        ts.forEachChild(node, visit)
    }
    visit(tree)
    if (!declaration?.initializer) {
        throw new Error(`Missing page binding: ${page}.${name}`)
    }
    const globals = tree.statements.filter((node) =>
        ts.isVariableStatement(node) || (ts.isFunctionDeclaration(node) && !node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)),
    ).map((node) => node.getText(tree)).join('\n')
    const code = transpiler.transformSync(`${globals}\nconst selected = ${declaration.initializer.getText(tree)}`)
    const scope = {...dependencies, ...extra}
    return new Function(...Object.keys(scope), `${code}; return selected`)(...Object.values(scope)) as T
}

const original = {
    apiKey: 'synthetic-key', authIndex: 'synthetic-auth', name: 'synthetic-provider',
    baseUrl: 'https://example.test', apiKeyEntries: [], models: [],
}
const states: CredentialOverrides[] = [
    {}, {disableCooling: false, requestRetry: 0}, {disableCooling: true, requestRetry: 2},
    {disableCooling: false, requestRetry: -1},
]
type TestForm = typeof original & CredentialOverrides & {
    headers: {key: string; value: string}[]; modelEntries: {name: string; alias: string}[]; excludedText: string
}
type EditOptions = {
    configToForm: (config: typeof original & CredentialOverrides) => TestForm
    formToPayload: (form: TestForm) => ProviderKeyConfig
    buildSignature: (form: TestForm) => string
    updateConfig: (index: number, config: ProviderKeyConfig, previous: ProviderKeyConfig) => Promise<unknown>
}

for (const provider of ['Gemini', 'Interactions', 'Codex', 'XAI', 'Vertex']) {
    describe(`${provider} override form`, () => {
        const options = pageBinding<EditOptions>(`AiProviders${provider}EditPage`, 'editOptions')
        test('preserves loaded overrides and detects inherit, false and zero edits', () => {
            const baseline = options.configToForm(original)
            for (const state of states) {
                const form = options.configToForm({...original, ...state})
                const payload = options.formToPayload(form)
                expect(payload.disableCooling).toBe(state.disableCooling)
                expect(payload.requestRetry).toBe(state.requestRetry)
                expect(options.buildSignature(form) === options.buildSignature(baseline)).toBe(Object.keys(state).length === 0)
            }
            expect(options.buildSignature({...baseline, requestRetry: NaN})).not.toBe(options.buildSignature(baseline))
        })
        test('sends only changed overrides through the existing save API', async () => {
            const patch = spyOn(apiClient, 'patch').mockResolvedValue({})
            try {
                const previous = {...original, ...states[2]}
                const form = options.configToForm(previous)
                await options.updateConfig(0, options.formToPayload(form), previous)
                expect(patch.mock.calls[0]?.[1]).toHaveProperty('value')
                expect((patch.mock.calls[0]?.[1] as {value: unknown}).value).not.toHaveProperty('request-retry')
                expect((patch.mock.calls[0]?.[1] as {value: unknown}).value).not.toHaveProperty('disable-cooling')
                await options.updateConfig(0, options.formToPayload({...form, disableCooling: undefined, requestRetry: undefined}), previous)
                expect(patch.mock.calls[1]?.[1]).toMatchObject({value: {'disable-cooling': null, 'request-retry': null}})
            } finally { patch.mockRestore() }
        })
    })
}

for (const provider of ['Claude', 'OpenAI'] as const) {
    describe(`${provider} override draft and save`, () => {
        const page = `AiProviders${provider}EditLayout`
        const signature = pageBinding<(form: TestForm, model: string) => string>(page, `build${provider}Signature`)
        const seed = pageBinding<(config: typeof original & CredentialOverrides) => {form: TestForm}>(page, 'seedDraftInit')
        test('shares explicit values and clearing across draft route layers', () => {
            const useStore = provider === 'Claude' ? useClaudeEditDraftStore : useOpenAIEditDraftStore
            const store = useStore.getState()
            const key = `${provider}:synthetic-overrides`
            const updateForm = (overrides: CredentialOverrides) =>
                store.setDraftForm(key, <T extends CredentialOverrides>(form: T): T => ({...form, ...overrides}))
            store.acquireDraft(key)
            store.acquireDraft(key)
            updateForm({disableCooling: false, requestRetry: 0})
            store.releaseDraft(key)
            expect(useStore.getState().drafts[key].form).toMatchObject({disableCooling: false, requestRetry: 0})
            updateForm({disableCooling: undefined, requestRetry: undefined})
            expect(useStore.getState().drafts[key].form.disableCooling).toBeUndefined()
            expect(useStore.getState().drafts[key].form.requestRetry).toBeUndefined()
            store.releaseDraft(key)
            expect(useStore.getState().drafts[key]).toBeUndefined()
        })
        test('retains overrides in the draft and includes all three cooling states in dirty checks', () => {
            const baseline = seed(original).form
            for (const state of states) {
                const form = seed({...original, ...state}).form
                expect(form.disableCooling).toBe(state.disableCooling)
                expect(form.requestRetry).toBe(state.requestRetry)
                expect(signature(form, '') === signature(baseline, '')).toBe(Object.keys(state).length === 0)
            }
            expect(signature({...baseline, requestRetry: NaN}, '')).not.toBe(signature(baseline, ''))
        })
        test('preserves clearing in the API, local cache and baseline when reloading fails', async () => {
            const patch = spyOn(apiClient, 'patch').mockResolvedValue({})
            const read = provider === 'Claude'
                ? spyOn(providersApi, 'getClaudeConfigs').mockRejectedValue(new Error('synthetic reload failure'))
                : spyOn(providersApi, 'getOpenAIProviders').mockRejectedValue(new Error('synthetic reload failure'))
            const notify = mock()
            const updateConfigValue = mock()
            const onSave = pageBinding<(ctx: Record<string, unknown>) => Promise<void>>(page, 'onSave', {showNotification: notify, updateConfigValue})
            const previous = {...original, ...states[2]}
            const form = {...seed(previous).form, disableCooling: undefined, requestRetry: undefined}
            const baseline = mock()
            const navigate = mock()
            try {
                await onSave({form, testModel: '', editIndex: 0, configs: [previous], setConfigs: mock(), setSaving: mock(),
                    allowNextNavigation: mock(), updateBaselineSignature: baseline, handleBack: navigate})
                expect(patch).toHaveBeenCalledTimes(1)
                expect(patch.mock.calls[0]?.[1]).toMatchObject({value: {'disable-cooling': null, 'request-retry': null}})
                const cached = updateConfigValue.mock.calls[0]?.[1] as CredentialOverrides[]
                expect(cached[0].disableCooling).toBeUndefined()
                expect(cached[0].requestRetry).toBeUndefined()
                expect(baseline).toHaveBeenCalledWith(signature(form, ''))
                expect(navigate).toHaveBeenCalledTimes(1)
                expect(notify.mock.calls.some((call) => call[1] === 'warning')).toBe(true)
            } finally { patch.mockRestore(); read.mockRestore() }
        })
        test('rejects unsafe retry values before any save, cache change or navigation', async () => {
            const patch = spyOn(apiClient, 'patch').mockResolvedValue({})
            const notify = mock()
            const updateConfigValue = mock()
            const onSave = pageBinding<(ctx: Record<string, unknown>) => Promise<void>>(page, 'onSave', {showNotification: notify, updateConfigValue})
            try {
                for (const retry of [NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
                    await onSave({form: {...seed(original).form, requestRetry: retry}, configs: [original], editIndex: 0, testModel: ''})
                }
                expect(patch).not.toHaveBeenCalled()
                expect(updateConfigValue).not.toHaveBeenCalled()
                expect(notify).toHaveBeenCalledTimes(4)
            } finally { patch.mockRestore() }
        })
    })
}

describe('shared override controls', () => {
    const source = readFileSync(new URL('../src/components/providers/CredentialOverrideFields.tsx', import.meta.url), 'utf8')
    const code = transpiler.transformSync(source.slice(source.indexOf('export function')).replace('export function', 'function'))
    const fields = new Function('React', 'Input', 'Select', 'useId', 'useTranslation', 'getCredentialRetryValidationKey', `${code};return CredentialOverrideFields`)(
        React, 'retry-input', 'cooling-select', () => 'cooling-control', () => ({t: (key: string) => key}), getCredentialRetryValidationKey,
    ) as (props: CredentialOverrides & {disabled: boolean; onChange: (value: CredentialOverrides) => void}) => React.ReactElement<{children: React.ReactElement[]}>

    test('exposes three explicit choices and preserves zero and inherit in change events', () => {
        const changes = mock()
        const tree = fields({disabled: false, onChange: changes})
        const group = tree.props.children[0] as React.ReactElement<{children: React.ReactElement[]}>
        const select = group.props.children[1] as React.ReactElement<{value: string; options: {value: string}[]; onChange: (value: string) => void}>
        expect(select.props.value).toBe('inherit')
        expect(select.props.options.map((option) => option.value)).toEqual(['inherit', 'false', 'true'])
        for (const value of ['false', 'true', 'inherit']) {
            select.props.onChange(value)
        }
        expect(changes.mock.calls).toEqual([[{disableCooling: false}], [{disableCooling: true}], [{disableCooling: undefined}]])
    })
    test('checks raw integers before conversion and does not turn invalid input into inheritance', () => {
        const changes = mock()
        const tree = fields({disabled: false, requestRetry: 0, onChange: changes})
        const input = tree.props.children[1] as React.ReactElement<{value: number; onChange: (event: unknown) => void; 'aria-label': string}>
        expect(input.props.value).toBe(0)
        expect(input.props['aria-label']).toBe('auth_files.request_retry_label')
        for (const [raw, expected] of [['', undefined], ['-1', -1], ['0', 0], ['2', 2], ['9007199254740991', Number.MAX_SAFE_INTEGER]] as const) {
            input.props.onChange({target: {value: raw, validity: {badInput: false}}})
            expect(changes.mock.calls[changes.mock.calls.length - 1]?.[0]).toEqual({requestRetry: expected})
        }
        for (const raw of ['1.5', '9007199254740990.5', '9007199254740992', '1e999']) {
            input.props.onChange({target: {value: raw, validity: {badInput: false}}})
            expect(getCredentialRetryValidationKey(changes.mock.calls[changes.mock.calls.length - 1]?.[0].requestRetry)).toBe('auth_files.request_retry_invalid')
        }
        input.props.onChange({target: {value: '', validity: {badInput: true}}})
        expect(Number.isNaN(changes.mock.calls[changes.mock.calls.length - 1]?.[0].requestRetry)).toBe(true)
    })
})
