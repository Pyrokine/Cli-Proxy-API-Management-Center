import {describe, expect, test} from 'bun:test'
import {readFileSync} from 'node:fs'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {ApiKeyStrengthMeter} from '@/components/config/ApiKeyStrengthMeter'
import i18n from '@/i18n'

const LOCALES = ['en', 'zh-CN', 'zh-TW', 'ru'] as const

describe('ApiKeyStrengthMeter', () => {
    test('renders accessible progress semantics without rendering the secret', () => {
        const secret = 'sk-DoNotRender-9fKw2mQx7ZtRv4Ns8Lc3Bd'
        const markup = renderToStaticMarkup(createElement(ApiKeyStrengthMeter, { id: 'strength', value: secret }))

        expect(markup).toContain('role="progressbar"')
        expect(markup).toContain('aria-valuemin="0"')
        expect(markup).toContain('aria-valuemax="4"')
        expect(markup).toContain('aria-valuenow=')
        expect(markup).toContain('aria-valuetext=')
        expect(markup).not.toContain(secret)
        expect(markup).not.toContain('title=')
    })

    test('shows masked and weak guidance without echoing input values', () => {
        const maskedMarkup = renderToStaticMarkup(createElement(ApiKeyStrengthMeter, { value: 'ab****yz' }))
        expect(maskedMarkup).toContain(
            i18n.t('config_management.visual.api_keys.strength.levels.masked'),
        )
        expect(maskedMarkup).not.toContain('ab****yz')

        const weakSecret = 'password123'
        const weakMarkup = renderToStaticMarkup(createElement(ApiKeyStrengthMeter, { value: weakSecret }))
        expect(weakMarkup).toContain(
            i18n.t('config_management.visual.api_keys.strength.patterns.common_term'),
        )
        expect(weakMarkup).toContain(
            i18n.t('config_management.visual.api_keys.strength.suggestions.avoid_common_terms'),
        )
        expect(weakMarkup).not.toContain(weakSecret)
    })

    test('keeps all strength locale key sets aligned', async () => {
        const originalLanguage = i18n.language
        const requiredKeys     = [
            'label',
            'patterns_title',
            'suggestions_title',
            'levels.empty',
            'levels.masked',
            'levels.weak',
            'levels.fair',
            'levels.good',
            'levels.strong',
            'patterns.short',
            'patterns.limited_character_classes',
            'patterns.low_unique_characters',
            'patterns.repeated_characters',
            'patterns.repeated_pattern',
            'patterns.sequential_characters',
            'patterns.common_term',
            'suggestions.use_longer_key',
            'suggestions.mix_character_classes',
            'suggestions.increase_character_variety',
            'suggestions.avoid_repeated_characters',
            'suggestions.avoid_repeated_patterns',
            'suggestions.avoid_sequences',
            'suggestions.avoid_common_terms',
            'suggestions.use_generator',
            'suggestions.replace_masked_value',
        ]

        for (const locale of LOCALES) {
            await i18n.changeLanguage(locale)
            for (const key of requiredKeys) {
                const path = `config_management.visual.api_keys.strength.${key}`
                expect(i18n.exists(path)).toBe(true)
                expect(i18n.t(path)).not.toBe(path)
            }
        }

        await i18n.changeLanguage(originalLanguage)
    })

    test('integrates as display-only guidance and does not block save', () => {
        const source     = readFileSync(
            new URL('../src/components/config/VisualConfigEditorBlocks.tsx', import.meta.url),
            'utf8',
        )
        const saveStart  = source.indexOf('const handleSave = async () => {')
        const saveEnd    = source.indexOf('const handleCopy = async', saveStart)
        const saveSource = source.slice(saveStart, saveEnd)

        expect(source).toContain('<ApiKeyStrengthMeter')
        expect(source).toContain('value={inputValue}')
        expect(saveSource).not.toContain('ApiKeyStrengthMeter')
        expect(saveSource).not.toContain('evaluateApiKeyStrength')
        expect(saveSource).not.toContain('strength')
    })
})
