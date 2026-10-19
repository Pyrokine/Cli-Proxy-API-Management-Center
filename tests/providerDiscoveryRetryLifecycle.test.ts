import {describe, expect, mock, spyOn, test} from 'bun:test'
import {apiCallApi} from '@/services/api/apiCall'
import {apiClient} from '@/services/api/client'
import {modelsApi} from '@/services/api/models'
import {buildHeaderObject, hasHeader} from '@/utils/headers'
import type {ModelInfo} from '@/utils/models'
import {sourceCallback} from './sourceCallbacks'

describe('model discovery request connection ownership', () => {
    for (const stage of [1, 2, 3]) {
        test(`OpenAI fallback stops before retry ${stage} can use another management connection`, async () => {
            const generation = spyOn(apiClient, 'getAuthGeneration').mockReturnValue(1)
            const firstError = new Error('synthetic first failure')
            let attempts = 0
            const request = mock((): Promise<ModelInfo[]> => {
                attempts += 1
                if (attempts <= stage) {
                    if (attempts === stage) {
                        generation.mockReturnValue(3)
                    }
                    return Promise.reject(attempts === 1 ? firstError : new Error('synthetic retry failure'))
                }
                return Promise.resolve([])
            })
            try {
                const fetch = sourceCallback<(signal: AbortSignal) => Promise<ModelInfo[]>>('pages/AiProvidersOpenAIModelsPage.tsx', 'fetchModels', {
                    apiClient, modelsApi: {fetchV1ModelsViaApiCall: request, fetchModelsViaApiCall: request},
                    form: {baseUrl: 'https://fixture.invalid', headers: [], authIndex: 'synthetic-provider', apiKeyEntries: [{apiKey: 'synthetic', authIndex: 'synthetic-key', proxyUrl: 'http://proxy.invalid'}]},
                    buildHeaderObject, hasHeader,
                })
                let failure: unknown
                try {
                    await fetch(new AbortController().signal)
                } catch (error: unknown) {
                    failure = error
                }
                expect(request).toHaveBeenCalledTimes(stage)
                expect(failure).toBe(firstError)
            } finally {
                generation.mockRestore()
            }
        })
    }

    test('Gemini pagination cannot send another page request on a different management connection', async () => {
        const generation = spyOn(apiClient, 'getAuthGeneration').mockReturnValue(1)
        type Result = Awaited<ReturnType<typeof apiCallApi.request>>
        let resolve!: (value: Result) => void
        const first = new Promise<Result>((accept) => {resolve = accept})
        const request = spyOn(apiCallApi, 'request')
            .mockImplementationOnce(() => first)
            .mockResolvedValue({statusCode: 200, header: {}, bodyText: '', body: {models: []}})
        try {
            const pending = modelsApi.fetchGeminiModelsViaApiCall('https://fixture.invalid', undefined, {}, undefined, 'synthetic-pagination-index')
            generation.mockReturnValue(3)
            resolve({statusCode: 200, header: {}, bodyText: '', body: {models: [{name: 'models/synthetic'}], nextPageToken: 'next-synthetic-page'}})
            let failure: unknown
            try {
                await pending
            } catch (error: unknown) {
                failure = error
            }
            expect(request).toHaveBeenCalledTimes(1)
            expect(failure).toBeInstanceOf(Error)
        } finally {
            request.mockRestore()
            generation.mockRestore()
        }
    })
})
