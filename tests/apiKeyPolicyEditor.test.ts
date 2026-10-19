import {describe, expect, test} from 'bun:test'
import {readFileSync} from 'node:fs'
import i18n from '@/i18n'
import {type ApiKeyModelRule, EMPTY_API_KEY_MODEL_RULE} from '@/types/visualConfig'

import {type ApiKeyPolicyValidationErrorCode, parseGoDuration, validateApiKeyPolicyDraft} from '@/utils/apiKeyPolicy'

const LOCALES = ['en', 'zh-CN', 'zh-TW', 'ru'] as const

function policyRule(patch: Partial<ApiKeyModelRule> = {}): ApiKeyModelRule {
    return {
        ...EMPTY_API_KEY_MODEL_RULE,
        blockedModels: [...(patch.blockedModels ?? [])],
        providers: [...(patch.providers ?? [])],
        canonicalModels: [...(patch.canonicalModels ?? [])],
        modelMappings: { ...(patch.modelMappings ?? {}) },
        policyProfile: patch.policyProfile ?? '',
        reservationTtl: patch.reservationTtl ?? '',
        limits: (patch.limits ?? []).map((limit) => ({ ...limit })),
    }
}

describe('API key policy editor', () => {
    test('normalizes a complete policy without losing blocked models or int64 values', () => {
        const result = validateApiKeyPolicyDraft(
            policyRule({
                           blockedModels: ['blocked-model'],
                           providers: [' openai ', 'OPENAI', 'claude'],
                           canonicalModels: [' gpt-5 ', 'GPT-5', 'claude-sonnet-5'],
                           policyProfile: ' paid ',
                           reservationTtl: ' 1h30m ',
                       }),
            [
                { source: ' client-model ', target: ' gpt-5 ' },
                { source: ' ', target: ' ' },
            ],
            [
                {
                    window: ' 1h ',
                    requests: ' 100 ',
                    tokens: ' 9007199254740993 ',
                    costMicro: ' 5000000 ',
                },
            ],
        )

        expect(result.error).toBeUndefined()
        expect(result.rule).toEqual({
                                        blockedModels: ['blocked-model'],
                                        providers: ['openai', 'claude'],
                                        canonicalModels: ['gpt-5', 'claude-sonnet-5'],
                                        modelMappings: { 'client-model': 'gpt-5' },
                                        policyProfile: 'paid',
                                        reservationTtl: '1h30m',
                                        limits: [
                                            {
                                                window: '1h',
                                                requests: '100',
                                                tokens: '9007199254740993',
                                                costMicro: '5000000',
                                            },
                                        ],
                                    })
    })

    test('accepts long compound Go durations and keeps signed overflow validation', () => {
        expect(parseGoDuration('1ns'.repeat(43))).toBe(43n)
        expect(parseGoDuration(`${'0s'.repeat(64)}30s`)).toBe(30_000_000_000n)
        expect(parseGoDuration(`-${'0s'.repeat(64)}3h`)).toBe(-10_800_000_000_000n)
        expect(parseGoDuration(`${'0s'.repeat(64)}9223372036854775807ns`)).toBe(9223372036854775807n)
        expect(parseGoDuration(`-${'0s'.repeat(64)}9223372036854775808ns`)).toBe(-9223372036854775808n)
        expect(parseGoDuration(`${'0s'.repeat(64)}9223372036854775808ns`)).toBeNull()
        expect(parseGoDuration(`-${'0s'.repeat(64)}9223372036854775809ns`)).toBeNull()
        expect(parseGoDuration(`${'0s'.repeat(64)}1d`)).toBeNull()
        const result = validateApiKeyPolicyDraft(policyRule({reservationTtl: '1ns'.repeat(43)}), [],
            [{window: `${'0s'.repeat(64)}30s`, requests: '1', tokens: '', costMicro: ''}])
        expect(result.error).toBeUndefined()
        expect(result.rule?.reservationTtl).toBe('1ns'.repeat(43))
        expect(result.rule?.limits[0]?.window).toBe(`${'0s'.repeat(64)}30s`)
        expect(validateApiKeyPolicyDraft(policyRule(), [], [
            {window: '1ns'.repeat(43), requests: '1', tokens: '', costMicro: ''},
            {window: '43ns', requests: '1', tokens: '', costMicro: ''},
        ]).error).toBe('window_duplicate')
    })

    test('matches Go fractional duration rounding at nanosecond boundaries', () => {
        const cases: Array<[string, bigint]> = [
            ['0.9999999999999999999s', 1_000_000_000n],
            ['0.9999999999999999999h', 3_600_000_000_000n],
            ['0.333333333333333333333333333333333333h', 1_200_000_000_000n],
            ['0.000000000277777777777777777777777777h', 1_000n],
        ]
        for (const [value, expected] of cases) {
            expect(parseGoDuration(value)).toBe(expected)
            expect(parseGoDuration(`-${value}`)).toBe(-expected)
        }
    })

    test('rejects windows that become equal after Go fractional rounding', () => {
        expect(validateApiKeyPolicyDraft(policyRule(), [], [
            {window: '0.9999999999999999999s', requests: '1', tokens: '', costMicro: ''},
            {window: '1s', requests: '2', tokens: '', costMicro: ''},
        ]).error).toBe('window_duplicate')
    })

    test('accepts an explicit positive duration sign like Go time.ParseDuration', () => {
        const result = validateApiKeyPolicyDraft(
            policyRule({ reservationTtl: '+1h30m' }),
            [],
            [{ window: '+60m', requests: '1', tokens: '', costMicro: '' }],
        )

        expect(result.error).toBeUndefined()
        expect(result.rule?.reservationTtl).toBe('+1h30m')
        expect(result.rule?.limits[0]?.window).toBe('+60m')
    })

    test('accepts both Go microsecond spellings', () => {
        const result = validateApiKeyPolicyDraft(
            policyRule({ reservationTtl: '1µs' }),
            [],
            [{ window: '2μs', requests: '1', tokens: '', costMicro: '' }],
        )

        expect(result.error).toBeUndefined()
        expect(result.rule?.reservationTtl).toBe('1µs')
        expect(result.rule?.limits[0]?.window).toBe('2μs')
    })

    test('rejects invalid profiles, durations, mappings, windows, and quota values', () => {
        const cases: Array<{
            expected: ApiKeyPolicyValidationErrorCode
            rule?: ApiKeyModelRule
            mappings?: Array<{ source: string; target: string }>
            limits?: ApiKeyModelRule['limits']
        }> = [
            { expected: 'profile', rule: policyRule({ policyProfile: 'paid profile' }) },
            { expected: 'duration', rule: policyRule({ reservationTtl: 'tomorrow' }) },
            { expected: 'duration', rule: policyRule({ reservationTtl: '0.1ns' }) },
            { expected: 'duration', rule: policyRule({ reservationTtl: '2562047h47m16.854775808s' }) },
            { expected: 'mapping', mappings: [{ source: 'client-model', target: '' }] },
            {
                expected: 'mapping_duplicate',
                mappings: [
                    { source: 'models/client-model', target: 'gpt-5' },
                    { source: 'CLIENT-MODEL', target: 'claude-sonnet-5' },
                ],
            },
            { expected: 'window', limits: [{ window: 'hour', requests: '1', tokens: '', costMicro: '' }] },
            {
                expected: 'window_duplicate',
                limits: [
                    { window: '1h', requests: '1', tokens: '', costMicro: '' },
                    { window: '60m', requests: '2', tokens: '', costMicro: '' },
                ],
            },
            {
                expected: 'integer',
                limits: [{ window: '1h', requests: '-1', tokens: '', costMicro: '' }],
            },
            {
                expected: 'integer',
                limits: [{ window: '1h', requests: '9223372036854775808', tokens: '', costMicro: '' }],
            },
            {
                expected: 'empty_limit',
                limits: [{ window: '1h', requests: '0', tokens: '', costMicro: '0' }],
            },
        ]

        for (const testCase of cases) {
            const result = validateApiKeyPolicyDraft(
                testCase.rule ?? policyRule(),
                testCase.mappings ?? [],
                testCase.limits ?? [],
            )
            expect(result.error).toBe(testCase.expected)
        }
    })

    test('keeps policy locale key sets aligned', async () => {
        const originalLanguage = i18n.language
        const requiredKeys     = [
            'policy_button',
            'policy_title',
            'policy_hint',
            'policy_profile',
            'policy_profile_default',
            'policy_ttl',
            'policy_ttl_default',
            'policy_providers',
            'policy_providers_hint',
            'policy_provider',
            'policy_canonical_models',
            'policy_canonical_models_hint',
            'policy_canonical_model',
            'policy_mappings',
            'policy_mappings_hint',
            'policy_mappings_empty',
            'policy_mapping_source',
            'policy_mapping_target',
            'policy_limits',
            'policy_limits_hint',
            'policy_limits_empty',
            'policy_window',
            'policy_requests',
            'policy_tokens',
            'policy_cost_micro',
            'policy_summary',
            'policy_unconfigured',
            'policy_error_profile',
            'policy_error_duration',
            'policy_error_mapping',
            'policy_error_mapping_duplicate',
            'policy_error_window',
            'policy_error_window_duplicate',
            'policy_error_integer',
            'policy_error_empty_limit',
        ]

        for (const locale of LOCALES) {
            await i18n.changeLanguage(locale)
            for (const key of requiredKeys) {
                const path = `config_management.visual.api_keys.${key}`
                expect(i18n.exists(path)).toBe(true)
                expect(i18n.t(path)).not.toBe(path)
            }
        }
        await i18n.changeLanguage(originalLanguage)
    })

    test('connects the policy editor to API key cards and preserves model limits', () => {
        const source          = readFileSync(
            new URL('../src/components/config/VisualConfigEditorBlocks.tsx', import.meta.url),
            'utf8',
        )
        const modelSaveStart  = source.indexOf('const saveModelLimitRules = () => {')
        const modelSaveEnd    = source.indexOf('const savePolicyRule =', modelSaveStart)
        const modelSaveSource = source.slice(modelSaveStart, modelSaveEnd)

        expect(source).toContain('<ApiKeyPolicyEditor')
        expect(source).toContain('onClick={() => setPolicyKey(item.key)}')
        expect(source).toContain('validateApiKeyPolicyDraft(draftRule, mappingDrafts, limitDrafts)')
        expect(modelSaveSource).toContain('...modelRules[modelLimitKey]')
        expect(modelSaveSource).toContain('blockedModels,')
    })
})
