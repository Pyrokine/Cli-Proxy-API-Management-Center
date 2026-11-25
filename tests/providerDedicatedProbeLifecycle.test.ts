import {buildClaudeMessagesEndpoint} from '@/components/providers/utils'
import {apiCallApi, getApiCallErrorMessage, prepareApiCallAuth} from '@/services/api/apiCall'
import {apiClient} from '@/services/api/client'
import {modelsApi} from '@/services/api/models'
import {buildHeaderObject, hasHeader} from '@/utils/headers'
import {getErrorMessage} from '@/utils/helpers'
import {describe, expect, mock, spyOn, test} from 'bun:test'
import React, {type ReactElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import ts from 'typescript'
import {sourceCallback, sourceExpression, sourceInitializer} from './sourceCallbacks'

type Result = Parameters<typeof getApiCallErrorMessage>[0]
type Run = (index?: number | 'all') => Promise<void>

function deferred<T>() {
    let resolve!: (value: T) => void
    let reject!: (reason: unknown) => void
    const promise = new Promise<T>((accept, decline) => {
        resolve = accept;
        reject  = decline
    })
    return { promise, resolve, reject }
}

function probe(provider: 'Claude' | 'OpenAI') {
    const file                              = `pages/AiProviders${provider}EditPage.tsx`
    const generation                        = spyOn(apiClient, 'getAuthGeneration').mockReturnValue(1)
    const response                          = deferred<Result>()
    const request                           = mock(() => response.promise)
    const updates: Array<[string, unknown]> = []
    const showNotification                  = mock(() => {
    })
    const activeTestAbortRef                = { current: null as AbortController | null }
    const activeTestRequestIdRef            = { current: 0 }
    const scope                             = {
        apiClient,
        authGeneration: 1,
        isTesting: false,
        activeTestAbortRef,
        activeTestRequestIdRef,
        previousConnectivityConfigRef: { current: 'fixture' },
        connectivityConfigSignature: 'fixture',
        form: {
            apiKey: 'synthetic',
            authIndex: 'synthetic-index',
            baseUrl: 'https://fixture.invalid',
            proxyUrl: 'http://proxy.invalid',
            headers: [],
            apiKeyEntries: [{ apiKey: 'synthetic', authIndex: 'synthetic-index', proxyUrl: 'http://proxy.invalid' }],
        },
        credentialIdentityAvailable: true,
        apiKeyIsMasked: false,
        maskedCredentialHeaderNames: [],
        testModel: 'synthetic-model',
        resolvedTestModel: 'synthetic-model',
        tokenLimitField: 'max_tokens',
        availableModels: [],
        apiCallApi: { request },
        buildHeaderObject,
        hasHeader,
        prepareApiCallAuth,
        getApiCallErrorMessage,
        getErrorMessage,
        buildClaudeMessagesEndpoint,
        // noinspection JSUnusedGlobalSymbols
        'buildOpenAIChatCompletionsEndpoint': (url: string) => modelsApi.buildV1ModelsEndpoint(url).replace(
            /\/models$/i,
            '/chat/completions',
        ),
        CLAUDE_TEST_TIMEOUT_MS: 30_000,
        OPENAI_TEST_TIMEOUT_MS: 30_000,
        DEFAULT_ANTHROPIC_VERSION: '2023-06-01',
        t: (key: string) => key,
        showNotification,
        setIsTesting: (value: boolean) => updates.push(['testing', value]),
        setTestStatus: (value: string) => updates.push(['status', value]),
        setTestMessage: (value: string) => updates.push(['message', value]),
        // noinspection JSUnusedGlobalSymbols
        'setDraftKeyTestStatus': (index: number, value: unknown) => updates.push([`key-${index}`, value]),
    }
    const run                               = provider === 'Claude' ?
                                              sourceCallback<Run>(file, 'runClaudeConnectivityTest', scope) :
                                              sourceInitializer<Run>(file, 'runOpenAIConnectivityTest', scope)
    return {
        run,
        generation,
        response,
        request,
        updates,
        showNotification,
        activeTestAbortRef,
        activeTestRequestIdRef,
        scope,
        file,
    }
}

for (const provider of ['Claude', 'OpenAI'] as const) {
    describe(`${provider} dedicated connectivity ownership`, () => {
        for (const outcome of ['success', 'http-error', 'exception'] as const) {
            test(`ignores an old connection's ${outcome} without notifying or changing pending state`, async () => {
                const current = probe(provider)
                try {
                    const pending = current.run(0)
                    const before  = [...current.updates]
                    current.generation.mockReturnValue(3)
                    if (outcome === 'exception') {
                        current.response.reject(new Error('synthetic old failure'))
                    } else {
                        current.response.resolve({
                                                     statusCode: outcome === 'success' ? 200 : 503,
                                                     header: {},
                                                     bodyText: '',
                                                     body: null,
                                                 })
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
                current.response.resolve({ statusCode: 200, header: {}, bodyText: '', body: null })
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
                    const pending          = current.run(0)
                    const cancelActiveTest = sourceCallback<() => void>(current.file, 'cancelActiveTest', current.scope)
                    sourceCallback<() => () => void>(
                        current.file,
                        'useEffect',
                        { ...current.scope, cancelActiveTest },
                        '() => () => cancelActiveTest()',
                    )()()
                    const before = [...current.updates]
                    if (outcome === 'success') {
                        current.response.resolve({ statusCode: 200, header: {}, bodyText: '', body: null })
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
                        current.response.resolve({ statusCode: 403, header: {}, bodyText: '', body: null })
                    } else {
                        current.response.reject(new Error(outcome === 'timeout' ?
                                                          'synthetic timeout' :
                                                          'synthetic current failure'))
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
                first  = current.run(0)
                second = current.run(0)
                expect(current.request).toHaveBeenCalledTimes(1)
                current.response.resolve({ statusCode: 200, header: {}, bodyText: '', body: null })
                await Promise.all([first, second])
                expect(current.showNotification).toHaveBeenCalledTimes(1)
                expect(current.activeTestAbortRef.current).toBeNull()
                expect(current.updates[current.updates.length - 1]).toEqual(['testing', false])
            } finally {
                current.response.resolve({ statusCode: 200, header: {}, bodyText: '', body: null })
                await Promise.all([first, second])
                current.generation.mockRestore()
            }
        })
    })
}

const completionTokenError = 'Unsupported parameter: \'max_tokens\' is not supported with this model. ' +
                             'Use \'max_completion_tokens\' instead.'

for (const { selected, model, flag, rejected, fields, message } of [
    {
        selected: 'gpt-6-sol', model: 'gpt-6-sol', flag: true,
        fields: ['max_completion_tokens'], message: 'ai_providers.openai_test_success',
    },
    {
        selected: 'removed-model', model: 'legacy-chat', flag: false,
        fields: ['max_tokens'], message: 'ai_providers.openai_test_success',
    },
    {
        selected: 'gpt-6-sol', model: 'gpt-6-sol', rejected: completionTokenError,
        fields: ['max_tokens', 'max_completion_tokens'],
        message: 'ai_providers.openai_test_success · ai_providers.model_max_completion_tokens_label',
    },
    {
        selected: 'legacy-chat', model: 'legacy-chat', rejected: 'Unsupported parameter: temperature',
        fields: ['max_tokens'], message: 'ai_providers.openai_test_failed: 400 Unsupported parameter: temperature',
    },
]) {
    test(`OpenAI probe sends ${fields.join(' then ')} for ${selected} and displays its result`, async () => {
        const current = probe('OpenAI')
        const post    = spyOn(apiClient, 'post').mockResolvedValue({ status_code: 200 })
        try {
            if (rejected) {
                post.mockResolvedValueOnce({ status_code: 400, body: JSON.stringify({ error: { message: rejected } }) })
            }
            const selection = { testModel: selected, availableModels: [model, 'other-upstream-model'] }
            const scope     = {
                ...current.scope, ...selection, apiCallApi,
                form: {
                    ...current.scope.form, modelEntries: [
                        { name: ` ${model} `, alias: 'client-model', useMaxCompletionTokens: flag },
                        { name: 'other-upstream-model', alias: '', useMaxCompletionTokens: !flag },
                    ],
                },
                resolvedTestModel: sourceInitializer<string>(current.file, 'resolvedTestModel', selection),
            }
            const run       = sourceInitializer<Run>(current.file, 'runOpenAIConnectivityTest', {
                ...scope, tokenLimitField: sourceInitializer(current.file, 'tokenLimitField', scope),
            })
            await run()

            expect(post).toHaveBeenCalledTimes(fields.length)
            for (const [index, [path, payload, options]] of post.mock.calls.entries()) {
                expect(path).toBe('/api-call')
                expect(payload).toMatchObject({
                                                  method: 'POST',
                                                  url: 'https://fixture.invalid/v1/chat/completions',
                                                  authIndex: 'synthetic-index',
                                                  proxyUrl: 'http://proxy.invalid',
                                                  draftToken: 'synthetic',
                                                  header: {
                                                      'Content-Type': 'application/json',
                                                      Authorization: 'Bearer $TOKEN$',
                                                  },
                                              })
                expect(JSON.parse((payload as { data: string }).data)).toEqual({
                                                                                   model,
                                                                                   messages: [
                                                                                       {
                                                                                           role: 'user',
                                                                                           content: 'Hi',
                                                                                       },
                                                                                   ],
                                                                                   [fields[index]]: 8,
                                                                               })
                expect(options?.signal).toBe(post.mock.calls[0]?.[2]?.signal)
                expect(options?.timeout).toBeGreaterThan(0)
                expect(options?.timeout).toBeLessThanOrEqual(30_000)
            }

            const outcome = rejected && rejected !== completionTokenError ? 'error' : 'success'
            const updates = Object.fromEntries(current.updates)
            expect(updates).toMatchObject({ status: outcome, message, 'key-0': { status: outcome, message } })
            expect(current.showNotification).toHaveBeenCalledWith(message, outcome)
            const badge = sourceExpression<ReactElement>(
                'components/common/ModelTestPanel.tsx',
                (node, tree) => ts.isJsxElement(node) && node.openingElement.getText(tree).includes('status-badge'),
                { React, testStatus: updates.status, testMessage: updates.message },
            )
            const html  = renderToStaticMarkup(badge)
            expect(html).toContain(`status-badge ${outcome}`)
            expect(html).toContain(message)
        } finally {
            post.mockRestore()
            current.generation.mockRestore()
        }
    })
}

test('OpenAI does not retry a token-field rejection from an old connection', async () => {
    const current = probe('OpenAI')
    try {
        const pending = current.run(0)
        current.generation.mockReturnValue(2)
        current.response.resolve({ statusCode: 400, header: {}, bodyText: '', body: completionTokenError })
        await pending
        expect(current.request).toHaveBeenCalledTimes(1)
        expect(current.showNotification).not.toHaveBeenCalled()
    } finally {
        current.generation.mockRestore()
    }
})

describe(
    'OpenAI explicit all-key connectivity',
    () => {
        test(
            'dispatches only from the explicit action, retains each identity and proxy, and reports mixed results',
            async () => {
                const current                  = probe('OpenAI')
                const pending: Promise<void>[] = []
                try {
                    current.scope.form.apiKeyEntries.push({
                                                              apiKey: '',
                                                              authIndex: 'synthetic-second',
                                                              proxyUrl: 'http://second.invalid',
                                                          })
                    current.request.mockImplementationOnce(async () => ({
                        statusCode: 200,
                        header: {},
                        bodyText: '',
                        body: null,
                    }))
                    current.request.mockImplementationOnce(async () => ({
                        statusCode: 403,
                        header: {},
                        bodyText: '',
                        body: null,
                    }))
                    const action = sourceExpression<ReactElement<{ onClick: () => void; disabled: boolean }>>(
                        current.file,
                        (
                            node,
                            tree,
                        ) => ts.isJsxElement(node) &&
                             node.openingElement.tagName.getText(tree) ===
                             'Button' &&
                             node.openingElement.attributes.properties.some(
                                 (attribute) => ts.isJsxAttribute(
                                                    attribute,
                                                ) &&
                             attribute.name.getText(tree) ===
                             'onClick' &&
                             attribute.initializer?.getText(tree) ===
                             '{() => void runOpenAIConnectivityTest(\'all\')}',
                             ),
                        {
                            React,
                            Button: () => null,
                            controlsDisabled: false,
                            form: current.scope.form,
                            t: current.scope.t,
                            runOpenAIConnectivityTest: (index: 'all') => {
                                const result = current.run(index);
                                pending.push(result);
                                return result
                            },
                        },
                    )
                    expect(current.request).not.toHaveBeenCalled()
                    expect(action.props.disabled).toBe(false)
                    action.props.onClick()
                    await Promise.all(pending)
                    expect(current.request).toHaveBeenCalledTimes(2)
                    expect(current.request.mock.calls).toMatchObject([
                                                                         [
                                                                             {
                                                                                 method: 'POST',
                                                                                 proxyUrl: 'http://proxy.invalid',
                                                                                 authIndex: 'synthetic-index',
                                                                             }, { timeout: 30_000 },
                                                                         ],
                                                                         [
                                                                             {
                                                                                 method: 'POST',
                                                                                 proxyUrl: 'http://second.invalid',
                                                                                 authIndex: 'synthetic-second',
                                                                             }, { timeout: 30_000 },
                                                                         ],
                                                                     ])
                    expect(current.updates).toContainEqual([
                                                               'key-0',
                                                               {
                                                                   status: 'success',
                                                                   message: 'ai_providers.openai_test_success',
                                                               },
                                                           ])
                    expect(current.updates).toContainEqual([
                                                               'key-1',
                                                               {
                                                                   status: 'error',
                                                                   message: 'ai_providers.openai_test_failed: HTTP 403',
                                                               },
                                                           ])
                    const keyTestStatuses =
                              [0, 1].map(
                                  (index) => [...current.updates].reverse()
                                                                 .find(
                                                                     ([name]) => name ===
                                                                                 `key-${
                                                                                     index}`)?.[1])
                    for (const index of [0, 1]) {
                        const badge = sourceExpression<ReactElement>(
                            current.file,
                            (node, tree) => ts.isJsxElement(node) &&
                                            node.openingElement.tagName.getText(tree) ===
                                            'div' &&
                                            node.openingElement.attributes.properties.some(
                                                (attribute) => ts.isJsxAttribute(
                                                                   attribute) &&
                                            attribute.name.getText(tree) ===
                                            'className' &&
                                            attribute.initializer?.getText(tree)
                                                     .includes('styles.keyTestStatusBadge') ===
                                            true,
                                            ), {
                                React,
                                index,
                                keyTestStatuses,
                                styles: { keyTestStatusBadge: 'fixture-key-status' },
                            },
                        )
                        const html  = renderToStaticMarkup(badge)
                        expect(html).toContain(`status-badge ${index === 0 ? 'success' : 'error'} fixture-key-status`)
                        expect(html).toContain(index === 0 ? 'ai_providers.openai_test_success' : 'HTTP 403')
                    }
                    expect(current.showNotification).toHaveBeenCalledTimes(1)
                    expect(current.showNotification).toHaveBeenCalledWith(
                        'ai_providers.openai_test_all_result',
                        'error',
                    )
                    expect(current.updates[current.updates.length - 1]).toEqual(['testing', false])
                } finally {
                    current.generation.mockRestore()
                }
            },
        )

        for (const cancel of ['connection', 'unmount'] as const) {
            test(
                `stops the batch after ${cancel} without requesting later keys or publishing late results`,
                async () => {
                    const current = probe('OpenAI')
                    try {
                        current.scope.form.apiKeyEntries.push({
                                                                  apiKey: 'synthetic-next',
                                                                  authIndex: 'next',
                                                                  proxyUrl: '',
                                                              })
                        const pending = current.run('all')
                        expect(current.request).toHaveBeenCalledTimes(1)
                        const before = [...current.updates]
                        if (cancel === 'connection') {
                            current.generation.mockReturnValue(2)
                        } else {
                            sourceCallback<() => void>(current.file, 'cancelActiveTest', current.scope)()
                        }
                        current.response.resolve({ statusCode: 200, header: {}, bodyText: '', body: null })
                        await pending
                        expect(current.request).toHaveBeenCalledTimes(1)
                        expect(current.updates).toEqual(before)
                        expect(current.showNotification).not.toHaveBeenCalled()
                    } finally {
                        current.generation.mockRestore()
                    }
                },
            )
        }

        test('continues after a key failure and includes invalid keys in the exact summary', async () => {
            const current              = probe('OpenAI')
            const summaries: unknown[] = []
            try {
                current.scope.form.apiKeyEntries.push({ apiKey: '', authIndex: '', proxyUrl: '' })
                current.scope.t = (key: string, values?: unknown) => {
                    if (key.endsWith('_all_result')) {
                        summaries.push(values)
                    }

                    return key
                }
                current.request.mockImplementationOnce(async () => {
                    throw new Error('synthetic timeout')
                })
                const run = sourceInitializer<Run>(current.file, 'runOpenAIConnectivityTest', current.scope)
                await run('all')
                expect(current.request).toHaveBeenCalledTimes(1)
                expect(current.updates).toContainEqual([
                                                           'key-0',
                                                           {
                                                               status: 'error',
                                                               message: 'ai_providers.openai_test_timeout',
                                                           },
                                                       ])
                expect(current.updates).toContainEqual([
                                                           'key-1',
                                                           {
                                                               status: 'error',
                                                               message: 'notification.openai_test_key_required',
                                                           },
                                                       ])
                expect(summaries).toEqual([{ success: 0, failed: 2, total: 2 }])
            } finally {
                current.generation.mockRestore()
            }
        })

        test(
            'the default single-key action retains the first usable credential instead of starting a batch',
            async () => {
                const current = probe('OpenAI')
                try {
                    current.scope.form.apiKeyEntries[0] = { apiKey: '', authIndex: '', proxyUrl: '' }
                    current.scope.form.apiKeyEntries.push({
                                                              apiKey: '',
                                                              authIndex: 'usable-second',
                                                              proxyUrl: 'http://second.invalid',
                                                          })
                    current.request.mockResolvedValue({ statusCode: 200, header: {}, bodyText: '', body: null })
                    await current.run()
                    expect(current.request).toHaveBeenCalledTimes(1)
                    expect(current.request.mock.calls[0]).toMatchObject([
                                                                            {
                                                                                authIndex: 'usable-second',
                                                                                proxyUrl: 'http://second.invalid',
                                                                            }, { timeout: 30_000 },
                                                                        ])
                    expect(current.updates.some(([name]) => name === 'key-0')).toBe(false)
                    expect(current.updates).toContainEqual([
                                                               'key-1',
                                                               {
                                                                   status: 'success',
                                                                   message: 'ai_providers.openai_test_success',
                                                               },
                                                           ])
                } finally {
                    current.generation.mockRestore()
                }
            },
        )

        test('the explicit all-key button respects disabled controls and an empty configured key list', () => {
            const file = 'pages/AiProvidersOpenAIEditPage.tsx'
            for (const [controlsDisabled, empty] of [[true, false], [false, true]]) {
                const action = sourceExpression<ReactElement<{ disabled: boolean }>>(
                    file,
                    (
                        node,
                        tree,
                    ) => ts.isJsxElement(node) &&
                         node.openingElement.tagName.getText(tree) ===
                         'Button' &&
                         node.openingElement.attributes.properties.some((attribute) => ts.isJsxAttribute(attribute) &&
                         attribute.name.getText(tree) ===
                         'onClick' &&
                         attribute.initializer?.getText(tree) ===
                         '{() => void runOpenAIConnectivityTest(\'all\')}'),
                    {
                        React,
                        Button: () => null,
                        controlsDisabled,
                        form: {
                            apiKeyEntries: empty ?
                                [] :
                                [{}],
                        },
                        t: (key: string) => key,
                        runOpenAIConnectivityTest: () => {
                        },
                    },
                )
                expect(action.props.disabled).toBe(true)
            }
        })
    },
)
