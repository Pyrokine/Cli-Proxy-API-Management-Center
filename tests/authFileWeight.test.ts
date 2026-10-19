import {describe, expect, spyOn, test} from 'bun:test'

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

const { buildAuthFileFieldsPatch, isRuntimeOnlyAuthFile } = await import(
    '../src/features/authFiles/hooks/useAuthFilesPrefixProxyEditor'
    )
const { authFilesApi }                                    = await import('../src/services/api/authFiles')
const { apiClient }                                       = await import('../src/services/api/client')

const makeEditor = (json: Record<string, unknown>, weight: string): PrefixProxyEditorState => ({
    fileName: 'credential.json',
    fileInfoText: '',
    loading: false,
    saving: false,
    readOnly: false,
    error: null,
    json,
    prefix: '',
    proxyUrl: '',
    priority: '',
    weight,
    weightError: null,
    note: '',
    noteTouched: false,
    headersText: '',
    headersTouched: false,
    headersError: null,
    supportsModelAliases: true,
    modelAliasesText: '',
    modelAliasesTouched: false,
    modelAliasesError: null,
    requestRulesText: '',
    requestRulesTouched: false,
    requestRulesError: null,
    disableCooling: false,
    disableCoolingTouched: false,
    requestRetry: undefined,
    requestRetryTouched: false,
    supportsWebsockets: false,
    websockets: false,
    websocketsTouched: false,
    supportsUsingApi: false,
    usingApi: false,
    usingApiTouched: false,
    excludedModelsText: '',
    excludedModelsTouched: false,
})

describe('auth-file credential weight patch', () => {
    test('preserves explicit zero instead of applying priority deletion semantics', () => {
        expect(buildAuthFileFieldsPatch(makeEditor({ weight: 4 }, '0'), (key) => key)).toEqual({ weight: 0 })
    })

    test('uses null to restore the default weight', () => {
        expect(buildAuthFileFieldsPatch(makeEditor({ weight: 4 }, ''), (key) => key)).toEqual({ weight: null })
    })

    test('rejects fractional and oversized weights', () => {
        expect(() => buildAuthFileFieldsPatch(makeEditor({}, '1.5'), (key) => key))
            .toThrow('auth_files.weight_integer_error')
        expect(() => buildAuthFileFieldsPatch(makeEditor({}, '1000001'), (key) => key))
            .toThrow('auth_files.weight_max_error')
    })

    test('saves priority and weight through the auth-file fields endpoint', async () => {
        const patch = spyOn(apiClient, 'patch').mockResolvedValue({ status: 'ok' })
        try {
            await authFilesApi.patchFields('credential.json', { priority: 20, weight: 3 })
            expect(patch).toHaveBeenCalledWith('/auth-files/fields', {
                name: 'credential.json',
                priority: 20,
                weight: 3,
            })
        } finally {
            patch.mockRestore()
        }
    })

    test('keeps runtime-only credentials read-only without discarding displayed values', () => {
        const readOnlyEditor = {
            ...makeEditor({ priority: 4, weight: 2 }, '8'),
            readOnly: true,
            priority: '9',
        }
        expect(isRuntimeOnlyAuthFile({ name: 'home.json', runtimeOnly: 'true' })).toBe(true)
        expect(isRuntimeOnlyAuthFile({ name: 'file.json', runtimeOnly: false })).toBe(false)
        expect(buildAuthFileFieldsPatch(readOnlyEditor, (key) => key)).toEqual({})
        expect(readOnlyEditor).toMatchObject({ priority: '9', weight: '8' })
    })
})
