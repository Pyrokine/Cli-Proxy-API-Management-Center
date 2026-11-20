import {describe, expect, test} from 'bun:test'
import {expectSourceToContain} from './sourceContractAssertions'

describe('source contract assertions', () => {
    test('matches code across indentation, quotes and trailing call commas', () => {
        expectSourceToContain('const value    = call(\n  "a b",\n)', 'const value = call(\'a b\')')
        expectSourceToContain(
            /* language=TEXT */ '<div\n className="error-box" role="alert">',
            '<div className=\'error-box\' role=\'alert\'',
        )
    })

    test('finds code after template strings and JSX text', () => {
        expectSourceToContain(
            (
                'const title = `Hello ${name}`; const view = <div>Don\'t wait</di' +
                'v>; const disabled = state !== \'connected\''
            ),
            'const disabled = state !== "connected"',
        )
    })

    test('preserves string content and identifier boundaries', () => {
        expect(() => expectSourceToContain('call(\'ab\')', 'call(\'a b\')')).toThrow()
        expect(() => expectSourceToContain('const value = invalid()', 'const value = in valid()')).toThrow()
        expect(() => expectSourceToContain('call(first, other)', 'call(first, second)')).toThrow()
    })
})
