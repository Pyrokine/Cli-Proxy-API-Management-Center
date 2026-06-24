import type {
    ApiKeyModelRule,
    PayloadFilterRule,
    PayloadParamEntry,
    PayloadParamValidationErrorCode,
    PayloadParamValueType,
    PayloadRule,
    VisualConfigValidationErrorCode,
    VisualConfigValidationErrors,
    VisualConfigValues,
} from '@/types/visualConfig'
import {DEFAULT_VISUAL_VALUES} from '@/types/visualConfig'
import {useCallback, useMemo, useState} from 'react'
import {isMap, parse as parseYaml, parseDocument, stringify as stringifyYaml} from 'yaml'

function asRecord(value: unknown): Record<string, unknown> | null {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return null
    }
    return value as Record<string, unknown>
}

function normalizeBoolean(value: unknown): boolean | undefined {
    if (value === undefined || value === null) {
        return undefined
    }
    if (typeof value === 'boolean') {
        return value
    }
    if (typeof value === 'number') {
        return value !== 0
    }
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase()
        if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) {
            return true
        }
        if (['false', '0', 'no', 'n', 'off'].includes(normalized)) {
            return false
        }
    }
    return Boolean(value)
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
    if (value) {
        doc.setIn(path, true)
        return
    }
    if (docHas(doc, path)) {
        doc.setIn(path, false)
    }
}

function setStringInDoc(doc: YamlDocument, path: YamlPath, value: unknown): void {
    const safe    = typeof value === 'string' ? value : ''
    const trimmed = safe.trim()
    if (trimmed !== '') {
        doc.setIn(path, safe)
        return
    }
    // Preserve existing empty-string keys to avoid dropping template blocks/comments.
    // Only keep the key when it already exists in the YAML.
    if (docHas(doc, path)) {
        doc.setIn(path, '')
    }
}

function setIntFromStringInDoc(doc: YamlDocument, path: YamlPath, value: unknown): void {
    const safe    = typeof value === 'string' ? value : ''
    const trimmed = safe.trim()
    if (trimmed === '') {
        if (docHas(doc, path)) {
            doc.deleteIn(path)
        }
        return
    }

    const parsed = Number.parseInt(trimmed, 10)
    if (Number.isFinite(parsed)) {
        doc.setIn(path, parsed)
        return
    }

    if (docHas(doc, path)) {
        doc.deleteIn(path)
    }
}

function deepClone<T>(value: T): T {
    if (typeof structuredClone === 'function') {
        return structuredClone(value)
    }
    return JSON.parse(JSON.stringify(value)) as T
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
    return parseYaml(trimmed)
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

const providerConfigKeys = [
    'gemini-api-key',
    'codex-api-key',
    'claude-api-key',
    'vertex-api-key',
    'openai-compatibility',
] as const

function buildProviderConfigText(parsed: Record<string, unknown>): string {
    return yamlBlockToText(Object.fromEntries(providerConfigKeys.map((key) => [key, parsed[key] ?? []])))
}

function setProviderConfigTextInDoc(doc: YamlDocument, value: string): void {
    const parsed = parseYamlBlockText(value)
    const record = asRecord(parsed) ?? {}
    providerConfigKeys.forEach((key) => {
        const nextValue = record[key]
        if (nextValue === undefined) {
            doc.setIn([key], [])
        } else {
            doc.setIn([key], nextValue)
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
        if (current.id !== next.id || current.name !== next.name || current.protocol !== next.protocol) {
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
    if (leftKeys.length !== rightKeys.length) {
        return false
    }
    for (let i = 0; i < leftKeys.length; i++) {
        const key = leftKeys[i]
        if (key !== rightKeys[i]) {
            return false
        }
        const leftModels  = [...(left[key]?.blockedModels ?? [])].sort()
        const rightModels = [...(right[key]?.blockedModels ?? [])].sort()
        if (leftModels.length !== rightModels.length) {
            return false
        }
        for (let j = 0; j < leftModels.length; j++) {
            if (leftModels[j] !== rightModels[j]) {
                return false
            }
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

function areVisualConfigValuesEqual(left: VisualConfigValues, right: VisualConfigValues): boolean {
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
        left.authAutoRefreshWorkers === right.authAutoRefreshWorkers &&
        left.requestRetry === right.requestRetry &&
        left.maxRetryCredentials === right.maxRetryCredentials &&
        left.maxRetryInterval === right.maxRetryInterval &&
        left.quotaSwitchProject === right.quotaSwitchProject &&
        left.quotaSwitchPreviewModel === right.quotaSwitchPreviewModel &&
        left.quotaAntigravityCredits === right.quotaAntigravityCredits &&
        left.disableCooling === right.disableCooling &&
        left.quotaRefreshEnabled === right.quotaRefreshEnabled &&
        left.quotaRefreshInterval === right.quotaRefreshInterval &&
        left.quotaRefreshMaxInterval === right.quotaRefreshMaxInterval &&
        left.routingStrategy === right.routingStrategy &&
        left.routingSessionAffinity === right.routingSessionAffinity &&
        left.routingSessionAffinityTTL === right.routingSessionAffinityTTL &&
        left.wsAuth === right.wsAuth &&
        left.allowQueryAuth === right.allowQueryAuth &&
        left.corsAllowedOrigins === right.corsAllowedOrigins &&
        left.providerConfigText === right.providerConfigText &&
        left.oauthExcludedModelsText === right.oauthExcludedModelsText &&
        left.oauthModelAliasText === right.oauthModelAliasText &&
        left.codexIdentityConfuse === right.codexIdentityConfuse &&
        left.codexHeaderDefaultsText === right.codexHeaderDefaultsText &&
        left.claudeHeaderDefaultsText === right.claudeHeaderDefaultsText &&
        left.ampcodeText === right.ampcodeText &&
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

function parseApiKeyRules(raw: unknown): Record<string, ApiKeyModelRule> {
    const record = asRecord(raw)
    if (!record) {
        return {}
    }
    const rules: Record<string, ApiKeyModelRule> = {}
    for (const [apiKey, rawRule] of Object.entries(record)) {
        const key  = apiKey.trim()
        const rule = asRecord(rawRule)
        if (!key || !rule) {
            continue
        }
        const blockedRaw    = rule['blocked-models'] ?? rule.blockedModels
        const blockedModels = Array.isArray(blockedRaw)
                              ? [...new Set(blockedRaw.map((item) => String(item).trim()).filter(Boolean))]
                              : []
        if (blockedModels.length > 0) {
            rules[key] = { blockedModels }
        }
    }
    return rules
}

function serializeApiKeyRulesForYaml(rules: Record<string, ApiKeyModelRule>): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    for (const [apiKey, rule] of Object.entries(rules)) {
        const key           = apiKey.trim()
        const blockedModels = [...new Set(rule.blockedModels.map((model) => model.trim()).filter(Boolean))]
        if (key && blockedModels.length > 0) {
            out[key] = { 'blocked-models': blockedModels }
        }
    }
    return out
}

function parsePayloadParamValue(raw: unknown): { valueType: PayloadParamValueType; value: string } {
    if (typeof raw === 'number') {
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

function parsePayloadRules(rules: unknown): PayloadRule[] {
    if (!Array.isArray(rules)) {
        return []
    }

    return rules.map((rule, index) => {
        const record = asRecord(rule) ?? {}

        const modelsRaw = record.models
        const models    = Array.isArray(modelsRaw)
                          ? modelsRaw.map((model, modelIndex) => {
                const modelRecord = asRecord(model)
                const nameRaw     = typeof model === 'string' ? model : (modelRecord?.name ?? modelRecord?.id ?? '')
                const name        = typeof nameRaw === 'string' ? nameRaw : String(nameRaw ?? '')
                return {
                    id: `model-${index}-${modelIndex}`,
                    name,
                    protocol: parsePayloadProtocol(modelRecord?.protocol),
                }
            })
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
                          ? modelsRaw.map((model, modelIndex) => {
                const modelRecord = asRecord(model)
                const nameRaw     = typeof model === 'string' ? model : (modelRecord?.name ?? modelRecord?.id ?? '')
                const name        = typeof nameRaw === 'string' ? nameRaw : String(nameRaw ?? '')
                return {
                    id: `filter-model-${index}-${modelIndex}`,
                    name,
                    protocol: parsePayloadProtocol(modelRecord?.protocol),
                }
            })
                          : []

        const paramsRaw = record.params
        const params    = Array.isArray(paramsRaw) ? paramsRaw.map(String) : []

        return { id: `payload-filter-rule-${index}`, models, params }
    })
}

type ApiKeysStorageMode = 'legacy' | 'auth-provider'
type ApiKeysEntryMode = 'string' | 'object'

type ApiKeysStorageMetadata = {
    source: ApiKeysStorageMode
    providerListKey?: 'api-keys' | 'api-key-entries'
    entryMode: ApiKeysEntryMode
    originalEntries: unknown[]
    syncLegacy: boolean
}

const DEFAULT_API_KEYS_STORAGE_METADATA: ApiKeysStorageMetadata = {
    source: 'legacy',
    entryMode: 'string',
    originalEntries: [],
    syncLegacy: false,
}

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

function buildApiKeyEntries(
    apiKeys: string[],
    metadata: ApiKeysStorageMetadata,
): Array<string | Record<string, unknown>> {
    return apiKeys.map((apiKey, index) => {
        const originalEntry = metadata.originalEntries[index]
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
                          ? modelsRaw.map((model, modelIndex) => {
                const modelRecord = asRecord(model)
                const nameRaw     = typeof model === 'string' ? model : (modelRecord?.name ?? modelRecord?.id ?? '')
                const name        = typeof nameRaw === 'string' ? nameRaw : String(nameRaw ?? '')
                return {
                    id: `raw-model-${index}-${modelIndex}`,
                    name,
                    protocol: parsePayloadProtocol(modelRecord?.protocol),
                }
            })
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

function getPortError(value: string): VisualConfigValidationErrorCode | undefined {
    const trimmed = value.trim()
    if (!trimmed) {
        return undefined
    }
    const parsed = Number(trimmed)
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
        return 'port_range'
    }
    return undefined
}

function getNonNegativeIntegerError(value: string): VisualConfigValidationErrorCode | undefined {
    const trimmed = value.trim()
    if (!trimmed) {
        return undefined
    }
    const parsed = Number(trimmed)
    if (!Number.isInteger(parsed) || parsed < 0) {
        return 'non_negative_integer'
    }
    return undefined
}

function parseOptionalInteger(value: string): number | undefined {
    const trimmed = value.trim()
    if (!trimmed) {
        return undefined
    }
    const parsed = Number(trimmed)
    return Number.isInteger(parsed) ? parsed : undefined
}

function getQuotaRefreshIntervalError(values: VisualConfigValues): VisualConfigValidationErrorCode | undefined {
    const baseError = getNonNegativeIntegerError(values.quotaRefreshInterval)
    if (baseError || !values.quotaRefreshEnabled) {
        return baseError
    }
    const interval = parseOptionalInteger(values.quotaRefreshInterval)
    if (interval === undefined || interval < 60) {
        return 'quota_refresh_interval_range'
    }
    return undefined
}

function getQuotaRefreshMaxIntervalError(values: VisualConfigValues): VisualConfigValidationErrorCode | undefined {
    const baseError = getNonNegativeIntegerError(values.quotaRefreshMaxInterval)
    if (baseError || !values.quotaRefreshEnabled) {
        return baseError
    }
    const interval    = parseOptionalInteger(values.quotaRefreshInterval)
    const maxInterval = parseOptionalInteger(values.quotaRefreshMaxInterval)
    if (maxInterval === undefined || maxInterval < 300 || (interval !== undefined && maxInterval < interval)) {
        return 'quota_refresh_max_interval_range'
    }
    return undefined
}

function getVisualConfigValidationErrors(values: VisualConfigValues): VisualConfigValidationErrors {
    return {
        port: getPortError(values.port),
        tlsHttpRedirectPort: getNonNegativeIntegerError(values.tlsHttpRedirectPort),
        logsMaxTotalSizeMb: getNonNegativeIntegerError(values.logsMaxTotalSizeMb),
        errorLogsMaxFiles: getNonNegativeIntegerError(values.errorLogsMaxFiles),
        redisUsageQueueRetentionSeconds: getNonNegativeIntegerError(values.redisUsageQueueRetentionSeconds),
        authAutoRefreshWorkers: getNonNegativeIntegerError(values.authAutoRefreshWorkers),
        usageRetentionDays: getNonNegativeIntegerError(values.usageRetentionDays),
        usageRetentionMaxDbSizeMb: getNonNegativeIntegerError(values.usageRetentionMaxDbSizeMb),
        usageRetentionWarningThresholdPct: getNonNegativeIntegerError(values.usageRetentionWarningThresholdPct),
        autoRefreshInterval: getNonNegativeIntegerError(values.autoRefreshInterval),
        modelRefreshInterval: getNonNegativeIntegerError(values.modelRefreshInterval),
        requestRetry: getNonNegativeIntegerError(values.requestRetry),
        maxRetryCredentials: getNonNegativeIntegerError(values.maxRetryCredentials),
        maxRetryInterval: getNonNegativeIntegerError(values.maxRetryInterval),
        quotaRefreshInterval: getQuotaRefreshIntervalError(values),
        quotaRefreshMaxInterval: getQuotaRefreshMaxIntervalError(values),
        'streaming.keepaliveSeconds': getNonNegativeIntegerError(values.streaming.keepaliveSeconds),
        'streaming.bootstrapRetries': getNonNegativeIntegerError(values.streaming.bootstrapRetries),
        'streaming.nonstreamKeepaliveInterval': getNonNegativeIntegerError(values.streaming.nonstreamKeepaliveInterval),
    }
}

export function getPayloadParamValidationError(param: PayloadParamEntry): PayloadParamValidationErrorCode | undefined {
    const trimmedValue = param.value.trim()
    if (!trimmedValue) {
        return undefined
    }

    if (param.valueType === 'number') {
        const parsed = Number(trimmedValue)
        if (!Number.isFinite(parsed)) {
            return 'payload_invalid_number'
        }
    }

    if (param.valueType === 'boolean') {
        if (trimmedValue !== 'true' && trimmedValue !== 'false') {
            return 'payload_invalid_boolean'
        }
    }

    if (param.valueType === 'json') {
        try {
            JSON.parse(trimmedValue)
        } catch {
            return 'payload_invalid_json'
        }
    }

    return undefined
}

function hasPayloadParamValidationErrors(rules: PayloadRule[]): boolean {
    return rules.some((rule) => rule.params.some((param) => getPayloadParamValidationError(param) !== undefined))
}

function serializePayloadRulesForYaml(rules: PayloadRule[]): Array<Record<string, unknown>> {
    return rules
        .map((rule) => {
            const models = (rule.models || [])
                .filter((m) => m.name?.trim())
                .map((m) => {
                    const obj: Record<string, unknown> = { name: m.name.trim() }
                    if (m.protocol) {
                        obj.protocol = m.protocol
                    }
                    return obj
                })

            const params: Record<string, unknown> = {}
            for (const param of rule.params || []) {
                if (!param.path?.trim()) {
                    continue
                }
                let value: unknown = param.value
                if (param.valueType === 'number') {
                    const num = Number(param.value)
                    value     = Number.isFinite(num) ? num : param.value
                } else if (param.valueType === 'boolean') {
                    value = param.value === 'true'
                } else if (param.valueType === 'json') {
                    try {
                        value = JSON.parse(param.value)
                    } catch {
                        value = param.value
                    }
                }
                params[param.path.trim()] = value
            }

            return { models, params }
        })
        .filter((rule) => rule.models.length > 0)
}

function serializePayloadFilterRulesForYaml(rules: PayloadFilterRule[]): Array<Record<string, unknown>> {
    return rules
        .map((rule) => {
            const models = (rule.models || [])
                .filter((m) => m.name?.trim())
                .map((m) => {
                    const obj: Record<string, unknown> = { name: m.name.trim() }
                    if (m.protocol) {
                        obj.protocol = m.protocol
                    }
                    return obj
                })

            const params = (Array.isArray(rule.params) ? rule.params : [])
                .map((path) => String(path).trim())
                .filter(Boolean)

            return { models, params }
        })
        .filter((rule) => rule.models.length > 0)
}

function serializeRawPayloadRulesForYaml(rules: PayloadRule[]): Array<Record<string, unknown>> {
    return rules
        .map((rule) => {
            const models = (rule.models || [])
                .filter((m) => m.name?.trim())
                .map((m) => {
                    const obj: Record<string, unknown> = { name: m.name.trim() }
                    if (m.protocol) {
                        obj.protocol = m.protocol
                    }
                    return obj
                })

            const params: Record<string, unknown> = {}
            for (const param of rule.params || []) {
                if (!param.path?.trim()) {
                    continue
                }
                params[param.path.trim()] = param.value
            }

            return { models, params }
        })
        .filter((rule) => rule.models.length > 0)
}

export function useVisualConfig() {
    const [visualValues, setVisualValuesState] = useState<VisualConfigValues>({
                                                                                  ...DEFAULT_VISUAL_VALUES,
                                                                              })

    const [baselineValues, setBaselineValues]     = useState<VisualConfigValues>({
                                                                                     ...DEFAULT_VISUAL_VALUES,
                                                                                 })
    const [apiKeysStorage, setApiKeysStorage]     = useState<ApiKeysStorageMetadata>(DEFAULT_API_KEYS_STORAGE_METADATA)
    const [visualParseError, setVisualParseError] = useState<string | null>(null)

    const validationErrors = useMemo(() => getVisualConfigValidationErrors(visualValues), [visualValues])

    const visualHasValidationErrors = useMemo(() => Object.values(validationErrors).some(Boolean), [validationErrors])

    const visualHasPayloadValidationErrors = useMemo(
        () =>
            hasPayloadParamValidationErrors(visualValues.payloadDefaultRules) ||
            hasPayloadParamValidationErrors(visualValues.payloadDefaultRawRules) ||
            hasPayloadParamValidationErrors(visualValues.payloadOverrideRules) ||
            hasPayloadParamValidationErrors(visualValues.payloadOverrideRawRules),
        [
            visualValues.payloadDefaultRules,
            visualValues.payloadDefaultRawRules,
            visualValues.payloadOverrideRules,
            visualValues.payloadOverrideRawRules,
        ],
    )

    const visualDirty = useMemo(() => {
        return !areVisualConfigValuesEqual(visualValues, baselineValues)
    }, [baselineValues, visualValues])

    const loadVisualValuesFromYaml = useCallback((yamlContent: string) => {
        try {
            const document = parseDocument(yamlContent)
            if (document.errors.length > 0) {
                const message = document.errors[0]?.message ?? 'Invalid YAML'
                setVisualParseError(message)
                return { ok: false as const, error: message }
            }

            const parsedRaw: unknown                                  = parseYaml(yamlContent) || {}
            const parsed                                              = asRecord(parsedRaw) ?? {}
            const { text: apiKeysText, metadata: nextApiKeysStorage } = resolveApiKeysStorage(parsed)
            const tls                                                 = asRecord(parsed.tls)
            const remoteManagement                                    = asRecord(parsed['remote-management'])
            const pprof                                               = asRecord(parsed.pprof)
            const usageRetention                                      = asRecord(parsed['usage-retention'])
            const quotaExceeded                                       = asRecord(parsed['quota-exceeded'])
            const quotaRefresh                                        = asRecord(parsed['quota-refresh'])
            const plugins                                             = asRecord(parsed.plugins)
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
                pluginConfigsText: yamlBlockToText(plugins?.configs ?? {}),
                apiKeysText,
                apiKeyAliasesText: yamlBlockToText(parsed['api-key-aliases'] ?? {}),
                apiKeyRules: parseApiKeyRules(parsed['api-key-rules']),

                debug: normalizeBoolean(parsed.debug) ?? false,
                commercialMode: normalizeBoolean(parsed['commercial-mode']) ?? false,
                loggingToFile: normalizeBoolean(parsed['logging-to-file']) ?? false,
                requestLog: normalizeBoolean(parsed['request-log']) ?? false,
                pprofEnable: normalizeBoolean(pprof?.enable) ?? false,
                pprofAddr: typeof pprof?.addr === 'string' ? pprof.addr : '',
                logsMaxTotalSizeMb: String(parsed['logs-max-total-size-mb'] ?? ''),
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
                                        'chat'
                                        ? parsed['disable-image-generation']
                                        : 'off',
                gptImage2BaseModel: typeof parsed['gpt-image-2-base-model'] === 'string' ?
                                    parsed['gpt-image-2-base-model'] :
                                    '',
                authAutoRefreshWorkers: String(parsed['auth-auto-refresh-workers'] ?? ''),
                requestRetry: String(parsed['request-retry'] ?? ''),
                maxRetryCredentials: String(parsed['max-retry-credentials'] ?? ''),
                maxRetryInterval: String(parsed['max-retry-interval'] ?? ''),
                wsAuth: normalizeBoolean(parsed['ws-auth']) ?? true,
                allowQueryAuth: normalizeBoolean(parsed['allow-query-auth']) ?? false,
                corsAllowedOrigins: Array.isArray(parsed['cors-allowed-origins'])
                                    ? (parsed['cors-allowed-origins'] as string[]).join(', ')
                                    : '',
                providerConfigText: buildProviderConfigText(parsed),
                oauthExcludedModelsText: yamlBlockToText(parsed['oauth-excluded-models'] ?? {}),
                oauthModelAliasText: yamlBlockToText(parsed['oauth-model-alias'] ?? {}),
                codexIdentityConfuse: normalizeBoolean(asRecord(parsed.codex)?.['identity-confuse']) ?? false,
                codexHeaderDefaultsText: yamlBlockToText(parsed['codex-header-defaults'] ?? {}),
                claudeHeaderDefaultsText: yamlBlockToText(parsed['claude-header-defaults'] ?? {}),
                ampcodeText: yamlBlockToText(parsed.ampcode ?? {}),

                quotaSwitchProject: normalizeBoolean(quotaExceeded?.['switch-project']) ?? true,
                quotaSwitchPreviewModel: normalizeBoolean(quotaExceeded?.['switch-preview-model']) ?? true,
                quotaAntigravityCredits: normalizeBoolean(quotaExceeded?.['antigravity-credits']) ?? false,
                disableCooling: normalizeBoolean(parsed['disable-cooling']) ?? false,
                quotaRefreshEnabled: normalizeBoolean(quotaRefresh?.enabled) ?? false,
                quotaRefreshInterval: String(quotaRefresh?.interval ?? ''),
                quotaRefreshMaxInterval: String(quotaRefresh?.['max-interval'] ?? ''),

                routingStrategy: routing?.strategy === 'fill-first' ? 'fill-first' : 'round-robin',
                routingSessionAffinity:
                    normalizeBoolean(
                    routing?.['session-affinity'] ?? routing?.sessionAffinity ?? routing?.['sessionAffinity'],
                    ) ?? false,
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

            setVisualValuesState(newValues)
            setBaselineValues(deepClone(newValues))
            setApiKeysStorage(nextApiKeysStorage)
            setVisualParseError(null)
            return { ok: true as const }
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Invalid YAML'
            setVisualParseError(message)
            return { ok: false as const, error: message }
        }
    }, [])

    const applyVisualChangesToYaml = useCallback(
        (currentYaml: string): string => {
            try {
                const doc = parseDocument(currentYaml)
                if (doc.errors.length > 0) {
                    return currentYaml
                }
                if (!isMap(doc.contents)) {
                    doc.contents = doc.createNode({}) as unknown as typeof doc.contents
                }
                const values = visualValues

                setStringInDoc(doc, ['host'], values.host)
                setIntFromStringInDoc(doc, ['port'], values.port)

                if (
                    docHas(doc, ['tls']) ||
                    values.tlsEnable ||
                    values.tlsCert.trim() ||
                    values.tlsKey.trim() ||
                    values.tlsHttpRedirectPort.trim() ||
                    values.tlsRequireForAuth ||
                    values.tlsTrustForwardedProto
                ) {
                    ensureMapInDoc(doc, ['tls'])
                    setBooleanInDoc(doc, ['tls', 'enable'], values.tlsEnable)
                    setStringInDoc(doc, ['tls', 'cert'], values.tlsCert)
                    setStringInDoc(doc, ['tls', 'key'], values.tlsKey)
                    setIntFromStringInDoc(doc, ['tls', 'http-redirect-port'], values.tlsHttpRedirectPort)
                    setBooleanInDoc(doc, ['tls', 'require-for-auth'], values.tlsRequireForAuth)
                    setBooleanInDoc(doc, ['tls', 'trust-forwarded-proto'], values.tlsTrustForwardedProto)
                    deleteIfMapEmpty(doc, ['tls'])
                }

                if (
                    docHas(doc, ['remote-management']) ||
                    values.rmAllowRemote ||
                    values.rmSecretKey.trim() ||
                    values.rmDisableControlPanel ||
                    values.rmAutoUpdatePanel ||
                    values.rmAutoUpdateCPA ||
                    values.rmAutoCheckUpdate ||
                    values.rmCheckInterval.trim() ||
                    values.rmPanelRepo.trim() ||
                    values.rmCpaRepo.trim()
                ) {
                    ensureMapInDoc(doc, ['remote-management'])
                    setBooleanInDoc(doc, ['remote-management', 'allow-remote'], values.rmAllowRemote)
                    setStringInDoc(doc, ['remote-management', 'secret-key'], values.rmSecretKey)
                    setBooleanInDoc(doc, ['remote-management', 'disable-control-panel'], values.rmDisableControlPanel)
                    setBooleanInDoc(doc, ['remote-management', 'auto-update-panel'], values.rmAutoUpdatePanel)
                    if (docHas(doc, ['remote-management', 'disable-auto-update-panel'])) {
                        doc.deleteIn(['remote-management', 'disable-auto-update-panel'])
                    }
                    setBooleanInDoc(doc, ['remote-management', 'auto-update-cpa'], values.rmAutoUpdateCPA)
                    setBooleanInDoc(doc, ['remote-management', 'auto-check-update'], values.rmAutoCheckUpdate)
                    setIntFromStringInDoc(doc, ['remote-management', 'check-interval'], values.rmCheckInterval)
                    setStringInDoc(doc, ['remote-management', 'panel-github-repository'], values.rmPanelRepo)
                    setStringInDoc(doc, ['remote-management', 'cpa-github-repository'], values.rmCpaRepo)
                    if (docHas(doc, ['remote-management', 'panel-repo'])) {
                        doc.deleteIn(['remote-management', 'panel-repo'])
                    }
                    deleteIfMapEmpty(doc, ['remote-management'])
                }

                setStringInDoc(doc, ['auth-dir'], values.authDir)
                setStringInDoc(doc, ['usage-data-dir'], values.usageDataDir)
                setStringInDoc(doc, ['usage-statistics-file'], values.usageStatisticsFile)
                if (
                    docHas(doc, ['plugins']) ||
                    values.pluginsEnabled ||
                    values.pluginsEnabled !== baselineValues.pluginsEnabled ||
                    values.pluginsDir !== baselineValues.pluginsDir ||
                    (values.pluginsDir.trim() !== '' && values.pluginsDir.trim() !== 'plugins')
                ) {
                    ensureMapInDoc(doc, ['plugins'])
                    doc.setIn(['plugins', 'enabled'], values.pluginsEnabled)
                    setStringInDoc(doc, ['plugins', 'dir'], values.pluginsDir)
                    setYamlBlockTextInDoc(doc, ['plugins', 'configs'], values.pluginConfigsText)
                    deleteIfMapEmpty(doc, ['plugins'])
                }
                if (values.apiKeysText !== baselineValues.apiKeysText) {
                    const apiKeys = values.apiKeysText
                                          .split('\n')
                                          .map((key) => key.trim())
                                          .filter(Boolean)
                    const entries = buildApiKeyEntries(apiKeys, apiKeysStorage)

                    if (apiKeysStorage.source === 'auth-provider') {
                        ensureMapInDoc(doc, ['auth'])
                        ensureMapInDoc(doc, ['auth', 'providers'])
                        ensureMapInDoc(doc, ['auth', 'providers', 'config-api-key'])
                        if (entries.length > 0) {
                            doc.setIn(
                                [
                                    'auth',
                                    'providers',
                                    'config-api-key',
                                    apiKeysStorage.providerListKey ?? 'api-key-entries',
                                ],
                                entries,
                            )
                        } else if (
                            docHas(doc, [
                                'auth',
                                'providers',
                                'config-api-key',
                                apiKeysStorage.providerListKey ?? 'api-key-entries',
                            ])
                        ) {
                            doc.deleteIn([
                                             'auth',
                                             'providers',
                                             'config-api-key',
                                             apiKeysStorage.providerListKey ?? 'api-key-entries',
                                         ])
                        }
                        if (apiKeysStorage.syncLegacy) {
                            if (entries.length > 0) {
                                doc.setIn(['api-keys'], entries)
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

                setYamlBlockTextInDoc(doc, ['api-key-aliases'], values.apiKeyAliasesText)

                const apiKeyRules = serializeApiKeyRulesForYaml(values.apiKeyRules)
                if (Object.keys(apiKeyRules).length > 0) {
                    doc.setIn(['api-key-rules'], apiKeyRules)
                } else if (docHas(doc, ['api-key-rules'])) {
                    doc.deleteIn(['api-key-rules'])
                }

                setBooleanInDoc(doc, ['debug'], values.debug)

                setBooleanInDoc(doc, ['commercial-mode'], values.commercialMode)
                setBooleanInDoc(doc, ['logging-to-file'], values.loggingToFile)
                setBooleanInDoc(doc, ['request-log'], values.requestLog)
                if (docHas(doc, ['pprof']) || values.pprofEnable || values.pprofAddr.trim()) {
                    ensureMapInDoc(doc, ['pprof'])
                    setBooleanInDoc(doc, ['pprof', 'enable'], values.pprofEnable)
                    setStringInDoc(doc, ['pprof', 'addr'], values.pprofAddr)
                    deleteIfMapEmpty(doc, ['pprof'])
                }
                setIntFromStringInDoc(doc, ['logs-max-total-size-mb'], values.logsMaxTotalSizeMb)
                setIntFromStringInDoc(doc, ['error-logs-max-files'], values.errorLogsMaxFiles)
                setIntFromStringInDoc(
                    doc,
                    ['redis-usage-queue-retention-seconds'],
                    values.redisUsageQueueRetentionSeconds,
                )
                setBooleanInDoc(doc, ['usage-statistics-enabled'], values.usageStatisticsEnabled)
                if (
                    docHas(doc, ['usage-retention']) ||
                    values.usageRetentionDays.trim() ||
                    values.usageRetentionMaxDbSizeMb.trim() ||
                    values.usageRetentionWarningThresholdPct.trim()
                ) {
                    ensureMapInDoc(doc, ['usage-retention'])
                    setIntFromStringInDoc(doc, ['usage-retention', 'days'], values.usageRetentionDays)
                    setIntFromStringInDoc(doc, ['usage-retention', 'max-db-size-mb'], values.usageRetentionMaxDbSizeMb)
                    setIntFromStringInDoc(
                        doc,
                        ['usage-retention', 'warning-threshold-pct'],
                        values.usageRetentionWarningThresholdPct,
                    )
                    deleteIfMapEmpty(doc, ['usage-retention'])
                }
                setIntFromStringInDoc(doc, ['auto-refresh-interval'], values.autoRefreshInterval)
                setIntFromStringInDoc(doc, ['model-refresh-interval'], values.modelRefreshInterval)

                setStringInDoc(doc, ['proxy-url'], values.proxyUrl)
                setBooleanInDoc(doc, ['force-model-prefix'], values.forceModelPrefix)
                setBooleanInDoc(doc, ['enable-gemini-cli-endpoint'], values.enableGeminiCliEndpoint)
                setBooleanInDoc(doc, ['passthrough-headers'], values.passthroughHeaders)
                doc.setIn(['disable-image-generation'], values.disableImageGeneration)
                setStringInDoc(doc, ['gpt-image-2-base-model'], values.gptImage2BaseModel)
                setIntFromStringInDoc(doc, ['auth-auto-refresh-workers'], values.authAutoRefreshWorkers)
                setIntFromStringInDoc(doc, ['request-retry'], values.requestRetry)
                setIntFromStringInDoc(doc, ['max-retry-credentials'], values.maxRetryCredentials)
                setIntFromStringInDoc(doc, ['max-retry-interval'], values.maxRetryInterval)
                setBooleanInDoc(doc, ['ws-auth'], values.wsAuth)
                setBooleanInDoc(doc, ['allow-query-auth'], values.allowQueryAuth)

                const corsOrigins = values.corsAllowedOrigins
                                          .split(',')
                                          .map((s) => s.trim())
                                          .filter(Boolean)
                if (corsOrigins.length > 0) {
                    doc.setIn(['cors-allowed-origins'], corsOrigins)
                } else if (docHas(doc, ['cors-allowed-origins'])) {
                    doc.deleteIn(['cors-allowed-origins'])
                }
                setProviderConfigTextInDoc(doc, values.providerConfigText)
                setYamlBlockTextInDoc(doc, ['oauth-excluded-models'], values.oauthExcludedModelsText)
                setYamlBlockTextInDoc(doc, ['oauth-model-alias'], values.oauthModelAliasText)
                ensureMapInDoc(doc, ['codex'])
                doc.setIn(['codex', 'identity-confuse'], values.codexIdentityConfuse)
                setYamlBlockTextInDoc(doc, ['codex-header-defaults'], values.codexHeaderDefaultsText)
                setYamlBlockTextInDoc(doc, ['claude-header-defaults'], values.claudeHeaderDefaultsText)
                setYamlBlockTextInDoc(doc, ['ampcode'], values.ampcodeText)

                if (
                    docHas(doc, ['quota-exceeded']) ||
                    !values.quotaSwitchProject ||
                    !values.quotaSwitchPreviewModel ||
                    values.quotaAntigravityCredits
                ) {
                    ensureMapInDoc(doc, ['quota-exceeded'])
                    doc.setIn(['quota-exceeded', 'switch-project'], values.quotaSwitchProject)
                    doc.setIn(['quota-exceeded', 'switch-preview-model'], values.quotaSwitchPreviewModel)
                    if (docHas(doc, ['quota-exceeded', 'antigravity-credits']) || values.quotaAntigravityCredits) {
                        doc.setIn(['quota-exceeded', 'antigravity-credits'], values.quotaAntigravityCredits)
                    }
                    deleteIfMapEmpty(doc, ['quota-exceeded'])
                }

                setBooleanInDoc(doc, ['disable-cooling'], values.disableCooling)

                if (
                    docHas(doc, ['quota-refresh']) ||
                    values.quotaRefreshEnabled ||
                    values.quotaRefreshInterval.trim() ||
                    values.quotaRefreshMaxInterval.trim()
                ) {
                    ensureMapInDoc(doc, ['quota-refresh'])
                    doc.setIn(['quota-refresh', 'enabled'], values.quotaRefreshEnabled)
                    setIntFromStringInDoc(doc, ['quota-refresh', 'interval'], values.quotaRefreshInterval)
                    setIntFromStringInDoc(doc, ['quota-refresh', 'max-interval'], values.quotaRefreshMaxInterval)
                    deleteIfMapEmpty(doc, ['quota-refresh'])
                }

                if (
                    docHas(doc, ['routing']) ||
                    values.routingStrategy !== 'round-robin' ||
                    values.routingSessionAffinity ||
                    values.routingSessionAffinityTTL.trim()
                ) {
                    ensureMapInDoc(doc, ['routing'])
                    doc.setIn(['routing', 'strategy'], values.routingStrategy)
                    setBooleanInDoc(doc, ['routing', 'session-affinity'], values.routingSessionAffinity)
                    setStringInDoc(doc, ['routing', 'session-affinity-ttl'], values.routingSessionAffinityTTL)
                    deleteIfMapEmpty(doc, ['routing'])
                }

                const keepaliveSeconds           =
                          typeof values.streaming?.keepaliveSeconds === 'string' ?
                          values.streaming.keepaliveSeconds :
                          ''
                const bootstrapRetries           =
                          typeof values.streaming?.bootstrapRetries === 'string' ?
                          values.streaming.bootstrapRetries :
                          ''
                const nonstreamKeepaliveInterval =
                          typeof values.streaming?.nonstreamKeepaliveInterval === 'string'
                          ? values.streaming.nonstreamKeepaliveInterval
                          : ''

                const streamingDefined =
                          docHas(doc, ['streaming']) || keepaliveSeconds.trim() || bootstrapRetries.trim()
                if (streamingDefined) {
                    ensureMapInDoc(doc, ['streaming'])
                    setIntFromStringInDoc(doc, ['streaming', 'keepalive-seconds'], keepaliveSeconds)
                    setIntFromStringInDoc(doc, ['streaming', 'bootstrap-retries'], bootstrapRetries)
                    deleteIfMapEmpty(doc, ['streaming'])
                }

                setIntFromStringInDoc(doc, ['nonstream-keepalive-interval'], nonstreamKeepaliveInterval)

                if (
                    docHas(doc, ['payload']) ||
                    values.payloadDefaultRules.length > 0 ||
                    values.payloadDefaultRawRules.length > 0 ||
                    values.payloadOverrideRules.length > 0 ||
                    values.payloadOverrideRawRules.length > 0 ||
                    values.payloadFilterRules.length > 0
                ) {
                    ensureMapInDoc(doc, ['payload'])
                    if (values.payloadDefaultRules.length > 0) {
                        doc.setIn(['payload', 'default'], serializePayloadRulesForYaml(values.payloadDefaultRules))
                    } else if (docHas(doc, ['payload', 'default'])) {
                        doc.deleteIn(['payload', 'default'])
                    }
                    if (values.payloadDefaultRawRules.length > 0) {
                        doc.setIn(
                            ['payload', 'default-raw'],
                            serializeRawPayloadRulesForYaml(values.payloadDefaultRawRules),
                        )
                    } else if (docHas(doc, ['payload', 'default-raw'])) {
                        doc.deleteIn(['payload', 'default-raw'])
                    }
                    if (values.payloadOverrideRules.length > 0) {
                        doc.setIn(['payload', 'override'], serializePayloadRulesForYaml(values.payloadOverrideRules))
                    } else if (docHas(doc, ['payload', 'override'])) {
                        doc.deleteIn(['payload', 'override'])
                    }
                    if (values.payloadOverrideRawRules.length > 0) {
                        doc.setIn(
                            ['payload', 'override-raw'],
                            serializeRawPayloadRulesForYaml(values.payloadOverrideRawRules),
                        )
                    } else if (docHas(doc, ['payload', 'override-raw'])) {
                        doc.deleteIn(['payload', 'override-raw'])
                    }
                    if (values.payloadFilterRules.length > 0) {
                        doc.setIn(['payload', 'filter'], serializePayloadFilterRulesForYaml(values.payloadFilterRules))
                    } else if (docHas(doc, ['payload', 'filter'])) {
                        doc.deleteIn(['payload', 'filter'])
                    }
                    deleteIfMapEmpty(doc, ['payload'])
                }

                return doc.toString({ indent: 2, lineWidth: 120, minContentWidth: 0 })
            } catch {
                return currentYaml
            }
        },
        [apiKeysStorage, baselineValues, visualValues],
    )

    const setVisualValues = useCallback((newValues: Partial<VisualConfigValues>) => {
        setVisualValuesState((prev) => {
            const next: VisualConfigValues = { ...prev, ...newValues } as VisualConfigValues
            if (newValues.streaming) {
                next.streaming = { ...prev.streaming, ...newValues.streaming }
            }
            return next
        })
    }, [])

    return {
        visualValues,
        visualDirty,
        visualParseError,
        validationErrors,
        visualHasValidationErrors,
        visualHasPayloadValidationErrors,
        loadVisualValuesFromYaml,
        applyVisualChangesToYaml,
        setVisualValues,
    }
}

export const VISUAL_CONFIG_PROTOCOL_OPTIONS = [
    {
        value: '',
        labelKey: 'config_management.visual.payload_rules.provider_default',
        defaultLabel: 'Default',
    },
    {
        value: 'openai',
        labelKey: 'config_management.visual.payload_rules.provider_openai',
        defaultLabel: 'OpenAI',
    },
    {
        value: 'openai-response',
        labelKey: 'config_management.visual.payload_rules.provider_openai_response',
        defaultLabel: 'OpenAI Response',
    },
    {
        value: 'gemini',
        labelKey: 'config_management.visual.payload_rules.provider_gemini',
        defaultLabel: 'Gemini',
    },
    {
        value: 'claude',
        labelKey: 'config_management.visual.payload_rules.provider_claude',
        defaultLabel: 'Claude',
    },
    {
        value: 'codex',
        labelKey: 'config_management.visual.payload_rules.provider_codex',
        defaultLabel: 'Codex',
    },
    {
        value: 'antigravity',
        labelKey: 'config_management.visual.payload_rules.provider_antigravity',
        defaultLabel: 'Antigravity',
    },
] as const

export const VISUAL_CONFIG_PAYLOAD_VALUE_TYPE_OPTIONS = [
    {
        value: 'string',
        labelKey: 'config_management.visual.payload_rules.value_type_string',
        defaultLabel: 'String',
    },
    {
        value: 'number',
        labelKey: 'config_management.visual.payload_rules.value_type_number',
        defaultLabel: 'Number',
    },
    {
        value: 'boolean',
        labelKey: 'config_management.visual.payload_rules.value_type_boolean',
        defaultLabel: 'Boolean',
    },
    {
        value: 'json',
        labelKey: 'config_management.visual.payload_rules.value_type_json',
        defaultLabel: 'JSON',
    },
] as const satisfies ReadonlyArray<{
    value: PayloadParamValueType
    labelKey: string
    defaultLabel: string
}>
