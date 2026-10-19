import {expect, test} from 'bun:test'
import {readFileSync} from 'node:fs'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {parse} from 'yaml'
import '@/i18n'
import {VisualConfigEditor} from '@/components/config/VisualConfigEditor'
import {findConfigFieldById} from '@/components/config/configSearchIndex'
import {getVisualConfigValidationErrors} from '@/hooks/useVisualConfig'
import {areVisualConfigValuesEqual, decodeVisualConfigYaml, encodeVisualConfigYaml} from '@/hooks/visualConfigCodec'

const field = 'transientErrorCooldownSeconds'
const key = 'transient-error-cooldown-seconds'

test('transient cooldown signed seconds use the flat backend contract without normalizing unrelated YAML', () => {
    const source = '# keep\ndebug: false\nfuture: retained\n'
    const baseline = decodeVisualConfigYaml(source)
    expect(baseline.values[field]).toBe('')
    expect(encodeVisualConfigYaml(source, baseline.values, baseline.values, baseline.apiKeysStorage)).toBe(source)
    for (const value of ['-10', '-1', '0', '7', '9223372036']) {
        const values = {...baseline.values, [field]: value}
        expect(getVisualConfigValidationErrors(values)[field]).toBeUndefined()
        expect(areVisualConfigValuesEqual(values, baseline.values)).toBe(false)
        const output = encodeVisualConfigYaml(source, values, baseline.values, baseline.apiKeysStorage)
        expect(parse(output)).toEqual({debug: false, future: 'retained', [key]: Number(value)})
        expect(output).toContain('# keep')
        const loaded = decodeVisualConfigYaml(output)
        expect(loaded.values[field]).toBe(value)
        const cleared = {...loaded.values, [field]: ''}
        expect(parse(encodeVisualConfigYaml(output, cleared, loaded.values, loaded.apiKeysStorage)))
            .not.toHaveProperty(key)
    }
    for (const value of ['1.5', '1e3', '9223372037', '9007199254740993', '-9007199254740993']) {
        const values = {...baseline.values, [field]: value}
        expect(getVisualConfigValidationErrors(values)[field]).toBeDefined()
        expect(() => encodeVisualConfigYaml(source, values, baseline.values, baseline.apiKeysStorage))
            .toThrow('Invalid configuration integer')
    }
})

test('transient cooldown is searchable, translated and rendered with the real disabled editor', () => {
    expect(findConfigFieldById(field)).toMatchObject({sectionId: 'quota', yamlKeys: [key]})
    for (const locale of ['en', 'ru', 'zh-CN', 'zh-TW']) {
        const messages = JSON.parse(readFileSync(new URL(`../src/i18n/locales/${locale}.json`, import.meta.url), 'utf8'))
        const quota = messages.config_management.visual.sections.quota
        expect(quota.transient_error_cooldown_seconds).toBeTruthy()
        expect(quota.transient_error_cooldown_seconds_hint).toBeTruthy()
    }
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
    Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: {getItem: (name: string) => name === 'config-management:editor-mode' ? 'full' : null,
            setItem: () => {}},
    })
    try {
        const markup = renderToStaticMarkup(createElement(VisualConfigEditor, {
            values: decodeVisualConfigYaml(`${key}: -1\n`).values, onChange: () => {}, disabled: true,
        }))
        const input = markup.slice(markup.indexOf(`id="cfg-field-${field}"`)).match(/<input[^>]+>/)?.[0]
        expect(input).toContain('disabled=""')
        expect(input).toContain('value="-1"')
        expect(input).toContain('type="number"')
    } finally {
        if (previous) {
            Object.defineProperty(globalThis, 'localStorage', previous)
        } else {
            Reflect.deleteProperty(globalThis, 'localStorage')
        }
    }
})
