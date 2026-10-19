import type {
    ApiKeyModelRule,
    ApiKeyPolicyLimit,
    CodexLiveICEServerDraft,
    PayloadFilterRule,
    PayloadModelEntry,
    PayloadParamEntry,
    PayloadParamValueType,
    PayloadRule,
    PluginStoreAuthApplyTo,
    PluginStoreAuthRule,
    PluginStoreAuthType,
    VisualConfigValues,
} from '@/types/visualConfig'
import {isApiKeyModelRuleEmpty} from '@/types/visualConfig'
import {rewriteModelMetadataForYaml} from '@/utils/modelMetadata'
import {isAlias, isMap, isScalar, isSeq, parseDocument, stringify as stringifyYaml, type Node, type YAMLMap, type YAMLSeq} from 'yaml'

function asRecord(value: unknown): Record<string, unknown> | null {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return null
    }
    return value as Record<string, unknown>
}

function normalizeBoolean(value: unknown): boolean | undefined {
    if (typeof value === 'boolean') {
        return value
    }
    if (typeof value === 'string') {
        if (['y', 'Y', 'yes', 'Yes', 'YES', 'on', 'On', 'ON'].includes(value)) {
            return true
        }
        if (['n', 'N', 'no', 'No', 'NO', 'off', 'Off', 'OFF'].includes(value)) {
            return false
        }
    }
    return undefined
}

function parseRoutingStrategy(raw: unknown): VisualConfigValues['routingStrategy'] {
    const normalized = String(raw ?? '').trim().toLowerCase()
    if (['weighted-round-robin', 'weightedroundrobin', 'wrr'].includes(normalized)) {
        return 'weighted-round-robin'
    }
    if (['quota-aware', 'quotaaware', 'qa'].includes(normalized)) {
        return 'quota-aware'
    }
    if (['fill-first', 'fillfirst', 'ff'].includes(normalized)) {
        return 'fill-first'
    }
    return 'round-robin'
}

function extractApiKeyValue(raw: unknown): string | null {
    if (typeof raw === 'string') {
        const trimmed = raw.trim()
        return trimmed ? trimmed : null
    }

    const record = asRecord(raw)
    if (!record) {
        return null
    }

    const candidates = [record['api-key'], record.apiKey, record.key, record.Key]
    for (const candidate of candidates) {
        if (typeof candidate === 'string') {
            const trimmed = candidate.trim()
            if (trimmed) {
                return trimmed
            }
        }
    }

    return null
}

function parseApiKeysText(raw: unknown): string {
    if (!Array.isArray(raw)) {
        return ''
    }

    const keys: string[] = []
    for (const item of raw) {
        const key = extractApiKeyValue(item)
        if (key) {
            keys.push(key)
        }
    }
    return keys.join('\n')
}

type YamlDocument = ReturnType<typeof parseDocument>
type YamlPath = string[]

function docHas(doc: YamlDocument, path: YamlPath): boolean {
    return doc.hasIn(path)
}

function ensureMapInDoc(doc: YamlDocument, path: YamlPath): void {
    const existing = doc.getIn(path, true)
    if (isMap(existing)) {
        return
    }
    // Use a YAML node here; plain objects are not treated as collections by subsequent `setIn`.
    doc.setIn(path, doc.createNode({}))
}

function deleteIfMapEmpty(doc: YamlDocument, path: YamlPath): void {
    const value = doc.getIn(path, true)
    if (!isMap(value)) {
        return
    }
    if (value.items.length === 0) {
        doc.deleteIn(path)
    }
}

function setBooleanInDoc(doc: YamlDocument, path: YamlPath, value: boolean): void {
    doc.setIn(path, value)
}

function setStringInDoc(doc: YamlDocument, path: YamlPath, value: unknown): void {
    const safe    = typeof value === 'string' ? value : ''
    const trimmed = safe.trim()
    if (trimmed !== '') {
        doc.setIn(path, safe)
        return
    }
    doc.deleteIn(path)
}

export function parseVisualConfigInteger(value: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number | undefined {
    const trimmed = value.trim()
    if (!trimmed) {
        return undefined
    }
    const number = Number(trimmed)
    if (!/^-?\d+$/.test(trimmed) || !Number.isSafeInteger(number) || number < minimum || number > maximum) {
        throw new Error('Invalid configuration integer: ' + value)
    }
    return number
}

function setIntFromStringInDoc(doc: YamlDocument, path: YamlPath, value: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): void {
    const parsed = parseVisualConfigInteger(value, minimum, maximum)
    if (parsed === undefined) {
        doc.deleteIn(path)
    } else {
        doc.setIn(path, parsed)
    }
}

function yamlBlockToText(value: unknown): string {
    if (value === undefined) {
        return ''
    }
    return stringifyYaml(value).trimEnd()
}

function parseYamlBlockText(value: string): unknown {
    const trimmed = value.trim()
    if (!trimmed) {
        return undefined
    }
    const doc = parseDocument(trimmed)
    if (doc.errors.length > 0) {
        throw new Error(doc.errors[0]?.message ?? 'Invalid YAML block')
    }
    return doc.toJS()
}

function parseConfigDocument(value: string): YamlDocument {
    const doc = parseDocument(value, { intAsBigInt: true })
    if (doc.errors.length > 0) {
        throw new Error(doc.errors[0]?.message ?? 'Invalid YAML')
    }
    return doc
}

function setYamlBlockTextInDoc(doc: YamlDocument, path: YamlPath, value: string): void {
    const parsed = parseYamlBlockText(value)
    if (parsed === undefined) {
        if (docHas(doc, path)) {
            doc.deleteIn(path)
        }
        return
    }
    doc.setIn(path, parsed)
}

function parseStringList(raw: unknown): string[] {
    return Array.isArray(raw) ? raw.map((item) => String(item ?? '').trim()).filter(Boolean) : []
}

function parseLiveICEServers(raw: unknown): CodexLiveICEServerDraft[] {
    if (!Array.isArray(raw)) {
        return []
    }
    return raw.map((item, index) => {
        const server = asRecord(item)
        return {
            id: `ice-${index}`,
            urlsText: Array.isArray(server?.urls) ? server.urls.map((url) => String(url ?? '')).join('\n') : '',
            username: '',
            usernameConfigured: typeof server?.username === 'string' && server.username.length > 0,
            usernameEdited: false,
            credential: '',
            credentialConfigured: typeof server?.credential === 'string' && server.credential.length > 0,
            credentialEdited: false,
        }
    })
}

function areLiveICEServersEqual(left: CodexLiveICEServerDraft[], right: CodexLiveICEServerDraft[]): boolean {
    return left.length === right.length && left.every((server, index) => {
        const other = right[index]
        return server.id === other.id && server.urlsText === other.urlsText &&
               server.username === other.username && server.usernameConfigured === other.usernameConfigured &&
               server.usernameEdited === other.usernameEdited && server.credential === other.credential &&
               server.credentialConfigured === other.credentialConfigured &&
               server.credentialEdited === other.credentialEdited
    })
}

function setStringListInDoc(doc: YamlDocument, path: YamlPath, value: string[]): void {
    const list = value.map((item) => item.trim()).filter(Boolean)
    if (list.length > 0) {
        doc.setIn(path, list)
        return
    }
    if (docHas(doc, path)) {
        doc.deleteIn(path)
    }
}

function syncStringListInDoc(doc: YamlDocument, path: YamlPath, value: string[]): void {
    const list = value.map((item) => item.trim()).filter(Boolean)
    if (list.length === 0) {
        if (docHas(doc, path)) {
            doc.deleteIn(path)
        }
        return
    }

    const existing = doc.getIn(path, true)
    if (!isSeq(existing)) {
        doc.setIn(path, list)
        return
    }

    const nodes = existing.items as Node[]
    const available = nodes.map((node, index) => ({
        index,
        value: isScalar(node) ? String(node.value ?? '').trim() : '',
    }))
    const used = new Set<number>()
    const comments = new Map<Node, string | null | undefined>()
    nodes.forEach((node, index) => {
        comments.set(node, index === 0 ? existing.commentBefore : node.commentBefore)
    })

    const items = list.map((item) => {
        const match = available.find((candidate) =>
            candidate.value === item && !used.has(candidate.index),
        )
        const node = match ? nodes[match.index] : undefined
        if (match) {
            used.add(match.index)
        }
        if (isScalar(node)) {
            node.value = item
            return node
        }
        return doc.createNode(item) as Node
    })

    items.forEach((node) => {
        node.commentBefore = comments.get(node)
    })
    existing.items = items
    existing.commentBefore = items[0]?.commentBefore
    if (items[0]) {
        items[0].commentBefore = undefined
    }
}

const providerConfigKeys = [
    'gemini-api-key',
    'interactions-api-key',
    'codex-api-key',
    'claude-api-key',
    'vertex-api-key',
    'openai-compatibility',
] as const

function normalizeProviderConfigModels(value: unknown): unknown {
    if (!Array.isArray(value)) {
        return value
    }
    return value.map((provider) => {
        const record = asRecord(provider)
        if (!record || !Array.isArray(record.models)) {
            return provider
        }
        return {
            ...record,
            models: record.models.map((model) => rewriteModelMetadataForYaml(model)),
        }
    })
}

function buildProviderConfigText(parsed: Record<string, unknown>): string {
    return yamlBlockToText(Object.fromEntries(
        providerConfigKeys.map((key) => [key, normalizeProviderConfigModels(parsed[key] ?? [])]),
    ))
}

function setProviderConfigTextInDoc(doc: YamlDocument, value: string): void {
    const parsed = parseYamlBlockText(value)
    const record = asRecord(parsed) ?? {}
    providerConfigKeys.forEach((key) => {
        const nextValue = record[key]
        if (nextValue === undefined) {
            doc.setIn([key], [])
        } else {
            doc.setIn([key], normalizeProviderConfigModels(nextValue))
        }
    })
}

function arePayloadModelEntriesEqual(left: PayloadRule['models'], right: PayloadRule['models']): boolean {
    if (left === right) {
        return true
    }
    if (left.length !== right.length) {
        return false
    }
    for (let i = 0; i < left.length; i++) {
        const current = left[i]
        const next    = right[i]
        if (!current || !next) {
            return false
        }
        if (
            current.id !== next.id || current.name !== next.name || current.protocol !== next.protocol ||
            !arePayloadParamEntriesEqual(current.match ?? [], next.match ?? []) ||
            !arePayloadParamEntriesEqual(current.notMatch ?? [], next.notMatch ?? [])
        ) {
            return false
        }
    }
    return true
}

function arePayloadParamEntriesEqual(left: PayloadRule['params'], right: PayloadRule['params']): boolean {
    if (left === right) {
        return true
    }
    if (left.length !== right.length) {
        return false
    }
    for (let i = 0; i < left.length; i++) {
        const current = left[i]
        const next    = right[i]
        if (!current || !next) {
            return false
        }
        if (
            current.id !== next.id ||
            current.path !== next.path ||
            current.valueType !== next.valueType ||
            current.value !== next.value
        ) {
            return false
        }
    }
    return true
}

function areApiKeyRulesEqual(
    left: Record<string, ApiKeyModelRule>,
    right: Record<string, ApiKeyModelRule>,
): boolean {
    const leftKeys  = Object.keys(left).sort()
    const rightKeys = Object.keys(right).sort()
    if (!areStringArraysEqual(leftKeys, rightKeys)) {
        return false
    }
    for (const key of leftKeys) {
        const leftRule  = left[key]
        const rightRule = right[key]
        if (!leftRule || !rightRule) {
            return false
        }
        if (
            !areStringArraysEqual([...leftRule.blockedModels].sort(), [...rightRule.blockedModels].sort()) ||
            !areStringArraysEqual([...leftRule.providers].sort(), [...rightRule.providers].sort()) ||
            !areStringArraysEqual([...leftRule.canonicalModels].sort(), [...rightRule.canonicalModels].sort()) ||
            leftRule.policyProfile !== rightRule.policyProfile ||
            leftRule.reservationTtl !== rightRule.reservationTtl
        ) {
            return false
        }
        const leftMappings  = Object.entries(leftRule.modelMappings).sort(([a], [b]) => a.localeCompare(b))
        const rightMappings = Object.entries(rightRule.modelMappings).sort(([a], [b]) => a.localeCompare(b))
        if (
            leftMappings.length !== rightMappings.length ||
            leftMappings.some(([source, target], index) =>
            source !== rightMappings[index]?.[0] || target !== rightMappings[index]?.[1],
            )
        ) {
            return false
        }
        const sortLimits  = (limits: ApiKeyPolicyLimit[]) => [...limits].sort((a, b) =>
                                                                                  a.window.localeCompare(b.window) ||
                                                                                  a.requests.localeCompare(b.requests) ||
                                                                                  a.tokens.localeCompare(b.tokens) ||
                                                                                  a.costMicro.localeCompare(b.costMicro),
        )
        const leftLimits  = sortLimits(leftRule.limits)
        const rightLimits = sortLimits(rightRule.limits)
        if (
            leftLimits.length !== rightLimits.length ||
            leftLimits.some((limit, index) => {
                const other = rightLimits[index]
                return !other ||
                       limit.window !== other.window ||
                       limit.requests !== other.requests ||
                       limit.tokens !== other.tokens ||
                       limit.costMicro !== other.costMicro
            })
        ) {
            return false
        }
    }
    return true
}

function areStringArraysEqual(left: string[], right: string[]): boolean {
    if (left === right) {
        return true
    }
    if (left.length !== right.length) {
        return false
    }
    for (let i = 0; i < left.length; i++) {
        if (left[i] !== right[i]) {
            return false
        }
    }
    return true
}

function arePluginStoreAuthRulesEqual(left: PluginStoreAuthRule[], right: PluginStoreAuthRule[]): boolean {
    if (left === right) {
        return true
    }
    if (left.length !== right.length) {
        return false
    }
    for (let i = 0; i < left.length; i++) {
        const current = left[i]
        const next    = right[i]
        if (!current || !next) {
            return false
        }
        if (
            current.id !== next.id ||
            current.match !== next.match ||
            current.type !== next.type ||
            current.tokenEnv !== next.tokenEnv ||
            current.usernameEnv !== next.usernameEnv ||
            current.passwordEnv !== next.passwordEnv ||
            current.headerName !== next.headerName ||
            current.headerValueEnv !== next.headerValueEnv ||
            current.allowInsecure !== next.allowInsecure ||
            !areStringArraysEqual(current.applyTo, next.applyTo)
        ) {
            return false
        }
    }
    return true
}

function arePayloadRulesEqual(left: PayloadRule[], right: PayloadRule[]): boolean {
    if (left === right) {
        return true
    }
    if (left.length !== right.length) {
        return false
    }
    for (let i = 0; i < left.length; i++) {
        const current = left[i]
        const next    = right[i]
        if (!current || !next) {
            return false
        }
        if (current.id !== next.id) {
            return false
        }
        if (!arePayloadModelEntriesEqual(current.models, next.models)) {
            return false
        }
        if (!arePayloadParamEntriesEqual(current.params, next.params)) {
            return false
        }
    }
    return true
}

function arePayloadFilterRulesEqual(left: PayloadFilterRule[], right: PayloadFilterRule[]): boolean {
    if (left === right) {
        return true
    }
    if (left.length !== right.length) {
        return false
    }
    for (let i = 0; i < left.length; i++) {
        const current = left[i]
        const next    = right[i]
        if (!current || !next) {
            return false
        }
        if (current.id !== next.id) {
            return false
        }
        if (!arePayloadModelEntriesEqual(current.models, next.models)) {
            return false
        }
        if (current.params.length !== next.params.length) {
            return false
        }
        for (let j = 0; j < current.params.length; j++) {
            if (current.params[j] !== next.params[j]) {
                return false
            }
        }
    }
    return true
}

function areMergeValuesEqual(left: unknown, right: unknown): boolean {
    if (Object.is(left, right)) {
        return true
    }
    if (Array.isArray(left) || Array.isArray(right)) {
        if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
            return false
        }
        return left.every((value, index) => areMergeValuesEqual(value, right[index]))
    }
    const leftRecord  = asRecord(left)
    const rightRecord = asRecord(right)
    if (!leftRecord || !rightRecord) {
        return false
    }
    const leftKeys  = Object.keys(leftRecord)
    const rightKeys = Object.keys(rightRecord)
    return leftKeys.length === rightKeys.length &&
           leftKeys.every((key) => Object.prototype.hasOwnProperty.call(rightRecord, key) &&
               areMergeValuesEqual(leftRecord[key], rightRecord[key]))
}

function mergeVisualChanges(
    current: unknown,
    next: unknown,
    baseline: unknown,
): { value: unknown; baseline: unknown } {
    if (areMergeValuesEqual(next, baseline)) {
        return { value: current, baseline: current }
    }

    const currentRecord  = asRecord(current)
    const nextRecord     = asRecord(next)
    const baselineRecord = asRecord(baseline)
    if (!currentRecord || !nextRecord || !baselineRecord) {
        return { value: next, baseline }
    }

    const value: Record<string, unknown>          = Object.create(null)
    const mergedBaseline: Record<string, unknown> = Object.create(null)
    const keys                                    = new Set([
                                                                ...Object.keys(currentRecord),
                                                                ...Object.keys(nextRecord),
                                                                ...Object.keys(baselineRecord),
                                                            ])
    for (const key of keys) {
        const merged = mergeVisualChanges(
            Object.prototype.hasOwnProperty.call(currentRecord, key) ? currentRecord[key] : undefined,
            Object.prototype.hasOwnProperty.call(nextRecord, key) ? nextRecord[key] : undefined,
            Object.prototype.hasOwnProperty.call(baselineRecord, key) ? baselineRecord[key] : undefined,
        )
        if (merged.value !== undefined) {
            value[key] = merged.value
        }
        if (merged.baseline !== undefined) {
            mergedBaseline[key] = merged.baseline
        }
    }
    return { value, baseline: mergedBaseline }
}

export function areVisualConfigValuesEqual(left: VisualConfigValues, right: VisualConfigValues): boolean {
    return (
        left.host === right.host &&
        left.port === right.port &&
        left.tlsEnable === right.tlsEnable &&
        left.tlsCert === right.tlsCert &&
        left.tlsKey === right.tlsKey &&
        left.tlsHttpRedirectPort === right.tlsHttpRedirectPort &&
        left.tlsRequireForAuth === right.tlsRequireForAuth &&
        left.tlsTrustForwardedProto === right.tlsTrustForwardedProto &&
        left.rmAllowRemote === right.rmAllowRemote &&
        areStringArraysEqual(left.rmTrustedProxies, right.rmTrustedProxies) &&
        left.rmSecretKey === right.rmSecretKey &&
        left.rmDisableControlPanel === right.rmDisableControlPanel &&
        left.rmAutoUpdatePanel === right.rmAutoUpdatePanel &&
        left.rmAutoUpdateCPA === right.rmAutoUpdateCPA &&
        left.rmAutoCheckUpdate === right.rmAutoCheckUpdate &&
        left.rmCheckInterval === right.rmCheckInterval &&
        left.rmPanelRepo === right.rmPanelRepo &&
        left.rmCpaRepo === right.rmCpaRepo &&
        left.authDir === right.authDir &&
        left.usageDataDir === right.usageDataDir &&
        left.usageStatisticsFile === right.usageStatisticsFile &&
        left.pluginsEnabled === right.pluginsEnabled &&
        left.pluginsDir === right.pluginsDir &&
        areStringArraysEqual(left.pluginStoreSources, right.pluginStoreSources) &&
        arePluginStoreAuthRulesEqual(left.pluginStoreAuth, right.pluginStoreAuth) &&
        left.pluginConfigsText === right.pluginConfigsText &&
        left.apiKeysText === right.apiKeysText &&
        left.apiKeyAliasesText === right.apiKeyAliasesText &&
        areApiKeyRulesEqual(left.apiKeyRules, right.apiKeyRules) &&
        left.debug === right.debug &&
        left.commercialMode === right.commercialMode &&
        left.loggingToFile === right.loggingToFile &&
        left.requestLog === right.requestLog &&
        left.pprofEnable === right.pprofEnable &&
        left.pprofAddr === right.pprofAddr &&
        left.logsMaxTotalSizeMb === right.logsMaxTotalSizeMb &&
        left.imageArtifactCacheRetentionDays === right.imageArtifactCacheRetentionDays &&
        left.imageArtifactCacheMaxTotalSizeMb === right.imageArtifactCacheMaxTotalSizeMb &&
        left.errorLogsMaxFiles === right.errorLogsMaxFiles &&
        left.redisUsageQueueRetentionSeconds === right.redisUsageQueueRetentionSeconds &&
        left.usageStatisticsEnabled === right.usageStatisticsEnabled &&
        left.usageRetentionDays === right.usageRetentionDays &&
        left.usageRetentionMaxDbSizeMb === right.usageRetentionMaxDbSizeMb &&
        left.usageRetentionWarningThresholdPct === right.usageRetentionWarningThresholdPct &&
        left.autoRefreshInterval === right.autoRefreshInterval &&
        left.modelRefreshInterval === right.modelRefreshInterval &&
        left.proxyUrl === right.proxyUrl &&
        left.forceModelPrefix === right.forceModelPrefix &&
        left.enableGeminiCliEndpoint === right.enableGeminiCliEndpoint &&
        left.passthroughHeaders === right.passthroughHeaders &&
        left.disableImageGeneration === right.disableImageGeneration &&
        left.gptImage2BaseModel === right.gptImage2BaseModel &&
        left.videoResultAuthCacheTTL === right.videoResultAuthCacheTTL &&
        left.antigravityConnectionPoolEnabled === right.antigravityConnectionPoolEnabled &&
        left.antigravityConnectionPoolIdleTimeout === right.antigravityConnectionPoolIdleTimeout &&
        left.antigravityConnectionPoolMaxIdleConnsPerHost === right.antigravityConnectionPoolMaxIdleConnsPerHost &&
        left.codexLiveMediaRelayEnabled === right.codexLiveMediaRelayEnabled &&
        left.codexLiveMediaRelayMaxSessions === right.codexLiveMediaRelayMaxSessions &&
        left.codexLiveMediaRelayDisablePrivateRemoteIPs === right.codexLiveMediaRelayDisablePrivateRemoteIPs &&
        left.codexLiveMediaRelayPublicIP === right.codexLiveMediaRelayPublicIP &&
        left.codexLiveMediaRelayUDPPortMin === right.codexLiveMediaRelayUDPPortMin &&
        left.codexLiveMediaRelayUDPPortMax === right.codexLiveMediaRelayUDPPortMax &&
        areLiveICEServersEqual(left.codexLiveMediaRelayICEServers, right.codexLiveMediaRelayICEServers) &&
        left.authAutoRefreshWorkers === right.authAutoRefreshWorkers &&
        left.requestRetry === right.requestRetry &&
        left.maxRetryCredentials === right.maxRetryCredentials &&
        left.maxRetryInterval === right.maxRetryInterval &&
        left.quotaSwitchProject === right.quotaSwitchProject &&
        left.quotaSwitchPreviewModel === right.quotaSwitchPreviewModel &&
        left.quotaAntigravityCredits === right.quotaAntigravityCredits &&
        left.disableCooling === right.disableCooling &&
        left.saveCooldownStatus === right.saveCooldownStatus &&
        left.transientErrorCooldownSeconds === right.transientErrorCooldownSeconds &&
        left.quotaRefreshEnabled === right.quotaRefreshEnabled &&
        left.quotaRefreshInterval === right.quotaRefreshInterval &&
        left.quotaRefreshMaxInterval === right.quotaRefreshMaxInterval &&
        left.routingStrategy === right.routingStrategy &&
        left.routingSessionAffinity === right.routingSessionAffinity &&
        left.routingSessionAffinitySubagents === right.routingSessionAffinitySubagents &&
        left.routingSessionAffinityTTL === right.routingSessionAffinityTTL &&
        left.wsAuth === right.wsAuth &&
        areStringArraysEqual(left.antigravitySensitiveWords, right.antigravitySensitiveWords) &&
        areStringArraysEqual(left.devinSensitiveWords, right.devinSensitiveWords) &&
        left.allowQueryAuth === right.allowQueryAuth &&
        left.corsAllowedOrigins === right.corsAllowedOrigins &&
        left.providerConfigText === right.providerConfigText &&
        left.oauthExcludedModelsText === right.oauthExcludedModelsText &&
        left.oauthModelAliasText === right.oauthModelAliasText &&
        left.codexIdentityConfuse === right.codexIdentityConfuse &&
        left.codexOptimizeMultiAgentV2 === right.codexOptimizeMultiAgentV2 &&
        left.codexDisableCloaking === right.codexDisableCloaking &&
        left.codexOrphanDelegationCompatibility === right.codexOrphanDelegationCompatibility &&
        left.claudeDisableCloakMode === right.claudeDisableCloakMode &&
        left.claudeCodeDisableCloakingModelList === right.claudeCodeDisableCloakingModelList &&
        left.claudeModelLevelCooling === right.claudeModelLevelCooling &&
        left.xaiInjectXSearch === right.xaiInjectXSearch &&
        left.codexHeaderDefaultsText === right.codexHeaderDefaultsText &&
        left.claudeHeaderDefaultsText === right.claudeHeaderDefaultsText &&
        left.streaming.keepaliveSeconds === right.streaming.keepaliveSeconds &&
        left.streaming.bootstrapRetries === right.streaming.bootstrapRetries &&
        left.streaming.nonstreamKeepaliveInterval === right.streaming.nonstreamKeepaliveInterval &&
        arePayloadRulesEqual(left.payloadDefaultRules, right.payloadDefaultRules) &&
        arePayloadRulesEqual(left.payloadDefaultRawRules, right.payloadDefaultRawRules) &&
        arePayloadRulesEqual(left.payloadOverrideRules, right.payloadOverrideRules) &&
        arePayloadRulesEqual(left.payloadOverrideRawRules, right.payloadOverrideRawRules) &&
        arePayloadFilterRulesEqual(left.payloadFilterRules, right.payloadFilterRules)
    )
}

export const hasImageArtifactCacheChanges = (
    values: Pick<VisualConfigValues, 'imageArtifactCacheRetentionDays' | 'imageArtifactCacheMaxTotalSizeMb'>,
    baseline: Pick<VisualConfigValues, 'imageArtifactCacheRetentionDays' | 'imageArtifactCacheMaxTotalSizeMb'>,
): boolean =>
    values.imageArtifactCacheRetentionDays !== baseline.imageArtifactCacheRetentionDays ||
    values.imageArtifactCacheMaxTotalSizeMb !== baseline.imageArtifactCacheMaxTotalSizeMb

function parseApiKeyRuleInteger(raw: unknown): string {
    if (typeof raw === 'bigint') {
        return raw.toString()
    }
    if (typeof raw === 'number' && Number.isFinite(raw)) {
        return String(raw)
    }
    return typeof raw === 'string' ? raw.trim() : ''
}

function parseApiKeyPolicyLimits(raw: unknown): ApiKeyPolicyLimit[] {
    if (!Array.isArray(raw)) {
        return []
    }
    return raw.flatMap((item) => {
        const limit = asRecord(item)
        if (!limit) {
            return []
        }
        const parsed: ApiKeyPolicyLimit = {
            window: typeof limit.window === 'string' ? limit.window.trim() : String(limit.window ?? '').trim(),
            requests: parseApiKeyRuleInteger(limit.requests),
            tokens: parseApiKeyRuleInteger(limit.tokens),
            costMicro: parseApiKeyRuleInteger(limit['cost-micro'] ?? limit.costMicro),
        }
        return parsed.window || parsed.requests || parsed.tokens || parsed.costMicro ? [parsed] : []
    })
}

function parseApiKeyRules(raw: unknown): Record<string, ApiKeyModelRule> {
    const rules: Record<string, ApiKeyModelRule> = Object.create(null)
    const record = asRecord(raw)
    if (!record) {
        return rules
    }
    for (const [apiKey, rawRule] of Object.entries(record)) {
        const key  = apiKey.trim()
        const rule = asRecord(rawRule)
        if (!key || !rule) {
            continue
        }
        const mappingsRaw             = asRecord(rule['model-mappings'] ?? rule.modelMappings) ?? {}
        const modelMappings           = Object.fromEntries(
            Object.entries(mappingsRaw)
                  .map(([source, target]) => [source.trim(), String(target ?? '').trim()])
                  .filter(([source, target]) => Boolean(source && target)),
        )
        const parsed: ApiKeyModelRule = {
            blockedModels: parseStringList(rule['blocked-models'] ?? rule.blockedModels),
            providers: parseStringList(rule.providers),
            canonicalModels: parseStringList(rule['canonical-models'] ?? rule.canonicalModels),
            modelMappings,
            policyProfile: typeof (rule['policy-profile'] ?? rule.policyProfile) === 'string'
                           ? String(rule['policy-profile'] ?? rule.policyProfile).trim()
                           : '',
            reservationTtl: typeof (rule['reservation-ttl'] ?? rule.reservationTtl) === 'string'
                            ? String(rule['reservation-ttl'] ?? rule.reservationTtl).trim()
                            : '',
            limits: parseApiKeyPolicyLimits(rule.limits),
        }
        if (!isApiKeyModelRuleEmpty(parsed)) {
            rules[key] = parsed
        }
    }
    return rules
}

function serializeApiKeyRuleInteger(raw: string): number | bigint | string {
    const value = raw.trim()
    if (!/^\d+$/.test(value)) {
        return value
    }
    const integer = BigInt(value)
    return integer <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(integer) : integer
}

function serializeApiKeyRulesForYaml(rules: Record<string, ApiKeyModelRule>): Record<string, unknown> {
    const out: Record<string, unknown> = Object.create(null)
    for (const [apiKey, rule] of Object.entries(rules)) {
        const key = apiKey.trim()
        if (!key || isApiKeyModelRuleEmpty(rule)) {
            continue
        }
        const serialized: Record<string, unknown> = {}
        const blockedModels                       = [
            ...new Set(rule.blockedModels.map((model) => model.trim()).filter(Boolean)),
        ]
        const providers                           = [
            ...new Set(rule.providers.map((provider) => provider.trim())
                           .filter(Boolean)),
        ]
        const canonicalModels                     = [
            ...new Set(rule.canonicalModels.map((model) => model.trim())
                           .filter(Boolean)),
        ]
        const modelMappings                       = Object.fromEntries(
            Object.entries(rule.modelMappings)
                  .map(([source, target]) => [source.trim(), target.trim()])
                  .filter(([source, target]) => Boolean(source && target))
                  .sort(([a], [b]) => a.localeCompare(b)),
        )
        if (blockedModels.length > 0) {
            serialized['blocked-models'] = blockedModels
        }
        if (providers.length > 0) {
            serialized.providers = providers
        }
        if (canonicalModels.length > 0) {
            serialized['canonical-models'] = canonicalModels
        }
        if (Object.keys(modelMappings).length > 0) {
            serialized['model-mappings'] = modelMappings
        }
        if (rule.policyProfile.trim()) {
            serialized['policy-profile'] = rule.policyProfile.trim()
        }
        if (rule.reservationTtl.trim()) {
            serialized['reservation-ttl'] = rule.reservationTtl.trim()
        }
        const limits = rule.limits.flatMap((limit) => {
            const item: Record<string, unknown> = {}
            if (limit.window.trim()) {
                item.window = limit.window.trim()
            }
            if (limit.requests.trim()) {
                item.requests = serializeApiKeyRuleInteger(limit.requests)
            }
            if (limit.tokens.trim()) {
                item.tokens = serializeApiKeyRuleInteger(limit.tokens)
            }
            if (limit.costMicro.trim()) {
                item['cost-micro'] = serializeApiKeyRuleInteger(limit.costMicro)
            }
            return Object.keys(item).length > 0 ? [item] : []
        })
        if (limits.length > 0) {
            serialized.limits = limits
        }
        out[key] = serialized
    }
    return out
}

const PLUGIN_STORE_AUTH_TYPES: PluginStoreAuthType[]       = [
    'none',
    'bearer',
    'basic',
    'header',
    'github-token',
]
const PLUGIN_STORE_AUTH_APPLY_TO: PluginStoreAuthApplyTo[] = ['registry', 'metadata', 'artifact']

function parsePluginStoreAuthType(raw: unknown): PluginStoreAuthType {
    const value = String(raw ?? '').trim().toLowerCase()
    return PLUGIN_STORE_AUTH_TYPES.includes(value as PluginStoreAuthType) ? value as PluginStoreAuthType : 'none'
}

function parsePluginStoreAuthApplyTo(raw: unknown): PluginStoreAuthApplyTo[] {
    return parseStringList(raw)
        .map((item) => item.toLowerCase())
        .filter((item): item is PluginStoreAuthApplyTo =>
                    PLUGIN_STORE_AUTH_APPLY_TO.includes(item as PluginStoreAuthApplyTo),
        )
}

function parsePluginStoreAuthRules(raw: unknown): PluginStoreAuthRule[] {
    if (!Array.isArray(raw)) {
        return []
    }

    return raw
        .map((item, index): PluginStoreAuthRule | null => {
            const record = asRecord(item)
            if (!record) {
                return null
            }
            const match                     = typeof record.match === 'string' ? record.match : ''
            const rule: PluginStoreAuthRule = {
                id: `plugin-store-auth-${index}`,
                match,
                applyTo: parsePluginStoreAuthApplyTo(record['apply-to'] ?? record.apply_to),
                type: parsePluginStoreAuthType(record.type),
                tokenEnv: typeof record['token-env'] === 'string' ? record['token-env'] : '',
                usernameEnv: typeof record['username-env'] === 'string' ? record['username-env'] : '',
                passwordEnv: typeof record['password-env'] === 'string' ? record['password-env'] : '',
                headerName: typeof record['header-name'] === 'string' ? record['header-name'] : '',
                headerValueEnv: typeof record['header-value-env'] === 'string' ? record['header-value-env'] : '',
                allowInsecure: normalizeBoolean(record['allow-insecure'] ?? record.allow_insecure) ?? false,
            }
            return rule.match.trim() ||
                   rule.type !== 'none' ||
                   rule.applyTo.length > 0 ||
                   rule.tokenEnv.trim() ||
                   rule.usernameEnv.trim() ||
                   rule.passwordEnv.trim() ||
                   rule.headerName.trim() ||
                   rule.headerValueEnv.trim() ||
                   rule.allowInsecure
                   ? rule
                   : null
        })
        .filter((rule): rule is PluginStoreAuthRule => Boolean(rule))
}

function serializePluginStoreAuthForYaml(rules: PluginStoreAuthRule[]): Array<Record<string, unknown>> {
    return rules
        .map((rule) => {
            const match = rule.match.trim()
            if (!match) {
                return null
            }
            const item: Record<string, unknown> = {
                match,
                type: rule.type,
            }
            const applyTo                       = rule.applyTo.map((value) => value.trim()).filter(Boolean)
            if (applyTo.length > 0) {
                item['apply-to'] = applyTo
            }
            if (rule.tokenEnv.trim()) {
                item['token-env'] = rule.tokenEnv.trim()
            }
            if (rule.usernameEnv.trim()) {
                item['username-env'] = rule.usernameEnv.trim()
            }
            if (rule.passwordEnv.trim()) {
                item['password-env'] = rule.passwordEnv.trim()
            }
            if (rule.headerName.trim()) {
                item['header-name'] = rule.headerName.trim()
            }
            if (rule.headerValueEnv.trim()) {
                item['header-value-env'] = rule.headerValueEnv.trim()
            }
            if (rule.allowInsecure) {
                item['allow-insecure'] = true
            }
            return item
        })
        .filter((rule): rule is Record<string, unknown> => Boolean(rule))
}

function serializePayloadParamValue(param: PayloadParamEntry): unknown {
    if (param.valueType === 'number') {
        const value = Number(param.value)
        if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) {
            throw new Error('Invalid payload number: ' + param.path)
        }
        return value
    }
    if (param.valueType === 'boolean') {
        if (param.value !== 'true' && param.value !== 'false') {
            throw new Error('Invalid payload boolean: ' + param.path)
        }
        return param.value === 'true'
    }
    if (param.valueType === 'json') {
        try {
            return JSON.parse(param.value)
        } catch {
            throw new Error('Invalid payload JSON: ' + param.path)
        }
    }
    return param.value
}

function parsePayloadParamValue(raw: unknown): { valueType: PayloadParamValueType; value: string } {
    if (typeof raw === 'number' || typeof raw === 'bigint') {
        return { valueType: 'number', value: String(raw) }
    }

    if (typeof raw === 'boolean') {
        return { valueType: 'boolean', value: String(raw) }
    }

    if (raw === null || typeof raw === 'object') {
        try {
            const json = JSON.stringify(raw, null, 2)
            return { valueType: 'json', value: json ?? 'null' }
        } catch {
            return { valueType: 'json', value: String(raw) }
        }
    }

    return { valueType: 'string', value: String(raw ?? '') }
}

function parsePayloadProtocol(raw: unknown): string | undefined {
    if (typeof raw !== 'string') {
        return undefined
    }
    return raw.trim() ? raw : undefined
}

const PAYLOAD_CONDITIONS = {match: 'match', notMatch: 'not-match'} as const

function parsePayloadConditions(raw: unknown, id: string): PayloadParamEntry[] {
    if (raw === null) {
        return []
    }
    if (!Array.isArray(raw)) {
        throw new Error('Invalid payload condition sequence')
    }
    return raw.flatMap((item, index) => {
        const record = asRecord(item)
        if (!record) {
            throw new Error('Invalid payload condition map')
        }
        return Object.entries(record).map(([path, value], fieldIndex) => ({
            id: `${id}-${index}-${fieldIndex}`,
            path,
            ...parsePayloadParamValue(value),
        }))
    })
}

function parsePayloadModel(raw: unknown, id: string): PayloadModelEntry {
    const record  = asRecord(raw)
    const nameRaw = typeof raw === 'string' ? raw : (record?.name ?? record?.id ?? '')
    const name    = typeof nameRaw === 'string' ? nameRaw : String(nameRaw ?? '')
    if (!record) {
        return { id, name }
    }

    const extra = { ...record }
    delete extra.name
    delete extra.protocol
    const model: PayloadModelEntry = {id, name, protocol: parsePayloadProtocol(record.protocol)}
    for (const [property, key] of Object.entries(PAYLOAD_CONDITIONS) as Array<[keyof typeof PAYLOAD_CONDITIONS, string]>) {
        if (record[key] !== undefined) {
            model[property] = parsePayloadConditions(record[key], `${id}-${key}`)
            delete extra[key]
        }
    }
    if (Object.keys(extra).length > 0) {
        model.extra = extra
    }
    return model
}

function serializePayloadModel(model: PayloadModelEntry): Record<string, unknown> {
    const output: Record<string, unknown> = { ...(model.extra ?? {}), name: model.name.trim() }
    if (model.protocol) {
        output.protocol = model.protocol
    } else {
        delete output.protocol
    }
    for (const [property, key] of Object.entries(PAYLOAD_CONDITIONS) as Array<[keyof typeof PAYLOAD_CONDITIONS, string]>) {
        const entries = model[property]
        if (entries !== undefined) {
            const conditions = entries.filter((entry) => entry.path.trim()).map((entry) => ({
                [entry.path]: serializePayloadParamValue(entry),
            }))
            if (conditions.length) {
                output[key] = conditions
            } else {
                delete output[key]
            }
        }
    }
    return output
}

function parsePayloadRules(rules: unknown): PayloadRule[] {
    if (!Array.isArray(rules)) {
        return []
    }

    return rules.map((rule, index) => {
        const record = asRecord(rule) ?? {}

        const modelsRaw = record.models
        const models    = Array.isArray(modelsRaw)
                          ? modelsRaw.map((model, modelIndex) =>
                                              parsePayloadModel(model, `model-${index}-${modelIndex}`),
            )
                          : []

        const paramsRecord = asRecord(record.params)
        const params       = paramsRecord
                             ? Object.entries(paramsRecord).map(([path, value], pIndex) => {
                const parsedValue = parsePayloadParamValue(value)
                return {
                    id: `param-${index}-${pIndex}`,
                    path,
                    valueType: parsedValue.valueType,
                    value: parsedValue.value,
                }
            })
                             : []

        return { id: `payload-rule-${index}`, models, params }
    })
}

function parsePayloadFilterRules(rules: unknown): PayloadFilterRule[] {
    if (!Array.isArray(rules)) {
        return []
    }

    return rules.map((rule, index) => {
        const record = asRecord(rule) ?? {}

        const modelsRaw = record.models
        const models    = Array.isArray(modelsRaw)
                          ? modelsRaw.map((model, modelIndex) =>
                                              parsePayloadModel(model, `filter-model-${index}-${modelIndex}`),
            )
                          : []

        const paramsRaw = record.params
        const params    = Array.isArray(paramsRaw) ? paramsRaw.map(String) : []

        return { id: `payload-filter-rule-${index}`, models, params }
    })
}

type ApiKeysStorageMode = 'legacy' | 'auth-provider'
type ApiKeysEntryMode = 'string' | 'object'

function replaceApiKeyValue(entry: unknown, apiKey: string): unknown {
    const record = asRecord(entry)
    if (!record) {
        return apiKey
    }
    if ('api-key' in record) {
        return { ...record, 'api-key': apiKey }
    }
    if ('apiKey' in record) {
        return { ...record, apiKey }
    }
    if ('key' in record) {
        return { ...record, key: apiKey }
    }
    if ('Key' in record) {
        return { ...record, Key: apiKey }
    }
    return { ...record, 'api-key': apiKey }
}

function parseApiKeysInputText(value: string): string[] {
    return value
        .split('\n')
        .map((key) => key.trim())
        .filter(Boolean)
}

function buildApiKeyEntries(
    apiKeys: string[],
    metadata: ApiKeysStorageMetadata,
): Array<string | Record<string, unknown>> {
    const originals = metadata.originalEntries.map((entry) => ({
        entry,
        key: extractApiKeyValue(entry),
        used: false,
    }))

    return apiKeys.map((apiKey, index) => {
        const exactMatch         = originals.find((original) => !original.used && original.key === apiKey)
        const positionalFallback = originals[index]
        const selected           = exactMatch ??
                                   (positionalFallback && !positionalFallback.used ? positionalFallback : undefined)
        if (selected) {
            selected.used = true
        }
        const originalEntry = selected?.entry
        if (metadata.entryMode === 'object') {
            const replaced = replaceApiKeyValue(originalEntry, apiKey)
            return asRecord(replaced) ?? { 'api-key': apiKey }
        }
        const record = asRecord(originalEntry)
        return record ? { ...record, ...(replaceApiKeyValue(record, apiKey) as Record<string, unknown>) } : apiKey
    })
}

function resolveApiKeysStorage(parsed: Record<string, unknown>): { text: string; metadata: ApiKeysStorageMetadata } {
    const legacyEntries        = Array.isArray(parsed['api-keys']) ? parsed['api-keys'] : []
    const auth                 = asRecord(parsed.auth)
    const providers            = asRecord(auth?.providers)
    const configApiKeyProvider = asRecord(providers?.['config-api-key'])

    if (configApiKeyProvider) {
        const providerEntries = Array.isArray(configApiKeyProvider['api-key-entries'])
                                ? configApiKeyProvider['api-key-entries']
                                : Array.isArray(configApiKeyProvider['api-keys'])
                                  ? configApiKeyProvider['api-keys']
                                  : []
        const providerListKey = Array.isArray(configApiKeyProvider['api-key-entries']) ? 'api-key-entries' : 'api-keys'

        return {
            text: parseApiKeysText(providerEntries),
            metadata: {
                source: 'auth-provider',
                providerListKey,
                entryMode:
                    providerListKey === 'api-key-entries' || providerEntries.some((entry) => Boolean(asRecord(entry)))
                    ? 'object'
                    : 'string',
                originalEntries: providerEntries,
                legacyEntries,
                syncLegacy: legacyEntries.length > 0,
            },
        }
    }

    return {
        text: parseApiKeysText(legacyEntries),
        metadata: {
            source: 'legacy',
            entryMode: legacyEntries.some((entry) => Boolean(asRecord(entry))) ? 'object' : 'string',
            originalEntries: legacyEntries,
            legacyEntries,
            syncLegacy: false,
        },
    }
}

function parseRawPayloadParamValue(raw: unknown): string {
    if (typeof raw === 'string') {
        return raw
    }
    try {
        const json = JSON.stringify(raw, null, 2)
        return json ?? ''
    } catch {
        return String(raw ?? '')
    }
}

function parseRawPayloadRules(rules: unknown): PayloadRule[] {
    if (!Array.isArray(rules)) {
        return []
    }

    return rules.map((rule, index) => {
        const record = asRecord(rule) ?? {}

        const modelsRaw = record.models
        const models    = Array.isArray(modelsRaw)
                          ? modelsRaw.map((model, modelIndex) =>
                                              parsePayloadModel(model, `raw-model-${index}-${modelIndex}`),
            )
                          : []

        const paramsRecord = asRecord(record.params)
        const params       = paramsRecord
                             ? Object.entries(paramsRecord).map(([path, value], pIndex) => ({
                id: `raw-param-${index}-${pIndex}`,
                path,
                valueType: 'json' as const,
                value: parseRawPayloadParamValue(value),
            }))
                             : []

        return { id: `payload-raw-rule-${index}`, models, params }
    })
}

function serializePayloadRulesForYaml(rules: PayloadRule[]): Array<Record<string, unknown>> {
    return rules
        .map((rule) => {
            const models = (rule.models || [])
                .filter((m) => m.name?.trim())
                .map(serializePayloadModel)

            const params: Record<string, unknown> = {}
            for (const param of rule.params || []) {
                if (!param.path?.trim()) {
                    continue
                }
                params[param.path.trim()] = serializePayloadParamValue(param)
            }

            return { models, params }
        })
}

function serializePayloadFilterRulesForYaml(rules: PayloadFilterRule[]): Array<Record<string, unknown>> {
    return rules
        .map((rule) => {
            const models = (rule.models || [])
                .filter((m) => m.name?.trim())
                .map(serializePayloadModel)

            const params = (Array.isArray(rule.params) ? rule.params : [])
                .map((path) => String(path).trim())
                .filter(Boolean)

            return { models, params }
        })
}

function serializeRawPayloadRulesForYaml(rules: PayloadRule[]): Array<Record<string, unknown>> {
    return rules
        .map((rule) => {
            const models = (rule.models || [])
                .filter((m) => m.name?.trim())
                .map(serializePayloadModel)

            const params: Record<string, unknown> = {}
            for (const param of rule.params || []) {
                if (!param.path?.trim()) {
                    continue
                }
                params[param.path.trim()] = param.value
            }

            return { models, params }
        })
}

export type ApiKeysStorageMetadata = {
    source: ApiKeysStorageMode
    providerListKey?: 'api-keys' | 'api-key-entries'
    entryMode: ApiKeysEntryMode
    originalEntries: unknown[]
    legacyEntries: unknown[]
    syncLegacy: boolean
}

export const DEFAULT_API_KEYS_STORAGE_METADATA: ApiKeysStorageMetadata = {
    source: 'legacy',
    entryMode: 'string',
    originalEntries: [],
    legacyEntries: [],
    syncLegacy: false,
}

function arrayWithoutIndex(values: string[], index: number): string[] {
    return values.filter((_, currentIndex) => currentIndex !== index)
}

export function updateApiKeysStorageMetadata(
    metadata: ApiKeysStorageMetadata,
    previousText: string,
    nextText: string,
): ApiKeysStorageMetadata {
    const previousKeys = parseApiKeysInputText(previousText)
    const nextKeys     = parseApiKeysInputText(nextText)
    if (metadata.originalEntries.length !== previousKeys.length) {
        return metadata
    }

    const entries = [...metadata.originalEntries]
    if (nextKeys.length === previousKeys.length) {
        const changed = previousKeys.flatMap((key, index) => key === nextKeys[index] ? [] : [index])
        if (changed.length !== 1) {
            return metadata
        }
        const index    = changed[0]!
        entries[index] = replaceApiKeyValue(entries[index], nextKeys[index]!)
        return { ...metadata, originalEntries: entries }
    }

    if (nextKeys.length === previousKeys.length - 1) {
        const deletedIndex = previousKeys.findIndex((_, index) =>
                                                        arrayWithoutIndex(previousKeys, index).every((
                                                                                                         key,
                                                                                                         nextIndex,
                                                                                                     ) => key ===
                                                                                                          nextKeys[nextIndex]),
        )
        if (deletedIndex < 0) {
            return metadata
        }
        entries.splice(deletedIndex, 1)
        return { ...metadata, originalEntries: entries }
    }

    if (nextKeys.length === previousKeys.length + 1) {
        const insertedIndex = nextKeys.findIndex((_, index) =>
                                                     arrayWithoutIndex(nextKeys, index).every((
                                                                                                  key,
                                                                                                  previousIndex,
                                                                                              ) => key ===
                                                                                                   previousKeys[previousIndex]),
        )
        if (insertedIndex < 0) {
            return metadata
        }
        const apiKey = nextKeys[insertedIndex]!
        entries.splice(insertedIndex, 0, metadata.entryMode === 'object' ? { 'api-key': apiKey } : apiKey)
        return { ...metadata, originalEntries: entries }
    }

    return metadata
}

export function decodeVisualConfigYaml(yamlContent: string, apiKeysSourceYaml: string = yamlContent): {
    values: VisualConfigValues
    apiKeysStorage: ApiKeysStorageMetadata
} {
    const document = parseDocument(yamlContent)
    if (document.errors.length > 0) {
        throw new Error(document.errors[0]?.message ?? 'Invalid YAML')
    }

    const apiKeysDocument = apiKeysSourceYaml === yamlContent ? document : parseDocument(apiKeysSourceYaml)
    if (apiKeysDocument.errors.length > 0) {
        throw new Error(apiKeysDocument.errors[0]?.message ?? 'Invalid YAML')
    }

    const parsedRaw: unknown                                  = document.toJS() || {}
    const parsed                                              = asRecord(parsedRaw) ?? {}
    const apiKeysParsed                                       = asRecord(apiKeysDocument.toJS() || {}) ?? {}
    const apiKeyRulesParsed                                   = docHas(document, ['api-key-rules'])
                                                                ? asRecord(parseDocument(
        yamlContent,
        { intAsBigInt: true },
    ).toJS() || {}) ?? parsed
                                                                : parsed
    const { text: apiKeysText, metadata: nextApiKeysStorage } = resolveApiKeysStorage(apiKeysParsed)
    const tls                                                 = asRecord(parsed.tls)
    const remoteManagement                                    = asRecord(parsed['remote-management'])
    const pprof                                               = asRecord(parsed.pprof)
    const usageRetention                                      = asRecord(parsed['usage-retention'])
    const imageArtifactCache                                  = asRecord(parsed['image-artifact-cache'])
    const quotaExceeded                                       = asRecord(parsed['quota-exceeded'])
    const quotaRefresh                                        = asRecord(parsed['quota-refresh'])
    const plugins                                             = asRecord(parsed.plugins)
    const antigravity                                         = asRecord(parsed.antigravity)
    const antigravityPool                                     = asRecord(antigravity?.['connection-pool'])
    const codexRelay                                          = asRecord(asRecord(parsed.codex)?.['live-media-relay'])
    const devin                                               = asRecord(parsed.devin)
    const routing                                             = asRecord(parsed.routing)
    const payload                                             = asRecord(parsed.payload)
    const streaming                                           = asRecord(parsed.streaming)

    const newValues: VisualConfigValues = {
        host: typeof parsed.host === 'string' ? parsed.host : '',
        port: String(parsed.port ?? ''),

        tlsEnable: normalizeBoolean(tls?.enable) ?? false,
        tlsCert: typeof tls?.cert === 'string' ? tls.cert : '',
        tlsKey: typeof tls?.key === 'string' ? tls.key : '',
        tlsHttpRedirectPort: String(tls?.['http-redirect-port'] ?? ''),
        tlsRequireForAuth: normalizeBoolean(tls?.['require-for-auth']) ?? false,
        tlsTrustForwardedProto: normalizeBoolean(tls?.['trust-forwarded-proto']) ?? false,

        rmAllowRemote: normalizeBoolean(remoteManagement?.['allow-remote']) ?? false,
        rmTrustedProxies: parseStringList(remoteManagement?.['trusted-proxies']),
        rmSecretKey: typeof remoteManagement?.['secret-key'] === 'string' ? remoteManagement['secret-key'] : '',
        rmDisableControlPanel: normalizeBoolean(remoteManagement?.['disable-control-panel']) ?? false,
        rmAutoUpdatePanel: remoteManagement?.['disable-auto-update-panel'] !== undefined
                           ? !(normalizeBoolean(remoteManagement['disable-auto-update-panel']) ?? false)
                           : normalizeBoolean(remoteManagement?.['auto-update-panel']) ?? true,
        rmAutoUpdateCPA: normalizeBoolean(remoteManagement?.['auto-update-cpa']) ?? false,
        rmAutoCheckUpdate: normalizeBoolean(remoteManagement?.['auto-check-update']) ?? false,
        rmCheckInterval: String(remoteManagement?.['check-interval'] ?? ''),
        rmPanelRepo:
            typeof remoteManagement?.['panel-github-repository'] === 'string'
            ? remoteManagement['panel-github-repository']
            : typeof remoteManagement?.['panel-repo'] === 'string'
              ? remoteManagement['panel-repo']
              : '',
        rmCpaRepo:
            typeof remoteManagement?.['cpa-github-repository'] === 'string'
            ? remoteManagement['cpa-github-repository']
            : '',

        authDir: typeof parsed['auth-dir'] === 'string' ? parsed['auth-dir'] : '',
        usageDataDir: typeof parsed['usage-data-dir'] === 'string' ? parsed['usage-data-dir'] : '',
        usageStatisticsFile: typeof parsed['usage-statistics-file'] === 'string' ?
                             parsed['usage-statistics-file'] :
                             '',
        pluginsEnabled: normalizeBoolean(plugins?.enabled) ?? false,
        pluginsDir: typeof plugins?.dir === 'string' ? plugins.dir : 'plugins',
        pluginStoreSources: parseStringList(plugins?.['store-sources']),
        pluginStoreAuth: parsePluginStoreAuthRules(plugins?.['store-auth']),
        pluginConfigsText: yamlBlockToText(plugins?.configs ?? {}),
        apiKeysText,
        apiKeyAliasesText: yamlBlockToText(parsed['api-key-aliases'] ?? {}),
        apiKeyRules: parseApiKeyRules(apiKeyRulesParsed['api-key-rules']),

        debug: normalizeBoolean(parsed.debug) ?? false,
        commercialMode: normalizeBoolean(parsed['commercial-mode']) ?? false,
        loggingToFile: normalizeBoolean(parsed['logging-to-file']) ?? false,
        requestLog: normalizeBoolean(parsed['request-log']) ?? false,
        pprofEnable: normalizeBoolean(pprof?.enable) ?? false,
        pprofAddr: typeof pprof?.addr === 'string' ? pprof.addr : '',
        logsMaxTotalSizeMb: String(parsed['logs-max-total-size-mb'] ?? ''),
        imageArtifactCacheRetentionDays: String(imageArtifactCache?.['retention-days'] ?? ''),
        imageArtifactCacheMaxTotalSizeMb: String(imageArtifactCache?.['max-total-size-mb'] ?? ''),
        errorLogsMaxFiles: String(parsed['error-logs-max-files'] ?? ''),
        redisUsageQueueRetentionSeconds: String(parsed['redis-usage-queue-retention-seconds'] ?? ''),
        usageStatisticsEnabled: normalizeBoolean(parsed['usage-statistics-enabled']) ?? false,
        usageRetentionDays: String(usageRetention?.days ?? ''),
        usageRetentionMaxDbSizeMb: String(usageRetention?.['max-db-size-mb'] ?? ''),
        usageRetentionWarningThresholdPct: String(usageRetention?.['warning-threshold-pct'] ?? ''),
        autoRefreshInterval: String(parsed['auto-refresh-interval'] ?? ''),
        modelRefreshInterval: String(parsed['model-refresh-interval'] ?? ''),

        proxyUrl: typeof parsed['proxy-url'] === 'string' ? parsed['proxy-url'] : '',
        forceModelPrefix: normalizeBoolean(parsed['force-model-prefix']) ?? false,
        enableGeminiCliEndpoint: normalizeBoolean(parsed['enable-gemini-cli-endpoint']) ?? false,
        passthroughHeaders: normalizeBoolean(parsed['passthrough-headers']) ?? false,
        disableImageGeneration: parsed['disable-image-generation'] ===
                                'all' ||
                                parsed['disable-image-generation'] ===
                                'chat' ||
                                parsed['disable-image-generation'] ===
                                'passthrough'
                                ? parsed['disable-image-generation']
                                : 'off',
        gptImage2BaseModel: typeof parsed['gpt-image-2-base-model'] === 'string' ?
                            parsed['gpt-image-2-base-model'] :
                            '',
        videoResultAuthCacheTTL: typeof parsed['video-result-auth-cache-ttl'] === 'string'
                                 ? parsed['video-result-auth-cache-ttl'] : '',
        antigravityConnectionPoolEnabled: normalizeBoolean(antigravityPool?.enabled) ?? false,
        antigravityConnectionPoolIdleTimeout: String(antigravityPool?.['idle-conn-timeout'] ?? ''),
        antigravityConnectionPoolMaxIdleConnsPerHost: String(antigravityPool?.['max-idle-conns-per-host'] ?? ''),
        codexLiveMediaRelayEnabled: normalizeBoolean(codexRelay?.enabled) ?? false,
        codexLiveMediaRelayMaxSessions: String(codexRelay?.['max-sessions'] ?? ''),
        codexLiveMediaRelayDisablePrivateRemoteIPs: normalizeBoolean(codexRelay?.['disable-private-remote-ips']) ?? false,
        codexLiveMediaRelayPublicIP: typeof codexRelay?.['public-ip'] === 'string' ? codexRelay['public-ip'] : '',
        codexLiveMediaRelayUDPPortMin: String(codexRelay?.['udp-port-min'] ?? ''),
        codexLiveMediaRelayUDPPortMax: String(codexRelay?.['udp-port-max'] ?? ''),
        codexLiveMediaRelayICEServers: parseLiveICEServers(codexRelay?.['ice-servers']),
        authAutoRefreshWorkers: String(parsed['auth-auto-refresh-workers'] ?? ''),
        requestRetry: String(parsed['request-retry'] ?? ''),
        maxRetryCredentials: String(parsed['max-retry-credentials'] ?? ''),
        maxRetryInterval: String(parsed['max-retry-interval'] ?? ''),
        wsAuth: normalizeBoolean(parsed['ws-auth']) ?? true,
        antigravitySensitiveWords: parseStringList(antigravity?.['sensitive-words']),
        devinSensitiveWords: parseStringList(devin?.['sensitive-words']),
        allowQueryAuth: normalizeBoolean(parsed['allow-query-auth']) ?? false,
        corsAllowedOrigins: Array.isArray(parsed['cors-allowed-origins'])
                            ? (parsed['cors-allowed-origins'] as string[]).join(', ')
                            : '',
        providerConfigText: buildProviderConfigText(parsed),
        oauthExcludedModelsText: yamlBlockToText(parsed['oauth-excluded-models'] ?? {}),
        oauthModelAliasText: yamlBlockToText(parsed['oauth-model-alias'] ?? {}),
        codexIdentityConfuse: normalizeBoolean(asRecord(parsed.codex)?.['identity-confuse']) ?? false,
        codexOptimizeMultiAgentV2: normalizeBoolean(asRecord(parsed.codex)?.['optimize-multi-agent-v2']) ?? false,
        codexDisableCloaking: normalizeBoolean(asRecord(parsed.codex)?.['disable-codex-cloaking']) ?? false,
        codexOrphanDelegationCompatibility: normalizeBoolean(
            asRecord(parsed.codex)?.['orphan-delegation-compatibility']) ?? false,
        claudeDisableCloakMode: normalizeBoolean(parsed['disable-claude-cloak-mode']) ?? false,
        claudeCodeDisableCloakingModelList: normalizeBoolean(
            asRecord(parsed['claude-code'])?.['disable-cloaking-model-list']) ?? false,
        claudeModelLevelCooling: normalizeBoolean(asRecord(parsed.claude)?.['model-level-cooling']) ?? false,
        xaiInjectXSearch: normalizeBoolean(asRecord(parsed.xai)?.['inject-x-search']) ?? false,
        codexHeaderDefaultsText: yamlBlockToText(parsed['codex-header-defaults'] ?? {}),
        claudeHeaderDefaultsText: yamlBlockToText(parsed['claude-header-defaults'] ?? {}),

        quotaSwitchProject: normalizeBoolean(quotaExceeded?.['switch-project']) ?? false,
        quotaSwitchPreviewModel: normalizeBoolean(quotaExceeded?.['switch-preview-model']) ?? false,
        quotaAntigravityCredits: normalizeBoolean(quotaExceeded?.['antigravity-credits']) ?? false,
        disableCooling: normalizeBoolean(parsed['disable-cooling']) ?? false,
        saveCooldownStatus: normalizeBoolean(parsed['save-cooldown-status']) ?? false,
        transientErrorCooldownSeconds: String(parsed['transient-error-cooldown-seconds'] ?? ''),
        quotaRefreshEnabled: normalizeBoolean(quotaRefresh?.enabled) ?? false,
        quotaRefreshInterval: String(quotaRefresh?.interval ?? ''),
        quotaRefreshMaxInterval: String(quotaRefresh?.['max-interval'] ?? ''),

        routingStrategy: parseRoutingStrategy(routing?.strategy),
        routingSessionAffinity:
            normalizeBoolean(
            routing?.['session-affinity'] ?? routing?.sessionAffinity ?? routing?.['sessionAffinity'],
            ) ?? false,
        routingSessionAffinitySubagents: normalizeBoolean(routing?.['session-affinity-subagents']) ?? true,
        routingSessionAffinityTTL:
            typeof routing?.['session-affinity-ttl'] === 'string'
            ? routing['session-affinity-ttl']
            : typeof routing?.sessionAffinityTTL === 'string'
              ? routing.sessionAffinityTTL
              : '',

        payloadDefaultRules: parsePayloadRules(payload?.default),
        payloadDefaultRawRules: parseRawPayloadRules(payload?.['default-raw']),
        payloadOverrideRules: parsePayloadRules(payload?.override),
        payloadOverrideRawRules: parseRawPayloadRules(payload?.['override-raw']),
        payloadFilterRules: parsePayloadFilterRules(payload?.filter),

        streaming: {
            keepaliveSeconds: String(streaming?.['keepalive-seconds'] ?? ''),
            bootstrapRetries: String(streaming?.['bootstrap-retries'] ?? ''),
            nonstreamKeepaliveInterval: String(
                parsed['nonstream-keepalive-interval'] ?? streaming?.['nonstream-keepalive-interval'] ?? '',
            ),
        },
    }
    const exactDocument = parseConfigDocument(yamlContent)
    for (const [field, section] of Object.entries(PAYLOAD_FIELDS)) {
        const rules = newValues[field as keyof typeof PAYLOAD_FIELDS]
        rules.forEach((rule, index) => {
            const node = exactDocument.getIn(['payload', section, index], true)
            rule.sourceYaml = stringifyYaml(node, {verifyAliasOrder: false})
            rule.models.forEach((model, modelIndex) => {
                const original = exactDocument.getIn(['payload', section, index, 'models', modelIndex], true)
                model.sourceYaml = stringifyYaml(original, {verifyAliasOrder: false})
                const modelNode = isAlias(original) ? original.resolve(exactDocument) : original
                for (const [property, key] of Object.entries(PAYLOAD_CONDITIONS) as Array<[keyof typeof PAYLOAD_CONDITIONS, string]>) {
                    const sequence = isMap(modelNode) ? modelNode.get(key, true) : undefined
                    if (isSeq(sequence)) {
                        const nodes = payloadConditionNodes(exactDocument, sequence)
                        model[property]?.forEach((entry, entryIndex) => {
                            entry.sourceYaml = stringifyYaml(nodes[entryIndex], {verifyAliasOrder: false})
                        })
                    }
                }
            })
        })
    }
    for (const [field, contract] of Object.entries(VISUAL_INTEGER_FIELDS)) {
        const node = exactDocument.getIn(contract.path, true)
        if (isScalar(node) && typeof node.value === 'bigint') {
            if (field.startsWith('streaming.')) {
                newValues.streaming[field.slice('streaming.'.length) as keyof VisualConfigValues['streaming']] = String(node.value)
            } else {
                Object.assign(newValues, { [field]: String(node.value) })
            }
        }
    }
    return { values: newValues, apiKeysStorage: nextApiKeysStorage }
}

export const VISUAL_INTEGER_FIELDS: Record<string, { path: string[]; minimum: number; maximum: number }> = {
    port: { path: ['port'], minimum: 1, maximum: 65535 },
    tlsHttpRedirectPort: { path: ['tls', 'http-redirect-port'], minimum: 0, maximum: 65535 },
    rmCheckInterval: { path: ['remote-management', 'check-interval'], minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    logsMaxTotalSizeMb: { path: ['logs-max-total-size-mb'], minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    imageArtifactCacheRetentionDays: { path: ['image-artifact-cache', 'retention-days'], minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    imageArtifactCacheMaxTotalSizeMb: { path: ['image-artifact-cache', 'max-total-size-mb'], minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    errorLogsMaxFiles: { path: ['error-logs-max-files'], minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    redisUsageQueueRetentionSeconds: { path: ['redis-usage-queue-retention-seconds'], minimum: 1, maximum: 3600 },
    usageRetentionDays: { path: ['usage-retention', 'days'], minimum: -1, maximum: Number.MAX_SAFE_INTEGER },
    usageRetentionMaxDbSizeMb: { path: ['usage-retention', 'max-db-size-mb'], minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    usageRetentionWarningThresholdPct: { path: ['usage-retention', 'warning-threshold-pct'], minimum: 0, maximum: 100 },
    autoRefreshInterval: { path: ['auto-refresh-interval'], minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    modelRefreshInterval: { path: ['model-refresh-interval'], minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    requestRetry: { path: ['request-retry'], minimum: 0, maximum: 2147483647 },
    maxRetryCredentials: { path: ['max-retry-credentials'], minimum: Number.MIN_SAFE_INTEGER, maximum: 2147483647 },
    maxRetryInterval: { path: ['max-retry-interval'], minimum: -9223372036, maximum: 9223372036 },
    transientErrorCooldownSeconds: { path: ['transient-error-cooldown-seconds'], minimum: Number.MIN_SAFE_INTEGER, maximum: 9223372036 },
    authAutoRefreshWorkers: { path: ['auth-auto-refresh-workers'], minimum: Number.MIN_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER },
    antigravityConnectionPoolMaxIdleConnsPerHost: { path: ['antigravity', 'connection-pool', 'max-idle-conns-per-host'], minimum: Number.MIN_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER },
    codexLiveMediaRelayMaxSessions: { path: ['codex', 'live-media-relay', 'max-sessions'], minimum: Number.MIN_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER },
    codexLiveMediaRelayUDPPortMin: { path: ['codex', 'live-media-relay', 'udp-port-min'], minimum: 0, maximum: 65535 },
    codexLiveMediaRelayUDPPortMax: { path: ['codex', 'live-media-relay', 'udp-port-max'], minimum: 0, maximum: 65535 },
    quotaRefreshInterval: { path: ['quota-refresh', 'interval'], minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    quotaRefreshMaxInterval: { path: ['quota-refresh', 'max-interval'], minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    'streaming.keepaliveSeconds': { path: ['streaming', 'keepalive-seconds'], minimum: Number.MIN_SAFE_INTEGER, maximum: 9223372036 },
    'streaming.bootstrapRetries': { path: ['streaming', 'bootstrap-retries'], minimum: Number.MIN_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER },
    'streaming.nonstreamKeepaliveInterval': { path: ['nonstream-keepalive-interval'], minimum: Number.MIN_SAFE_INTEGER, maximum: 9223372036 },
}

export function integerFieldValue(values: VisualConfigValues, field: string): string {
    if (field.startsWith('streaming.')) {
        return values.streaming[field.slice('streaming.'.length) as keyof VisualConfigValues['streaming']]
    }
    return values[field as keyof VisualConfigValues] as string
}

const PAYLOAD_FIELDS = {
    payloadDefaultRules: 'default',
    payloadDefaultRawRules: 'default-raw',
    payloadOverrideRules: 'override',
    payloadOverrideRawRules: 'override-raw',
    payloadFilterRules: 'filter',
} as const

type EditablePayloadRule = PayloadRule | PayloadFilterRule

function payloadConditionNodes(doc: YamlDocument, sequence: YAMLSeq): YAMLMap[] {
    return sequence.items.flatMap((item, index) => {
        const original = isAlias(item) ? item.resolve(doc) : item
        if (!isMap(original)) {
            throw new Error('Invalid payload condition map')
        }
        return Object.keys(original.toJS(doc)).map((key) => {
            const node = original.clone() as YAMLMap
            const pairIndex = node.items.findIndex((pair) => isScalar(pair.key) && String(pair.key.value) === key)
            if (pairIndex < 0) {
                throw new Error('Invalid payload condition path')
            }
            const first = pairIndex === 0
            node.commentBefore = first
                ? [index === 0 ? sequence.commentBefore : undefined, node.commentBefore].filter(Boolean).join('\n') || undefined
                : undefined
            node.comment = pairIndex === node.items.length - 1 ? node.comment : undefined
            node.spaceBefore = first ? node.spaceBefore : undefined
            node.anchor = undefined
            node.items = [node.items[pairIndex]!]
            return node
        })
    })
}

function payloadModelIdentity(model: PayloadModelEntry): unknown {
    const conditions = (entries: PayloadParamEntry[] | undefined) => (entries ?? []).map(({path, valueType, value}) => ({path, valueType, value}))
    return {
        name: model.name, protocol: model.protocol ?? '', extra: model.extra ?? {},
        match: conditions(model.match), notMatch: conditions(model.notMatch),
    }
}

function payloadRuleIdentity(rule: EditablePayloadRule): unknown {
    return rule.models.map(payloadModelIdentity)
}

function payloadConflict(section: string): never {
    throw new Error(`Payload conflict: ${section}; reload and reconcile the changed rules`)
}

function syncPayloadSequence<T extends { id: string; sourceYaml?: string }>(
    sequence: YAMLSeq,
    current: T[],
    baseline: T[],
    desired: T[],
    identity: (entry: T) => unknown,
    update: (node: Node | undefined, prior: T | undefined, entry: T) => Node,
    section: string,
    distinguish?: (entry: T, prior: T) => boolean,
): void {
    const nodes = sequence.items as Node[]
    const priorById = new Map(baseline.map((entry) => [entry.id, entry]))
    const desiredById = new Map(desired.map((entry) => [entry.id, entry]))
    if (desiredById.size !== desired.length || nodes.length !== current.length) {
        payloadConflict(section)
    }
    const sameSource = (entry: T, prior: T) => prior.sourceYaml !== undefined
        ? entry.sourceYaml === prior.sourceYaml
        : areMergeValuesEqual(identity(entry), identity(prior)) && (!distinguish || distinguish(entry, prior))
    const originalEntries = current.flatMap((entry, index) =>
        baseline.some((prior) => sameSource(entry, prior)) ? [{entry, index}] : [],
    )
    const unchanged = originalEntries.length === baseline.length && baseline.every((prior, index) =>
        sameSource(originalEntries[index]!.entry, prior),
    )
    const matched = new Map<string, Node>()
    const owner = new Map<Node, string>()
    for (const [priorIndex, prior] of baseline.entries()) {
        let candidates = current.flatMap((entry, index) =>
            areMergeValuesEqual(identity(entry), identity(prior)) ? [index] : [],
        )
        if (candidates.length > 1 && unchanged) {
            candidates = candidates.filter((index) => index === originalEntries[priorIndex]!.index)
        }
        if (candidates.length > 1 && prior.sourceYaml !== undefined) {
            const exact = candidates.filter((index) => current[index]!.sourceYaml === prior.sourceYaml)
            if (exact.length) {
                candidates = exact
            }
        }
        if (candidates.length > 1 && distinguish) {
            candidates = candidates.filter((index) => distinguish(current[index]!, prior))
        }
        if (candidates.length === 0) {
            const next = desiredById.get(prior.id)
            if (!next || areMergeValuesEqual(next, prior)) {
                continue
            }
        }
        if (candidates.length !== 1) {
            payloadConflict(section)
        }
        const node = nodes[candidates[0]!]!
        if (!node || owner.has(node)) {
            payloadConflict(section)
        }
        matched.set(prior.id, node)
        owner.set(node, prior.id)
    }
    const updated = new Map<string, Node>()
    for (const entry of desired) {
        const prior = priorById.get(entry.id)
        const node = matched.get(entry.id)
        if (prior && !node) {
            continue
        }
        updated.set(entry.id, node && areMergeValuesEqual(prior, entry) ? node : update(node, prior, entry))
    }
    const retained = baseline.filter((entry) => desiredById.has(entry.id) && matched.has(entry.id)).map((entry) => entry.id)
    const desiredOrder = desired.filter((entry) => matched.has(entry.id)).map((entry) => entry.id)
    const currentOrder = nodes.flatMap((node) => {
        const id = owner.get(node)
        return id !== undefined && desiredById.has(id) ? [id] : []
    })
    const reordered = !areStringArraysEqual(retained, desiredOrder)
    if (reordered && !areStringArraysEqual(currentOrder, retained) && !areStringArraysEqual(currentOrder, desiredOrder)) {
        payloadConflict(section)
    }
    let position = 0
    const result = nodes.flatMap((node) => {
        const id = owner.get(node)
        if (id === undefined) {
            return [node]
        }
        if (!updated.has(id)) {
            return []
        }
        return [updated.get(reordered ? desiredOrder[position++]! : id)!]
    })
    for (let i = 0; i < desired.length; i++) {
        const entry = desired[i]!
        if (priorById.has(entry.id)) {
            continue
        }
        const next = desired.slice(i + 1).find((candidate) => result.includes(updated.get(candidate.id)!))
        const index = next ? result.indexOf(updated.get(next.id)!) : result.length
        result.splice(index, 0, updated.get(entry.id)!)
    }
    if (nodes[0] && sequence.commentBefore) {
        nodes[0].commentBefore = [sequence.commentBefore, nodes[0].commentBefore].filter(Boolean).join('\n')
        sequence.commentBefore = undefined
    }
    sequence.items = result
}

function syncPayloadConditions(
    doc: YamlDocument,
    model: YAMLMap,
    key: string,
    baseline: PayloadParamEntry[],
    desired: PayloadParamEntry[],
    section: string,
): void {
    if (arePayloadParamEntriesEqual(baseline, desired)) {
        return
    }
    const previous = model.get(key, true)
    const sequence = isSeq(previous) ? previous : doc.createNode([])
    if (!isSeq(previous) && baseline.length) {
        payloadConflict(section)
    }
    const nodes = payloadConditionNodes(doc, sequence)
    const current = parsePayloadConditions(sequence.toJS(doc), 'current').map((entry, index) => ({
        ...entry, sourceYaml: stringifyYaml(nodes[index], {verifyAliasOrder: false}),
    }))
    sequence.items = nodes
    sequence.commentBefore = undefined
    syncPayloadSequence(sequence, current, baseline, desired.filter((entry) => entry.path.trim()),
        ({path, valueType, value}) => ({path, valueType, value}),
        (node, prior, entry) => {
            if (!isMap(node) || !prior) {
                return doc.createNode({[entry.path]: serializePayloadParamValue(entry)})
            }
            const pair = node.items[0]!
            if (isScalar(pair.key)) {
                pair.key.value = entry.path
            }
            if (prior.valueType !== entry.valueType || prior.value !== entry.value) {
                const value = serializePayloadParamValue(entry)
                if (isScalar(pair.value) && (value === null || typeof value !== 'object')) {
                    pair.value.value = value
                    pair.value.tag = undefined
                    pair.value.format = undefined
                } else {
                    const replacement = doc.createNode(value)
                    const previousValue = pair.value as Node | null
                    replacement.comment = previousValue?.comment
                    replacement.commentBefore = previousValue?.commentBefore
                    pair.value = replacement
                }
            }
            return node
        }, section)
    if (sequence.items.length) {
        model.set(key, sequence)
    } else {
        model.delete(key)
    }
}

function syncPayloadModels(doc: YamlDocument, node: Node, baseline: PayloadModelEntry[], desired: PayloadModelEntry[], section: string): void {
    if (arePayloadModelEntriesEqual(baseline, desired)) {
        return
    }
    if (!isMap(node)) {
        payloadConflict(section)
    }
    let sequence: unknown = node.get('models', true)
    if (!isSeq(sequence)) {
        if (baseline.length) {
            payloadConflict(section)
        }
        sequence = doc.createNode([])
        node.set('models', sequence)
    }
    const seq = sequence as YAMLSeq
    const current = seq.items.map((model, index) => ({
        ...parsePayloadModel((model as Node)?.toJS(doc), `current-${index}`),
        sourceYaml: stringifyYaml(model, {verifyAliasOrder: false}),
    }))
    syncPayloadSequence(seq, current, baseline, desired, payloadModelIdentity, (existing, prior, model) => {
        if (isAlias(existing)) {
            const resolved = existing.resolve(doc)
            if (!resolved) {
                payloadConflict(section)
            }
            const replacement = resolved.clone() as Node
            if (isScalar(replacement) || isMap(replacement) || isSeq(replacement)) {
                replacement.anchor = undefined
            }
            existing = replacement
        }
        if (!existing || !prior) {
            return doc.createNode(serializePayloadModel(model))
        }
        if (!isMap(existing) && (
            model.protocol !== prior.protocol ||
            !arePayloadParamEntriesEqual(prior.match ?? [], model.match ?? []) ||
            !arePayloadParamEntriesEqual(prior.notMatch ?? [], model.notMatch ?? [])
        )) {
            const replacement = doc.createNode(serializePayloadModel(model))
            replacement.comment = existing.comment
            replacement.commentBefore = existing.commentBefore
            return replacement
        }
        if (model.name !== prior.name) {
            if (isScalar(existing)) {
                existing.value = model.name
            } else if (isMap(existing)) {
                existing.set(existing.has('name') ? 'name' : existing.has('id') ? 'id' : 'name', model.name)
            }
        }
        if (isMap(existing)) {
            if (model.protocol !== prior.protocol) {
                if (model.protocol) {
                    existing.set('protocol', model.protocol)
                } else {
                    existing.delete('protocol')
                }
            }
            for (const [property, key] of Object.entries(PAYLOAD_CONDITIONS) as Array<[keyof typeof PAYLOAD_CONDITIONS, string]>) {
                syncPayloadConditions(doc, existing, key, prior[property] ?? [], model[property] ?? [], section)
            }
        }
        return existing
    }, section)
}

function syncPayloadRules(
    doc: YamlDocument,
    section: string,
    current: EditablePayloadRule[],
    baseline: EditablePayloadRule[],
    desired: EditablePayloadRule[],
    baselineSequence?: YAMLSeq,
): void {
    ensureMapInDoc(doc, ['payload'])
    let sequence = doc.getIn(['payload', section], true)
    if (!isSeq(sequence)) {
        if (sequence !== undefined) {
            payloadConflict(section)
        }
        sequence = doc.createNode([])
        doc.setIn(['payload', section], sequence)
    }
    const priorIds = new Set(baseline.map((rule) => rule.id))
    const rules = desired.filter((rule) => priorIds.has(rule.id) || rule.models.some((model) => model.name.trim()))
    if (baselineSequence) {
        const retainedIds = new Set(rules.map((rule) => rule.id))
        const nodes = (sequence as YAMLSeq).items as Node[]
        for (const [index, prior] of baseline.entries()) {
            if (retainedIds.has(prior.id)) {
                continue
            }
            const original = baselineSequence.items[index] as Node | undefined
            if (!original) {
                payloadConflict(section)
            }
            const matches = current.flatMap((entry, currentIndex) =>
                areMergeValuesEqual(payloadRuleIdentity(entry), payloadRuleIdentity(prior)) ? [currentIndex] : [])
            if (matches.length && matches.filter((currentIndex) =>
                areMergeValuesEqual(nodes[currentIndex]?.toJSON(), original.toJSON())).length !== 1) {
                payloadConflict(section)
            }
        }
    }
    const serialize = (rule: EditablePayloadRule) => section === 'filter'
        ? serializePayloadFilterRulesForYaml([rule as PayloadFilterRule])[0]!
        : section.endsWith('-raw')
          ? serializeRawPayloadRulesForYaml([rule as PayloadRule])[0]!
          : serializePayloadRulesForYaml([rule as PayloadRule])[0]!
    syncPayloadSequence(sequence as YAMLSeq, current, baseline, rules, payloadRuleIdentity, (existing, prior, rule) => {
        if (!existing || !prior) {
            return doc.createNode(serialize(rule))
        }
        if (!isMap(existing)) {
            payloadConflict(section)
        }
        syncPayloadModels(doc, existing, prior.models, rule.models, section)
        if (areMergeValuesEqual(prior.params, rule.params)) {
            return existing
        }
        if (section === 'filter') {
            const previous = existing.get('params', true)
            const params = isSeq(previous) ? previous : doc.createNode([])
            const priorParams = (prior.params as string[]).map((value, index) => ({id: `prior-${index}`, value}))
            const currentParams = params.items.map((item, index) => ({id: `current-${index}`, value: String((item as Node)?.toJSON())}))
            const added = (rule.params as string[]).filter((value) => !priorParams.some((entry) => entry.value === value))
            for (const value of new Set(prior.params as string[])) {
                const count = priorParams.filter((entry) => entry.value === value).length
                const retained = (rule.params as string[]).filter((entry) => entry === value).length
                if (count > 1 && retained > 0 && retained !== count) {
                    payloadConflict(section)
                }
                const current = currentParams.filter((entry) => entry.value === value).length
                if (retained < count && current < count && added.some((entry) =>
                    !currentParams.some((param) => param.value === entry))) {
                    payloadConflict(section)
                }
            }
            const remaining = [...priorParams]
            const next = (rule.params as string[]).map((value, index) => {
                const match = remaining.findIndex((entry) => entry.value === value)
                return match < 0 ? {id: `added-${index}`, value} : remaining.splice(match, 1)[0]!
            })
            syncPayloadSequence(params, currentParams, priorParams, next, (entry) => entry.value,
                (node, _prior, entry) => node ?? doc.createNode(entry.value), section)
            if (!isSeq(previous)) {
                existing.set('params', params)
            }
            return existing
        }
        const previousParams = existing.get('params', true)
        const params: YAMLMap = isMap(previousParams) ? previousParams : doc.createNode({})
        const firstKey = params.items[0]?.key
        if (params.commentBefore && isScalar(firstKey)) {
            firstKey.commentBefore = [params.commentBefore, firstKey.commentBefore].filter(Boolean).join('\n')
            params.commentBefore = undefined
        }
        if (!isMap(previousParams)) {
            existing.set('params', params)
        }
        const priorParams = (prior as PayloadRule).params
        const nextParams = (rule as PayloadRule).params.filter((entry) => entry.path.trim())
        const nextIds = new Set(nextParams.map((entry) => entry.id))
        const serialized = serialize(rule).params as Record<string, unknown>
        const keys = nextParams.map((entry) => entry.path.trim())
        if (new Set(keys).size !== keys.length) {
            payloadConflict(section)
        }
        const pairs = new Map(priorParams.map((entry) => [entry.id, params.items.find((pair) => isScalar(pair.key) && String(pair.key.value) === entry.path.trim())]))
        const currentValue = (pair: YAMLMap['items'][number] | undefined) => section.endsWith('-raw')
            ? {valueType: 'json', value: parseRawPayloadParamValue((pair?.value as Node | null)?.toJSON())}
            : parsePayloadParamValue((pair?.value as Node | null)?.toJSON())
        for (const entry of priorParams) {
            if (!nextIds.has(entry.id)) {
                const pair = pairs.get(entry.id)
                if (pair && !areMergeValuesEqual(currentValue(pair), {valueType: entry.valueType, value: entry.value})) {
                    payloadConflict(section)
                }
                params.delete(entry.path.trim())
            }
        }
        for (const entry of nextParams) {
            const previous = priorParams.find((candidate) => candidate.id === entry.id)
            if (areMergeValuesEqual(previous, entry)) {
                continue
            }
            const pair = pairs.get(entry.id)
            const key = entry.path.trim()
            if (pair && previous &&
                (previous.valueType !== entry.valueType || previous.value !== entry.value) &&
                !areMergeValuesEqual(currentValue(pair), {valueType: previous.valueType, value: previous.value}) &&
                !areMergeValuesEqual(currentValue(pair), {valueType: entry.valueType, value: entry.value})) {
                payloadConflict(section)
            }
            if (pair) {
                if (previous?.path.trim() !== key && params.has(key)) {
                    payloadConflict(section)
                }
                if (isScalar(pair.key)) {
                    pair.key.value = key
                }
                if (previous?.valueType === entry.valueType && previous.value === entry.value) {
                    continue
                }
                const value = serialized[key]
                if (isScalar(pair.value) && (value === null || typeof value !== 'object')) {
                    pair.value.value = value
                    pair.value.tag = undefined
                    pair.value.format = undefined
                } else {
                    const replacement = doc.createNode(value)
                    const previousNode = pair.value as Node | null
                    replacement.comment = previousNode?.comment
                    replacement.commentBefore = previousNode?.commentBefore
                    pair.value = replacement
                }
            } else {
                if (previous || params.has(key)) {
                    payloadConflict(section)
                }
                params.set(key, doc.createNode(serialized[key]))
            }
        }
        return existing
    }, section, (entry, prior) => {
        const params = (rule: EditablePayloadRule) => rule.params.map((param) =>
            typeof param === 'string' ? param : { path: param.path, value: param.value, valueType: param.valueType },
        )
        return areMergeValuesEqual(params(entry), params(prior))
    })
    if ((sequence as YAMLSeq).items.length === 0) {
        doc.deleteIn(['payload', section])
        deleteIfMapEmpty(doc, ['payload'])
    }
}

function syncLiveICEServers(
    doc: YamlDocument,
    desired: CodexLiveICEServerDraft[],
    baseline: CodexLiveICEServerDraft[],
    baselineDoc?: YamlDocument,
): void {
    const path = ['codex', 'live-media-relay', 'ice-servers']
    const current = doc.getIn(path, true)
    const original = baselineDoc?.getIn(path, true)
    if (baselineDoc) {
        if (isSeq(original) !== isSeq(current) ||
            (isSeq(original) && isSeq(current) && (
                original.items.length !== current.items.length ||
                original.items.some((node, index) => {
                    const previous = isMap(node) ? asRecord(node.toJSON()) : null
                    const latest = isMap(current.items[index])
                                   ? asRecord(current.items[index].toJSON()) : null
                    return !previous || !latest ||
                           !['urls', 'username', 'credential'].every((key) =>
                               areMergeValuesEqual(previous[key], latest[key]))
                })
            ))) {
            throw new Error('ICE server list changed on the server; reload configuration before editing it')
        }
    }
    if (current !== undefined && current !== null && !isSeq(current)) {
        throw new Error('ICE server list must be a YAML sequence; edit it in source mode')
    }
    if (desired.length === 0) {
        doc.deleteIn(path)
        deleteIfMapEmpty(doc, ['codex', 'live-media-relay'])
        deleteIfMapEmpty(doc, ['codex'])
        return
    }
    ensureMapInDoc(doc, ['codex'])
    ensureMapInDoc(doc, ['codex', 'live-media-relay'])
    const sequence = isSeq(current) ? current : doc.createNode([]) as YAMLSeq
    const positions = new Map(baseline.map((row, index) => [row.id, index]))
    const seen = new Set<string>()
    sequence.items = desired.map((row, nextIndex) => {
        if (seen.has(row.id)) {
            throw new Error('Duplicate ICE server row; reload configuration before saving')
        }
        seen.add(row.id)
        const index = positions.get(row.id)
        const previous = index === undefined ? undefined : baseline[index]
        const existing = index === undefined ? undefined : sequence.items[index]
        if (previous && !isMap(existing)) {
            throw new Error('ICE server row changed on the server; reload configuration before editing it')
        }
        const server = isMap(existing) ? existing : doc.createNode({}) as YAMLMap
        if (!previous || previous.urlsText !== row.urlsText) {
            const urls = row.urlsText.split(/\r?\n/).map((url) => url.trim()).filter(Boolean)
            const oldUrls = server.get('urls', true)
            const list = isSeq(oldUrls) ? oldUrls : doc.createNode([]) as YAMLSeq
            const available = [...list.items]
            list.items = urls.map((url) => {
                const match = available.findIndex((item) => isScalar(item) && item.value === url)
                return match < 0 ? doc.createNode(url) : available.splice(match, 1)[0]
            })
            server.set('urls', list)
        }
        if (row.usernameEdited) {
            if (row.username) {
                server.set('username', row.username)
            } else {
                server.delete('username')
            }
        }
        if (row.credentialEdited) {
            if (row.credential) {
                server.set('credential', row.credential)
            } else {
                server.delete('credential')
            }
        }
        if (index !== undefined && index !== nextIndex && (
            (row.usernameConfigured && !row.usernameEdited) ||
            (row.credentialConfigured && !row.credentialEdited) ||
            stringifyYaml(server).includes('__CLI_PROXY_CONFIG_SECRET_') ||
            stringifyYaml(server).includes('cpa_config_anchor_')
        )) {
            throw new Error('ICE server row contains saved redacted values; replace them before moving this row')
        }
        return server
    })
    doc.setIn(path, sequence)
}

export function encodeVisualConfigYaml(
    currentYaml: string,
    nextValues: VisualConfigValues,
    originalBaselineValues: VisualConfigValues,
    apiKeysStorage: ApiKeysStorageMetadata,
    baselineYaml?: string,
): string {
    if (areVisualConfigValuesEqual(nextValues, originalBaselineValues)) {
        return currentYaml
    }
    const doc = parseConfigDocument(currentYaml)
    if (!isMap(doc.contents)) {
        if (doc.contents !== null) {
            throw new Error('Configuration must be a YAML map')
        }
        doc.contents = doc.createNode({})
    }
    const currentValues = decodeVisualConfigYaml(currentYaml).values
    const baselineDoc = baselineYaml === undefined ? undefined : parseConfigDocument(baselineYaml)
    const merged = mergeVisualChanges(currentValues, nextValues, originalBaselineValues)
    const values = merged.value as VisualConfigValues
    const dirty = (field: keyof VisualConfigValues) =>
        !areMergeValuesEqual(nextValues[field], originalBaselineValues[field])
    let serverSnapshot: unknown
    let baselineSnapshot: unknown
    const shouldWriteAtomicField = (
        field: keyof VisualConfigValues, label: string[], paths: string[][] = [label],
    ): boolean => {
        if (!dirty(field) || areMergeValuesEqual(nextValues[field], currentValues[field])) {
            return false
        }
        const pathValue = (source: unknown, path: string[]) =>
            path.reduce<unknown>((value, part) => asRecord(value)?.[part], source)
        const rawChanged = baselineDoc && paths.some((path) => {
            serverSnapshot ??= doc.toJS()
            baselineSnapshot ??= baselineDoc.toJS()
            return !areMergeValuesEqual(pathValue(serverSnapshot, path), pathValue(baselineSnapshot, path))
        })
        if (rawChanged || !areMergeValuesEqual(currentValues[field], originalBaselineValues[field])) {
            throw new Error(`${label.join('.')} changed on the server; reload configuration before editing it`)
        }
        return true
    }
    const preparePath = (path: string[]) => {
        for (let i = 1; i < path.length; i++) {
            ensureMapInDoc(doc, path.slice(0, i))
        }
    }
    const setField = (field: keyof VisualConfigValues, path: string[], kind: 'string' | 'boolean' | 'list' | 'yaml') => {
        if (kind === 'list' || kind === 'yaml' ? !shouldWriteAtomicField(field, path) : !dirty(field)) {
            return
        }
        preparePath(path)
        const value = values[field]
        if (kind === 'string') {
            setStringInDoc(doc, path, value)
        } else if (kind === 'boolean') {
            setBooleanInDoc(doc, path, value as boolean)
        } else if (kind === 'list') {
            setStringListInDoc(doc, path, value as string[])
        } else {
            setYamlBlockTextInDoc(doc, path, value as string)
        }
        for (let i = path.length - 1; i > 0; i--) {
            deleteIfMapEmpty(doc, path.slice(0, i))
        }
    }
    setField('host', ['host'], 'string')
    setField('tlsCert', ['tls', 'cert'], 'string')
    setField('tlsKey', ['tls', 'key'], 'string')
    setField('rmSecretKey', ['remote-management', 'secret-key'], 'string')
    setField('rmPanelRepo', ['remote-management', 'panel-github-repository'], 'string')
    setField('rmCpaRepo', ['remote-management', 'cpa-github-repository'], 'string')
    setField('authDir', ['auth-dir'], 'string')
    setField('usageDataDir', ['usage-data-dir'], 'string')
    setField('usageStatisticsFile', ['usage-statistics-file'], 'string')
    setField('pluginsDir', ['plugins', 'dir'], 'string')
    setField('pprofAddr', ['pprof', 'addr'], 'string')
    setField('proxyUrl', ['proxy-url'], 'string')
    setField('disableImageGeneration', ['disable-image-generation'], 'string')
    setField('gptImage2BaseModel', ['gpt-image-2-base-model'], 'string')
    setField('videoResultAuthCacheTTL', ['video-result-auth-cache-ttl'], 'string')
    setField('antigravityConnectionPoolIdleTimeout', ['antigravity', 'connection-pool', 'idle-conn-timeout'], 'string')
    setField('codexLiveMediaRelayPublicIP', ['codex', 'live-media-relay', 'public-ip'], 'string')
    setField('routingStrategy', ['routing', 'strategy'], 'string')
    setField('routingSessionAffinityTTL', ['routing', 'session-affinity-ttl'], 'string')
    setField('tlsEnable', ['tls', 'enable'], 'boolean')
    setField('tlsRequireForAuth', ['tls', 'require-for-auth'], 'boolean')
    setField('tlsTrustForwardedProto', ['tls', 'trust-forwarded-proto'], 'boolean')
    setField('rmAllowRemote', ['remote-management', 'allow-remote'], 'boolean')
    setField('rmDisableControlPanel', ['remote-management', 'disable-control-panel'], 'boolean')
    setField('rmAutoUpdatePanel', ['remote-management', 'auto-update-panel'], 'boolean')
    setField('rmAutoUpdateCPA', ['remote-management', 'auto-update-cpa'], 'boolean')
    setField('rmAutoCheckUpdate', ['remote-management', 'auto-check-update'], 'boolean')
    setField('pluginsEnabled', ['plugins', 'enabled'], 'boolean')
    setField('debug', ['debug'], 'boolean')
    setField('commercialMode', ['commercial-mode'], 'boolean')
    setField('loggingToFile', ['logging-to-file'], 'boolean')
    setField('requestLog', ['request-log'], 'boolean')
    setField('pprofEnable', ['pprof', 'enable'], 'boolean')
    setField('usageStatisticsEnabled', ['usage-statistics-enabled'], 'boolean')
    setField('forceModelPrefix', ['force-model-prefix'], 'boolean')
    setField('enableGeminiCliEndpoint', ['enable-gemini-cli-endpoint'], 'boolean')
    setField('passthroughHeaders', ['passthrough-headers'], 'boolean')
    setField('wsAuth', ['ws-auth'], 'boolean')
    if (shouldWriteAtomicField('antigravitySensitiveWords', ['antigravity', 'sensitive-words'])) {
        preparePath(['antigravity', 'sensitive-words'])
        syncStringListInDoc(
            doc,
            ['antigravity', 'sensitive-words'],
            values.antigravitySensitiveWords,
        )
        deleteIfMapEmpty(doc, ['antigravity'])
    }
    if (shouldWriteAtomicField('devinSensitiveWords', ['devin', 'sensitive-words'])) {
        preparePath(['devin', 'sensitive-words'])
        syncStringListInDoc(
            doc,
            ['devin', 'sensitive-words'],
            values.devinSensitiveWords,
        )
        deleteIfMapEmpty(doc, ['devin'])
    }
    setField('allowQueryAuth', ['allow-query-auth'], 'boolean')
    setField('codexIdentityConfuse', ['codex', 'identity-confuse'], 'boolean')
    setField('codexOptimizeMultiAgentV2', ['codex', 'optimize-multi-agent-v2'], 'boolean')
    setField('codexDisableCloaking', ['codex', 'disable-codex-cloaking'], 'boolean')
    setField('codexOrphanDelegationCompatibility', ['codex', 'orphan-delegation-compatibility'], 'boolean')
    setField('antigravityConnectionPoolEnabled', ['antigravity', 'connection-pool', 'enabled'], 'boolean')
    setField('codexLiveMediaRelayEnabled', ['codex', 'live-media-relay', 'enabled'], 'boolean')
    setField('codexLiveMediaRelayDisablePrivateRemoteIPs', ['codex', 'live-media-relay', 'disable-private-remote-ips'], 'boolean')
    setField('claudeDisableCloakMode', ['disable-claude-cloak-mode'], 'boolean')
    setField('claudeCodeDisableCloakingModelList', ['claude-code', 'disable-cloaking-model-list'], 'boolean')
    setField('claudeModelLevelCooling', ['claude', 'model-level-cooling'], 'boolean')
    setField('xaiInjectXSearch', ['xai', 'inject-x-search'], 'boolean')
    setField('routingSessionAffinitySubagents', ['routing', 'session-affinity-subagents'], 'boolean')
    setField('quotaSwitchProject', ['quota-exceeded', 'switch-project'], 'boolean')
    setField('quotaSwitchPreviewModel', ['quota-exceeded', 'switch-preview-model'], 'boolean')
    setField('quotaAntigravityCredits', ['quota-exceeded', 'antigravity-credits'], 'boolean')
    setField('disableCooling', ['disable-cooling'], 'boolean')
    setField('saveCooldownStatus', ['save-cooldown-status'], 'boolean')
    setField('quotaRefreshEnabled', ['quota-refresh', 'enabled'], 'boolean')
    setField('routingSessionAffinity', ['routing', 'session-affinity'], 'boolean')
    setField('pluginConfigsText', ['plugins', 'configs'], 'yaml')
    setField('apiKeyAliasesText', ['api-key-aliases'], 'yaml')
    setField('oauthExcludedModelsText', ['oauth-excluded-models'], 'yaml')
    setField('oauthModelAliasText', ['oauth-model-alias'], 'yaml')
    setField('codexHeaderDefaultsText', ['codex-header-defaults'], 'yaml')
    setField('claudeHeaderDefaultsText', ['claude-header-defaults'], 'yaml')
    setField('rmTrustedProxies', ['remote-management', 'trusted-proxies'], 'list')
    setField('pluginStoreSources', ['plugins', 'store-sources'], 'list')
    if (dirty('codexLiveMediaRelayICEServers')) {
        syncLiveICEServers(doc, nextValues.codexLiveMediaRelayICEServers,
            originalBaselineValues.codexLiveMediaRelayICEServers, baselineDoc)
    }
    for (const [field, contract] of Object.entries(VISUAL_INTEGER_FIELDS)) {
        const next = integerFieldValue(nextValues, field)
        if (next === integerFieldValue(originalBaselineValues, field)) {
            continue
        }
        preparePath(contract.path)
        setIntFromStringInDoc(doc, contract.path, next, contract.minimum, contract.maximum)
        for (let i = contract.path.length - 1; i > 0; i--) {
            deleteIfMapEmpty(doc, contract.path.slice(0, i))
        }
        if (field === 'streaming.nonstreamKeepaliveInterval') {
            if (doc.hasIn(['streaming', 'nonstream-keepalive-interval'])) {
                doc.deleteIn(['streaming', 'nonstream-keepalive-interval'])
                deleteIfMapEmpty(doc, ['streaming'])
            }
        }
    }
    if (dirty('rmAutoUpdatePanel')) {
        doc.deleteIn(['remote-management', 'disable-auto-update-panel'])
    }
    if (dirty('rmPanelRepo')) {
        doc.deleteIn(['remote-management', 'panel-repo'])
    }
    if (dirty('routingSessionAffinity')) {
        doc.deleteIn(['routing', 'sessionAffinity'])
    }
    if (dirty('routingSessionAffinityTTL')) {
        doc.deleteIn(['routing', 'sessionAffinityTTL'])
    }
    if (shouldWriteAtomicField('apiKeysText', ['api-keys'], [
        ['api-keys'], ['auth', 'providers', 'config-api-key'],
    ])) {
        const apiKeys = parseApiKeysInputText(values.apiKeysText)
        const entries = buildApiKeyEntries(apiKeys, apiKeysStorage)

        if (apiKeysStorage.source === 'auth-provider') {
            ensureMapInDoc(doc, ['auth'])
            ensureMapInDoc(doc, ['auth', 'providers'])
            ensureMapInDoc(doc, ['auth', 'providers', 'config-api-key'])
            const providerPath = [
                'auth', 'providers', 'config-api-key', apiKeysStorage.providerListKey ?? 'api-key-entries',
            ]
            if (entries.length > 0) {
                doc.setIn(providerPath, entries)
            } else if (docHas(doc, providerPath)) {
                doc.deleteIn(providerPath)
            }
            if (apiKeysStorage.syncLegacy) {
                if (apiKeys.length > 0) {
                    const baselineKeys = parseApiKeysInputText(originalBaselineValues.apiKeysText)
                    const legacyKeys = apiKeys.map((key) => {
                        const originalIndex = baselineKeys.indexOf(key)
                        return originalIndex < 0
                            ? key
                            : extractApiKeyValue(apiKeysStorage.legacyEntries[originalIndex]) ?? key
                    })
                    doc.setIn(['api-keys'], legacyKeys)
                } else if (docHas(doc, ['api-keys'])) {
                    doc.deleteIn(['api-keys'])
                }
            }
        } else if (entries.length > 0) {
            doc.setIn(['api-keys'], entries)
        } else if (docHas(doc, ['api-keys'])) {
            doc.deleteIn(['api-keys'])
        }
    }

    if (shouldWriteAtomicField('apiKeyRules', ['api-key-rules'])) {
        const rules = serializeApiKeyRulesForYaml(values.apiKeyRules)
        if (Object.keys(rules).length) {
            doc.setIn(['api-key-rules'], rules)
        } else {
            doc.deleteIn(['api-key-rules'])
        }
    }
    if (shouldWriteAtomicField('pluginStoreAuth', ['plugins', 'store-auth'])) {
        preparePath(['plugins', 'store-auth'])
        const rules = serializePluginStoreAuthForYaml(values.pluginStoreAuth)
        if (rules.length) {
            doc.setIn(['plugins', 'store-auth'], rules)
        } else {
            doc.deleteIn(['plugins', 'store-auth'])
            deleteIfMapEmpty(doc, ['plugins'])
        }
    }
    if (shouldWriteAtomicField('corsAllowedOrigins', ['cors-allowed-origins'])) {
        setStringListInDoc(doc, ['cors-allowed-origins'], values.corsAllowedOrigins.split(','))
    }
    if (shouldWriteAtomicField('providerConfigText', ['provider settings'],
        providerConfigKeys.map((key) => [key]))) {
        setProviderConfigTextInDoc(doc, values.providerConfigText)
    }
    for (const [field, section] of Object.entries(PAYLOAD_FIELDS)) {
        const key = field as keyof typeof PAYLOAD_FIELDS
        if (dirty(key)) {
            const serialize = (rules: EditablePayloadRule[]) => section === 'filter'
                ? serializePayloadFilterRulesForYaml(rules as PayloadFilterRule[])
                : section.endsWith('-raw')
                  ? serializeRawPayloadRulesForYaml(rules as PayloadRule[])
                  : serializePayloadRulesForYaml(rules as PayloadRule[])
            const conditionsReordered = nextValues[key].some((rule) => {
                const prior = originalBaselineValues[key].find((entry) => entry.id === rule.id)
                return rule.models.some((model) => {
                    const previous = prior?.models.find((entry) => entry.id === model.id)
                    return (['match', 'notMatch'] as const).some((property) => {
                        const before = previous?.[property] ?? []
                        const after = model[property] ?? []
                        const retained = before.filter((entry) => after.some((next) => next.id === entry.id)).map((entry) => entry.id)
                        const reordered = after.filter((entry) => before.some((next) => next.id === entry.id)).map((entry) => entry.id)
                        return !areStringArraysEqual(retained, reordered)
                    })
                })
            })
            if (!conditionsReordered && areMergeValuesEqual(serialize(currentValues[key]), serialize(nextValues[key]))) {
                continue
            }
            const baselineSequence = baselineDoc?.getIn(['payload', section], true)
            syncPayloadRules(doc, section, currentValues[key], originalBaselineValues[key], nextValues[key],
                isSeq(baselineSequence) ? baselineSequence : undefined)
        }
    }
    return doc.toString({ indent: 2, lineWidth: 120, minContentWidth: 0 })
}
