import {CredentialCard} from '@/components/credentials/CredentialCard'
import i18n from '@/i18n'
import {buildXaiQuotaItems, useCredentialQuota} from '@/hooks/useCredentialQuota'
import {useQuotaStore} from '@/stores/useQuotaStore'
import {parseXaiQuotaPayload} from '@/utils/quota/xaiBilling'
import {describe, expect, test} from 'bun:test'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'

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
        expect(parsed && buildXaiQuotaItems({status: 'success', billing: parsed.billing})
            .find((item) => item.id === 'xai-monthly-credits')?.model).toBe(i18n.t('xai_quota.monthly_credits'))
    })

    test('does not turn monthly spending into a weekly usage percentage', () => {
        for (const source of [
            'derived:included_used/monthly_limit',
            'derived:on_demand_used/on_demand_cap',
        ]) {
            const parsed = parseXaiQuotaPayload({
                                                    schema_version: 1,
                                                    value_source: { usage_percent: source },
                                                    normalized: {
                                                        monthly_limit: 100,
                                                        included_used: 25,
                                                        usage_percent: 25,
                                                        usage_period: {
                                                            type: 'weekly',
                                                            start: '2026-09-21T00:00:00Z',
                                                            end: '2026-09-28T00:00:00Z',
                                                        },
                                                        billing_period: {
                                                            start: '2026-09-01T00:00:00Z',
                                                            end: '2026-10-01T00:00:00Z',
                                                        },
                                                    },
                                                })
            expect(parsed?.billing.periodType).toBe('weekly')
            expect(parsed?.billing.usagePercent).toBeNull()
            expect(parsed?.billing.usedPercent).toBe(25)
            expect(parsed?.billing.periodEnd).toBe('2026-09-28T00:00:00Z')
            expect(parsed?.billing.billingPeriodEnd).toBe('2026-10-01T00:00:00Z')
        }
    })

    test('keeps weekly usage and monthly spending in their own observed periods', () => {
        const parsed = parseXaiQuotaPayload({
                                                schema_version: 1,
                                                source: 'xai_build_billing',
                                                value_source: {
                                                    'weekly.usage_percent': 'billing_credits.config.creditUsagePercent',
                                                    'monthly.usage_percent': 'derived:billing_legacy.config.used/billing_legacy.config.monthlyLimit',
                                                    monthly_limit: 'billing_legacy.config.monthlyLimit',
                                                    amount_unit: 'billing_legacy.config.amountUnit',
                                                },
                                                normalized: {
                                                    monthly_limit: 100,
                                                    used: 20,
                                                    included_used: 20,
                                                    remaining: 80,
                                                    amount_unit: 'currency_minor',
                                                    currency: 'USD',
                                                    usage_percent: 99,
                                                    usage_period: { type: 'monthly', end: '2026-11-01T00:00:00Z' },
                                                    billing_period: { end: '2026-12-01T00:00:00Z' },
                                                    weekly: {
                                                        usage_percent: 37,
                                                        period_type: 'weekly',
                                                        period_start: '2026-09-21T00:00:00Z',
                                                        period_end: '2026-09-28T00:00:00Z',
                                                    },
                                                    monthly: {
                                                        usage_percent: 20,
                                                        period_type: 'monthly',
                                                        period_start: '2026-09-01T00:00:00Z',
                                                        period_end: '2026-10-01T00:00:00Z',
                                                    },
                                                },
                                            })

        expect(parsed?.billing).toMatchObject({
                                                  periodType: 'weekly',
                                                  usagePercent: 37,
                                                  periodStart: '2026-09-21T00:00:00Z',
                                                  periodEnd: '2026-09-28T00:00:00Z',
                                                  periodHours: 168,
                                                  usedPercent: 20,
                                                  billingPeriodStart: '2026-09-01T00:00:00Z',
                                                  billingPeriodEnd: '2026-10-01T00:00:00Z',
                                                  amountUnit: 'currency_minor',
                                                  currency: 'USD',
                                                  valueSource: {
                                                      'weekly.usage_percent': 'billing_credits.config.creditUsagePercent',
                                                      'monthly.usage_percent': 'derived:billing_legacy.config.used/billing_legacy.config.monthlyLimit',
                                                  },
                                              })
        expect(parsed && buildXaiQuotaItems({status: 'success', billing: parsed.billing})).toMatchObject([
            {id: 'xai-weekly', percent: 63, resetAtMs: Date.parse('2026-09-28T00:00:00Z')},
            {
                id: 'xai-monthly-credits',
                model: i18n.t('xai_quota.monthly_usage'),
                percent: 80,
                detail: expect.any(String),
                resetAtMs: Date.parse('2026-10-01T00:00:00Z'),
            },
        ])
    })

    test('shows product observations independently of the weekly or monthly billing period', () => {
        for (const [periodType, expectWeekly] of [
            ['weekly', true], ['monthly', false], ['unknown', false],
        ] as const) {
            const parsed = parseXaiQuotaPayload({
                schema_version: 1,
                normalized: {
                    product_usage: [{product: 'Grok', usage_percent: 27}],
                    ...(periodType === 'monthly' ?
                         {monthly: {period_type: 'monthly', usage_percent: null}} :
                         {weekly: {period_type: periodType, usage_percent: null}}),
                },
            })
            expect(parsed).not.toBeNull()
            const rows = buildXaiQuotaItems({status: 'success', billing: parsed!.billing})
            expect(rows.some((row) => row.id === 'xai-weekly')).toBe(expectWeekly)
            expect(rows.find((row) => row.id === 'xai-product-0-Grok')).toMatchObject({
                percent: null,
                detail: i18n.t('xai_quota.used_percent', {percent: 27}),
            })
        }
    })

    test('shows shared product usage without inventing a reset time', () => {
        const periodEnd = '2040-01-01T00:00:00Z'
        const parsed = parseXaiQuotaPayload({
            schema_version: 1,
            normalized: {
                weekly: {period_type: 'weekly', usage_percent: 30, period_end: periodEnd},
                product_usage: [{product: 'Grok', usage_percent: 20}],
            },
        })
        if (!parsed) {
            throw new Error('Expected a versioned xAI billing payload')
        }
        const rows = buildXaiQuotaItems({status: 'success', billing: parsed.billing})
        expect(rows.find((row) => row.id === 'xai-product-0-Grok')).toMatchObject({
            percent: null,
            showReset: false,
        })
        const markup = renderToStaticMarkup(createElement(CredentialCard, {
            category: 'auth-file', title: 'xai.json', controlLabel: 'xai', quotaItems: rows,
        }))
        expect(markup).toContain(i18n.t('xai_quota.product_usage', {product: 'Grok'}))
        expect(markup).toContain(i18n.t('credentials.quota_reset_value', {value: rows[0].resetLabel}))
        expect(markup).not.toContain(i18n.t('credentials.quota_reset_unknown'))
    })

    test('does not reconstruct missing weekly or monthly percentages from combined legacy fields', () => {
        const parsed = parseXaiQuotaPayload({
                                                schema_version: 1,
                                                normalized: {
                                                    monthly_limit: 100,
                                                    included_used: 25,
                                                    usage_percent: 25,
                                                    usage_period: { type: 'weekly', end: '2026-11-01T00:00:00Z' },
                                                    weekly: {
                                                        usage_percent: null,
                                                        period_type: 'weekly',
                                                        period_start: '2026-09-21T00:00:00Z',
                                                        period_end: '2026-09-28T00:00:00Z',
                                                    },
                                                    monthly: {
                                                        usage_percent: null,
                                                        period_type: 'unknown',
                                                        period_start: null,
                                                        period_end: null,
                                                    },
                                                },
                                            })

        expect(parsed?.billing.periodType).toBe('weekly')
        expect(parsed?.billing.periodEnd).toBe('2026-09-28T00:00:00Z')
        expect(parsed?.billing.usagePercent).toBeNull()
        expect(parsed?.billing.usedPercent).toBeNull()
        expect(parsed?.billing.billingPeriodEnd).toBeNull()
    })

    test('keeps a partial weekly snapshot when monthly billing fails', () => {
        const parsed = parseXaiQuotaPayload({
                                                schema_version: 1,
                                                billing_format: 'credits',
                                                auxiliary_errors: [
                                                    {source: 'monthly_billing', code: 'status_503', status: 503},
                                                ],
                                                normalized: {
                                                    usage_percent: 42,
                                                    monthly_limit: null,
                                                    included_used: null,
                                                    amount_unit: 'unknown',
                                                    weekly: {
                                                        usage_percent: 42,
                                                        period_type: 'weekly',
                                                        period_start: '2026-07-08T00:00:00Z',
                                                        period_end: '2026-07-15T00:00:00Z',
                                                    },
                                                    monthly: {
                                                        usage_percent: null,
                                                        period_type: 'unknown',
                                                        period_start: null,
                                                        period_end: null,
                                                    },
                                                },
                                            })
        expect(parsed?.billing.usedPercent).toBeNull()
        expect(parsed?.billing.billingPeriodEnd).toBeNull()
        expect(parsed?.billing.auxiliaryErrors).toEqual([
            {source: 'monthly_billing', code: 'status_503', status: 503},
        ])
        expect(parsed && buildXaiQuotaItems({status: 'success', billing: parsed.billing}))
            .toMatchObject([{id: 'xai-weekly', percent: 58}])
    })

    test('shows the monthly period when the weekly endpoint fails', () => {
        const parsed = parseXaiQuotaPayload({
                                                schema_version: 1,
                                                auxiliary_errors: [{source: 'weekly_billing', code: 'status_503', status: 503}],
                                                normalized: {
                                                    weekly: {
                                                        usage_percent: null,
                                                        period_type: 'unknown',
                                                        period_start: null,
                                                        period_end: null,
                                                    },
                                                    monthly: {
                                                        usage_percent: 25,
                                                        period_type: 'monthly',
                                                        period_start: '2026-09-01T00:00:00Z',
                                                        period_end: '2026-10-01T00:00:00Z',
                                                    },
                                                },
                                            })

        expect(parsed?.billing.periodType).toBe('monthly')
        expect(parsed?.billing.auxiliaryErrors).toEqual([{source: 'weekly_billing', code: 'status_503', status: 503}])
        expect(parsed?.billing.usagePercent).toBe(25)
        expect(parsed?.billing.usedPercent).toBe(25)
        expect(parsed?.billing.periodEnd).toBe('2026-10-01T00:00:00Z')
        expect(parsed?.billing.billingPeriodEnd).toBe('2026-10-01T00:00:00Z')
        const monthlyItem = parsed && buildXaiQuotaItems({status: 'success', billing: parsed.billing})[0]
        expect(monthlyItem).toMatchObject({
                                              id: 'xai-monthly-credits',
                                              model: i18n.t('xai_quota.monthly_usage'),
                                              percent: 75,
                                          })
        expect(monthlyItem?.detail).toBeUndefined()
    })

    test('shows an observed monthly reset without inventing unavailable spending', () => {
        const parsed = parseXaiQuotaPayload({
                                                schema_version: 1,
                                                normalized: {
                                                    weekly: {
                                                        usage_percent: 37,
                                                        period_type: 'weekly',
                                                        period_start: '2026-09-21T00:00:00Z',
                                                        period_end: '2026-09-28T00:00:00Z',
                                                    },
                                                    monthly: {
                                                        usage_percent: null,
                                                        period_type: 'monthly',
                                                        period_start: '2026-09-01T00:00:00Z',
                                                        period_end: '2026-10-01T00:00:00Z',
                                                    },
                                                },
                                            })
        if (!parsed) {
            throw new Error('Expected a versioned xAI billing payload')
        }
        expect(buildXaiQuotaItems({status: 'success', billing: parsed.billing})).toMatchObject([
            {id: 'xai-weekly', percent: 63, resetAtMs: Date.parse('2026-09-28T00:00:00Z')},
            {
                id: 'xai-monthly-credits',
                percent: null,
                detail: i18n.t('xai_quota.usage_unavailable'),
                resetAtMs: Date.parse('2026-10-01T00:00:00Z'),
            },
        ])
    })

    test('hides an empty monthly balance only while weekly usage is present', () => {
        const payload = {
            schema_version: 1,
            normalized: {
                monthly_limit: 0,
                used: 0,
                weekly: {
                    usage_percent: 0,
                    period_type: 'weekly',
                    period_start: '2026-09-21T00:00:00Z',
                    period_end: '2026-09-28T00:00:00Z',
                },
                monthly: {
                    usage_percent: null,
                    period_type: 'monthly',
                    period_start: '2026-09-01T00:00:00Z',
                    period_end: '2026-10-01T00:00:00Z',
                },
            },
        }
        const weeklyAndMonthly = parseXaiQuotaPayload(payload)
        expect(weeklyAndMonthly && buildXaiQuotaItems({status: 'success', billing: weeklyAndMonthly.billing}))
            .toMatchObject([{id: 'xai-weekly', percent: 100}])

        const monthlyOnly = parseXaiQuotaPayload({
                                                    ...payload,
                                                    normalized: {
                                                        ...payload.normalized,
                                                        weekly: {
                                                            ...payload.normalized.weekly,
                                                            usage_percent: null,
                                                            period_type: 'unknown',
                                                            period_start: null,
                                                            period_end: null,
                                                        },
                                                    },
                                                })
        expect(monthlyOnly && buildXaiQuotaItems({status: 'success', billing: monthlyOnly.billing}))
            .toMatchObject([{id: 'xai-monthly-credits', percent: null}])
    })

    test('keeps pay-as-you-go usage when the monthly row is absent or hidden', () => {
        for (const monthly of [{}, {monthly_limit: 0, used: 0}]) {
            const parsed = parseXaiQuotaPayload({
                schema_version: 1,
                normalized: {
                    ...monthly,
                    amount_unit: 'credits',
                    on_demand_enabled: true,
                    on_demand_cap: 50,
                    on_demand_used: 12,
                    weekly: {period_type: 'weekly', usage_percent: 40},
                    product_usage: [{product: 'Grok', usage_percent: 35}],
                },
            })
            expect(parsed).not.toBeNull()
            const items = buildXaiQuotaItems({status: 'success', billing: parsed!.billing})
            expect(items.map((item) => item.id)).toEqual([
                'xai-weekly', 'xai-product-0-Grok', 'xai-pay-as-you-go',
            ])
            expect(items[2]).toMatchObject({percent: 76, detail: `${i18n.t('xai_quota.amount_credits', {amount: '38'})} / ${i18n.t('xai_quota.amount_credits', {amount: '50'})}`})
            expect(items[1]?.percent).toBeNull()
        }
    })

    test('renders pay-as-you-go without inventing monthly or weekly data', () => {
        const parsed = parseXaiQuotaPayload({
            schema_version: 1,
            normalized: {amount_unit: 'credits', on_demand_cap: 50, on_demand_used: 12},
        })
        expect(parsed).not.toBeNull()
        expect(buildXaiQuotaItems({status: 'success', billing: parsed!.billing}))
            .toMatchObject([{id: 'xai-pay-as-you-go', percent: 76}])
    })

    test('does not advertise disabled or incomplete pay-as-you-go usage', () => {
        for (const onDemand of [
            {on_demand_enabled: false, on_demand_cap: 50, on_demand_used: 12},
            {on_demand_cap: 0, on_demand_used: 0},
            {on_demand_cap: 50},
            {on_demand_used: 12},
        ]) {
            const parsed = parseXaiQuotaPayload({
                schema_version: 1,
                normalized: {
                    ...onDemand,
                    weekly: {period_type: 'weekly', usage_percent: 40},
                },
            })
            expect(parsed).not.toBeNull()
            expect(buildXaiQuotaItems({status: 'success', billing: parsed!.billing}))
                .toMatchObject([{id: 'xai-weekly', percent: 60}])
        }
    })

    test('preserves sub-one percentages as percentage points', () => {
        const standard = parseXaiQuotaPayload({
                                                  schema_version: 1,
                                                  normalized: {
                                                      monthly_limit: 100,
                                                      included_used: 0.5,
                                                      product_usage: [{product: 'Grok', usage_percent: 0.5}],
                                                      weekly: {
                                                          usage_percent: 0.5,
                                                          period_type: 'weekly',
                                                      },
                                                      monthly: {
                                                          usage_percent: 0.5,
                                                          period_type: 'monthly',
                                                      },
                                                  },
                                              })
        expect(standard?.billing.usagePercent).toBe(0.5)
        expect(standard?.billing.usedPercent).toBe(0.5)
        expect(standard?.billing.productUsage[0]?.usagePercent).toBe(0.5)

        const legacy = parseXaiQuotaPayload({
                                                config: {
                                                    creditUsagePercent: 0.5,
                                                    currentPeriod: {type: 'weekly'},
                                                    productUsage: [{product: 'Grok', usagePercent: 0.5}],
                                                    usedPercent: 0.5,
                                                },
                                            })
        expect(legacy?.billing.usagePercent).toBe(0.5)
        expect(legacy?.billing.usedPercent).toBe(0.5)
        expect(legacy?.billing.productUsage[0]?.usagePercent).toBe(0.5)
    })

    test('renders per-product shared usage without claiming separate remaining quota', () => {
        const parsed = parseXaiQuotaPayload({
            schema_version: 1,
            normalized: {
                weekly: {period_type: 'weekly', usage_percent: 40, period_end: '2026-11-01T00:00:00Z'},
                product_usage: [
                    {product: 'Grok', usage_percent: 35},
                    {product: 'Imagine', usage_percent: null},
                ],
            },
        })
        expect(parsed).not.toBeNull()
        const items = buildXaiQuotaItems({status: 'success', billing: parsed!.billing})
        expect(items.find((item) => item.id === 'xai-weekly')?.percent).toBe(60)
        expect(items.filter((item) => item.id.startsWith('xai-product-'))).toEqual([
            expect.objectContaining({model: i18n.t('xai_quota.product_usage', {product: 'Grok'}), percent: null,
                                     detail: i18n.t('xai_quota.used_percent', {percent: 35})}),
            expect.objectContaining({model: i18n.t('xai_quota.product_usage', {product: 'Imagine'}), percent: null,
                                     detail: i18n.t('xai_quota.usage_unavailable')}),
        ])
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

    test('displays prepaid balance only when positive and its amount unit is known', () => {
        const previousQuota = useQuotaStore.getState().xaiQuota
        const serverState = useQuotaStore.getInitialState()
        const previousServerQuota = serverState.xaiQuota
        let observed: ReturnType<typeof useCredentialQuota> | undefined
        const Probe = () => {
            observed = useCredentialQuota('grok', 'billing.json')
            return null
        }
        try {
            for (const [value, unit, currency, expected] of [
                [5, 'credits', null, i18n.t('xai_quota.amount_credits', {amount: '5'})],
                [1500, 'currency_minor', 'USD', new Intl.NumberFormat(undefined, {style: 'currency', currency: 'USD'}).format(15)],
                [5, 'unknown', null, null],
                [0, 'credits', null, null],
            ] as const) {
                const parsed = parseXaiQuotaPayload({
                    schema_version: 1,
                    normalized: {prepaid_balance: value, amount_unit: unit, currency},
                })
                expect(parsed).not.toBeNull()
                const xaiQuota = {'xai::billing.json': {
                    status: 'success' as const,
                    billing: parsed!.billing,
                    planType: parsed!.planType,
                }}
                serverState.xaiQuota = xaiQuota
                useQuotaStore.setState({xaiQuota})
                renderToStaticMarkup(createElement(Probe))
                expect(observed?.prepaidBalance).toBe(expected)
            }
        } finally {
            serverState.xaiQuota = previousServerQuota
            useQuotaStore.setState({xaiQuota: previousQuota})
        }
    })
})
