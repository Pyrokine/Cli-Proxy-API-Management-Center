import {
    canUseCodexResetCredit,
    codexResetCreditAvailability,
    normalizeCodexResetCreditsPayload,
    resolveCodexResetCredits,
    runCodexResetCreditAction,
} from '@/utils/quota/codexResetCredits'
import {describe, expect, test} from 'bun:test'

describe('Codex reset credits', () => {
    test('keeps total credits for display while zero applicable credits disable reset', () => {
        const resolved = resolveCodexResetCredits({
                                                      available_count: 1,
                                                      applicable_available_count: 0,
                                                  }, null)

        expect(resolved.availableCount).toMatchObject({ state: 'known', value: 1 })
        expect(resolved.applicableAvailableCount).toMatchObject({ state: 'known', value: 0 })
        expect(codexResetCreditAvailability(resolved.applicableAvailableCount)).toBe('none')
        expect(canUseCodexResetCredit(resolved.applicableAvailableCount)).toBeFalse()
    })

    test('normalizes snake_case and camelCase payload fields', () => {
        expect(normalizeCodexResetCreditsPayload({
                                                     available_count: '3',
                                                     applicable_available_count: '1',
                                                 })).toMatchObject({
                                                                       availableCount: { state: 'known', value: 3 },
                                                                       applicableAvailableCount: {
                                                                           state: 'known',
                                                                           value: 1,
                                                                       },
                                                                       payloadState: 'valid',
                                                                   })
        expect(normalizeCodexResetCreditsPayload({
                                                     availableCount: '4',
                                                     applicableAvailableCount: '2',
                                                 })).toMatchObject({
                                                                       availableCount: { state: 'known', value: 4 },
                                                                       applicableAvailableCount: {
                                                                           state: 'known',
                                                                           value: 2,
                                                                       },
                                                                       payloadState: 'valid',
                                                                   })
    })

    test('accepts explicit details counts without treating total or array length as applicable', () => {
        const fromDetails = resolveCodexResetCredits(null, JSON.stringify({
                                                                              availableCount: 2,
                                                                              applicableAvailableCount: 1,
                                                                              credits: [
                                                                                  {
                                                                                      id: 'credit-1',
                                                                                      resetType: 'codex_rate_limits',
                                                                                      status: 'available',
                                                                                      grantedAt: '2026-09-01T00:00:00Z',
                                                                                      expiresAt: '2026-10-01T00:00:00Z',
                                                                                  },
                                                                              ],
                                                                          }), Date.parse('2026-09-10T00:00:00Z'))
        expect(fromDetails.availableCount).toMatchObject({ state: 'known', value: 2 })
        expect(fromDetails.applicableAvailableCount).toMatchObject({ state: 'known', value: 1 })
        expect(fromDetails.detailsState).toBe('present')
        expect(fromDetails.credits).toHaveLength(1)
        expect(canUseCodexResetCredit(fromDetails.applicableAvailableCount)).toBeTrue()

        const totalOnly = resolveCodexResetCredits({ available_count: 1 }, null)
        expect(totalOnly.availableCount).toMatchObject({ state: 'known', value: 1 })
        expect(totalOnly.applicableAvailableCount.state).toBe('missing')
        expect(canUseCodexResetCredit(totalOnly.applicableAvailableCount)).toBeFalse()
    })

    test('rejects malformed, negative, and fractional counts', () => {
        for (const value of [-1, 1.5, '-1', '1.5', '', 'unknown']) {
            const summary = normalizeCodexResetCreditsPayload({ applicable_available_count: value })
            expect(summary.applicableAvailableCount.state, String(value)).toBe('invalid')
            expect(canUseCodexResetCredit(summary.applicableAvailableCount)).toBeFalse()
        }
        expect(normalizeCodexResetCreditsPayload({}).applicableAvailableCount.state).toBe('missing')
    })

    test('preserves conflicts between usage, details, and duplicate field spellings', () => {
        const conflict = resolveCodexResetCredits(
            { available_count: 2, applicable_available_count: 1 },
            { availableCount: 3, applicableAvailableCount: 2 },
        )
        expect(conflict.availableCount.state).toBe('conflict')
        expect(conflict.applicableAvailableCount.state).toBe('conflict')
        expect(canUseCodexResetCredit(conflict.applicableAvailableCount)).toBeFalse()

        const duplicateConflict = normalizeCodexResetCreditsPayload({
                                                                        applicable_available_count: 1,
                                                                        applicableAvailableCount: 2,
                                                                    })
        expect(duplicateConflict.applicableAvailableCount.state).toBe('conflict')

        const matching = resolveCodexResetCredits(
            { applicable_available_count: 1 },
            { applicableAvailableCount: '1' },
        )
        expect(matching.applicableAvailableCount).toMatchObject({ state: 'known', value: 1 })
    })

    test('distinguishes valid, missing, invalid, and expired detail expiry values', () => {
        const nowMs    = Date.parse('2026-09-10T00:00:00Z')
        const resolved = resolveCodexResetCredits(null, {
            credits: [
                {
                    id: 'valid',
                    reset_type: 'codex_rate_limits',
                    status: 'available',
                    expires_at: '2026-10-01T00:00:00Z',
                },
                { id: 'missing', reset_type: 'codex_rate_limits', status: 'available' },
                {
                    id: 'invalid',
                    reset_type: 'codex_rate_limits',
                    status: 'available',
                    expires_at: 'not-a-date',
                },
                {
                    id: 'expired',
                    reset_type: 'codex_rate_limits',
                    status: 'available',
                    expires_at: '2026-09-01T00:00:00Z',
                },
                {
                    id: 'conflicting-expiry',
                    reset_type: 'codex_rate_limits',
                    status: 'available',
                    expires_at: '2026-10-01T00:00:00Z',
                    expiresAt: '2026-11-01T00:00:00Z',
                },
                {
                    id: 'other-type',
                    reset_type: 'other_reset',
                    status: 'available',
                    expires_at: '2026-10-01T00:00:00Z',
                },
            ],
        }, nowMs)

        expect(resolved.detailsState).toBe('present')
        expect(resolved.credits.map((credit) => [credit.id, credit.expiryState])).toEqual([
                                                                                              ['valid', 'valid'],
                                                                                              ['missing', 'missing'],
                                                                                              ['invalid', 'invalid'],
                                                                                              ['expired', 'expired'],
                                                                                              [
                                                                                                  'conflicting-expiry',
                                                                                                  'invalid',
                                                                                              ],
                                                                                          ])
    })

    test('distinguishes missing, invalid, and successful-empty details', () => {
        expect(resolveCodexResetCredits(null, null).detailsState).toBe('missing')
        expect(resolveCodexResetCredits(null, {}).detailsState).toBe('missing')
        expect(resolveCodexResetCredits(null, 'not-json').detailsState).toBe('invalid')
        expect(resolveCodexResetCredits(null, { available_count: 1 }).detailsState).toBe('missing')
        expect(resolveCodexResetCredits(null, { credits: [] }).detailsState).toBe('empty')
        const malformed = resolveCodexResetCredits(null, {
            applicable_available_count: 1,
            credits: [42],
        })
        expect(malformed.detailsState).toBe('invalid')
        expect(malformed.applicableAvailableCount.state).toBe('invalid')
        expect(canUseCodexResetCredit(malformed.applicableAvailableCount)).toBeFalse()
        expect(resolveCodexResetCredits(null, {
            credits: [{ id: 'missing-type', status: 'available' }],
        }).detailsState).toBe('invalid')
        expect(resolveCodexResetCredits(null, {
            credits: [
                {
                    id: 'conflicting-type',
                    reset_type: 'codex_rate_limits',
                    resetType: 'other_reset',
                    status: 'available',
                },
            ],
        }).detailsState).toBe('invalid')
    })

    test('rechecks applicable credits before executing the confirmed action', async () => {
        const initiallyAvailable = resolveCodexResetCredits({ applicable_available_count: 1 }, null)
            .applicableAvailableCount
        expect(canUseCodexResetCredit(initiallyAvailable)).toBeTrue()
        let allowedCalls = 0
        expect(await runCodexResetCreditAction(
            () => initiallyAvailable,
            async () => {
                allowedCalls += 1
            },
        )).toBe('available')
        expect(allowedCalls).toBe(1)

        let current = initiallyAvailable
        expect(codexResetCreditAvailability(current)).toBe('available')
        current                   = resolveCodexResetCredits({ applicable_available_count: 0 }, null)
            .applicableAvailableCount
        let changedAfterOpenCalls = 0
        expect(await runCodexResetCreditAction(
            () => current,
            async () => {
                changedAfterOpenCalls += 1
            },
        )).toBe('none')
        expect(changedAfterOpenCalls).toBe(0)

        const blocked   = [
            [
                'none', resolveCodexResetCredits({ applicable_available_count: 0 }, null)
                .applicableAvailableCount,
            ],
            [
                'missing', resolveCodexResetCredits({ available_count: 1 }, null)
                .applicableAvailableCount,
            ],
            [
                'invalid', resolveCodexResetCredits({ applicable_available_count: 'invalid' }, null)
                .applicableAvailableCount,
            ],
            [
                'conflict', resolveCodexResetCredits(
                { applicable_available_count: 1 },
                { applicable_available_count: 2 },
            ).applicableAvailableCount,
            ],
        ] as const
        let actionCalls = 0
        for (const [expected, current] of blocked) {
            const availability = await runCodexResetCreditAction(
                () => current,
                async () => {
                    actionCalls += 1
                },
            )
            expect(availability).toBe(expected)
        }

        expect(actionCalls).toBe(0)
    })
})
