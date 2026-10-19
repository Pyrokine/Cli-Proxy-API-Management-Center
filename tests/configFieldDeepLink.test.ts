import {describe, expect, test} from 'bun:test'
import {readFileSync} from 'node:fs'
import {fileURLToPath, URL} from 'node:url'
import {findConfigFieldById, searchConfigFields} from '../src/components/config/configSearchIndex'
import i18n from '@/i18n'

const readSource = (relativePath: string) => readFileSync(
    fileURLToPath(new URL(relativePath, import.meta.url)),
    'utf8',
)

const configPageSource  = readSource('../src/pages/ConfigPage.tsx')
const visualEditorSource = readSource('../src/components/config/VisualConfigEditor.tsx')
const authEditorSource  = readSource(
    '../src/features/authFiles/components/AuthFilesPrefixProxyEditorModal.tsx',
)
const inputSource       = readSource('../src/components/ui/Input.tsx')

describe('config field deep link', () => {
    test('resolves only known field identities', () => {
        expect(findConfigFieldById('routingStrategy')).toMatchObject({
            fieldId: 'routingStrategy',
            sectionId: 'network',
        })
        expect(findConfigFieldById('unknown')).toBeUndefined()
        expect(findConfigFieldById(null)).toBeUndefined()
    })

    test('finds every payload rule by its fork YAML path in each locale', () => {
        const rules = [
            ['payloadDefaultRules', 'default'], ['payloadDefaultRawRules', 'default-raw'],
            ['payloadOverrideRules', 'override'], ['payloadOverrideRawRules', 'override-raw'],
            ['payloadFilterRules', 'filter'],
        ] as const
        for (const locale of ['en', 'zh-CN', 'zh-TW', 'ru']) {
            const translate = i18n.getFixedT(locale)
            for (const [fieldId, yamlKey] of rules) {
                expect(findConfigFieldById(fieldId)).toMatchObject({sectionId: 'payload', yamlKeys: ['payload', yamlKey]})
                for (const separator of ['.', ' ', '_', '-']) {
                    expect(searchConfigFields(`payload${separator}${yamlKey}`, translate)
                        .some((entry) => entry.fieldId === fieldId)).toBe(true)
                }
            }
        }
    })

    test('switches to the visual editor without dropping its current draft', () => {
        expect(configPageSource).toContain("new URLSearchParams(location.search).get('field')")
        expect(configPageSource).toContain("handleTabChange('visual')")
        expect(configPageSource).toContain('setFieldJumpRequest({ key: requestKey, entry: requestedField })')
        expect(configPageSource).toContain('requestedField={fieldJumpRequest?.entry}')
        expect(configPageSource).toContain('requestedFieldRequestKey={fieldJumpRequest?.key}')
        expect(configPageSource).toContain('allowNextNavigation()')
        expect(configPageSource).toContain("params.delete('field')")
    })

    test('treats every router location as a new request and waits for loading or saving to finish', () => {
        expect(configPageSource).toContain('`${location.key}:${requestedField.fieldId}`')
        expect(configPageSource).toContain('handledFieldRequestRef.current === requestKey')
        expect(configPageSource).toContain('!requestedField || loading || saving')
        expect(configPageSource).toContain("(activeTab === 'visual' && visualParseError)")
    })

    test('opens the full section, highlights the field and moves keyboard focus', () => {
        expect(visualEditorSource).toContain("handleModeChange('full')")
        expect(visualEditorSource).toContain('setActiveSectionId(entry.sectionId)')
        expect(visualEditorSource).toContain('element.classList.add(styles.fieldHighlightActive)')
        expect(visualEditorSource).toContain("'input:not([disabled]), textarea:not([disabled]), select:not([disabled]), '")
        expect(visualEditorSource).toContain('?.focus({ preventScroll: true })')
    })
})

describe('credential weight routing link', () => {
    test('supports rich input hints and exposes the routing link in every locale', async () => {
        expect(inputSource).toContain('hint?: ReactNode')
        for (const locale of ['en', 'ru', 'zh-CN', 'zh-TW']) {
            const messages = await Bun.file(`src/i18n/locales/${locale}.json`).json() as {
                auth_files: { weight_hint: string }
            }
            expect(messages.auth_files.weight_hint).toContain('<settingsLink>')
            expect(messages.auth_files.weight_hint).toContain('</settingsLink>')
        }
    })

    test('confirms before discarding a dirty editor and blocks navigation while saving', () => {
        expect(authEditorSource).toContain('if (editor?.saving)')
        expect(authEditorSource).toContain('onConfirm: close')
        expect(authEditorSource).toContain('onClose()\n            afterClose?.()')
        expect(authEditorSource).toContain("requestClose(() => navigate('/config?field=routingStrategy'))")
        expect(authEditorSource).toContain('event.preventDefault()')
        expect(authEditorSource).toContain('aria-disabled={editor.saving}')
        expect(authEditorSource).toContain('tabIndex={editor.saving ? -1 : undefined}')
    })
})
