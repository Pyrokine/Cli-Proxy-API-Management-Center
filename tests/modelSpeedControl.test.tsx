import {expect, test} from 'bun:test'
import React, {type ReactElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {sourceCallback} from './sourceCallbacks'

const file = 'pages/ModelManagementPage.tsx'
const t    = (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key

test('model speed action persists the selected model and consumes server readback', async () => {
    const busy: Array<string | null> = []
    const patches: unknown[]         = []
    const readbacks: unknown[]       = []
    const notices: unknown[][]       = []
    const response                   = { models: [{ name: 'gpt-6.2-astra', speed: 'ultrafast' }] }
    const action                     = sourceCallback<(row: { model: string }, speed: string) => Promise<void>>(
        file,
        'handleSetModelSpeed',
        {
            setSavingModel: (value: string | null) => busy.push(value),
            modelsApi: {
                patchModelCatalogModel: async (patch: unknown) => {
                    patches.push(patch);
                    return response
                },
            },
            applyCatalogResponse: (value: unknown) => readbacks.push(value),
            showNotification: (...args: unknown[]) => notices.push(args),
            t,
        },
    )
    await action({ model: 'gpt-6.2-astra' }, 'ultrafast')
    expect(patches).toEqual([{ name: 'gpt-6.2-astra', speed: 'ultrafast' }])
    expect(readbacks).toEqual([response])
    expect(busy).toEqual(['gpt-6.2-astra', null])
    expect(notices[0][1]).toBe('success')
})

test('failed model speed save keeps the current catalog and reports the failure', async () => {
    const notices: unknown[][] = []
    let saved                  = false
    let busy: string | null    = null
    const action               = sourceCallback<(row: { model: string }, speed: string) => Promise<void>>(
        file,
        'handleSetModelSpeed',
        {
            setSavingModel: (value: string | null) => {
                busy =
                    value
            },
            modelsApi: {
                patchModelCatalogModel: async () => {
                    throw new Error('write rejected')
                },
            },
            applyCatalogResponse: () => {
                saved =
                    true
            },
            showNotification: (...args: unknown[]) => notices.push(args),
            t,
        },
    )
    await action({ model: 'gpt-6.2-astra' }, 'standard')
    expect(saved).toBe(false)
    expect(busy).toBeNull()
    expect(notices).toEqual([['notification.update_failed: write rejected', 'error']])
})

test('actual model table renders channel-specific speed options and disables the control while saving', () => {
    let control: { value: string, disabled: boolean, onChange: (value: string) => void, options: unknown[] } | undefined
    const selected: string[] = []
    const renderRow          = sourceCallback<(item: unknown) => ReactElement>(file, 'renderModelTreeRow', {
        React,
        styles: new Proxy({}, { get: (_, name) => String(name) }),
        isTreeSearchActive: false,
        effectiveCollapsedRows: new Set(),
        runtimeSummary: () => '',
        modelSubtitle: () => '',
        t,
        savingModel: 'gpt-6.2-astra',
        handleSetModelSpeed: (_: unknown, speed: string) => selected.push(speed),
        handleSetModelEnabled: () => {
        },
        openEditModal: () => {
        },
        deleteModel: () => {
        },
        ToggleSwitch: () => React.createElement('input', { type: 'checkbox' }),
        Button: ({ children }: { children: React.ReactNode }) => React.createElement('button', null, children),
        Select: (props: NonNullable<typeof control>) => {
            control = props
            return React.createElement(
                'select', {
                    disabled: props.disabled, value: props.value, onChange: () => {
                    },
                },
                props.options.map((option) => {
                    const { value, label } = option as { value: string, label: string }
                    return React.createElement('option', { key: value, value }, label)
                }),
            )
        },
    })
    const row                = {
        model: 'gpt-6.2-astra', channel: 'codex', displayName: 'GPT 6.2 Astra', aliases: [],
        price: null, speed: 'ultrafast', speedOptions: ['inherit', 'standard', 'fast', 'ultrafast'], requestable: true,
    }
    const html               = renderToStaticMarkup(renderRow({ row, depth: 3, key: row.model }))
    expect(html).toContain('codex')
    expect(html).toContain('model_management.speed_ultrafast')
    expect(control?.value).toBe('ultrafast')
    expect(control?.disabled).toBe(true)
    control?.onChange('standard')
    expect(selected).toEqual(['standard'])
    const unsupported = renderToStaticMarkup(renderRow({ row: { ...row, speedOptions: [] }, depth: 3, key: row.model }))
    expect(unsupported).toContain('model_management.speed_unavailable')
    expect(unsupported).not.toContain('<select')
})
