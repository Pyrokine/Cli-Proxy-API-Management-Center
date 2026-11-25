import i18n from '@/i18n'
import {waitForPluginRuntimeState} from '@/pages/pluginPolling'
import {apiClient} from '@/services/api/client'
import {
    encodePluginConfigPatch,
    parsePluginConfigJSON,
    pluginConfigFieldMatches,
    type PluginConfigJSON,
} from '@/services/api/pluginConfigJSON'
import {type PluginConfigField, type PluginConfigObject, type PluginEntry, pluginsApi} from '@/services/api/plugins'
import {getErrorMessage} from '@/utils/helpers'
import {AxiosError, type AxiosInstance} from 'axios'
import {afterEach, expect, mock, test} from 'bun:test'
import React, {type ReactElement, type SetStateAction} from 'react'
import {sourceCallback, sourceInitializer} from './sourceCallbacks'

const file                        = 'pages/PluginManagementPage.tsx'
const fields: PluginConfigField[] = [
    { name: 'mixed', type: 'array', enum_values: [], description: '' },
    { name: 'options', type: 'object', enum_values: [], description: '' },
    { name: 'optional', type: 'boolean', enum_values: [], description: '' },
    { name: 'label', type: 'string', enum_values: [], description: '' },
    { name: 'api-key', type: 'string', enum_values: [], description: '' },
]
const instance                    = (apiClient as unknown as { instance: AxiosInstance }).instance
const originalAdapter             = instance.defaults.adapter
const marker                      = '__CLI_PROXY_CONFIG_SECRET_0123456789abcdef0123456789abcdef__'

afterEach(() => {
    instance.defaults.adapter = originalAdapter
    apiClient.setConfig({ apiBase: '', sessionToken: '' })
})

function editor(
    initial: PluginConfigObject | string,
    options: { globalEnabled?: boolean; audited?: boolean; readError?: string } = {},
) {
    const { globalEnabled = true, audited = true, readError }                              = options
    const remote                                                                           = parsePluginConfigJSON(
        typeof initial === 'string' ?
        initial :
        JSON.stringify(initial))
    const requests: string[]                                                               = []
    const patches: string[]                                                                = []
    let configDraft: Record<string, string>                                                = {}
    let editingPlugin: (Omit<PluginEntry, 'config'> & { config: PluginConfigJSON }) | null = null
    let configReadState                                                                    = 'loading'
    let current                                                                            = true
    const plugin: PluginEntry                                                              = {
        id: 'fixture', path: '', configured: true, registered: false, enabled: false, effective_enabled: false,
        supports_oauth: false, logo: '', config: {}, config_fields: fields, menus: [], metadata: null,
    }
    apiClient.setConfig({ apiBase: 'https://fixture.invalid', sessionToken: '' })
    instance.defaults.adapter = async (config) => {
        const { url, method } = config
        requests.push(`${method} ${url}`)
        let data: unknown
        let headers: Record<string, string> = {}
        if (method === 'patch' && url === '/plugins/fixture/config') {
            const patch = String(config.data)
            patches.push(patch)
            for (const [key, entry] of Object.entries(parsePluginConfigJSON(patch))) {
                if (entry === 'null') {
                    delete remote[key]
                } else {
                    remote[key] = entry
                }
            }
            data = { status: 'ok' }
            if (audited) {
                headers = {
                    'X-CPA-Mutation-Result': JSON.stringify({
                                                                mutation_id: config.headers['X-CPA-Mutation-ID'],
                                                                request_id: 'fixture',
                                                                outcome: 'succeeded',
                                                                confirmed_effect: true,
                                                                effects: [
                                                                    {
                                                                        kind: 'configuration.persisted',
                                                                        target: 'configuration',
                                                                    },
                                                                ],
                                                                audit_available: true,
                                                            }),
                }
            }
        } else if (method === 'get' && url === '/plugins/fixture/config') {
            if (readError) {
                throw new AxiosError('Request failed with status code 503', 'ERR_BAD_RESPONSE', config, undefined, {
                    config,
                    status: 503,
                    statusText: 'Service Unavailable',
                    headers: { 'Content-Type': 'application/json' },
                    data: JSON.stringify({ error: readError }),
                })
            }
            const safe = { ...remote }
            if (safe['api-key'] !== undefined) {
                safe['api-key'] = JSON.stringify(marker)
            }
            data = encodePluginConfigPatch(safe)
        } else if (method === 'get' && url === '/plugins') {
            const enabled   = remote.enabled === 'true'
            const effective = globalEnabled && enabled
            data            = {
                plugins_enabled: globalEnabled, plugins_dir: 'fixtures', plugins: [
                    {
                        ...plugin, enabled, registered: effective, effective_enabled: effective,
                    },
                ],
            }
        } else {
            throw new Error(`Unexpected fixture request ${method} ${url}`)
        }
        return { config, data, headers, status: 200, statusText: 'OK' }
    }
    const setConfigError      = mock((_value: unknown) => {
    })
    const setConfigReadState  = (value: string) => {
        configReadState = value
    }
    const showNotification    = mock()
    const setData             = mock()
    const shared              = {
        pluginsApi, isCurrentConnection: () => current,
        configRequestSequence: { current: 0 }, requestSequence: { current: 0 },
        authGeneration: apiClient.getAuthGeneration(), savingConfig: false,
        setConfigDraft: (value: SetStateAction<Record<string, string>>) => {
            configDraft = typeof value === 'function' ? value(configDraft) : value
        },
        setEditingPlugin: (value: typeof editingPlugin) => {
            editingPlugin = value
        },
        setConfigReadState, setConfigError, showNotification, setData,
        setStatus: mock(), setRefreshing: mock(), setError: mock(), setSavingConfig: mock(),
        getErrorMessage, t: (key: string) => key,
        configInput: sourceCallback(file, 'configInput', {}),
        normalizeNumberInput: sourceCallback(file, 'normalizeNumberInput', {}),
        hasSavedPluginConfig: sourceCallback(file, 'hasSavedPluginConfig', {}),
        pluginConfigFieldMatches, encodePluginConfigPatch, waitForPluginRuntimeState,
    }
    const publishPluginList   = sourceCallback(file, 'publishPluginList', shared)
    const scope               = () => ({ ...shared, editingPlugin, configDraft, configReadState, publishPluginList })
    const control             = (name: string) => {
        const values = scope()
        const render = sourceInitializer<(field: PluginConfigField) => ReactElement<{
            value?: string; checked?: boolean; onChange: (value: unknown) => void
        }>>(file, 'renderConfigInput', {
            ...values, React, Input: () => null, ToggleSwitch: () => null, Select: () => null, styles: {},
            handleConfigValueChange: sourceCallback(file, 'handleConfigValueChange', values),
        })
        const field  = fields.find((item) => item.name === name) ??
            { name, type: 'integer', enum_values: [], description: '' }
        return render(field).props
    }
    return {
        patches, requests, setConfigError, showNotification, setData,
        open: () => sourceCallback<(value: PluginEntry) => Promise<void>>(file, 'openConfig', scope())(plugin),
        control, change: (name: string, text: string) => control(name).onChange({ target: { value: text } }),
        save: () => sourceCallback<() => Promise<void>>(file, 'handleSaveConfig', {
            ...scope(), closeConfig: sourceCallback(file, 'closeConfig', scope()),
            confirmPluginRuntime: sourceCallback(file, 'confirmPluginRuntime', scope()),
            notifyConfigSaved: sourceCallback(file, 'notifyConfigSaved', scope()),
        })(),
        remote: () => JSON.parse(encodePluginConfigPatch(remote)),
        draft: () => configDraft,
        changeConnection: () => {
            current = false
        },
    }
}

test('renders existing arrays and leaves untouched fields and missing booleans unchanged', async () => {
    const initial = { priority: 3, mixed: [1, true, { x: 1 }], future: { keep: true }, label: '   ' }
    const flow    = editor(initial)
    await flow.open()
    expect(flow.control('mixed').value).toBe('[\n  1,\n  true,\n  {\n    "x": 1\n  }\n]')
    expect(flow.control('optional').checked).toBe(false)
    await flow.save()
    expect(flow.patches).toEqual([])
    expect(flow.remote()).toEqual(initial)
})

test('confirms priority zero from the editable readback even when the list omits it', async () => {
    const flow = editor({ enabled: true, priority: 5, label: '', future: { keep: true } }, { globalEnabled: false })
    await flow.open()
    flow.change('priority', '0')
    await flow.save()
    expect(flow.patches).toEqual(['{"priority":0}'])
    expect(flow.remote()).toEqual({ enabled: true, priority: 0, label: '', future: { keep: true } })
    expect(flow.requests).toEqual([
                                      'get /plugins/fixture/config', 'patch /plugins/fixture/config', 'get /plugins',
                                      'get /plugins/fixture/config',
                                  ])
    expect(flow.showNotification).toHaveBeenCalledWith('plugin_management.save_waiting_global', 'info')
})

test('keeps exact numbers and their types when editing a neighboring string in nested JSON', async () => {
    const flow = editor(`{"options":{"items":[9007199254740993,0.1234567890123456789,"9007199254740993",null,{"label":"old"}]}}`)
    await flow.open()
    const text = flow.control('options').value!
    expect(text).toContain('9007199254740993,')
    expect(text).toContain('0.1234567890123456789,')
    expect(text).toContain('"9007199254740993",')
    flow.change('options', text.replace('"old"', '"changed"'))
    await flow.save()
    expect(flow.patches).toHaveLength(1)
    expect(flow.patches[0]).toContain('9007199254740993,')
    expect(flow.patches[0]).toContain('0.1234567890123456789,')
    expect(flow.patches[0]).not.toContain('9007199254740992')
    expect(flow.showNotification).toHaveBeenCalledWith('plugin_management.save_success', 'success')
})

test('saves edited arrays and a touched false boolean with their JSON types', async () => {
    const flow = editor({ mixed: ['old'] })
    await flow.open()
    flow.change('mixed', '[1, false, {"next": 2}]')
    flow.control('optional').onChange(false)
    await flow.save()
    expect(flow.patches).toHaveLength(1)
    expect(JSON.parse(flow.patches[0])).toEqual({ mixed: [1, false, { next: 2 }], optional: false })
    expect(flow.remote()).toEqual({ mixed: [1, false, { next: 2 }], optional: false })
})

for (const initial of ['keep me', '   ', '']) {
    test(`deletes a cleared string from ${JSON.stringify(initial)} and publishes readback`, async () => {
        const flow = editor({ label: initial, future: { keep: true } })
        await flow.open()
        flow.change('label', '   ')
        expect(flow.control('label').value).toBe('   ')
        await flow.save()
        expect(flow.patches).toEqual(['{"label":null}'])
        expect(flow.remote()).toEqual({ future: { keep: true } })
        expect(flow.setData).toHaveBeenCalledTimes(1)
        expect(flow.showNotification).toHaveBeenCalledWith('plugin_management.save_success', 'success')
    })
}

for (const [field, invalid, message] of [
    ['mixed', ['{"not":"an array"}', 'null', 'false', '1', '"string"'], 'plugin_management.expected_array'],
    ['options', ['[]', 'null', 'false', '1', '"string"'], 'plugin_management.expected_object'],
] as const) {
    for (const value of invalid) {
        test(`rejects ${value} for ${field} without a PATCH`, async () => {
            const flow = editor({ label: 'retain' })
            await flow.open()
            flow.change('label', 'edited')
            flow.change(field, value)
            await flow.save()
            expect(flow.patches).toEqual([])
            expect(flow.setConfigError).toHaveBeenLastCalledWith(message)
            expect(flow.control(field).value).toBe(value)
        })
    }
}

test('deletes explicitly cleared structured values and preserves other string bytes', async () => {
    const flow = editor({ mixed: { legacy: true }, options: { old: true }, label: 'original', future: { keep: true } })
    await flow.open()
    flow.change('label', 'edited')
    flow.change('label', 'original')
    await flow.save()
    expect(flow.patches).toEqual([])
    await flow.open()
    flow.change('label', ' changed ')
    flow.change('mixed', '  ')
    flow.change('options', '')
    await flow.save()
    expect(JSON.parse(flow.patches[0])).toEqual({ label: ' changed ', mixed: null, options: null })
    expect(flow.remote()).toEqual({ label: ' changed ', future: { keep: true } })
})

for (const audited of [false, true]) {
    test(
        `redacted readback ${audited ? 'uses the save receipt' : 'keeps an unconfirmed secret unverified'}`,
        async () => {
            const flow = editor({ 'api-key': 'old-synthetic-value' }, { audited })
            await flow.open()
            expect(flow.control('api-key').value).toBe(marker)
            flow.change('api-key', 'new-synthetic-value')
            await flow.save()
            expect(flow.patches).toEqual(['{"api-key":"new-synthetic-value"}'])
            if (audited) {
                expect(flow.showNotification).toHaveBeenCalledWith('plugin_management.save_success', 'success')
            } else {
                expect(flow.showNotification).not.toHaveBeenCalled()
                expect(flow.setConfigError).toHaveBeenLastCalledWith('plugin_management.config_check_failed')
            }
        },
    )
}

for (const [language, array, object] of [
    ['en', 'Enter a JSON array', 'Enter a JSON object'], ['zh-CN', '请输入 JSON 数组', '请输入 JSON 对象'],
    ['zh-TW', '請輸入 JSON 陣列', '請輸入 JSON 物件'], ['ru', 'Введите JSON-массив', 'Введите JSON-объект'],
]) {
    test(`structured validation has ${language} messages`, () => {
        expect(i18n.t('plugin_management.expected_array', { lng: language })).toBe(array)
        expect(i18n.t('plugin_management.expected_object', { lng: language })).toBe(object)
    })
}

test('shows the server reason for an editable config error and does not send a write', async () => {
    const readError = 'Fixture plugin config read failed'
    const flow      = editor({ label: 'keep' }, { readError })
    await flow.open()
    expect(flow.setConfigError).toHaveBeenLastCalledWith(readError)
    await flow.save()
    expect(flow.requests).toEqual(['get /plugins/fixture/config'])
    expect(flow.patches).toEqual([])
})

test('an old connection cannot update or submit a config draft', async () => {
    const flow = editor({ label: 'keep' })
    await flow.open()
    const before = structuredClone(flow.draft())
    flow.changeConnection()
    flow.change('label', '  ')
    await flow.save()
    expect(flow.draft()).toEqual(before)
    expect(flow.patches).toEqual([])
    expect(flow.remote()).toEqual({ label: 'keep' })
})
