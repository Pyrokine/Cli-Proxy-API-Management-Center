import {modelsApi} from '@/services/api/models'
import {hasHeader} from '@/utils/headers'
import {getErrorMessage} from '@/utils/helpers'
import type {ModelInfo} from '@/utils/models'
import {expect, mock, test} from 'bun:test'
import {readFileSync} from 'node:fs'
import React, {type ReactElement, type ReactNode} from 'react'
import {sourceCallback} from './sourceCallbacks'

type DiscoveryConfig = {
    i18nPrefix: string
    buildEndpoint: (url: string) => string
    fetchModels: (
        url: string,
        key: string | undefined,
        headers: Record<string, string>,
        proxy: string | undefined,
        signal: AbortSignal,
    ) => Promise<ModelInfo[]>
    canAutoFetch: (key: string, headers: Record<string, string>) => boolean
    buildErrorMessage: (error: unknown) => string
}

function editor() {
    const request   = mock(async () => [{ name: 'grok-fixture' }])
    const form      = {
        apiKey: 'synthetic-key',
        authIndex: 'synthetic-index',
        baseUrl: 'https://api.x.ai/v1',
        proxyUrl: 'http://proxy.invalid',
        headers: [],
        modelEntries: [],
        excludedText: '',
    }
    const flags     = {
        disableControls: false,
        saving: false,
        loading: false,
        invalidIndexParam: false,
        invalidIndex: false,
    }
    const section   = () => null
    const discovery = {
        open: false, canOpen: true, setOpen: mock(() => {
        }), fetchDiscovery: mock(async () => {
        }), applySelected: mock(() => {
        }),
    }
    let config: DiscoveryConfig | undefined
    const Page      = sourceCallback<() => ReactElement<{ children: ReactNode }>>(
        'pages/AiProvidersXAIEditPage.tsx',
        'AiProvidersXAIEditPage',
        {
            React,
            useTranslation: () => ({ t: (key: string) => key }),
            buildEmptyForm: () => form,
            buildSignature: () => '',
            providersApi: {},
            useProviderEditForm: () => ({
                ...flags,
                form,
                setForm: mock(() => {
                }),
                disabled: false,
                canSave: true,
            }),
            useModelDiscovery: (
                _form: unknown,
                _setForm: unknown,
                _flags: unknown,
                configured: DiscoveryConfig,
            ) => {
                config = configured;
                return discovery
            },
            modelsApi: {
                ...modelsApi,
                fetchV1ModelsViaApiCall: request,
            },
            hasHeader,
            getErrorMessage,
            DEFAULT_XAI_BASE_URL: 'https://api.x.ai/v1',
            ProviderEditShell: () => null,
            ProviderConnectionFields: () => null,
            ToggleSwitch: () => null,
            ModelInputList: () => null,
            ExcludedModelsField: () => null,
            ProviderModelSection: section,
        },
    )
    const tree      = Page()
    return { config, request, discovery, form, section, tree }
}

test('xAI model discovery is connected to the actual shared section and starts from its explicit action', () => {
    const current = editor()
    expect(current.request).not.toHaveBeenCalled()
    expect(current.config?.i18nPrefix).toBe('xai')
    const node = React.Children.toArray(current.tree.props.children).find((child) => React.isValidElement(child) &&
                                                                                     child.type ===
                                                                                     current.section)
    if (!React.isValidElement<Record<string, unknown>>(node)) {
        throw new Error('xAI model discovery section is missing')
    }
    expect(node.props.discovery).toBe(current.discovery)
    expect(node.props.form).toBe(current.form)
    expect(node.props.i18nPrefix).toBe('xai')
    const Models   = () => null
    const Modal    = () => null
    const Section  = sourceCallback<(props: Record<string, unknown>) => ReactElement<{ children: ReactNode }>>(
        'pages/ProviderFormFields.tsx',
        'ProviderModelSection',
        {
            React, ModelConfigSection: Models, ModelDiscoveryModal: Modal, ExcludedModelsField: () => null,
        },
    )
    const children = React.Children.toArray(Section(node.props).props.children)
    const action   = children.find((child) => React.isValidElement(child) && child.type === Models) as ReactElement<{
        onDiscovery: () => void
    }>
    action.props.onDiscovery()
    expect(current.discovery.setOpen).toHaveBeenCalledWith(true)
    expect(current.request).not.toHaveBeenCalled()
    const modal = children.find((child) => React.isValidElement(child) && child.type === Modal) as ReactElement<{
        onRefresh: () => void
    }>
    modal.props.onRefresh()
    expect(current.discovery.fetchDiscovery).toHaveBeenCalledTimes(1)
})

test(
    'xAI discovery preserves the configured identity, headers, proxy and cancellation without a chat probe',
    async () => {
        const current = editor()
        const config  = current.config
        if (!config) {
            throw new Error('xAI model discovery configuration is missing')
        }
        expect(config.buildEndpoint('https://api.x.ai/v1')).toBe('https://api.x.ai/v1/models')
        const signal  = new AbortController().signal
        const headers = { 'X-Fixture': 'keep' }
        expect(config.fetchModels(
            current.form.baseUrl,
            current.form.apiKey,
            headers,
            current.form.proxyUrl,
            signal,
        )).resolves.toEqual([{ name: 'grok-fixture' }])
        expect(current.request).toHaveBeenCalledWith(
            current.form.baseUrl,
            'synthetic-key',
            headers,
            'http://proxy.invalid',
            'synthetic-index',
            signal,
        )
        const custom = { authorization: 'Bearer synthetic-custom', 'X-Fixture': 'keep' }
        await config.fetchModels(current.form.baseUrl, current.form.apiKey, custom, undefined, signal)
        expect(current.request).toHaveBeenLastCalledWith(
            current.form.baseUrl,
            undefined,
            custom,
            undefined,
            'synthetic-index',
            signal,
        )
        expect(config.canAutoFetch('', {})).toBe(true)
        expect(config.buildErrorMessage(new Error('synthetic rejection'))).toContain('synthetic rejection')
    },
)

test('xAI discovery has complete labels in all four languages', () => {
    const suffixes = [
        'button',
        'title',
        'hint',
        'url_label',
        'refresh',
        'loading',
        'empty',
        'error',
        'apply',
        'search_label',
        'search_placeholder',
        'search_empty',
        'added',
    ]
    for (const language of ['en', 'ru', 'zh-CN', 'zh-TW']) {
        const locale = JSON.parse(readFileSync(
            new URL(`../src/i18n/locales/${language}.json`, import.meta.url),
            'utf8',
        ))
        for (const suffix of suffixes) {
            const key   = suffix.startsWith('search_') ? `xai_models_${suffix}` : `xai_models_fetch_${suffix}`
            const value = locale.ai_providers[key]
            expect(typeof value).toBe('string')
            expect(value.trim().length).toBeGreaterThan(0)
        }
    }
})
