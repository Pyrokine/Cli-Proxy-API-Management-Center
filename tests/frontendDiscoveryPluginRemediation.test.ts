import {parseTextList} from '@/components/providers/utils'
import {entriesToModels} from '@/components/ui/modelInputListUtils'
import {isDefaultPluginStoreSource} from '@/pages/pluginResources'
import {apiCallApi} from '@/services/api/apiCall'
import {modelsApi} from '@/services/api/models'
import {buildVertexConfigPatchRequest} from '@/services/api/providers'
import type {ProviderKeyConfig} from '@/types'
import {normalizeApiBase} from '@/utils/connection'
import {buildHeaderObject, hasHeader} from '@/utils/headers'
import {normalizeModelList} from '@/utils/models'
import {findMissingProviderModelNames, mergeProviderModelEntries} from '@/utils/providerModels'
import {describe, expect, spyOn, test} from 'bun:test'
import {sourceCallback, sourceInitializer} from './sourceCallbacks'

const source = 'pages/PluginManagementPage.tsx'

describe('frontend discovery and plugin remediation', () => {
    test('OpenAI retries preserve the configured identity without selecting anonymous mode', async () => {
        const calls: unknown[][] = []
        const request            = async (...args: unknown[]) => {
            calls.push(args);
            throw new Error('denied')
        }
        const fetchModels        = sourceCallback<(signal: AbortSignal) => Promise<unknown>>(
            'pages/AiProvidersOpenAIModelsPage.tsx',
            'fetchModels',
            {
                apiClient: { getAuthGeneration: () => 7 },
                modelsApi: { fetchV1ModelsViaApiCall: request, fetchModelsViaApiCall: request },
                form: {
                    baseUrl: 'https://fixture.invalid',
                    headers: [{ key: 'X-Custom', value: 'keep' }],
                    apiKeyEntries: [{ apiKey: 'synthetic', authIndex: 'entry', proxyUrl: 'http://proxy.invalid' }],
                },
                buildHeaderObject, hasHeader, anonymous: false,
            },
        )
        expect(fetchModels(new AbortController().signal)).rejects.toThrow('denied')
        expect(calls).toHaveLength(2)
        for (const args of calls) {
            expect(args.slice(1, 5)).toEqual(['synthetic', { 'X-Custom': 'keep' }, 'http://proxy.invalid', 'entry'])
        }
    })

    test('rejects HTTP-success discovery errors and accepts an explicitly empty catalog', async () => {
        const request = spyOn(apiCallApi, 'request')
        try {
            for (const body of
                [{ error: 'authentication failed' }, /* language=TEXT */ '<html>login</html>', { data: [{}] }]) {
                request.mockResolvedValue({ statusCode: 200, header: {}, bodyText: '', body })
                expect(modelsApi.fetchV1ModelsViaApiCall('https://fixture.invalid', 'synthetic'))
                    .rejects
                    .toThrow()
            }
            request.mockResolvedValue({ statusCode: 200, header: {}, bodyText: '', body: { data: [] } })
            expect(await modelsApi.fetchV1ModelsViaApiCall('https://fixture.invalid', 'synthetic')).toEqual([])
        } finally {
            request.mockRestore()
        }
    })

    test('rejects an unfinished Gemini catalog at the page limit', async () => {
        let page      = 0
        const request = spyOn(apiCallApi, 'request').mockImplementation(async () => ({
            statusCode: 200, header: {}, bodyText: '',
            body: { models: [{ name: `models/model-${++page}` }], nextPageToken: `next-${page}` },
        }))
        try {
            expect(modelsApi.fetchGeminiModelsViaApiCall('https://fixture.invalid', 'synthetic'))
                .rejects
                .toThrow()
            expect(request).toHaveBeenCalledTimes(20)
        } finally {
            request.mockRestore()
        }
    })

    test('keeps differently cased model IDs, aliases and configured metadata distinct', () => {
        const discovered = normalizeModelList({
                                                  data: [
                                                      { id: 'Model-A', alias: 'upper' },
                                                      { id: 'model-a', alias: 'lower' },
                                                  ],
                                              }, { dedupe: true })
        expect(discovered).toHaveLength(2)
        const entries = [{ name: 'Model-A', alias: 'retained', maxContextLength: 12345 }]
        expect([...findMissingProviderModelNames(entries, discovered)]).toEqual(['model-a'])
        const merged = mergeProviderModelEntries(entries, discovered)
        expect(merged.entries).toEqual([...entries, { name: 'model-a', alias: 'lower' }])
        expect(merged.addedCount).toBe(1)
    })

    test('accepts full OpenAI and Gemini resource endpoints without duplicating paths', () => {
        expect(modelsApi.buildV1ModelsEndpoint('https://fixture.invalid/v1/chat/completions')).toBe(
            'https://fixture.invalid/v1/models')
        expect(modelsApi.buildGeminiModelsEndpoint('https://fixture.invalid/v1/models/gemini:generateContent')).toBe(
            'https://fixture.invalid/v1/models')
    })

    test('Vertex payload retains name-only rows and exclusion rules', () => {
        const options = sourceInitializer<{ formToPayload: (form: object) => object }>(
            'pages/AiProvidersVertexEditPage.tsx',
            'editOptions',
            {
                providersApi: {}, buildEmptyForm: () => ({}), buildSignature: () => '',
                getCredentialWeightValidationKey: () => undefined, entriesToModels,
                buildHeaderObject, headersToEntries: () => [], modelsToEntries: () => [], parseTextList,
            },
        )
        const payload = options.formToPayload({
                                                  apiKey: 'synthetic',
                                                  headers: [],
                                                  modelEntries: [
                                                      { name: 'Model-A', alias: '' },
                                                      { name: 'model-a', alias: 'lower' },
                                                  ],
                                                  excludedText: ' Claude-* \n',
                                              }) as ProviderKeyConfig
        expect(payload).toMatchObject({
                                          models: [{ name: 'Model-A' }, { name: 'model-a', alias: 'lower' }],
                                          excludedModels: ['Claude-*'],
                                      })
        expect(buildVertexConfigPatchRequest(0, payload, { apiKey: 'synthetic' }).value).toMatchObject(
            {
                models: [
                    { name: 'Model-A' },
                    {
                        name: 'model-a',
                        alias: 'lower',
                    },
                ],
                'excluded-models': ['Claude-*'],
            })
    })

    test('accepts plugin resources under a prefixed API base and rejects sibling or cross-origin paths', () => {
        const guard = sourceInitializer<(src: string, base: string) => URL | null>(
            'pages/PluginResourcePage.tsx',
            'trustedPluginResourceURL',
            {
                normalizeApiBase,
                window: { location: { origin: 'https://fixture.invalid' } },
                pluginResourcePathPrefix: '/v0/resource/plugins/',
            },
        )
        expect(guard(
            'https://fixture.invalid/cpa/v0/resource/plugins/demo/index.html',
            'https://fixture.invalid/cpa',
        )?.pathname).toBe('/cpa/v0/resource/plugins/demo/index.html')
        expect(guard(
            'https://fixture.invalid/other/v0/resource/plugins/demo/index.html',
            'https://fixture.invalid/cpa',
        )).toBeNull()
        expect(guard('https://other.invalid/cpa/v0/resource/plugins/demo/index.html', 'https://fixture.invalid/cpa'))
            .toBeNull()
    })

    test('rejects fractional and exponent integer drafts without issuing a config PATCH', async () => {
        const normalizeNumberInput = sourceCallback<(text: string, integer: boolean) => unknown>(
            source,
            'normalizeNumberInput',
            {},
        )
        for (const text of ['1.75', '1e3', '9007199254740993']) {
            expect(normalizeNumberInput(text, true)).toBe(text)
            const calls: unknown[]  = []
            const errors: unknown[] = []
            const save              = sourceCallback<() => Promise<void>>(source, 'handleSaveConfig', {
                configReadState: 'ready',
                editingPlugin: {
                    id: 'demo',
                    config: { limit: 2 },
                    config_fields: [{ name: 'limit', type: 'integer' }],
                },
                configDraft: { limit: 2 }, jsonDraft: { limit: text }, isCurrentConnection: () => true,
                setConfigError: (value: unknown) => errors.push(value), normalizeNumberInput,
                t: (key: string) => key, pluginsApi: { patchConfig: (...args: unknown[]) => calls.push(args) },
                stringifyConfigValue: () => '', setSavingConfig: () => {
                },
            })
            await save()
            expect(calls).toHaveLength(0)
            expect(errors).toEqual([null, 'plugin_management.invalid_number'])
        }
    })

    test('sends only edited config values and leaves unknown or absent JSON fields untouched', async () => {
        const patches: unknown[] = []
        const save               = sourceCallback<() => Promise<void>>(source, 'handleSaveConfig', {
            configReadState: 'ready',
            editingPlugin: {
                id: 'demo',
                config: { limit: 2, future: { keep: true } },
                config_fields: [{ name: 'limit', type: 'integer' }, { name: 'options', type: 'object' }],
            },
            configDraft: { limit: 2, future: { keep: true } }, jsonDraft: { limit: '3', options: '{}' },
            isCurrentConnection: () => true, normalizeNumberInput: sourceCallback(source, 'normalizeNumberInput', {}),
            stringifyConfigValue: sourceCallback(
                source,
                'stringifyConfigValue',
                { isJsonConfigValue: (value: unknown) => typeof value === 'object' },
            ),
            setConfigError: () => {
            }, t: (key: string) => key, pluginsApi: {
                patchConfig: async (_id: string, value: unknown) => {
                    patches.push(value)
                },
            },
            confirmPluginRuntime: async () => {
            }, setSavingConfig: () => {
            }, showNotification: () => {
            }, setEditingPlugin: () => {
            }, setConfigDraft: () => {
            }, setJsonDraft: () => {
            }, fetchPlugins: async () => {
            },
        })
        await save()
        expect(patches).toEqual([{ limit: 3 }])
    })

    test('classifies simplified and traditional Chinese release headings into the right columns', () => {
        const FEATURE_SECTION_PATTERN = sourceInitializer<RegExp>(
            'components/system/VersionHistoryModal.tsx',
            'FEATURE_SECTION_PATTERN',
            {},
        )
        const FIX_SECTION_PATTERN     = sourceInitializer<RegExp>(
            'components/system/VersionHistoryModal.tsx',
            'FIX_SECTION_PATTERN',
            {},
        )
        const classify                = sourceCallback<(body: string) => object>(
            'components/system/VersionHistoryModal.tsx',
            'classifyReleaseBody',
            { FEATURE_SECTION_PATTERN, FIX_SECTION_PATTERN },
        )
        for (const [feature, fix] of [['新增', '修复'], ['更新內容', '修復']]) {
            expect(classify(`## ${feature}\n- feature\n## ${fix}\n- fix`)).toEqual({
                                                                                       features: ['feature'],
                                                                                       fixes: ['fix'],
                                                                                       other: [],
                                                                                   })
        }
    })

    test('submits CPA and panel installs without requiring secure-context randomUUID', async () => {
        for (const target of ['cpa', 'panel']) {
            const submittedUpdate          = { current: null }
            const requests: unknown[]      = []
            const notifications: unknown[] = []
            const confirm                  = sourceCallback<() => Promise<void>>(
                'components/system/VersionHistoryModal.tsx',
                'onConfirm',
                {
                    isCurrent: () => true,
                    target,
                    submittedUpdate,
                    crypto: { getRandomValues: (bytes: Uint8Array) => bytes.fill(7) },
                    tag: 'v1.26.1',
                    currentVersion: 'v1.26.0',
                    authGeneration: 7,
                    apiClient: { getAuthGeneration: () => 7 },
                    compatibility: undefined,
                    setUpdatingVersion: () => {
                    },
                    setPollingReady: () => {
                    },
                    setPollError: () => {
                    },
                    setUpdateStatus: () => {
                    },
                    updateApi: {
                        panelUpdate: async (tag: string) => {
                            requests.push(tag)
                        }, trigger: async (tag: string, id: string) => {
                            requests.push([tag, id]);
                            return { target_version: tag, attempt_id: id }
                        },
                    },
                    t: (key: string) => key,
                    showNotification: () => {
                    },
                    addPersistentNotification: (...args: unknown[]) => notifications.push(args),
                },
            )
            await confirm()
            expect(requests).toHaveLength(1)
            if (target === 'cpa') {
                expect((requests[0] as string[])[1]).toMatch(/^[a-f0-9]{32}$/)
            } else {
                expect(notifications[0]).toEqual(['version_switcher.panel_updated', 'success', 'release'])
            }
        }
    })
})

test('prefers a plugin store source ID over its display name', () => {
    expect(isDefaultPluginStoreSource({ source_id: 'custom', source_name: 'official' })).toBe(false)
    expect(isDefaultPluginStoreSource({ source_id: 'official', source_name: 'Custom display' })).toBe(true)
    expect(isDefaultPluginStoreSource({ source_id: '', source_name: 'official' })).toBe(true)
})
