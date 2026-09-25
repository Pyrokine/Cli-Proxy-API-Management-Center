import {describe, expect, spyOn, test} from 'bun:test'
import * as React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import type {PrefixProxyEditorState} from '@/features/authFiles/hooks/useAuthFilesPrefixProxyEditor'
import type {AuthFileItem} from '@/types/authFile'
import {readAuthFileDisableCooling, readAuthFileRequestRetry} from '@/features/authFiles/constants'
import {buildSafeAuthFileDisplayInfo} from '@/features/authFiles/identity'
import {applyAuthFileMutation} from '@/components/credentials/credentialsDataLifecycle'

const storage = {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
    clear: () => undefined,
    key: () => null,
    length: 0,
} satisfies Storage
Object.defineProperty(globalThis, 'localStorage', {value: storage, configurable: true})
Object.defineProperty(globalThis, 'sessionStorage', {value: storage, configurable: true})

const {buildAuthFileFieldsPatch, useAuthFilesPrefixProxyEditor} = await import('@/features/authFiles/hooks/useAuthFilesPrefixProxyEditor')
const {authFilesApi, normalizeAuthFilesResponse} = await import('@/services/api/authFiles')
const {apiClient} = await import('@/services/api/client')

const editor = (
    json: Record<string, unknown> = {},
    overrides: Partial<PrefixProxyEditorState> = {},
): PrefixProxyEditorState => ({
    fileName: 'synthetic.json', fileInfoText: '', loading: false, saving: false, readOnly: false,
    error: null, json, prefix: '', proxyUrl: '', priority: '', weight: '', weightError: null,
    note: '', noteTouched: false, headersText: '', headersTouched: false, headersError: null,
    disableCooling: readAuthFileDisableCooling(json), disableCoolingTouched: false,
    requestRetry: readAuthFileRequestRetry(json), requestRetryTouched: false,
    supportsUsingApi: false, usingApi: false, usingApiTouched: false,
    excludedModelsText: '', excludedModelsTouched: false,
    ...overrides,
})
const patch = (state: PrefixProxyEditorState) => buildAuthFileFieldsPatch(state, (key) => key)
const normalize = (entry: Record<string, unknown>) =>
    normalizeAuthFilesResponse({files: [{name: 'synthetic.json', ...entry}]}).files[0]
const mutate = (file: AuthFileItem, fields: Parameters<typeof authFilesApi.patchFields>[1]) =>
    applyAuthFileMutation([file], {kind: 'fields', name: file.name, fields})[0]

describe('auth-file credential overrides', () => {
    test('untouched inherited settings never become explicit overrides', () => {
        expect(patch(editor())).toEqual({})
        expect(patch(editor({}, {disableCooling: false, requestRetry: 0}))).toEqual({})
        expect(patch(editor({disable_cooling: true, request_retry: 4}))).toEqual({})
    })

    test('distinguishes inherit from explicit cooling enable and retry zero', () => {
        expect(patch(editor({}, {
            disableCooling: false, disableCoolingTouched: true,
            requestRetry: 0, requestRetryTouched: true,
        }))).toEqual({disable_cooling: false, request_retry: 0})
        expect(patch(editor({disable_cooling: false, request_retry: 0}, {
            disableCooling: undefined, disableCoolingTouched: true,
            requestRetry: undefined, requestRetryTouched: true,
        }))).toEqual({disable_cooling: null, request_retry: null})
    })

    test('keeps override changes independent and does not materialize using_api', () => {
        expect(patch(editor({}, {disableCooling: true, disableCoolingTouched: true})))
            .toEqual({disable_cooling: true})
        expect(patch(editor({}, {requestRetry: 4, requestRetryTouched: true})))
            .toEqual({request_retry: 4})
        expect(patch(editor({disable_cooling: false, request_retry: 0}, {
            disableCoolingTouched: true, requestRetryTouched: true,
        }))).toEqual({})
    })

    test('negative safe integers restore inheritance and readonly editors never patch', () => {
        for (const requestRetry of [-1, Number.MIN_SAFE_INTEGER]) {
            expect(patch(editor({'request-retry': 3}, {requestRetry, requestRetryTouched: true})))
                .toEqual({request_retry: null})
        }
        expect(patch(editor({}, {
            readOnly: true, disableCooling: true, disableCoolingTouched: true,
            requestRetry: NaN, requestRetryTouched: true,
        }))).toEqual({})
    })

    test('validates retry input without silently dropping malformed edits', () => {
        for (const requestRetry of [NaN, Infinity, -Infinity, 1.5, -1.5,
            Number.MAX_SAFE_INTEGER + 1, Number.MIN_SAFE_INTEGER - 1]) {
            expect(() => patch(editor({}, {requestRetry, requestRetryTouched: true})))
                .toThrow('auth_files.request_retry_invalid')
        }
        expect(patch(editor({}, {requestRetry: Number.MAX_SAFE_INTEGER, requestRetryTouched: true})))
            .toEqual({request_retry: Number.MAX_SAFE_INTEGER})
    })

    test('canonical presence wins over every legacy alias including null and negative retry', () => {
        for (const value of [null, undefined]) {
            const file = normalize({
                disable_cooling: value, 'disable-cooling': true, disableCooling: true,
                request_retry: value, 'request-retry': 7, requestRetry: 8,
            })
            expect(file.disableCooling).toBeUndefined()
            expect(file.requestRetry).toBeUndefined()
            expect(readAuthFileDisableCooling(file)).toBeUndefined()
            expect(readAuthFileRequestRetry(file)).toBeUndefined()
        }
        expect(normalize({request_retry: -1, 'request-retry': 5}).requestRetry).toBeUndefined()
        expect(normalize({disable_cooling: false, 'disable-cooling': true}).disableCooling).toBe(false)
        expect(normalize({request_retry: 0, 'request-retry': 5}).requestRetry).toBe(0)
        expect(normalize({'disable-cooling': null, disableCooling: true}).disableCooling).toBeUndefined()
        expect(normalize({'request-retry': -1, requestRetry: 5}).requestRetry).toBeUndefined()
    })

    test('reads supported legacy aliases without changing global number or boolean semantics', () => {
        expect(normalize({'disable-cooling': 'false', 'request-retry': '3'}))
            .toMatchObject({disableCooling: false, requestRetry: 3})
        expect(normalize({disableCooling: true, requestRetry: 0}))
            .toMatchObject({disableCooling: true, requestRetry: 0})
        for (const value of [NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1, '1.5', 'NaN']) {
            expect(normalize({request_retry: value, 'request-retry': 3}).requestRetry).toBeUndefined()
        }
    })

    test('duplicate runtime rows cannot restore a cleared or inherited disk override', () => {
        for (const diskFields of [{}, {disable_cooling: null, request_retry: null}, {request_retry: -1}]) {
            const disk = {name: 'synthetic.json', source: 'file', ...diskFields}
            const runtime = {
                name: 'synthetic.json', source: 'memory',
                'disable-cooling': true, 'request-retry': 6,
            }
            for (const files of [[disk, runtime], [runtime, disk]]) {
                const [file] = normalizeAuthFilesResponse({files}).files
                expect(readAuthFileDisableCooling(file)).toBeUndefined()
                expect(readAuthFileRequestRetry(file)).toBeUndefined()
            }
        }
    })

    test('sends sparse API patches, explicit clears, and negative retry clears without real requests', async () => {
        const request = spyOn(apiClient, 'patch').mockResolvedValue({status: 'ok'})
        try {
            await authFilesApi.patchFields('synthetic.json', {disable_cooling: false, request_retry: 0})
            expect(request).toHaveBeenLastCalledWith('/auth-files/fields', {
                name: 'synthetic.json', disable_cooling: false, request_retry: 0,
            })
            await authFilesApi.patchFields('synthetic.json', {disable_cooling: null, request_retry: -1})
            expect(request).toHaveBeenLastCalledWith('/auth-files/fields', {
                name: 'synthetic.json', disable_cooling: null, request_retry: null,
            })
            await authFilesApi.patchFields('synthetic.json', {note: 'synthetic'})
            expect(request).toHaveBeenLastCalledWith('/auth-files/fields', {
                name: 'synthetic.json', note: 'synthetic',
            })
            for (const request_retry of [NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
                expect(() => authFilesApi.patchFields('synthetic.json', {request_retry}))
                    .toThrow('auth_files.request_retry_invalid')
            }
            expect(request).toHaveBeenCalledTimes(3)
        } finally {
            request.mockRestore()
        }
    })

    test('sends exact runtime identity for status and field mutations', async () => {
        const request = spyOn(apiClient, 'patch').mockResolvedValue({status: 'ok', disabled: true})
        try {
            await authFilesApi.setStatus('devin-shared.json', true, ' devin-a ')
            expect(request).toHaveBeenLastCalledWith('/auth-files/status', {
                name: 'devin-shared.json', disabled: true, auth_index: 'devin-a',
            })

            await authFilesApi.patchFields('devin-shared.json', {priority: 7}, ' devin-b ')
            expect(request).toHaveBeenLastCalledWith('/auth-files/fields', {
                name: 'devin-shared.json', 'auth-index': 'devin-b', priority: 7,
            })
        } finally {
            request.mockRestore()
        }
    })

    test('cache clearing deletes every alias and stays inherited after normalization and editor reopen', () => {
        const file: AuthFileItem = {
            name: 'synthetic.json', disable_cooling: false, 'disable-cooling': true, disableCooling: true,
            request_retry: 0, 'request-retry': 7, requestRetry: 8,
        }
        expect(mutate(file, {})).toEqual(file)
        for (const request_retry of [null, -1]) {
            const cleared = mutate(file, {disable_cooling: null, request_retry})
            for (const key of ['disable_cooling', 'disable-cooling', 'disableCooling',
                'request_retry', 'request-retry', 'requestRetry']) {
                expect(Object.prototype.hasOwnProperty.call(cleared, key)).toBe(false)
            }
            const normalized = normalize(cleared)
            expect(normalized.disableCooling).toBeUndefined()
            expect(normalized.requestRetry).toBeUndefined()
            expect(patch(editor(normalized))).toEqual({})
        }
        const overridden = mutate(file, {disable_cooling: false, request_retry: 0})
        expect(normalize(overridden)).toMatchObject({disableCooling: false, requestRetry: 0})
        expect(patch(editor(overridden))).toEqual({})
        expect(file['request-retry']).toBe(7)
        expect(() => mutate(file, {request_retry: NaN})).toThrow('auth_files.request_retry_invalid')
    })

    test('safe display shows only normalized override values and no sensitive metadata', () => {
        expect(buildSafeAuthFileDisplayInfo({
            name: 'synthetic.json', 'disable-cooling': false, 'request-retry': 0,
            access_token: 'synthetic-secret', metadata: {request_retry: 99, token: 'synthetic-secret'},
        })).toEqual({name: 'synthetic.json', disableCooling: false, requestRetry: 0})
        expect(buildSafeAuthFileDisplayInfo({
            name: 'synthetic.json', disable_cooling: null, disableCooling: true,
            request_retry: -1, requestRetry: 3,
        })).toEqual({name: 'synthetic.json'})
    })
})


describe('auth-file override hook lifecycle', () => {
    test('keeps late same-file downloads bound to their runtime identity', async () => {
        let state: PrefixProxyEditorState | null = null
        let hook!: ReturnType<typeof useAuthFilesPrefixProxyEditor>
        const originalUseState = React.useState
        const setState = (value: React.SetStateAction<PrefixProxyEditorState | null>) => {
            state = typeof value === 'function' ? value(state) : value
        }
        const useState = spyOn(React, 'useState').mockImplementation(((initial: unknown) =>
            initial === null ? [state, setState] : originalUseState(initial)
        ) as typeof React.useState)
        const pending: Array<(value: string) => void> = []
        const download = spyOn(authFilesApi, 'downloadText').mockImplementation(
            () => new Promise<string>((resolve) => pending.push(resolve)),
        )
        const Probe = () => {
            hook = useAuthFilesPrefixProxyEditor({
                disableControls: false,
                completeMutation: async () => {},
            })
            return null
        }
        const render = () => renderToStaticMarkup(React.createElement(Probe))
        try {
            render()
            const first = hook.openPrefixProxyEditor({name: 'devin-shared.json', authIndex: 'devin-a'})
            render()
            const second = hook.openPrefixProxyEditor({name: 'devin-shared.json', authIndex: 'devin-b'})
            render()

            pending[0]?.(JSON.stringify({priority: 1}))
            await first
            render()
            expect(hook.prefixProxyEditor).toMatchObject({
                authIndex: 'devin-b', loading: true, priority: '',
            })

            pending[1]?.(JSON.stringify({priority: 2}))
            await second
            render()
            expect(hook.prefixProxyEditor).toMatchObject({
                authIndex: 'devin-b', loading: false, priority: '2',
            })
        } finally {
            useState.mockRestore()
            download.mockRestore()
        }
    })

    test('loads all branches, changes only touched fields, and blocks invalid retry without render errors', async () => {
        let state: PrefixProxyEditorState | null = null
        let hook!: ReturnType<typeof useAuthFilesPrefixProxyEditor>
        const originalUseState = React.useState
        const setState = (value: React.SetStateAction<PrefixProxyEditorState | null>) => {
            state = typeof value === 'function' ? value(state) : value
        }
        const useState = spyOn(React, 'useState').mockImplementation(((initial: unknown) =>
            initial === null ? [state, setState] : originalUseState(initial)
        ) as typeof React.useState)
        const download = spyOn(authFilesApi, 'downloadText').mockResolvedValue(JSON.stringify({
            disable_cooling: null, 'disable-cooling': true, request_retry: -1, 'request-retry': 5,
        }))
        const request = spyOn(apiClient, 'patch').mockResolvedValue({status: 'ok'})
        const mutations: unknown[] = []
        const Probe = () => {
            hook = useAuthFilesPrefixProxyEditor({
                disableControls: false,
                completeMutation: async (name, fields, authIndex) => { mutations.push({name, authIndex, fields}) },
            })
            return null
        }
        const render = () => renderToStaticMarkup(React.createElement(Probe))
        try {
            render()
            await hook.openPrefixProxyEditor({name: 'runtime.json', runtimeOnly: true})
            render()
            expect(hook.prefixProxyEditor).toMatchObject({
                readOnly: true, requestRetry: undefined, requestRetryTouched: false,
                disableCooling: undefined, disableCoolingTouched: false,
            })
            hook.handlePrefixProxyOverridesChange({disableCooling: false, requestRetry: 0})
            render()
            expect(hook.prefixProxyDirty).toBe(false)
            await hook.handlePrefixProxySave()
            expect(request).not.toHaveBeenCalled()
            expect(download).not.toHaveBeenCalled()
            hook.closePrefixProxyEditor()
            render()

            const loading = hook.openPrefixProxyEditor({name: 'synthetic.json', authIndex: 'devin-a'})
            render()
            expect(hook.prefixProxyEditor).toMatchObject({
                authIndex: 'devin-a', loading: true, requestRetryTouched: false, disableCoolingTouched: false,
            })
            await loading
            render()
            expect(hook.prefixProxyEditor).toMatchObject({
                loading: false, requestRetry: undefined, requestRetryTouched: false,
                disableCooling: undefined, disableCoolingTouched: false,
            })
            expect(hook.prefixProxyDirty).toBe(false)
            hook.handlePrefixProxyOverridesChange({disableCooling: false})
            render()
            expect(hook.prefixProxyEditor).toMatchObject({
                disableCooling: false, disableCoolingTouched: true, requestRetryTouched: false,
            })
            hook.handlePrefixProxyOverridesChange({requestRetry: NaN})
            expect(render).not.toThrow()
            expect(hook.prefixProxyDirty).toBe(true)
            await hook.handlePrefixProxySave()
            expect(request).not.toHaveBeenCalled()
            hook.handlePrefixProxyOverridesChange({requestRetry: 0})
            render()
            expect(hook.prefixProxyEditor).toMatchObject({
                disableCooling: false, requestRetry: 0, requestRetryTouched: true,
            })
            await hook.handlePrefixProxySave()
            expect(request).toHaveBeenLastCalledWith('/auth-files/fields', {
                name: 'synthetic.json', 'auth-index': 'devin-a', disable_cooling: false, request_retry: 0,
            })
            expect(mutations).toEqual([{
                name: 'synthetic.json',
                authIndex: 'devin-a',
                fields: {disable_cooling: false, request_retry: 0},
            }])
            render()
            expect(hook.prefixProxyEditor).toBeNull()
        } finally {
            useState.mockRestore()
            download.mockRestore()
            request.mockRestore()
        }
    })
})
