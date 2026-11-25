import {getVisualConfigSectionId, searchConfigFields} from '@/components/config/configSearchIndex'
import {getVisualConfigValidationErrors} from '@/hooks/useVisualConfig'
import {decodeVisualConfigYaml, encodeVisualConfigYaml, patchKnownYamlFields} from '@/hooks/visualConfigCodec'
import {apiClient} from '@/services/api/client'
import {configFileApi} from '@/services/api/configFile'
import type {RequestScopedErrorRule} from '@/types'
import {DEFAULT_VISUAL_VALUES} from '@/types/visualConfig'
import {readRequestScopedErrorRule, updateRequestScopedErrorRule} from '@/utils/credentialOverrides'
import {getOAuthModelAliasError} from '@/utils/oauthModelAlias'
import {expect, spyOn, test} from 'bun:test'
import {readFileSync} from 'node:fs'
import React, {type ReactElement, type ReactNode} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {Trans} from 'react-i18next'
import ts from 'typescript'
import {isMap, isSeq, parse, parseDocument, visit} from 'yaml'
import i18n from '../src/i18n'
import {sourceCallback, sourceExpression} from './sourceCallbacks'

const t          = (key: string) => key
const noop       = () => {
}
const Input      = () => null
const Button     = () => null
const ErrorRules = () => null
const Modal      = () => null
const fixture    = `client:
  codex:
    enable-apply-patch: false
    future-client: keep
oauth-settings:
  codex:
    - name: Original
      alias: Public
      max-context-length: 0
      future-setting: keep
oauth-request-scoped-errors:
  codex:
    - status: 429
      match: [rate]
      match-regexr: ['(?i)limit']
      action: continue
      future-rule: keep
unrelated: keep
`

interface EditorProps {
    kind: 'settings' | 'errors' | 'aliases';
    value: string;
    disabled: boolean;
    onChange: (value: string) => void
}

function editor(props: EditorProps, channel = '', scope: Record<string, unknown> = {}) {
    const render = sourceCallback<(props: EditorProps) => ReactElement>(
        'components/config/OAuthConfigFields.tsx',
        'OAuthConfigFields',
        {
            React,
            useTranslation: () => ({ t }),
            useState: (initial: unknown) => [
                initial ===
                null ? null : channel, noop,
            ],
            useMemo: (build: () => unknown) => build(),
            useRef: (value: unknown) => ({ current: value }),
            useEffect: (effect: () => unknown) => effect(),
            useId: () => 'fixture-alias',
            useNotificationStore: () => ({
                showConfirmation: noop,
                showNotification: noop,
            }),
            parseDocument,
            visit,
            isMap, isSeq, patchKnownYamlFields,
            Input,
            Button,
            Modal,
            Trans,
            RequestScopedErrorsField: ErrorRules,
            readRequestScopedErrorRule,
            // noinspection JSUnusedGlobalSymbols
            'getOAuthModelAliasError': getOAuthModelAliasError, ...scope,
        },
    )
    return render(props)
}

function find(
    root: ReactNode,
    matches: (node: ReactElement<Record<string, unknown>>) => boolean,
): ReactElement<Record<string, unknown>> {
    let result: ReactElement<Record<string, unknown>> | undefined
    const visit = (node: ReactNode) => {
        React.Children.forEach(node, (child) => {
            if (!React.isValidElement<Record<string, unknown>>(child)) {
                return
            }
            if (!result && matches(child)) {
                result = child
            }
            if (!result) {
                visit(child.props.children as ReactNode)
            }
        })
    }
    visit(root)
    if (!result) {
        throw new Error('Missing rendered field')
    }
    return result
}

test('new configuration groups decode all eight fields and retain empty defaults without writing them', () => {
    const empty = decodeVisualConfigYaml('port: 8317\n')
    expect(empty.values.clientCodexEnableApplyPatch).toBe(false)
    expect(parse(empty.values.oauthSettingsText)).toEqual({})
    expect(parse(empty.values.oauthRequestScopedErrorsText)).toEqual({})
    expect(encodeVisualConfigYaml('port: 8317\n', empty.values, empty.values, empty.apiKeysStorage, 'port: 8317\n'))
        .toBe('port: 8317\n')
    const decoded = decodeVisualConfigYaml(fixture)
    expect(decoded.values.clientCodexEnableApplyPatch).toBe(false)
    expect(parse(decoded.values.oauthSettingsText).codex[0]).toMatchObject({
                                                                               name: 'Original',
                                                                               alias: 'Public',
                                                                               'max-context-length': 0,
                                                                           })
    expect(parse(decoded.values.oauthRequestScopedErrorsText).codex[0]).toMatchObject({
                                                                                          status: 429,
                                                                                          match: ['rate'],
                                                                                          'match-regexr': ['(?i)limit'],
                                                                                          action: 'continue',
                                                                                      })
})

test('actual model metadata controls save name, alias and context without overwriting unknown data', () => {
    const decoded = decodeVisualConfigYaml(fixture)
    let value     = decoded.values.oauthSettingsText
    for (const [field, next] of
        [
            ['oauth_settings_name', 'Updated'],
            ['oauth_settings_alias', 'UpdatedPublic'],
            ['oauth_settings_context', '524288'],
        ]) {
        const tree  = editor({
                                 kind: 'settings', value, disabled: false, onChange: (text) => {
                value = text
            },
                             })
        const input = find(
                  tree,
                  (node) => node.type ===
                            Input &&
                            node.props.label ===
                            `config_management.visual.sections.advanced.${field}`,
              )
        ;(input.props.onChange as (event: unknown) => void)({ target: { value: next, validity: { badInput: false } } })
    }
    const next = { ...decoded.values, oauthSettingsText: value }
    expect(getVisualConfigValidationErrors(next, decoded.values).oauthSettingsText).toBeUndefined()
    const saved = parse(encodeVisualConfigYaml(fixture, next, decoded.values, decoded.apiKeysStorage, fixture))
    expect(saved['oauth-settings'].codex[0]).toEqual({
                                                         name: 'Updated',
                                                         alias: 'UpdatedPublic',
                                                         'max-context-length': 524288,
                                                         'future-setting': 'keep',
                                                     })
    expect(saved.client).toEqual(parse(fixture).client)
    expect(saved['oauth-request-scoped-errors']).toEqual(parse(fixture)['oauth-request-scoped-errors'])
    expect(saved.unrelated).toBe('keep')
})

test('the shared error-rule control saves all four fields with canonical YAML names and unknown metadata', () => {
    const decoded = decodeVisualConfigYaml(fixture)
    let value     = decoded.values.oauthRequestScopedErrorsText
    const tree    = editor({
                               kind: 'errors', value, disabled: false, onChange: (text) => {
            value = text
        },
                           })
    const rules   = find(tree, (node) => node.type === ErrorRules)
    const current = rules.props.rules as RequestScopedErrorRule[]
    const changed = updateRequestScopedErrorRule(
              current[0],
              {
                  status: 503,
                  match: ['Synthetic unavailable'],
                  matchRegex: ['(?P<code>retry)'],
                  action: 'stop-and-cooldown',
              },
          )
    ;(rules.props.onChange as (value: RequestScopedErrorRule[]) => void)([changed])
    const next = { ...decoded.values, oauthRequestScopedErrorsText: value }
    expect(getVisualConfigValidationErrors(next, decoded.values).oauthRequestScopedErrorsText).toBeUndefined()
    const saved = parse(encodeVisualConfigYaml(fixture, next, decoded.values, decoded.apiKeysStorage, fixture))
    expect(saved['oauth-request-scoped-errors'].codex[0]).toEqual({
                                                                      status: 503,
                                                                      match: ['Synthetic unavailable'],
                                                                      'match-regexr': ['(?P<code>retry)'],
                                                                      action: 'stop-and-cooldown',
                                                                      'future-rule': 'keep',
                                                                  })
    expect(saved['oauth-settings']).toEqual(parse(fixture)['oauth-settings'])
    expect(saved['oauth-request-scoped-errors'].codex[0]).not.toHaveProperty('matchRegex')
})

test('apply_patch is connected from its actual toggle through codec to the client-only subtree', () => {
    const decoded = decodeVisualConfigYaml(fixture)
    let next      = decoded.values
    const toggle  = sourceExpression<ReactElement<{ onChange: (value: boolean) => void }>>(
        'components/config/VisualConfigEditor.tsx',
        (node, tree) => ts.isJsxSelfClosingElement(node) &&
                        node.tagName.getText(tree) ===
                        'ToggleRow' &&
                        node.attributes.properties.some((attribute) => ts.isJsxAttribute(attribute) &&
                        attribute.name.getText(tree) ===
                        'checked' &&
                        attribute.initializer?.getText(tree) ===
                        '{values.clientCodexEnableApplyPatch}'),
        {
            React,
            ToggleRow: () => null,
            sectionT: t,
            values: next,
            disabled: false,
            onChange: (value: Partial<typeof next>) => {
                next = { ...next, ...value }
            },
        },
    )
    toggle.props.onChange(true)
    expect(next.clientCodexEnableApplyPatch).toBe(true)
    const saved = parse(encodeVisualConfigYaml(fixture, next, decoded.values, decoded.apiKeysStorage, fixture))
    expect(saved.client.codex).toEqual({ 'enable-apply-patch': true, 'future-client': 'keep' })
    expect(saved.codex).toBeUndefined()
})

test('last-rule deletion stays expressible and concurrent edits to either OAuth group are rejected', () => {
    const decoded = decodeVisualConfigYaml(fixture)
    let value     = decoded.values.oauthRequestScopedErrorsText
    const tree    = editor({
                               kind: 'errors', value, disabled: false, onChange: (text) => {
            value = text
        },
                           })
    const rules   = find(tree, (node) => node.type === ErrorRules)
    ;(rules.props.onChange as (value: RequestScopedErrorRule[]) => void)([])
    const saved = parse(encodeVisualConfigYaml(
        fixture,
        { ...decoded.values, oauthRequestScopedErrorsText: value },
        decoded.values,
        decoded.apiKeysStorage,
        fixture,
    ))
    expect(saved['oauth-request-scoped-errors']).toEqual({ codex: [] })
    const server = fixture.replace('max-context-length: 0', 'max-context-length: 1024')
    expect(() => encodeVisualConfigYaml(
        server,
        {
            ...decoded.values,
            oauthSettingsText: 'codex: [{name: local, max-context-length: 8192}]',
        },
        decoded.values,
        decoded.apiKeysStorage,
        fixture,
    )).toThrow('oauth-settings')
    const serverErrors = fixture.replace('action: continue', 'action: stop')
    expect(() => encodeVisualConfigYaml(
        serverErrors,
        { ...decoded.values, oauthRequestScopedErrorsText: value },
        decoded.values,
        decoded.apiKeysStorage,
        fixture,
    )).toThrow('oauth-request-scoped-errors')
})

test('new rule validation respects defaults, rejects invalid edits and retains unchanged runtime values', () => {
    for (const text of ['codex: [{name: ""}]', 'codex: [{name: model, alias: 42}]']) {
        expect(getVisualConfigValidationErrors({ ...DEFAULT_VISUAL_VALUES, oauthSettingsText: text }).oauthSettingsText)
            .toBe('oauth_settings_invalid')
    }
    for (const context of ['1.5', '9007199254740992']) {
        expect(getVisualConfigValidationErrors(
            {
                ...DEFAULT_VISUAL_VALUES,
                oauthSettingsText: `codex: [{name: model, max-context-length: ${context}}]`,
            }).oauthSettingsText).toBe('oauth_settings_integer')
    }
    for (const context of ['0', '-1', '1048576']) {
        expect(getVisualConfigValidationErrors(
            {
                ...DEFAULT_VISUAL_VALUES,
                oauthSettingsText: `codex: [{name: model, max-context-length: ${context}}]`,
            }).oauthSettingsText).toBeUndefined()
    }
    for (const rule of
        [
            '{status: 0, match: [x], action: stop}',
            '{status: 429, match: [" "], action: continue}',
            '{status: 429, match: [x], action: invalid}',
            '{status: 429, match: [42], action: stop}',
        ]) {
        expect(getVisualConfigValidationErrors({
                                                   ...DEFAULT_VISUAL_VALUES,
                                                   oauthRequestScopedErrorsText: `codex: [${rule}]`,
                                               }).oauthRequestScopedErrorsText).toBe('oauth_error_rules_invalid')
    }
    const legacy = {
        ...DEFAULT_VISUAL_VALUES,
        oauthRequestScopedErrorsText: 'codex: [{status: 429, match: [x], action: legacy-runtime-value}]',
    }
    expect(getVisualConfigValidationErrors(
        { ...legacy, clientCodexEnableApplyPatch: true },
        legacy,
    ).oauthRequestScopedErrorsText).toBeUndefined()
})

test('all eight field terms reach registered configuration search targets and the advanced section', () => {
    for (const [query, fieldId] of
        [
            ['enable-apply-patch', 'clientCodexEnableApplyPatch'],
            ['oauth-settings', 'oauthSettings'],
            ['max-context-length', 'oauthSettings'],
            ['oauth-request-scoped-errors', 'oauthRequestScopedErrors'],
            ['match-regexr', 'oauthRequestScopedErrors'],
        ]) {
        expect(searchConfigFields(query, t).some((entry) => entry.fieldId === fieldId)).toBe(true)
    }
    for (const field of ['clientCodexEnableApplyPatch', 'oauthSettingsText', 'oauthRequestScopedErrorsText'] as const) {
        expect(getVisualConfigSectionId(field)).toBe('advanced')
    }
    for (const language of ['en', 'ru', 'zh-CN', 'zh-TW']) {
        const data   = JSON.parse(readFileSync(
            new URL(`../src/i18n/locales/${language}.json`, import.meta.url),
            'utf8',
        ))
        const labels = data.config_management.visual.sections.advanced
        for (const key of
            [
                'client_apply_patch',
                'client_apply_patch_hint',
                'oauth_settings_title',
                'oauth_settings_hint',
                'oauth_settings_name',
                'oauth_settings_alias',
                'oauth_settings_context',
                'oauth_errors_title',
                'oauth_errors_hint',
            ]) {
            expect(labels[key]).toBeTruthy()
        }
    }
})

test(
    'OAuth controls edit alias metadata while preserving unknown fields and sibling providers',
    () => {
        const source  = (
            'oauth-model-alias:\n  codex:\n    - name: Original\n      alias:' +
            ' Public\n      display-name: Current name\n      future: keep\n  claude: [{name: Other, alias: ' +
            'OtherPublic}]\nunrelated: keep\n'
        )
        const decoded = decodeVisualConfigYaml(source)
        let value     = decoded.values.oauthModelAliasText
        for (const [field, next] of [['oauth_alias_name', 'Changed'], ['oauth_alias_alias', 'ChangedPublic']]) {
            const tree  = editor({
                                     kind: 'aliases', value, disabled: false, onChange: (text) => {
                    value = text
                },
                                 })
            const input = find(
                      tree,
                      (node) => node.type ===
                                Input &&
                                node.props.label ===
                                `config_management.visual.sections.advanced.${field}`,
                  )
            ;(input.props.onChange as (event: unknown) => void)({ target: { value: next } })
        }
        let tree          = editor({
                                       kind: 'aliases', value, disabled: false, onChange: (text) => {
                value = text
            },
                                   })
        const displayName = find(tree, (node) => node.type === Input &&
                                                 node.props.label === 'ai_providers.model_display_name_label')
        expect(displayName.props.value).toBe('Current name')
        ;(displayName.props.onChange as (event: unknown) => void)({ target: { value: 'Shown name' } })
        for (const label of ['oauth_model_alias.alias_fork_label', 'ai_providers.model_force_mapping_label']) {
            tree           = editor({
                                        kind: 'aliases', value, disabled: false, onChange: (text) => {
                    value = text
                },
                                    })
            const field    = find(tree, (node) => node.type === 'label' && Array.isArray(node.props.children) &&
                                                  node.props.children.includes(label))
            const checkbox = find(field.props.children as ReactNode, (node) => node.type === 'input')
            expect(checkbox.props.checked).toBe(false)
            ;(checkbox.props.onChange as (event: unknown) => void)({ target: { checked: true } })
        }
        const next = { ...decoded.values, oauthModelAliasText: value }
        expect(getVisualConfigValidationErrors(next, decoded.values).oauthModelAliasText).toBeUndefined()
        const saved = parse(encodeVisualConfigYaml(source, next, decoded.values, decoded.apiKeysStorage, source))
        expect(saved['oauth-model-alias'].codex).toEqual([
                                                             {
                                                                 name: 'Changed',
                                                                 alias: 'ChangedPublic',
                                                                 'display-name': 'Shown name',
                                                                 fork: true,
                                                                 'force-mapping': true,
                                                                 future: 'keep',
                                                             },
                                                         ])
        expect(saved['oauth-model-alias'].claude).toEqual([{ name: 'Other', alias: 'OtherPublic' }])
        expect(saved.unrelated).toBe('keep')
        const removals: Array<{ onConfirm: () => void }> = []
        tree                                             =
            editor({
                       kind: 'aliases', value, disabled: false, onChange: (text) => {
                    value = text
                },
                   }, '', {
                       useNotificationStore: () => ({
                           showConfirmation: (action: { onConfirm: () => void }) => removals.push(action),
                           showNotification: noop,
                       }),
                   })
        const remove                                     = find(
                  tree,
                  (node) => node.type ===
                            Button &&
                            node.props.children ===
                            'common.delete',
              )
        ;(remove.props.onClick as () => void)()
        expect(parse(value).codex).toHaveLength(1)
        removals[0].onConfirm()
        expect(parse(value).codex).toEqual([])
        expect(getVisualConfigValidationErrors(
            { ...decoded.values, oauthModelAliasText: value },
            decoded.values,
        ).oauthModelAliasText).toBeUndefined()
    },
)

test('OAuth control edits retain conflicting aliases in the draft and feed the full-graph save validation', () => {
    let value   = 'codex: [{name: upstream-a, alias: same}, {name: upstream-b, alias: other}]'
    const tree  = editor({
                             kind: 'aliases', value, disabled: false, onChange: (text) => {
            value = text
        },
                         })
    const input = find(
              tree,
              (node) => node.type ===
                        Input &&
                        node.props.label ===
                        'config_management.visual.sections.advanced.oauth_alias_alias',
          )
    ;(input.props.onChange as (event: unknown) => void)({ target: { value: 'OTHER' } })
    expect(parse(value).codex).toEqual([{ name: 'upstream-a', alias: 'OTHER' }, { name: 'upstream-b', alias: 'other' }])
    expect(getVisualConfigValidationErrors({
                                               ...DEFAULT_VISUAL_VALUES,
                                               oauthModelAliasText: value,
                                           }).oauthModelAliasText).toBe('oauth_alias_conflict')
})

// noinspection SpellCheckingInspection
const sharedAliases = `codex:
  - name: First
    alias: Public # retain alias comment
    fork: true
    future: keep
claude:
  - name: Second
    alias: ' pUbLiC '
    fork: false
  - name: Third
    alias: OtherPublic
`

test(
    'shared OAuth alias rename updates all providers once and retains relationship metadata and comments',
    async () => {
        const changes: string[]  = []
        const dialog             = {
            current: null as {
                                 alias: string;
                                 value: string;
                                 error: string;
                                 source: string
                             } | null,
        }
        const focus              = { current: '' }
        const scope              = {
            useState: (initial: unknown) => initial === null
                                            ? [
                    dialog.current, (value: typeof dialog.current) => {
                        dialog.current = value
                    },
                ] : ['', noop],
            useRef: (initial: unknown) => typeof initial === 'string' ? focus : { current: initial },
        }
        const props: EditorProps = {
            kind: 'aliases', value: sharedAliases, disabled: false,
            onChange: (value) => changes.push(value),
        }
        let tree                 = editor(props, '', scope)
        const rename             = find(tree, (node) => node.type ===
                                                        Button &&
                                                        node.props['aria-label'] ===
                                                        'oauth_model_alias.diagram_rename_alias_title: Public')
        ;(rename.props.onClick as () => void)()
        tree        = editor(props, '', scope)
        let modal   = find(tree, (node) => node.type === Modal && node.props.open === true)
        const input = find(modal.props.children as ReactNode, (node) => node.type === Input)
        ;(input.props.onChange as (event: unknown) => void)({ target: { value: 'Renamed' } })
        tree          = editor(props, '', scope)
        modal         = find(tree, (node) => node.type === Modal && node.props.open === true)
        const renamed = find(modal.props.children as ReactNode, (node) => node.type === Input)
        ;(renamed.props.onKeyDown as (event: unknown) => void)({ key: 'Enter' })
        expect(changes).toHaveLength(1)
        expect(parse(changes[0]).codex[0]).toEqual({ name: 'First', alias: 'Renamed', fork: true, future: 'keep' })
        expect(parse(changes[0]).claude).toEqual([
                                                     { name: 'Second', alias: 'Renamed', fork: false },
                                                     { name: 'Third', alias: 'OtherPublic' },
                                                 ])
        expect(changes[0]).toContain('# retain alias comment')
        expect(dialog.current).toBeNull()
        tree             = editor({ ...props, value: changes[0] }, '', scope)
        const nextButton = find(tree, (node) => node.type ===
                                                Button &&
                                                node.props['aria-label'] ===
                                                'oauth_model_alias.diagram_rename_alias_title: Renamed')
        modal            = find(tree, (node) => node.type === Modal)
        expect(modal.props.returnFocusId).toBe(nextButton.props.id)
        const baseline = 'port: 8317\nunrelated: keep\noauth-model-alias:\n' +
                         sharedAliases.trimEnd().split('\n').map((line) => `  ${line}`).join('\n') + '\n'
        const decoded  = decodeVisualConfigYaml(baseline)
        const values   = { ...decoded.values, oauthModelAliasText: changes[0] }
        expect(getVisualConfigValidationErrors(values, decoded.values).oauthModelAliasText).toBeUndefined()
        const content = encodeVisualConfigYaml(baseline, values, decoded.values, decoded.apiKeysStorage, baseline)
        expect(parse(content)).toMatchObject({ port: 8317, unrelated: 'keep', 'oauth-model-alias': parse(changes[0]) })
        const post = spyOn(apiClient, 'post').mockResolvedValue({ valid: true, errors: [], warnings: [] })
        const put  = spyOn(apiClient, 'put').mockResolvedValue({ status: 'ok' })
        try {
            expect((await configFileApi.validateConfigYaml(content, baseline)).valid).toBe(true)
            await configFileApi.saveConfigYaml(content, '"alias-etag"')
            expect(put.mock.calls).toHaveLength(1)
            expect(put.mock.calls[0]).toMatchObject([
                                                        '/config.yaml',
                                                        content,
                                                        { headers: { 'If-Match': '"alias-etag"' } },
                                                    ])
        } finally {
            post.mockRestore();
            put.mockRestore()
        }
    },
)

for (const [value, target, message] of [
    [sharedAliases, ' ', 'oauth_model_alias.diagram_please_enter_alias'],
    [sharedAliases, 'OtherPublic', 'oauth_model_alias.diagram_alias_exists'],
    [sharedAliases, 'First', 'config_management.visual.validation.oauth_alias_self'],
    [
        'codex: [{name: Source, alias: Public}, {name: Renamed, alias: Source}]', 'Renamed',
        'config_management.visual.validation.oauth_alias_cycle',
    ],
]) {
    test(
        `shared OAuth alias rename rejects ${message} without mutating any provider`,
        () => {
            const changes: string[] = []
            const dialog            = {
                current: { alias: 'Public', value: target, error: '', source: value } as
                    { alias: string; value: string; error: string; source: string } | null,
            }
            const tree              = editor({
                                                 kind: 'aliases',
                                                 value,
                                                 disabled: false,
                                                 onChange: (text) => changes.push(text),
                                             }, '', {
                                                 useState: (initial: unknown) => initial === null
                                                                                 ?
                                                     [
                                                         dialog.current, (next: typeof dialog.current) => {
                                                         dialog.current = next
                                                     },
                                                     ] :
                                                     ['', noop],
                                             })
            const modal             = find(tree, (node) => node.type === Modal && node.props.open === true)
            const confirm           =
                      find(
                          modal.props.footer as ReactNode,
                          (node) => node.type ===
                                    Button &&
                                    node.props.children ===
                                    'oauth_model_alias.diagram_rename_btn',
                      )
            ;(confirm.props.onClick as () => void)()
            expect(changes).toEqual([])
            expect(dialog.current?.error).toBe(message)
        },
    )
}

test('shared OAuth alias deletion confirms all matching links and preserves unrelated relationships', () => {
    const changes: string[]                                                                               = []
    const confirmations: Array<{ onConfirm: () => void; message: ReactElement<Record<string, unknown>> }> = []
    const tree                                                                                            = editor(
        {
            kind: 'aliases',
            value: sharedAliases,
            disabled: false,
            onChange: (value) => changes.push(value),
        },
        '',
        {
            useNotificationStore: () => ({
                showConfirmation: (options: typeof confirmations[number]) =>
                    confirmations.push(options),
                showNotification: noop,
            }),
        },
    )
    const remove                                                                                          = find(
              tree,
              (node) => node.type ===
                        Button &&
                        node.props['aria-label'] ===
                        'oauth_model_alias.diagram_delete_alias: Public',
          )
    ;(remove.props.onClick as () => void)()
    expect(changes).toEqual([])
    expect(confirmations).toHaveLength(1)
    for (const language of ['en', 'zh-CN', 'zh-TW', 'ru']) {
        const message = confirmations[0].message
        const html    = renderToStaticMarkup(React.cloneElement(message, { t: i18n.getFixedT(language) }))
        expect(html).toContain('<code>Public</code>')
        const escaped = renderToStaticMarkup(React.cloneElement(message, {
            t: i18n.getFixedT(language), values: { alias: /* language=TEXT */ '<img src="fixture" onerror="fixture">' },
        }))
        expect(escaped).toContain('&lt;img')
        expect(escaped).not.toContain('<img')
    }
    confirmations[0].onConfirm()
    expect(changes).toHaveLength(1)
    expect(parse(changes[0])).toEqual({ claude: [{ name: 'Third', alias: 'OtherPublic' }] })
})

for (const source of [
    'codex: &rows [{name: First, alias: Public, fork: true, future: keep}]\nclaude: *rows # keep reference comment\n',
    'codex: [&row {name: First, alias: Public, fork: true, future: keep}]\nclaude: [*row] # keep reference comment\n',
]) {
    test(
        'OAuth relationship edits preserve aliases and isolate individual links for ' +
        `${source.includes('&rows') ? 'list' : 'row'} anchors`,
        () => {
            let value                = source
            const props: EditorProps = {
                kind: 'aliases', value, disabled: false, onChange: (text) => {
                    value = text
                },
            }
            const tree               = editor(props)
            const input              = find(tree, (node) => node.type ===
                                                            Input &&
                                                            node.props.label ===
                                                            (
                                                                'config_management.visual.sections.advanced.oauth_' +
                                                                'alias_alias'
                                                            ))
            ;(input.props.onChange as (event: unknown) => void)({ target: { value: 'OnlyCodex' } })
            expect(parse(value).codex[0]).toEqual({ name: 'First', alias: 'OnlyCodex', fork: true, future: 'keep' })
            expect(parse(value).claude[0]).toEqual({ name: 'First', alias: 'Public', fork: true, future: 'keep' })
            expect(value).toContain('# keep reference comment')
            const draft   = { alias: 'Public', value: 'Renamed', error: '', source }
            const shared  = editor({ ...props, value: source }, '', {
                useState: (initial: unknown) => initial === null ? [draft, noop] : ['', noop],
            })
            const modal   = find(shared, (node) => node.type === Modal && node.props.open === true)
            const confirm = find(modal.props.footer as ReactNode, (node) => node.type ===
                                                                            Button &&
                                                                            node.props.children ===
                                                                            'oauth_model_alias.diagram_rename_btn')
            ;(confirm.props.onClick as () => void)()
            expect(parse(value).codex[0].alias).toBe('Renamed')
            expect(parse(value).claude[0].alias).toBe('Renamed')
            const confirmations: Array<{ onConfirm: () => void }> = []
            const removal                                         = editor({ ...props, value: source }, '', {
                useNotificationStore: () => ({
                    showConfirmation: (action: { onConfirm: () => void }) =>
                        confirmations.push(action), showNotification: noop,
                }),
            })
            const remove                                          =
                      find(
                          removal,
                          (node) => node.type ===
                                    Button &&
                                    node.props['aria-label'] ===
                                    'oauth_model_alias.diagram_delete_alias: Public',
                      )
            ;(remove.props.onClick as () => void)()
            confirmations[0].onConfirm()
            expect(parse(value)).toEqual({})
        },
    )
}

for (const target of ['link', 'provider']) {
    test(`OAuth ${target} removal confirms the exact target and leaves other providers unchanged`, () => {
        const changes: string[]                                                                               = []
        const confirmations: Array<{ onConfirm: () => void; message: ReactElement<Record<string, unknown>> }> = []
        const tree                                                                                            = editor(
            {
                kind: 'aliases',
                value: sharedAliases,
                disabled: false,
                onChange: (text) => changes.push(text),
            },
            '',
            {
                useNotificationStore: () => ({
                    showConfirmation: (options: typeof confirmations[number]) =>
                        confirmations.push(options),
                    showNotification: noop,
                }),
            },
        )
        const remove                                                                                          = find(
                  tree,
                  (node) => node.type === Button && node.props.children ===
                            (target === 'link' ?
                             'common.delete' :
                             'config_management.visual.sections.advanced.oauth_rules_remove_provider'),
              )
        ;(remove.props.onClick as () => void)()
        expect(changes).toEqual([])
        expect(confirmations).toHaveLength(1)
        if (target === 'link') {
            expect(confirmations[0].message.props.values).toEqual({
                                                                      provider: 'codex',
                                                                      sourceModel: 'First',
                                                                      alias: 'Public',
                                                                  })
        }
        confirmations[0].onConfirm()
        expect(changes).toHaveLength(1)
        expect(parse(changes[0]).claude).toEqual(parse(sharedAliases).claude)
        expect(parse(changes[0]).codex).toEqual(target === 'link' ? [] : undefined)
    })
}

for (const transition of ['edited', 'disabled', 'unmounted']) {
    test(
        `shared OAuth alias deletion rejects ${transition} confirmations with a visible error`,
        () => {
            const changes: string[]                               = []
            const notifications: unknown[][]                      = []
            const confirmations: Array<{ onConfirm: () => void }> = []
            const state                                           = {
                current: {
                    value: sharedAliases,
                    disabled: false,
                    kind: 'aliases',
                    onChange: noop,
                },
            }
            let cleanup                                           = noop
            const scope                                           = {
                useRef: (initial: unknown) => typeof initial === 'object' ? state : { current: initial },
                useEffect: (effect: () => () => void) => {
                    cleanup = effect()
                },
                useNotificationStore: () => ({
                    showConfirmation: (action: { onConfirm: () => void }) => confirmations.push(action),
                    showNotification: (...values: unknown[]) => notifications.push(values),
                }),
            }
            const props: EditorProps                              = {
                kind: 'aliases', value: sharedAliases, disabled: false,
                onChange: (value) => changes.push(value),
            }
            const tree                                            = editor(props, '', scope)
            const remove                                          =
                      find(
                          tree,
                          (node) => node.type ===
                                    Button &&
                                    node.props['aria-label'] ===
                                    'oauth_model_alias.diagram_delete_alias: Public',
                      )
            ;(remove.props.onClick as () => void)()
            if (transition === 'unmounted') {
                cleanup()
            } else {
                editor({
                           ...props, disabled: transition === 'disabled',
                           value: transition === 'edited' ? sharedAliases.replace('Public', 'Newer') : sharedAliases,
                       }, '', scope)
            }
            expect(confirmations[0].onConfirm).toThrow('config_management.confirmation_changed')
            expect(changes).toEqual([])
            expect(notifications).toEqual([['config_management.confirmation_changed', 'error']])
        },
    )
}

for (const action of ['cancel', 'unchanged', 'disabled', 'changed-source']) {
    test(`shared OAuth alias rename handles ${action} without changing the configuration`, () => {
        const changes: string[] = []
        const dialog            = {
            current: { alias: 'Public', value: 'Public', error: '', source: sharedAliases } as
                { alias: string; value: string; error: string; source: string } | null,
        }
        const tree              = editor({
                                             kind: 'aliases', disabled: action === 'disabled',
                                             value: action === 'changed-source' ?
                                                    sharedAliases.replace('First', 'Updated') :
                                                    sharedAliases,
                                             onChange: (value) => changes.push(value),
                                         }, '', {
                                             useState: (initial: unknown) => initial === null
                                                                             ?
                                                 [
                                                     dialog.current, (next: typeof dialog.current) => {
                                                     dialog.current = next
                                                 },
                                                 ] :
                                                 ['', noop],
                                         })
        const modal             = find(tree, (node) => node.type === Modal && node.props.open === true)
        const input             = find(modal.props.children as ReactNode, (node) => node.type === Input)
        expect(input.props.id).toBe(modal.props.initialFocusId)
        expect(input.props.autoFocus).toBe(true)
        if (action === 'cancel') {
            (modal.props.onClose as () => void)()
        } else {
            const confirm = find(modal.props.footer as ReactNode, (node) => node.type ===
                                                                            Button &&
                                                                            node.props.children ===
                                                                            'oauth_model_alias.diagram_rename_btn')
            expect(confirm.props.disabled).toBe(action === 'disabled')
            ;(confirm.props.onClick as () => void)()
        }
        expect(changes).toEqual([])
        if (action === 'cancel' || action === 'unchanged') {
            expect(dialog.current).toBeNull()
        }
        if (action === 'changed-source') {
            expect(dialog.current?.error).toBe('config_management.confirmation_changed')
        }
    })
}
