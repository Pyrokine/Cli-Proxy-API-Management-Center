import {describe, expect, test} from 'bun:test'
import {parse} from 'yaml'

import {
    decodeVisualConfigYaml,
    encodeVisualConfigYaml,
    updateApiKeysStorageMetadata,
} from '@/hooks/visualConfigCodec'

const SOURCE_YAML = `# preserve this comment
unknown-section:
  value: keep
remote-management:
  disable-auto-update-panel: true
  panel-repo: legacy/panel
  trusted-proxies:
    - 127.0.0.1/32
plugins:
  enabled: true
  dir: plugins
  store-sources:
    - https://plugins.example/registry.json
auth:
  providers:
    config-api-key:
      api-key-entries:
        - api-key: old-key
          label: primary
api-keys:
  - old-legacy-key
payload:
  default:
    - models:
        - name: model-a
      params:
        temperature: 0.5
`

describe('visual config YAML codec', () => {
    test('decodes legacy aliases and API key storage metadata', () => {
        const decoded = decodeVisualConfigYaml(SOURCE_YAML)

        expect(decoded.values.rmAutoUpdatePanel).toBe(false)
        expect(decoded.values.rmPanelRepo).toBe('legacy/panel')
        expect(decoded.values.rmTrustedProxies).toEqual(['127.0.0.1/32'])
        expect(decoded.values.pluginsEnabled).toBe(true)
        expect(decoded.values.pluginStoreSources).toEqual(['https://plugins.example/registry.json'])
        expect(decoded.values.apiKeysText).toBe('old-key')
        expect(decoded.values.payloadDefaultRules[0]?.models[0]?.name).toBe('model-a')
        expect(decoded.apiKeysStorage).toMatchObject({
                                                         source: 'auth-provider',
                                                         providerListKey: 'api-key-entries',
                                                         entryMode: 'object',
                                                         syncLegacy: true,
                                                     })
    })

    test('writes edited values while preserving unknown YAML and API key entry fields', () => {
        const decoded               = decodeVisualConfigYaml(SOURCE_YAML)
        const nextValues            = structuredClone(decoded.values)
        nextValues.debug            = true
        nextValues.wsAuth           = false
        nextValues.rmTrustedProxies = ['127.0.0.1/32', '10.0.0.0/8']
        nextValues.apiKeysText      = 'new-key'

        const output           = encodeVisualConfigYaml(
            SOURCE_YAML,
            nextValues,
            decoded.values,
            decoded.apiKeysStorage,
        )
        const parsed           = parse(output) as {
            debug?: boolean
            'ws-auth'?: boolean
            'unknown-section'?: { value?: string }
            'remote-management'?: Record<string, unknown>
            auth?: { providers?: { 'config-api-key'?: Record<string, unknown> } }
            'api-keys'?: unknown
        }
        const remoteManagement = parsed['remote-management'] ?? {}
        const configApiKey     = parsed.auth?.providers?.['config-api-key'] ?? {}

        expect(output).toContain('# preserve this comment')
        expect(parsed['unknown-section']).toEqual({ value: 'keep' })
        expect(parsed.debug).toBe(true)
        expect(parsed['ws-auth']).toBe(false)
        expect(remoteManagement['disable-auto-update-panel']).toBeUndefined()
        expect(remoteManagement['auto-update-panel']).toBe(false)
        expect(remoteManagement['trusted-proxies']).toEqual(['127.0.0.1/32', '10.0.0.0/8'])
        expect(configApiKey['api-key-entries']).toEqual([
                                                            { 'api-key': 'new-key', label: 'primary' },
                                                        ])
        expect(parsed['api-keys']).toEqual([{ 'api-key': 'new-key', label: 'primary' }])
    })

    test('preserves payload model match conditions during unrelated edits', () => {
        const source     = `debug: false
payload:
  default:
    - models:
        - name: model-a
          protocol: claude
          from-protocol: openai
          headers:
            x-client: cli-*
          match:
            - user: test
          not-match:
            - stream: true
          exist: [messages]
          not-exist: [tools]
      params:
        temperature: 0.5
`
        const decoded    = decodeVisualConfigYaml(source)
        const nextValues = structuredClone(decoded.values)
        nextValues.debug = true

        const parsed = parse(
            encodeVisualConfigYaml(source, nextValues, decoded.values, decoded.apiKeysStorage),
        ) as { payload: { default: Array<{ models: unknown[] }> } }
        expect(parsed.payload.default[0].models[0]).toEqual({
                                                                name: 'model-a',
                                                                protocol: 'claude',
                                                                'from-protocol': 'openai',
                                                                headers: { 'x-client': 'cli-*' },
                                                                match: [{ user: 'test' }],
                                                                'not-match': [{ stream: true }],
                                                                exist: ['messages'],
                                                                'not-exist': ['tools'],
                                                            })
    })

    test('uses YAML model metadata names and preserves explicit zero, false, and empty levels', () => {
        const source                  = `codex-api-key:
  - api-key: key
    models:
      - name: model-a
        max-context-length: 128000
        thinking:
          min: 0
          max: 0
          zero-allowed: false
          dynamic-allowed: false
          levels: []
          vendor-option: keep
`
        const decoded                 = decodeVisualConfigYaml(source)
        const nextValues              = structuredClone(decoded.values)
        nextValues.providerConfigText = nextValues.providerConfigText
                                                  .replace('zero-allowed:', 'zero_allowed:')
                                                  .replace('dynamic-allowed:', 'dynamicAllowed:')
                                                  .replace('max-context-length:', 'maxContextLength:')

        const parsed = parse(
            encodeVisualConfigYaml(source, nextValues, decoded.values, decoded.apiKeysStorage),
        ) as { 'codex-api-key': Array<{ models: unknown[] }> }
        expect(parsed['codex-api-key'][0]?.models[0]).toEqual({
                                                                  name: 'model-a',
                                                                  'max-context-length': 128000,
                                                                  thinking: {
                                                                      min: 0,
                                                                      max: 0,
                                                                      'zero-allowed': false,
                                                                      'dynamic-allowed': false,
                                                                      levels: [],
                                                                      'vendor-option': 'keep',
                                                                  },
                                                              })
    })

    test('preserves weighted round-robin routing through decode and encode', () => {
        const source  = `routing:
  strategy: weighted-round-robin
`
        const decoded = decodeVisualConfigYaml(source)

        expect(decoded.values.routingStrategy).toBe('weighted-round-robin')

        const parsed = parse(
            encodeVisualConfigYaml(source, decoded.values, decoded.values, decoded.apiKeysStorage),
        ) as { routing: { strategy: string } }
        expect(parsed.routing.strategy).toBe('weighted-round-robin')
    })

    test('accepts weighted round-robin routing aliases', () => {
        expect(decodeVisualConfigYaml('routing:\n  strategy: wrr\n').values.routingStrategy)
            .toBe('weighted-round-robin')
        expect(decodeVisualConfigYaml('routing:\n  strategy: weightedRoundRobin\n').values.routingStrategy)
            .toBe('weighted-round-robin')
    })

    test('preserves quota-aware routing and accepts aliases', () => {
        const source  = 'routing:\n  strategy: quota-aware\n'
        const decoded = decodeVisualConfigYaml(source)
        expect(decoded.values.routingStrategy).toBe('quota-aware')

        const parsed = parse(
            encodeVisualConfigYaml(source, decoded.values, decoded.values, decoded.apiKeysStorage),
        ) as { routing: { strategy: string } }
        expect(parsed.routing.strategy).toBe('quota-aware')
        expect(decodeVisualConfigYaml('routing:\n  strategy: quotaAware\n').values.routingStrategy)
            .toBe('quota-aware')
        expect(decodeVisualConfigYaml('routing:\n  strategy: qa\n').values.routingStrategy)
            .toBe('quota-aware')
    })

    test('applies only user changes when the latest YAML changed concurrently', () => {
        const baselineYaml  = 'debug: false\nproxy-url: https://old.example\n'
        const latestYaml    = 'debug: true\nproxy-url: https://old.example\n'
        const decoded       = decodeVisualConfigYaml(baselineYaml)
        const nextValues    = structuredClone(decoded.values)
        nextValues.proxyUrl = 'https://new.example'

        const parsed = parse(
            encodeVisualConfigYaml(latestYaml, nextValues, decoded.values, decoded.apiKeysStorage),
        ) as Record<string, unknown>
        expect(parsed.debug).toBe(true)
        expect(parsed['proxy-url']).toBe('https://new.example')
    })

    test('uses the raw server YAML to detect legacy API key storage', () => {
        const raw     = 'api-keys:\n  - legacy-key\n'
        const merged  =
                  'api-keys:\n  - legacy-key\n' +
                  'auth:\n  providers:\n' +
                  '    config-api-key:\n' +
                  '      api-key-entries: []\n'
        const decoded = decodeVisualConfigYaml(merged, raw)

        expect(decoded.values.apiKeysText).toBe('legacy-key')
        expect(decoded.apiKeysStorage.source).toBe('legacy')
        expect(decoded.apiKeysStorage.entryMode).toBe('string')
    })

    test('keeps API key object metadata attached to its key after reordering', () => {
        const source           = `auth:
  providers:
    config-api-key:
      api-key-entries:
        - api-key: first-key
          label: first
        - api-key: second-key
          label: second
`
        const decoded          = decodeVisualConfigYaml(source)
        const nextValues       = structuredClone(decoded.values)
        nextValues.apiKeysText = 'second-key\nfirst-key'

        const parsed = parse(
            encodeVisualConfigYaml(source, nextValues, decoded.values, decoded.apiKeysStorage),
        ) as { auth: { providers: { 'config-api-key': { 'api-key-entries': unknown[] } } } }
        expect(parsed.auth.providers['config-api-key']['api-key-entries']).toEqual([
                                                                                       {
                                                                                           'api-key': 'second-key',
                                                                                           label: 'second',
                                                                                       },
                                                                                       {
                                                                                           'api-key': 'first-key',
                                                                                           label: 'first',
                                                                                       },
                                                                                   ])
    })

    test('keeps object metadata through sequential API key deletion and editing', () => {
        const source          = `auth:
  providers:
    config-api-key:
      api-key-entries:
        - api-key: first-key
          label: first
        - api-key: second-key
          label: second
        - api-key: third-key
          label: third
`
        const decoded         = decodeVisualConfigYaml(source)
        const afterDeleteText = 'second-key\nthird-key'
        const afterDelete     = updateApiKeysStorageMetadata(
            decoded.apiKeysStorage,
            decoded.values.apiKeysText,
            afterDeleteText,
        )
        const afterEditText   = 'replacement-key\nthird-key'
        const afterEdit       = updateApiKeysStorageMetadata(afterDelete, afterDeleteText, afterEditText)
        const nextValues      = { ...decoded.values, apiKeysText: afterEditText }

        const parsed = parse(
            encodeVisualConfigYaml(source, nextValues, decoded.values, afterEdit),
        ) as { auth: { providers: { 'config-api-key': { 'api-key-entries': unknown[] } } } }
        expect(parsed.auth.providers['config-api-key']['api-key-entries']).toEqual([
                                                                                       {
                                                                                           'api-key': 'replacement-key',
                                                                                           label: 'second',
                                                                                       },
                                                                                       {
                                                                                           'api-key': 'third-key',
                                                                                           label: 'third',
                                                                                       },
                                                                                   ])
    })

    test('writes plugin configs when the original YAML has no plugins block', () => {
        const source                 = 'debug: false\n'
        const decoded                = decodeVisualConfigYaml(source)
        const nextValues             = structuredClone(decoded.values)
        nextValues.pluginConfigsText = 'example:\n  enabled: true'

        const parsed = parse(
            encodeVisualConfigYaml(source, nextValues, decoded.values, decoded.apiKeysStorage),
        ) as { plugins: { configs: unknown } }
        expect(parsed.plugins.configs).toEqual({ example: { enabled: true } })
    })

    test('round-trips the complete API key policy without losing int64 limits', () => {
        const source  = `api-key-rules:
  policy-key:
    blocked-models: [blocked-model]
    providers: [openai, claude]
    canonical-models: [gpt-5, claude-sonnet-5]
    model-mappings:
      client-model: gpt-5
    policy-profile: paid
    reservation-ttl: 2h
    limits:
      - window: 1h
        requests: 100
        tokens: 9007199254740993
        cost-micro: 5000000
`
        const decoded = decodeVisualConfigYaml(source)
        expect(decoded.values.apiKeyRules['policy-key']).toEqual({
                                                                     blockedModels: ['blocked-model'],
                                                                     providers: ['openai', 'claude'],
                                                                     canonicalModels: ['gpt-5', 'claude-sonnet-5'],
                                                                     modelMappings: { 'client-model': 'gpt-5' },
                                                                     policyProfile: 'paid',
                                                                     reservationTtl: '2h',
                                                                     limits: [
                                                                         {
                                                                             window: '1h',
                                                                             requests: '100',
                                                                             tokens: '9007199254740993',
                                                                             costMicro: '5000000',
                                                                         },
                                                                     ],
                                                                 })

        const nextValues                     = structuredClone(decoded.values)
        nextValues.apiKeyRules['policy-key'] = {
            ...nextValues.apiKeyRules['policy-key']!,
            blockedModels: [],
        }
        const output                         = encodeVisualConfigYaml(
            source,
            nextValues,
            decoded.values,
            decoded.apiKeysStorage,
        )
        const roundTrip                      = decodeVisualConfigYaml(output)
        expect(roundTrip.values.apiKeyRules['policy-key']).toEqual({
                                                                       ...decoded.values.apiKeyRules['policy-key'],
                                                                       blockedModels: [],
                                                                   })
        expect(output).toContain('tokens: 9007199254740993')
        expect(output).not.toContain('blocked-models')
    })

    test('rejects invalid YAML before producing visual values', () => {
        expect(() => decodeVisualConfigYaml('plugins: [')).toThrow()
    })
})
