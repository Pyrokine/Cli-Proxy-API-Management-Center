import {describe, expect, test} from 'bun:test'
import type {PrefixProxyEditorState} from '@/features/authFiles/hooks/useAuthFilesPrefixProxyEditor'

const storage = {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
    clear: () => undefined,
    key: () => null,
    length: 0,
} satisfies Storage
Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true })
Object.defineProperty(globalThis, 'sessionStorage', { value: storage, configurable: true })

const { buildAuthFileFieldsPatch } = await import(
    '../src/features/authFiles/hooks/useAuthFilesPrefixProxyEditor'
    )

const editor = (overrides: Partial<PrefixProxyEditorState> = {}): PrefixProxyEditorState => ({
    fileName: 'xai.json',
    fileInfoText: '{}',
    loading: false,
    saving: false,
    readOnly: false,
    error: null,
    json: {
        headers: {
            Authorization: 'Bearer secret',
            'X-Visible': 'old',
        },
        using_api: true,
        disable_cooling: true,
        excluded_models: ['gpt-5-*'],
    },
    prefix: '',
    proxyUrl: '',
    priority: '',
    weight: '',
    weightError: null,
    note: '',
    noteTouched: false,
    headersText: '{"X-Visible":"new"}',
    headersTouched: true,
    headersError: null,
    disableCooling: false,
    disableCoolingTouched: true,
    requestRetry: undefined,
    requestRetryTouched: false,
    supportsUsingApi: true,
    usingApi: false,
    usingApiTouched: true,
    excludedModelsText: '',
    excludedModelsTouched: true,
    ...overrides,
})

describe('auth-file editor fields', () => {
    test('persists explicit false values and clears excluded models', () => {
        expect(buildAuthFileFieldsPatch(editor(), (key) => key)).toEqual({
                                                                             headers: { 'X-Visible': 'new' },
                                                                             disable_cooling: false,
                                                                             using_api: false,
                                                                             excluded_models: [],
                                                                         })
    })

    test('never sends hidden Authorization headers for deletion', () => {
        const patch = buildAuthFileFieldsPatch(editor(), (key) => key)
        expect(patch.headers).toEqual({ 'X-Visible': 'new' })
        expect(JSON.stringify(patch)).not.toContain('Bearer secret')
        expect(patch.headers?.Authorization).toBeUndefined()
    })

    test('rejects newly entered sensitive header names instead of silently ignoring them', () => {
        expect(() => buildAuthFileFieldsPatch(
            editor({ headersText: '{"Authorization":"Bearer new-secret"}' }),
            (key) => key,
        )).toThrow('auth_files.headers_sensitive_name')
    })
})
