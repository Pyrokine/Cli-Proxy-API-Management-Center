import {describe, expect, test} from 'bun:test'
import {
    formatExcludedModelsText,
    isModelExcludedByRules,
    matchesExcludedModelRule,
    normalizeExcludedModelRules,
    parseExcludedModelsText,
    replaceCustomExcludedModelRules,
    splitExcludedModelRules,
    toggleExcludedModelRule,
} from '@/utils/excludedModels'

describe('excluded model rules', () => {
    test('normalizes comma/newline input without reordering surviving rules', () => {
        const rules = parseExcludedModelsText(` GPT-5-*
gpt-5-*, retired-model `)
        expect(rules).toEqual(['GPT-5-*', 'retired-model'])
        expect(parseExcludedModelsText(formatExcludedModelsText(rules))).toEqual(rules)
    })

    test('matches only * as a wildcard and escapes regex punctuation', () => {
        expect(matchesExcludedModelRule('gpt-4.*', 'gpt-4.1-mini')).toBe(true)
        expect(matchesExcludedModelRule('gpt-4.*', 'gpt-4x1-mini')).toBe(false)
        expect(matchesExcludedModelRule('gpt-5', 'gpt-5-mini')).toBe(false)
    })

    test('splits catalog selections from custom and unknown rules', () => {
        expect(splitExcludedModelRules(
            ['GPT-5-Codex', 'gpt-5-*', 'retired-model'],
            ['gpt-5-codex', 'claude-opus'],
        )).toEqual({
                       selectedIds: ['gpt-5-codex'],
                       wildcardRules: ['gpt-5-*'],
                       unknownRules: ['retired-model'],
                       customRules: ['gpt-5-*', 'retired-model'],
                   })
    })

    test('selection changes preserve custom rules and clear explicit models', () => {
        const rules = normalizeExcludedModelRules(['gpt-5-codex', 'gpt-5-*', 'retired-model'])
        expect(toggleExcludedModelRule(rules, 'GPT-5-CODEX', false)).toEqual([
                                                                                 'gpt-5-*',
                                                                                 'retired-model',
                                                                             ])
        expect(replaceCustomExcludedModelRules(rules, ['gpt-5-codex'], 'new-*')).toEqual([
                                                                                             'gpt-5-codex',
                                                                                             'new-*',
                                                                                         ])
        expect(isModelExcludedByRules(['gpt-5-*'], 'GPT-5-Mini')).toBe(true)
    })
})
