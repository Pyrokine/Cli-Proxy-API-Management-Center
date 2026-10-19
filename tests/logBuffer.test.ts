import {describe, expect, test} from 'bun:test'

import {
    appendLogBuffer,
    emptyLogBuffer,
    MAX_LOG_TEXT_UNITS,
    replaceLogBuffer,
    shouldCatchUpLogPage,
    trimLogBuffer,
} from '@/pages/hooks/logBuffer'
import {createLogParserCache} from '@/pages/hooks/logParsing'

describe('log buffer retention', () => {
    test('retains only the newest complete lines within the line and text-unit limits', () => {
        expect(trimLogBuffer(['one', 'two', 'three', 'four'], 3, 100))
            .toEqual(['two', 'three', 'four'])
        expect(trimLogBuffer(['one', 'two', 'three'], 10, 10))
            .toEqual(['two', 'three'])
        expect(trimLogBuffer(['same', 'same', 'same'], 2, 100))
            .toEqual(['same', 'same'])
    })

    test('keeps one oversized line intact so log contents are never silently truncated', () => {
        const oversized = 'x'.repeat(MAX_LOG_TEXT_UNITS + 1)
        expect(trimLogBuffer(['earlier', oversized], 10)).toEqual([oversized])
        expect(trimLogBuffer([], 10)).toEqual([])
    })

    test('assigns distinct IDs to identical records and reuses only retained parse results', () => {
        const parse = createLogParserCache()
        const first = appendLogBuffer(emptyLogBuffer(), ['same', 'same'], 2)
        const initial = parse(first)
        expect(initial.map((entry) => entry.id)).toEqual([0, 1])
        expect(initial[0]).not.toBe(initial[1])

        const next = appendLogBuffer(first, ['same'], 2)
        const retained = parse(next)
        expect(next.bufferStart).toBe(1)
        expect(next.nextId).toBe(3)
        expect(retained.map((entry) => entry.id)).toEqual([1, 2])
        expect(retained[0]).toBe(initial[1])
        expect(retained[1]).not.toBe(initial[1])

        const reloaded = replaceLogBuffer(next, ['same'], 2)
        expect(parse(reloaded).map((entry) => entry.id)).toEqual([3])
        expect(reloaded.nextId).toBe(4)
        expect(replaceLogBuffer(reloaded, [], 2)).toEqual({buffer: [], bufferStart: 4, nextId: 4})
    })

    test('continues from a full advancing file-log cursor page only', () => {
        const page = {lines: ['one', 'two'], nextCursor: 'next', cursorReset: false}
        expect(shouldCatchUpLogPage(page, 'previous', 2)).toBe(true)
        expect(shouldCatchUpLogPage(page, undefined, 2)).toBe(false)
        expect(shouldCatchUpLogPage({...page, nextCursor: 'previous'}, 'previous', 2)).toBe(false)
        expect(shouldCatchUpLogPage({...page, nextCursor: ''}, 'previous', 2)).toBe(false)
        expect(shouldCatchUpLogPage({...page, cursorReset: true}, 'previous', 2)).toBe(false)
        expect(shouldCatchUpLogPage({...page, lines: ['one']}, 'previous', 2)).toBe(false)
    })
})
