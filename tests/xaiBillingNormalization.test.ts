import {parseXaiQuotaPayload} from '@/utils/quota/xaiBilling'
import {describe, expect, test} from 'bun:test'

describe('xAI billing normalization', () => {
    test('uses the versioned normalized schema without legacy guessing', () => {
        const parsed = parseXaiQuotaPayload({
                                                schema_version: 1,
                                                source: 'xai_build_billing',
                                                value_source: {
                                                    plan_tier: 'subscription',
                                                    monthly_limit: 'billing_credits',
                                                },
                                                auxiliary_errors: [
                                                    {
                                                        source: 'subscription',
                                                        code: 'status_503',
                                                        status: 503,
                                                    },
                                                ],
                                                normalized: {
                                                    plan_code: 'super',
                                                    plan_name: 'Super Plan',
                                                    plan_tier: 'SuperGrok Heavy',
                                                    monthly_limit: 100,
                                                    used: 37,
                                                    included_used: 25,
                                                    remaining: 75,
                                                    on_demand_enabled: true,
                                                    on_demand_cap: 50,
                                                    on_demand_used: 12,
                                                    prepaid_balance: 5,
                                                    usage_percent: 42.5,
                                                    usage_period: {
                                                        type: 'weekly',
                                                        start: '2026-07-08T00:00:00Z',
                                                        end: '2026-07-15T00:00:00Z',
                                                    },
                                                    billing_period: {
                                                        start: '2026-07-01T00:00:00Z',
                                                        end: '2026-08-01T00:00:00Z',
                                                    },
                                                    amount_unit: 'credits',
                                                    currency: null,
                                                },
                                            })

        expect(parsed).not.toBeNull()
        expect(parsed?.planType).toBe('SuperGrok Heavy')
        expect(parsed?.billing).toMatchObject({
                                                  periodType: 'weekly',
                                                  usagePercent: 42.5,
                                                  usedPercent: 25,
                                                  monthlyLimit: 100,
                                                  includedUsed: 25,
                                                  remaining: 75,
                                                  onDemandUsed: 12,
                                                  onDemandUsedPercent: 24,
                                                  amountUnit: 'credits',
                                                  currency: null,
                                                  source: 'xai_build_billing',
                                                  valueSource: {
                                                      plan_tier: 'subscription',
                                                      monthly_limit: 'billing_credits',
                                                  },
                                                  auxiliaryErrors: [
                                                      {
                                                          source: 'subscription',
                                                          code: 'status_503',
                                                          status: 503,
                                                      },
                                                  ],
                                              })
    })

    test('does not fall back to legacy fields when a schema version is present', () => {
        expect(parseXaiQuotaPayload({
                                        schema_version: 2,
                                        normalized: { monthly_limit: 100 },
                                        config: { monthlyLimit: 150_000 },
                                    })).toBeNull()
    })

    test('keeps legacy payloads without inferring a plan from a fixed amount', () => {
        const parsed = parseXaiQuotaPayload({
                                                config: {
                                                    monthlyLimit: { val: 150_000 },
                                                    used: { val: 25_000 },
                                                    onDemandCap: { val: 0 },
                                                    billingPeriodEnd: '2026-08-01T00:00:00Z',
                                                },
                                            })

        expect(parsed?.planType).toBeNull()
        expect(parsed?.billing.monthlyLimit).toBe(150_000)
        expect(parsed?.billing.includedUsed).toBe(25_000)
        expect(parsed?.billing.onDemandUsed).toBeNull()
        expect(parsed?.billing.onDemandEnabled).toBeNull()
    })

    test('uses explicit legacy on-demand usage instead of deriving it from the monthly limit', () => {
        const parsed = parseXaiQuotaPayload({
                                                onDemandEnabled: true,
                                                subscriptionTier: 'SuperGrokPlus',
                                                config: {
                                                    monthlyLimit: { val: 100 },
                                                    used: { val: 25 },
                                                    onDemandCap: { val: 50 },
                                                    onDemandUsed: { val: 12 },
                                                },
                                            })

        expect(parsed?.planType).toBe('SuperGrokPlus')
        expect(parsed?.billing).toMatchObject({
                                                  includedUsed: 25,
                                                  used: 37,
                                                  remaining: 75,
                                                  onDemandUsed: 12,
                                                  onDemandUsedPercent: 24,
                                              })
    })

    test('preserves explicit zero values in observed weekly payloads', () => {
        const parsed = parseXaiQuotaPayload({
                                                onDemandEnabled: false,
                                                subscriptionTier: 'SuperGrok Heavy',
                                                config: {
                                                    creditUsagePercent: 0,
                                                    currentPeriod: {
                                                        type: 'USAGE_PERIOD_TYPE_WEEKLY',
                                                        start: '2026-08-22T10:54:49Z',
                                                        end: '2026-08-29T10:54:49Z',
                                                    },
                                                    onDemandCap: { val: 0 },
                                                    onDemandUsed: { val: 0 },
                                                    prepaidBalance: { val: 0 },
                                                },
                                            })

        expect(parsed?.billing).toMatchObject({
                                                  periodType: 'weekly',
                                                  usagePercent: 0,
                                                  onDemandEnabled: false,
                                                  onDemandCap: 0,
                                                  onDemandUsed: 0,
                                                  prepaidBalance: 0,
                                              })
    })
})
