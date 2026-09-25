import {describe, expect, test} from 'bun:test'
import type {ChangeEvent, ReactElement, ReactNode} from 'react'
import {Children, createElement, isValidElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {CredentialCard} from '@/components/credentials/CredentialCard'
import {getCooldownRemainingSeconds} from '@/utils/time/durations'
import {SelectionCheckbox} from '@/components/ui/SelectionCheckbox'
import type {AuthFileCooldownSnapshot} from '@/types/authFile'
import {ToggleSwitch} from '@/components/ui/ToggleSwitch'
import i18n from '@/i18n'

interface CheckboxInputProps {
    type?: string
    onChange?: (event: ChangeEvent<HTMLInputElement>) => void
}

const findCheckboxInput = (tree: ReactElement): ReactElement<CheckboxInputProps> => {
    const children = Children.toArray((tree.props as {children?: ReactNode}).children)
    const input = children.find(
        (child): child is ReactElement<CheckboxInputProps> =>
            isValidElement<CheckboxInputProps>(child) && child.type === 'input',
    )
    if (!input) {
        throw new Error('checkbox input was not rendered')
    }
    return input
}

const renderCard = (controlLabel: string) =>
    renderToStaticMarkup(
        createElement(CredentialCard, {
            category: 'auth-file',
            title: 'account-and-token-must-not-name-controls',
            controlLabel,
            badge: {label: 'Devin'},
            selected: false,
            onSelect: () => undefined,
            disabled: false,
            onToggle: () => undefined,
            disableControls: false,
        }),
    )

const cooldownSnapshot = (
    records: AuthFileCooldownSnapshot['records'],
    receivedAtMs = Date.now(),
): AuthFileCooldownSnapshot => ({
    observedAt: '2026-09-16T12:00:00.000Z',
    receivedAtMs,
    records,
})

const renderCooldownCard = (snapshot: AuthFileCooldownSnapshot) =>
    renderToStaticMarkup(
        createElement(CredentialCard, {
            category: 'auth-file',
            title: 'cooldown-account',
            controlLabel: 'Codex codex:one',
            cooldownSnapshot: snapshot,
        }),
    )

const readAriaLabels = (markup: string): string[] =>
    Array.from(markup.matchAll(/aria-label="([^"]+)"/g), (match) => match[1] ?? '')

describe('credential card accessibility', () => {
    test('renders credential-specific selection and status names in every locale', async () => {
        const originalLanguage = i18n.language
        const expected = {
            en: ['Select credential Devin devin:one', 'Enable or disable credential Devin devin:one'],
            ru: [
                'Выбрать учётные данные Devin devin:one',
                'Включить или отключить учётные данные Devin devin:one',
            ],
            'zh-CN': ['选择凭证 Devin devin:one', '启用或禁用凭证 Devin devin:one'],
            'zh-TW': ['選取憑證 Devin devin:one', '啟用或停用憑證 Devin devin:one'],
        } as const

        try {
            for (const [language, labels] of Object.entries(expected)) {
                await i18n.changeLanguage(language)
                expect(readAriaLabels(renderCard('Devin devin:one'))).toEqual([...labels])
            }
        } finally {
            await i18n.changeLanguage(originalLanguage)
        }
    })

    test('uses opaque runtime identity instead of account or token text', () => {
        const first = readAriaLabels(renderCard('Devin devin:first'))
        const second = readAriaLabels(renderCard('Devin devin:second'))

        expect(first).not.toEqual(second)
        expect(first.every((label) => label.includes('devin:first'))).toBe(true)
        expect(second.every((label) => label.includes('devin:second'))).toBe(true)
        expect([...first, ...second].some((label) => label.includes('account-and-token'))).toBe(false)
    })

    test('uses a local received timestamp for cooldown countdowns', () => {
        expect(getCooldownRemainingSeconds(60, 10_000, 10_000)).toBe(60)
        expect(getCooldownRemainingSeconds(60, 10_000, 10_001)).toBe(60)
        expect(getCooldownRemainingSeconds(60, 10_000, 11_000)).toBe(59)
        expect(getCooldownRemainingSeconds(60, 10_000, 70_000)).toBe(0)
        expect(getCooldownRemainingSeconds(60, 10_000, 9_000)).toBe(60)
    })

    test('uses semantic details and escapes model cooldown keys', () => {
        const unknown = renderCooldownCard(cooldownSnapshot(null))
        const empty   = renderCooldownCard(cooldownSnapshot([]))
        const active  = renderCooldownCard(cooldownSnapshot([{
                                                                 scope: 'model',
                                                                 modelKey: '<script>unsafe-as-text</script>',
                                                                 retryAt: '2026-09-16T12:01:00.000Z',
                                                                 remainingSeconds: 10,
                                                                 reason: 'constructor',
                                                             }]))

        expect(unknown).toContain('<details')
        expect(unknown).toContain('<summary>')
        expect(empty).toContain('<details')
        expect(active).toContain('&lt;script&gt;unsafe-as-text&lt;/script&gt;')
        expect(active).not.toContain('<script>unsafe-as-text</script>')
        expect(active).toContain(i18n.t('credentials.cooldown_reason_unknown'))
    })

    test('stops rendering elapsed cooldowns without claiming credential recovery', () => {
        const expired = renderCooldownCard(cooldownSnapshot([{
                                                                 scope: 'credential',
                                                                 retryAt: '2026-09-16T12:01:00.000Z',
                                                                 remainingSeconds: 1,
                                                                 reason: 'quota',
                                                             }], 0))

        expect(expired).not.toContain(i18n.t('credentials.cooldowns_empty'))
        expect(expired).not.toContain(i18n.t('credentials.inspection_status_normal'))
        expect(expired).not.toContain('<details')
    })

    test('keeps native checkbox semantics and forwards checked state', () => {
        const changes: boolean[] = []
        const selectionInput = findCheckboxInput(
            SelectionCheckbox({checked: false, onChange: (checked) => changes.push(checked), ariaLabel: 'select'}),
        )
        const toggleInput = findCheckboxInput(
            ToggleSwitch({checked: true, onChange: (checked) => changes.push(checked), ariaLabel: 'toggle'}),
        )

        expect(selectionInput.props.type).toBe('checkbox')
        expect(toggleInput.props.type).toBe('checkbox')
        selectionInput.props.onChange?.({target: {checked: true}} as ChangeEvent<HTMLInputElement>)
        toggleInput.props.onChange?.({target: {checked: false}} as ChangeEvent<HTMLInputElement>)
        expect(changes).toEqual([true, false])
    })
})
