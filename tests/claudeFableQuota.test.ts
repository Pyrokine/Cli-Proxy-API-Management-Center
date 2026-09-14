import {buildClaudeQuotaWindows} from '@/utils/quota/builders'
import {describe, expect, test} from 'bun:test'

const translate = (key: string) => key

describe('Claude Fable quota', () => {
    test('maps the modern scoped Fable limit to a user-visible weekly row', () => {
        const reset   = '2099-07-27T10:00:00.000000+00:00'
        const windows = buildClaudeQuotaWindows({
                                                    limits: [
                                                        {
                                                            kind: 'weekly_scoped',
                                                            percent: 64,
                                                            resets_at: reset,
                                                            is_active: true,
                                                            scope: { model: { display_name: 'Fable 5' } },
                                                        },
                                                    ],
                                                }, translate)

        expect(windows).toHaveLength(1)
        expect(windows[0]).toMatchObject({
                                             id: 'seven-day-fable',
                                             labelKey: 'credentials.quota_window_seven_day_fable',
                                             usedPercent: 64,
                                             resetAtMs: Date.parse(reset),
                                             periodHours: 168,
                                         })
    })

    test('uses the legacy field without exposing its internal name', () => {
        const windows = buildClaudeQuotaWindows({
                                                    iguana_necktie: {
                                                        utilization: 41,
                                                        resets_at: '2099-07-28T10:00:00Z',
                                                    },
                                                }, translate)

        expect(windows[0]?.id).toBe('seven-day-fable')
        expect(windows[0]?.label).toBe('credentials.quota_window_seven_day_fable')
    })
})
