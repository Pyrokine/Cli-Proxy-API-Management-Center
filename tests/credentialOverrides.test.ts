import {describe, expect, spyOn, test} from 'bun:test'
import {readFileSync} from 'node:fs'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import ts from 'typescript'
import {RequestScopedErrorsField} from '@/components/providers/CredentialOverrideFields'
import '@/i18n'
import {apiClient} from '@/services/api/client'
import {
    buildClaudeConfigPatchRequest,
    buildCodexConfigPatchRequest,
    buildGeminiConfigPatchRequest,
    buildOpenAIProviderPatchRequest,
    buildVertexConfigPatchRequest,
    buildXAIConfigPatchRequest,
    providersApi,
} from '@/services/api/providers'
import {
    normalizeGeminiKeyConfig,
    normalizeOpenAIProvider,
    normalizeProviderKeyConfig,
} from '@/services/api/transformers'
import {getRequestScopedErrorsValidationKey, updateRequestScopedErrorRule} from '@/utils/credentialOverrides'
import {sourceInitializer} from './sourceCallbacks'

const base = {
    apiKey: 'synthetic-key',
    authIndex: 'synthetic-auth',
    name: 'example',
    baseUrl: 'https://example.test',
    apiKeyEntries: [],
}

const providers = [
    ['claude', buildClaudeConfigPatchRequest, normalizeProviderKeyConfig, providersApi.createClaudeConfig],
    ['codex', buildCodexConfigPatchRequest, normalizeProviderKeyConfig, providersApi.createCodexConfig],
    ['xai', buildXAIConfigPatchRequest, normalizeProviderKeyConfig, providersApi.createXAIConfig],
    ['gemini', buildGeminiConfigPatchRequest, normalizeGeminiKeyConfig, providersApi.createGeminiKey],
    ['interactions', buildGeminiConfigPatchRequest, normalizeGeminiKeyConfig, providersApi.createInteractionsKey],
    ['vertex', buildVertexConfigPatchRequest, normalizeProviderKeyConfig, providersApi.createVertexConfig],
    ['openai', buildOpenAIProviderPatchRequest, normalizeOpenAIProvider, providersApi.createOpenAIProvider],
] as const

describe('credential cooling and retry overrides', () => {
    for (const [name, patch, normalize, create] of providers) {
        test(`${name} reads false, zero and negative values without materializing defaults`, () => {
            for (const [cooling, retry] of [[false, 0], [true, -1], [false, 2]] as const) {
                expect(normalize({
                    'api-key': base.apiKey,
                    name: base.name,
                    'base-url': base.baseUrl,
                    'disable-cooling': cooling,
                    'request-retry': retry,
                })).toMatchObject({disableCooling: cooling, requestRetry: retry})
            }
            const inherited = normalize({'api-key': base.apiKey, name: base.name, 'base-url': base.baseUrl})
            expect(inherited).not.toHaveProperty('disableCooling')
            expect(inherited).not.toHaveProperty('requestRetry')
        })

        test(`${name} PATCH distinguishes unchanged, explicit values and clearing`, () => {
            const original = {...base, disableCooling: true, requestRetry: 2}
            const explicit = patch(0, {...base, disableCooling: false, requestRetry: 0}, original).value
            expect(explicit).toMatchObject({'disable-cooling': false, 'request-retry': 0})
            const cleared = patch(0, {...base, disableCooling: undefined, requestRetry: undefined}, original).value
            expect(cleared).toMatchObject({'disable-cooling': null, 'request-retry': null})
            const unchanged = patch(0, {...original, prefix: 'changed'}, original).value
            expect(unchanged).not.toHaveProperty('disable-cooling')
            expect(unchanged).not.toHaveProperty('request-retry')
        })

        test(`${name} rejects invalid wire types and unsafe retry writes`, () => {
            const wire = {'api-key': base.apiKey, name: base.name, 'base-url': base.baseUrl}
            for (const value of ['false', 0, 1, [], {}]) {
                expect(() => normalize({...wire, 'disable-cooling': value})).toThrow()
            }
            for (const value of ['2', 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
                expect(() => normalize({...wire, 'request-retry': value})).toThrow()
                expect(() => patch(0, {...base, requestRetry: value as number}, base)).toThrow()
            }
            const inherited = normalize({...wire, 'disable-cooling': null, 'request-retry': null})
            expect(inherited).not.toHaveProperty('disableCooling')
            expect(inherited).not.toHaveProperty('requestRetry')
            for (const value of [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]) {
                expect(normalize({...wire, 'request-retry': value})).toHaveProperty('requestRetry', value)
            }
        })

        test(`${name} POST retains explicit false and zero`, async () => {
            const post = spyOn(apiClient, 'post').mockResolvedValue({})
            try {
                await create({...base, disableCooling: false, requestRetry: 0})
                expect(post.mock.calls[0]?.[1]).toMatchObject({'disable-cooling': false, 'request-retry': 0})
            } finally {
                post.mockRestore()
            }
        })
    }
})

describe('provider request-scoped error rules', () => {
    const rules = [{status: 429, match: ['limit'], matchRegex: ['^rate limit$'], action: 'continue-and-cooldown'}]
    const wire = [{status: 429, match: ['limit'], 'match-regexr': ['^rate limit$'], action: 'continue-and-cooldown'}]

    for (const [name, patch, normalize, create] of providers) {
        test(`${name} retains the rule contract on GET, POST, PATCH and clearing`, async () => {
            const input = {'api-key': base.apiKey, name: base.name, 'base-url': base.baseUrl,
                'request-scoped-errors': wire}
            const normalized = normalize(input)!
            expect(normalized.requestScopedErrors).toEqual(rules)
            const original = {...base, requestScopedErrors: rules}
            const value = patch(0, {...base, requestScopedErrors: []}, original).value
            const post = spyOn(apiClient, 'post').mockResolvedValue({})
            try {
                await create(original)
                if (name === 'vertex') {
                    expect(value).not.toHaveProperty('request-scoped-errors')
                    expect(post.mock.calls[0]?.[1]).not.toHaveProperty('request-scoped-errors')
                } else {
                    expect(value).toHaveProperty('request-scoped-errors', [])
                    expect(post.mock.calls[0]?.[1]).toHaveProperty('request-scoped-errors', wire)
                }
            } finally {
                post.mockRestore()
            }
        })
    }

    test('rejects malformed wire rules and new incomplete rules while preserving untouched legacy rules', () => {
        expect(() => normalizeProviderKeyConfig({'api-key': base.apiKey,
            'request-scoped-errors': [{status: 429, 'match-regexr': 'bad'}]})).toThrow()
        expect(getRequestScopedErrorsValidationKey([{status: 0, action: 'stop', match: ['limit']}]))
            .toBe('ai_providers.error_rules_invalid_status')
        expect(getRequestScopedErrorsValidationKey([{status: 429, action: 'stop', match: ['']}]))
            .toBe('ai_providers.error_rules_invalid_match')
        const legacy = {status: 0, action: 'legacy', match: ['']}
        expect(getRequestScopedErrorsValidationKey([legacy, rules[0]], [legacy])).toBeUndefined()
        const imported = {status: 429, action: 'stop', match: ['', 'limit'], matchRegex: ['']}
        const changed = {...imported, status: 500}
        expect(getRequestScopedErrorsValidationKey([changed], [imported])).toBeUndefined()
        expect(getRequestScopedErrorsValidationKey([{...changed, match: ['', '']}], [imported]))
            .toBe('ai_providers.error_rules_invalid_match')
        expect(getRequestScopedErrorsValidationKey([{...changed, match: ['', 'limit', '']}], [imported]))
            .toBe('ai_providers.error_rules_invalid_match')
        expect(getRequestScopedErrorsValidationKey([{...changed, matchRegex: ['', '']}], [imported]))
            .toBe('ai_providers.error_rules_invalid_match')
    })

    test('preserves existing empty-only conditions when editing another rule field', () => {
        for (const conditions of [{match: ['']}, {matchRegex: ['']}, {match: [''], matchRegex: ['']}]) {
            const imported = {status: 429, action: 'continue', ...conditions}
            const original = normalizeProviderKeyConfig({'api-key': base.apiKey,
                'request-scoped-errors': [{status: 429, action: 'continue', match: imported.match,
                    'match-regexr': imported.matchRegex}]})!.requestScopedErrors!
            const changed = updateRequestScopedErrorRule(original[0], {status: 503})
            expect(getRequestScopedErrorsValidationKey([changed], original)).toBeUndefined()
            expect(getRequestScopedErrorsValidationKey([{...imported, status: 503}], [imported])).toBeUndefined()
            expect(buildXAIConfigPatchRequest(0, {...base, requestScopedErrors: [changed]},
                {...base, requestScopedErrors: original}).value).toHaveProperty('request-scoped-errors', [
                {status: 503, action: 'continue', match: original[0].match, 'match-regexr': original[0].matchRegex},
            ])
            expect(getRequestScopedErrorsValidationKey([imported])).toBe('ai_providers.error_rules_invalid_match')
            const appended = updateRequestScopedErrorRule(changed, {match: [...(changed.match ?? []), '']})
            expect(getRequestScopedErrorsValidationKey([appended], original)).toBe('ai_providers.error_rules_invalid_match')
        }
    })

    test('accepts backend-recognized action spellings without rewriting imported rules', () => {
        for (const action of [' STOP ', ' Continue ', 'STOP-AND-COOLDOWN', ' Continue-And-Cooldown ']) {
            const original = normalizeProviderKeyConfig({'api-key': base.apiKey,
                'request-scoped-errors': [{status: 429, action, match: ['quota']}]})!.requestScopedErrors!
            const changed = updateRequestScopedErrorRule(original[0], {status: 503})
            expect(getRequestScopedErrorsValidationKey([changed], original)).toBeUndefined()
            expect(buildXAIConfigPatchRequest(0, {...base, requestScopedErrors: [changed]},
                {...base, requestScopedErrors: original}).value)
                .toHaveProperty('request-scoped-errors', [{status: 503, action, match: ['quota']}])
        }
        expect(getRequestScopedErrorsValidationKey([{status: 503, action: ' UNKNOWN ', match: ['quota']}]))
            .toBe('ai_providers.error_rules_invalid_action')
    })

    test('preserves loaded rule and condition identities after reorder, deletion and edits', () => {
        const original = normalizeProviderKeyConfig({'api-key': base.apiKey,
            'request-scoped-errors': [
                {status: 401, action: 'stop', match: ['auth']},
                {status: 429, action: 'continue', match: ['', 'limit'], 'match-regexr': ['']},
            ]})!.requestScopedErrors!
        const reordered = [original[1], original[0]]
        let current = reordered
        const update = sourceInitializer<(index: number, patch: Partial<typeof original[0]>, indices?: number[]) => void>(
            'components/providers/CredentialOverrideFields.tsx', 'update', {
                current, onChange: (rules: typeof original) => { current = rules }, updateRequestScopedErrorRule,
            })
        update(0, {status: 503, action: 'stop'})
        expect(getRequestScopedErrorsValidationKey(current, original)).toBeUndefined()
        expect(getRequestScopedErrorsValidationKey([current[0]], original)).toBeUndefined()
        expect(getRequestScopedErrorsValidationKey([current[0]])).toBeUndefined()
        expect(buildXAIConfigPatchRequest(0, {...base, requestScopedErrors: current}, {...base, requestScopedErrors: original}).value)
            .toHaveProperty('request-scoped-errors', [
                {status: 503, action: 'stop', match: ['', 'limit'], 'match-regexr': ['']},
                {status: 401, action: 'stop', match: ['auth']},
            ])
        const appended = updateRequestScopedErrorRule(current[0], {match: ['', 'limit', '']})
        expect(getRequestScopedErrorsValidationKey([appended], original))
            .toBe('ai_providers.error_rules_invalid_match')
        const addedRule = updateRequestScopedErrorRule({status: 429, action: 'continue', match: ['']},
            {status: 503, match: ['', 'limit']})
        expect(getRequestScopedErrorsValidationKey([addedRule], original))
            .toBe('ai_providers.error_rules_invalid_match')
        const unrelated = normalizeProviderKeyConfig({'api-key': 'another-key',
            'request-scoped-errors': [{status: 401, action: 'stop', match: ['auth']}]})!.requestScopedErrors
        expect(getRequestScopedErrorsValidationKey([current[0]], unrelated))
            .toBe('ai_providers.error_rules_invalid_match')
    })

    test('preserves only surviving original empty conditions when another condition is deleted', () => {
        const original = normalizeProviderKeyConfig({'api-key': base.apiKey,
            'request-scoped-errors': [{status: 429, action: 'continue', match: ['removed', '', 'limit']}]})!.requestScopedErrors!
        const deleted = updateRequestScopedErrorRule(original[0], {match: ['', 'limit']}, [1, 2])
        const edited = updateRequestScopedErrorRule(deleted, {status: 503})
        expect(getRequestScopedErrorsValidationKey([edited], original)).toBeUndefined()
        expect(getRequestScopedErrorsValidationKey([
            updateRequestScopedErrorRule(edited, {match: ['', 'limit', '']}),
        ], original)).toBe('ai_providers.error_rules_invalid_match')
        const noOriginalEmpty = updateRequestScopedErrorRule(original[0], {match: ['removed', 'limit']}, [0, 2])
        expect(getRequestScopedErrorsValidationKey([
            updateRequestScopedErrorRule(noOriginalEmpty, {match: ['', 'limit']}),
        ], original)).toBe('ai_providers.error_rules_invalid_match')
    })

    test('validates raw status input before numeric conversion in the actual rule editor', () => {
        const source = readFileSync(new URL('../src/components/providers/CredentialOverrideFields.tsx', import.meta.url), 'utf8')
        const tree = ts.createSourceFile('field.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
        let callback: ts.Expression | undefined
        const visit = (node: ts.Node) => {
            if (ts.isJsxAttribute(node) && node.name.getText(tree) === 'onChange' &&
                node.parent.properties.some((attribute) => ts.isJsxAttribute(attribute) &&
                    attribute.name.getText(tree) === 'id' && attribute.initializer?.getText(tree) === '{statusId}') &&
                node.initializer && ts.isJsxExpression(node.initializer)) {
                callback = node.initializer.expression
            }
            ts.forEachChild(node, visit)
        }
        visit(tree)
        if (!callback) {
            throw new Error('Missing rule status input callback')
        }
        let patch: {status: number} = {status: 429}
        const update = (_index: number, value: {status: number}) => { patch = value }
        const code = new Bun.Transpiler({loader: 'tsx'}).transformSync(`const handler = ${callback.getText(tree)}`)
        const onChange = new Function('update', 'index', `${code}; return handler`)(update, 0) as
            (event: {target: {value: string; validity: {badInput: boolean}}}) => void
        const rule = {status: 429, match: ['quota'], action: 'stop'}
        for (const raw of ['', '1e3', '+429', '1.5', '-1', '0', '9007199254740992']) {
            onChange({target: {value: raw, validity: {badInput: false}}})
            expect(getRequestScopedErrorsValidationKey([{...rule, ...patch}])).toBe('ai_providers.error_rules_invalid_status')
        }
        onChange({target: {value: '429', validity: {badInput: true}}})
        expect(getRequestScopedErrorsValidationKey([{...rule, ...patch}])).toBe('ai_providers.error_rules_invalid_status')
        for (const raw of ['429', ' 503 ', '999']) {
            onChange({target: {value: raw, validity: {badInput: false}}})
            expect(patch.status).toBe(Number(raw))
            expect(getRequestScopedErrorsValidationKey([{...rule, ...patch}])).toBeUndefined()
        }
    })

    test('preserves line breaks inside individual match and regex conditions', () => {
        const multiline = [{status: 429, action: 'stop', match: ['first\nsecond', 'third'],
            matchRegex: ['^line1\nline2$']}]
        const normalized = normalizeProviderKeyConfig({'api-key': base.apiKey,
            'request-scoped-errors': [{status: 429, action: 'stop', match: multiline[0].match,
                'match-regexr': multiline[0].matchRegex}]})!
        expect(normalized.requestScopedErrors).toEqual(multiline)
        expect(getRequestScopedErrorsValidationKey(multiline)).toBeUndefined()
        expect(buildXAIConfigPatchRequest(0, {...base, requestScopedErrors: multiline}, base).value)
            .toHaveProperty('request-scoped-errors', [{status: 429, action: 'stop',
                match: ['first\nsecond', 'third'], 'match-regexr': ['^line1\nline2$']}])
        const editor = readFileSync(new URL('../src/components/providers/CredentialOverrideFields.tsx', import.meta.url), 'utf8')
        expect(editor).toContain('value={value}')
        const markup = renderToStaticMarkup(createElement(RequestScopedErrorsField, {
            rules: multiline,
            onChange: () => {},
            disabled: false,
        }))
        expect(markup).toContain('first\nsecond</textarea>')
        expect(markup).toContain('third</textarea>')
        expect(markup).toContain('^line1\nline2$</textarea>')
        expect(editor).not.toContain("split('\\n')")
        expect(editor).not.toContain("join('\\n')")
    })

    test('all supported edit forms consume the rule field, while Vertex hides it', () => {
        const shared = readFileSync(new URL('../src/pages/ProviderFormFields.tsx', import.meta.url), 'utf8')
        expect(shared).toContain('<RequestScopedErrorsField')
        for (const name of ['Gemini', 'Interactions', 'Codex', 'XAI', 'Meta']) {
            const page = readFileSync(new URL(`../src/pages/AiProviders${name}EditPage.tsx`, import.meta.url), 'utf8')
            expect(page).toContain('requestScopedErrors: form.requestScopedErrors')
            expect(page).toContain('getRequestScopedErrorsValidationKey(')
        }
        for (const name of ['Claude', 'OpenAI']) {
            const layout = readFileSync(new URL(`../src/pages/AiProviders${name}EditLayout.tsx`, import.meta.url), 'utf8')
            const page = readFileSync(new URL(`../src/pages/AiProviders${name}EditPage.tsx`, import.meta.url), 'utf8')
            expect(layout).toContain('requestScopedErrors: form.requestScopedErrors')
            expect(layout).toContain('getRequestScopedErrorsValidationKey(')
            expect(page).toContain('<RequestScopedErrorsField')
        }
        const vertex = readFileSync(new URL('../src/pages/AiProvidersVertexEditPage.tsx', import.meta.url), 'utf8')
        expect(vertex).toContain('supportsErrorRules={false}')
        for (const locale of ['en', 'ru', 'zh-CN', 'zh-TW']) {
            const strings = JSON.parse(readFileSync(new URL(`../src/i18n/locales/${locale}.json`, import.meta.url), 'utf8'))
                .ai_providers
            expect(strings.error_rules_title).toBeTruthy()
            expect(strings.error_rules_invalid_status).toBeTruthy()
        }
    })

    test('Meta accepts rules while Vertex never receives them', async () => {
        const original = {...base, requestScopedErrors: rules}
        const get = spyOn(providersApi, 'getMetaConfigs').mockResolvedValue([original])
        const post = spyOn(apiClient, 'post').mockResolvedValue({})
        const patch = spyOn(apiClient, 'patch').mockResolvedValue({})
        try {
            await providersApi.createMetaConfig(original)
            await providersApi.patchMetaConfig(0, {...original, requestScopedErrors: []}, original)
            expect(post.mock.calls[0]?.[1]).toHaveProperty('request-scoped-errors', wire)
            expect((patch.mock.calls[0]?.[1] as {value: object}).value)
                .toHaveProperty('request-scoped-errors', [])
        } finally {
            get.mockRestore()
            post.mockRestore()
            patch.mockRestore()
        }
    })
})

describe('provider-specific request behavior', () => {
    test('Codex Alpha Search reads, edits, and sends the supported per-key field', async () => {
        const original = normalizeProviderKeyConfig({'api-key': 'synthetic', 'alpha-search': true})!
        expect(original.alphaSearch).toBe(true)
        expect(buildCodexConfigPatchRequest(0, {...original, alphaSearch: false}, original).value)
            .toHaveProperty('alpha-search', false)
        const post = spyOn(apiClient, 'post').mockResolvedValue({})
        try {
            await providersApi.createCodexConfig({...original, alphaSearch: true})
            expect(post.mock.calls[0]?.[1]).toHaveProperty('alpha-search', true)
        } finally {
            post.mockRestore()
        }
        const page = readFileSync(new URL('../src/pages/AiProvidersCodexEditPage.tsx', import.meta.url), 'utf8')
        expect(page).toContain('alphaSearch: Boolean(form.alphaSearch)')
        expect(page).toContain('checked={Boolean(form.alphaSearch)}')
    })

    test('Codex Alpha Search does not leak to other provider PATCH requests', async () => {
        const config = {...base, alphaSearch: true}
        expect(buildXAIConfigPatchRequest(0, config, base).value).not.toHaveProperty('alpha-search')
        expect(buildVertexConfigPatchRequest(0, config, base).value).not.toHaveProperty('alpha-search')
        const get = spyOn(providersApi, 'getMetaConfigs').mockResolvedValue([base])
        const patch = spyOn(apiClient, 'patch').mockResolvedValue({})
        try {
            await providersApi.patchMetaConfig(0, config, base)
            expect(patch.mock.calls[0]?.[1]).toHaveProperty('value')
            expect((patch.mock.calls[0]?.[1] as {value: object}).value).not.toHaveProperty('alpha-search')
        } finally {
            get.mockRestore()
            patch.mockRestore()
        }
    })

    test('Claude rebuilds system messages only when explicitly enabled', async () => {
        const original = normalizeProviderKeyConfig({
            'api-key': 'synthetic', 'auth-index': 'claude-auth', 'rebuild-mid-system-message': true,
        })!
        expect(original.rebuildMidSystemMessage).toBe(true)
        expect(buildClaudeConfigPatchRequest(0, {...original, rebuildMidSystemMessage: false}, original).value)
            .toHaveProperty('rebuild-mid-system-message', false)
        const post = spyOn(apiClient, 'post').mockResolvedValue({})
        try {
            await providersApi.createClaudeConfig({...original, rebuildMidSystemMessage: true})
            expect(post.mock.calls[0]?.[1]).toHaveProperty('rebuild-mid-system-message', true)
        } finally {
            post.mockRestore()
        }
        const layout = readFileSync(new URL('../src/pages/AiProvidersClaudeEditLayout.tsx', import.meta.url), 'utf8')
        const page = readFileSync(new URL('../src/pages/AiProvidersClaudeEditPage.tsx', import.meta.url), 'utf8')
        expect(layout).toContain('rebuildMidSystemMessage: Boolean(form.rebuildMidSystemMessage)')
        expect(page).toContain('checked={Boolean(form.rebuildMidSystemMessage)}')
    })

    test('OpenAI prompt cache key survives provider edits and sends the fork field', async () => {
        const original = normalizeOpenAIProvider({name: 'example', 'base-url': 'https://example.test',
            'support-prompt-cache-key': true})!
        expect(original.supportPromptCacheKey).toBe(true)
        expect(buildOpenAIProviderPatchRequest(0, {...original, supportPromptCacheKey: false}, original).value)
            .toHaveProperty('support-prompt-cache-key', false)
        const post = spyOn(apiClient, 'post').mockResolvedValue({})
        try {
            await providersApi.createOpenAIProvider({...original, supportPromptCacheKey: true})
            expect(post.mock.calls[0]?.[1]).toHaveProperty('support-prompt-cache-key', true)
        } finally {
            post.mockRestore()
        }
        const layout = readFileSync(new URL('../src/pages/AiProvidersOpenAIEditLayout.tsx', import.meta.url), 'utf8')
        const page = readFileSync(new URL('../src/pages/AiProvidersOpenAIEditPage.tsx', import.meta.url), 'utf8')
        expect(layout).toContain('supportPromptCacheKey: Boolean(form.supportPromptCacheKey)')
        expect(page).toContain('checked={Boolean(form.supportPromptCacheKey)}')
    })

    test('labels all supported behavior switches in the four shipped languages', () => {
        for (const locale of ['en', 'ru', 'zh-CN', 'zh-TW']) {
            const strings = JSON.parse(readFileSync(new URL(`../src/i18n/locales/${locale}.json`, import.meta.url), 'utf8'))
                .ai_providers
            for (const key of ['codex_alpha_search', 'claude_rebuild_system_messages', 'openai_prompt_cache_key']) {
                expect(strings[`${key}_label`]).toBeTruthy()
                expect(strings[`${key}_hint`]).toBeTruthy()
            }
        }
    })
})
