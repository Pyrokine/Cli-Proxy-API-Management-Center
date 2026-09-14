// cspell:ignore wxyz
import {describe, expect, test} from 'bun:test'
import {readFileSync} from 'node:fs'
import {evaluateApiKeyStrength} from '@/utils/apiKeyStrength'

const GENERATED_KEY = `sk-${'7f3a9c2e4b6d8f10'.repeat(4)}`

describe('API key strength evaluator', () => {
    test('uses explicit empty and masked levels without estimating strength', () => {
        expect(evaluateApiKeyStrength('')).toEqual({
                                                       level: 'empty',
                                                       segments: 0,
                                                       bits: 0,
                                                       patterns: [],
                                                       suggestions: [],
                                                   })

        for (const value of ['***', 'ab****yz', '••••••', '[REDACTED]']) {
            expect(evaluateApiKeyStrength(value)).toEqual({
                                                              level: 'masked',
                                                              segments: 0,
                                                              bits: 0,
                                                              patterns: [],
                                                              suggestions: ['replace_masked_value'],
                                                          })
        }
    })

    test('assigns deterministic evaluated levels', () => {
        const samples = [
            ['weak', 'password123'],
            ['fair', 'aA1!bB2@cC3#dD4'],
            ['good', 'Xk7#mQ2vLp9$Rn4wZt6c'],
            ['strong', GENERATED_KEY],
        ] as const

        for (const [level, value] of samples) {
            expect(evaluateApiKeyStrength(value).level).toBe(level)
            expect(evaluateApiKeyStrength(value)).toEqual(evaluateApiKeyStrength(value))
        }
    })

    test('reports repeated, sequential, common and short weak patterns', () => {
        // noinspection SpellCheckingInspection
        const repeated = evaluateApiKeyStrength('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
        expect(repeated.level).toBe('weak')
        expect(repeated.patterns).toContain('repeated_characters')
        expect(repeated.patterns).toContain('low_unique_characters')
        expect(repeated.suggestions).toContain('avoid_repeated_characters')
        expect(repeated.suggestions).toContain('increase_character_variety')

        const sequential = evaluateApiKeyStrength('abcdefghijklmnopqrstuvwxyz0123456789')
        expect(sequential.patterns).toContain('sequential_characters')
        expect(sequential.suggestions).toContain('avoid_sequences')

        const common = evaluateApiKeyStrength('sk-password-9fKw2mQx7ZtRv4Ns8Lc3Bd')
        expect(common.patterns).toContain('common_term')
        expect(common.suggestions).toContain('avoid_common_terms')

        const short = evaluateApiKeyStrength('aA1!bB2')
        expect(short.patterns).toContain('short')
        expect(short.suggestions).toContain('use_longer_key')
    })

    test('rewards mixed character classes and long random-looking values', () => {
        // noinspection SpellCheckingInspection
        const singleClass = evaluateApiKeyStrength('abcdefghijklmnopqrstuvwx')
        const mixed       = evaluateApiKeyStrength('aB3!eF6@gH9#kL2$mN5%qR8&')

        expect(singleClass.patterns).toContain('limited_character_classes')
        expect(singleClass.suggestions).toContain('mix_character_classes')
        expect(mixed.bits).toBeGreaterThan(singleClass.bits)
        expect(mixed.level).toBe('strong')
        expect(evaluateApiKeyStrength(GENERATED_KEY).level).toBe('strong')
    })

    test('has no persistence, logging, network or clipboard side effects', () => {
        const source = readFileSync(new URL('../src/utils/apiKeyStrength.ts', import.meta.url), 'utf8')

        for (const forbidden of [
            'console.',
            'fetch(',
            'localStorage',
            'sessionStorage',
            'navigator.clipboard',
            '@/services/',
        ]) {
            expect(source).not.toContain(forbidden)
        }
    })
})
