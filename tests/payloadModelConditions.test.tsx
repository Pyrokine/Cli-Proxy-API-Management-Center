import {
    PayloadFilterRulesEditor,
    PayloadRulesEditor,
    StringListEditor,
} from '@/components/config/VisualConfigEditorBlocks'
import {Button} from '@/components/ui/Button'
import {Input} from '@/components/ui/Input'
import {getPayloadParamValidationError, VISUAL_CONFIG_PAYLOAD_VALUE_TYPE_OPTIONS} from '@/hooks/useVisualConfig'
import {
    areVisualConfigValuesEqual,
    decodeVisualConfigYaml,
    encodeVisualConfigYaml,
    getPayloadModelHeaderError,
} from '@/hooks/visualConfigCodec'
import type {PayloadModelEntry} from '@/types/visualConfig'
import {describe, expect, test} from 'bun:test'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {parse} from 'yaml'
import {sourceCallback} from './sourceCallbacks'

const fields = [
    ['payloadDefaultRules', 'default'], ['payloadDefaultRawRules', 'default-raw'],
    ['payloadOverrideRules', 'override'], ['payloadOverrideRawRules', 'override-raw'], ['payloadFilterRules', 'filter'],
] as const

function source(section: string): string {
    return `port: 8317
future: {keep: true}
payload:
  ${section}:
    # original rule
    - models:
        - name: "Model-*" # original model
          from-protocol: gemini
          headers:
            X-Client: "cli-*" # original header
            x-other: "keep"
          exist: [messages]
          not-exist: [tools]
          vendor-option: {keep: true}
      params: ${section === 'filter' ? '[temperature]' : '{temperature: 0.5}'}
`
}

describe(
    'restored payload model condition editors',
    () => {
        for (const [field, section] of fields) {
            test(
                `${section} exposes all four original conditions and saves edits without replacing unrelated source`,
                () => {
                    const yaml     = source(section)
                    const decoded  = decodeVisualConfigYaml(yaml)
                    const original = decoded.values[field][0].models[0]
                    expect(original).toMatchObject({
                                                       fromProtocol: 'gemini',
                                                       headers: [
                                                           { name: 'X-Client', value: 'cli-*' },
                                                           { name: 'x-other', value: 'keep' },
                                                       ],
                                                       exist: ['messages'],
                                                       notExist: ['tools'],
                                                       extra: { 'vendor-option': { keep: true } },
                                                   })
                    const next               = structuredClone(decoded.values)
                    next[field][0].models[0] = {
                        ...next[field][0].models[0], fromProtocol: 'responses',
                        headers: [
                            { id: 'changed', name: 'X-Client', value: 'agent-*' },
                            { id: 'keep', name: 'x-other', value: 'keep' },
                        ],
                        exist: ['input', 'stream'], notExist: ['legacy'],
                    }
                    expect(areVisualConfigValuesEqual(next, decoded.values)).toBe(false)
                    const saved = encodeVisualConfigYaml(yaml, next, decoded.values, decoded.apiKeysStorage, yaml)
                    expect(parse(saved).payload[section][0].models[0]).toEqual({
                                                                                   name: 'Model-*',
                                                                                   'from-protocol': 'responses',
                                                                                   headers: {
                                                                                       'X-Client': 'agent-*',
                                                                                       'x-other': 'keep',
                                                                                   },
                                                                                   exist: ['input', 'stream'],
                                                                                   'not-exist': ['legacy'],
                                                                                   'vendor-option': { keep: true },
                                                                               })
                    expect(parse(saved).future).toEqual({ keep: true })
                    expect(saved).toContain('# original rule')
                    expect(saved).toContain('# original model')
                    expect(saved).toContain('# original header')
                },
            )
        }

        test('both rule editors render the existing source protocol, header patterns, and path lists', () => {
            const decoded    = decodeVisualConfigYaml(source('default')).values
            const props      = {
                value: decoded.payloadDefaultRules, disabled: true, onChange: () => {
                },
            }
            const html       = renderToStaticMarkup(<PayloadRulesEditor {...props} />)
            const filter     = decodeVisualConfigYaml(source('filter')).values
            const filterHtml = renderToStaticMarkup(<PayloadFilterRulesEditor value={filter.payloadFilterRules} disabled
                                                                              onChange={() => {
                                                                              }} />)
            for (const markup of [html, filterHtml]) {
                expect(markup).toContain('gemini')
                expect(markup).toContain('X-Client')
                expect(markup).toContain('cli-*')
                expect(markup).toContain('messages')
                expect(markup).toContain('tools')
            }
        })

        test('the real controls add, edit, remove and clear conditions through the original model patch', () => {
            const path      = 'components/config/VisualConfigEditorBlocks.tsx'
            const scope     = {
                React, Input, Button, StringListEditor, styles: {}, VISUAL_CONFIG_PAYLOAD_VALUE_TYPE_OPTIONS,
                getPayloadModelHeaderError, useTranslation: () => ({ t: (value: string) => value }),
                useMemo: (build: () => unknown) => build(), useId: () => 'header-error',
                // noinspection JSUnusedGlobalSymbols
                'makeClientId': () => 'new-header',
                getValidationMessage: sourceCallback(path, 'getValidationMessage', {}),
            }
            const Component = sourceCallback<(props: {
                model: PayloadModelEntry;
                onChange: (patch: Partial<PayloadModelEntry>) => void
            }) => React.ReactElement>(path, 'PayloadConditionsEditor', scope)
            const decoded   = decodeVisualConfigYaml(source('default'))
            let model       = decoded.values.payloadDefaultRules[0].models[0]
            const collect   = (node: React.ReactNode): React.ReactElement<Record<string, unknown>>[] => {
                if (Array.isArray(node)) {
                    return node.flatMap(collect)
                }
                if (!React.isValidElement<{ children?: React.ReactNode }>(node)) {
                    return []
                }
                return [node as React.ReactElement<Record<string, unknown>>, ...collect(node.props.children)]
            }
            const view      = () => collect(Component({
                                                          model, onChange: (patch) => {
                    model = { ...model, ...patch }
                },
                                                      }))
            const input     = (label: string) => view().find((node) => node.props['aria-label'] ===
                                                                       label ||
                                                                       node.props.label ===
                                                                       label)!
            const change    = (node: React.ReactElement<Record<string, unknown>>, value: string) =>
                (node.props.onChange as (event: { target: { value: string } }) => void)({ target: { value } })
            change(input('config_management.visual.payload_rules.from_protocol'), 'responses')
            change(input('config_management.visual.payload_rules.header_name'), 'X-Agent')
            change(input('config_management.visual.payload_rules.header_value'), 'agent-*')
            const lists = view().filter((node) => node.type === StringListEditor)
            ;(lists[0].props.onChange as (value: string[]) => void)(['input', 'stream'])
            ;(lists[1].props.onChange as (value: string[]) => void)([])
            const add = view().find((node) => node.type ===
                                              Button &&
                                              node.props.children ===
                                              'config_management.visual.payload_rules.add_header')!
            ;(add.props.onClick as () => void)()
            expect(model.headers).toHaveLength(3)
            const removals = view().filter((node) => node.type ===
                                                     Button &&
                                                     node.props.children ===
                                                     'config_management.visual.common.delete')
            const remove   = removals[removals.length - 1]
            ;(remove.props.onClick as () => void)()
            expect(model.headers).toHaveLength(2)
            expect(model).toMatchObject({
                                            fromProtocol: 'responses',
                                            headers: [
                                                { name: 'X-Agent', value: 'agent-*' },
                                                { name: 'x-other', value: 'keep' },
                                            ],
                                            exist: ['input', 'stream'],
                                            notExist: [],
                                        })
            const next                            = structuredClone(decoded.values)
            next.payloadDefaultRules[0].models[0] = model
            const saved                           = parse(encodeVisualConfigYaml(
                source('default'),
                next,
                decoded.values,
                decoded.apiKeysStorage,
            ))
            expect(saved.payload.default[0].models[0]).toMatchObject({
                                                                         'from-protocol': 'responses',
                                                                         headers: {
                                                                             'X-Agent': 'agent-*',
                                                                             'x-other': 'keep',
                                                                         },
                                                                         exist: ['input', 'stream'],
                                                                     })
            expect(saved.payload.default[0].models[0]).not.toHaveProperty('not-exist')
        })

        test(
            'clears all four conditions and creates them on scalar and newly added model selectors',
            () => {
                for (const [field, section] of fields) {
                    const yaml    = source(section)
                    const decoded = decodeVisualConfigYaml(yaml)
                    const next    = structuredClone(decoded.values)
                    Object.assign(next[field][0].models[0], { fromProtocol: '', headers: [], exist: [], notExist: [] })
                    next[field][0].models.push({
                                                   id: 'new-model',
                                                   name: 'New-*',
                                                   fromProtocol: 'claude',
                                                   headers: [{ id: 'header', name: 'x-client', value: '*' }],
                                                   exist: ['messages'],
                                                   notExist: ['tools'],
                                               })
                    const models = parse(encodeVisualConfigYaml(
                        yaml,
                        next,
                        decoded.values,
                        decoded.apiKeysStorage,
                    )).payload[section][0].models
                    for (const key of ['from-protocol', 'headers', 'exist', 'not-exist']) {
                        expect(models[0]).not.toHaveProperty(key)
                    }
                    expect(models[1]).toEqual({
                                                  name: 'New-*',
                                                  'from-protocol': 'claude',
                                                  headers: { 'x-client': '*' },
                                                  exist: ['messages'],
                                                  'not-exist': ['tools'],
                                              })
                }
                const yaml                                         =
                          'payload: {default: [{models: [Model-*], params: {temperature: 0.5}}]}\n'
                const decoded                                      = decodeVisualConfigYaml(yaml)
                const next                                         = structuredClone(decoded.values)
                next.payloadDefaultRules[0].models[0].fromProtocol = 'gemini'
                expect(parse(encodeVisualConfigYaml(
                    yaml,
                    next,
                    decoded.values,
                    decoded.apiKeysStorage,
                )).payload.default[0].models[0]).toEqual({ name: 'Model-*', 'from-protocol': 'gemini' })
            },
        )

        test('preserves backend-compatible scalar spellings, aliases and exact large header values', () => {
            const yaml    = (
                'flag: &flag TRUE\npayload:\n  default:\n    - models:\n        -' +
                ' name: Model-*\n          from-protocol: 12\n          headers: ' +
                '{x-flag: *flag, x-large: 9007199254740993, x-hex: 0xFF, x-edit: ' +
                'old, 0x0F: raw}\n          exist: [0xFF, TRUE]\n      params: {' +
                'temperature: 0.5}\n'
            )
            const decoded = decodeVisualConfigYaml(yaml)
            expect(decoded.values.payloadDefaultRules[0].models[0]).toMatchObject({
                                                                                      fromProtocol: '12',
                                                                                      headers: [
                                                                                          {
                                                                                              name: 'x-flag',
                                                                                              value: 'TRUE',
                                                                                          },
                                                                                          {
                                                                                              name: 'x-large',
                                                                                              value: '9007199254740993',
                                                                                          },
                                                                                          {
                                                                                              name: 'x-hex',
                                                                                              value: '0xFF',
                                                                                          },
                                                                                          {
                                                                                              name: 'x-edit',
                                                                                              value: 'old',
                                                                                          },
                                                                                          {
                                                                                              name: '0x0F',
                                                                                              value: 'raw',
                                                                                          },
                                                                                      ],
                                                                                      exist: ['0xFF', 'TRUE'],
                                                                                  })
            const next                                              = structuredClone(decoded.values)
            next.payloadDefaultRules[0].models[0].headers![3].value = 'new'
            const saved                                             = encodeVisualConfigYaml(
                yaml,
                next,
                decoded.values,
                decoded.apiKeysStorage,
            )
            expect(saved).toContain('9007199254740993')
            expect(saved).toContain('x-flag: *flag')
            expect(saved).toContain('x-hex: 0xFF')
            expect(saved).toContain('x-edit: new')
            expect(saved).toContain('0x0F: raw')
        })

        test('unrelated edits preserve scalar condition text while an edited anchor publishes its new value', () => {
            const yaml      = (
                'port: &origin 0xFF\npayload: {default: [{models: [{name: Model-' +
                '*, headers: {x-port: *origin, x-pattern: 0xAB}}], params: {' +
                'temperature: 0.5}}]}\n'
            )
            const decoded   = decodeVisualConfigYaml(yaml)
            const unrelated = { ...decoded.values, debug: true }
            const saved     = encodeVisualConfigYaml(yaml, unrelated, decoded.values, decoded.apiKeysStorage)
            expect(saved).toContain('&origin 0xFF')
            expect(saved).toContain('x-port: *origin')
            expect(saved).toContain('x-pattern: 0xAB')
            const changed = { ...decoded.values, port: '256' }
            const updated = encodeVisualConfigYaml(yaml, changed, decoded.values, decoded.apiKeysStorage)
            const result  = parse(updated)
            expect(result.port).toBe(256)
            expect(result.payload.default[0].models[0].headers['x-port']).toBe(256)
            expect(updated).toContain('x-pattern: 0xAB')
        })

        test('duplicate header names block saving without merging their different patterns', () => {
            const yaml                                    = source('default')
            const decoded                                 = decodeVisualConfigYaml(yaml)
            const next                                    = structuredClone(decoded.values)
            next.payloadDefaultRules[0].models[0].headers =
                [{ id: 'one', name: 'X-Client', value: 'one*' }, { id: 'two', name: 'X-Client', value: 'two*' }]
            expect(getPayloadModelHeaderError(next.payloadDefaultRules[0].models[0].headers))
                .toBe('payload_invalid_headers')
            const invalid = sourceCallback<(rules: typeof next.payloadDefaultRules) => boolean>(
                'hooks/useVisualConfig.ts',
                'hasPayloadParamValidationErrors',
                {
                    getPayloadModelHeaderError,
                    // noinspection JSUnusedGlobalSymbols
                    'getPayloadParamValidationError': getPayloadParamValidationError,
                },
            )
            expect(invalid(next.payloadDefaultRules)).toBe(true)
            expect(() => encodeVisualConfigYaml(yaml, next, decoded.values, decoded.apiKeysStorage)).toThrow(
                'Invalid payload header match')
            next.payloadDefaultRules[0].models[0].headers[1].name = 'x-client'
            expect(getPayloadModelHeaderError(next.payloadDefaultRules[0].models[0].headers)).toBeUndefined()
        })

        test('a concurrent edit to the same condition is reported while unrelated root changes survive', () => {
            const yaml                                         = source('default')
            const decoded                                      = decodeVisualConfigYaml(yaml)
            const next                                         = structuredClone(decoded.values)
            next.payloadDefaultRules[0].models[0].fromProtocol = 'responses'
            const latest                                       = yaml.replace('port: 8317', 'port: 9000')
            const saved                                        = encodeVisualConfigYaml(
                latest,
                next,
                decoded.values,
                decoded.apiKeysStorage,
                yaml,
            )
            expect(parse(saved).port).toBe(9000)
            expect(parse(saved).payload.default[0].models[0]['from-protocol']).toBe('responses')
            expect(() => encodeVisualConfigYaml(
                yaml.replace('from-protocol: gemini', 'from-protocol: claude'),
                next,
                decoded.values,
                decoded.apiKeysStorage,
                yaml,
            )).toThrow('Payload conflict')
        })

        test('all four locales retain the condition labels and duplicate-header feedback', async () => {
            for (const locale of ['en', 'ru', 'zh-CN', 'zh-TW']) {
                const messages = await Bun.file(new URL(`../src/i18n/locales/${locale}.json`, import.meta.url)).json()
                for (const key of ['from_protocol', 'headers', 'header_name', 'header_value', 'exist', 'notExist']) {
                    expect(messages.config_management.visual.payload_rules[key]).toBeTruthy()
                }
                expect(messages.config_management.visual.validation.payload_invalid_headers).toBeTruthy()
            }
        })
    },
)
