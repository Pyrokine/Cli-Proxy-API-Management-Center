import {type ConfigFieldSearchEntry, searchConfigFields} from '@/components/config/configSearchIndex'
import {VisualConfigEditor} from '@/components/config/VisualConfigEditor'
import {PluginStoreAuthEditor} from '@/components/config/VisualConfigEditorBlocks'
import {YamlConfigFieldRows} from '@/components/config/YamlConfigFields'
import {getVisualConfigValidationErrors} from '@/hooks/useVisualConfig'
import {
    decodeVisualConfigYaml,
    encodeVisualConfigYaml,
    getConfigRestartFields,
    patchKnownYamlFields,
    readVisualYamlFieldCatalog,
    SharedConfigYamlValueError,
} from '@/hooks/visualConfigCodec'
import {listYamlConfigFields, VISUAL_YAML_FIELDS, yamlConfigField} from '@/hooks/visualConfigFields'
import i18n from '@/i18n'
import {findYamlFieldRange, findYamlSearchMatch} from '@/pages/configYamlSearch'
import type {RequestScopedErrorRule} from '@/types'
import type {VisualConfigRuntimeInfo, VisualConfigValues} from '@/types/visualConfig'
import {EditorState} from '@codemirror/state'
import {expect, mock, test} from 'bun:test'
import {renderToStaticMarkup} from 'react-dom/server'
import {MemoryRouter} from 'react-router'
import {isMap, isSeq, parse, parseDocument} from 'yaml'
import {sourceCallback, sourceInitializer} from './sourceCallbacks'

function editYaml(source: string, change: (values: VisualConfigValues) => void) {
    const baseline = decodeVisualConfigYaml(source)
    const values   = structuredClone(baseline.values)
    change(values)
    return encodeVisualConfigYaml(source, values, baseline.values, baseline.apiKeysStorage, source)
}

function renderEditor(values: VisualConfigValues, runtimeInfo?: VisualConfigRuntimeInfo) {
    const storage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => 'full' } })
    try {
        return renderToStaticMarkup(<VisualConfigEditor values={values} runtimeInfo={runtimeInfo} onChange={() => {
        }} />)
    } finally {
        if (storage) {
            Object.defineProperty(globalThis, 'localStorage', storage)
        } else {
            Reflect.deleteProperty(globalThis, 'localStorage')
        }
    }
}

test('CI-12 finds the caret match first and visits each adjacent or overlapping match in both directions', () => {
    let state = EditorState.create({ doc: 'AAaa\nxxAA\n' })
    for (const [direction, repeat, from, current] of [
        ['next', false, 0, 1], ['next', true, 1, 2], ['next', true, 2, 3], ['next', true, 7, 4],
        ['next', true, 0, 1], ['prev', true, 7, 4], ['prev', true, 2, 3], ['prev', true, 1, 2],
    ] as const) {
        const result = findYamlSearchMatch(state, 'aa', direction, repeat)
        expect(result).toEqual({ from, to: from + 2, current, total: 4 })
        state = state.update({ selection: { anchor: result!.from, head: result!.to } }).state
    }
    state = state.update({ selection: { anchor: 2 } }).state
    expect(findYamlSearchMatch(state, 'aa', 'next', false)?.from).toBe(2)
    expect(findYamlSearchMatch(state, 'aa', 'prev', false)?.from).toBe(2)
    expect(findYamlSearchMatch(EditorState.create({ doc: 'aaaa' }), 'zz', 'next', false)).toBeNull()
    expect(findYamlSearchMatch(EditorState.create({ doc: 'İ: aa' }), 'aa', 'next', false)).toEqual({
                                                                                                       from: 3,
                                                                                                       to: 5,
                                                                                                       current: 1,
                                                                                                       total: 1,
                                                                                                   })
})

test('CI-03 patches actual OAuth rule text and preserves the untouched rows, comments, and exact numbers', () => {
    const source = `oauth-settings:
  codex:
    - name: first
      max-context-length: 1024 # context
    - name: second # keep setting
      future: 9007199254740993

oauth-request-scoped-errors:
  codex:
    - status: 429 # status comment
      match:
        - wait # condition one
        - retry # condition two
      action: continue
      future: 9007199254740993
    - status: 500 # keep error
      match: [error]
      action: stop

oauth-excluded-models:
  codex:
    - first # keep exclusion
    - second
`
    const output = editYaml(source, (values) => {
        const settings = parseDocument(values.oauthSettingsText, { intAsBigInt: true })
        settings.setIn(['codex', 0, 'max-context-length'], 3072)
        values.oauthSettingsText = settings.toString()
        const errors             = parseDocument(values.oauthRequestScopedErrorsText, { intAsBigInt: true })
        const update             = sourceInitializer<(
            provider: string,
            previous: RequestScopedErrorRule[],
            next: RequestScopedErrorRule[],
        ) => void>(
            'components/config/OAuthConfigFields.tsx', 'updateErrorRules', {
                cloneForEdit: () => errors.clone(), isMap, isSeq, patchKnownYamlFields,
                onChange: (text: string) => {
                    values.oauthRequestScopedErrorsText = text
                },
            },
        )
        const original           = [
            { status: 429, match: ['wait', 'retry'], action: 'continue' },
            { status: 500, match: ['error'], action: 'stop' },
        ]
        update('codex', original, [{ ...original[0], match: ['wait', 'again'] }, original[1]])
        values.oauthExcludedModelsText = '# history\n\n' +
                                         values.oauthExcludedModelsText.replace('  - second', '  - third # new note') +
                                         '\n# after rules\n'
    })
    for (const comment of [
        'context', 'keep setting', 'status comment', 'condition one', 'condition two',
        'keep error', 'keep exclusion', 'new note', 'history', 'after rules',
    ]) {
        expect(output).toContain(`# ${comment}`)
    }
    const data = parse(output, { intAsBigInt: true })
    expect(data['oauth-settings'].codex[0]['max-context-length']).toBe(3072n)
    expect(data['oauth-settings'].codex[1].future).toBe(9007199254740993n)
    expect(data['oauth-request-scoped-errors'].codex[0]).toMatchObject({
                                                                           match: ['wait', 'again'],
                                                                           future: 9007199254740993n,
                                                                       })
    expect(data['oauth-excluded-models'].codex).toEqual(['first', 'third'])
    const empty = editYaml(source, (values) => {
        values.oauthExcludedModelsText = '# no exclusions\n'
    })
    expect(parse(empty)['oauth-excluded-models']).toBeNull()
    expect(decodeVisualConfigYaml(empty).values.oauthExcludedModelsText).toContain('# no exclusions')
})

test('CI-03 applies one API-key policy or repository auth change without rebuilding sibling rules', () => {
    const source = `api-key-rules:
  fixture-a:
    providers: [codex] # keep providers
    blocked-models: [old]
    future: false
  fixture-b:
    providers: [claude] # keep key b
    future-label: 0
plugins:
  store-auth:
    - match: https://fixtures.invalid/a/ # keep match a
      type: bearer
      apply_to: [metadata]
      token-env: FIXTURE_A
      future: 0
    - match: https://fixtures.invalid/b/ # keep match b
      type: bearer
      token-env: FIXTURE_B
      future: false
`
    const output = editYaml(source, (values) => {
        values.apiKeyRules['fixture-a'].blockedModels = ['new']
        values.pluginStoreAuth[0].tokenEnv            = 'FIXTURE_CHANGED'
        values.pluginStoreAuth[0].applyTo             = ['registry']
    })
    for (const comment of ['keep providers', 'keep key b', 'keep match a', 'keep match b']) {
        expect(output).toContain(`# ${comment}`)
    }
    const data = parse(output)
    expect(data['api-key-rules']).toMatchObject({
                                                    'fixture-a': { 'blocked-models': ['new'], future: false },
                                                    'fixture-b': { providers: ['claude'], 'future-label': 0 },
                                                })
    expect(data.plugins['store-auth']).toMatchObject([
                                                         {
                                                             'token-env': 'FIXTURE_CHANGED',
                                                             'apply-to': ['registry'],
                                                             future: 0,
                                                         }, { 'token-env': 'FIXTURE_B', future: false },
                                                     ])
    expect(data.plugins['store-auth'][0]).not.toHaveProperty('apply_to')
})

test('CI-05 refuses an ordinary change to a referenced anchor, and keeps unrelated edits available', () => {
    const source = 'debug: &shared false\nlogging-to-file: *shared\nport: 8317\n'
    expect(() => editYaml(source, (values) => {
        values.debug = true
    })).toThrow(SharedConfigYamlValueError)
    expect(parse(editYaml(source, (values) => {
        values.port = '8318'
    }))).toMatchObject({
                           debug: false, 'logging-to-file': false, port: 8318,
                       })
    expect(parse(editYaml(source, (values) => {
        values.loggingToFile = true
    }))).toMatchObject({
                           debug: false, 'logging-to-file': true,
                       })
    expect(parse(editYaml('debug: &unused false\n', (values) => {
        values.debug = true
    })).debug).toBe(true)
})

test('CI-06 finds every missing canonical YAML path and renders the owning field anchors and quota links', () => {
    const paths  = {
        'routing.session-affinity-ttl': 'routingSessionAffinityTTL',
        'enable-gemini-cli-endpoint': 'enableGeminiCliEndpoint',
        'passthrough-headers': 'passthroughHeaders',
        'pprof.addr': 'pprofAddr',
        'usage-statistics-file': 'usageStatisticsFile',
        'usage-retention.days': 'usageRetentionDays',
        'usage-retention.max-db-size-mb': 'usageRetentionMaxDbSizeMb',
        'usage-retention.warning-threshold-pct': 'usageRetentionWarningThresholdPct',
        'model-refresh-interval': 'modelRefreshInterval',
        'api-key-aliases': 'apiKeys',
    }
    const markup = renderEditor(decodeVisualConfigYaml('debug: false\n').values)
    for (const [path, id] of Object.entries(paths)) {
        expect(searchConfigFields(path, i18n.getFixedT('en')).find((entry) => entry.fieldId === id)).toBeDefined()
        expect(markup.split(`id="cfg-field-${id}"`)).toHaveLength(2)
    }
    const fields = VISUAL_YAML_FIELDS.filter((field) => field.path[0] === 'quota-refresh')
    const quota  = renderToStaticMarkup(<MemoryRouter><YamlConfigFieldRows fields={fields}
                                                                           states={{}} /></MemoryRouter>)
    expect(fields.map(({ id }) => id)).toEqual([
                                                   'quota-refresh',
                                                   'quota-refresh.enabled',
                                                   'quota-refresh.interval',
                                                   'quota-refresh.max-interval',
                                               ])
    for (const { id } of fields) {
        const destination = '/credentials?tab=inspection#quota-refresh-settings'
        expect(searchConfigFields(id, (key) => key)[0]?.destination).toBe(destination)
        expect(quota).toContain(`href="${destination}"`)
    }
})

test(
    'CI-07 displays canonical values without migrating ignored keys and still honors real compatibility aliases',
    () => {
        const source     = `remote-management:
  panel-repo: fixture/old # preserve old
  disable-auto-update-panel: true
routing:
  sessionAffinity: true
  sessionAffinityTTL: 17m
streaming:
  nonstream-keepalive-interval: 25
`
        const { values } = decodeVisualConfigYaml(source)
        expect(values).toMatchObject({
                                         rmPanelRepo: '', rmAutoUpdatePanel: false, routingSessionAffinity: false,
                                         routingSessionAffinityTTL: '', streaming: { nonstreamKeepaliveInterval: '' },
                                     })
        expect(values.yamlFields['routing.sessionAffinity']?.value).toBe(true)
        const markup = renderEditor(values)
        expect(markup).toContain('routing.sessionAffinityTTL')
        expect(markup).toContain('remote-management.panel-repo')
        const output = editYaml(source, (draft) => {
            draft.rmPanelRepo                          = 'https://fixtures.invalid/active'
            draft.routingSessionAffinity               = true
            draft.routingSessionAffinityTTL            = '4m'
            draft.streaming.nonstreamKeepaliveInterval = '0'
        })
        expect(output).toContain('# preserve old')
        expect(parse(output)).toMatchObject({
                                                routing: {
                                                    sessionAffinity: true,
                                                    sessionAffinityTTL: '17m',
                                                    'session-affinity': true,
                                                    'session-affinity-ttl': '4m',
                                                },
                                                streaming: { 'nonstream-keepalive-interval': 25 },
                                                'nonstream-keepalive-interval': 0,
                                            })
        expect(decodeVisualConfigYaml('routing: {claude-code-session-affinity: true}\n').values.routingSessionAffinity)
            .toBe(true)
        expect(decodeVisualConfigYaml('routing: {claude-code-session-affinity: true, session-affinity: false}\n').values
                   .routingSessionAffinity).toBe(false)
    },
)

test('CI-08 identifies only changed startup settings, including semantic aliases and omitted defaults', () => {
    expect(getConfigRestartFields('debug: false\n', 'debug: true\nport: 0\nmodel-refresh-interval: 3\n')).toEqual([])
    expect(getConfigRestartFields(
        'fixture: &host 127.0.0.1\nhost: *host\nport: 8317\n',
        'fixture: &host 0.0.0.0\nhost: *host\nport: 8318\ntls: {enable: true, cert: c, key: k, http-redirect-port: 8080}\n' +
        'model-refresh-interval: 0\ncommercial-mode: true\n',
    )).toEqual([
                   'host',
                   'port',
                   'tls.enable',
                   'tls.cert',
                   'tls.key',
                   'tls.http-redirect-port',
                   'model-refresh-interval',
                   'commercial-mode',
               ])
    const warnings = sourceInitializer<string[]>('pages/ConfigPage.tsx', 'previewWarnings', {
        getConfigRestartFields, useMemo: (read: () => unknown) => read(), t: i18n.getFixedT('en'),
        diffModalOpen: true, diffOriginalYaml: 'port: 8317\n', mergedYaml: 'port: 8318\ndebug: true\n',
        validationWarnings: ['Fixture server warning'],
    })
    expect(warnings).toEqual([
                                 'Fixture server warning',
                                 'These settings take effect after restarting the service: port',
                             ])
})

test('CI-09 validates edited integers while retaining accepted legacy values in unrelated saves', () => {
    const source     = 'port: 0\nredis-usage-queue-retention-seconds: 0\nerror-logs-max-files: -1\n'
    const { values } = decodeVisualConfigYaml(source)
    const changed    = { ...values, oauthSettingsText: 'codex: [{name: fixture, max-context-length: 0}]' }
    expect(Object.values(getVisualConfigValidationErrors(changed, values)).filter(Boolean)).toEqual([])
    for (const [key, draft] of
        [['port', '-1'], ['redisUsageQueueRetentionSeconds', '-1'], ['errorLogsMaxFiles', '-2']] as const) {
        expect(getVisualConfigValidationErrors({ ...changed, [key]: draft }, values)[key]).toBeDefined()
    }
    expect(parse(editYaml(source, (draft) => {
        draft.oauthSettingsText = changed.oauthSettingsText
    }))).toMatchObject({
                           port: 0, 'redis-usage-queue-retention-seconds': 0, 'error-logs-max-files': -1,
                       })
})

test('CI-11 locates an OAuth field without changing the general editor preference', () => {
    const handleModeChange = mock()
    const setJumpRequest   = mock()
    const jump             = sourceCallback<(entry: ConfigFieldSearchEntry) => void>(
        'components/config/VisualConfigEditor.tsx', 'handleResultJump', {
            ownerPath: '/credentials/oauth-config', handleModeChange, setJumpRequest,
            setSearchOpen: mock(), setActiveSectionId: mock(),
        },
    )
    jump(searchConfigFields('oauth-excluded-models', (key) => key)[0])
    expect(handleModeChange).not.toHaveBeenCalled()
    expect(setJumpRequest).toHaveBeenCalledWith({ fieldId: 'oauthExcludedModels', sectionId: 'advanced' })
})

test('CI-13 flags blank or newly cleared repository matches without deleting the saved rule', () => {
    const source     = 'plugins: {store-auth: [{match: "https://fixtures.invalid/", type: bearer, token-env: FIXTURE}]}\n'
    const { values } = decodeVisualConfigYaml(source)
    const invalid    = { ...values.pluginStoreAuth[0], match: ' ' }
    const newRule    = { ...invalid, id: 'not-saved' }
    for (const pluginStoreAuth of [[invalid], [...values.pluginStoreAuth, newRule]]) {
        expect(getVisualConfigValidationErrors({ ...values, pluginStoreAuth }, values).pluginStoreAuth)
            .toBe('store_auth_match_required')
        const markup = renderToStaticMarkup(<PluginStoreAuthEditor
            value={pluginStoreAuth} baseline={values.pluginStoreAuth} onChange={() => {
        }} />)
        expect(markup).toContain('aria-invalid="true"')
        expect(markup).toContain('required=""')
    }
    expect(() => editYaml(source, (draft) => {
        draft.pluginStoreAuth = [invalid]
    })).toThrow('Match URL prefix is required')
    expect(parse(editYaml(source, (draft) => {
        draft.pluginStoreAuth = []
    }))).toEqual({})
})

test('CI-14 displays the active threshold while accepting YAML zero as the default', async () => {
    const values = decodeVisualConfigYaml('usage-retention: {warning-threshold-pct: 0}\n').values
    expect(getVisualConfigValidationErrors(values).usageRetentionWarningThresholdPct).toBeUndefined()
    const runtime: VisualConfigRuntimeInfo = {
        usageDbSize: { status: 'ready', sizeBytes: 4096, warningThresholdPct: 80 },
        logSize: { status: 'error' }, imageArtifactCacheSize: { status: 'error' },
    }
    const previous                         = i18n.language
    try {
        await i18n.changeLanguage('en')
        const markup = renderEditor(values, runtime)
        expect(markup).toContain('default of 80%')
        expect(markup).toContain('Active threshold: 80%')
    } finally {
        await i18n.changeLanguage(previous)
    }
})

const hidden       = `__CLI_PROXY_CONFIG_SECRET_${'b'.repeat(32)}__`
const CATALOG_YAML = `request-retry: 4
credential-concurrency: {observation-barrier-revision: 0, max-limit: 500}
redis-usage-queue-retention-seconds: 0
compatibility: &headers {timezone: UTC}
claude-header-defaults: *headers
remote-management: {auto-update-panel: false}
api-key-rules: {fixture-unmasked-key: {limits: [{tokens: 10}]}}
openai-compatibility:
  - name: fixture
    base-url: https://provider.invalid/
    api-key-entries: [{api-key: fixture-unmasked-value}]
    models: [{name: upstream, use-max-completion-tokens: false}]
plugins:
  store-auth: [{match: 'https://repo.invalid/', type: bearer, token-env: FIXTURE_TOKEN}]
  configs: {fixture: {enabled: false, priority: 0, private-value: fixture-unmasked-value}}
oauth-settings: {codex: [{name: fixture, max-context-length: 0}]}
model-catalog: {models: [{name: fixture, enabled: false}]}
payload:
  override-raw:
    - params: {"generationConfig.maxOutputTokens": '0', secret: ${hidden}}
`

test('YAML directory distinguishes exact values, defaults, inherited values, and masked settings', () => {
    const states = readVisualYamlFieldCatalog(CATALOG_YAML)
    for (const [path, state] of Object.entries({
                                                   'credential-concurrency.observation-barrier-revision': {
                                                       source: 'yaml',
                                                       value: '0',
                                                   },
                                                   'credential-concurrency.max-limit': { source: 'yaml', value: '500' },
                                                   'credential-concurrency.reclaim-grace': {
                                                       source: 'default',
                                                       value: '5s',
                                                   },
                                                   'credential-in-flight.snapshot-interval': {
                                                       source: 'default',
                                                       value: '2s',
                                                   },
                                                   'redis-usage-queue-retention-seconds': {
                                                       source: 'yaml',
                                                       value: '0',
                                                       effective: '60',
                                                   },
                                                   'remote-management.disable-auto-update-panel': {
                                                       source: 'fallback',
                                                       from: 'remote-management.auto-update-panel',
                                                       value: true,
                                                   },
                                                   'claude-header-defaults.timezone': {
                                                       source: 'inherited',
                                                       value: 'UTC',
                                                       shared: true,
                                                   },
                                                   'openai-compatibility[0].request-retry': {
                                                       source: 'fallback',
                                                       from: 'request-retry',
                                                       value: '4',
                                                   },
                                                   'openai-compatibility[0].models[0].use-max-completion-tokens': {
                                                       source: 'yaml',
                                                       value: false,
                                                   },
                                                   'openai-compatibility[0].api-key-entries[0].weight': {
                                                       source: 'default',
                                                       value: '1',
                                                   },
                                                   'plugins.store-auth[0].token-env': {
                                                       source: 'yaml',
                                                       value: 'FIXTURE_TOKEN',
                                                   },
                                                   'plugins.configs.fixture.enabled': { source: 'yaml', value: false },
                                                   'plugins.configs.fixture.priority': { source: 'yaml', value: '0' },
                                                   'oauth-settings.codex[0].max-context-length': {
                                                       source: 'yaml',
                                                       value: '0',
                                                   },
                                                   'payload.override-raw[0].params["generationConfig.maxOutputTokens"]': {
                                                       source: 'yaml',
                                                       value: '0',
                                                   },
                                                   'payload.override-raw[0].params.secret': { source: 'redacted' },
                                               })) {
        expect(states[path]).toMatchObject(state)
    }
    const listing = JSON.stringify(states)
    for (const secret of ['fixture-unmasked-key', 'fixture-unmasked-value', hidden]) {
        expect(listing).not.toContain(secret)
    }
    const raw = readVisualYamlFieldCatalog(`credential-concurrency: {${hidden}: ${hidden}}\n`)
    expect(raw['credential-concurrency.max-limit']).toEqual({ source: 'redacted' })
    const idleTimeout = 'antigravity.connection-pool.idle-conn-timeout'
    expect(readVisualYamlFieldCatalog('')[idleTimeout]).toEqual({ source: 'unset' })
    expect(yamlConfigField(idleTimeout)?.defaultNote).toBe('idle_timeout_default')
})

test(
    'YAML directory opens actual specialized settings, keeps Home read-only, and sends exact dynamic paths to YAML',
    async () => {
        const states      = readVisualYamlFieldCatalog(CATALOG_YAML)
        const sourcePaths = [
            'openai-compatibility[0].models[0].use-max-completion-tokens',
            'plugins.configs.fixture.private-value', 'claude-header-defaults.timezone',
        ]
        const previous    = i18n.language
        try {
            await i18n.changeLanguage('en')
            for (const path of sourcePaths) {
                expect(searchConfigFields(path, i18n.t, states, true)[0]?.sourceField?.id).toBe(path)
            }
            const fields  = listYamlConfigFields(states).filter(({ id }) => sourcePaths.includes(id) || [
                'credential-concurrency.observation-barrier-revision', 'quota-refresh.interval',
                'oauth-settings.codex[0].max-context-length', 'plugins.configs', 'model-catalog.models[0].enabled',
            ].includes(id))
            const selects = mock()
            const view    = renderToStaticMarkup(<MemoryRouter>
                <YamlConfigFieldRows fields={fields} states={states} onSelect={selects} pluginsAvailable />
            </MemoryRouter>)
            expect(view).toContain('Open YAML source: openai-compatibility[0].models[0].use-max-completion-tokens')
            expect(view).toContain('View field: credential-concurrency.observation-barrier-revision')
            expect(view).toContain('href="/credentials?tab=inspection#quota-refresh-settings"')
            expect(view).toContain('href="/credentials/oauth-config?field=oauthSettings"')
            expect(view).toContain('href="/plugins"')
            expect(view).toContain('href="/models"')
            expect(view).toContain('Legacy YAML value')
            expect(view).not.toContain('<input')
            expect(view).not.toContain(hidden)
            expect(searchConfigFields('plugins.configs', i18n.t, states, false)[0]?.sourceField?.id).toBe(
                'plugins.configs')
            expect(searchConfigFields('quota-refresh', i18n.t, states)[0]?.destination)
                .toBe('/credentials?tab=inspection#quota-refresh-settings')
        } finally {
            await i18n.changeLanguage(previous)
        }
    },
)

test(
    'source field locator selects the exact array and quoted map key, or the nearest local group for inheritance',
    () => {
        const path   = 'payload.override-raw[0].params["generationConfig.maxOutputTokens"]'
        const states = readVisualYamlFieldCatalog(CATALOG_YAML)
        const range  = (id: string) => findYamlFieldRange(
            CATALOG_YAML,
            listYamlConfigFields(states).find((field) => field.id ===
                                                         id)!,
        )
        const key    = range(path)
        expect(key.exact).toBe(true)
        expect(CATALOG_YAML.slice(key.from, key.to)).toBe('"generationConfig.maxOutputTokens"')
        const inherited = range('claude-header-defaults.timezone')
        expect(inherited.exact).toBe(false)
        expect(CATALOG_YAML.slice(inherited.from, inherited.to)).toBe('claude-header-defaults')
        const collection = range('openai-compatibility[].models[].use-max-completion-tokens')
        expect(collection.exact).toBe(false)
        expect(CATALOG_YAML.slice(collection.from, collection.to)).toBe('openai-compatibility')
    },
)

test('the relay toggle reads and updates the active compatibility spelling with its comment', () => {
    const yaml = 'codex:\n  live-media-relay:\n    allow-private-remote-ips: false # existing key\n'
    const path = 'codex.live-media-relay.disable-private-remote-ips'
    expect(decodeVisualConfigYaml(yaml).values.codexLiveMediaRelayDisablePrivateRemoteIPs).toBe(true)
    expect(readVisualYamlFieldCatalog(yaml)[path]).toMatchObject({ source: 'legacy', value: true })
    expect(searchConfigFields('codex.live-media-relay.allow-private-remote-ips', i18n.t)[0]?.fieldId)
        .toBe('codexLiveMediaRelayDisablePrivateRemoteIPs')
    const toggled = editYaml(yaml, (draft) => {
        draft.codexLiveMediaRelayDisablePrivateRemoteIPs = false
    })
    expect(toggled).toContain('allow-private-remote-ips: true # existing key')
    expect(toggled).not.toContain('disable-private-remote-ips')
    expect(decodeVisualConfigYaml(toggled).values.codexLiveMediaRelayDisablePrivateRemoteIPs).toBe(false)
    expect(yamlConfigField(path)?.defaultValue).toBe(false)
})
