import {describe, expect, test} from 'bun:test'
import {createElement, useState} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {parse} from 'yaml'
import {PayloadFilterRulesEditor, PayloadRulesEditor} from '@/components/config/VisualConfigEditorBlocks'
import '@/i18n'
import {useVisualConfig} from '@/hooks/useVisualConfig'
import type {PayloadModelEntry, PayloadRule, VisualConfigValues} from '@/types/visualConfig'

const sections = {
    payloadDefaultRules: 'default',
    payloadOverrideRules: 'override',
    payloadDefaultRawRules: 'default-raw',
    payloadOverrideRawRules: 'override-raw',
    payloadFilterRules: 'filter',
} as const
const conditions = {match: 'match', notMatch: 'not-match'} as const

type PayloadField = keyof typeof sections

function applyPayloadEdit(
    yaml: string,
    edit: (values: VisualConfigValues) => Partial<VisualConfigValues>,
    validationOnly = false,
): string {
    function Harness() {
        const visual = useVisualConfig()
        const [phase, setPhase] = useState(0)
        if (phase === 0) {
            visual.loadVisualValuesFromYaml(yaml)
            setPhase(1)
        } else if (phase === 1) {
            visual.setVisualValues(edit(visual.visualValues))
            setPhase(2)
        } else {
            return createElement('pre', null, validationOnly
                ? String(visual.visualHasPayloadValidationErrors)
                : visual.applyVisualChangesToYaml(yaml))
        }
        return null
    }
    return renderToStaticMarkup(createElement(Harness)).slice('<pre>'.length, -'</pre>'.length)
        .replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>').replace(/&amp;/g, '&')
}

function editModel(yaml: string, field: PayloadField, edit: (model: PayloadModelEntry) => PayloadModelEntry): string {
    return applyPayloadEdit(yaml, (values) => {
        const rule = values[field][0]!
        return {[field]: [{...rule, models: [edit(rule.models[0]!)]}]}
    })
}

const conditionYaml = (section: string, key: string) => `payload:
  ${section}:
    - models:
        - name: example
          future-model: preserve
          ${key}:
            # first-condition
            - first: 1 # first-inline
              # second-condition
              second: false # second-inline
            # third-condition
            - first: 3 # third-inline
              # fourth-condition
              fourth:
                # nested-condition-value
                future-value: [one, two]
      future-rule: preserve
      params: ${section === 'filter' ? '[remove.path]' : '{}'}
`

for (const [field, section] of Object.entries(sections) as Array<[PayloadField, string]>) {
    test(`${section}: deleting rules and parameters keeps only retained comments and unknown fields`, () => {
        const raw = section.endsWith('-raw')
        const source = `payload:
  ${section}:
    # belongs-to-deleted-rule
    - models:
        - name: delete-me
      params: ${section === 'filter' ? '[deleted.path]' : `{obsolete: ${raw ? "'false'" : 'false'}}`}
      future-rule: deleted
    # belongs-to-kept-rule
    - models:
        # belongs-to-kept-model
        - name: keep-me
          future-model: preserve
      params:
${section === 'filter' ? `        # belongs-to-deleted-param
        - first.path
        # belongs-to-kept-param
        - keep.path` : `        # belongs-to-deleted-param
        remove-me: ${raw ? "'0'" : '0'}
        # belongs-to-kept-param
        temperature: ${raw ? "'1'" : '1'}`}
      future-rule: preserve
`
        const output = applyPayloadEdit(source, (values) => {
            const retained = values[field][1]!
            const params = section === 'filter' ? ['keep.path', 'new.path'] : [{
                ...(retained as PayloadRule).params[1]!, value: '2', valueType: raw ? 'json' as const : 'number' as const,
            }]
            return {[field]: [{...retained, models: [{...retained.models[0]!, name: 'kept-and-edited'}], params}]}
        })
        const rules = parse(output).payload[section]
        expect(rules).toHaveLength(1)
        expect(rules[0].models).toEqual([{name: 'kept-and-edited', 'future-model': 'preserve'}])
        expect(rules[0]['future-rule']).toBe('preserve')
        expect(rules[0].params).toEqual(section === 'filter' ? ['keep.path', 'new.path'] : {temperature: raw ? '2' : 2})
        for (const comment of ['belongs-to-kept-rule', 'belongs-to-kept-model', 'belongs-to-kept-param']) {
            expect(output.split(`# ${comment}`)).toHaveLength(2)
        }
        for (const comment of ['belongs-to-deleted-rule', 'belongs-to-deleted-param']) {
            expect(output).not.toContain(comment)
        }
    })

    for (const [property, key] of Object.entries(conditions) as Array<[keyof typeof conditions, string]>) {
        const source = conditionYaml(section, key)
        const getModel = (yaml: string) => parse(yaml).payload[section][0].models[0]
        describe(`${section}/${key} multi-field conditions`, () => {
            test('edits, deletes, reorders and adds without stale siblings', () => {
                const output = editModel(source, field, (model) => {
                    const entries = model[property]!
                    expect(entries.map((entry) => entry.path)).toEqual(['first', 'second', 'first', 'fourth'])
                    return {...model, [property]: [
                        entries[3]!,
                        {...entries[1]!, path: 'renamed', value: 'true'},
                        {...entries[2]!, value: '9'},
                        {id: 'new-condition', path: 'added', valueType: 'string', value: 'new'},
                    ]}
                })
                expect(getModel(output)[key]).toEqual([
                    {fourth: {'future-value': ['one', 'two']}}, {renamed: true}, {first: 9}, {added: 'new'},
                ])
                expect(getModel(output)['future-model']).toBe('preserve')
                expect(parse(output).payload[section][0]['future-rule']).toBe('preserve')
                for (const comment of ['second-condition', 'second-inline', 'third-condition', 'third-inline',
                    'fourth-condition', 'nested-condition-value']) {
                    expect(output.split(`# ${comment}`)).toHaveLength(2)
                }
                expect(output).not.toContain('first-condition')
                expect(output).not.toContain('first-inline')
                const reloaded = editModel(output, field, (model) => ({...model, [property]: model[property]!.slice(2)}))
                expect(getModel(reloaded)[key]).toEqual([{first: 9}, {added: 'new'}])
                expect(reloaded).toContain('third-condition')
                expect(reloaded).not.toContain('second-condition')
                expect(reloaded).not.toContain('fourth-condition')
            })

            test('editing one field keeps every sibling exactly once', () => {
                const output = editModel(source, field, (model) => ({...model,
                    [property]: model[property]!.map((entry, index) => index === 0 ? {...entry, value: '7'} : entry),
                }))
                expect(getModel(output)[key]).toEqual([
                    {first: 7}, {second: false}, {first: 3}, {fourth: {'future-value': ['one', 'two']}},
                ])
                expect(output).toContain('nested-condition-value')
            })

            test('reversing keeps duplicate paths and their comments', () => {
                const output = editModel(source, field, (model) => ({...model, [property]: [...model[property]!].reverse()}))
                expect(getModel(output)[key]).toEqual([
                    {fourth: {'future-value': ['one', 'two']}}, {first: 3}, {second: false}, {first: 1},
                ])
                expect(output.indexOf('# third-condition')).toBeLessThan(output.indexOf('# first-condition'))
                expect(output.indexOf('# second-condition')).toBeLessThan(output.indexOf('# first-condition'))
            })

            test('deleting later fields does not resurrect them', () => {
                const output = editModel(source, field, (model) => ({...model, [property]: [model[property]![0]!]}))
                expect(getModel(output)[key]).toEqual([{first: 1}])
                expect(output).toContain('first-condition')
                expect(output).toContain('first-inline')
                expect(output).not.toContain('second-condition')
                expect(output).not.toContain('third-condition')
            })

            test('clearing removes the condition sequence', () => {
                const output = editModel(source, field, (model) => ({...model, [property]: []}))
                expect(getModel(output)[key]).toBeUndefined()
                expect(output).not.toContain('first-condition')
            })

            test('unrelated model edits preserve grouping and comments', () => {
                const output = editModel(source, field, (model) => ({...model, name: 'renamed'}))
                expect(getModel(output)[key]).toEqual(getModel(source)[key])
                expect(output).toContain('nested-condition-value')
                expect(output).toContain('second-condition')
            })
        })
    }
}

test('numeric condition paths follow parser order and retain their own comments', () => {
    const source = `payload:
  default:
    - models:
        - name: example
          match:
            # ten-condition
            - "10": ten
              # two-condition
              "2": two
            - tail: true
      params: {}
`
    const output = editModel(source, 'payloadDefaultRules', (model) => {
        expect(model.match!.map((entry) => entry.path)).toEqual(['2', '10', 'tail'])
        return {...model, match: [{...model.match![0]!, path: 'renamed', value: 'edited'}, model.match![2]!]}
    })
    expect(parse(output).payload.default[0].models[0].match).toEqual([{renamed: 'edited'}, {tail: true}])
    expect(output).toContain('two-condition')
    expect(output).not.toContain('ten-condition')
})

for (const [field, section] of Object.entries(sections) as Array<[PayloadField, string]>) {
    for (const [property, key] of Object.entries(conditions) as Array<[keyof typeof conditions, string]>) {
        test(`${section}/${key}: typed values reach the save validation and serializer`, () => {
            const source = conditionYaml(section, key)
            const cases = [
                {valueType: 'json', value: '{', invalid: true},
                {valueType: 'json', value: '', invalid: true},
                {valueType: 'boolean', value: 'yes', invalid: true},
                {valueType: 'boolean', value: '', invalid: true},
                {valueType: 'number', value: 'Infinity', invalid: true},
                {valueType: 'number', value: '9007199254740992', invalid: true},
                {valueType: 'boolean', value: 'false', invalid: false, expected: false},
                {valueType: 'number', value: '0', invalid: false, expected: 0},
                {valueType: 'json', value: 'null', invalid: false, expected: null},
                {valueType: 'string', value: '', invalid: false, expected: ''},
            ] as const
            for (const value of cases) {
                const edit = (values: VisualConfigValues): Partial<VisualConfigValues> => {
                    const rule = values[field][0]!
                    const model = rule.models[0]!
                    return {[field]: [{...rule, models: [{...model, [property]: [{
                        ...model[property]![0]!, valueType: value.valueType, value: value.value,
                    }]}]}]}
                }
                expect(applyPayloadEdit(source, edit, true)).toBe(String(value.invalid))
                if (value.invalid) {
                    expect(() => applyPayloadEdit(source, edit)).toThrow('Invalid payload')
                } else {
                    expect(parse(applyPayloadEdit(source, edit)).payload[section][0].models[0][key])
                        .toEqual([{first: value.expected}])
                }
            }
        })
    }

    test(`${section}: its actual editor renders both typed condition controls and disables writes`, () => {
        const model: PayloadModelEntry = {id: 'fixture', name: 'model',
            match: [{id: 'match', path: 'input.user', valueType: 'string', value: 'fixture'}],
            notMatch: [{id: 'not-match', path: 'stream', valueType: 'json', value: 'null'}],
        }
        const props = {value: [{id: 'rule', models: [model], params: []}], disabled: true, onChange: () => {}}
        const html = renderToStaticMarkup(section === 'filter'
            ? createElement(PayloadFilterRulesEditor, props)
            : createElement(PayloadRulesEditor, {...props, rawJsonValues: section.endsWith('-raw')}))
        expect(html.match(/<fieldset\b/g)).toHaveLength(2)
        expect(html).toContain('value="input.user"')
        expect(html).toContain('value="stream"')
        expect(html).toContain('>null</textarea>')
        for (const input of html.match(/<(?:input|button|textarea)\b[^>]*>/g) ?? []) {
            expect(input).toMatch(/disabled/)
        }
    })
}

test('duplicate condition paths with identical values retain their own comments when reordered', () => {
    const source = 'payload:\n  default:\n    - models:\n        - name: example\n          match:\n            - path: 1 # first-copy\n            - path: 1 # second-copy\n      params: {}\n'
    const output = editModel(source, 'payloadDefaultRules', (model) => ({...model, match: [...model.match!].reverse()}))
    expect(parse(output).payload.default[0].models[0].match).toEqual([{path: 1}, {path: 1}])
    expect(output.indexOf('# second-copy')).toBeLessThan(output.indexOf('# first-copy'))
})

test('adding a condition upgrades a scalar model without losing its comment', () => {
    const source = 'payload:\n  default:\n    - models:\n        - model # model-comment\n      params: {}\n'
    const output = editModel(source, 'payloadDefaultRules', (model) => ({...model,
        match: [{id: 'new', path: 'stream', valueType: 'boolean', value: 'false'}],
    }))
    expect(parse(output).payload.default[0].models[0]).toEqual({name: 'model', match: [{stream: false}]})
    expect(output).toContain('# model-comment')
})
