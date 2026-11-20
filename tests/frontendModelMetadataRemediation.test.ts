import {
    entriesToModels,
    type ModelEntry,
    modelsToEntries,
    updateModelNumericField,
} from '@/components/ui/modelInputListUtils'
import {apiClient} from '@/services/api/client'
import {buildOpenAIProviderPatchRequest, buildVertexConfigPatchRequest, providersApi} from '@/services/api/providers'
import {normalizeOpenAIProvider, normalizeProviderKeyConfig} from '@/services/api/transformers'
import {
    normalizeModelEntriesForSignature,
    rewriteModelMetadataForYaml,
    serializeModelMetadataForManagement,
} from '@/utils/modelMetadata'
import {expect, spyOn, test} from 'bun:test'
import {sourceInitializer} from './sourceCallbacks'

const raw = {
    name: 'synthetic-provider',
    'base-url': 'https://fixture.invalid',
    'api-key-entries': [{ 'api-key': 'synthetic-key' }],
    models: [{ name: 'Model-A', alias: 'Public', thinking: {}, 'future-model': { enabled: true } }],
}

test('management read through editor and final PATCH keeps explicit thinking:{} and unknown model fields', () => {
    const provider = normalizeOpenAIProvider(raw)!
    const entries  = modelsToEntries(provider.models)
    expect(entries[0].thinking).toEqual({})
    const next  = { ...provider, models: entriesToModels([{ ...entries[0], alias: 'Renamed' }]) }
    const patch = buildOpenAIProviderPatchRequest(0, next, provider)
    expect(patch.value.models).toEqual([
                                           {
                                               name: 'Model-A',
                                               alias: 'Renamed',
                                               thinking: {},
                                               'future-model': { enabled: true },
                                           },
                                       ])
    expect(raw.models[0].alias).toBe('Public')
})

test('unknown thinking metadata survives ordinary field edits and wire normalization', () => {
    const provider   = normalizeOpenAIProvider({
                                                   ...raw,
                                                   models: [
                                                       {
                                                           name: 'Model-A',
                                                           thinking: { min: 0, max: 128, future_budget: { scale: 2 } },
                                                       },
                                                   ],
                                               })!
    const loaded     = modelsToEntries(provider.models)[0]
    const updated    = updateModelNumericField(loaded, 'max', '256')
    const serialized = serializeModelMetadataForManagement(entriesToModels([updated])[0])
    expect(serialized.thinking).toMatchObject({ min: 0, max: 256, future_budget: { scale: 2 } })
    expect(rewriteModelMetadataForYaml({ thinking: {} })).toEqual({ thinking: {} })
    expect(normalizeModelEntriesForSignature([{ ...loaded, alias: 'a' }]))
        .not
        .toEqual(normalizeModelEntriesForSignature([{ ...loaded, alias: 'a', thinking: undefined }]))
})

test('actual thinking mode action distinguishes creation, explicit clearing, and catalog inheritance', () => {
    for (const mode of ['override', 'empty', 'inherit']) {
        let result: ModelEntry[] = []
        const entry: ModelEntry  = { name: 'Model-A', alias: '', 'future-model': { keep: true } }
        const change             = sourceInitializer<(index: number, mode: string) => void>(
            'components/ui/ModelInputList.tsx',
            'updateThinkingMode',
            {
                currentEntries: [entry], onChange: (entries: ModelEntry[]) => {
                    result = entries
                },
            },
        )
        change(0, mode)
        const wire = serializeModelMetadataForManagement(entriesToModels(result)[0])
        if (mode === 'override') {
            expect(wire.thinking).toEqual({ min: 0, max: 0 })
        }
        if (mode === 'empty') {
            expect(wire.thinking).toEqual({})
        }
        if (mode === 'inherit') {
            expect(wire).not.toHaveProperty('thinking')
        }
        expect(wire['future-model']).toEqual({ keep: true })
    }
})

test('clearing the final typed thinking budget retains an override until inheritance is selected explicitly', () => {
    const entry: ModelEntry = { name: 'Model-A', alias: '', thinking: { min: 1 } }
    const cleared           = updateModelNumericField(entry, 'min', '')
    expect(cleared.thinking).toEqual({})
    expect(serializeModelMetadataForManagement(entriesToModels([cleared])[0]).thinking).toEqual({})
})

test('Vertex keeps unknown metadata and empty thinking without emitting another protocol’s context fields', () => {
    const provider = normalizeProviderKeyConfig({
                                                    'api-key': 'synthetic-key',
                                                    models: [
                                                        {
                                                            name: 'Model-A',
                                                            thinking: {},
                                                            'future-model': { keep: true },
                                                        },
                                                    ],
                                                })!
    const loaded   = modelsToEntries(provider.models)
    const next     = {
        ...provider,
        models: entriesToModels([{ ...loaded[0], alias: 'Public', maxContextLength: 1024 }]),
    }
    const patch    = buildVertexConfigPatchRequest(0, next, provider)
    expect(patch.value).toHaveProperty(
        'models',
        [
            {
                name: 'Model-A',
                alias: 'Public',
                thinking: {},
                'future-model': { keep: true },
            },
        ],
    )
})

test(
    'OpenAI requests preserve provider headers and supported entry fields while omitting legacy per-key headers',
    async () => {
        const post = spyOn(apiClient, 'post').mockResolvedValue({})
        try {
            await providersApi.createOpenAIProvider({
                                                        name: 'synthetic',
                                                        baseUrl: 'https://fixture.invalid',
                                                        headers: { 'X-Provider': 'kept' },
                                                        apiKeyEntries: [
                                                            {
                                                                apiKey: 'synthetic-key',
                                                                proxyUrl: 'http://proxy.invalid',
                                                                weight: 2,
                                                                headers: { 'X-Legacy': 'unsupported' },
                                                            },
                                                        ],
                                                    })
            expect(post.mock.calls[0][1]).toMatchObject({
                                                            headers: { 'X-Provider': 'kept' },
                                                            'api-key-entries': [
                                                                {
                                                                    'api-key': 'synthetic-key',
                                                                    'proxy-url': 'http://proxy.invalid',
                                                                    weight: 2,
                                                                },
                                                            ],
                                                        })
            const payload = post.mock.calls[0][1] as { 'api-key-entries': Array<Record<string, unknown>> }
            expect(payload['api-key-entries'][0]).not.toHaveProperty('headers')
        } finally {
            post.mockRestore()
        }
    },
)
