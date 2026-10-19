import {expect, test} from 'bun:test'
import {createElement, useState} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {parseDocument} from 'yaml'
import {getVisualConfigValidationErrors, useVisualConfig} from '@/hooks/useVisualConfig'

for (const {field, path, legacy, edited, reloaded, error} of [
    {field: 'videoResultAuthCacheTTL', path: ['video-result-auth-cache-ttl'], legacy: '0s',
        edited: '-1s', reloaded: '-2s', error: 'positive_duration'},
    {field: 'antigravityConnectionPoolIdleTimeout', path: ['antigravity', 'connection-pool', 'idle-conn-timeout'],
        legacy: 'invalid-timeout', edited: 'still-invalid', reloaded: 'server-invalid', error: 'invalid_duration'},
] as const) {
    test(`${field}: the actual hook validates edits against the latest loaded duration baseline`, () => {
        const document = parseDocument('# keep\nfuture: retained\ndebug: false\n')
        document.setIn(path, legacy)
        const source = document.toString()
        document.setIn(path, reloaded)
        const server = document.toString()
        let completed = false
        let saved = ''
        const steps: ((visual: ReturnType<typeof useVisualConfig>) => void)[] = [
            (visual) => { visual.loadVisualValuesFromYaml(source) },
            (visual) => {
                expect(visual.visualValues[field]).toBe(legacy)
                expect(visual.visualDirty).toBe(false)
                expect(visual.validationErrors[field]).toBeUndefined()
                visual.setVisualValues({debug: true})
            },
            (visual) => {
                expect(visual.visualHasValidationErrors).toBe(false)
                const output = visual.applyVisualChangesToYaml(source)
                expect(parseDocument(output).getIn(path)).toBe(legacy)
                expect(parseDocument(output).get('debug')).toBe(true)
                expect(output).toContain('# keep')
                expect(output).toContain('future: retained')
                visual.setVisualValues({debug: false, [field]: edited})
            },
            (visual) => {
                expect(visual.validationErrors[field]).toBe(error)
                expect(visual.visualHasValidationErrors).toBe(true)
                visual.setVisualValues({[field]: legacy})
            },
            (visual) => {
                expect(visual.validationErrors[field]).toBeUndefined()
                expect(visual.visualDirty).toBe(false)
                expect(getVisualConfigValidationErrors(visual.visualValues)[field]).toBe(error)
                expect(getVisualConfigValidationErrors({...visual.visualValues, port: '70000'}, visual.visualValues).port)
                    .toBe('port_range')
                visual.loadVisualValuesFromYaml('{}')
            },
            (visual) => { visual.setVisualValues({[field]: edited}) },
            (visual) => {
                expect(visual.validationErrors[field]).toBe(error)
                visual.setVisualValues({[field]: '30s'})
            },
            (visual) => {
                expect(visual.visualHasValidationErrors).toBe(false)
                saved = visual.applyVisualChangesToYaml('{}')
                expect(parseDocument(saved).getIn(path)).toBe('30s')
                visual.loadVisualValuesFromYaml(saved)
            },
            (visual) => {
                expect(visual.visualDirty).toBe(false)
                visual.setVisualValues({[field]: ''})
            },
            (visual) => {
                expect(visual.visualHasValidationErrors).toBe(false)
                expect(parseDocument(visual.applyVisualChangesToYaml(saved)).getIn(path)).toBeUndefined()
                visual.loadVisualValuesFromYaml(server)
            },
            (visual) => {
                expect(visual.visualValues[field]).toBe(reloaded)
                expect(visual.validationErrors[field]).toBeUndefined()
                expect(visual.visualDirty).toBe(false)
                visual.setVisualValues({[field]: legacy})
            },
            (visual) => {
                expect(visual.validationErrors[field]).toBe(error)
                visual.setVisualValues({[field]: reloaded})
            },
            (visual) => {
                expect(visual.validationErrors[field]).toBeUndefined()
                expect(visual.visualDirty).toBe(false)
                completed = true
            },
        ]
        function Harness() {
            const visual = useVisualConfig()
            const [phase, setPhase] = useState(0)
            steps[phase]!(visual)
            if (phase + 1 < steps.length) {
                setPhase(phase + 1)
            }
            return null
        }
        renderToStaticMarkup(createElement(Harness))
        expect(completed).toBe(true)
    })
}
