import {isModelScopedProviderError, parseProviderError} from '@/utils/providerError'
import {describe, expect, test} from 'bun:test'

describe('provider error parsing', () => {
    test('formats the Codex usage-limit payload shown by the credentials page', () => {
        const error = parseProviderError(JSON.stringify({
                                                            error: {
                                                                type: 'usage_limit_reached',
                                                                message: 'The usage limit has been reached',
                                                                plan_type: 'prolite',
                                                                resets_at: 1789371604,
                                                                resets_in_seconds: 578762,
                                                            },
                                                        }))

        expect(error).toMatchObject({
                                        type: 'usage_limit_reached',
                                        message: 'The usage limit has been reached',
                                        planType: 'prolite',
                                        effectScope: 'quota_family',
                                        resetAt: new Date(1789371604 * 1000).toISOString(),
                                        resetsInSeconds: 578762,
                                    })
        expect(isModelScopedProviderError(error)).toBeTrue()
        expect(error?.rawDetails).toContain('"usage_limit_reached"')
    })

    test('combines backend runtime fields with nested provider JSON', () => {
        const observedAt = '2026-09-10T08:00:00Z'
        const error      = parseProviderError({
                                                  code: 'quota_exhausted',
                                                  message: JSON.stringify({
                                                                              error: {
                                                                                  type: 'usage_limit_reached',
                                                                                  message: 'Limit reached',
                                                                                  token: 'provider-secret',
                                                                                  resets_in_seconds: 60,
                                                                              },
                                                                          }),
                                                  http_status: 429,
                                                  model: 'gpt-5.6-sol',
                                                  effect_scope: 'quota_family',
                                                  effect_key: 'codex-sol',
                                                  next_retry_after: '2026-09-10T09:00:00Z',
                                                  state_generation: 7,
                                                  observed_at: observedAt,
                                              })

        expect(error).toMatchObject({
                                        code: 'quota_exhausted',
                                        type: 'usage_limit_reached',
                                        message: 'Limit reached',
                                        httpStatus: 429,
                                        model: 'gpt-5.6-sol',
                                        effectScope: 'quota_family',
                                        effectKey: 'codex-sol',
                                        nextRetryAfter: '2026-09-10T09:00:00.000Z',
                                        stateGeneration: 7,
                                        observedAt: '2026-09-10T08:00:00.000Z',
                                        resetAt: '2026-09-10T08:01:00.000Z',
                                    })
        expect(error?.rawDetails).not.toContain('provider-secret')
    })

    test('ignores impossible provider timestamps without throwing', () => {
        const error = parseProviderError({
                                             message: 'Invalid provider timing',
                                             observed_at: 1e308,
                                             next_retry_after: 1e308,
                                             resets_at: 1e308,
                                             resets_in_seconds: 1e308,
                                         })

        expect(error).toMatchObject({
                                        message: 'Invalid provider timing',
                                        observedAt: undefined,
                                        nextRetryAfter: undefined,
                                        resetAt: undefined,
                                        resetsInSeconds: undefined,
                                    })
    })

    test('unwraps nested JSON strings and preserves plain messages', () => {
        expect(parseProviderError(JSON.stringify(JSON.stringify({
                                                                    error: {
                                                                        code: 'provider_busy',
                                                                        message: 'Try again later',
                                                                    },
                                                                })))).toMatchObject({
                                                                                        code: 'provider_busy',
                                                                                        message: 'Try again later',
                                                                                    })
        expect(parseProviderError('plain provider error')).toEqual({
                                                                       message: 'plain provider error',
                                                                       rawDetails: undefined,
                                                                       code: undefined,
                                                                       type: undefined,
                                                                       httpStatus: undefined,
                                                                       model: undefined,
                                                                       effectScope: undefined,
                                                                       effectKey: undefined,
                                                                       planType: undefined,
                                                                       nextRetryAfter: undefined,
                                                                       stateGeneration: undefined,
                                                                       observedAt: undefined,
                                                                       resetAt: undefined,
                                                                       resetsInSeconds: undefined,
                                                                   })
    })
})
