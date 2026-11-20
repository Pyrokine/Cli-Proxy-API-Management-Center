import {Button} from '@/components/ui/Button'
import {IconX} from '@/components/ui/icons'
import {Input} from '@/components/ui/Input'
import {Modal} from '@/components/ui/Modal'
import {ModelInputList} from '@/components/ui/ModelInputList'
import {
    getModelEntriesValidationKey,
    type ModelEntry,
    parseThinkingLevelsInput,
    updateModelNumericField,
} from '@/components/ui/modelInputListUtils'
import {Pagination} from '@/components/ui/Pagination'
import {Select} from '@/components/ui/Select'
import {ToggleSwitch} from '@/components/ui/ToggleSwitch'
import i18n from '@/i18n'
import {ModelCheckboxList} from '@/pages/ModelCheckboxList'
import {buildHeaderObject} from '@/utils/headers'
import {normalizeModelThinking} from '@/utils/modelMetadata'
import type {ModelInfo} from '@/utils/models'
import {
    canApplyDiscoveredModels,
    findMissingProviderModelNames,
    mergeProviderModelEntries,
} from '@/utils/providerModels'
import {describe, expect, mock, test} from 'bun:test'
import {readFileSync} from 'node:fs'
import React, {Fragment, type ReactElement, type ReactNode} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {sourceCallback, sourceInitializer} from './sourceCallbacks'

const models      = Array.from({ length: 463 }, (_, index) => ({
    name: `model-${String(index).padStart(3, '0')}`,
    alias: `Public ${index}`,
    description: `Description ${index}`,
}))
const editorFile  = 'components/ui/ModelInputList.tsx'
const contentFile = 'pages/ModelDiscoveryModal.tsx'
const noop        = () => undefined
const t           = (key: string) => key

type Element = ReactElement<Record<string, unknown> & { children?: ReactNode }>

function elements(node: ReactNode): Element[] {
    if (Array.isArray(node)) {
        return node.flatMap(elements)
    }
    if (!React.isValidElement<Record<string, unknown> & { children?: ReactNode }>(node)) {
        return []
    }
    return [node, ...elements(node.props.children)]
}

function element(node: ReactNode, matches: (candidate: Element) => boolean): Element {
    const found = elements(node).find(matches)
    if (!found) {
        throw new Error('Expected control was not rendered')
    }
    return found
}

function click(control: Element) {
    ;(control.props.onClick as () => void)()
}

function change(control: Element, value: string) {
    ;(control.props.onChange as (event: { target: { value: string } }) => void)({ target: { value } })
}

function mount<P extends object>(file: string, name: string, initialProps: P, scope: Record<string, unknown>) {
    const state: unknown[]                  = []
    const refs: Array<{ current: unknown }> = []
    let stateIndex                          = 0
    let refIndex                            = 0
    let changed                             = false
    const component                         = sourceCallback<(props: P) => ReactElement>(file, name, {
        React, Fragment, useTranslation: () => ({ t }), styles: {},
        useMemo: <T, >(build: () => T) => build(),
        useId: () => 'synthetic-endpoint',
        useState: (initial: unknown) => {
            const index = stateIndex++
            if (index >= state.length) {
                state[index] = initial
            }
            return [
                state[index], (value: unknown) => {
                    const next   = typeof value === 'function' ? value(state[index]) : value
                    changed ||= !Object.is(next, state[index])
                    state[index] = next
                },
            ]
        },
        useRef: (initial: unknown) => {
            const index = refIndex++
            refs[index] ??= { current: initial }
            return refs[index]
        },
        useEffect: noop,
        ...scope,
    })
    return {
        props: initialProps,
        render() {
            for (let attempt = 0; attempt < 5; ++attempt) {
                changed      = false
                stateIndex   = 0
                refIndex     = 0
                const result = component(this.props)
                if (!changed) {
                    return result
                }
            }
            throw new Error('Model controls did not finish their render-state update')
        },
    }
}

function editor(initial: ModelEntry[]) {
    let entries   = initial
    const mounted = mount(editorFile, 'ModelInputList', {
        entries,
        provider: 'openai',
        onChange: (updated: ModelEntry[]) => {
            entries               = updated
            mounted.props.entries = updated
        },
    }, {
                              Input,
                              Button,
                              Select,
                              Pagination,
                              IconX,
                              getModelEntriesValidationKey,
                              updateModelNumericField,
                              parseThinkingLevelsInput,
                              normalizeModelThinking,
                              MODEL_PAGE_SIZE: sourceInitializer<number>(editorFile, 'MODEL_PAGE_SIZE', {}),
                              ADVANCED_BOOLEAN_FIELDS: sourceInitializer(editorFile, 'ADVANCED_BOOLEAN_FIELDS', {}),
                              THINKING_BOOLEAN_FIELDS: sourceInitializer(editorFile, 'THINKING_BOOLEAN_FIELDS', {}),
                          })
    return { mounted, entries: () => entries }
}

function searchEditor(mounted: ReturnType<typeof editor>['mounted'], value: string) {
    change(element(mounted.render(), (node) => node.type === Input), value)
    return mounted.render()
}

function modelNames(node: ReactNode) {
    return elements(node)
        .filter((candidate) => candidate.type === 'input' &&
                               candidate.props['aria-label'] === 'model-name')
        .map((candidate) => candidate.props.value)
}

for (const [file, callback] of [
    ['hooks/useModelDiscovery.ts', 'fetchDiscovery'],
    ['pages/ProviderModelsPage.tsx', 'doFetch'],
]) {
    test(`${file} leaves all newly fetched models unselected and preserves configured entries`, async () => {
        const entries            = [
            {
                name: models[0].name,
                alias: 'Keep alias',
                description: 'Keep description',
                future: true,
            },
        ]
        let selected             = new Set(['stale-selection'])
        let fetched: ModelInfo[] = []
        const scope              = {
            authGeneration: 1, apiClient: { getAuthGeneration: () => 1 },
            requestControllerRef: { current: null }, requestIdRef: { current: 0 }, requestGenerationRef: { current: 0 },
            formState: { apiKey: 'synthetic', baseUrl: 'https://fixture.invalid', headers: [], modelEntries: entries },
            configuredModelEntries: entries, buildHeaderObject, findMissingProviderModelNames,
            normalizeName: (name: string) => name.trim(),
            discoveryConfigRef: { current: { fetchModels: async () => models } },
            fetchModels: async () => models,
            setSelected: (value: Set<string>) => {
                selected = value
            },
            setModels: (value: ModelInfo[]) => {
                fetched = value
            },
            setDiscoveredModels: (value: ModelInfo[]) => {
                fetched = value
            },
            setDiscoveryGeneration: noop, setFetching: noop, setError: noop,
        }
        await sourceCallback<() => Promise<void>>(file, callback, scope)()
        expect(fetched).toHaveLength(463)
        expect(selected.size).toBe(0)
        expect(entries).toEqual([
                                    {
                                        name: models[0].name,
                                        alias: 'Keep alias',
                                        description: 'Keep description',
                                        future: true,
                                    },
                                ])
        const common = {
            sourceLoaded: true, selected, disableControls: false, saving: false, fetching: false,
            flags: { disableControls: false, saving: false }, canApplyDiscoveredModels,
        }
        expect(sourceInitializer<boolean>(file, 'canApply', common)).toBe(false)
    })
}

test(
    'select all and deselect all cover every search result across pages and preserve choices outside the result',
    () => {
        const matching = models.slice(100, 180)
        let selected   = new Set([models[130].name, models[400].name])
        const toggle   = sourceInitializer<(name: string) => void>('pages/ProviderModelsPage.tsx', 'toggleSelection', {
            setSelected: (update: (previous: Set<string>) => Set<string>) => {
                selected = update(selected)
            },
        })
        const mounted  = mount(contentFile, 'ProviderModelSelectionContent', {
            i18nPrefix: 'openai_models',
            endpoint: 'https://fixture.invalid/v1/models',
            discoveredModels: models,
            filteredModels: matching,
            search: 'matching family',
            fetching: false,
            error: '',
            disabled: false,
            selected,
            missingModelNames: new Set(models.filter((_, index) => index !== 105).map((model) => model.name)),
            onSearchChange: noop,
            onToggleSelection: toggle,
            onRefresh: noop,
        }, { Input, Button, ToggleSwitch, ModelCheckboxList })
        const action   = (key: string) => element(
            mounted.render(),
            (node) => node.type === Button && node.props.children === key,
        )
        click(action('ai_providers.models_select_visible'))
        expect(selected.size).toBe(80)
        for (const model of matching.filter((value) => value.name !== models[105].name)) {
            expect(selected.has(model.name)).toBe(true)
        }
        expect(selected.has(models[105].name)).toBe(false)
        expect(selected.has(models[400].name)).toBe(true)
        mounted.props.selected = selected
        const html             = renderToStaticMarkup(mounted.render())
        const rendered         = [...html.matchAll(/<input\b[^>]*type="checkbox"[^>]*>/g)]
            .filter(([tag]) => tag.includes('aria-label="model-'))
        expect(rendered).toHaveLength(20)
        expect(selected.has(models[179].name)).toBe(true)
        click(action('ai_providers.models_clear_visible'))
        expect([...selected]).toEqual([models[400].name])
        const translate = i18n.getFixedT('zh-CN')
        expect(translate('ai_providers.models_select_visible', { count: 79 })).toBe('全选当前结果（79）')
        expect(translate('ai_providers.models_clear_visible')).toBe('全不选当前结果')
    },
)

test('selected-only review and clear operate within the current search without discarding hidden choices', () => {
    let selected       = new Set([models[2].name, models[400].name])
    const toggle       = sourceInitializer<(name: string) => void>('pages/ProviderModelsPage.tsx', 'toggleSelection', {
        setSelected: (update: (previous: Set<string>) => Set<string>) => {
            selected = update(selected)
        },
    })
    const mounted      = mount(contentFile, 'ProviderModelSelectionContent', {
        i18nPrefix: 'openai_models', endpoint: 'https://fixture.invalid/v1/models', discoveredModels: models,
        filteredModels: models, search: '', fetching: false, error: '', disabled: false,
        selected, missingModelNames: new Set(models.map((model) => model.name)),
        onSearchChange: noop, onToggleSelection: toggle, onRefresh: noop,
    }, { Input, Button, ToggleSwitch, ModelCheckboxList })
    const onlySelected = element(mounted.render(), (node) => node.type === ToggleSwitch)
    ;(onlySelected.props.onChange as (value: boolean) => void)(true)
    const list = () => element(mounted.render(), (node) => node.type === ModelCheckboxList)
    expect((list().props.models as ModelInfo[]).map((model) => model.name)).toEqual([models[2].name, models[400].name])
    mounted.props.filteredModels = [models[400]]
    mounted.props.search         = 'model-400'
    expect(list().props.models).toEqual([models[400]])
    click(element(mounted.render(), (node) => node.type === Button &&
                                              node.props.children === 'ai_providers.models_clear_visible'))
    expect([...selected]).toEqual([models[2].name])
    mounted.props.selected = selected
    expect(elements(mounted.render()).some((node) => node.type === ModelCheckboxList)).toBe(false)
})

test('discovery renders a bounded page, retains full alias/id/description and marks configured models', () => {
    const html       = renderToStaticMarkup(<ModelCheckboxList models={models} selected={new Set()}
                                                               missingModelNames={new Set(models.slice(1)
                                                                                                .map((model) => model.name))}
                                                               onToggle={noop} />)
    const checkboxes = [...html.matchAll(/<input\b[^>]*type="checkbox"[^>]*>/g)].map(([tag]) => tag)
    expect(checkboxes).toHaveLength(20)
    expect(checkboxes[0]).toContain('checked=""')
    expect(checkboxes[0]).toContain('disabled=""')
    expect(checkboxes.slice(1).every((tag) => !tag.includes('checked=""'))).toBe(true)
    expect(html).toContain('Public 0')
    expect(html).toContain('model-000')
    expect(html).toContain('Description 0')
    expect(html).toContain('model-019')
    expect(html).not.toContain('model-020')
})

test('cancel remains available while fetching and never applies a selection', () => {
    const onClose = mock(noop)
    const onApply = mock(noop)
    const mounted = mount(contentFile, 'ModelDiscoveryModal', {
        open: true,
        onClose,
        onApply,
        fetching: true,
        i18nPrefix: 'codex',
        selected: new Set(['synthetic']),
        endpoint: '',
        discoveredModels: [],
        filteredModels: [],
        error: '',
        search: '',
        onSearchChange: noop,
        missingModelNames: new Set<string>(),
        onToggleSelection: noop,
        onRefresh: noop,
        canApply: false,
        disabled: false,
    }, { Modal, Button, ProviderModelSelectionContent: noop })
    const footer  = mounted.render().props as { footer: ReactNode }
    const cancel  = element(footer.footer, (node) => node.type === Button && node.props.children === 'common.cancel')
    expect(Boolean(cancel.props.disabled)).toBe(false)
    click(cancel)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onApply).not.toHaveBeenCalled()
})

for (const [file, callback] of [
    ['hooks/useModelDiscovery.ts', 'applySelected'],
    ['pages/ProviderModelsPage.tsx', 'handleApply'],
]) {
    test(`${file} appends one selected model while empty selection leaves the configuration unchanged`, () => {
        const original = [{ name: 'custom', alias: 'Custom alias', description: 'Keep', future: { keep: true } }]
        for (const selected of [new Set<string>(), new Set([models[462].name])]) {
            let entries: ModelEntry[] = original
            const merge               = mock((picked: ModelInfo[]) => {
                entries = mergeProviderModelEntries(entries, picked).entries
            })
            sourceInitializer<() => void>(file, callback, {
                sourceLoaded: true, authGeneration: 1, apiClient: { getAuthGeneration: () => 1 },
                models, discoveredModels: models, selected, mergeDiscoveredModels: merge,
                setOpen: noop, handleBack: noop,
            })()
            expect(entries[0]).toBe(original[0])
            expect(entries).toHaveLength(selected.size ? 2 : 1)
            expect(merge).toHaveBeenCalledTimes(selected.size)
            if (selected.size) {
                expect(entries[1]).toEqual({ name: models[462].name, alias: models[462].alias })
            }
        }
    })
}

describe('configured model list', () => {
    test('renders twenty entries at a time and keeps model parameters collapsed until requested', () => {
        const entries = models.map((model) => ({ ...model, alias: model.alias ?? '' }))
        const html    = renderToStaticMarkup(<ModelInputList entries={entries} onChange={noop}
                                                             provider='openai' metadataEditing />)
        expect([...html.matchAll(/<input\b[^>]*aria-label="model-name"[^>]*>/g)]).toHaveLength(20)
        expect(html).toContain('value="model-019"')
        expect(html).not.toContain('value="model-020"')
        const details = [...html.matchAll(/<details\b[^>]*>/g)].map(([tag]) => tag)
        expect(details.length).toBeGreaterThan(0)
        expect(details.every((tag) => !/\bopen[=\s>]/.test(tag))).toBe(true)
        expect(html).toContain(i18n.t('ai_providers.model_thinking_mode'))
    })

    test(
        'searches the full list by alias and removes the matched absolute index without changing other entries',
        () => {
            const entries                       = models.map((model) => ({
                ...model,
                alias: model.alias ?? '',
                future: { keep: model.name },
            }))
            const { mounted, entries: current } = editor(entries)
            const filtered                      = searchEditor(mounted, 'Public 462')
            expect(modelNames(filtered)).toEqual(['model-462'])
            click(element(filtered, (node) => node.type === Button && node.props['aria-label'] === 'Remove'))
            expect(current()).toHaveLength(462)
            expect(current()).toEqual(entries.slice(0, -1))
            expect(current()[0]).toBe(entries[0])
            expect(modelNames(mounted.render())).toEqual([])
            expect(modelNames(searchEditor(mounted, 'description 461'))).toEqual(['model-461'])
        },
    )

    test('paging edits the original entry, preserving off-page aliases and metadata', () => {
        const entries                       = models.map((model) => ({ ...model, alias: model.alias ?? '' }))
        const { mounted, entries: current } = editor(entries)
        const paging                        = element(mounted.render(), (node) => node.type === Pagination)
        ;(paging.props.onPageChange as (page: number) => void)(20)
        const page = mounted.render()
        expect(modelNames(page)[0]).toBe('model-380')
        change(element(page, (node) => node.type === 'input' && node.props.value === 'Public 380'), 'Edited alias')
        expect(current()[380]).toMatchObject({
                                                 name: 'model-380',
                                                 alias: 'Edited alias',
                                                 description: 'Description 380',
                                             })
        expect(current()[0]).toBe(entries[0])
        expect(current()[462]).toBe(entries[462])
    })

    test('removing the final page keeps the adjusted page when named models are appended later', () => {
        const entries                       = models.map((model) => ({ ...model, alias: model.alias ?? '' }))
        const { mounted, entries: current } = editor(entries)
        const paging                        = element(mounted.render(), (node) => node.type === Pagination)
        ;(paging.props.onPageChange as (page: number) => void)(24)
        for (let index = 0; index < 3; ++index) {
            const removes = elements(mounted.render()).filter((node) => node.type === Button &&
                                                                        node.props['aria-label'] === 'Remove')
            click(removes[removes.length - 1])
        }
        expect(modelNames(mounted.render())[0]).toBe('model-440')
        mounted.props.entries = [...current(), { name: 'newly-discovered', alias: '' }]
        expect(modelNames(mounted.render())[0]).toBe('model-440')
        expect(modelNames(mounted.render())).not.toContain('newly-discovered')
    })

    test(
        'an externally added custom row clears the filter and opens its page without resetting existing entries',
        () => {
            const entries                       = models.map((model) => ({ ...model, alias: model.alias ?? '' }))
            const { mounted, entries: current } = editor(entries)
            searchEditor(mounted, 'Public 2')
            mounted.props.entries = [...entries, { name: '', alias: '' }]
            const page            = mounted.render()
            expect(element(page, (node) => node.type === Input).props.value).toBe('')
            expect(modelNames(page)).toEqual(['model-460', 'model-461', 'model-462', ''])
            change(element(page, (node) => node.type === 'input' && node.props['aria-label'] === 'model-name' &&
                                           node.props.value === ''), 'custom-model')
            expect(current()[463]).toEqual({ name: 'custom-model', alias: '' })
            expect(current().slice(0, -1)).toEqual(entries)
        },
    )

    test('focuses a newly appended custom entry once and leaves discovered model additions unfocused', () => {
        for (const name of ['', 'discovered-model']) {
            const focus  = mock(noop)
            const scope  = {
                entries: [{ name: 'existing', alias: '' }, { name, alias: '' }],
                previousLengthRef: { current: 1 }, lastEntryRef: { current: { focus } },
            }
            const effect = sourceCallback<() => void>(
                editorFile, 'useEffect', scope,
                'const added = entries.length > previousLengthRef.current',
            )
            effect()
            effect()
            expect(scope.previousLengthRef.current).toBe(2)
            expect(focus).toHaveBeenCalledTimes(name ? 0 : 1)
        }
    })

    test('both discovered and configured rows stay inside bounded, scrollable regions', () => {
        for (const [path, selector] of [
            ['pages/ModelDiscovery.module.scss', 'list'],
            ['components/ui/ModelInputList.module.scss', 'entryList'],
        ]) {
            const css  = readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8')
            const rule = css.match(new RegExp(`\\.${selector}\\s*\\{([^}]+)\\}`))?.[1] ?? ''
            expect(rule).toContain('max-height: min(')
            expect(rule).toContain('overflow-y: auto')
            expect(rule).toContain('overscroll-behavior: contain')
        }
    })

    test('a matching row stays editable while focused and disappears only after leaving it', () => {
        const { mounted } = editor([{ name: 'original-model', alias: 'keep-alias' }])
        let page          = searchEditor(mounted, 'original-model')
        const row         = element(
                  page,
                  (node) => node.type === 'div' && typeof node.props.onFocusCapture === 'function',
              )
        ;(row.props.onFocusCapture as () => void)()
        page = mounted.render()
        change(element(page, (node) => node.type === 'input' && node.props.value === 'original-model'), 'renamed-model')
        expect(modelNames(mounted.render())).toEqual(['renamed-model'])
        ;(row.props.onBlurCapture as (event: {
            currentTarget: { contains: () => boolean };
            relatedTarget: null
        }) => void)({
                        currentTarget: { contains: () => false }, relatedTarget: null,
                    })
        expect(modelNames(mounted.render())).toEqual([])
    })

    test('removing the last named entry leaves only the existing empty placeholder contract', () => {
        const { mounted, entries } = editor([
                                                {
                                                    name: 'only-model',
                                                    alias: 'Only alias',
                                                    future: 'preserve-until-removal',
                                                },
                                            ])
        const remove               = element(
            mounted.render(),
            (node) => node.type === Button && node.props['aria-label'] === 'Remove',
        )
        expect(remove.props.disabled).toBe(false)
        click(remove)
        expect(entries()).toEqual([{ name: '', alias: '' }])
    })

    test('invalid model parameters are expanded and retain their inline validation message', () => {
        const html = renderToStaticMarkup(<ModelInputList entries={[
            {
                name: 'invalid-model', alias: '', maxContextLengthDraft: 'not-an-integer',
            },
        ]} onChange={noop} provider='openai' metadataEditing />)
        expect(html).toMatch(/<details\b[^>]*open=""/)
        expect(html).toContain(i18n.t('ai_providers.model_context_invalid'))
        expect(html).toContain('role="alert"')
    })
})
