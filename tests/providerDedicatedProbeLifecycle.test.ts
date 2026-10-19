import {describe, expect, mock, spyOn, test} from 'bun:test'
import {buildClaudeMessagesEndpoint} from '@/components/providers/utils'
import {getApiCallErrorMessage, prepareApiCallAuth} from '@/services/api/apiCall'
import {apiClient} from '@/services/api/client'
import {modelsApi} from '@/services/api/models'
import {buildHeaderObject, hasHeader} from '@/utils/headers'
import {getErrorMessage} from '@/utils/helpers'
import {sourceCallback, sourceInitializer} from './sourceCallbacks'

type Result = Parameters<typeof getApiCallErrorMessage>[0]
type Run = (index?: number) => Promise<void>

function deferred<T>() {
    let resolve!: (value: T) => void
    let reject!: (reason: unknown) => void
    const promise = new Promise<T>((accept, decline) => {resolve = accept; reject = decline})
    return {promise, resolve, reject}
}

function probe(provider: 'Claude' | 'OpenAI') {
    const file = `pages/AiProviders${provider}EditPage.tsx`
    const generation = spyOn(apiClient, 'getAuthGeneration').mockReturnValue(1)
    const response = deferred<Result>()
    const request = mock(() => response.promise)
    const updates: Array<[string, unknown]> = []
    const showNotification = mock(() => {})
    const activeTestAbortRef = {current: null as AbortController | null}
    const activeTestRequestIdRef = {current: 0}
    const scope = {
        apiClient, authGeneration: 1, isTesting: false, activeTestAbortRef, activeTestRequestIdRef,
        previousConnectivityConfigRef: {current: 'fixture'}, connectivityConfigSignature: 'fixture',
        form: {apiKey: 'synthetic', authIndex: 'synthetic-index', baseUrl: 'https://fixture.invalid', proxyUrl: 'http://proxy.invalid', headers: [], apiKeyEntries: [{apiKey: 'synthetic', authIndex: 'synthetic-index', proxyUrl: 'http://proxy.invalid'}]},
        credentialIdentityAvailable: true, apiKeyIsMasked: false, maskedCredentialHeaderNames: [],
        testModel: 'synthetic-model', resolvedTestModel: 'synthetic-model', availableModels: [],
        apiCallApi: {request}, buildHeaderObject, hasHeader, prepareApiCallAuth, getApiCallErrorMessage, getErrorMessage,
        buildClaudeMessagesEndpoint, buildOpenAIChatCompletionsEndpoint: (url: string) => modelsApi.buildV1ModelsEndpoint(url).replace(/\/models$/i, '/chat/completions'),
        CLAUDE_TEST_TIMEOUT_MS: 30_000, OPENAI_TEST_TIMEOUT_MS: 30_000, DEFAULT_ANTHROPIC_VERSION: '2023-06-01',
        t: (key: string) => key, showNotification,
        setIsTesting: (value: boolean) => updates.push(['testing', value]),
        setTestStatus: (value: string) => updates.push(['status', value]),
        setTestMessage: (value: string) => updates.push(['message', value]),
        setDraftKeyTestStatus: (index: number, value: unknown) => updates.push([`key-${index}`, value]),
    }
    const run = provider === 'Claude' ? sourceCallback<Run>(file, 'runClaudeConnectivityTest', scope) : sourceInitializer<Run>(file, 'runOpenAIConnectivityTest', scope)
    return {run, generation, response, request, updates, showNotification, activeTestAbortRef, activeTestRequestIdRef, scope, file}
}

for (const provider of ['Claude', 'OpenAI'] as const) {
    describe(`${provider} dedicated connectivity ownership`, () => {
        for (const outcome of ['success', 'http-error', 'exception'] as const) {
            test(`ignores an old connection's ${outcome} without notifying or changing pending state`, async () => {
                const current = probe(provider)
                try {
                    const pending = current.run(0)
                    const before = [...current.updates]
                    current.generation.mockReturnValue(3)
                    if (outcome === 'exception') {
                        current.response.reject(new Error('synthetic old failure'))
                    } else {
                        current.response.resolve({statusCode: outcome === 'success' ? 200 : 503, header: {}, bodyText: '', body: null})
                    }
                    await pending
                    expect(current.showNotification).not.toHaveBeenCalled()
                    expect(current.updates).toEqual(before)
                } finally {
                    current.generation.mockRestore()
                }
            })
        }

        test('old callbacks cannot dispatch after a connection change', async () => {
            const current = probe(provider)
            try {
                current.generation.mockReturnValue(3)
                current.response.resolve({statusCode: 200, header: {}, bodyText: '', body: null})
                await current.run(0)
                expect(current.request).not.toHaveBeenCalled()
                expect(current.showNotification).not.toHaveBeenCalled()
                expect(current.updates).toEqual([])
            } finally {
                current.generation.mockRestore()
            }
        })

        for (const outcome of ['success', 'failure'] as const) {
            test(`unmount cancellation ignores a late ${outcome}`, async () => {
                const current = probe(provider)
                try {
                    const pending = current.run(0)
                    const cancelActiveTest = sourceCallback<() => void>(current.file, 'cancelActiveTest', current.scope)
                    sourceCallback<() => () => void>(current.file, 'useEffect', {...current.scope, cancelActiveTest}, '() => () => cancelActiveTest()')()()
                    const before = [...current.updates]
                    if (outcome === 'success') {
                        current.response.resolve({statusCode: 200, header: {}, bodyText: '', body: null})
                    } else {
                        current.response.reject(new Error('synthetic cancelled failure'))
                    }
                    await pending
                    expect(current.showNotification).not.toHaveBeenCalled()
                    expect(current.updates).toEqual(before)
                    expect(current.activeTestAbortRef.current).toBeNull()
                } finally {
                    current.generation.mockRestore()
                }
            })
        }

        for (const outcome of ['http-error', 'timeout', 'failure'] as const) {
            test(`a current ${outcome} remains visible and releases its request`, async () => {
                const current = probe(provider)
                try {
                    const pending = current.run(0)
                    if (outcome === 'http-error') {
                        current.response.resolve({statusCode: 403, header: {}, bodyText: '', body: null})
                    } else {
                        current.response.reject(new Error(outcome === 'timeout' ? 'synthetic timeout' : 'synthetic current failure'))
                    }
                    await pending
                    expect(current.showNotification).toHaveBeenCalledTimes(1)
                    expect(current.updates).toContainEqual(['status', 'error'])
                    expect(current.activeTestAbortRef.current).toBeNull()
                    expect(current.updates[current.updates.length - 1]).toEqual(['testing', false])
                } finally {
                    current.generation.mockRestore()
                }
            })
        }

        test('dispatches one request for rapid repeated calls', async () => {
            const current = probe(provider)
            let first: Promise<void> | undefined
            let second: Promise<void> | undefined
            try {
                first = current.run(0)
                second = current.run(0)
                expect(current.request).toHaveBeenCalledTimes(1)
                current.response.resolve({statusCode: 200, header: {}, bodyText: '', body: null})
                await Promise.all([first, second])
                expect(current.showNotification).toHaveBeenCalledTimes(1)
                expect(current.activeTestAbortRef.current).toBeNull()
                expect(current.updates[current.updates.length - 1]).toEqual(['testing', false])
            } finally {
                current.response.resolve({statusCode: 200, header: {}, bodyText: '', body: null})
                await Promise.all([first, second])
                current.generation.mockRestore()
            }
        })
    })
}
