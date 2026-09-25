import {describe, expect, test} from 'bun:test'
import {errorLogViewerReducer, type ErrorLogViewerState} from '../src/pages/hooks/errorLogViewer'

const item = { name: 'example-error.log', size: 32, modified: 1700000000 }
const closed: ErrorLogViewerState = { status: 'closed' }

describe('error log viewer state', () => {
    test('moves atomically from loading to ready and closed', () => {
        const loading = errorLogViewerReducer(closed, { type: 'open', item })
        const ready   = errorLogViewerReducer(loading, { type: 'ready', text: 'sample log' })

        expect(loading).toEqual({ status: 'loading', item })
        expect(ready).toEqual({ status: 'ready', item, text: 'sample log' })
        expect(errorLogViewerReducer(ready, { type: 'close' })).toEqual(closed)
    })

    test('treats empty content as a successful ready state', () => {
        const loading = errorLogViewerReducer(closed, { type: 'open', item })

        expect(errorLogViewerReducer(loading, { type: 'ready', text: '' })).toEqual({
            status: 'ready',
            item,
            text: '',
        })
    })

    test('keeps failure metadata and clears it when another file opens', () => {
        const loading = errorLogViewerReducer(closed, { type: 'open', item })
        const failed  = errorLogViewerReducer(loading, { type: 'error', message: 'Unavailable' })
        const next    = { name: 'another-error.log' }

        expect(failed).toEqual({ status: 'error', item, message: 'Unavailable' })
        expect(errorLogViewerReducer(failed, { type: 'open', item: next })).toEqual({
            status: 'loading',
            item: next,
        })
    })

    test('ignores late terminal events unless a preview is loading', () => {
        const terminalStates: ErrorLogViewerState[] = [
            closed,
            { status: 'ready', item, text: 'current' },
            { status: 'error', item, message: 'current error' },
        ]

        for (const state of terminalStates) {
            expect(errorLogViewerReducer(state, { type: 'ready', text: 'late' })).toBe(state)
            expect(errorLogViewerReducer(state, { type: 'error', message: 'late error' })).toBe(state)
        }
    })
})
