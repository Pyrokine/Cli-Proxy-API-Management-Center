import i18n from '@/i18n'
import {waitForPluginRuntimeState} from '@/pages/pluginPolling'
import {apiClient} from '@/services/api/client'
import {
    type PluginConfigField,
    type PluginConfigObject,
    type PluginConfigValue,
    type PluginEntry,
    pluginsApi,
} from '@/services/api/plugins'
import {expect, mock, spyOn, test} from 'bun:test'
import React, {type ReactElement, type SetStateAction} from 'react'
import {sourceCallback, sourceInitializer} from './sourceCallbacks'

const file                        = 'pages/PluginManagementPage.tsx'
const fields: PluginConfigField[] = [
    { name: 'mixed', type: 'array', enum_values: [], description: '' },
    { name: 'optional', type: 'boolean', enum_values: [], description: '' },
    { name: 'label', type: 'string', enum_values: [], description: '' },
]

function editor(initial: PluginConfigObject) {
    const remoteConfig                    = structuredClone(initial)
    let configDraft: PluginConfigObject   = {}
    let jsonDraft: Record<string, string> = {}
    let editingPlugin: PluginEntry | null = null
    let configReadState                   = 'loading'
    let current                           = true
    const plugin: PluginEntry             = {
        id: 'fixture',
        path: '',
        configured: true,
        registered: true,
        enabled: true,
        effective_enabled: true,
        supports_oauth: false,
        logo: '',
        config: {},
        config_fields: fields,
        menus: [],
        metadata: null,
    }
    const get                             = spyOn(apiClient, 'get')
        .mockImplementation(async <T = unknown>(path: string): Promise<T> => (
            path === '/plugins/fixture/config' ? structuredClone(remoteConfig) :
                {
                    plugins_enabled: true,
                    plugins_dir: 'fixtures',
                    plugins: [{ ...plugin, config: structuredClone(remoteConfig) }],
                }
        ) as T)
    const patch                           = spyOn(apiClient, 'patch')
        .mockImplementation(async <T = unknown>(_path: string, value?: unknown): Promise<T> => {
            for (const [key, entry] of Object.entries(value as PluginConfigObject)) {
                if (entry === null) {
                    delete remoteConfig[key]
                } else {
                    remoteConfig[key] = entry
                }
            }
            return { status: 'ok' } as T
        })
    const setConfigError                  = mock((_value: unknown) => {
    })
    const showNotification                = mock()
    const setData                         = mock()
    const isJsonConfigValue               = sourceCallback<(value: PluginConfigValue) => boolean>(
        file,
        'isJsonConfigValue',
        {},
    )
    const scope                           = () => ({
        React,
        Input: () => null,
        ToggleSwitch: () => null,
        Select: () => null,
        styles: {},
        pluginsApi,
        editingPlugin,
        configDraft,
        jsonDraft,
        configReadState,
        isCurrentConnection: () => current,
        configRequestSequence: { current: 0 },
        requestSequence: { current: 0 },
        authGeneration: 3,
        setConfigDraft: (value: SetStateAction<PluginConfigObject>) => {
            configDraft = typeof value === 'function' ? value(configDraft) : value
        },
        setJsonDraft: (value: SetStateAction<Record<string, string>>) => {
            jsonDraft = typeof value === 'function' ? value(jsonDraft) : value
        },
        setEditingPlugin: (value: PluginEntry | null) => {
            editingPlugin = value
        },
        // noinspection JSUnusedGlobalSymbols
        'setConfigReadState': (value: string) => {
            configReadState = value
        },
        setConfigError,
        showNotification,
        setData,
        setStatus: mock(),
        setRefreshing: mock(),
        setError: mock(),
        setSavingConfig: mock(),
        getErrorMessage: (error: unknown) => String(error),
        t: (key: string) => key,
        isJsonConfigValue,
        waitForPluginRuntimeState,
        stringifyConfigValue: sourceCallback(file, 'stringifyConfigValue', { isJsonConfigValue }),
        normalizeNumberInput: sourceCallback(file, 'normalizeNumberInput', {}),
        configValuesEqual: sourceCallback(file, 'configValuesEqual', {}),
    })
    const control                         = (name: string) => {
        const values = scope()
        const render = sourceInitializer<(field: PluginConfigField) => ReactElement<{
            value?: string;
            checked?: boolean;
            onChange: (value: unknown) => void
        }>>(
            file,
            'renderConfigInput',
            { ...values, handleConfigValueChange: sourceCallback(file, 'handleConfigValueChange', values) },
        )
        const field  = fields.find((item) => item.name === name) ??
            { name, type: 'integer', enum_values: [], description: '' }
        return render(field).props
    }
    return {
        patch, setConfigError, showNotification, setData,
        open: () => sourceCallback<(value: PluginEntry) => Promise<void>>(file, 'openConfig', scope())(plugin),
        control, change: (name: string, text: string) => control(name).onChange({ target: { value: text } }),
        save: () => sourceCallback<() => Promise<void>>(file, 'handleSaveConfig', {
            ...scope(), confirmPluginRuntime: sourceCallback(file, 'confirmPluginRuntime', scope()),
        })(),
        remote: () => remoteConfig, draft: () => ({ configDraft, jsonDraft }),
        changeConnection: () => {
            current = false
        },
        dispose: () => {
            get.mockRestore();
            patch.mockRestore()
        },
    }
}

test('represents arrays as JSON without marking missing booleans as touched', async () => {
    const flow = editor({ priority: 3, mixed: [1, true, { x: 1 }], future: { keep: true }, label: '   ' })
    try {
        await flow.open()
        expect(flow.control('mixed').value).toBe('[\n  1,\n  true,\n  {\n    "x": 1\n  }\n]')
        expect(flow.control('optional').checked).toBe(false)
        await flow.save()
        expect(flow.patch).toHaveBeenCalledWith(
            '/plugins/fixture/config',
            {},
            { mutationReadback: expect.any(Function) },
        )
        expect(flow.remote()).toEqual({ priority: 3, mixed: [1, true, { x: 1 }], future: { keep: true }, label: '   ' })
    } finally {
        flow.dispose()
    }
})

test('only patches touched base fields and preserves untouched plugin values', async () => {
    const flow = editor({ priority: 3, mixed: [1, true, { x: 1 }], label: '', future: { keep: true } })
    try {
        await flow.open()
        flow.change('priority', '5')
        await flow.save()
        expect(flow.patch).toHaveBeenCalledWith(
            '/plugins/fixture/config',
            { priority: 5 },
            { mutationReadback: expect.any(Function) },
        )
        expect(flow.remote()).toEqual({ priority: 5, mixed: [1, true, { x: 1 }], label: '', future: { keep: true } })
    } finally {
        flow.dispose()
    }
})

test('parses touched array JSON without coercing item types', async () => {
    const flow = editor({ mixed: ['old'] })
    try {
        await flow.open()
        flow.change('mixed', '[1, false, {"next": 2}]')
        await flow.save()
        expect(flow.patch).toHaveBeenCalledWith(
            '/plugins/fixture/config',
            { mixed: [1, false, { next: 2 }] },
            { mutationReadback: expect.any(Function) },
        )
        expect(flow.remote()).toEqual({ mixed: [1, false, { next: 2 }] })
    } finally {
        flow.dispose()
    }
})

test('writes a missing boolean only after the user touches it', async () => {
    const flow = editor({})
    try {
        await flow.open()
        flow.control('optional').onChange(false)
        await flow.save()
        expect(flow.patch).toHaveBeenCalledWith(
            '/plugins/fixture/config',
            { optional: false },
            { mutationReadback: expect.any(Function) },
        )
    } finally {
        flow.dispose()
    }
})

for (const initial of ['keep me', '   ', '']) {
    test(
        `deletes a cleared touched string from ${JSON.stringify(initial)
        } with null and publishes actual runtime readback`,
        async () => {
            const flow = editor({ label: initial, future: { keep: true } })
            try {
                await flow.open()
                flow.change('label', '   ')
                expect(flow.control('label').value).toBe('   ')
                await flow.save()
                expect(flow.patch).toHaveBeenCalledWith(
                    '/plugins/fixture/config',
                    { label: null },
                    { mutationReadback: expect.any(Function) },
                )
                expect(flow.remote()).toEqual({ future: { keep: true } })
                expect(flow.setData.mock.calls[0][0].plugins[0].config).toEqual({ future: { keep: true } })
                expect(flow.showNotification).toHaveBeenCalledWith('plugin_management.save_success', 'success')
            } finally {
                flow.dispose()
            }
        },
    )
}

for (const text of ['{"not":"an array"}', 'null', 'false', '1', '"string"']) {
    test(`rejects non-array JSON ${text} before sending any config PATCH`, async () => {
        const flow = editor({ mixed: ['old'], label: 'keep' })
        try {
            await flow.open()
            flow.change('label', 'clearable')
            flow.change('mixed', text)
            await flow.save()
            expect(flow.patch).not.toHaveBeenCalled()
            expect(flow.setConfigError).toHaveBeenLastCalledWith('plugin_management.expected_array')
            expect(flow.remote()).toEqual({ mixed: ['old'], label: 'keep' })
            expect(flow.control('mixed').value).toBe(text)
            expect(flow.showNotification).not.toHaveBeenCalled()
        } finally {
            flow.dispose()
        }
    })
}

test(
    (
        'clears a blank array, preserves nonblank string bytes, and ' +
        'restores edited strings without changing untouched legacy JSON'
    ),
    async () => {
        const flow = editor({ mixed: { legacy: true }, label: 'original', future: { keep: true } })
        try {
            await flow.open()
            flow.change('label', 'edited')
            flow.change('label', 'original')
            await flow.save()
            expect(flow.patch).toHaveBeenLastCalledWith(
                '/plugins/fixture/config',
                {},
                { mutationReadback: expect.any(Function) },
            )
            await flow.open()
            flow.change('label', ' changed ')
            flow.change('mixed', '  ')
            await flow.save()
            expect(flow.patch).toHaveBeenLastCalledWith(
                '/plugins/fixture/config',
                { label: ' changed ', mixed: null },
                { mutationReadback: expect.any(Function) },
            )
            expect(flow.remote()).toEqual({ label: ' changed ', future: { keep: true } })
        } finally {
            flow.dispose()
        }
    },
)

for (const [language, message] of [
    ['en', 'Enter a JSON array'], ['zh-CN', '请输入 JSON 数组'],
    ['zh-TW', '請輸入 JSON 陣列'], ['ru', 'Введите JSON-массив'],
]) {
    test(`array validation has an actual ${language} message`, () => {
        expect(i18n.t('plugin_management.expected_array', { lng: language })).toBe(message)
    })
}

test('an old connection cannot alter string drafts or submit their deletion', async () => {
    const flow = editor({ label: 'keep' })
    try {
        await flow.open()
        const before = structuredClone(flow.draft())
        flow.changeConnection()
        flow.change('label', '  ')
        await flow.save()
        expect(flow.draft()).toEqual(before)
        expect(flow.patch).not.toHaveBeenCalled()
        expect(flow.remote()).toEqual({ label: 'keep' })
    } finally {
        flow.dispose()
    }
})
