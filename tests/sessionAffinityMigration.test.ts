import {decodeVisualConfigYaml, encodeVisualConfigYaml} from '@/hooks/visualConfigCodec'
import {describe, expect, test} from 'bun:test'
import {parseDocument} from 'yaml'

describe('retired session affinity configuration', () => {
    const cases: Array<[string, string, boolean]> = [
        ['legacy enabled', 'routing: {claude-code-session-affinity: true}', true],
        ['legacy disabled', 'routing: {claude-code-session-affinity: false}', false],
        ['quoted legacy bool', 'routing: {claude-code-session-affinity: \'yes\'}', true],
        ['new false wins', 'routing: {claude-code-session-affinity: true, session-affinity: false}', false],
        ['new true wins', 'routing: {claude-code-session-affinity: false, session-affinity: true}', true],
        ['new null wins', 'routing: {claude-code-session-affinity: true, session-affinity: null}', false],
        [
            'routing alias',
            'defaults: &route {claude-code-session-affinity: true, future: retained}\nrouting: *route',
            true,
        ],
        [
            'routing merge',
            'defaults: &route {claude-code-session-affinity: true, future: retained}\nrouting: {<<: *route}',
            true,
        ],
        [
            'root merge',
            'defaults: &base {routing: {claude-code-session-affinity: true, future: retained}}\n<<: *base',
            true,
        ],
    ]
    for (const [name, source, enabled] of cases) {
        test(name, () => {
            const decoded = decodeVisualConfigYaml(source)
            expect(decoded.values.routingSessionAffinity).toBe(enabled)
            const output  = encodeVisualConfigYaml(
                source,
                { ...decoded.values, routingSessionAffinity: !enabled },
                decoded.values,
                decoded.apiKeysStorage,
            )
            const parsed  = parseDocument(output, { merge: true }).toJS() as Record<string, unknown>
            const routing = parsed.routing as Record<string, unknown>
            expect(routing['session-affinity']).toBe(!enabled)
            if (source.includes('future: retained')) {
                expect(routing.future).toBe('retained')
            }
            expect(decodeVisualConfigYaml(output).values.routingSessionAffinity).toBe(!enabled)
        })
    }

    test('unrelated edits retain the current server affinity until authoritative save migration', () => {
        const source  = 'debug: false\nrouting: {claude-code-session-affinity: true, future: retained}\n'
        const decoded = decodeVisualConfigYaml(source)
        const output  = encodeVisualConfigYaml(
            source,
            { ...decoded.values, debug: true },
            decoded.values,
            decoded.apiKeysStorage,
        )
        expect(decodeVisualConfigYaml(output).values.routingSessionAffinity).toBe(true)
        expect(parseDocument(output).getIn(['routing', 'future'])).toBe('retained')
    })
})
