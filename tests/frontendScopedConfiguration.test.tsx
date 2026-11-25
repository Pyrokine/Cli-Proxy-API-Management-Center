import {findConfigFieldById, searchConfigFields} from '@/components/config/configSearchIndex'
import {VisualConfigEditor} from '@/components/config/VisualConfigEditor'
import {getVisualConfigValidationErrors} from '@/hooks/useVisualConfig'
import {
    decodeVisualConfigYaml,
    encodeVisualConfigYaml,
    parseVisualConfigInteger,
    VISUAL_INTEGER_FIELDS,
} from '@/hooks/visualConfigCodec'
import {DEFAULT_VISUAL_VALUES} from '@/types/visualConfig'
import {expect, test} from 'bun:test'
import {readFileSync} from 'node:fs'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {parse} from 'yaml'
import {sourceCallback, sourceExpression} from './sourceCallbacks'
import {expectSourceToContain} from './sourceContractAssertions'

function renderScope(scope?: 'oauth' | 'model-aliases') {
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
    Object.defineProperty(
        globalThis,
        'localStorage',
        {
            configurable: true, value: {
                getItem: () => 'full', setItem: () => {
                },
            },
        },
    )
    try {
        return renderToStaticMarkup(<VisualConfigEditor scope={scope} values={DEFAULT_VISUAL_VALUES} onChange={() => {
        }} />)
    } finally {
        if (previous) {
            Object.defineProperty(globalThis, 'localStorage', previous)
        } else {
            Reflect.deleteProperty(globalThis, 'localStorage')
        }
    }
}

test('OAuth settings and model aliases render only on their owning pages with their original field anchors', () => {
    const general = renderScope()
    const oauth   = renderScope('oauth')
    const aliases = renderScope('model-aliases')
    for (const field of ['oauthSettings', 'oauthRequestScopedErrors', 'oauthExcludedModels']) {
        expect(general).not.toContain(`id="cfg-field-${field}"`)
        expect(oauth).toContain(`id="cfg-field-${field}"`)
        expect(aliases).not.toContain(`id="cfg-field-${field}"`)
    }
    expect(general).not.toContain('id="cfg-field-oauthModelAlias"')
    expect(oauth).not.toContain('id="cfg-field-oauthModelAlias"')
    expect(aliases).toContain('id="cfg-field-oauthModelAlias"')
})

test('field search dispatches across owners without attempting to focus a removed local control', () => {
    const destinations: unknown[] = []
    let localJumps                = 0
    const jump                    = sourceCallback<(entry: unknown) => void>(
        'components/config/VisualConfigEditor.tsx',
        'handleResultJump',
        {
            setSearchOpen: () => {
            },
            ownerPath: '/config',
            onNavigateField: (entry: unknown) => destinations.push(entry),
            handleModeChange: () => {
                localJumps += 1
            },
            setActiveSectionId: () => {
            },
            setJumpRequest: () => {
            },
        },
    )
    for (const [id, path] of
        [
            ['oauthSettings', '/credentials/oauth-config'],
            ['oauthRequestScopedErrors', '/credentials/oauth-config'],
            ['oauthExcludedModels', '/credentials/oauth-config'],
            ['oauthModelAlias', '/models/oauth-aliases'],
        ]) {
        const entry = findConfigFieldById(id)!
        expect(entry.path).toBe(path)
        expect(searchConfigFields((entry.yamlKeys ?? []).join('-'), (key) => key)).toContain(entry)
        jump(entry)
    }
    expect(destinations).toHaveLength(4)
    expect(localJumps).toBe(0)
})

test(
    'actual routes, page buttons and ConfigPage connect the migrated controls to the existing conditional save',
    () => {
        const routes = readFileSync(new URL('../src/router/MainRoutes.tsx', import.meta.url), 'utf8')
        expect(routes).toContain(
            'path: \'/credentials/oauth-config\', element: <ConfigPage key=\'oauth-config\' scope=\'oauth\'')
        expect(routes).toContain(
            'path: \'/models/oauth-aliases\', element: <ConfigPage key=\'oauth-aliases\' scope=\'model-aliases\'')
        const credentials = readFileSync(new URL('../src/pages/CredentialsPage.tsx', import.meta.url), 'utf8')
        const models      = readFileSync(new URL('../src/pages/ModelManagementPage.tsx', import.meta.url), 'utf8')
        expect(credentials).toContain('navigate(\'/credentials/oauth-config\')')
        expect(models).toContain('navigate(\'/models/oauth-aliases\')')
        const navigations: unknown[] = []
        const changes: unknown[]     = []
        const editor                 = sourceExpression<React.ReactElement<{
            scope: string;
            onChange: (value: unknown) => void;
            onNavigateField: (entry: unknown) => void
        }>>(
            'pages/ConfigPage.tsx',
            (node, tree) => node.getText(tree).startsWith('<VisualConfigEditor'), {
                React,
                VisualConfigEditor,
                scope: 'oauth',
                pluginsAvailable: false,
                visualValues: DEFAULT_VISUAL_VALUES,
                baselineValues: DEFAULT_VISUAL_VALUES,
                visualValidationErrors: {},
                visualHasPayloadValidationErrors: false,
                disableControls: false,
                loading: false,
                saving: false,
                saveNeedsReload: false,
                runtimeInfo: {},
                fieldJumpRequest: undefined,
                handleVisualChange: (value: unknown) => changes.push(value),
                handleFieldNavigation: sourceCallback('pages/ConfigPage.tsx', 'handleFieldNavigation', {
                    scope: 'oauth', navigate: (value: unknown) => navigations.push(value),
                }),
            },
        )
        expect(editor.props.scope).toBe('oauth')
        editor.props.onChange({ oauthSettingsText: 'codex: []' })
        editor.props.onNavigateField(findConfigFieldById('oauthModelAlias'))
        expect(changes).toEqual([{ oauthSettingsText: 'codex: []' }])
        expect(navigations).toEqual([{ pathname: '/models/oauth-aliases', search: '?field=oauthModelAlias' }])
    },
)

test('migrated OAuth controls preserve complete source YAML, defaults and unrelated configuration', () => {
    const yaml    = (
        'port: 8317\nquota-refresh: {enabled: false, interval: 123, max-' +
        'interval: 456}\noauth-settings: {codex: [{name: original, alias:' +
        ' friendly, future: {keep: true}}]}\noauth-model-alias: {codex: [' +
        '{name: original, alias: public, fork: false}]}\n'
    )
    const decoded = decodeVisualConfigYaml(yaml)
    const saved   = encodeVisualConfigYaml(
        yaml,
        {
            ...decoded.values,
            oauthSettingsText: 'codex: [{name: original, alias: changed, future: {keep: true}}]',
        },
        decoded.values,
        decoded.apiKeysStorage,
        yaml,
    )
    const parsed  = parse(saved)
    expect(parsed['oauth-settings'].codex[0]).toEqual({ name: 'original', alias: 'changed', future: { keep: true } })
    expect(parsed['oauth-model-alias']).toEqual(parse(yaml)['oauth-model-alias'])
    expect(parsed['quota-refresh']).toEqual({ enabled: false, interval: 123, 'max-interval': 456 })
    expect(parsed.port).toBe(8317)
})

for (const field of ['logsMaxTotalSizeMb', 'usageRetentionMaxDbSizeMb', 'imageArtifactCacheMaxTotalSizeMb'] as const) {
    test(`${field} accepts the full signed-byte MB limit and rejects overflow before serialization`, () => {
        const maximum = 8796093022207
        const values  = { ...DEFAULT_VISUAL_VALUES, [field]: String(maximum) }
        expect(getVisualConfigValidationErrors(values)[field]).toBeUndefined()
        const yaml    = 'port: 8317\n'
        const decoded = decodeVisualConfigYaml(yaml)
        expect(() => encodeVisualConfigYaml(
            yaml,
            { ...decoded.values, [field]: String(maximum) },
            decoded.values,
            decoded.apiKeysStorage,
            yaml,
        )).not.toThrow()
        expect(getVisualConfigValidationErrors({ ...values, [field]: String(maximum + 1) })[field]).toBeDefined()
        expect(() => encodeVisualConfigYaml(
            yaml,
            { ...decoded.values, [field]: String(maximum + 1) },
            decoded.values,
            decoded.apiKeysStorage,
            yaml,
        )).toThrow()
    })
}

test('image day limits and legitimate zero/negative semantics remain explicit', () => {
    expect(getVisualConfigValidationErrors({
                                               ...DEFAULT_VISUAL_VALUES,
                                               imageArtifactCacheRetentionDays: '106751',
                                           }).imageArtifactCacheRetentionDays).toBeUndefined()
    expect(getVisualConfigValidationErrors({
                                               ...DEFAULT_VISUAL_VALUES,
                                               imageArtifactCacheRetentionDays: '106752',
                                           }).imageArtifactCacheRetentionDays).toBeDefined()
    expect(getVisualConfigValidationErrors({ ...DEFAULT_VISUAL_VALUES, logsMaxTotalSizeMb: '-1' }).logsMaxTotalSizeMb)
        .toBeUndefined()
    expect(getVisualConfigValidationErrors({
                                               ...DEFAULT_VISUAL_VALUES,
                                               usageRetentionMaxDbSizeMb: '-1',
                                           }).usageRetentionMaxDbSizeMb).toBeDefined()
    expect(getVisualConfigValidationErrors({
                                               ...DEFAULT_VISUAL_VALUES,
                                               imageArtifactCacheMaxTotalSizeMb: '0',
                                           }).imageArtifactCacheMaxTotalSizeMb).toBeUndefined()
})

test(
    'actual retention payload enforces the dedicated endpoint’s threshold and capacity ranges',
    () => {
        const toPayload = sourceCallback<(draft: {
            daysEnabled: boolean;
            days: string;
            maxDbSizeMb: string;
            warningThresholdPct: string
        }) => unknown>(
            'components/usage/UsageRetentionCard.tsx',
            'toPayload',
            {
                // noinspection JSUnusedGlobalSymbols
                'parseVisualConfigInteger': parseVisualConfigInteger, VISUAL_INTEGER_FIELDS,
            },
        )
        const draft     = { daysEnabled: true, days: '30', maxDbSizeMb: '8796093022207', warningThresholdPct: '0' }
        expect(toPayload(draft)).toEqual({ days: 30, max_db_size_mb: 8796093022207, warning_threshold_pct: 0 })
        for (const value of ['', '8796093022208', '-1', '1.5', '1e3']) {
            expect(toPayload({ ...draft, maxDbSizeMb: value })).toBeNull()
        }
        const html = readFileSync(new URL('../src/components/usage/UsageRetentionCard.tsx', import.meta.url), 'utf8')
        expectSourceToContain(html, 'retention && !validPayload && <div className=\'error-box\' role=\'alert\'')
        expect(html).toContain('disabled={!validPayload || !hasChanged(draft, retention) || trimming}')
    },
)
