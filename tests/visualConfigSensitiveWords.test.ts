import {describe, expect, test} from 'bun:test'
import {readFileSync} from 'node:fs'
import {fileURLToPath, URL} from 'node:url'
import {parse} from 'yaml'
import {findConfigFieldById} from '../src/components/config/configSearchIndex'
import {
    areVisualConfigValuesEqual,
    decodeVisualConfigYaml,
    encodeVisualConfigYaml,
} from '../src/hooks/visualConfigCodec'

const readSource = (relativePath: string) => readFileSync(
    fileURLToPath(new URL(relativePath, import.meta.url)),
    'utf8',
)

describe('visual config provider sensitive words', () => {
    test('loads Antigravity and Devin lists independently', () => {
        const values = decodeVisualConfigYaml(
            'antigravity:\n  sensitive-words:\n    - proxy\n' +
            'devin:\n  sensitive-words:\n    - Claude Code\n    - security testing\n',
        ).values

        expect(values.antigravitySensitiveWords).toEqual(['proxy'])
        expect(values.devinSensitiveWords).toEqual(['Claude Code', 'security testing'])
    })

    test('writes trimmed lists without replacing retained sequence nodes or provider siblings', () => {
        const source =
            '# root comment\n' +
            'antigravity:\n' +
            '  # antigravity list comment\n' +
            '  sensitive-words:\n' +
            '    # antigravity item comment\n' +
            '    - "proxy" # antigravity inline comment\n' +
            '  antigravity-future-option: true\n' +
            'devin:\n' +
            '  # devin list comment\n' +
            '  sensitive-words:\n' +
            '    # devin item comment\n' +
            '    - "old-word" # devin inline comment\n' +
            '  # devin unknown comment\n' +
            '  future-option: true\n'
        const decoded = decodeVisualConfigYaml(source)
        const next = {
            ...decoded.values,
            antigravitySensitiveWords: [' proxy ', '', 'Nous Research'],
            devinSensitiveWords: [' old-word ', '', 'new phrase'],
        }

        const output = encodeVisualConfigYaml(
            source,
            next,
            decoded.values,
            decoded.apiKeysStorage,
        )
        const parsed = parse(output)

        expect(parsed.antigravity).toEqual({
            'sensitive-words': ['proxy', 'Nous Research'],
            'antigravity-future-option': true,
        })
        expect(parsed.devin).toEqual({
            'sensitive-words': ['old-word', 'new phrase'],
            'future-option': true,
        })
        for (const comment of [
            'root comment',
            'antigravity list comment',
            'antigravity item comment',
            'antigravity inline comment',
            'devin list comment',
            'devin item comment',
            'devin inline comment',
            'devin unknown comment',
        ]) {
            expect(output).toContain(comment)
        }
        expect(output).toContain('- "proxy" # antigravity inline comment')
        expect(output).toContain('- "old-word" # devin inline comment')
    })

    test('clears each key and removes provider maps that become empty', () => {
        const source =
            'debug: true\n' +
            'antigravity:\n  sensitive-words:\n    - proxy\n' +
            'devin:\n  sensitive-words:\n    - remove-me\n'
        const decoded = decodeVisualConfigYaml(source)
        const output = encodeVisualConfigYaml(
            source,
            {
                ...decoded.values,
                antigravitySensitiveWords: [],
                devinSensitiveWords: [],
            },
            decoded.values,
            decoded.apiKeysStorage,
        )

        expect(parse(output)).toEqual({debug: true})
    })

    test('restoring either list clears the visual dirty state comparison', () => {
        const baseline = decodeVisualConfigYaml(
            'antigravity:\n  sensitive-words: [proxy]\n' +
            'devin:\n  sensitive-words: [original]\n',
        ).values
        const changed = {
            ...baseline,
            devinSensitiveWords: ['changed'],
        }
        const restored = {
            ...changed,
            devinSensitiveWords: ['original'],
        }

        expect(areVisualConfigValuesEqual(changed, baseline)).toBe(false)
        expect(areVisualConfigValuesEqual(restored, baseline)).toBe(true)
        expect(restored.antigravitySensitiveWords).toEqual(['proxy'])
    })

    test('indexes and renders both fields with localized behavior text', async () => {
        expect(findConfigFieldById('antigravitySensitiveWords')).toMatchObject({
            sectionId: 'advanced',
            yamlKeys: ['antigravity', 'sensitive-words'],
        })
        expect(findConfigFieldById('devinSensitiveWords')).toMatchObject({
            sectionId: 'advanced',
            yamlKeys: ['devin', 'sensitive-words'],
        })

        const editorSource = readSource('../src/components/config/VisualConfigEditor.tsx')
        for (const field of ['antigravitySensitiveWords', 'devinSensitiveWords']) {
            expect(editorSource).toContain(`fieldId='${field}'`)
            expect(editorSource).toContain(`value={values.${field}}`)
        }

        for (const locale of ['en', 'ru', 'zh-CN', 'zh-TW']) {
            const messages = await Bun.file(`src/i18n/locales/${locale}.json`).json() as {
                config_management: {
                    visual: {
                        sections: {
                            system: Record<string, string>
                        }
                    }
                }
            }
            const system = messages.config_management.visual.sections.system
            for (const provider of ['antigravity', 'devin']) {
                expect(system[`${provider}_sensitive_words`]).toBeTruthy()
                expect(system[`${provider}_sensitive_words_desc`]).toBeTruthy()
                expect(system[`${provider}_sensitive_words_label`]).toBeTruthy()
                expect(system[`${provider}_sensitive_words_hint`]).toBeTruthy()
            }
        }
    })
})
