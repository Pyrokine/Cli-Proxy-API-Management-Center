import {ModelCheckboxList} from '@/pages/ModelCheckboxList'
import {findMissingProviderModelNames, mergeProviderModelEntries} from '@/utils/providerModels'
import {expect, test} from 'bun:test'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import ts from 'typescript'
import {sourceExpression, sourceInitializer} from './sourceCallbacks'

const models  = [
    { name: 'Hidden' }, { name: 'Visible-A' }, { name: 'Visible-B' }, { name: 'Visible-Configured' },
]
const entries = [{ name: 'Visible-Configured', alias: 'Existing', future: 'keep' }]
const content = 'pages/ModelDiscoveryModal.tsx'

for (const owner of ['hooks/useModelDiscovery.ts', 'pages/ProviderModelsPage.tsx']) {
    test(`${owner} publishes only visible missing models for selection and keeps hidden selections`, () => {
        const scope             = {
            useMemo: <T, >(build: () => T) => build(), discoveredModels: models, models, search: 'Visible',
            formState: { modelEntries: entries }, configuredModelEntries: entries,
            // noinspection JSUnusedGlobalSymbols
            'normalizeName': (name: string) => name.trim(),
            // noinspection JSUnusedGlobalSymbols
            'findMissingProviderModelNames': findMissingProviderModelNames,
        }
        const filteredModels    = sourceInitializer<typeof models>(owner, 'filteredModels', scope)
        const missingModelNames = sourceInitializer<Set<string>>(owner, 'missingModelNames', scope)
        expect(filteredModels.map((model) => model.name)).toEqual(['Visible-A', 'Visible-B', 'Visible-Configured'])
        expect([...missingModelNames]).toEqual(['Hidden', 'Visible-A', 'Visible-B'])
        const selectableCount = sourceInitializer<number>(content, 'selectableCount', {
            filteredModels, missingModelNames,
        })
        expect(selectableCount).toBe(2)
        let selected = new Set(['Hidden', 'Visible-A'])
        const toggle = sourceInitializer<(name: string) => void>(owner, 'toggleSelection', {
            setSelected: (update: (previous: Set<string>) => Set<string>) => {
                selected = update(selected)
            },
        })
        for (const checked of [true, false]) {
            sourceInitializer<(checked: boolean) => void>(content, 'selectMatching', {
                filteredModels, missingModelNames, selected, onToggleSelection: toggle,
                disabled: false, fetching: false,
            })(checked)
            expect([...selected]).toEqual(checked ? ['Hidden', 'Visible-A', 'Visible-B'] : ['Hidden'])
        }
        expect(entries).toEqual([{ name: 'Visible-Configured', alias: 'Existing', future: 'keep' }])
        const merged: unknown[] = []
        let closed              = 0
        sourceInitializer<() => void>(owner, owner.startsWith('hooks/') ? 'applySelected' : 'handleApply', {
            sourceLoaded: true, authGeneration: 1, apiClient: { getAuthGeneration: () => 1 },
            discoveredModels: models, models, selected,
            mergeDiscoveredModels: (picked: typeof models) => merged.push(mergeProviderModelEntries(entries, picked)),
            setOpen: () => {
                ++closed
            }, handleBack: () => {
                ++closed
            },
        })()
        expect(merged).toEqual([{ addedCount: 1, entries: [...entries, { name: 'Hidden', alias: '' }] }])
        expect(closed).toBe(1)
    })
}

test('discovery rows keep configured models visible while disabling both selection targets', () => {
    const html       = renderToStaticMarkup(<ModelCheckboxList models={models} selected={new Set()}
                                                               missingModelNames={new Set([
                                                                                              'Hidden',
                                                                                              'Visible-A',
                                                                                              'Visible-B',
                                                                                          ])} onToggle={() => {
    }} />)
    const configured = html.match(/<input[^>]*aria-label="Visible-Configured"[^>]*>/)?.[0]
    const missing    = html.match(/<input[^>]*aria-label="Visible-A"[^>]*>/)?.[0]
    expect(configured).toContain('disabled=""')
    expect(missing).toBeDefined()
    expect(missing).not.toContain('disabled=""')
    const metadata = sourceExpression<React.ReactElement<{ disabled: boolean }>>(
        'pages/ModelCheckboxList.tsx',
        (
            node,
            tree,
        ) => ts.isJsxElement(node) &&
             node.openingElement.tagName.getText(tree) ===
             'button', {
            React,
            model: models[3],
            missingModelNames: new Set(['Visible-A']),
            disabled: false,
            onToggle: () => {
            },
            styles: {},
        },
    )
    expect(metadata.props.disabled).toBe(true)
})

for (const checked of [true, false]) {
    test(`visible selection ${checked} is disabled when the search has no missing models`, () => {
        const button = sourceExpression<React.ReactElement<{ disabled: boolean }>>(
            content,
            (
                node,
                tree,
            ) => ts.isJsxElement(node) &&
                 node.openingElement.tagName.getText(tree) ===
                 'Button' &&
                 node.openingElement.attributes.properties.some((attribute) => ts.isJsxAttribute(attribute) &&
                 attribute.name.getText(tree) ===
                 'onClick' &&
                 attribute.initializer?.getText(tree) ===
                 `{() => selectMatching(${checked})}`),
            {
                React,
                Button: () => null,
                filteredModels: [models[3]],
                selectableCount: 0,
                disabled: false,
                fetching: false,
                selectMatching: () => {
                },
                t: (key: string) => key,
            },
        )
        expect(button.props.disabled).toBe(true)
    })
}
