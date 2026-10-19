import {describe, expect, test} from 'bun:test'
import {readFileSync} from 'node:fs'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {parse, parseDocument} from 'yaml'
import {VisualConfigEditor} from '@/components/config/VisualConfigEditor'
import {CodexLiveICEServersEditor} from '@/components/config/VisualConfigEditorBlocks'
import '@/i18n'
import {findConfigFieldById} from '@/components/config/configSearchIndex'
import {getVisualConfigValidationErrors} from '@/hooks/useVisualConfig'
import {DEFAULT_VISUAL_VALUES} from '@/types/visualConfig'

import {
    areVisualConfigValuesEqual,
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

const BOOLEAN_FIELDS = [
    ['tlsEnable', ['tls', 'enable']],
    ['tlsRequireForAuth', ['tls', 'require-for-auth']],
    ['tlsTrustForwardedProto', ['tls', 'trust-forwarded-proto']],
    ['rmAllowRemote', ['remote-management', 'allow-remote']],
    ['rmDisableControlPanel', ['remote-management', 'disable-control-panel']],
    ['rmAutoUpdatePanel', ['remote-management', 'auto-update-panel']],
    ['rmAutoUpdateCPA', ['remote-management', 'auto-update-cpa']],
    ['rmAutoCheckUpdate', ['remote-management', 'auto-check-update']],
    ['pluginsEnabled', ['plugins', 'enabled']],
    ['debug', ['debug']],
    ['commercialMode', ['commercial-mode']],
    ['loggingToFile', ['logging-to-file']],
    ['requestLog', ['request-log']],
    ['pprofEnable', ['pprof', 'enable']],
    ['usageStatisticsEnabled', ['usage-statistics-enabled']],
    ['forceModelPrefix', ['force-model-prefix']],
    ['enableGeminiCliEndpoint', ['enable-gemini-cli-endpoint']],
    ['passthroughHeaders', ['passthrough-headers']],
    ['wsAuth', ['ws-auth']],
    ['allowQueryAuth', ['allow-query-auth']],
    ['codexIdentityConfuse', ['codex', 'identity-confuse']],
    ['codexOptimizeMultiAgentV2', ['codex', 'optimize-multi-agent-v2']],
    ['codexDisableCloaking', ['codex', 'disable-codex-cloaking']],
    ['codexOrphanDelegationCompatibility', ['codex', 'orphan-delegation-compatibility']],
    ['antigravityConnectionPoolEnabled', ['antigravity', 'connection-pool', 'enabled']],
    ['codexLiveMediaRelayEnabled', ['codex', 'live-media-relay', 'enabled']],
    ['codexLiveMediaRelayDisablePrivateRemoteIPs', ['codex', 'live-media-relay', 'disable-private-remote-ips']],
    ['claudeDisableCloakMode', ['disable-claude-cloak-mode']],
    ['claudeCodeDisableCloakingModelList', ['claude-code', 'disable-cloaking-model-list']],
    ['claudeModelLevelCooling', ['claude', 'model-level-cooling']],
    ['xaiInjectXSearch', ['xai', 'inject-x-search']],
    ['routingSessionAffinitySubagents', ['routing', 'session-affinity-subagents']],
    ['quotaSwitchProject', ['quota-exceeded', 'switch-project']],
    ['quotaSwitchPreviewModel', ['quota-exceeded', 'switch-preview-model']],
    ['quotaAntigravityCredits', ['quota-exceeded', 'antigravity-credits']],
    ['disableCooling', ['disable-cooling']],
    ['saveCooldownStatus', ['save-cooldown-status']],
    ['quotaRefreshEnabled', ['quota-refresh', 'enabled']],
    ['routingSessionAffinity', ['routing', 'session-affinity']],
] as const

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

    test('edits Claude timezone through the existing header YAML field', () => {
        const source = '# keep\nclaude-header-defaults:\n  timezone: UTC\n  user-agent: fixture\n  future: retained\nunknown: keep\n'
        const baseline = decodeVisualConfigYaml(source)
        expect(parse(baseline.values.claudeHeaderDefaultsText).timezone).toBe('UTC')
        expect(encodeVisualConfigYaml(source, baseline.values, baseline.values, baseline.apiKeysStorage)).toBe(source)
        for (const timezone of ['UTC', 'Local', 'Asia/Singapore', 'America/New_York', '']) {
            const header = parseDocument(baseline.values.claudeHeaderDefaultsText)
            header.set('timezone', timezone)
            const values = {...baseline.values, claudeHeaderDefaultsText: header.toString()}
            const output = encodeVisualConfigYaml(source, values, baseline.values, baseline.apiKeysStorage)
            expect(parse(output)['claude-header-defaults']).toEqual({timezone, 'user-agent': 'fixture', future: 'retained'})
            expect(parse(decodeVisualConfigYaml(output).values.claudeHeaderDefaultsText).timezone).toBe(timezone)
            expect(output).toContain('# keep')
            expect(output).toContain('unknown: keep')
        }
    })

    test('reads only YAML boolean spellings accepted by typed backend fields', () => {
        for (const text of ['y', 'Y', 'yes', 'Yes', 'YES', 'on', 'On', 'ON']) {
            expect(decodeVisualConfigYaml(`debug: ${text}\n`).values.debug).toBe(true)
        }
        for (const text of ['n', 'N', 'no', 'No', 'NO', 'off', 'Off', 'OFF']) {
            expect(decodeVisualConfigYaml(`ws-auth: ${text}\n`).values.wsAuth).toBe(false)
        }
        expect(decodeVisualConfigYaml('debug: 1\nws-auth: 0\n').values)
            .toMatchObject({debug: false, wsAuth: true})
        expect(decodeVisualConfigYaml('debug: yEs\nws-auth: unknown\n').values)
            .toMatchObject({debug: false, wsAuth: true})
    })

    for (const [key, path] of BOOLEAN_FIELDS) {
        test(`${key}: preserves boolean spellings and writes only a changed value`, () => {
            for (const [spellings, enabled] of [
                [['y', 'Y', 'yes', 'Yes', 'YES', 'on', 'On', 'ON'], true],
                [['n', 'N', 'no', 'No', 'NO', 'off', 'Off', 'OFF'], false],
            ] as const) {
                for (const spelling of spellings) {
                    for (const quoted of [false, true]) {
                        const document = parseDocument('future: retained # keep\n')
                        document.setIn(path, 'BOOL_FIXTURE')
                        const source = document.toString().replace('BOOL_FIXTURE', quoted ? `"${spelling}"` : spelling)
                        const decoded = decodeVisualConfigYaml(source)
                        expect(decoded.values[key]).toBe(enabled)
                        expect(encodeVisualConfigYaml(source, decoded.values, decoded.values, decoded.apiKeysStorage)).toBe(source)
                        const changed = {...decoded.values, [key]: !enabled}
                        expect(areVisualConfigValuesEqual(changed, decoded.values)).toBe(false)
                        const output = encodeVisualConfigYaml(source, changed, decoded.values, decoded.apiKeysStorage)
                        expect(parseDocument(output).getIn(path)).toBe(!enabled)
                        expect(decodeVisualConfigYaml(output).values[key]).toBe(!enabled)
                        expect(output).toContain('future: retained # keep')
                        const restored = {...changed, [key]: enabled}
                        expect(areVisualConfigValuesEqual(restored, decoded.values)).toBe(true)
                        expect(encodeVisualConfigYaml(source, restored, decoded.values, decoded.apiKeysStorage)).toBe(source)
                    }
                }
            }
        })

        test(`${key}: initial, omitted and null defaults agree`, () => {
            const expected = DEFAULT_VISUAL_VALUES[key]
            expect(decodeVisualConfigYaml('{}').values[key]).toBe(expected)
            const document = parseDocument('future: retained\n')
            document.setIn(path, null)
            expect(decodeVisualConfigYaml(document.toString()).values[key]).toBe(expected)
        })
    }

    test('rejects non-boolean YAML values for both default directions', () => {
        for (const [key, fallback] of [['debug', false], ['wsAuth', true]] as const) {
            for (const value of [null, undefined, '', 'true', 'false', 'yEs', 'oFF', ' yes ', 0, 1, {}, []]) {
                const document = parseDocument('future: retained\n')
                document.set(key === 'debug' ? 'debug' : 'ws-auth', value)
                const source = document.toString()
                const decoded = decodeVisualConfigYaml(source)
                expect(decoded.values[key]).toBe(fallback)
                expect(encodeVisualConfigYaml(source, decoded.values, decoded.values, decoded.apiKeysStorage)).toBe(source)
            }
        }
    })

    test('preserves omitted defaults while toggling WebSocket auth and quota settings', () => {
        const omitted = 'port: 8317\n'
        const initial = decodeVisualConfigYaml(omitted)
        expect(initial.values).toMatchObject({wsAuth: true, quotaSwitchProject: false, quotaSwitchPreviewModel: false})
        expect(parse(encodeVisualConfigYaml(omitted, {...initial.values, wsAuth: false}, initial.values, initial.apiKeysStorage)))
            .toEqual({port: 8317, 'ws-auth': false})
        expect(parse(encodeVisualConfigYaml(omitted,
            {...initial.values, quotaSwitchProject: true, quotaSwitchPreviewModel: true}, initial.values, initial.apiKeysStorage)))
            .toEqual({port: 8317, 'quota-exceeded': {'switch-project': true, 'switch-preview-model': true}})
        expect(encodeVisualConfigYaml(omitted, initial.values, initial.values, initial.apiKeysStorage)).toBe(omitted)
        expect(parse(encodeVisualConfigYaml(omitted, {...initial.values, debug: true}, initial.values, initial.apiKeysStorage)))
            .toEqual({port: 8317, debug: true})
        for (const enabled of [true, false]) {
            const source = `port: 8317\nws-auth: ${!enabled}\nquota-exceeded:\n  switch-project: ${!enabled}\n  switch-preview-model: ${!enabled}\n  antigravity-credits: true\n`
            const baseline = decodeVisualConfigYaml(source)
            const changed = {...baseline.values, wsAuth: enabled, quotaSwitchProject: enabled, quotaSwitchPreviewModel: enabled}
            expect(parse(encodeVisualConfigYaml(source, changed, baseline.values, baseline.apiKeysStorage)))
                .toEqual({port: 8317, 'ws-auth': enabled, 'quota-exceeded': {'switch-project': enabled,
                    'switch-preview-model': enabled, 'antigravity-credits': true}})
            const restored = {...changed, wsAuth: !enabled, quotaSwitchProject: !enabled, quotaSwitchPreviewModel: !enabled}
            expect(areVisualConfigValuesEqual(restored, baseline.values)).toBe(true)
            expect(encodeVisualConfigYaml(source, restored, baseline.values, baseline.apiKeysStorage)).toBe(source)
        }
    })

    test('edits fork cooldown persistence at the top-level YAML path', () => {
        const source = 'save-cooldown-status: on\nunknown: keep\n'
        const decoded = decodeVisualConfigYaml(source)
        expect(decoded.values.saveCooldownStatus).toBe(true)
        const updated = {...decoded.values, saveCooldownStatus: false}
        expect(parse(encodeVisualConfigYaml(source, updated, decoded.values, decoded.apiKeysStorage)))
            .toEqual({'save-cooldown-status': false, unknown: 'keep'})
        const absent = decodeVisualConfigYaml('debug: false\n')
        expect(parse(encodeVisualConfigYaml('debug: false\n',
            {...absent.values, saveCooldownStatus: true}, absent.values, absent.apiKeysStorage)))
            .toEqual({debug: false, 'save-cooldown-status': true})
    })

    test('edits the fork video result credential TTL without changing unrelated YAML', () => {
        const source = '# keep\nvideo-result-auth-cache-ttl: bad-duration\nunknown: retained\n'
        const decoded = decodeVisualConfigYaml(source)
        const baseline = decoded.values
        expect(baseline.videoResultAuthCacheTTL).toBe('bad-duration')
        expect(getVisualConfigValidationErrors(baseline, baseline).videoResultAuthCacheTTL).toBeUndefined()
        const unrelated = {...baseline, debug: true}
        expect(getVisualConfigValidationErrors(unrelated, baseline).videoResultAuthCacheTTL).toBeUndefined()
        expect(encodeVisualConfigYaml(source, unrelated, baseline, decoded.apiKeysStorage))
            .toContain('video-result-auth-cache-ttl: bad-duration')
        const updated = {...baseline, videoResultAuthCacheTTL: '1h30m'}
        expect(getVisualConfigValidationErrors(updated, baseline).videoResultAuthCacheTTL).toBeUndefined()
        const serverYaml = source.replace('unknown: retained', 'unknown: updated')
        const output = encodeVisualConfigYaml(serverYaml, updated, baseline, decoded.apiKeysStorage, source)
        expect(output).toContain('# keep')
        expect(parse(output)).toEqual({'video-result-auth-cache-ttl': '1h30m', unknown: 'updated'})
        const cleared = encodeVisualConfigYaml(source, {...baseline, videoResultAuthCacheTTL: ''},
            baseline, decoded.apiKeysStorage)
        expect(parse(cleared)).toEqual({unknown: 'retained'})
        expect(findConfigFieldById('videoResultAuthCacheTTL')).toMatchObject({
            sectionId: 'network', yamlKeys: ['video-result-auth-cache-ttl'],
        })
    })

    test('validates only edited video result credential durations', () => {
        const baseline = {...DEFAULT_VISUAL_VALUES, videoResultAuthCacheTTL: 'invalid'}
        for (const value of ['1ns', '1µs', '1μs', '.5s', '+1h2m3.5s', '9223372036854775807ns']) {
            expect(getVisualConfigValidationErrors({...baseline, videoResultAuthCacheTTL: value}, baseline)
                .videoResultAuthCacheTTL).toBeUndefined()
        }
        for (const value of ['0', '-1s', '0.1ns', '1d', '1e3s', '1 s', '9223372036854775808ns']) {
            expect(getVisualConfigValidationErrors({...baseline, videoResultAuthCacheTTL: value}, baseline)
                .videoResultAuthCacheTTL).toBe('positive_duration')
        }
        expect(getVisualConfigValidationErrors(baseline, baseline).videoResultAuthCacheTTL).toBeUndefined()
        expect(getVisualConfigValidationErrors(baseline).videoResultAuthCacheTTL).toBe('positive_duration')
        expect(getVisualConfigValidationErrors({...baseline, videoResultAuthCacheTTL: ''}, baseline)
            .videoResultAuthCacheTTL).toBeUndefined()
    })

    test('saves long Go durations at the fork TTL and connection pool paths', () => {
        const source = '# preserve\nunknown: keep\nantigravity:\n  connection-pool:\n    unknown: neighbor\n'
        const decoded = decodeVisualConfigYaml(source)
        const timeout = `${'0s'.repeat(64)}30s`
        const ttl = `${'0s'.repeat(64)}3h`
        const values = {...decoded.values, antigravityConnectionPoolEnabled: true,
            antigravityConnectionPoolIdleTimeout: timeout, videoResultAuthCacheTTL: ttl}
        const errors = getVisualConfigValidationErrors(values, decoded.values)
        expect(errors.antigravityConnectionPoolIdleTimeout).toBeUndefined()
        expect(errors.videoResultAuthCacheTTL).toBeUndefined()
        const output = encodeVisualConfigYaml(source, values, decoded.values, decoded.apiKeysStorage)
        expect(output).toContain('# preserve')
        expect(parse(output)).toEqual({unknown: 'keep', 'video-result-auth-cache-ttl': ttl,
            antigravity: {'connection-pool': {unknown: 'neighbor', enabled: true, 'idle-conn-timeout': timeout}}})
        expect(decodeVisualConfigYaml(output).values).toMatchObject({
            antigravityConnectionPoolIdleTimeout: timeout, videoResultAuthCacheTTL: ttl,
        })
    })

    test('reads and edits fork connection pool and live media relay paths without exposing saved ICE credentials', () => {
        const source = `# keep original comment
antigravity:
  sensitive-words: [retain]
  connection-pool:
    enabled: true
    idle-conn-timeout: 30s
    max-idle-conns-per-host: 2
    unknown: pool-neighbor
codex:
  identity-confuse: true
  live-media-relay:
    enabled: true
    max-sessions: 1
    disable-private-remote-ips: true
    public-ip: 203.0.113.2
    udp-port-min: 40000
    udp-port-max: 40001
    ice-servers:
      - urls: ["turn:first.example.org"]
        username: first
        credential: first-secret # keep credential comment
        unknown: first-neighbor
      - urls: ["stun:second.example.org"]
        username: second
        credential: second-secret
unknown: old
`
        const decoded = decodeVisualConfigYaml(source)
        const baseline = decoded.values
        expect(areVisualConfigValuesEqual(baseline, decodeVisualConfigYaml(source).values)).toBe(true)
        expect(baseline).toMatchObject({
            antigravityConnectionPoolEnabled: true,
            antigravityConnectionPoolIdleTimeout: '30s',
            antigravityConnectionPoolMaxIdleConnsPerHost: '2',
            codexLiveMediaRelayEnabled: true,
            codexLiveMediaRelayMaxSessions: '1',
            codexLiveMediaRelayDisablePrivateRemoteIPs: true,
            codexLiveMediaRelayPublicIP: '203.0.113.2',
            codexLiveMediaRelayUDPPortMin: '40000',
            codexLiveMediaRelayUDPPortMax: '40001',
        })
        expect(baseline.codexLiveMediaRelayICEServers.map((row) => ({
            username: row.username, usernameConfigured: row.usernameConfigured,
            credential: row.credential, credentialConfigured: row.credentialConfigured,
            urlsText: row.urlsText,
        }))).toEqual([
            {username: '', usernameConfigured: true, credential: '', credentialConfigured: true,
                urlsText: 'turn:first.example.org'},
            {username: '', usernameConfigured: true, credential: '', credentialConfigured: true,
                urlsText: 'stun:second.example.org'},
        ])
        const remote = source.replace('unknown: old', 'unknown: changed-on-server')
        const next = {
            ...baseline,
            debug: true,
            antigravityConnectionPoolIdleTimeout: '-1s',
            antigravityConnectionPoolMaxIdleConnsPerHost: '-2',
            codexLiveMediaRelayMaxSessions: '2',
            codexLiveMediaRelayUDPPortMax: '40003',
        }
        expect(getVisualConfigValidationErrors(next, baseline)).toEqual({
            quotaRefreshInterval: undefined, quotaRefreshMaxInterval: undefined,
        })
        const output = encodeVisualConfigYaml(remote, next, baseline, decoded.apiKeysStorage, source)
        const parsed = parse(output)
        expect(output).toContain('# keep original comment')
        expect(output).toContain('# keep credential comment')
        expect(parsed.antigravity['connection-pool']).toEqual({
            enabled: true, 'idle-conn-timeout': '-1s', 'max-idle-conns-per-host': -2,
            unknown: 'pool-neighbor',
        })
        expect(parsed.codex['live-media-relay']['ice-servers']).toEqual([
            {urls: ['turn:first.example.org'], username: 'first', credential: 'first-secret', unknown: 'first-neighbor'},
            {urls: ['stun:second.example.org'], username: 'second', credential: 'second-secret'},
        ])
        expect(parsed.codex['live-media-relay']).toMatchObject({
            enabled: true, 'max-sessions': 2, 'disable-private-remote-ips': true,
            'public-ip': '203.0.113.2', 'udp-port-min': 40000, 'udp-port-max': 40003,
        })
        expect(parsed.codex['identity-confuse']).toBe(true)
        expect(parsed.unknown).toBe('changed-on-server')
        const unchanged = encodeVisualConfigYaml(source, {...baseline, debug: true},
            baseline, decoded.apiKeysStorage, source)
        expect(unchanged).toContain('first-secret # keep credential comment')
        expect(unchanged).toContain('second-secret')
    })

    test('writes each pool and relay scalar to the backend fork path without adding upstream nesting', () => {
        const yaml = `antigravity:\n  connection-pool: {enabled: true, idle-conn-timeout: 30s, max-idle-conns-per-host: 2}\ncodex:\n  live-media-relay: {enabled: true, max-sessions: 1, disable-private-remote-ips: true, public-ip: 203.0.113.2, udp-port-min: 40000, udp-port-max: 40001}\nunknown: keep\n`
        const decoded = decodeVisualConfigYaml(yaml)
        const cases = [
            ['antigravityConnectionPoolEnabled', false, ['antigravity', 'connection-pool', 'enabled'], false],
            ['antigravityConnectionPoolIdleTimeout', '45s', ['antigravity', 'connection-pool', 'idle-conn-timeout'], '45s'],
            ['antigravityConnectionPoolMaxIdleConnsPerHost', '-1', ['antigravity', 'connection-pool', 'max-idle-conns-per-host'], -1],
            ['codexLiveMediaRelayEnabled', false, ['codex', 'live-media-relay', 'enabled'], false],
            ['codexLiveMediaRelayMaxSessions', '2', ['codex', 'live-media-relay', 'max-sessions'], 2],
            ['codexLiveMediaRelayDisablePrivateRemoteIPs', false,
                ['codex', 'live-media-relay', 'disable-private-remote-ips'], false],
            ['codexLiveMediaRelayPublicIP', '198.51.100.2', ['codex', 'live-media-relay', 'public-ip'], '198.51.100.2'],
            ['codexLiveMediaRelayUDPPortMin', '39999', ['codex', 'live-media-relay', 'udp-port-min'], 39999],
            ['codexLiveMediaRelayUDPPortMax', '40003', ['codex', 'live-media-relay', 'udp-port-max'], 40003],
        ] as const
        for (const [field, value, path, expected] of cases) {
            const output = encodeVisualConfigYaml(yaml, {...decoded.values, [field]: value},
                decoded.values, decoded.apiKeysStorage, yaml)
            const parsed = parseDocument(output)
            expect(parsed.getIn([...path])).toBe(expected)
            expect(parsed.get('unknown')).toBe('keep')
            expect(parsed.has('oauth')).toBe(false)
        }
        const cleared = encodeVisualConfigYaml(yaml,
            {...decoded.values, codexLiveMediaRelayPublicIP: ''}, decoded.values, decoded.apiKeysStorage, yaml)
        expect(parseDocument(cleared).hasIn(['codex', 'live-media-relay', 'public-ip'])).toBe(false)
        const absent = decodeVisualConfigYaml('unknown: keep\n')
        const inserted = encodeVisualConfigYaml('unknown: keep\n', {
            ...absent.values, antigravityConnectionPoolEnabled: true, codexLiveMediaRelayEnabled: true,
        }, absent.values, absent.apiKeysStorage)
        expect(parse(inserted)).toEqual({
            antigravity: {'connection-pool': {enabled: true}},
            codex: {'live-media-relay': {enabled: true}}, unknown: 'keep',
        })
    })

    test('ICE credential edits, clearing, and conflicts preserve unedited secrets and unknown fields', () => {
        const source = `codex:
  live-media-relay:
    enabled: true
    ice-servers:
      - urls: ["turn:relay.example.org"]
        username: alice
        credential: saved-secret
        custom: keep
`
        const decoded = decodeVisualConfigYaml(source)
        const baseline = decoded.values
        const row = baseline.codexLiveMediaRelayICEServers[0]!
        const updated = {...baseline, codexLiveMediaRelayICEServers: [
            {...row, urlsText: 'turn:relay.example.org\nstun:backup.example.org',
                credential: 'replacement-secret', credentialEdited: true},
        ]}
        const remote = source.replace('custom: keep', 'custom: concurrent-change')
        const result = encodeVisualConfigYaml(remote, updated, baseline, decoded.apiKeysStorage, source)
        expect(parse(result)).toMatchObject({codex: {'live-media-relay': {'ice-servers': [{
            urls: ['turn:relay.example.org', 'stun:backup.example.org'],
            credential: 'replacement-secret', custom: 'concurrent-change',
        }]}}})
        const cleared = {...baseline, codexLiveMediaRelayICEServers: [
            {...row, credential: '', credentialEdited: true},
        ]}
        expect(parse(encodeVisualConfigYaml(source, cleared, baseline, decoded.apiKeysStorage, source)))
            .toEqual({codex: {'live-media-relay': {enabled: true, 'ice-servers': [
                {urls: ['turn:relay.example.org'], username: 'alice', custom: 'keep'},
            ]}}})
        const clearedUsername = {...baseline, codexLiveMediaRelayICEServers: [
            {...row, username: '', usernameEdited: true},
        ]}
        expect(parse(encodeVisualConfigYaml(source, clearedUsername, baseline, decoded.apiKeysStorage, source)))
            .toEqual({codex: {'live-media-relay': {enabled: true, 'ice-servers': [
                {urls: ['turn:relay.example.org'], credential: 'saved-secret', custom: 'keep'},
            ]}}})
        const rotated = source.replace('saved-secret', 'rotated-secret')
        expect(() => encodeVisualConfigYaml(rotated, updated, baseline, decoded.apiKeysStorage, source))
            .toThrow(/ICE server list changed on the server/)
        const alteredUrls = source.replace('turn:relay.example.org', 'turn:replaced.example.org')
        expect(() => encodeVisualConfigYaml(alteredUrls, updated, baseline, decoded.apiKeysStorage, source))
            .toThrow(/ICE server list changed on the server/)
        const aliasSource = `server-list: &servers\n  - urls: ["turn:relay.example.org"]\ncodex:\n  live-media-relay:\n    ice-servers: *servers\n`
        const alias = decodeVisualConfigYaml(aliasSource)
        expect(encodeVisualConfigYaml(aliasSource, {...alias.values, debug: true},
            alias.values, alias.apiKeysStorage, aliasSource)).toContain('ice-servers: *servers')
        expect(() => encodeVisualConfigYaml(aliasSource, {...alias.values,
            codexLiveMediaRelayICEServers: [...alias.values.codexLiveMediaRelayICEServers, {
                id: 'extra', urlsText: 'stun:other.example.org', username: '', credential: '',
                usernameConfigured: false, usernameEdited: false,
                credentialConfigured: false, credentialEdited: false,
            }]}, alias.values, alias.apiKeysStorage, aliasSource)).toThrow(/ICE server list must be a YAML sequence/)
        const appended = {...baseline, codexLiveMediaRelayICEServers: [row, {
            id: 'new-row', urlsText: 'stun:another.example.org', username: 'new-user', credential: 'new-secret',
            usernameConfigured: false, usernameEdited: true,
            credentialConfigured: false, credentialEdited: true,
        }]}
        expect(parse(encodeVisualConfigYaml(source, appended, baseline, decoded.apiKeysStorage, source))
            .codex['live-media-relay']['ice-servers'][1]).toEqual({
            urls: ['stun:another.example.org'], username: 'new-user', credential: 'new-secret',
        })
        expect(() => encodeVisualConfigYaml(source, {...baseline,
            codexLiveMediaRelayICEServers: [row, row]}, baseline, decoded.apiKeysStorage, source))
            .toThrow(/Duplicate ICE server row/)
    })

    test('redacted ICE usernames and credentials stay at their original ordinal positions', () => {
        const firstUsername = '__CLI_PROXY_CONFIG_SECRET_11111111111111111111111111111111__'
        const firstCredential = '__CLI_PROXY_CONFIG_SECRET_22222222222222222222222222222222__'
        const secondUsername = '__CLI_PROXY_CONFIG_SECRET_33333333333333333333333333333333__'
        const secondCredential = '__CLI_PROXY_CONFIG_SECRET_44444444444444444444444444444444__'
        const source = `codex:
  live-media-relay:
    ice-servers:
      - urls: ["turn:first.example.org"]
        username: ${firstUsername}
        credential: ${firstCredential}
      - urls: ["stun:second.example.org"]
        username: ${secondUsername}
        credential: ${secondCredential}
`
        const decoded = decodeVisualConfigYaml(source)
        const [first, second] = decoded.values.codexLiveMediaRelayICEServers
        expect(first).toMatchObject({username: '', usernameConfigured: true,
            usernameEdited: false, credential: '', credentialConfigured: true, credentialEdited: false})
        expect(JSON.stringify(decoded.values)).not.toContain('__CLI_PROXY_CONFIG_SECRET_')
        const markup = renderToStaticMarkup(createElement(CodexLiveICEServersEditor, {
            value: decoded.values.codexLiveMediaRelayICEServers, onChange: () => {},
        }))
        expect(markup).not.toContain(firstUsername)
        expect(markup).not.toContain(firstCredential)
        expect(markup).toContain('role="note"')
        expect(markup.match(/<button[^>]*disabled=""[^>]*aria-label=/)?.[0]).toBeTruthy()
        const updated = {...decoded.values, codexLiveMediaRelayICEServers: [
            {...first!, urlsText: 'turn:first.example.org\nstun:backup.example.org'}, second!,
        ]}
        const output = encodeVisualConfigYaml(source, updated, decoded.values, decoded.apiKeysStorage, source)
        expect(parse(output).codex['live-media-relay']['ice-servers']).toEqual([
            {urls: ['turn:first.example.org', 'stun:backup.example.org'],
                username: firstUsername, credential: firstCredential},
            {urls: ['stun:second.example.org'], username: secondUsername, credential: secondCredential},
        ])
        const keepFirst = {...decoded.values, codexLiveMediaRelayICEServers: [first!]}
        expect(parse(encodeVisualConfigYaml(source, keepFirst, decoded.values, decoded.apiKeysStorage, source))
            .codex['live-media-relay']['ice-servers']).toEqual([
            {urls: ['turn:first.example.org'], username: firstUsername, credential: firstCredential},
        ])
        for (const rows of [[second!, first!], [second!]]) {
            expect(() => encodeVisualConfigYaml(source,
                {...decoded.values, codexLiveMediaRelayICEServers: rows},
                decoded.values, decoded.apiKeysStorage, source)).toThrow(/saved redacted values/)
        }
        const replaced = {...decoded.values, codexLiveMediaRelayICEServers: [{
            ...second!, username: 'new-user', usernameEdited: true,
            credential: 'new-credential', credentialEdited: true,
        }]}
        expect(parse(encodeVisualConfigYaml(source, replaced, decoded.values, decoded.apiKeysStorage, source))
            .codex['live-media-relay']['ice-servers']).toEqual([{
            urls: ['stun:second.example.org'], username: 'new-user', credential: 'new-credential',
        }])
    })

    test('validates enabled relay limits and edited pool duration against backend rules', () => {
        const baseline = {...DEFAULT_VISUAL_VALUES, antigravityConnectionPoolIdleTimeout: 'legacy-invalid'}
        expect(getVisualConfigValidationErrors({...baseline, debug: true}, baseline)
            .antigravityConnectionPoolIdleTimeout).toBeUndefined()
        for (const valid of ['0', '0s', '0s0m', '0.1ns', '-1s', '30s', '210s', '+1h30m',
            '-9223372036854775808ns']) {
            expect(getVisualConfigValidationErrors({...baseline,
                antigravityConnectionPoolIdleTimeout: valid}, baseline)
                .antigravityConnectionPoolIdleTimeout).toBeUndefined()
        }
        for (const invalid of ['-+1s', '1d', '1 s', '999999999999999999999h']) {
            expect(getVisualConfigValidationErrors({...baseline,
                antigravityConnectionPoolIdleTimeout: invalid}, baseline)
                .antigravityConnectionPoolIdleTimeout).toBe('invalid_duration')
        }
        const dormant = {...baseline, codexLiveMediaRelayMaxSessions: '-1',
            codexLiveMediaRelayPublicIP: 'example.com', codexLiveMediaRelayUDPPortMin: '40000',
            codexLiveMediaRelayICEServers: [{id: 'invalid', urlsText: 'http://not-ice', username: '',
                usernameConfigured: false, usernameEdited: false,
                credential: '', credentialConfigured: false, credentialEdited: false}]}
        const dormantErrors = getVisualConfigValidationErrors(dormant, baseline)
        expect(dormantErrors.codexLiveMediaRelayMaxSessions).toBeUndefined()
        expect(dormantErrors.codexLiveMediaRelayPublicIP).toBeUndefined()
        expect(dormantErrors.codexLiveMediaRelayUDPPortMin).toBeUndefined()
        const enabledErrors = getVisualConfigValidationErrors({...dormant, codexLiveMediaRelayEnabled: true}, baseline)
        expect(enabledErrors).toMatchObject({
            codexLiveMediaRelayMaxSessions: 'non_negative_integer',
            codexLiveMediaRelayPublicIP: 'invalid_ip',
            codexLiveMediaRelayUDPPortMin: 'udp_port_pair',
            codexLiveMediaRelayUDPPortMax: 'udp_port_pair',
            codexLiveMediaRelayICEServers: 'invalid_ice_servers',
        })
        const valid = {...baseline, codexLiveMediaRelayEnabled: true, codexLiveMediaRelayMaxSessions: '1',
            codexLiveMediaRelayPublicIP: '::ffff:192.0.2.10', codexLiveMediaRelayUDPPortMin: '50000',
            codexLiveMediaRelayUDPPortMax: '50001', codexLiveMediaRelayICEServers: [{
                id: 'valid', urlsText: 'stun:relay.example.org\nturn:backup.example.org', username: '',
                usernameConfigured: true, usernameEdited: false,
                credential: '', credentialConfigured: true, credentialEdited: false,
            }]}
        expect(getVisualConfigValidationErrors(valid, baseline).codexLiveMediaRelayPublicIP).toBeUndefined()
        expect(getVisualConfigValidationErrors(valid, baseline).codexLiveMediaRelayICEServers).toBeUndefined()
        expect(getVisualConfigValidationErrors({...valid, codexLiveMediaRelayPublicIP: '127.1'}, baseline)
            .codexLiveMediaRelayPublicIP).toBe('invalid_ip')
        expect(getVisualConfigValidationErrors({...valid, codexLiveMediaRelayUDPPortMax: '50002',
            codexLiveMediaRelayMaxSessions: '2'}, baseline).codexLiveMediaRelayUDPPortMax)
            .toBe('udp_port_capacity')
        expect(getVisualConfigValidationErrors({...valid, codexLiveMediaRelayUDPPortMin: '65536'}, baseline)
            .codexLiveMediaRelayUDPPortMin).toBe('integer_range_0_65535')
        expect(getVisualConfigValidationErrors({...valid, codexLiveMediaRelayMaxSessions: '-1',
            codexLiveMediaRelayEnabled: false}, baseline).codexLiveMediaRelayMaxSessions).toBeUndefined()
    })

    test('indexes every fork relay field and masks saved TURN credentials in offline markup', () => {
        const source = 'codex:\n  live-media-relay:\n    ice-servers:\n      - urls: ["turn:relay.example.org"]\n        username: private-turn-user\n        credential: private-turn-secret\n'
        const row = decodeVisualConfigYaml(source).values.codexLiveMediaRelayICEServers[0]!
        const markup = renderToStaticMarkup(createElement(CodexLiveICEServersEditor, {
            value: [row], disabled: true, error: 'Invalid server URL', onChange: () => {},
        }))
        expect(markup).toContain('type="password"')
        expect(markup).toContain('placeholder=')
        expect(markup).not.toContain('private-turn-user')
        expect(markup).not.toContain('private-turn-secret')
        // cspell:ignore describedby
        expect(markup).toContain('aria-describedby=')
        expect(markup.match(/<button[^>]*disabled/g)?.length).toBe(4)
        const fields = [
            ['antigravityConnectionPoolEnabled', ['antigravity', 'connection-pool', 'enabled']],
            ['antigravityConnectionPoolIdleTimeout', ['antigravity', 'connection-pool', 'idle-conn-timeout']],
            ['antigravityConnectionPoolMaxIdleConnsPerHost', ['antigravity', 'connection-pool', 'max-idle-conns-per-host']],
            ['codexLiveMediaRelayEnabled', ['codex', 'live-media-relay', 'enabled']],
            ['codexLiveMediaRelayMaxSessions', ['codex', 'live-media-relay', 'max-sessions']],
            ['codexLiveMediaRelayDisablePrivateRemoteIPs', ['codex', 'live-media-relay', 'disable-private-remote-ips']],
            ['codexLiveMediaRelayPublicIP', ['codex', 'live-media-relay', 'public-ip']],
            ['codexLiveMediaRelayUDPPortMin', ['codex', 'live-media-relay', 'udp-port-min']],
            ['codexLiveMediaRelayUDPPortMax', ['codex', 'live-media-relay', 'udp-port-max']],
            ['codexLiveMediaRelayICEServers', ['codex', 'live-media-relay', 'ice-servers']],
        ] as const
        const editor = readFileSync(new URL('../src/components/config/VisualConfigEditor.tsx', import.meta.url), 'utf8')
        for (const [fieldId, yamlKeys] of fields) {
            expect(findConfigFieldById(fieldId)).toMatchObject({sectionId: 'advanced', yamlKeys})
            expect(editor).toContain(`fieldId='${fieldId}'`)
        }
        for (const locale of ['en', 'ru', 'zh-CN', 'zh-TW']) {
            const text = JSON.parse(readFileSync(new URL(`../src/i18n/locales/${locale}.json`, import.meta.url), 'utf8'))
            expect(text.config_management.visual.sections.advanced.ice_credential_saved).toBeTruthy()
            expect(text.config_management.visual.sections.advanced.ice_username_saved).toBeTruthy()
            expect(text.config_management.visual.sections.advanced.ice_remove_blocked).toBeTruthy()
            expect(text.config_management.visual.sections.advanced.pool_idle_timeout_hint).toBeTruthy()
            expect(text.config_management.visual.sections.advanced.relay_udp_hint).toBeTruthy()
            expect(text.config_management.visual.validation.invalid_ice_servers).toBeTruthy()
        }
        const priorStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
        Object.defineProperty(globalThis, 'localStorage', {
            configurable: true,
            value: {getItem: (key: string) => key === 'config-management:editor-mode' ? 'full' : null,
                setItem: () => {}},
        })
        try {
            const fullMarkup = renderToStaticMarkup(createElement(VisualConfigEditor, {
                values: decodeVisualConfigYaml(source).values, onChange: () => {}, disabled: true,
            }))
            expect(fullMarkup).toContain('id="cfg-field-antigravityConnectionPoolEnabled"')
            expect(fullMarkup).toContain('id="cfg-field-codexLiveMediaRelayICEServers"')
            const debugMarkup = fullMarkup.slice(fullMarkup.indexOf('id="cfg-field-debug"'))
            const toggleId = debugMarkup.match(/<label[^>]*for="([^"]+)"[^>]*>/)?.[1]
            expect(toggleId).toBeTruthy()
            expect(debugMarkup).toContain(`id="${toggleId}"`)
            expect(debugMarkup).toContain(`aria-describedby="${toggleId}-description"`)
            expect(fullMarkup).not.toContain('private-turn-user')
            expect(fullMarkup).not.toContain('private-turn-secret')
        } finally {
            if (priorStorage) {
                Object.defineProperty(globalThis, 'localStorage', priorStorage)
            } else {
                Reflect.deleteProperty(globalThis, 'localStorage')
            }
        }
    })

    test('edits provider sensitive words and image mode at fork YAML paths without losing neighbors', () => {
        const source = `# preserve this comment
antigravity:
  sensitive-words: [private]
  preserve: keep
devin:
  sensitive-words: [old]
disable-image-generation: off
unknown: keep
`
        const decoded = decodeVisualConfigYaml(source)
        expect(decoded.values.antigravitySensitiveWords).toEqual(['private'])
        expect(decoded.values.devinSensitiveWords).toEqual(['old'])
        expect(decoded.values.disableImageGeneration).toBe('off')
        const output = encodeVisualConfigYaml(source, {
            ...decoded.values,
            antigravitySensitiveWords: ['new'],
            devinSensitiveWords: [],
            disableImageGeneration: 'passthrough',
        }, decoded.values, decoded.apiKeysStorage)
        expect(output).toContain('# preserve this comment')
        expect(parse(output)).toEqual({
            antigravity: {'sensitive-words': ['new'], preserve: 'keep'},
            'disable-image-generation': 'passthrough',
            unknown: 'keep',
        })
        expect(findConfigFieldById('disableImageGeneration')?.yamlKeys).toEqual(['disable-image-generation'])
        expect(findConfigFieldById('antigravitySensitiveWords')?.yamlKeys).toEqual(['antigravity', 'sensitive-words'])
        expect(findConfigFieldById('devinSensitiveWords')?.yamlKeys).toEqual(['devin', 'sensitive-words'])
    })

    test('edits the Codex multi-agent toggle at the fork backend path', () => {
        const source = 'codex:\n  optimize-multi-agent-v2: true\n  identity-confuse: true\nclient:\n  codex:\n    keep: unchanged\n'
        const decoded = decodeVisualConfigYaml(source)
        expect(decoded.values.codexOptimizeMultiAgentV2).toBe(true)
        expect(findConfigFieldById('codexOptimizeMultiAgentV2')).toMatchObject({
            sectionId: 'advanced', yamlKeys: ['codex', 'optimize-multi-agent-v2'],
        })
        const output = encodeVisualConfigYaml(source,
            {...decoded.values, codexOptimizeMultiAgentV2: false}, decoded.values, decoded.apiKeysStorage)
        expect(parse(output)).toEqual({
            codex: {'optimize-multi-agent-v2': false, 'identity-confuse': true},
            client: {codex: {keep: 'unchanged'}},
        })
        const absent = decodeVisualConfigYaml('debug: false\n')
        expect(parse(encodeVisualConfigYaml('debug: false\n',
            {...absent.values, codexOptimizeMultiAgentV2: true}, absent.values, absent.apiKeysStorage)))
            .toEqual({debug: false, codex: {'optimize-multi-agent-v2': true}})
    })

    test('reads and edits the fork backend provider switches without changing unrelated YAML', () => {
        const source = `disable-claude-cloak-mode: true
claude-code:
  disable-cloaking-model-list: true
  preserve: keep
claude:
  model-level-cooling: true
  preserve: keep
codex:
  disable-codex-cloaking: true
  orphan-delegation-compatibility: true
  preserve: keep
xai:
  inject-x-search: true
routing:
  session-affinity: true
  session-affinity-subagents: false
client:
  codex:
    preserve: unchanged
`
        const decoded = decodeVisualConfigYaml(source)
        expect(decoded.values).toMatchObject({
            claudeDisableCloakMode: true,
            claudeCodeDisableCloakingModelList: true,
            claudeModelLevelCooling: true,
            codexDisableCloaking: true,
            codexOrphanDelegationCompatibility: true,
            xaiInjectXSearch: true,
            routingSessionAffinitySubagents: false,
        })
        for (const [fieldId, sectionId, yamlKeys] of [
            ['claudeDisableCloakMode', 'advanced', ['disable-claude-cloak-mode']],
            ['claudeCodeDisableCloakingModelList', 'advanced', ['claude-code', 'disable-cloaking-model-list']],
            ['claudeModelLevelCooling', 'advanced', ['claude', 'model-level-cooling']],
            ['codexDisableCloaking', 'advanced', ['codex', 'disable-codex-cloaking']],
            ['codexOrphanDelegationCompatibility', 'advanced', ['codex', 'orphan-delegation-compatibility']],
            ['xaiInjectXSearch', 'advanced', ['xai', 'inject-x-search']],
            ['routingSessionAffinitySubagents', 'network', ['routing', 'session-affinity-subagents']],
        ] as const) {
            expect(findConfigFieldById(fieldId)).toMatchObject({ sectionId, yamlKeys })
        }
        const output = encodeVisualConfigYaml(source, {
            ...decoded.values,
            claudeDisableCloakMode: false,
            claudeCodeDisableCloakingModelList: false,
            claudeModelLevelCooling: false,
            codexDisableCloaking: false,
            codexOrphanDelegationCompatibility: false,
            xaiInjectXSearch: false,
            routingSessionAffinitySubagents: true,
        }, decoded.values, decoded.apiKeysStorage)
        expect(parse(output)).toEqual({
            'disable-claude-cloak-mode': false,
            'claude-code': { 'disable-cloaking-model-list': false, preserve: 'keep' },
            claude: { 'model-level-cooling': false, preserve: 'keep' },
            codex: { 'disable-codex-cloaking': false, 'orphan-delegation-compatibility': false, preserve: 'keep' },
            xai: { 'inject-x-search': false },
            routing: { 'session-affinity': true, 'session-affinity-subagents': true },
            client: { codex: { preserve: 'unchanged' } },
        })
    })

    test('edits only Claude model-level cooling when other server keys change', () => {
        const baseline = 'claude:\n  model-level-cooling: false\n  custom: original\n'
        const current = 'claude:\n  model-level-cooling: false\n  custom: server-updated\n'
        const decoded = decodeVisualConfigYaml(baseline)
        const output = encodeVisualConfigYaml(current,
            {...decoded.values, claudeModelLevelCooling: true}, decoded.values, decoded.apiKeysStorage, baseline)
        expect(parse(output)).toEqual({
            claude: {'model-level-cooling': true, custom: 'server-updated'},
        })
        expect(decodeVisualConfigYaml(output).values.claudeModelLevelCooling).toBe(true)
    })

    test('keeps absent subagent affinity enabled without writing it during unrelated edits', () => {
        const source = 'debug: false\nrouting:\n  session-affinity: true\n'
        const decoded = decodeVisualConfigYaml(source)
        expect(decoded.values.routingSessionAffinitySubagents).toBe(true)
        const unrelated = encodeVisualConfigYaml(source,
            {...decoded.values, debug: true}, decoded.values, decoded.apiKeysStorage)
        expect(parse(unrelated)).toEqual({debug: true, routing: {'session-affinity': true}})
        const disabled = encodeVisualConfigYaml(source,
            {...decoded.values, routingSessionAffinitySubagents: false}, decoded.values, decoded.apiKeysStorage)
        expect(parse(disabled)).toEqual({
            debug: false,
            routing: {'session-affinity': true, 'session-affinity-subagents': false},
        })
        const disabledValues = decodeVisualConfigYaml(disabled)
        expect(disabledValues.values.routingSessionAffinitySubagents).toBe(false)
        expect(parse(encodeVisualConfigYaml(disabled,
            {...disabledValues.values, debug: true}, disabledValues.values, disabledValues.apiKeysStorage)))
            .toEqual({debug: true, routing: {'session-affinity': true, 'session-affinity-subagents': false}})
    })

    test('adds enabled provider switches to their fork YAML paths', () => {
        const source = 'debug: false\nclient:\n  codex:\n    preserve: unchanged\n'
        const decoded = decodeVisualConfigYaml(source)
        const output = encodeVisualConfigYaml(source, {
            ...decoded.values,
            claudeDisableCloakMode: true,
            claudeCodeDisableCloakingModelList: true,
            claudeModelLevelCooling: true,
            codexDisableCloaking: true,
            codexOrphanDelegationCompatibility: true,
            xaiInjectXSearch: true,
        }, decoded.values, decoded.apiKeysStorage)
        expect(parse(output)).toEqual({
            debug: false,
            'disable-claude-cloak-mode': true,
            'claude-code': {'disable-cloaking-model-list': true},
            claude: {'model-level-cooling': true},
            codex: {'disable-codex-cloaking': true, 'orphan-delegation-compatibility': true},
            xai: {'inject-x-search': true},
            client: {codex: {preserve: 'unchanged'}},
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
        expect(remoteManagement['disable-auto-update-panel']).toBe(true)
        expect(remoteManagement['auto-update-panel']).toBeUndefined()
        expect(remoteManagement['trusted-proxies']).toEqual(['127.0.0.1/32', '10.0.0.0/8'])
        expect(configApiKey['api-key-entries']).toEqual([
                                                            { 'api-key': 'new-key', label: 'primary' },
                                                        ])
        expect(parsed['api-keys']).toEqual(['new-key'])
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

    test('edits a null routing section without changing unrelated settings', () => {
        const source = 'routing: null\ndebug: true\n'
        const decoded = decodeVisualConfigYaml(source)
        const nextValues = structuredClone(decoded.values)
        nextValues.routingStrategy = 'quota-aware'

        const parsed = parse(
            encodeVisualConfigYaml(source, nextValues, decoded.values, decoded.apiKeysStorage),
        ) as { routing: { strategy: string }; debug: boolean }
        expect(parsed.routing.strategy).toBe('quota-aware')
        expect(parsed.debug).toBe(true)
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

    test('rejects a concurrent edit to the same list without losing either change', () => {
        const source = 'remote-management:\n  trusted-proxies: [192.0.2.1]\ndebug: false\n'
        const latest = source.replace('[192.0.2.1]', '[192.0.2.1, 192.0.2.2]')
        const decoded = decodeVisualConfigYaml(source)
        const next = structuredClone(decoded.values)
        next.rmTrustedProxies = ['192.0.2.3']
        expect(() => encodeVisualConfigYaml(latest, next, decoded.values, decoded.apiKeysStorage, source))
            .toThrow(/trusted-proxies.*changed on the server/)
        const output = parse(encodeVisualConfigYaml(source, next, decoded.values, decoded.apiKeysStorage, source))
        expect(output['remote-management']['trusted-proxies']).toEqual(['192.0.2.3'])
    })

    test('rejects an API key draft when the server added another key or changed its metadata', () => {
        const source = 'api-keys:\n  - api-key: sk-original-secret-1234\n    label: original\n'
        const decoded = decodeVisualConfigYaml(source)
        const next = structuredClone(decoded.values)
        next.apiKeysText = 'sk-original-secret-1234\nsk-local-secret-12345'
        for (const latest of [
            source + '  - api-key: sk-server-secret-12345\n',
            source.replace('label: original', 'label: updated'),
        ]) {
            expect(() => encodeVisualConfigYaml(latest, next, decoded.values, decoded.apiKeysStorage, source))
                .toThrow(/api-keys.*changed on the server/)
        }
    })

    test('keeps unrelated concurrent changes while writing a list', () => {
        const source = 'remote-management:\n  trusted-proxies: [192.0.2.1]\ndebug: false\n'
        const latest = source.replace('debug: false', 'debug: true')
        const decoded = decodeVisualConfigYaml(source)
        const next = structuredClone(decoded.values)
        next.rmTrustedProxies = ['192.0.2.1', '192.0.2.3']
        expect(parse(encodeVisualConfigYaml(latest, next, decoded.values, decoded.apiKeysStorage, source)))
            .toMatchObject({debug: true, 'remote-management': {'trusted-proxies': ['192.0.2.1', '192.0.2.3']}})
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

    test('preserves each redacted API key placeholder when appending a new key', () => {
        const providerKey = '__CLI_PROXY_CONFIG_SECRET_11111111111111111111111111111111__'
        const legacyKey = '__CLI_PROXY_CONFIG_SECRET_22222222222222222222222222222222__'
        const source = `auth:
  providers:
    config-api-key:
      api-key-entries:
        - api-key: ${providerKey}
api-keys:
  - ${legacyKey}
`
        const decoded = decodeVisualConfigYaml(source)
        expect(decoded.values.apiKeysText).toBe(providerKey)
        expect(decoded.apiKeysStorage.legacyEntries).toEqual([legacyKey])

        const nextValues = {...decoded.values, apiKeysText: `${providerKey}\nnew-synthetic-key`}
        const output = parse(encodeVisualConfigYaml(source, nextValues, decoded.values, decoded.apiKeysStorage)) as {
            auth: {providers: {'config-api-key': {'api-key-entries': Array<{ 'api-key': string }>}}}
            'api-keys': string[]
        }
        expect(output.auth.providers['config-api-key']['api-key-entries']).toEqual([
            {'api-key': providerKey}, {'api-key': 'new-synthetic-key'},
        ])
        expect(output['api-keys']).toEqual([legacyKey, 'new-synthetic-key'])
    })

    test('does not offer actions that require the original value of a saved key', () => {
        const secret = '__CLI_PROXY_CONFIG_SECRET_11111111111111111111111111111111__'
        const values = decodeVisualConfigYaml(`api-keys:\n  - ${secret}\n`).values
        const priorStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
        Object.defineProperty(globalThis, 'localStorage', {
            configurable: true,
            value: {getItem: () => null, setItem: () => {}},
        })
        try {
            const markup = renderToStaticMarkup(createElement(VisualConfigEditor, {
                values, onChange: () => {}, disabled: false,
            }))
            expect(markup).toContain('已保存的密钥（内容已隐藏）')
            expect(markup).toContain('仍可添加新密钥')
            expect(markup).not.toContain('>复制</button>')
            expect(markup).not.toContain('>删除</button>')
        } finally {
            if (priorStorage) {
                Object.defineProperty(globalThis, 'localStorage', priorStorage)
            } else {
                Reflect.deleteProperty(globalThis, 'localStorage')
            }
        }
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

    test('writes only dirty leaves and preserves omitted defaults and legacy aliases', () => {
        const source = '# untouched\ndebug: false\nws-auth: true\nremote-management:\n  disable-auto-update-panel: true\n  panel-repo: old/repo\nrouting:\n  strategy: wrr\nunknown: 9007199254740993\n'
        const decoded = decodeVisualConfigYaml(source)
        expect(encodeVisualConfigYaml(source, decoded.values, decoded.values, decoded.apiKeysStorage)).toBe(source)
        const next = { ...decoded.values, debug: true }
        const output = encodeVisualConfigYaml(source, next, decoded.values, decoded.apiKeysStorage)
        expect(output).toBe(source.replace('debug: false', 'debug: true'))
        expect(decodeVisualConfigYaml('').values.quotaSwitchProject).toBe(false)
        expect(decodeVisualConfigYaml('').values.quotaSwitchPreviewModel).toBe(false)
        expect(DEFAULT_VISUAL_VALUES.quotaSwitchProject).toBe(false)
        expect(DEFAULT_VISUAL_VALUES.quotaSwitchPreviewModel).toBe(false)
        expect(output).not.toContain('quota-exceeded')
        expect(output).not.toContain('codex:')
    })

    const sections = {
        payloadDefaultRules: 'default', payloadDefaultRawRules: 'default-raw',
        payloadOverrideRules: 'override', payloadOverrideRawRules: 'override-raw', payloadFilterRules: 'filter',
    } as const
    for (const [field, section] of Object.entries(sections)) {
        const key = field as keyof typeof sections
        const params = section === 'filter' ? '        - "remove-a" # parameter-comment' :
            section.endsWith('-raw') ? '        content: | # parameter-comment\n          {"enabled": true}' :
                '        content: "text" # parameter-comment'
        const source = `debug: false\npayload:\n  ${section}:\n    # rule-comment\n    - custom-rule: first\n      models:\n        # model-comment\n        - name: "first" # name-comment\n          headers: {x-client: cli-*}\n          match: [{user: test}]\n          not-match: [{stream: true}]\n          exist: [messages]\n          not-exist: [tools]\n          vendor-option: keep\n      params:\n${params}\n    - custom-rule: second\n      models: [{name: second}]\n      params: ${section === 'filter' ? '[other]' : '{other: "123"}'}\n`
        test(`${section}: unrelated edits retain the original rule AST`, () => {
            const decoded = decodeVisualConfigYaml(source)
            const output = encodeVisualConfigYaml(source, { ...decoded.values, debug: true }, decoded.values, decoded.apiKeysStorage)
            const originalPayload = parseDocument(source).get('payload', true)
            expect(parseDocument(output).get('payload', true)?.toString()).toBe(originalPayload?.toString())
            for (const comment of ['rule-comment', 'model-comment', 'name-comment', 'parameter-comment']) {
                expect(output).toContain(comment)
            }
        })
        test(`${section}: edits and local reorders retain rule/model unknowns and scalar styles`, () => {
            const decoded = decodeVisualConfigYaml(source)
            const next = structuredClone(decoded.values)
            next[key][0]!.models[0]!.name = 'renamed'
            next[key].reverse()
            const output = encodeVisualConfigYaml(source, next, decoded.values, decoded.apiKeysStorage)
            const parsed = parse(output).payload[section]
            expect(parsed[0]['custom-rule']).toBe('second')
            expect(parsed[1]['custom-rule']).toBe('first')
            expect(parsed[1].models[0]).toMatchObject({ name: 'renamed', 'vendor-option': 'keep', headers: { 'x-client': 'cli-*' } })
            expect(output).toContain('name: "renamed"')
            for (const comment of ['rule-comment', 'model-comment', 'name-comment', 'parameter-comment']) {
                expect(output).toContain(comment)
            }
            expect(output).toContain(section.endsWith('-raw') ? 'content: |' : section === 'filter' ? '"remove-a"' : 'content: "text"')
        })
        test(`${section}: concurrent reorder and insertion are matched to baseline identity`, () => {
            const decoded = decodeVisualConfigYaml(source)
            const next = structuredClone(decoded.values)
            next[key][0]!.models[0]!.name = 'renamed'
            const latest = parseDocument(source)
            const seq = latest.getIn(['payload', section], true) as { items: unknown[] }
            seq.items.reverse()
            seq.items.unshift(latest.createNode({ models: [{ name: 'remote-new' }], params: section === 'filter' ? ['new'] : { new: true }, 'remote-only': true }))
            const output = encodeVisualConfigYaml(latest.toString(), next, decoded.values, decoded.apiKeysStorage)
            const rules = parse(output).payload[section]
            expect(rules.map((rule: { models: { name: string }[] }) => rule.models[0]!.name)).toEqual(['remote-new', 'second', 'renamed'])
            expect(rules[0]['remote-only']).toBe(true)
            expect(rules[2]['custom-rule']).toBe('first')
        })
        test(`${section}: deletion does not move another rule's metadata`, () => {
            const decoded = decodeVisualConfigYaml(source)
            const next = structuredClone(decoded.values)
            next[key].splice(0, 1)
            const output = encodeVisualConfigYaml(source, next, decoded.values, decoded.apiKeysStorage)
            const rules = parse(output).payload[section]
            expect(rules).toHaveLength(1)
            expect(rules[0]['custom-rule']).toBe('second')
            expect(rules[0].models[0].name).toBe('second')
        })
    }

    test('parameter rename and edits preserve comment and quoting while concurrent additions survive', () => {
        const source = 'payload:\n  default:\n    - models: [model]\n      custom: keep\n      params:\n        old: "before" # keep-param\n        other: 1\n'
        const decoded = decodeVisualConfigYaml(source)
        const next = structuredClone(decoded.values)
        const param = next.payloadDefaultRules[0]!.params[0]!
        param.path = 'renamed'
        param.value = 'after'
        const latest = source.replace('other: 1', 'other: 2\n        remote: true')
        const output = encodeVisualConfigYaml(latest, next, decoded.values, decoded.apiKeysStorage)
        expect(output).toContain('renamed: "after" # keep-param')
        expect(parse(output).payload.default[0].params).toEqual({ renamed: 'after', other: 2, remote: true })
        expect(parse(output).payload.default[0].models).toEqual(['model'])
    })

    test('same model selectors with distinct params retain their own metadata after reorder', () => {
        const source = 'payload:\n  default:\n    - custom: first\n      models: [{name: same}]\n      params: {n: 1}\n    - custom: second\n      models: [{name: same}]\n      params: {n: 2}\n'
        const decoded = decodeVisualConfigYaml(source)
        const next = structuredClone(decoded.values)
        next.payloadDefaultRules.reverse()
        next.payloadDefaultRules[1]!.params[0]!.value = '3'
        const output = encodeVisualConfigYaml(source, next, decoded.values, decoded.apiKeysStorage)
        expect(parse(output).payload.default.map((rule: {custom: string}) => rule.custom)).toEqual(['second', 'first'])
        expect(parse(output).payload.default[1].params.n).toBe(3)
    })

    for (const [field, section] of Object.entries(sections)) {
        const key = field as keyof typeof sections
        test(`${section}: rejects competing edits to one payload parameter`, () => {
            const original = `payload:\n  ${section}:\n    - models: [{name: shared}]\n      params: ${section === 'filter' ? '[original]' : '{temperature: 1}'}\n`
            const decoded  = decodeVisualConfigYaml(original)
            const next     = structuredClone(decoded.values)
            const params   = next[key][0]!.params
            if (section === 'filter') {
                (params as string[])[0] = 'local'
            } else {
                (params as Array<{value: string}>)[0]!.value = '2'
            }
            const latest  = original.replace(section === 'filter' ? 'original' : 'temperature: 1',
                                             section === 'filter' ? 'remote' : 'temperature: 3')
            expect(() => encodeVisualConfigYaml(latest, next, decoded.values, decoded.apiKeysStorage))
                .toThrow('Payload conflict')
        })
    }

    test('rejects deleting a rule that gained concurrent unknown fields', () => {
        const original = 'payload:\n  default:\n    - models: [{name: shared}]\n      params: {temperature: 1}\n      future: before\n'
        const decoded  = decodeVisualConfigYaml(original)
        const next     = structuredClone(decoded.values)
        next.payloadDefaultRules = []
        const changed = original.replace('future: before', 'future: remote')
        expect(() => encodeVisualConfigYaml(changed, next, decoded.values, decoded.apiKeysStorage, original))
            .toThrow('Payload conflict')
        const unrelated = original + 'debug: true\n'
        expect(parse(encodeVisualConfigYaml(unrelated, next, decoded.values, decoded.apiKeysStorage, original)))
            .toEqual({debug: true})
    })

    test('treats an already applied model edit as complete after an interrupted save', () => {
        const original = 'payload:\n  default:\n    - models: [{name: original}]\n      params: {temperature: 1}\n'
        const decoded  = decodeVisualConfigYaml(original)
        const next     = structuredClone(decoded.values)
        next.payloadDefaultRules[0]!.models[0]!.name = 'updated'
        const applied = encodeVisualConfigYaml(original, next, decoded.values, decoded.apiKeysStorage, original)
        expect(encodeVisualConfigYaml(applied, next, decoded.values, decoded.apiKeysStorage, original))
            .toBe(applied)
    })

    test('ambiguous concurrent identity and conflicting reorder fail without replacing the draft', () => {
        const source = 'payload:\n  default:\n    - models: [{name: one}]\n      params: {n: 1}\n    - models: [{name: two}]\n      params: {n: 2}\n    - models: [{name: three}]\n      params: {n: 3}\n'
        const decoded = decodeVisualConfigYaml(source)
        const next = structuredClone(decoded.values)
        next.payloadDefaultRules.reverse()
        const server = parseDocument(source)
        const seq = server.getIn(['payload', 'default'], true) as { items: unknown[] }
        seq.items.push(seq.items.shift())
        expect(() => encodeVisualConfigYaml(server.toString(), next, decoded.values, decoded.apiKeysStorage)).toThrow('Payload conflict')
        const ambiguous = source.replace('name: two', 'name: one').replace('n: 2', 'n: 1')
        expect(() => encodeVisualConfigYaml(ambiguous, next, decoded.values, decoded.apiKeysStorage)).toThrow('Payload conflict')
        expect(next.payloadDefaultRules[0]!.models[0]!.name).toBe('three')
    })

    test('rejects invalid YAML before producing visual values', () => {
        expect(() => decodeVisualConfigYaml('plugins: [')).toThrow()
    })
})
