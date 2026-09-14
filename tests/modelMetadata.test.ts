import {describe, expect, spyOn, test} from 'bun:test'

import {entriesToModels, modelsToEntries, parseThinkingLevelsInput} from '@/components/ui/modelInputListUtils'
import {apiClient} from '@/services/api/client'
import {
    buildClaudeConfigPatchPayload,
    buildCodexConfigPatchRequest,
    buildVertexConfigPatchRequest,
    providersApi,
} from '@/services/api/providers'
import {normalizeProviderKeyConfig} from '@/services/api/transformers'
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
        expect(codex.value.models).toEqual([expected])
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

        expect(request.value.models).toEqual([
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

    test('model discovery preserves existing metadata and appends only model IDs', () => {
        const merged = mergeProviderModelEntries(
            [{ name: 'model-a', alias: 'alias-a', ...MODEL_METADATA }],
            [
                { name: 'model-a', alias: 'discovered-alias' },
                { name: 'model-b', alias: 'discovered-alias' },
            ],
        )

        expect(merged).toEqual({
                                   entries: [
                                       { name: 'model-a', alias: 'alias-a', ...MODEL_METADATA },
                                       { name: 'model-b', alias: '' },
                                   ],
                                   addedCount: 1,
                               })
    })
})
