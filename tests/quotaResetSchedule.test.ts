import {pickUrgentRecoveryRowId} from '@/utils/quota/resetSchedule'
import {HOUR_MS} from '@/utils/time/durations'
import {describe, expect, test} from 'bun:test'

const NOW = 1_000_000

describe('quota recovery emphasis', () => {
    test('selects only the earliest recovery strictly within one hour', () => {
        expect(pickUrgentRecoveryRowId([
                                           { rowId: 'later', atMs: NOW + 45 * 60_000 },
                                           { rowId: 'earlier', atMs: NOW + 30 * 60_000 },
                                           { rowId: 'outside', atMs: NOW + HOUR_MS },
                                       ], NOW)).toBe('earlier')
    })

    test('breaks equal reset times by stable row id without reordering input', () => {
        const rows = [
            { rowId: 'b', atMs: NOW + 30 * 60_000 },
            { rowId: 'a', atMs: NOW + 30 * 60_000 },
        ]
        expect(pickUrgentRecoveryRowId(rows, NOW)).toBe('a')
        expect(rows.map(({ rowId }) => rowId)).toEqual(['b', 'a'])
    })
})
