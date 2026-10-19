import {describe, expect, test} from 'bun:test'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {Input} from '@/components/ui/Input'
import {ModelInputList} from '@/components/ui/ModelInputList'
import {VisualConfigEditor} from '@/components/config/VisualConfigEditor'
import {DEFAULT_VISUAL_VALUES, type VisualConfigFieldPath, type VisualConfigValues} from '@/types/visualConfig'
import type {VisualSectionId} from '@/components/config/configSearchIndex'
import {getVisualConfigValidationErrors} from '@/hooks/useVisualConfig'
import i18n from '@/i18n'

const FIELD_SECTIONS = {
    port: 'connectivity', tlsHttpRedirectPort: 'connectivity', rmCheckInterval: 'connectivity',
    requestRetry: 'network', maxRetryCredentials: 'network', maxRetryInterval: 'network',
    authAutoRefreshWorkers: 'network', videoResultAuthCacheTTL: 'network',
    logsMaxTotalSizeMb: 'logging', imageArtifactCacheRetentionDays: 'logging',
    imageArtifactCacheMaxTotalSizeMb: 'logging', errorLogsMaxFiles: 'logging',
    redisUsageQueueRetentionSeconds: 'logging', usageRetentionDays: 'logging',
    usageRetentionMaxDbSizeMb: 'logging', usageRetentionWarningThresholdPct: 'logging',
    autoRefreshInterval: 'logging', modelRefreshInterval: 'logging',
    quotaRefreshInterval: 'quota', quotaRefreshMaxInterval: 'quota', transientErrorCooldownSeconds: 'quota',
    'streaming.keepaliveSeconds': 'streaming', 'streaming.bootstrapRetries': 'streaming',
    'streaming.nonstreamKeepaliveInterval': 'streaming',
    antigravityConnectionPoolIdleTimeout: 'advanced', antigravityConnectionPoolMaxIdleConnsPerHost: 'advanced',
    codexLiveMediaRelayMaxSessions: 'advanced', codexLiveMediaRelayPublicIP: 'advanced',
    codexLiveMediaRelayUDPPortMin: 'advanced', codexLiveMediaRelayUDPPortMax: 'advanced',
    codexLiveMediaRelayICEServers: 'advanced',
} satisfies Record<VisualConfigFieldPath, VisualSectionId>

function invalidFieldValues(field: VisualConfigFieldPath): VisualConfigValues {
    const values = {...DEFAULT_VISUAL_VALUES, rmAutoCheckUpdate: true, codexLiveMediaRelayEnabled: true}
    if (field === 'codexLiveMediaRelayICEServers') {
        return {...values, codexLiveMediaRelayICEServers: [{id: 'invalid-server', urlsText: 'invalid',
            username: '', usernameConfigured: false, usernameEdited: false,
            credential: '', credentialConfigured: false, credentialEdited: false}]}
    }
    return field.startsWith('streaming.')
        ? {...values, streaming: {...values.streaming, [field.slice('streaming.'.length)]: 'invalid'}}
        : {...values, [field]: 'invalid'}
}

function expectNavigationErrors(markup: string, expected: Partial<Record<VisualSectionId, number>>): void {
    const navigation = markup.match(/<aside\b[^>]*>([\s\S]*?)<\/aside>/)?.[1] ?? ''
    const buttons = Array.from(navigation.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g), (match) => match[0])
    expect(buttons).toHaveLength(7)
    for (const section of ['connectivity', 'network', 'logging', 'quota', 'streaming', 'advanced', 'payload'] as const) {
        const title = i18n.t(`config_management.visual.sections.${section}.title`)
        const button = buttons.find((item) => item.includes(title)) ?? ''
        expect(button).toContain(title)
        const badges = Array.from(button.matchAll(/<span\b[^>]*aria-hidden="true"[^>]*>(\d+)<\/span>/g),
            (match) => Number(match[1]))
        expect(badges).toEqual(expected[section] ? [expected[section]] : [])
    }
    const overview = markup.slice(0, markup.indexOf('<aside'))
    expect(overview.includes(i18n.t('config_management.visual.validation.validation_blocked')))
        .toBe(Object.values(expected).some((count) => count > 0))
}

function attribute(tag: string, name: string): string | undefined {
    return tag.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`))?.[1]
}

function renderEditor(values = DEFAULT_VISUAL_VALUES, disabled = false, mode: 'simple' | 'full' = 'full'): string {
    const priorStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
    Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: {getItem: () => mode, setItem: () => {}},
    })
    try {
        return renderToStaticMarkup(createElement(VisualConfigEditor, {
            values, disabled, validationErrors: getVisualConfigValidationErrors(values), onChange: () => {},
        }))
    } finally {
        if (priorStorage) {
            Object.defineProperty(globalThis, 'localStorage', priorStorage)
        } else {
            Reflect.deleteProperty(globalThis, 'localStorage')
        }
    }
}

describe('config validation navigation', () => {
    for (const disabled of [false, true]) {
        for (const [field, section] of Object.entries(FIELD_SECTIONS)) {
            test(`counts ${field} only in ${section} when ${disabled ? 'disabled' : 'editable'}`, () => {
                const values = invalidFieldValues(field as VisualConfigFieldPath)
                const errors = getVisualConfigValidationErrors(values)
                expect(Object.entries(errors).filter(([, error]) => error).map(([name]) => name)).toEqual([field])
                expectNavigationErrors(renderEditor(values, disabled), {[section]: 1})
            })
        }
        test(`warns for an isolated transient cooldown error when ${disabled ? 'disabled' : 'editable'}`, () => {
            const markup = renderEditor(invalidFieldValues('transientErrorCooldownSeconds'), disabled)
            expect(markup.slice(0, markup.indexOf('<aside')))
                .toContain(i18n.t('config_management.visual.validation.validation_blocked'))
        })
        test(`omits badges and warning without errors when ${disabled ? 'disabled' : 'editable'}`, () => {
            expectNavigationErrors(renderEditor(DEFAULT_VISUAL_VALUES, disabled), {})
        })
        test(`combines errors by their actual sections when ${disabled ? 'disabled' : 'editable'}`, () => {
            const values = {...DEFAULT_VISUAL_VALUES, port: 'invalid', rmCheckInterval: 'invalid',
                transientErrorCooldownSeconds: 'invalid', quotaRefreshInterval: 'invalid', requestRetry: 'invalid'}
            expectNavigationErrors(renderEditor(values, disabled), {connectivity: 2, quota: 2, network: 1})
        })
    }
})

describe('config input accessibility', () => {
    for (const mode of ['simple', 'full'] as const) {
        for (const disabled of [false, true]) {
            test(`anchors quota switches in ${mode} mode when ${disabled ? 'disabled' : 'editable'}`, () => {
                const markup = renderEditor(DEFAULT_VISUAL_VALUES, disabled, mode)
                for (const field of ['quotaSwitchProject', 'quotaSwitchPreviewModel']) {
                    const anchor = `id="cfg-field-${field}"`
                    expect(markup.split(anchor)).toHaveLength(2)
                    const input = markup.slice(markup.indexOf(anchor)).match(/<input\b[^>]*>/)?.[0] ?? ''
                    expect(attribute(input, 'type')).toBe('checkbox')
                    expect(/\sdisabled(?:=|\s|>)/.test(input)).toBe(disabled)
                }
            })
        }
    }

    for (const invalid of [false, true]) {
        test(`associates native numeric controls with labels, hints and ${invalid ? 'active' : 'absent'} errors`, () => {
            const suffix = invalid ? '.5' : ''
            const values = {...DEFAULT_VISUAL_VALUES,
                logsMaxTotalSizeMb: `41${suffix}`, imageArtifactCacheMaxTotalSizeMb: `42${suffix}`,
                usageRetentionMaxDbSizeMb: `43${suffix}`,
                streaming: {...DEFAULT_VISUAL_VALUES.streaming,
                    keepaliveSeconds: `44${suffix}`, nonstreamKeepaliveInterval: `45${suffix}`},
            }
            const markup = renderEditor(values)
            const inputs = Array.from(markup.matchAll(/<input\b[^>]*>/g), (match) => match[0])
            for (const value of [values.logsMaxTotalSizeMb, values.imageArtifactCacheMaxTotalSizeMb,
                values.usageRetentionMaxDbSizeMb, values.streaming.keepaliveSeconds,
                values.streaming.nonstreamKeepaliveInterval]) {
                const input = inputs.find((tag) => attribute(tag, 'value') === value) ?? ''
                const id = attribute(input, 'id')
                expect(id).toBeTruthy()
                expect(markup).toMatch(new RegExp(`<label\\b[^>]*for="${id}"`))
                expect(attribute(input, 'aria-describedby')).toBe(invalid ? `${id}-hint ${id}-error` : `${id}-hint`)
                expect(markup).toContain(`id="${id}-hint"`)
                if (invalid) {
                    expect(attribute(input, 'aria-invalid')).toBe('true')
                    expect(markup).toContain(`id="${id}-error"`)
                } else {
                    expect(attribute(input, 'aria-invalid')).not.toBe('true')
                    expect(markup).not.toContain(`id="${id}-error"`)
                }
            }
        })
    }

    for (const disabled of [false, true]) {
        test(`retains Redis usage retention bounds when ${disabled ? 'disabled' : 'editable'}`, () => {
            const values = {...DEFAULT_VISUAL_VALUES, redisUsageQueueRetentionSeconds: '314'}
            const markup = renderEditor(values, disabled)
            const inputs = Array.from(markup.matchAll(/<input\b[^>]*>/g), (match) => match[0])
            const input = inputs.find((tag) => attribute(tag, 'value') === '314') ?? ''
            expect(attribute(input, 'type')).toBe('number')
            expect(attribute(input, 'min')).toBe('1')
            expect(attribute(input, 'max')).toBe('3600')
            expect(/\sdisabled(?:=|\s|>)/.test(input)).toBe(disabled)
        })
    }

    for (const disabled of [false, true]) {
        test(`names model controls when ${disabled ? 'disabled' : 'editable'}`, () => {
            const markup = renderToStaticMarkup(createElement(ModelInputList, {
                entries: [{name: 'upstream-model', alias: 'local-model'}],
                provider: 'codex', metadataEditing: true, disabled, onChange: () => {},
                namePlaceholder: '模型名称', aliasPlaceholder: '模型别名',
            }))
            const inputs = Array.from(markup.matchAll(/<input\b[^>]*>/g), (match) => match[0])
            for (const [value, label] of [['upstream-model', '模型名称'], ['local-model', '模型别名']]) {
                const input = inputs.find((tag) => attribute(tag, 'value') === value) ?? ''
                expect(attribute(input, 'aria-label')).toBe(label)
                expect(attribute(input, 'placeholder')).toBe(label)
                expect(/\sdisabled(?:=|\s|>)/.test(input)).toBe(disabled)
            }
        })
    }

    test('names configuration selects with their field labels and associates their hints', () => {
        const markup = renderEditor()
        const selects = Array.from(markup.matchAll(/<button\b[^>]*aria-haspopup="listbox"[^>]*>/g),
            (match) => match[0])
        expect(selects.length).toBeGreaterThanOrEqual(3)
        for (const select of selects) {
            const labelId = attribute(select, 'aria-labelledby')
            const hintId = attribute(select, 'aria-describedby')
            expect(labelId).toBeTruthy()
            expect(markup).toMatch(new RegExp(`<label\\b[^>]*id="${labelId}"`))
            expect(hintId).toBeTruthy()
            expect(markup).toContain(`id="${hintId}"`)
        }
    })

    test('associates the label, hint and error with the input', () => {
        const markup = renderToStaticMarkup(createElement(Input, {
            label: 'Port', hint: 'Listen port', error: 'Invalid port',
        }))
        const input = markup.match(/<input\b[^>]*>/)?.[0] ?? ''
        const id = attribute(input, 'id')
        expect(id).toBeTruthy()
        expect(markup).toContain(`<label for="${id}">Port</label>`)
        expect(attribute(input, 'aria-describedby')).toBe(`${id}-hint ${id}-error`)
        expect(attribute(input, 'aria-invalid')).toBe('true')
        expect(markup).toContain(`id="${id}-hint"`)
        expect(markup).toContain(`id="${id}-error"`)
    })

    test('preserves explicit ids and caller-provided accessibility attributes', () => {
        const markup = renderToStaticMarkup(createElement(Input, {
            id: 'custom-port', label: 'Port', hint: 'Listen port', error: 'Invalid port',
            'aria-describedby': 'external-description', 'aria-invalid': false, 'aria-label': 'Custom port',
        }))
        const input = markup.match(/<input\b[^>]*>/)?.[0] ?? ''
        expect(markup).toContain('<label for="custom-port">Port</label>')
        expect(attribute(input, 'id')).toBe('custom-port')
        expect(attribute(input, 'aria-describedby')).toBe('external-description custom-port-hint custom-port-error')
        expect(attribute(input, 'aria-invalid')).toBe('false')
        expect(attribute(input, 'aria-label')).toBe('Custom port')
    })

    test('uses distinct ids and omits absent descriptions and errors', () => {
        const markup = renderToStaticMarkup(createElement('div', {},
            createElement(Input, {label: 'First'}), createElement(Input, {label: 'Second'}),
        ))
        const ids = Array.from(markup.matchAll(/<input\b[^>]*>/g), (match) => attribute(match[0], 'id'))
        expect(ids).toHaveLength(2)
        expect(ids.every(Boolean)).toBe(true)
        expect(new Set(ids).size).toBe(2)
        expect(markup).not.toContain('aria-describedby')
        expect(markup).not.toContain('aria-invalid')
    })

    test('associates configuration YAML textareas with their labels and hints', () => {
        const priorStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
        Object.defineProperty(globalThis, 'localStorage', {
            configurable: true,
            value: {getItem: () => 'full', setItem: () => {}},
        })
        try {
            const markup = renderToStaticMarkup(createElement(VisualConfigEditor, {
                values: DEFAULT_VISUAL_VALUES, onChange: () => {},
            }))
            const textareas = Array.from(markup.matchAll(/<textarea\b[^>]*>/g), (match) => match[0])
            expect(textareas.length).toBeGreaterThan(0)
            for (const textarea of textareas) {
                const id = attribute(textarea, 'id')
                expect(id).toBeTruthy()
                expect(markup).toMatch(new RegExp(`<label\\b[^>]*for="${id}"`))
                const description = attribute(textarea, 'aria-describedby')
                if (description) {
                    expect(markup).toContain(`id="${description}"`)
                }
            }
        } finally {
            if (priorStorage) {
                Object.defineProperty(globalThis, 'localStorage', priorStorage)
            } else {
                Reflect.deleteProperty(globalThis, 'localStorage')
            }
        }
    })
})
