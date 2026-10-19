import {describe, expect, spyOn, test} from 'bun:test'
import {readFileSync} from 'node:fs'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'

import {ModelInputList, type ModelProvider} from '@/components/ui/ModelInputList'
import {entriesToModels, getModelEntriesValidationKey, modelsToEntries, parseThinkingLevelsInput, updateModelNumericField} from '@/components/ui/modelInputListUtils'
import i18n from '@/i18n'
import {apiClient} from '@/services/api/client'
import {
    buildClaudeConfigPatchPayload,
    buildCodexConfigPatchRequest,
    buildGeminiConfigPatchRequest,
    buildOpenAIProviderPatchRequest,
    buildVertexConfigPatchRequest,
    buildXAIConfigPatchRequest,
    providersApi,
} from '@/services/api/providers'
import {normalizeOpenAIProvider, normalizeProviderKeyConfig} from '@/services/api/transformers'
import {
    normalizeModelEntriesForSignature,
    normalizeModelMetadata,
    normalizeModelMetadataFromManagement,
    serializeModelMetadataForManagement,
} from '@/utils/modelMetadata'
import {findMissingProviderModelNames, mergeProviderModelEntries} from '@/utils/providerModels'

const MODEL_METADATA = {
    maxContextLength: 128000,
    thinking: {
        min: 0,
        max: 0,
        zeroAllowed: false,
        dynamicAllowed: false,
    },
}

describe('provider model metadata', () => {
    test('normalizes management JSON to camelCase and round-trips form entries without losing explicit values', () => {
        const config = normalizeProviderKeyConfig({
                                                      'api-key': 'provider-key',
                                                      models: [
                                                          {
                                                              name: 'model-a',
                                                              'max-context-length': 128000,
                                                              thinking: {
                                                                  min: 0,
                                                                  max: 0,
                                                                  zero_allowed: false,
                                                                  dynamic_allowed: false,
                                                                  levels: [],
                                                              },
                                                          },
                                                      ],
                                                  })

        const models = config?.models ?? []
        expect(models).toEqual([{ name: 'model-a', ...MODEL_METADATA }])
        expect(entriesToModels(modelsToEntries(models))).toEqual(models)
    })

    test('retains provider model capabilities when saving an unrelated provider setting', () => {
        const rawModel = {
            name: 'model-a', alias: 'public-a', 'display-name': 'Public A',
            'force-mapping': true, 'is-compat': true,
            'support-configuration-update': false, 'use-max-completion-tokens': true,
            image: true, 'input-modalities': ['text', 'image'], 'output-modalities': ['text'],
        }
        const original = normalizeProviderKeyConfig({'api-key': 'key', models: [rawModel]})!
        const models = entriesToModels(modelsToEntries(original.models ?? []))
        expect(models).toEqual(original.models ?? [])
        const saved = buildCodexConfigPatchRequest(0, {...original, priority: 2, models}, original)
        expect(saved.value).toHaveProperty('priority', 2)
        expect(saved.value).not.toHaveProperty('models')

        const openAI = normalizeOpenAIProvider({
            name: 'provider', 'base-url': 'https://example.test/v1',
            'api-key-entries': [], models: [rawModel],
        })!
        const openAIModels = entriesToModels(modelsToEntries(openAI.models ?? []))
        const savedOpenAI = buildOpenAIProviderPatchRequest(0, {...openAI, priority: 2, models: openAIModels}, openAI)
        expect(savedOpenAI.value).toHaveProperty('priority', 2)
        expect(savedOpenAI.value).not.toHaveProperty('models')
        expect(normalizeModelEntriesForSignature(modelsToEntries(openAI.models ?? []))[0]).toMatchObject({
            displayName: 'Public A', image: true, inputModalities: ['text', 'image'],
        })
    })

    test('shows only model options supported by each provider backend', () => {
        const render = (provider: ModelProvider) => renderToStaticMarkup(createElement(ModelInputList, {
            entries: [{name: 'upstream-model', alias: 'public-model'}],
            onChange: () => undefined,
            metadataEditing: true,
            provider,
        }))
        const labels = {
            display: i18n.t('ai_providers.model_display_name_label'),
            context: i18n.t('ai_providers.model_max_context_length_label'),
            compat: i18n.t('ai_providers.model_is_compat_label'),
            mapping: i18n.t('ai_providers.model_force_mapping_label'),
            update: i18n.t('ai_providers.model_configuration_update_label'),
            image: i18n.t('ai_providers.model_image_label'),
            input: i18n.t('ai_providers.model_input_modalities_label'),
        }
        for (const provider of ['gemini', 'interactions', 'claude', 'codex', 'xai', 'meta', 'vertex', 'openai'] as const) {
            const markup = render(provider)
            expect(markup).toContain(labels.display)
            expect(markup).toContain(i18n.t('ai_providers.model_thinking_levels_label'))
            expect(markup.includes(labels.context)).toBe(provider !== 'vertex')
            expect(markup.includes(labels.compat)).toBe(provider !== 'vertex')
            expect(markup.includes(labels.mapping)).toBe(['codex', 'xai', 'meta'].includes(provider))
            expect(markup.includes(labels.update)).toBe(provider === 'codex')
            expect(markup.includes(labels.image)).toBe(provider === 'openai')
            expect(markup.includes(labels.input)).toBe(provider === 'openai')
        }
    })

    test('sends edited model capabilities to their backend management endpoints', () => {
        const common = {name: 'upstream-model', alias: 'public-model', displayName: 'Friendly model',
            maxContextLength: 200000, isCompat: true}
        const key = {apiKey: 'key', authIndex: 'test-auth'}
        const gemini = buildGeminiConfigPatchRequest(0, {...key, models: [common]}, key).value
        const codex = buildCodexConfigPatchRequest(0, {...key, models: [{...common,
            forceMapping: true, supportConfigurationUpdate: true}]}, key).value
        const xai = buildXAIConfigPatchRequest(0, {...key, models: [{...common, forceMapping: true}]}, key).value
        const openai = buildOpenAIProviderPatchRequest(0, {
            name: 'test', baseUrl: 'https://example.test', apiKeyEntries: [],
            models: [{...common, image: true, useMaxCompletionTokens: true,
                inputModalities: ['text', 'image'], outputModalities: ['text']}],
        }, {name: 'test', baseUrl: 'https://example.test', apiKeyEntries: []}).value
        const vertex = buildVertexConfigPatchRequest(0, {...key,
            models: [{name: 'upstream-model', alias: 'public-model', displayName: 'Friendly model'}]}, key).value

        const expected = {
            name: 'upstream-model', alias: 'public-model', 'display-name': 'Friendly model',
            'max-context-length': 200000, 'is-compat': true,
        }
        expect(gemini).toHaveProperty('models', [expected])
        expect(codex).toHaveProperty('models', [{...expected, 'force-mapping': true,
            'support-configuration-update': true}])
        expect(xai).toHaveProperty('models', [{...expected, 'force-mapping': true}])
        expect(openai).toHaveProperty('models', [{...expected, image: true,
            'use-max-completion-tokens': true, 'input-modalities': ['text', 'image'],
            'output-modalities': ['text']}])
        expect(vertex).toHaveProperty('models', [{
            name: 'upstream-model', alias: 'public-model', 'display-name': 'Friendly model',
        }])
        const vertexForm = readFileSync(new URL('../src/pages/AiProvidersVertexEditPage.tsx', import.meta.url), 'utf8')
        expect(vertexForm).toContain('...(displayName ? {displayName} : {})')
    })

    test('restores zero-value thinking fields omitted by management JSON', () => {
        expect(normalizeModelMetadataFromManagement({ thinking: {} })).toEqual({
                                                                                   thinking: {
                                                                                       min: 0,
                                                                                       max: 0,
                                                                                       zeroAllowed: false,
                                                                                       dynamicAllowed: false,
                                                                                   },
                                                                               })
        expect(normalizeModelMetadataFromManagement({ name: 'model-a' })).toEqual({})
    })

    test('treats an empty thinking level list as unset', () => {
        expect(normalizeModelMetadata({ thinking: { levels: [] } })).toEqual({})
        expect(normalizeModelMetadata({ thinking: { levels: ['', ' '] } })).toEqual({})
        expect(serializeModelMetadataForManagement({ thinking: { levels: [] } })).toEqual({})
    })

    test('treats empty or non-positive context lengths as unset', () => {
        expect(normalizeModelMetadata({ maxContextLength: '' })).toEqual({})
        expect(normalizeModelMetadata({ maxContextLength: 0 })).toEqual({})
        expect(normalizeModelMetadata({ maxContextLength: -1 })).toEqual({})
        expect(normalizeModelMetadata({ maxContextLength: 1.5 })).toEqual({})
        expect(normalizeModelMetadata({ maxContextLength: true })).toEqual({})
        expect(normalizeModelMetadata({ maxContextLength: [] })).toEqual({})
        expect(normalizeModelMetadata({ maxContextLength: '4096' })).toEqual({ maxContextLength: 4096 })
    })

    test('preserves invalid numeric edits and refuses to serialize them as cleared model fields', () => {
        const original = {name: 'model-a', alias: '', maxContextLength: 4096, thinking: {min: 0, max: 128}}
        for (const raw of ['0', '-1', '1.5', '1e3', '9007199254740992', 'abc']) {
            const entry = updateModelNumericField(original, 'maxContextLength', raw)
            expect(entry.maxContextLength).toBe(4096)
            expect(entry.maxContextLengthDraft).toBe(raw)
            expect(getModelEntriesValidationKey([entry])).toBe('ai_providers.model_context_invalid')
            expect(() => entriesToModels([entry])).toThrow('ai_providers.model_context_invalid')
            expect(normalizeModelEntriesForSignature([entry])).not.toEqual(normalizeModelEntriesForSignature([original]))
        }
        const invalidMin = updateModelNumericField(original, 'min', '-3')
        const invalidMax = updateModelNumericField(original, 'max', '1.5')
        expect(invalidMin.thinking?.min).toBe(0)
        expect(invalidMax.thinking?.max).toBe(128)
        expect(getModelEntriesValidationKey([invalidMin])).toBe('ai_providers.model_thinking_budget_invalid')
        expect(getModelEntriesValidationKey([invalidMax])).toBe('ai_providers.model_thinking_budget_invalid')
        expect(() => entriesToModels([invalidMin])).toThrow('ai_providers.model_thinking_budget_invalid')
    })

    test('accepts corrected numeric drafts and intentional clearing while rejecting reversed thinking limits', () => {
        const original = {name: 'model-a', alias: '', maxContextLength: 4096, thinking: {min: 0, max: 128}}
        const corrected = updateModelNumericField(updateModelNumericField(original, 'maxContextLength', 'bad'),
            'maxContextLength', '8192')
        expect(corrected.maxContextLengthDraft).toBeUndefined()
        expect(entriesToModels([corrected])[0].maxContextLength).toBe(8192)
        const cleared = updateModelNumericField(updateModelNumericField(original, 'min', 'bad'), 'min', '')
        expect(cleared.thinkingMinDraft).toBeUndefined()
        expect(entriesToModels([cleared])[0].thinking).toEqual({max: 128})
        const reversed = updateModelNumericField(original, 'min', '256')
        expect(getModelEntriesValidationKey([reversed])).toBe('ai_providers.model_thinking_budget_range')
        expect(() => entriesToModels([reversed])).toThrow('ai_providers.model_thinking_budget_range')
        expect(entriesToModels([updateModelNumericField(reversed, 'max', '512')])[0].thinking).toEqual({min: 256, max: 512})
    })

    test('preserves a backend thinking range on unrelated edits, then validates changed bounds', () => {
        const loaded = modelsToEntries([{name: 'model-a', thinking: {min: 20, max: 0}}])[0]
        expect(getModelEntriesValidationKey([loaded])).toBeUndefined()
        expect(entriesToModels([{...loaded, alias: 'public-model'}])).toEqual([
            {name: 'model-a', alias: 'public-model', thinking: {min: 20, max: 0}},
        ])
        expect(getModelEntriesValidationKey([updateModelNumericField(loaded, 'min', '20')]))
            .toBe('ai_providers.model_thinking_budget_range')
        const corrected = updateModelNumericField(loaded, 'max', '20')
        expect(entriesToModels([corrected])[0].thinking).toEqual({min: 20, max: 20})
    })

    test('shows invalid drafts and translated inline errors in model metadata fields', () => {
        const markup = renderToStaticMarkup(createElement(ModelInputList, {
            entries: [updateModelNumericField({name: 'model-a', alias: '', maxContextLength: 4096},
                'maxContextLength', 'not-a-number')],
            onChange: () => undefined,
            metadataEditing: true,
            provider: 'codex',
        }))
        expect(markup).toContain('value="not-a-number"')
        expect(markup).toContain('aria-invalid="true"')
        expect(markup).toContain(`role="alert">${i18n.t('ai_providers.model_context_invalid')}`)
    })

    test('keeps a trailing level separator editable while normalizing the saved metadata', () => {
        const levels = parseThinkingLevelsInput('low,')
        expect(levels).toEqual(['low', ''])
        expect(normalizeModelMetadata({ thinking: { levels } })).toEqual({
                                                                             thinking: { levels: ['low'] },
                                                                         })
    })

    test('serializes management mutations with backend JSON field names', () => {
        const model  = { name: 'model-a', ...MODEL_METADATA }
        const codex  = buildCodexConfigPatchRequest(
            0,
            { apiKey: 'key', models: [model] },
            { apiKey: 'key', authIndex: 'codex-auth' },
        )
        const claude = buildClaudeConfigPatchPayload(
            { apiKey: 'key', models: [model] },
            { apiKey: 'key' },
        )

        const expected = {
            name: 'model-a',
            'max-context-length': 128000,
            thinking: {
                min: 0,
                max: 0,
                zero_allowed: false,
                dynamic_allowed: false,
            },
        }
        expect(codex.value).toHaveProperty('models', [expected])
        expect(claude.models).toEqual([{ ...expected, alias: 'model-a' }])
    })

    test('uses the same metadata serializer for provider POST requests', async () => {
        const model = { name: 'model-a', ...MODEL_METADATA }
        const post  = spyOn(apiClient, 'post').mockResolvedValue({ status: 'ok' })
        try {
            await providersApi.createClaudeConfig({ apiKey: 'claude-key', models: [model] })
            await providersApi.createCodexConfig({ apiKey: 'codex-key', models: [model] })
            await providersApi.createGeminiKey({ apiKey: 'gemini-key', models: [model] })
            await providersApi.createInteractionsKey({ apiKey: 'interactions-key', models: [model] })
            await providersApi.createOpenAIProvider({
                                                        name: 'openai',
                                                        baseUrl: 'https://example.com',
                                                        apiKeyEntries: [],
                                                        models: [model],
                                                    })

            const expectedMetadata = {
                'max-context-length': 128000,
                thinking: {
                    min: 0,
                    max: 0,
                    zero_allowed: false,
                    dynamic_allowed: false,
                },
            }
            expect(post).toHaveBeenNthCalledWith(
                1,
                '/claude-api-key',
                expect.objectContaining({ models: [{ name: 'model-a', ...expectedMetadata }] }),
            )
            expect(post).toHaveBeenNthCalledWith(
                2,
                '/codex-api-key',
                expect.objectContaining({ models: [{ name: 'model-a', ...expectedMetadata }] }),
            )
            expect(post).toHaveBeenNthCalledWith(
                3,
                '/gemini-api-key',
                expect.objectContaining({ models: [{ name: 'model-a', ...expectedMetadata }] }),
            )
            expect(post).toHaveBeenNthCalledWith(
                4,
                '/interactions-api-key',
                expect.objectContaining({ models: [{ name: 'model-a', ...expectedMetadata }] }),
            )
            expect(post).toHaveBeenNthCalledWith(
                5,
                '/openai-compatibility',
                expect.objectContaining({ models: [{ name: 'model-a', ...expectedMetadata }] }),
            )
        } finally {
            post.mockRestore()
        }
    })

    test('keeps Vertex thinking metadata but never sends max-context-length', () => {
        const request = buildVertexConfigPatchRequest(
            0,
            { apiKey: 'key', models: [{ name: 'model-a', alias: 'alias-a', ...MODEL_METADATA }] },
            { apiKey: 'key', authIndex: 'vertex-auth' },
        )

        expect(request.value).toHaveProperty('models', [
                                                 {
                                                     name: 'model-a',
                                                     alias: 'alias-a',
                                                     thinking: {
                                                         min: 0,
                                                         max: 0,
                                                         zero_allowed: false,
                                                         dynamic_allowed: false,
                                                     },
                                                 },
                                             ])
    })

    test('includes metadata in dirty signatures and ignores entries that cannot be saved', () => {
        expect(normalizeModelEntriesForSignature([{ name: 'model-a', alias: '', ...MODEL_METADATA }])).toEqual([
                                                                                                                   {
                                                                                                                       name: 'model-a',
                                                                                                                       alias: '',
                                                                                                                       ...MODEL_METADATA,
                                                                                                                   },
                                                                                                               ])
        expect(normalizeModelEntriesForSignature([
                                                     {
                                                         name: '',
                                                         alias: 'orphan-alias',
                                                         ...MODEL_METADATA,
                                                     },
                                                 ])).toEqual([])
    })

    test('model discovery selects only missing model IDs by default', () => {
        const missing = findMissingProviderModelNames(
            [{ name: 'models/model-a', alias: '' }, { name: 'model-b', alias: '' }],
            [
                { name: 'model-a' },
                { name: 'MODEL-B' },
                { name: 'models/model-c' },
                { name: 'models/model-c' },
                { name: 'model-d' },
            ],
            (name) => name.replace(/^models\//, '').trim(),
        )

        expect([...missing]).toEqual(['models/model-c', 'model-d'])
    })

    test('model discovery preserves existing metadata and retains aliases for new models', () => {
        const merged = mergeProviderModelEntries(
            [{ name: 'model-a', alias: 'alias-a', ...MODEL_METADATA }],
            [
                { name: 'model-a', alias: 'discovered-alias' },
                { name: 'model-b', alias: ' discovered-alias ' },
            ],
        )

        expect(merged).toEqual({
                                   entries: [
                                       { name: 'model-a', alias: 'alias-a', ...MODEL_METADATA },
                                       { name: 'model-b', alias: 'discovered-alias' },
                                   ],
                                   addedCount: 1,
                               })
    })

    test('model discovery preserves every advanced-only and invalid numeric draft row', () => {
        const drafts = [
            {displayName: 'Draft'}, {forceMapping: false}, {isCompat: false},
            {supportConfigurationUpdate: false}, {useMaxCompletionTokens: false}, {image: false},
            {inputModalities: []}, {outputModalities: []}, {priority: 0},
            {maxContextLengthDraft: 'bad'}, {thinkingMinDraft: '-1'}, {thinkingMaxDraft: '1e3'},
        ]
        for (const draft of drafts) {
            const entry = {name: '', alias: '', ...draft}
            const configured = [entry, {name: '', alias: ''}]
            const merged = mergeProviderModelEntries(configured, [{name: 'model-a'}])
            expect(merged).toEqual({entries: [entry, {name: 'model-a', alias: ''}], addedCount: 1})
            expect(merged.entries[0]).toBe(entry)
            expect(configured).toEqual([entry, {name: '', alias: ''}])
        }
    })

    test('model discovery keeps configured duplicate rows and unfinished edits', () => {
        const configured = [
            { name: ' Model-A ', alias: 'alias-one', maxContextLength: 64000 },
            { name: 'model-a', alias: 'alias-two', ...MODEL_METADATA },
            { name: '', alias: 'unfinished-alias' },
            { name: '', alias: '', maxContextLength: 4096 },
            { name: '', alias: '' },
        ]
        const merged = mergeProviderModelEntries(
            configured,
            [
                { name: 'model-a' },
                { name: 'MODEL-A' },
                { name: 'models/model-b' },
                { name: 'models/model-b' },
            ],
            (name) => name.replace(/^models\//, '').trim(),
        )

        expect(merged).toEqual({
            entries: [...configured.slice(0, 4), { name: 'model-b', alias: '' }],
            addedCount: 1,
        })
        expect(configured).toHaveLength(5)
    })
})
