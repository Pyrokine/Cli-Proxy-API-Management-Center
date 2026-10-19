import {describe, expect, test} from 'bun:test'
import {readFileSync} from 'node:fs'
import {createElement, type ReactElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {parse, parseDocument} from 'yaml'
import {isValidApiKey} from '@/utils/validation'
import {EMPTY_API_KEY_MODEL_RULE} from '@/types/visualConfig'
import '@/i18n'
import {ApiKeysCardEditor} from '@/components/config/VisualConfigEditorBlocks'
import {decodeVisualConfigYaml, encodeVisualConfigYaml} from '@/hooks/visualConfigCodec'
import {sourceCallback, sourceInitializer} from './sourceCallbacks'

const editor = readFileSync(new URL('../src/components/config/VisualConfigEditorBlocks.tsx', import.meta.url), 'utf8')
const card = editor.slice(editor.indexOf('export const ApiKeysCardEditor'))
const save = card.slice(card.indexOf('const handleSave ='), card.indexOf('const handleCopy ='))
const remove = card.slice(card.indexOf('const handleDelete ='), card.indexOf('const handleSave ='))
const source = 'api-keys:\n  - client-key-old\n  - unrelated-key\napi-key-aliases:\n  client-key-old: Primary\n  unrelated-key: Unrelated\n'

function keyDraft(nextKey: string | null) {
    const decoded = decodeVisualConfigYaml(source)
    const aliases: Record<string, string> = { 'unrelated-key': 'Unrelated' }
    if (nextKey) {
        aliases[nextKey] = 'Primary'
    }
    return {
        decoded,
        next: {...decoded.values,
            apiKeysText: [nextKey, 'unrelated-key'].filter(Boolean).join('\n'),
            apiKeyAliasesText: JSON.stringify(aliases),
        },
    }
}

function executeKeyAction(action: 'delete' | 'save', keys: string[], nextKey = 'client-key-new', aliasConfigError = '', aliasValue = 'Primary') {
    const decoded = decodeVisualConfigYaml(source)
    let next = {...decoded.values, apiKeysText: keys.join('\n')}
    const errors: string[] = []
    const noop = () => {}
    const context = {
        aliasConfigError,
        apiKeys: keys,
        renderApiKeyIds: keys.map((_, index) => `key-${index}`),
        aliasDocument: parseDocument(decoded.values.apiKeyAliasesText),
        aliases: parse(decoded.values.apiKeyAliasesText),
        setApiKeyIds: noop,
        updateApiKeys: (updated: string[], aliases: string) => {
            next = {...next, apiKeysText: updated.join('\n'), apiKeyAliasesText: aliases}
        },
        modelRules: {}, onModelRulesChange: noop,
        inputValue: nextKey, aliasValue, editingApiKeyId: 'key-0',
        setAliasError: (error: string) => errors.push(error), setFormError: (error: string) => errors.push(error),
        isValidApiKey,
        validateAlias: sourceCallback<(alias: string) => string | null>('components/config/VisualConfigEditorBlocks.tsx',
            'validateAlias', {visualT: (key: string) => key}),
        visualT: (key: string) => key, t: (key: string) => key,
        closeModal: noop, makeClientId: () => 'added-key',
    }
    const code = new Bun.Transpiler({loader: 'tsx'}).transformSync(
        `${action === 'delete' ? remove : save}\nreturn ${action === 'delete' ? 'handleDelete' : 'handleSave'};`,
    )
    const handler = new Function(...Object.keys(context), code)(...Object.values(context)) as (keyId?: string) => void
    handler('key-0')
    return {decoded, next, errors}
}

describe('API key alias editor contracts', () => {
    test('the actual key editor owns one generation through A-B-A transitions', () => {
        let generation = 1
        const scope = {
            React: {createElement}, FieldAnchor: () => null, styles: {subsection: 'fixture'},
            ApiKeysCardEditor, values: decodeVisualConfigYaml(source).values, disabled: false,
            apiClient: {getAuthGeneration: () => generation},
            handleApiKeysTextChange: () => {}, handleApiKeyRulesChange: () => {},
        }
        const keyEditor = () => sourceInitializer<ReactElement<{children: ReactElement<{children: ReactElement}>}>>(
            'components/config/VisualConfigEditor.tsx', 'apiKeysField', scope,
        ).props.children.props.children
        const initial = keyEditor()
        expect(initial.type).toBe(ApiKeysCardEditor)
        expect(initial.key).toBe('1')
        scope.disabled = true
        expect(keyEditor().key).toBe(initial.key)
        generation += 2
        scope.disabled = false
        const replacement = keyEditor()
        expect(replacement.key).toBe('3')
        expect(replacement.key).not.toBe(initial.key)
        expect(replacement.props).toEqual(initial.props)
    })

    test('executes production draft handlers without a name mutation request', () => {
        for (const action of ['delete', 'save'] as const) {
            const {decoded, next, errors} = executeKeyAction(action, ['client-key-old', 'unrelated-key'])
            expect(errors).toEqual([])
            const draft = parse(encodeVisualConfigYaml(source, next, decoded.values, decoded.apiKeysStorage, source))
            expect(draft['api-keys']).toEqual(action === 'delete' ? ['unrelated-key'] : ['client-key-new', 'unrelated-key'])
            expect(draft['api-key-aliases']).toEqual(action === 'delete' ? {'unrelated-key': 'Unrelated'} : {'client-key-new': 'Primary', 'unrelated-key': 'Unrelated'})
            expect(parse(source)['api-key-aliases']['client-key-old']).toBe('Primary')
        }
    })

    test('retains the shared alias character and length contract in the actual validator', () => {
        const validate = sourceCallback<(alias: string) => string | null>('components/config/VisualConfigEditorBlocks.tsx',
            'validateAlias', {visualT: (key: string) => key})
        for (const alias of ['', 'Primary_1', 'Primary-2', 'x'.repeat(20)]) {
            expect(validate(alias)).toBeNull()
        }
        for (const alias of ['two words', '中文名称', '<name>']) {
            expect(validate(alias)).toBe('api_keys.alias_error_format')
        }
        expect(validate('x'.repeat(21))).toBe('api_keys.alias_error_length')
    })

    test('a duplicate shared alias visibly rejects the entire key and alias draft change', () => {
        const {decoded, next, errors} = executeKeyAction('save', ['client-key-old', 'unrelated-key'],
            'client-key-new', '', 'Unrelated')
        expect(errors).toEqual(['api_keys.alias_error_duplicate'])
        expect(next.apiKeysText).toBe(decoded.values.apiKeysText)
        expect(next.apiKeyAliasesText).toBe(decoded.values.apiKeyAliasesText)
    })

    test('trims names and clears a name without removing its API key', () => {
        for (const [aliasValue, expected] of [['  Renamed  ', 'Renamed'], ['  ', undefined]] as const) {
            const {decoded, next, errors} = executeKeyAction('save', ['client-key-old', 'unrelated-key'],
                'client-key-old', '', aliasValue)
            expect(errors).toEqual([])
            const result = parse(encodeVisualConfigYaml(source, next, decoded.values, decoded.apiKeysStorage, source))
            expect(result['api-keys']).toEqual(['client-key-old', 'unrelated-key'])
            expect(result['api-key-aliases']['client-key-old']).toBe(expected)
            expect(result['api-key-aliases']['unrelated-key']).toBe('Unrelated')
            expect(parse(source)['api-key-aliases']['client-key-old']).toBe('Primary')
        }
    })

    test('renders special and identical-mask keys using their exact shared names', () => {
        const value = ['__proto__', 'sk-synthetic-first-0000', 'sk-synthetic-second-0000'].join('\n')
        const html = renderToStaticMarkup(createElement(ApiKeysCardEditor, {
            value, aliasesText: '__proto__: Prototype fixture\nsk-synthetic-first-0000: First fixture\nsk-synthetic-second-0000: Second fixture',
            modelRules: {}, onChange: () => {}, onModelRulesChange: () => {},
        }))
        for (const name of ['Prototype fixture', 'First fixture', 'Second fixture']) {
            expect(html).toContain(name)
        }
        expect(Object.prototype).not.toHaveProperty('Prototype fixture')
    })

    test('round-trips special API key policies without changing object prototypes or losing rules', () => {
        for (const key of ['__proto__', 'constructor', 'toString', 'client-key-old']) {
            const yaml = `api-keys:\n  - ${key}\napi-key-rules:\n  ${key}:\n    providers: [codex]\n`
            const decoded = decodeVisualConfigYaml(yaml)
            expect(Object.keys(decoded.values.apiKeyRules)).toEqual([key])
            expect(decoded.values.apiKeyRules[key]?.providers).toEqual(['codex'])
            const next = {...decoded.values, apiKeyRules: {...decoded.values.apiKeyRules,
                [key]: {...EMPTY_API_KEY_MODEL_RULE, providers: ['xai']}}}
            const result = parse(encodeVisualConfigYaml(yaml, next, decoded.values, decoded.apiKeysStorage, yaml))
            expect(Object.keys(result['api-key-rules'])).toEqual([key])
            expect(result['api-key-rules'][key].providers).toEqual(['xai'])
            expect(decodeVisualConfigYaml(yaml).values.apiKeyRules[key]?.providers).toEqual(['codex'])
            const cleared = parse(encodeVisualConfigYaml(yaml, {...decoded.values, apiKeyRules: {}},
                decoded.values, decoded.apiKeysStorage, yaml))
            expect(cleared['api-key-rules']).toBeUndefined()
            expect(Object.prototype).not.toHaveProperty('providers')
        }
    })

    test('invalid shared-name YAML is visibly rejected rather than treated as an empty name table', () => {
        for (const aliasesText of ['[', '[]', 'client-key-old: 42']) {
            const html = renderToStaticMarkup(createElement(ApiKeysCardEditor, {
                value: 'client-key-old', aliasesText, modelRules: {},
                onChange: () => {}, onModelRulesChange: () => {},
            }))
            expect(html).toContain('role="alert"')
            expect(html).not.toContain('Primary')
        }
    })

    test('production handlers retain an alias still referenced by another entry', () => {
        for (const action of ['delete', 'save'] as const) {
            const {next, errors} = executeKeyAction(action, ['client-key-old', 'client-key-old'])
            expect(errors).toEqual([])
            expect(parse(next.apiKeyAliasesText)['client-key-old']).toBe('Primary')
        }
    })

    test('invalid alias configuration blocks draft mutations and shows a save error', () => {
        for (const action of ['delete', 'save'] as const) {
            const {decoded, next, errors} = executeKeyAction(action, ['client-key-old', 'unrelated-key'], 'client-key-new', 'invalid names')
            expect(next.apiKeysText).toBe(decoded.values.apiKeysText)
            expect(next.apiKeyAliasesText).toBe(decoded.values.apiKeyAliasesText)
            expect(errors).toEqual(action === 'save' ? ['invalid names'] : [])
        }
    })

    test('invalid keys do not change keys or names', () => {
        const {decoded, next, errors} = executeKeyAction('save', ['client-key-old', 'unrelated-key'], 'short')
        expect(next.apiKeysText).toBe(decoded.values.apiKeysText)
        expect(next.apiKeyAliasesText).toBe(decoded.values.apiKeyAliasesText)
        expect(errors).toContain('api_keys.error_too_short')
    })

    test('key edits and deletion only change the configuration draft', () => {
        expect(card).not.toContain('apiKeyAliasApi')
        expect(remove).toContain('updateApiKeys(nextKeys,')
        expect(save).toContain('updateApiKeys(nextKeys,')
        expect(save.indexOf('closeModal()')).toBeGreaterThan(save.indexOf('updateApiKeys(nextKeys,'))
        const parent = readFileSync(new URL('../src/components/config/VisualConfigEditor.tsx', import.meta.url), 'utf8')
        expect(parent).toContain('aliasesText={values.apiKeyAliasesText}')
        expect(parent).toContain('apiKeyAliasesText')
    })

    test('configured names are available without another server request', () => {
        const html = renderToStaticMarkup(createElement(ApiKeysCardEditor, {
            value: 'client-key-old', aliasesText: 'client-key-old: Primary', modelRules: {},
            onChange: () => {}, onModelRulesChange: () => {},
        }))
        expect(html).toContain('Primary')
    })

    for (const nextKey of [null, 'client-key-new']) {
        test(`key ${nextKey ? 'replacement' : 'deletion'} and names are committed in the same YAML`, () => {
            const {decoded, next} = keyDraft(nextKey)
            const result = parse(encodeVisualConfigYaml(source, next, decoded.values, decoded.apiKeysStorage, source))
            expect(result['api-keys']).toEqual([nextKey, 'unrelated-key'].filter(Boolean))
            expect(result['api-key-aliases']).toEqual(nextKey ? {[nextKey]: 'Primary', 'unrelated-key': 'Unrelated'} : {'unrelated-key': 'Unrelated'})
            expect(parse(source)['api-key-aliases']['client-key-old']).toBe('Primary')
        })

        test(`discarding a key ${nextKey ? 'replacement' : 'deletion'} preserves server names`, () => {
            const {decoded} = keyDraft(nextKey)
            const result = parse(encodeVisualConfigYaml(source, decoded.values, decoded.values, decoded.apiKeysStorage, source))
            expect(result['api-keys']).toContain('client-key-old')
            expect(result['api-key-aliases']['client-key-old']).toBe('Primary')
        })
    }

    test('concurrent shared-name changes reject the draft without deleting server names', () => {
        const {decoded, next} = keyDraft(null)
        const changed = source.replace('client-key-old: Primary', 'client-key-old: Renamed')
        expect(() => encodeVisualConfigYaml(changed, next, decoded.values, decoded.apiKeysStorage, source)).toThrow(/api-key-aliases changed on the server/)
        expect(parse(changed)['api-key-aliases']['client-key-old']).toBe('Renamed')
    })

    test('keeps a name when another entry still uses the old key', () => {
        expect(remove).toContain('!nextKeys.includes(deletedKey)')
        expect(save).toContain('!nextKeys.includes(oldKey)')
    })

    test('retains config validation, ETag and visible save failures', () => {
        const page = readFileSync(new URL('../src/pages/ConfigPage.tsx', import.meta.url), 'utf8')
        expect(page).toContain('configFileApi.validateConfigYaml(nextMergedYaml)')
        expect(page).toContain('serverEtag: latestSnapshot.etag')
        expect(page).toContain("t('notification.save_failed')")
        expect(card).toContain('aliasConfigError')
    })

    test('provides duplicate-key feedback in every supported locale', () => {
        for (const locale of ['en', 'ru', 'zh-CN', 'zh-TW']) {
            const messages = JSON.parse(readFileSync(new URL(`../src/i18n/locales/${locale}.json`, import.meta.url), 'utf8'))
            expect(messages.config_management.visual.api_keys.error_duplicate).toBeTruthy()
        }
    })
})
