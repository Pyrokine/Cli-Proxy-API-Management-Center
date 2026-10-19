import {describe, expect, test} from 'bun:test'
import {parse, parseDocument, type YAMLSeq} from 'yaml'
import {decodeVisualConfigYaml, encodeVisualConfigYaml} from '@/hooks/visualConfigCodec'
import type {VisualConfigValues} from '@/types/visualConfig'

function edit(source: string, change: (values: VisualConfigValues) => void, latest = source): string {
    const decoded = decodeVisualConfigYaml(source)
    const next = structuredClone(decoded.values)
    change(next)
    const before = structuredClone({baseline: decoded.values, next})
    try {
        return encodeVisualConfigYaml(latest, next, decoded.values, decoded.apiKeysStorage)
    } finally {
        expect({baseline: decoded.values, next}).toEqual(before)
    }
}

describe('configuration draft and concurrent YAML edits', () => {
    test('renaming a parameter preserves the latest nested value and comments', () => {
        const source = 'payload:\n  default:\n    - models: [one]\n      params:\n        item:\n          old: true # nested-comment\n'
        const latest = source.replace('old: true', 'old: false').replace('# nested-comment', '# nested-comment\n          remote: true')
        const output = edit(source, (values) => { values.payloadDefaultRules[0]!.params[0]!.path = 'renamed' }, latest)
        expect(parse(output).payload.default[0].params).toEqual({renamed: {old: false, remote: true}})
        expect(output).toContain('# nested-comment')
    })

    test('renaming and changing the same parameter value rejects a competing server edit', () => {
        const source = 'payload:\n  default:\n    - models: [one]\n      params: {item: {old: true}}\n'
        const latest = source.replace('old: true', 'old: false')
        expect(() => edit(source, (values) => {
            const entry = values.payloadDefaultRules[0]!.params[0]!
            entry.path = 'renamed'
            entry.value = '{"old":"local"}'
        }, latest)).toThrow('Payload conflict')
    })

    test('an explicit scalar tag cannot undo the selected parameter type', () => {
        const source = 'payload:\n  default:\n    - models: [one]\n      params: {n: !!str 1, untouched: !!str 3}\n'
        const output = edit(source, (values) => {
            Object.assign(values.payloadDefaultRules[0]!.params[0]!, {valueType: 'number', value: '2'})
        })
        expect(parse(output).payload.default[0].params).toEqual({n: 2, untouched: '3'})
        expect(output).toContain('untouched: !!str')
    })

    for (const field of ['payloadDefaultRules', 'payloadOverrideRules'] as const) {
        test(`${field}: JSON scalar edits cannot retain an incompatible explicit tag`, () => {
            const section = field === 'payloadDefaultRules' ? 'default' : 'override'
            const source = `payload:\n  ${section}:\n    - models: [one]\n      params: {n: !!null null}\n`
            for (const value of ['"hello"', 'true', '2']) {
                const output = edit(source, (values) => { values[field][0]!.params[0]!.value = value })
                expect(parse(output).payload[section][0].params.n).toEqual(JSON.parse(value))
            }
            const integer = source.replace('!!null null', '!!int 1')
            const output = edit(integer, (values) => { values[field][0]!.params[0]!.value = '1.5' })
            expect(parse(output).payload[section][0].params.n).toBe(1.5)
        })
    }

    test('deleting only one indistinguishable filter parameter rejects the ambiguous node choice', () => {
        const source = 'payload:\n  filter:\n    - models: [one]\n      params:\n        - a # first\n        - "a" # second\n'
        expect(() => edit(source, (values) => { values.payloadFilterRules[0]!.params.splice(0, 1) })).toThrow('Payload conflict')
        const output = edit(source, (values) => { values.payloadFilterRules[0]!.params = [] })
        expect(parse(output).payload.filter[0].params).toEqual([])
    })

    test('filter parameter deletions preserve remote additions and their comments', () => {
        const source = 'payload:\n  filter:\n    - models: [one]\n      params:\n        - a\n        - "b" # retained\n'
        const latest = source + '        - remote # remote-comment\n'
        const output = edit(source, (values) => { values.payloadFilterRules[0]!.params.splice(0, 1) }, latest)
        expect(parse(output).payload.filter[0].params).toEqual(['b', 'remote'])
        expect(output).toContain('"b" # retained')
        expect(output).toContain('remote # remote-comment')
    })

    test('filter parameter additions do not resurrect remote deletions', () => {
        const source = 'payload:\n  filter:\n    - models: [one]\n      params: [a, b]\n'
        for (const latest of [source.replace('[a, b]', '[b]'), source.replace('[a, b]', '[]')]) {
            const output = edit(source, (values) => { values.payloadFilterRules[0]!.params.push('local') }, latest)
            expect(parse(output).payload.filter[0].params).toEqual(latest.includes('[b]') ? ['b', 'local'] : ['local'])
        }
    })

    const sections = {
        payloadDefaultRules: 'default', payloadDefaultRawRules: 'default-raw',
        payloadOverrideRules: 'override', payloadOverrideRawRules: 'override-raw', payloadFilterRules: 'filter',
    } as const
    for (const [field, section] of Object.entries(sections)) {
        const key = field as keyof typeof sections
        const params = section === 'filter' ? '[a]' : section.endsWith('-raw') ? '{n: "1"}' : '{n: 1}'
        const source = `payload:\n  ${section}:\n    - custom: first\n      models: [one]\n      params: ${params}\n    - custom: second\n      models: [two]\n      params: ${params}\n`
        test(`${section}: a remotely absent branch supports matching deletion and independent additions`, () => {
            const latest = 'debug: false\n'
            const removed = edit(source, (values) => { values[key] = [] }, latest)
            expect(parse(removed)).toEqual({debug: false})
            const added = edit(source, (values) => {
                const local = structuredClone(values[key][0]!)
                local.id = 'local-rule'
                local.models[0]!.name = 'local'
                Object.assign(values, {[key]: [...values[key], local]})
            }, latest)
            expect(parse(added).payload[section].map((rule: {models: {name: string}[]}) => rule.models[0]!.name)).toEqual(['local'])
            expect(() => edit(source, (values) => { values[key][0]!.models[0]!.name = 'conflict' }, latest)).toThrow('Payload conflict')
        })
        test(`${section}: duplicate loaded rules remain editable around a distinct remote addition`, () => {
            const rule = `    - models: [one]\n      params: ${params}\n`
            const duplicate = `payload:\n  ${section}:\n${rule}${rule}`
            for (const prepend of [false, true]) {
                const latest = parseDocument(duplicate)
                const seq = latest.getIn(['payload', section], true) as YAMLSeq
                const remote = latest.createNode({models: ['remote'], params: section === 'filter' ? ['remote'] : {remote: '1'}})
                if (prepend) {
                    seq.items.unshift(remote)
                } else {
                    seq.items.push(remote)
                }
                const output = edit(duplicate, (values) => { values[key][0]!.models[0]!.name = 'local' }, latest.toString())
                expect(parse(output).payload[section].map((entry: {models: string[]}) => entry.models[0]))
                    .toEqual(prepend ? ['remote', 'local', 'one'] : ['local', 'one', 'remote'])
            }
        })
        test(`${section}: aliases load and survive unrelated edits without changing the anchor`, () => {
            const input = `debug: false\ncommon: &model one\nshared: &params ${params}\npayload:\n  ${section}:\n    - models: [*model]\n      params: *params\n`
            const output = edit(input, (values) => { values.debug = true })
            expect(parse(output).debug).toBe(true)
            expect(output).toContain('*model')
            expect(output).toContain('*params')
            const renamed = edit(input, (values) => { values[key][0]!.models[0]!.name = 'edited' })
            expect(parse(renamed).common).toBe('one')
            expect(parse(renamed).payload[section][0].models).toEqual(['edited'])
            expect(renamed).toContain('*params')
        })
        test(`${section}: identical loaded selectors and params remain individually editable`, () => {
            const duplicate = source.replace('models: [two]', 'models: [one]')
            const output = edit(duplicate, (values) => { values[key][0]!.models[0]!.name = 'edited' })
            expect(parse(output).payload[section].map((rule: {models: string[]}) => rule.models[0])).toEqual(['edited', 'one'])
            expect(parse(output).payload[section].map((rule: {custom: string}) => rule.custom)).toEqual(['first', 'second'])
        })
        test(`${section}: duplicate identities do not exchange remote metadata`, () => {
            const duplicate = source.replace('models: [two]', 'models: [one]')
            const latest = parseDocument(duplicate)
            ;(latest.getIn(['payload', section], true) as YAMLSeq).items.reverse()
            const output = edit(duplicate, (values) => { values[key][0]!.models[0]!.name = 'edited' }, latest.toString())
            const rules = parse(output).payload[section]
            expect(rules.map((rule: {custom: string}) => rule.custom)).toEqual(['second', 'first'])
            expect(rules.map((rule: {models: string[]}) => rule.models[0])).toEqual(['one', 'edited'])
        })
        test(`${section}: remote deletion of an untouched rule does not block another edit`, () => {
            const latest = parseDocument(source)
            ;(latest.getIn(['payload', section], true) as YAMLSeq).items.pop()
            const output = edit(source, (values) => { values[key][0]!.models[0]!.name = 'edited' }, latest.toString())
            expect(parse(output).payload[section].map((rule: {models: string[]}) => rule.models[0])).toEqual(['edited'])
            const bothDeleted = edit(source, (values) => { values[key].pop() }, latest.toString())
            expect(parse(bothDeleted).payload[section]).toHaveLength(1)
            expect(() => edit(source, (values) => { values[key][1]!.models[0]!.name = 'deleted-edit' }, latest.toString())).toThrow('Payload conflict')
        })
        test(`${section}: local reorder preserves remote appended rules`, () => {
            const latest = parseDocument(source)
            ;(latest.getIn(['payload', section], true) as YAMLSeq).items.push(latest.createNode({models: ['remote'], params: section === 'filter' ? ['remote'] : {remote: true}, 'remote-only': true}))
            const output = edit(source, (values) => { values[key].reverse() }, latest.toString())
            const rules = parse(output).payload[section]
            expect(rules.map((rule: {models: string[]}) => rule.models[0])).toEqual(['two', 'one', 'remote'])
            expect(rules[2]['remote-only']).toBe(true)
        })
        test(`${section}: matching concurrent reorders are compatible`, () => {
            const latest = parseDocument(source)
            ;(latest.getIn(['payload', section], true) as YAMLSeq).items.reverse()
            const output = edit(source, (values) => { values[key].reverse() }, latest.toString())
            expect(parse(output).payload[section].map((rule: {models: string[]}) => rule.models[0])).toEqual(['two', 'one'])
        })
        test(`${section}: edits preserve untouched empty and missing model lists`, () => {
            for (const empty of ['models: []', 'future-option: retained']) {
                const input = source.replace('models: [one]', empty)
                const output = edit(input, (values) => { values[key][1]!.models[0]!.name = 'edited' })
                const rules = parse(output).payload[section]
                expect(rules).toHaveLength(2)
                expect(rules[0].custom).toBe('first')
                expect(rules[1].models).toEqual(['edited'])
                if (empty.startsWith('future')) {
                    expect(rules[0]['future-option']).toBe('retained')
                    expect(rules[0]).not.toHaveProperty('models')
                } else {
                    expect(rules[0].models).toEqual([])
                }
            }
        })
    }

})
