import {buildKimiQuotaRows} from '@/utils/quota/builders'
import {describe, expect, test} from 'bun:test'

describe('Kimi quota rows', () => {
    test('keeps the provider limit before the weekly summary', () => {
        const rows = buildKimiQuotaRows({
                                            usage: { used: 1, limit: 100, resetIn: 7 * 24 * 3600 },
                                            limits: [
                                                {
                                                    detail: { used: 2, limit: 100, resetIn: 5 * 3600 },
                                                    window: { duration: 300, timeUnit: 'TIME_UNIT_MINUTE' },
                                                },
                                            ],
                                        }, 1_000_000)

        expect(rows.map(({ id }) => id)).toEqual(['limit-0', 'summary'])
        expect(rows[0]?.labelParams).toEqual({ duration: '5h' })
        expect(rows[0]?.periodHours).toBe(5)
        expect(rows[1]?.periodHours).toBe(168)
    })

    test('shows the monthly total from cached usage when a weekly bucket is absent', () => {
        const rows = buildKimiQuotaRows({
            limits: [{detail: {used: 5, limit: 100}, window: {duration: 300, timeUnit: 'TIME_UNIT_MINUTE'}}],
            usages: {limit_month_total: {used_ratio: 0.2529, reset_time: '2099-10-22T00:00:00Z'}},
        })
        expect(rows.map(({id}) => id)).toEqual(['limit-0', 'monthly'])
        expect(rows[1]).toMatchObject({
            labelKey: 'kimi_quota.monthly_limit',
            used: 25,
            limit: 100,
            resetAtMs: Date.parse('2099-10-22T00:00:00Z'),
            periodHours: 720,
        })
    })

    test('keeps cached rows unchanged when the monthly ratio is absent or invalid', () => {
        const root = {usage: {used: 97, limit: 100}}
        expect(buildKimiQuotaRows({...root, usages: {}}).map(({id}) => id)).toEqual(['summary'])
        expect(buildKimiQuotaRows({...root, usages: {limit_month_total: {used_ratio: null}}})
            .map(({id}) => id)).toEqual(['summary'])
        expect(buildKimiQuotaRows({...root, usages: {limit_month_total: {used_ratio: -0.3}}})
            .map(({id}) => id)).toEqual(['summary'])
    })

    test('supports week windows and readable multi-day reset durations', () => {
        const rows = buildKimiQuotaRows({
                                            limits: [
                                                {
                                                    detail: { used: 2, limit: 100, resetIn: 132 * 3600 },
                                                    window: { duration: 2, timeUnit: 'TIME_UNIT_WEEK' },
                                                },
                                            ],
                                        }, 1_000_000)

        expect(rows[0]?.labelParams).toEqual({ duration: '2w' })
        expect(rows[0]?.periodHours).toBe(336)
        expect(rows[0]?.resetHint).toBe('5d 12h')
    })
})
