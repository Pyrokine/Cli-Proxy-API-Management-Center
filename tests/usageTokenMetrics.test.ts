import {describe, expect, test} from 'bun:test'
import type {UsageSummary} from '@/services/api/usage'

import {buildChartDataFromSummary, resolveUsageTokenMetrics} from '@/utils/usage'

describe('canonical usage token metrics', () => {
    test('uses canonical cache buckets without double-counting totals or cache hits', () => {
        expect(resolveUsageTokenMetrics({
                                            input_tokens: 100,
                                            output_tokens: 20,
                                            reasoning_tokens: 15,
                                            cached_tokens: 999,
                                            cache_read_tokens: 30,
                                            cache_write_tokens: 10,
                                        })).toEqual({
                                                        inputTokens: 100,
                                                        outputTokens: 20,
                                                        reasoningTokens: 15,
                                                        cachedTokens: 40,
                                                        cacheReadTokens: 30,
                                                        cacheWriteTokens: 10,
                                                        cacheHitTokens: 30,
                                                        totalTokens: 120,
                                                    })
    })

    test('preserves an explicit total while treating reasoning as an output subset', () => {
        expect(resolveUsageTokenMetrics({
                                            input_tokens: 80,
                                            output_tokens: 40,
                                            reasoning_tokens: 25,
                                            total_tokens: 120,
                                        })).toMatchObject({
                                                              reasoningTokens: 25,
                                                              totalTokens: 120,
                                                          })
    })

    test('keeps legacy cache fields compatible without adding them to the total', () => {
        expect(resolveUsageTokenMetrics({
                                            input_tokens: '50',
                                            output_tokens: '10',
                                            cached_tokens: '12',
                                            cache_tokens: '15',
                                        })).toEqual({
                                                        inputTokens: 50,
                                                        outputTokens: 10,
                                                        reasoningTokens: null,
                                                        cachedTokens: 15,
                                                        cacheReadTokens: null,
                                                        cacheWriteTokens: null,
                                                        cacheHitTokens: 15,
                                                        totalTokens: 60,
                                                    })
    })

    test('uses the reference amount even when the compatibility cost flag is false', () => {
        const tokens                = {
            input: 10,
            output: 2,
            cached: 0,
            reasoning: 0,
            total: 12,
        }
        const summary: UsageSummary = {
            period: { from: '2026-09-01T00:00:00Z', to: '2026-09-01T01:00:00Z' },
            totals: { requests: 1, success: 1, failure: 0, tokens, cost: 0.0047 },
            by_model: {},
            by_credential: {},
            by_api_key: {},
            time_series: [
                {
                    time: '2026-09-01T00:00:00Z',
                    requests: 1,
                    success: 1,
                    failure: 0,
                    tokens,
                    cost: 0.0047,
                    has_cost: false,
                },
            ],
            time_series_by_model: {},
            time_series_by_credential: {},
            time_series_by_api_key: {},
        }

        expect(buildChartDataFromSummary(summary, 'cost').datasets[0]?.data).toEqual([0.0047])
    })
})
