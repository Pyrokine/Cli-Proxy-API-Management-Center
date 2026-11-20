import type {ProviderModelsPageProps} from '@/pages/ProviderModelsPage'
import {apiCallApi, isCredentialHeaderName} from '@/services/api/apiCall'
import {apiClient} from '@/services/api/client'
import {modelsApi} from '@/services/api/models'
import {buildHeaderObject, hasHeader} from '@/utils/headers'
import {expect, spyOn, test} from 'bun:test'
import {readFileSync} from 'node:fs'
import React, {type ReactElement} from 'react'
import ts from 'typescript'
import {sourceCallback, sourceExpression} from './sourceCallbacks'

function mount(withCredentials = true) {
    let anonymous = false
    const ToggleSwitch = () => null
    const page = sourceCallback<() => ReactElement<ProviderModelsPageProps>>(
        'pages/AiProvidersOpenAIModelsPage.tsx', 'AiProvidersOpenAIModelsPage', {
            React, modelsApi, apiClient, buildHeaderObject, hasHeader, isCredentialHeaderName,
            ToggleSwitch,
            // noinspection JSUnusedGlobalSymbols
            'ProviderModelsPage': () => null,
            useState: (initial: boolean) => {
                expect(initial).toBe(false)
                return [
                    anonymous, (value: boolean) => {
                        anonymous = value
                    },
                ]
            },
            useTranslation: () => ({ t: (key: string) => key }),
            useMemo: <T, >(build: () => T) => build(), useCallback: <T, >(callback: T) => callback,
            // noinspection JSUnusedGlobalSymbols
            'useOutletContext': () => ({
                disableControls: false, loading: false, saving: false,
                form: {
                    baseUrl: 'https://models.synthetic.invalid',
                    authIndex: withCredentials ? 'provider-index' : undefined,
                    modelEntries: [],
                    headers: withCredentials ? [
                        { key: 'Authorization', value: 'Bearer synthetic-header' },
                        { key: 'X-Api-Key', value: 'synthetic-key-header' },
                        { key: 'Cookie', value: 'synthetic-cookie' },
                        { key: 'X-Trace', value: 'keep' },
                    ] : [],
                    apiKeyEntries: withCredentials ?
                        [
                            {
                                apiKey: 'synthetic-key',
                                authIndex: 'entry-index',
                                proxyUrl: 'http://proxy.synthetic.invalid',
                            },
                        ] :
                        [],
                },
                mergeDiscoveredModels: () => {
                },
            }),
        })
    const control = () => page().props.controls as ReactElement<{
        checked: boolean;
        label: string;
        onChange: (value: boolean) => void
    }>
    return { page, control, ToggleSwitch }
}

test(
    'the actual OpenAI discovery entry exposes an off-by-default anonymous control consumed by the shared view',
    () => {
        const { page, control, ToggleSwitch } = mount()
        expect(control().type).toBe(ToggleSwitch)
        expect(control().props).toMatchObject({ checked: false, label: 'ai_providers.openai_models_anonymous' })
        expect(page().props.fetchHint).toBeUndefined()
        control().props.onChange(true)
        expect(control().props.checked).toBe(true)
        expect(page().props.fetchHint).toBe('ai_providers.openai_models_anonymous_hint')
        const consumer = sourceExpression<unknown>(
            'pages/ProviderModelsPage.tsx', (node, tree) =>
                ts.isJsxExpression(node) && node.expression?.getText(tree) === 'controls' &&
                ts.isJsxElement(node.parent) && node.parent.openingElement.tagName.getText(tree) === 'Card',
            { controls: page().props.controls },
        )
        expect(consumer).toBeDefined()
    },
)

test(
    'explicit anonymous discovery clears credentials while retaining proxy, noncredential headers and the abort signal',
    async () => {
        const generation = spyOn(apiClient, 'getAuthGeneration').mockReturnValue(7)
        const request    = spyOn(apiCallApi, 'request').mockResolvedValue({
                                                                              statusCode: 200,
                                                                              header: {},
                                                                              bodyText: '',
                                                                              body: { data: [{ id: 'Public-Model' }] },
                                                                          })
        try {
            const { page, control } = mount()
            control().props.onChange(true)
            const signal = new AbortController().signal
            expect(await page().props.fetchModels(signal)).toMatchObject([{ name: 'Public-Model' }])
            expect(request).toHaveBeenCalledTimes(1)
            expect(request.mock.calls[0][0]).toMatchObject({
                                                               method: 'GET',
                                                               url: 'https://models.synthetic.invalid/v1/models',
                                                               header: { 'X-Trace': 'keep' },
                                                               proxyUrl: 'http://proxy.synthetic.invalid',
                                                           })
            expect(request.mock.calls[0][0].authIndex).toBeUndefined()
            expect(request.mock.calls[0][0].draftToken).toBeUndefined()
            expect(request.mock.calls[0][1]?.signal).toBe(signal)
        } finally {
            request.mockRestore();
            generation.mockRestore()
        }
    },
)

test('default discovery preserves the stored identity and anonymous fallback preserves the first failure', async () => {
    const generation = spyOn(apiClient, 'getAuthGeneration').mockReturnValue(7)
    const first      = new Error('synthetic first failure')
    const request    = spyOn(apiCallApi, 'request').mockRejectedValue(first)
    try {
        const { page, control } = mount()
        expect(page().props.fetchModels(new AbortController().signal)).rejects.toBe(first)
        expect(request).toHaveBeenCalledTimes(2)
        for (const [value] of request.mock.calls) {
            expect(value.authIndex).toBe('entry-index')
            expect(value.draftToken).toBe('synthetic-header')
            expect(value.header).toMatchObject({ Authorization: 'Bearer $TOKEN$', 'X-Trace': 'keep' })
        }
        request.mockClear()
        const second = new Error('synthetic second failure')
        request.mockRejectedValueOnce(first).mockRejectedValueOnce(second)
        control().props.onChange(true)
        expect(page().props.fetchModels(new AbortController().signal)).rejects.toBe(first)
        expect(request).toHaveBeenCalledTimes(2)
        expect(request.mock.calls[0][0].url).toEndWith('/v1/models')
        expect(request.mock.calls[1][0].url).toEndWith('/models')
        for (const [value] of request.mock.calls) {
            expect(value.authIndex).toBeUndefined()
            expect(value.draftToken).toBeUndefined()
            expect(value.header).toEqual({ 'X-Trace': 'keep' })
        }
    } finally {
        request.mockRestore();
        generation.mockRestore()
    }
})

test('an empty credential form requests explicit anonymous selection before sending a request', async () => {
    const generation = spyOn(apiClient, 'getAuthGeneration').mockReturnValue(7)
    const request    = spyOn(apiCallApi, 'request').mockResolvedValue({
                                                                          statusCode: 200,
                                                                          header: {},
                                                                          bodyText: '',
                                                                          body: { data: [] },
                                                                      })
    try {
        const { page, control } = mount(false)
        expect(page().props.fetchModels(new AbortController().signal)).rejects.toThrow(
            'ai_providers.openai_models_auth_required')
        expect(request).not.toHaveBeenCalled()
        control().props.onChange(true)
        expect(await page().props.fetchModels(new AbortController().signal)).toEqual([])
        expect(request).toHaveBeenCalledTimes(1)
    } finally {
        request.mockRestore();
        generation.mockRestore()
    }
})

test('anonymous endpoint recovery stops when the management connection changes', async () => {
    const generation = spyOn(apiClient, 'getAuthGeneration').mockReturnValue(7)
    const first      = new Error('synthetic connection changed')
    const request    = spyOn(apiCallApi, 'request').mockImplementationOnce(async () => {
        generation.mockReturnValue(8)
        throw first
    })
    try {
        const { page, control } = mount()
        control().props.onChange(true)
        expect(page().props.fetchModels(new AbortController().signal)).rejects.toBe(first)
        expect(request).toHaveBeenCalledTimes(1)
    } finally {
        request.mockRestore();
        generation.mockRestore()
    }
})

test(
    'explicit anonymous discovery rejects invalid successful responses and has visible labels in every language',
    async () => {
        const generation = spyOn(apiClient, 'getAuthGeneration').mockReturnValue(7)
        const request    = spyOn(apiCallApi, 'request').mockResolvedValue(
            {
                statusCode: 200,
                header: {},
                bodyText: '',
                body: /* language=TEXT */ '<html>login</html>',
            })
        try {
            const { page, control } = mount()
            control().props.onChange(true)
            expect(page().props.fetchModels(new AbortController().signal)).rejects.toThrow()
            expect(request).toHaveBeenCalledTimes(2)
        } finally {
            request.mockRestore();
            generation.mockRestore()
        }
        for (const language of ['en', 'ru', 'zh-CN', 'zh-TW']) {
            const locale = JSON.parse(readFileSync(
                new URL(`../src/i18n/locales/${language}.json`, import.meta.url),
                'utf8',
            ))
            expect(locale.ai_providers.openai_models_anonymous).toBeString()
            expect(locale.ai_providers.openai_models_anonymous_hint).toBeString()
        }
    },
)
