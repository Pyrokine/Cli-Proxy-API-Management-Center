import {expect, test} from 'bun:test'
import React, {type ReactElement} from 'react'
import ts from 'typescript'
import {sourceCallback, sourceExpression, sourceInitializer} from './sourceCallbacks'

const file = 'components/credentials/VendorSection.tsx'
const noop = () => {
}

function mountModels(storage: Map<string, string>, id: string) {
    let state: unknown
    let ref: { current: unknown } | undefined
    const hook = sourceCallback<(key: string, initial: unknown) => [unknown, (value: unknown) => void]>(
        'hooks/useLocalStorage.ts', 'useLocalStorage', {
            useState: (initial: () => unknown) => [
                state ??= initial(), (value: unknown) => {
                    state = value
                },
            ],
            useRef: (initial: unknown) => ref ??= { current: initial }, useCallback: <T, >(callback: T) => callback,
            window: {
                localStorage: {
                    getItem: (key: string) => storage.get(key) ?? null,
                    setItem: (key: string, value: string) => {
                        storage.set(key, value)
                    },
                },
            },
        })
    return sourceInitializer<[unknown, (value: unknown) => void]>(file, 'setSelectedModels', {
        vendor: { id }, useLocalStorage: hook, useState: (initial: unknown) => [initial, noop],
    })
}

test(
    'resource model choices persist through the actual picker and storage hook without changing another vendor',
    () => {
        const storage               = new Map([['cpa-credentials-claude-resource-models', '["Other"]']])
        const [, setSelectedModels] = mountModels(storage, 'openai')
        const picker                = sourceExpression<ReactElement<{ onChange: (values: string[]) => void }>>(
            file,
            (
                node,
                tree,
            ) => ts.isJsxSelfClosingElement(node) &&
                 node.tagName.getText(tree) ===
                 'MultiSelect' &&
                 node.attributes.properties.some((attribute) => ts.isJsxAttribute(attribute) &&
                 attribute.name.getText(tree) ===
                 'values' &&
                 attribute.initializer?.getText(tree) ===
                 '{selectedModels}'),
            {
                React,
                MultiSelect: () => null,
                modelFilterOptions: [
                    {
                        value: 'Model-A',
                        label: 'Model-A',
                    },
                ],
                selectedModels: [],
                setSelectedModels,
                disableControls: false,
                t: (key: string) => key,
            },
        )
        picker.props.onChange(['Model-A'])
        expect(storage.get('cpa-credentials-openai-resource-models')).toBe('["Model-A"]')
        expect(mountModels(storage, 'openai')[0]).toEqual(['Model-A'])
        expect(mountModels(storage, 'claude')[0]).toEqual(['Other'])
        const clear = sourceInitializer<(event: { stopPropagation: () => void }) => void>(
            'components/ui/MultiSelect.tsx', 'handleClear', { onChange: picker.props.onChange })
        clear({ stopPropagation: noop })
        expect(mountModels(storage, 'openai')[0]).toEqual([])
        expect(mountModels(storage, 'claude')[0]).toEqual(['Other'])
    },
)

test('resource model preferences keep exact identities and visibly reject a non-array stored value', () => {
    const warnings: unknown[][] = []
    const read                  = (storedModels: unknown) => sourceInitializer<string[]>(file, 'selectedModels', {
        storedModels, useMemo: <T, >(build: () => T) => build(),
        console: { warn: (...args: unknown[]) => warnings.push(args) },
    })
    expect(read([' Model-A ', 'Model-A', 'model-a', 42, null, ''])).toEqual(['Model-A', 'model-a'])
    expect(read({ models: ['Model-A'] })).toEqual([])
    expect(warnings).toHaveLength(1)
})

test('expanded resource filters remain available when the current model or search filter matches no cards', () => {
    const visible = sourceExpression<boolean>(file, (node, tree) => {
        if (!ts.isBinaryExpression(node) || !ts.isBinaryExpression(node.parent) || node.parent.left !== node) {
            return false
        }
        const right   = node.parent.right
        const element = ts.isParenthesizedExpression(right) ? right.expression : right
        return ts.isJsxElement(element) && element.openingElement.attributes.properties.some((attribute) =>
               ts.isJsxAttribute(attribute) && attribute.name.getText(tree) === 'className' &&
               attribute.initializer?.getText(tree) === '{styles.body}')
    }, { expanded: true, filteredTotal: 0, showResourceControls: true })
    expect(visible).toBe(true)
})

test(
    'the actual model picker is guarded independently from the matching card list',
    () => {
        const visible =
                  sourceExpression<
                      boolean>(
                      file,
                      (node, tree) => {
                          if (!ts.isIdentifier(node) ||
                              node.text !==
                              'showResourceControls' ||
                              !ts.isBinaryExpression(node.parent) ||
                              node.parent.left !==
                              node) {
                              return false
                          }
                          const right   = node.parent.right
                          const element = ts.isParenthesizedExpression(right) ? right.expression : right
                          if (!ts.isJsxElement(element) ||
                              !element.openingElement.attributes.properties.some(
                                  (attribute) =>
                                      ts.isJsxAttribute(
                                          attribute) &&
                                      attribute.name.getText(
                                          tree) ===
                                      'className' &&
                                      attribute.initializer?.getText(
                                          tree) ===
                                      '{styles.resourceToolbar}')) {
                              return false
                          }
                          for (let parent: ts.Node | undefined = node.parent; parent; parent = parent.parent) {
                              if (ts.isBinaryExpression(parent) &&
                                  parent.left.getText(tree).includes('filteredApiKeys.length')) {
                                  return false
                              }
                          }
                          return true
                      },
                      { showResourceControls: true },
                  )
        expect(visible).toBe(true)
    },
)

for (const [apiKeyCount, selectedModels, typeFilter, expected] of [
    [2, [], 'all', true], [0, ['Stale'], 'api-key', true], [2, [], 'auth-file', false], [0, [], 'all', false],
] as const) {
    test(`resource filter visibility respects ${apiKeyCount} keys, ${typeFilter} and saved choices`, () => {
        expect(sourceInitializer<boolean>(file, 'showResourceControls', {
            apiKeyCount, selectedModels, typeFilter, resourceQuery: '',
        })).toBe(expected)
    })
}
