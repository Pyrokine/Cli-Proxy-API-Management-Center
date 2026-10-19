import {describe, expect, mock, spyOn, test} from 'bun:test'
import * as React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import type {PrefixProxyEditorState} from '@/features/authFiles/hooks/useAuthFilesPrefixProxyEditor'

const storage = {
    getItem: () => null, setItem: () => undefined, removeItem: () => undefined,
    clear: () => undefined, key: () => null, length: 0,
} satisfies Storage
Object.defineProperty(globalThis, 'localStorage', {value: storage, configurable: true})
Object.defineProperty(globalThis, 'sessionStorage', {value: storage, configurable: true})

const {useAuthFilesPrefixProxyEditor} = await import('@/features/authFiles/hooks/useAuthFilesPrefixProxyEditor')
const {authFilesApi} = await import('@/services/api/authFiles')
const {apiClient} = await import('@/services/api/client')
const {useNotificationStore} = await import('@/stores')

function deferred<T>() {
    let resolve!: (value: T) => void
    let reject!: (reason: unknown) => void
    const promise = new Promise<T>((accept, decline) => {resolve = accept; reject = decline})
    return {promise, resolve, reject}
}

function createEditor() {
    let state: PrefixProxyEditorState | null = null
    let hook!: ReturnType<typeof useAuthFilesPrefixProxyEditor>
    const editorRef: React.RefObject<{authGeneration: number} | null> = {current: {authGeneration: 1}}
    const originalUseState = React.useState
    const originalUseRef = React.useRef
    const effects: React.EffectCallback[] = []
    const setState = (value: React.SetStateAction<PrefixProxyEditorState | null>) => {
        state = typeof value === 'function' ? value(state) : value
    }
    const useState = spyOn(React, 'useState').mockImplementation(((initial: unknown) =>
        initial === null ? [state, setState] : originalUseState(initial)
    ) as typeof React.useState)
    const useRef = spyOn(React, 'useRef').mockImplementation(((initial: unknown) =>
        initial && typeof initial === 'object' && 'authGeneration' in initial
            ? editorRef : originalUseRef(initial)
    ) as typeof React.useRef)
    const useEffect = spyOn(React, 'useEffect').mockImplementation((effect, deps) => {
        if (deps?.length === 0) {
            effects.push(effect)
        }
    })
    const generation = spyOn(apiClient, 'getAuthGeneration').mockReturnValue(1)
    const downloads: ReturnType<typeof deferred<string>>[] = []
    const writes: ReturnType<typeof deferred<unknown>>[] = []
    const download = spyOn(authFilesApi, 'downloadText').mockImplementation(() => {
        const work = deferred<string>()
        downloads.push(work)
        return work.promise
    })
    const request = spyOn(apiClient, 'patch').mockImplementation(<T>() => {
        const work = deferred<unknown>()
        writes.push(work)
        return work.promise as Promise<T>
    })
    const completeMutation = mock(async () => {})
    const notification = spyOn(useNotificationStore.getInitialState(), 'showNotification').mockImplementation(() => {})
    const Probe = () => {
        hook = useAuthFilesPrefixProxyEditor({disableControls: false, completeMutation})
        return null
    }
    const render = () => {
        renderToStaticMarkup(React.createElement(Probe))
        return hook
    }
    render()
    const cleanups = effects.map((effect) => effect()).filter((cleanup) => typeof cleanup === 'function')
    const file = {name: 'shared.json', authIndex: 'shared-auth', type: 'codex'}
    const open = () => hook.openPrefixProxyEditor(file)
    const prepareDraft = async () => {
        const pending = open()
        downloads[downloads.length - 1]!.resolve(JSON.stringify({prefix: 'original'}))
        await pending
        render().handlePrefixProxyChange('prefix', 'draft')
        render()
    }
    return {
        get hook() {return hook}, get state() {return state},
        render, open, prepareDraft, downloads, writes, request, notification, generation, completeMutation,
        unmount: () => cleanups.forEach((cleanup) => cleanup()),
        restore: () => {
            useState.mockRestore()
            useRef.mockRestore()
            useEffect.mockRestore()
            download.mockRestore()
            request.mockRestore()
            generation.mockRestore()
            notification.mockRestore()
        },
    }
}

const finishDownload = (work: ReturnType<typeof deferred<string>>, outcome: string) => {
    if (outcome === 'failure') {
        work.reject(new Error('synthetic old download failed'))
    } else {
        work.resolve(outcome === 'invalid-json' ? '{' : outcome === 'invalid-object' ? '[]' : '{"prefix":"old"}')
    }
}

describe('auth-file editor request ownership', () => {
    for (const boundary of ['reopen', 'connection', 'connection-only', 'unmount'] as const) {
        for (const outcome of ['success', 'invalid-json', 'invalid-object', 'failure']) {
            test(`ignores an old ${outcome} download after ${boundary}`, async () => {
                const editor = createEditor()
                try {
                    const old = editor.open()
                    editor.render()
                    if (boundary === 'unmount') {
                        editor.unmount()
                    } else {
                        if (boundary === 'reopen') {
                            editor.hook.closePrefixProxyEditor()
                        } else {
                            editor.generation.mockReturnValue(3)
                        }
                        editor.render()
                    }
                    const newer = boundary === 'unmount' || boundary === 'connection-only' ? null : editor.open()
                    editor.render()
                    const expected = editor.state
                    finishDownload(editor.downloads[0]!, outcome)
                    await old
                    expect(editor.state).toBe(expected)
                    expect(editor.notification).not.toHaveBeenCalled()
                    if (newer) {
                        expect(editor.render().prefixProxyEditor).toMatchObject({loading: true, prefix: '', error: null})
                        editor.downloads[1]!.resolve('{"prefix":"new"}')
                        await newer
                        expect(editor.render().prefixProxyEditor).toMatchObject({loading: false, prefix: 'new', error: null})
                    }
                } finally {
                    editor.restore()
                }
            })
        }
    }

    test('hides an old connection draft and rejects its save and field callbacks', async () => {
        const editor = createEditor()
        try {
            await editor.prepareDraft()
            const old = editor.hook
            const expected = editor.state
            editor.generation.mockReturnValue(3)
            expect(editor.render().prefixProxyEditor).toBeNull()
            expect(editor.hook.prefixProxyDirty).toBe(false)
            old.handlePrefixProxyChange('prefix', 'changed')
            old.handlePrefixProxyBooleanChange('websockets', true)
            old.handlePrefixProxyOverridesChange({requestRetry: 5})
            await old.handlePrefixProxySave()
            await editor.hook.handlePrefixProxySave()
            expect(editor.state).toBe(expected)
            expect(editor.request).not.toHaveBeenCalled()
            expect(editor.completeMutation).not.toHaveBeenCalled()
            expect(editor.notification).not.toHaveBeenCalled()
        } finally {
            editor.restore()
        }
    })

    for (const phase of ['patch', 'reload'] as const) {
        for (const outcome of ['success', 'failure'] as const) {
            test(`ignores an old save ${outcome} when the connection changes during ${phase}`, async () => {
                const editor = createEditor()
                const reload = deferred<void>()
                const started = deferred<void>()
                try {
                    await editor.prepareDraft()
                    if (phase === 'reload') {
                        editor.completeMutation.mockImplementation(() => {started.resolve(); return reload.promise})
                    }
                    const pending = editor.hook.handlePrefixProxySave()
                    if (phase === 'reload') {
                        editor.writes[0]!.resolve({status: 'ok'})
                        await started.promise
                    }
                    editor.generation.mockReturnValue(3)
                    editor.hook.closePrefixProxyEditor()
                    editor.render()
                    const newer = editor.open()
                    editor.downloads[1]!.resolve('{"prefix":"new"}')
                    await newer
                    editor.render()
                    const expected = editor.state
                    const work = phase === 'patch' ? editor.writes[0]! : reload
                    if (outcome === 'failure') {
                        work.reject(new Error('synthetic old save failed'))
                    } else {
                        work.resolve(undefined)
                    }
                    await pending
                    expect(editor.state).toBe(expected)
                    expect(editor.notification).not.toHaveBeenCalled()
                    expect(editor.completeMutation).toHaveBeenCalledTimes(phase === 'reload' ? 1 : 0)
                } finally {
                    editor.restore()
                }
            })
        }
    }

    for (const boundary of ['reopen', 'unmount'] as const) {
        for (const outcome of ['success', 'failure'] as const) {
            test(`ignores an old save ${outcome} after ${boundary} without a connection change`, async () => {
                const editor = createEditor()
                try {
                    await editor.prepareDraft()
                    const old = editor.hook
                    const pending = old.handlePrefixProxySave()
                    if (boundary === 'unmount') {
                        editor.unmount()
                    } else {
                        editor.render().closePrefixProxyEditor()
                        editor.render()
                        const newer = editor.open()
                        editor.downloads[1]!.resolve('{"prefix":"new"}')
                        await newer
                        editor.render()
                    }
                    const expected = editor.state
                    old.closePrefixProxyEditor()
                    old.handlePrefixProxyChange('prefix', 'old change')
                    if (outcome === 'failure') {
                        editor.writes[0]!.reject(new Error('synthetic old save failed'))
                    } else {
                        editor.writes[0]!.resolve({status: 'ok'})
                    }
                    await pending
                    expect(editor.state).toBe(expected)
                    expect(editor.completeMutation).not.toHaveBeenCalled()
                    expect(editor.notification).not.toHaveBeenCalled()
                } finally {
                    editor.restore()
                }
            })
        }
    }

    test('reports a current download failure and permits a new load', async () => {
        const editor = createEditor()
        try {
            const pending = editor.open()
            editor.downloads[0]!.reject(new Error('synthetic current download failed'))
            await pending
            expect(editor.render().prefixProxyEditor).toMatchObject({loading: false, error: 'synthetic current download failed'})
            expect(editor.notification).toHaveBeenCalledWith(expect.stringContaining('synthetic current download failed'), 'error')
            editor.hook.closePrefixProxyEditor()
            editor.render()
            const retry = editor.open()
            editor.downloads[1]!.resolve('{"prefix":"current"}')
            await retry
            expect(editor.render().prefixProxyEditor).toMatchObject({loading: false, error: null, prefix: 'current'})
        } finally {
            editor.restore()
        }
    })

    test('keeps one pending save and reports a current failure without losing the draft', async () => {
        const editor = createEditor()
        try {
            await editor.prepareDraft()
            const first = editor.hook.handlePrefixProxySave()
            const second = editor.hook.handlePrefixProxySave()
            expect(editor.request).toHaveBeenCalledTimes(1)
            await second
            editor.writes[0]!.reject(new Error('synthetic current failure'))
            await first
            expect(editor.render().prefixProxyEditor).toMatchObject({prefix: 'draft', saving: false})
            expect(editor.notification).toHaveBeenCalledTimes(1)
            expect(editor.notification).toHaveBeenCalledWith(expect.stringContaining('synthetic current failure'), 'error')
            const retry = editor.hook.handlePrefixProxySave()
            editor.writes[1]!.resolve({status: 'ok'})
            await retry
            expect(editor.completeMutation).toHaveBeenCalledTimes(1)
            expect(editor.notification).toHaveBeenCalledTimes(2)
            expect(editor.render().prefixProxyEditor).toBeNull()
        } finally {
            editor.restore()
        }
    })
})
