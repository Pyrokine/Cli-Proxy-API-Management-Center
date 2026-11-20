import {apiClient} from '@/services/api/client'
import {configFileApi} from '@/services/api/configFile'
import {getCooldownRemainingSeconds} from '@/utils/time/durations'
import {expect, spyOn, test} from 'bun:test'
import {readFileSync} from 'node:fs'
import React, {type ReactElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import ts from 'typescript'
import {sourceCallback, sourceExpression, sourceInitializer} from './sourceCallbacks'

const noop = () => {
}

test('visible model selection preserves hidden choices through both real discovery state owners', () => {
    for (const file of ['hooks/useModelDiscovery.ts', 'pages/ProviderModelsPage.tsx']) {
        let selected = new Set(['Hidden', 'Visible-A'])
        const toggle = sourceInitializer<(name: string) => void>(
            file,
            'toggleSelection',
            {
                setSelected: (update: (previous: Set<string>) => Set<string>) => {
                    selected = update(selected)
                },
            },
        )
        const apply  = (checked: boolean, disabled = false, fetching = false) => {
            sourceInitializer<(checked: boolean) => void>('pages/ModelDiscoveryModal.tsx', 'selectMatching', {
                selected,
                filteredModels: [{ name: 'Visible-A' }, { name: 'Visible-B' }, { name: 'Visible-Configured' }],
                missingModelNames: new Set(['Hidden', 'Visible-A', 'Visible-B']),
                onToggleSelection: toggle,
                disabled,
                fetching,
            })(checked)
        }
        apply(true)
        expect([...selected]).toEqual(['Hidden', 'Visible-A', 'Visible-B'])
        apply(false)
        expect([...selected]).toEqual(['Hidden'])
        apply(true, true)
        expect([...selected]).toEqual(['Hidden'])
        apply(true, false, true)
        expect([...selected]).toEqual(['Hidden'])
    }
})

test('model selection toolbar is connected to matching-only actions and disabled state', () => {
    const clicked: boolean[] = []
    for (const checked of [true, false]) {
        const button = sourceExpression<ReactElement<{ onClick: () => void; disabled: boolean }>>(
            'pages/ModelDiscoveryModal.tsx',
            (node, tree) => ts.isJsxElement(node) &&
                            node.openingElement.tagName.getText(tree) ===
                            'Button' &&
                            node.openingElement.attributes.properties.some((attribute) => ts.isJsxAttribute(
                                                                                              attribute) &&
                            attribute.name.getText(tree) ===
                            'onClick' &&
                            attribute.initializer?.getText(tree) ===
                            `{() => selectMatching(${checked})}`),
            {
                React, Button: () => null, selectMatching: (value: boolean) => clicked.push(value),
                disabled: false, fetching: false, filteredModels: [{ name: 'Visible' }], selectableCount: 1,
                t: (key: string) => key,
            },
        )
        expect(button.props.disabled).toBe(false)
        button.props.onClick()
    }
    expect(clicked).toEqual([true, false])
})

test('a locally elapsed cooldown remains visible until an authoritative empty snapshot arrives', () => {
    let now        = 1_000_000
    const snapshot = {
        receivedAtMs: now,
        observedAt: '2026-11-05T10:00:00Z',
        records: [
            {
                scope: 'model',
                modelKey: 'Model-A',
                reason: 'rate_limit',
                retryAt: '2026-11-05T10:00:01Z',
                remainingSeconds: 1,
            },
        ],
    }
    const t        = (key: string, options?: { seconds?: number }) => key === 'credentials.cooldown_remaining' ?
                                                                      `remaining:${options?.seconds}` :
                                                                      key
    const scope    = {
        React,
        useTranslation: () => ({ t, i18n: { language: 'en' } }),
        styles: {},
        // noinspection JSUnusedGlobalSymbols
        'getCooldownRemainingSeconds': getCooldownRemainingSeconds,
        SECOND_CLOCK: {
            subscribe: noop,
            // noinspection JSUnusedGlobalSymbols
            'getSnapshot': () => now,
        },
        useSyncExternalStore: (_subscribe: unknown, get: () => number) => get(),
        // noinspection JSUnusedGlobalSymbols
        'cooldownReasonLabel': (reason: string) => reason,
        formatDateTime: (value: string) => value,
        Button: () => null,
    }
    const Active   = sourceCallback<React.ComponentType<{ snapshot: typeof snapshot; controlLabel: string }>>(
        'components/credentials/CredentialCard.tsx',
        'ActiveCredentialCooldowns',
        scope,
    )
    const Parent   = sourceCallback<React.ComponentType<{ snapshot: typeof snapshot; controlLabel: string }>>(
        'components/credentials/CredentialCard.tsx',
        'CredentialCooldowns',
        { ...scope, ActiveCredentialCooldowns: Active },
    )
    const render   = (value = snapshot) => renderToStaticMarkup(React.createElement(
        Parent,
        {
            snapshot: value,
            controlLabel: 'synthetic',
        },
    ))
    expect(render()).toContain('remaining:1')
    now += 2000
    const elapsed = render()
    expect(elapsed).toContain('credentials.cooldown_waiting_refresh')
    expect(elapsed).toContain('rate_limit')
    expect(elapsed).not.toContain('remaining:0')
    expect(snapshot.records).toHaveLength(1)
    const refreshed = render({ ...snapshot, records: [] })
    expect(refreshed).toContain('credentials.cooldowns_empty')
    expect(refreshed).not.toContain('credentials.cooldown_waiting_refresh')
})

test('structured in-flight field errors survive the real API consumer and disable DiffModal confirmation', async () => {
    const errors = [
        { field: 'credential-in-flight.max-part-bytes', message: 'must be at least 1024' },
        { field: 'credential-in-flight.max-part-count', message: 'must not exceed 64' },
    ]
    const post   = spyOn(apiClient, 'post').mockResolvedValue({ valid: false, errors })
    try {
        const result = await configFileApi.validateConfigYaml('credential-in-flight:\n  max-part-bytes: 512\n')
        expect(result.errors).toEqual(errors)
        const nodes = sourceExpression<ReactElement[]>(
            'components/config/DiffModal.tsx',
            (node, tree) => ts.isCallExpression(node) &&
                            node.expression.getText(tree) ===
                            'errors.map',
            { React, errors: result.errors },
        )
        const html  = renderToStaticMarkup(React.createElement(React.Fragment, {}, nodes))
        for (const error of errors) {
            expect(html).toContain(`${error.field}: ${error.message}`)
        }
        const hasErrors = sourceInitializer<boolean>(
            'components/config/DiffModal.tsx',
            'hasErrors',
            { errors: result.errors },
        )
        const confirm   = sourceExpression<ReactElement<{ disabled: boolean }>>(
            'components/config/DiffModal.tsx',
            (node, tree) => ts.isJsxElement(node) &&
                            node.openingElement.tagName.getText(tree) ===
                            'Button' &&
                            node.openingElement.attributes.properties.some((attribute) => ts.isJsxAttribute(
                                                                                              attribute) &&
                            attribute.name.getText(tree) ===
                            'onClick' &&
                            attribute.initializer?.getText(tree) ===
                            '{onConfirm}'),
            { React, Button: () => null, loading: false, hasErrors, onConfirm: noop, t: (key: string) => key },
        )
        expect(confirm.props.disabled).toBe(true)
    } finally {
        post.mockRestore()
    }
})

test('provider health remains in inspection content without publishing global quota notifications', () => {
    const file                = 'components/credentials/AccountInspectionPanel.tsx'
    const source              = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')
    const tree                = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const producers: string[] = []
    const visit               = (node: ts.Node) => {
        if (ts.isCallExpression(node) && node.expression.getText(tree).includes('addPersistentNotification')) {
            producers.push(node.getText(tree))
        }
        ts.forEachChild(node, visit)
    }
    visit(tree)
    expect(producers).toEqual([])
    const rows     = [{ provider: 'synthetic', quotaError: 1, quotaBanned: 0, quotaExceeded: 0 }]
    const consumed = sourceExpression<typeof rows>(file, (node) => {
        if (!ts.isIdentifier(node) || node.text !== 'providerHealthRows') {
            return false
        }
        for (let parent: ts.Node | undefined = node.parent; parent; parent = parent.parent) {
            if (ts.isJsxExpression(parent)) {
                return true
            }
            if (ts.isArrowFunction(parent) || ts.isFunctionDeclaration(parent)) {
                return false
            }
        }
        return false
    }, { providerHealthRows: rows })
    expect(consumed).toBe(rows)
})
