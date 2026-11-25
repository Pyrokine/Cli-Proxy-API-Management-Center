import type {YamlConfigFieldState, YamlConfigFieldValue, YamlConfigPath} from '@/types/visualConfig'

export type YamlConfigFieldKind = 'boolean' | 'integer' | 'string' | 'list' | 'object' | 'scalar'
export type YamlConfigFieldOwner = 'home' | 'managed' | 'runtime' | 'legacy' | 'ignored' | 'catalog'

type YamlConfigFieldOptions = {
    defaultValue?: YamlConfigFieldValue
    defaultNote?: string
    inherits?: string
    owner?: YamlConfigFieldOwner
    target?: string
    destination?: string
    editable?: true
    statusOnly?: true
    privateKeys?: true
}

type YamlConfigNode = YamlConfigFieldOptions & ({ kind: YamlConfigFieldKind; fields?: never } |
                                                { kind?: 'list' | 'object'; fields: YamlConfigSchema })

interface YamlConfigSchema {
    [key: string]: YamlConfigNode
}

const text                = { kind: 'string' } as const
const bool                = { kind: 'boolean', defaultValue: false } as const
const num                 = { kind: 'integer', defaultValue: '0' } as const
const hiddenText          = { ...text, statusOnly: true } as const
const secret              = { ...hiddenText, defaultNote: 'no_credential' } as const
const map                 = (
    fields: YamlConfigSchema,
    options?: YamlConfigFieldOptions,
): YamlConfigNode => ({ fields, ...options })
const list                = (item: YamlConfigNode, options?: YamlConfigFieldOptions): YamlConfigNode =>
    ({ kind: 'list', defaultValue: [], fields: { '[]': item }, ...options })
const byKey               = (item: YamlConfigNode, options?: YamlConfigFieldOptions): YamlConfigNode =>
    map({ '{*}': item }, options)
const strings             = list(text)
const model               = {
    name: text, alias: text, 'display-name': text, 'force-mapping': bool,
    thinking: map(
        { min: num, max: num, 'zero-allowed': bool, 'dynamic-allowed': bool, levels: strings },
        { defaultNote: 'model_metadata' },
    ),
}
const completeModel       = {
    ...model, 'is-compat': bool, 'max-context-length': { ...num, defaultNote: 'model_metadata' },
}
const errorRules          = list(map({
                                         status: num, match: strings, 'match-regexr': strings, action: {
        ...text, defaultNote: 'required_rule_action',
    },
                                     }))
const providerCommon      = {
    'api-key': secret, 'base-url': hiddenText, prefix: text, priority: num,
    weight: { ...num, defaultValue: '1', defaultNote: 'routing_weight' },
    'proxy-url': { ...hiddenText, inherits: 'proxy-url' },
    headers: byKey(hiddenText), 'excluded-models': strings,
    'disable-cooling': { kind: 'boolean', inherits: 'disable-cooling' },
    'request-retry': { kind: 'integer', inherits: 'request-retry' },
} satisfies YamlConfigSchema
const providerWithErrors  = { ...providerCommon, models: list(map(completeModel)), 'request-scoped-errors': errorRules }
const codexProviderFields = {
    ...providerWithErrors,
    'base-url': { ...hiddenText, defaultNote: 'required_address' }, websockets: bool, 'alpha-search': bool,
    'disable-codex-cloaking': { kind: 'boolean', inherits: 'codex.disable-codex-cloaking' },
    models: list(map({ ...completeModel, 'support-configuration-update': bool })),
} satisfies YamlConfigSchema
const provider            = (fields: YamlConfigSchema) => list(
    map(fields),
    { owner: 'managed', destination: '/credentials' },
)
const geminiProvider      = provider({
                                         ...providerWithErrors,
                                         'base-url': {
                                             ...hiddenText,
                                             defaultValue: 'https://generativelanguage.googleapis.com',
                                         },
                                     })
const ignoredFlag         = { ...bool, owner: 'ignored' } as const
const payloadValue        = { kind: 'scalar' } as const
const payloadMatch        = list(byKey(payloadValue))
const payloadModels       = list(map({
                                         name: text,
                                         protocol: text,
                                         'from-protocol': text,
                                         headers: byKey(hiddenText),
                                         match: payloadMatch,
                                         'not-match': payloadMatch,
                                         exist: strings,
                                         'not-exist': strings,
                                     }))

const PAYLOAD_TARGETS = {
    default: 'payloadDefaultRules', 'default-raw': 'payloadDefaultRawRules',
    override: 'payloadOverrideRules', 'override-raw': 'payloadOverrideRawRules', filter: 'payloadFilterRules',
} as const
const payloadRules    = (section: keyof typeof PAYLOAD_TARGETS) => list(map({
                                                                                models: payloadModels,
                                                                                params: section === 'filter' ?
                                                                                        strings :
                                                                                        byKey(payloadValue),
                                                                            }), { target: PAYLOAD_TARGETS[section] })

// File defaults, editable paths and ownership are separate contracts.
const schema: YamlConfigSchema = {
    host: { kind: 'string', defaultValue: '127.0.0.1' },
    port: { kind: 'integer', defaultValue: '0' },
    tls: {
        fields: {
            enable: { kind: 'boolean', defaultValue: false },
            cert: { ...hiddenText, defaultNote: 'tls_path_required' },
            key: { ...hiddenText, defaultNote: 'tls_path_required' },
            'http-redirect-port': { kind: 'integer', defaultValue: '0' },
            'require-for-auth': { kind: 'boolean', defaultValue: false },
            'trust-forwarded-proto': { kind: 'boolean', defaultValue: false },
        },
    },
    'remote-management': {
        fields: {
            'allow-remote': { kind: 'boolean', defaultValue: false },
            'trusted-proxies': { ...strings, target: 'rmTrustedProxies' },
            'secret-key': { kind: 'string', statusOnly: true },
            'disable-control-panel': { kind: 'boolean', defaultValue: false },
            'auto-update-panel': { kind: 'boolean', defaultValue: true },
            'disable-auto-update-panel': {
                kind: 'boolean',
                defaultValue: false,
                defaultNote: 'panel_update_precedence',
                target: 'rmAutoUpdatePanel',
            },
            'auto-update-cpa': { kind: 'boolean', defaultValue: false },
            'auto-check-update': { kind: 'boolean', defaultValue: false },
            'check-interval': { kind: 'integer', defaultValue: '180' },
            'panel-github-repository': {
                kind: 'string', statusOnly: true,
                defaultValue: 'https://github.com/Pyrokine/Cli-Proxy-API-Management-Center',
            },
            'cpa-github-repository': {
                kind: 'string', statusOnly: true, defaultValue: 'https://github.com/Pyrokine/CLIProxyAPI',
            },
            'panel-repo': { ...hiddenText, owner: 'ignored', target: 'rmPanelRepo' },
        },
    },
    'auth-dir': { ...text, defaultValue: '~/.cli-proxy-api' },
    'api-keys': list(secret, { target: 'apiKeys' }),
    'api-key-aliases': byKey(text, { privateKeys: true, target: 'apiKeys' }),
    'api-key-rules': byKey(map({
                                   'blocked-models': strings, providers: strings, 'canonical-models': strings,
                                   'model-mappings': byKey(text), 'policy-profile': text, 'reservation-ttl': text,
                                   limits: list(map({ window: text, requests: num, tokens: num, 'cost-micro': num })),
                               }), { privateKeys: true, target: 'apiKeys' }),
    auth: map({
                  providers: map({
                                     'config-api-key': map({
                                                               'api-key-entries': list(
                                                                   map({ 'api-key': secret }),
                                                                   { statusOnly: true },
                                                               ),
                                                               'api-keys': list(secret),
                                                           }),
                                 }),
              }, { owner: 'legacy', target: 'apiKeys' }),
    home: { kind: 'object', owner: 'runtime', statusOnly: true },
    'credential-concurrency': {
        owner: 'home', fields: {
            'lifecycle-config-revision': { kind: 'integer' },
            'observation-barrier-revision': num,
            'cpa-heartbeat-timeout': { ...text, defaultValue: '3s' },
            'cpa-cancel-bound': { ...text, defaultValue: '5s' },
            'reclaim-grace': { ...text, defaultValue: '5s' },
            'cleanup-interval': { ...text, defaultValue: '5s' },
            'release-flush-interval': { ...text, defaultValue: '250ms' },
            'release-max-backoff': { ...text, defaultValue: '2s' },
            'busy-retry-min': { ...text, defaultValue: '250ms' },
            'busy-retry-max': { ...text, defaultValue: '1s' },
            'max-limit': { ...num, defaultValue: '1000000' },
        },
    },
    'credential-in-flight': {
        owner: 'home', fields: {
            'snapshot-interval': { kind: 'string', defaultValue: '2s' },
            'stale-after': { kind: 'string', defaultValue: '10s' },
            'max-part-bytes': { kind: 'integer', defaultValue: '262144' },
            'max-part-count': { kind: 'integer', defaultValue: '64' },
            'max-revision-bytes': { kind: 'integer', defaultValue: '16777216' },
            'max-aggregate-groups': { kind: 'integer', defaultValue: '100000' },
            'max-details': { kind: 'integer', defaultValue: '10000' },
            'max-string-bytes': { kind: 'integer', defaultValue: '256' },
            'staging-retention': { kind: 'string', defaultValue: '1m' },
        },
    },
    'proxy-url': { kind: 'string', statusOnly: true },
    'force-model-prefix': { kind: 'boolean', defaultValue: false },
    'enable-gemini-cli-endpoint': { kind: 'boolean', defaultValue: false },
    'passthrough-headers': { kind: 'boolean', defaultValue: false },
    'allow-query-auth': { kind: 'boolean', defaultValue: false },
    'cors-allowed-origins': { ...strings, target: 'corsAllowedOrigins' },
    'ws-auth': { kind: 'boolean', defaultValue: true },
    'disable-image-generation': { kind: 'string', defaultValue: 'off' },
    'gpt-image-2-base-model': { ...text, defaultValue: 'gpt-5.4-mini', defaultNote: 'image_tool_default' },
    'video-result-auth-cache-ttl': { kind: 'string', defaultValue: '3h' },
    'request-retry': { kind: 'integer', defaultValue: '0' },
    'max-retry-credentials': { kind: 'integer', defaultValue: '0' },
    'max-retry-interval': { kind: 'integer', defaultValue: '0' },
    'auth-auto-refresh-workers': { kind: 'integer', defaultValue: '16' },
    routing: {
        fields: {
            strategy: { kind: 'string', defaultValue: 'round-robin' },
            'session-affinity': bool,
            'session-affinity-subagents': { ...bool, defaultValue: true, defaultNote: 'when_affinity_enabled' },
            'session-affinity-ttl': { ...text, defaultValue: '1h', defaultNote: 'when_affinity_enabled' },
            'claude-code-session-affinity': { ...bool, owner: 'legacy', target: 'routingSessionAffinity' },
            sessionAffinity: { kind: 'boolean', owner: 'ignored', target: 'routingSessionAffinity' },
            sessionAffinityTTL: { kind: 'string', owner: 'ignored', target: 'routingSessionAffinityTTL' },
        },
    },
    debug: { kind: 'boolean', defaultValue: false },
    'commercial-mode': { kind: 'boolean', defaultValue: false },
    'logging-to-file': { kind: 'boolean', defaultValue: false },
    'request-log': { kind: 'boolean', defaultValue: false },
    pprof: {
        fields: {
            enable: { kind: 'boolean', defaultValue: false },
            addr: { kind: 'string', defaultValue: '127.0.0.1:8316' },
        },
    },
    'logs-max-total-size-mb': { kind: 'integer', defaultValue: '0' },
    'error-logs-max-files': { kind: 'integer', defaultValue: '10' },
    'redis-usage-queue-retention-seconds': { kind: 'integer', defaultValue: '60' },
    'usage-statistics-enabled': { kind: 'boolean', defaultValue: false },
    'usage-statistics-file': { ...text, owner: 'legacy', defaultNote: 'usage_statistics_file_default' },
    'usage-data-dir': { ...text, defaultNote: 'usage_data_dir_default' },
    'usage-retention': {
        fields: {
            days: { kind: 'integer', defaultValue: '-1' },
            'max-db-size-mb': { kind: 'integer', defaultValue: '0' },
            'warning-threshold-pct': { kind: 'integer', defaultValue: '80' },
        },
    },
    'image-artifact-cache': {
        fields: {
            'retention-days': { kind: 'integer', defaultValue: '7' },
            'max-total-size-mb': { kind: 'integer', defaultValue: '10240' },
        },
    },
    'auto-refresh-interval': { kind: 'integer', defaultValue: '3' },
    'model-refresh-interval': { kind: 'integer', defaultValue: '3' },
    'quota-exceeded': {
        fields: {
            'switch-project': { ...bool, owner: 'legacy' },
            'switch-preview-model': { ...bool, owner: 'legacy' },
            'antigravity-credits': { kind: 'boolean', defaultValue: false },
        },
    },
    'disable-cooling': { kind: 'boolean', defaultValue: false },
    'save-cooldown-status': { kind: 'boolean', defaultValue: false },
    'transient-error-cooldown-seconds': { kind: 'integer', defaultValue: '60' },
    'quota-refresh': {
        owner: 'managed', destination: '/credentials?tab=inspection#quota-refresh-settings', fields: {
            enabled: { kind: 'boolean', defaultValue: false },
            interval: { kind: 'integer', defaultValue: '600' },
            'max-interval': { kind: 'integer', defaultValue: '1800' },
        },
    },
    streaming: {
        fields: {
            'keepalive-seconds': num,
            'bootstrap-retries': num,
            'nonstream-keepalive-interval': {
                kind: 'integer',
                owner: 'ignored',
                target: 'streamingNonstreamKeepalive',
            },
        },
    },
    'nonstream-keepalive-interval': num,
    plugins: {
        fields: {
            enabled: bool,
            dir: { ...text, defaultValue: 'plugins' },
            'store-sources': list(hiddenText, { target: 'pluginStoreSources' }),
            'store-auth': list(map({
                                       match: { ...hiddenText, defaultNote: 'required_match' },
                                       'apply-to': list(text, { defaultNote: 'all_store_requests' }),
                                       type: { ...text, defaultValue: 'none' }, 'token-env': text, 'username-env': text,
                                       'password-env': hiddenText, 'header-name': text, 'header-value-env': hiddenText,
                                       'allow-insecure': bool,
                                   }), { target: 'pluginStoreAuth' }),
            'auth-revision': { ...num, owner: 'home', statusOnly: true },
            configs: byKey(map({
                                   enabled: bool, priority: num, '{*}': {
                    kind: 'scalar', defaultNote: 'plugin_declared', statusOnly: true,
                },
                               }), { owner: 'managed', destination: '/plugins' }),
        },
    },
    antigravity: {
        fields: {
            'sensitive-words': list(hiddenText, { target: 'antigravitySensitiveWords' }),
            'connection-pool': {
                fields: {
                    enabled: bool,
                    'idle-conn-timeout': { ...text, defaultNote: 'idle_timeout_default' },
                    'max-idle-conns-per-host': { ...num, defaultValue: '2', defaultNote: 'when_pool_enabled' },
                },
            },
        },
    },
    devin: { fields: { 'sensitive-words': list(hiddenText, { target: 'devinSensitiveWords' }) } },
    client: { fields: { codex: { fields: { 'enable-apply-patch': { kind: 'boolean', defaultValue: false } } } } },
    codex: {
        fields: {
            'identity-confuse': { kind: 'boolean', defaultValue: false },
            'disable-codex-cloaking': { kind: 'boolean', defaultValue: false },
            'optimize-multi-agent-v2': { kind: 'boolean', defaultValue: false },
            'orphan-delegation-compatibility': { kind: 'boolean', defaultValue: false },
            'live-media-relay': {
                fields: {
                    enabled: { kind: 'boolean', defaultValue: false },
                    'max-sessions': { ...num, defaultValue: '32' },
                    'disable-private-remote-ips': bool,
                    'allow-private-remote-ips': {
                        kind: 'boolean',
                        owner: 'legacy',
                        target: 'codexLiveMediaRelayDisablePrivateRemoteIPs',
                    },
                    'public-ip': text,
                    'udp-port-min': num,
                    'udp-port-max': num,
                    'ice-servers': list(map({
                                                urls: list(hiddenText, { defaultNote: 'required_ice_urls' }),
                                                username: secret, credential: secret,
                                            }), { target: 'codexLiveMediaRelayICEServers' }),
                },
            },
        },
    },
    'disable-claude-cloak-mode': { kind: 'boolean', defaultValue: false },
    claude: { fields: { 'model-level-cooling': { kind: 'boolean', defaultValue: false } } },
    'claude-code': { fields: { 'disable-cloaking-model-list': { kind: 'boolean', defaultValue: false } } },
    xai: { fields: { 'inject-x-search': { kind: 'boolean', defaultValue: false } } },
    'codex-header-defaults': {
        fields: {
            'user-agent': { kind: 'string', editable: true },
            'beta-features': { kind: 'string', editable: true },
        },
    },
    'claude-header-defaults': {
        fields: {
            'user-agent': {
                ...text, editable: true, defaultNote: 'claude_cli_baseline',
                defaultValue: 'claude-cli/2.1.280 (external, cli)',
            },
            'package-version': { ...text, editable: true, defaultNote: 'claude_cli_baseline', defaultValue: '0.112.1' },
            'runtime-version': { ...text, editable: true, defaultNote: 'claude_cli_baseline', defaultValue: 'v26.3.0' },
            os: { ...text, editable: true, defaultNote: 'claude_stable_os' },
            arch: { ...text, editable: true, defaultNote: 'claude_stable_arch' },
            timeout: { kind: 'string', editable: true },
            timezone: { kind: 'string', editable: true },
            'stabilize-device-profile': { kind: 'boolean', defaultValue: false, editable: true },
        },
    },
    payload: map(Object.fromEntries((Object.keys(PAYLOAD_TARGETS) as (keyof typeof PAYLOAD_TARGETS)[])
                                        .map((section) => [section, payloadRules(section)]))),
    'gemini-api-key': geminiProvider,
    'interactions-api-key': geminiProvider,
    'codex-api-key': provider(codexProviderFields),
    'meta-api-key': provider({
                                 ...codexProviderFields,
                                 'base-url': { ...hiddenText, defaultValue: 'https://api.meta.ai/v1' },
                                 'alpha-search': ignoredFlag,
                                 websockets: ignoredFlag,
                             }),
    'xai-api-key': provider({ ...codexProviderFields, 'alpha-search': ignoredFlag }),
    'claude-api-key': provider({
                                   ...providerWithErrors,
                                   'base-url': { ...hiddenText, defaultValue: 'https://api.anthropic.com' },
                                   cloak: map({
                                                  mode: { ...text, defaultValue: 'auto' }, 'strict-mode': bool,
                                                  'cache-user-id': {
                                                      kind: 'boolean',
                                                      defaultNote: 'credential_attribute',
                                                  }, 'sensitive-words': list(hiddenText),
                                              }),
                                   'fingerprint-profile': text,
                                   'rebuild-mid-system-message': bool,
                                   'experimental-cch-signing': bool,
                               }),
    'vertex-api-key': provider({
                                   ...providerCommon,
                                   'base-url': { ...hiddenText, defaultNote: 'vertex_address' },
                                   interactions: bool,
                                   models: list(map(model)),
                               }),
    'openai-compatibility': provider({
                                         name: text,
                                         prefix: text,
                                         priority: num,
                                         disabled: bool,
                                         'base-url': { ...hiddenText, defaultNote: 'required_address' },
                                         headers: byKey(hiddenText),
                                         'support-prompt-cache-key': bool,
                                         'request-scoped-errors': errorRules,
                                         'disable-cooling': providerCommon['disable-cooling'],
                                         'request-retry': providerCommon['request-retry'],
                                         'api-key-entries': list(map({
                                                                         'api-key': secret,
                                                                         disabled: bool,
                                                                         weight: providerCommon.weight,
                                                                         'proxy-url': providerCommon['proxy-url'],
                                                                     })),
                                         'api-keys': list(secret, { owner: 'legacy' }),
                                         models: list(map({
                                                              ...completeModel,
                                                              'use-max-completion-tokens': bool,
                                                              image: bool,
                                                              'input-modalities': strings,
                                                              'output-modalities': strings,
                                                          })),
                                     }),
    'generative-language-api-key': list(secret, { owner: 'legacy', destination: '/credentials' }),
    'oauth-settings': byKey(list(map({
                                         name: text, alias: text,
                                         'max-context-length': { ...num, defaultNote: 'model_metadata' },
                                     })), { owner: 'managed', target: 'oauthSettings' }),
    'oauth-request-scoped-errors': byKey(errorRules, { owner: 'managed', target: 'oauthRequestScopedErrors' }),
    'oauth-excluded-models': byKey(strings, { owner: 'managed', target: 'oauthExcludedModels' }),
    'oauth-model-alias': byKey(list(map({
                                            name: text, alias: text, fork: bool,
                                            'display-name': text, 'force-mapping': bool,
                                        })), { owner: 'catalog', target: 'oauthModelAlias' }),
    'model-catalog': map({
                             models: list(map({
                                                  name: text,
                                                  provider: text,
                                                  channel: text,
                                                  group: text,
                                                  'display-name': text,
                                                  aliases: strings,
                                                  enabled: { ...bool, defaultValue: true },
                                                  speed: text,
                                              })),
                         }, { owner: 'catalog', destination: '/models' }),
    ampcode: { kind: 'object', owner: 'legacy', statusOnly: true },
}

export type YamlConfigField = YamlConfigFieldOptions & {
    kind: YamlConfigFieldKind
    id: string
    path: YamlConfigPath
    template?: true
}

export function yamlConfigPathId(path: YamlConfigPath, template = false): string {
    return path.map((part, index) => {
        if (typeof part === 'number') {
            return `[${part}]`
        }
        if (template && (part === '[]' || part === '{*}')) {
            return part
        }
        return /^[a-zA-Z0-9_-]+$/.test(part) ? `${index ? '.' : ''}${part}` : `[${JSON.stringify(part)}]`
    }).join('')
}

function fieldsIn(
    group: YamlConfigSchema,
    prefix: string[]                  = [],
    inherited: YamlConfigFieldOptions = {},
): YamlConfigField[] {
    return Object.entries(group).flatMap(([name, node]) => {
        const { fields, kind = 'object', ...options }     = node
        const path                                        = [...prefix, name]
        const template                                    = path.includes('[]') || path.includes('{*}') ?
                                                            true :
                                                            undefined
        const { owner, target, destination, privateKeys } = { ...inherited, ...options }
        const field: YamlConfigField                      = {
            ...options, owner, target, destination, privateKeys, kind, path, template,
            id: yamlConfigPathId(path, true),
        }
        return [field, ...(fields ? fieldsIn(fields, path, { owner, target, destination, privateKeys }) : [])]
    })
}

export const VISUAL_YAML_FIELDS = fieldsIn(schema)
const YAML_FIELDS_BY_ID         = new Map(VISUAL_YAML_FIELDS.map((field) => [field.id, field]))
export const yamlConfigField    = (id: string) => YAML_FIELDS_BY_ID.get(id)

export function listYamlConfigFields(states: Partial<Record<string, YamlConfigFieldState>>): YamlConfigField[] {
    return [
        ...VISUAL_YAML_FIELDS, ...Object.entries(states).flatMap(([id, state]) => {
            const spec = state?.instance && yamlConfigField(state.instance.schemaId)
            return spec && state?.instance ? [{ ...spec, id, template: undefined, path: state.instance.path }] : []
        }),
    ]
}

export const canEditYamlConfigField = (field: YamlConfigField, state?: YamlConfigFieldState): boolean =>
    field.editable === true && !state?.shared &&
    (!state || state.source === 'yaml' || state.source === 'default' || state.source === 'unset')
