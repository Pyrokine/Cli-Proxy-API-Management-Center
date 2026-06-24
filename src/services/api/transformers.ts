import type {
    AmpcodeConfig,
    AmpcodeModelMapping,
    AmpcodeUpstreamApiKeyMapping,
    ApiKeyEntry,
    CloakConfig,
    GeminiKeyConfig,
    ModelAlias,
    OpenAIProviderConfig,
    ProviderKeyConfig,
} from '@/types'
import type {Config, PluginsConfig, RemoteManagementConfig} from '@/types/config'
import {buildHeaderObject} from '@/utils/headers'

const isRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value)

const normalizeBoolean = (value: unknown): boolean | undefined => {
    if (value === undefined || value === null) {
        return undefined
    }
    return typeof value === 'boolean' ? value : undefined
}

const normalizeNumber = (value: unknown, min?: number): number | undefined => {
    if (value === undefined || value === null) {
        return undefined
    }
    if (typeof value === 'string' && value.trim() === '') {
        return undefined
    }
    const parsed = typeof value === 'number' ? value : Number(value)
    if (!Number.isFinite(parsed)) {
        return undefined
    }
    if (min !== undefined && parsed < min) {
        return undefined
    }
    return parsed
}

const normalizeModelAliases = (models: unknown): ModelAlias[] => {
    if (!Array.isArray(models)) {
        return []
    }
    return models
        .map((item) => {
            if (item === undefined || item === null) {
                return null
            }
            if (typeof item === 'string') {
                const trimmed = item.trim()
                return trimmed ? ({ name: trimmed } satisfies ModelAlias) : null
            }
            if (!isRecord(item)) {
                return null
            }

            const name = item.name
            if (!name) {
                return null
            }
            const alias             = item.alias
            const priority          = item.priority
            const testModel         = item['test-model']
            const entry: ModelAlias = { name: String(name) }
            if (alias && alias !== name) {
                entry.alias = String(alias)
            }
            if (priority !== undefined) {
                const parsed = Number(priority)
                if (Number.isFinite(parsed)) {
                    entry.priority = parsed
                }
            }
            if (testModel) {
                entry.testModel = String(testModel)
            }
            return entry
        })
        .filter(Boolean) as ModelAlias[]
}

const normalizeHeaders = (headers: unknown) => {
    if (!headers || typeof headers !== 'object') {
        return undefined
    }
    const normalized = buildHeaderObject(
        Array.isArray(headers)
        ? (headers as Array<{ key: string; value: string }>)
        : (headers as Record<string, string | undefined | null>),
    )
    return Object.keys(normalized).length ? normalized : undefined
}

const normalizeExcludedModels = (input: unknown): string[] => {
    const rawList              = Array.isArray(input) ? input : typeof input === 'string' ? input.split(/[\n,]/) : []
    const seen                 = new Set<string>()
    const normalized: string[] = []

    rawList.forEach((item) => {
        const trimmed = String(item ?? '').trim()
        if (!trimmed) {
            return
        }
        const key = trimmed.toLowerCase()
        if (seen.has(key)) {
            return
        }
        seen.add(key)
        normalized.push(trimmed)
    })

    return normalized
}

const normalizePrefix = (value: unknown): string | undefined => {
    if (value === undefined || value === null) {
        return undefined
    }
    const trimmed = String(value).trim()
    return trimmed ? trimmed : undefined
}

const normalizePriority = (record: Record<string, unknown> | null): number | undefined => {
    const raw = record?.priority
    if (raw === undefined || raw === null || String(raw).trim() === '') {
        return undefined
    }
    const parsed = Number(raw)
    return Number.isFinite(parsed) ? parsed : undefined
}

const normalizeApiKeyEntry = (entry: unknown): ApiKeyEntry | null => {
    if (entry === undefined || entry === null) {
        return null
    }
    const record  = isRecord(entry) ? entry : null
    const apiKey  = record?.['api-key'] ?? (typeof entry === 'string' ? entry : '')
    const trimmed = String(apiKey || '').trim()
    if (!trimmed) {
        return null
    }

    const proxyUrl   = record?.['proxy-url']
    const headers    = record ? normalizeHeaders(record.headers) : undefined
    const authIndex  = record?.['auth-index']
    const normalized = typeof authIndex === 'string' || typeof authIndex === 'number' ? String(authIndex).trim() : ''

    return {
        apiKey: trimmed,
        proxyUrl: proxyUrl ? String(proxyUrl) : undefined,
        headers,
        authIndex: normalized || undefined,
    }
}

const normalizeProviderKeyConfig = (item: unknown): ProviderKeyConfig | null => {
    if (item === undefined || item === null) {
        return null
    }
    const record  = isRecord(item) ? item : null
    const apiKey  = record?.['api-key'] ?? (typeof item === 'string' ? item : '')
    const trimmed = String(apiKey || '').trim()
    if (!trimmed) {
        return null
    }

    const config: ProviderKeyConfig = { apiKey: trimmed }
    const priority                  = normalizePriority(record)
    if (priority !== undefined) {
        config.priority = priority
    }
    const prefix = normalizePrefix(record?.prefix)
    if (prefix) {
        config.prefix = prefix
    }
    const baseUrl  = record?.['base-url']
    const proxyUrl = record?.['proxy-url']
    if (baseUrl) {
        config.baseUrl = String(baseUrl)
    }
    const websockets = normalizeBoolean(record?.websockets ?? record?.['websockets'])
    if (websockets !== undefined) {
        config.websockets = websockets
    }
    if (proxyUrl) {
        config.proxyUrl = String(proxyUrl)
    }
    const headers = normalizeHeaders(record?.headers)
    if (headers) {
        config.headers = headers
    }
    const models = normalizeModelAliases(record?.models)
    if (models.length) {
        config.models = models
    }
    const excludedModels = normalizeExcludedModels(record?.['excluded-models'])
    if (excludedModels.length) {
        config.excludedModels = excludedModels
    }

    const cloakRaw = record?.cloak
    if (isRecord(cloakRaw)) {
        const cloak: CloakConfig = {}
        const mode               = cloakRaw.mode
        if (typeof mode === 'string' && mode.trim()) {
            cloak.mode = mode.trim()
        }
        const strictMode = normalizeBoolean(cloakRaw['strict-mode'])
        if (strictMode !== undefined) {
            cloak.strictMode = strictMode
        }
        const sensitiveWords = normalizeExcludedModels(cloakRaw['sensitive-words'])
        if (sensitiveWords.length) {
            cloak.sensitiveWords = sensitiveWords
        }
        if (Object.keys(cloak).length) {
            config.cloak = cloak
        }
    }

    return config
}

const normalizeGeminiKeyConfig = (item: unknown): GeminiKeyConfig | null => {
    if (item === undefined || item === null) {
        return null
    }
    const record = isRecord(item) ? item : null
    let apiKey   = record?.['api-key']
    if (!apiKey && typeof item === 'string') {
        apiKey = item
    }
    const trimmed = String(apiKey || '').trim()
    if (!trimmed) {
        return null
    }

    const config: GeminiKeyConfig = { apiKey: trimmed }
    const priority                = normalizePriority(record)
    if (priority !== undefined) {
        config.priority = priority
    }
    const prefix = normalizePrefix(record?.prefix)
    if (prefix) {
        config.prefix = prefix
    }
    const baseUrl = record?.['base-url']
    if (baseUrl) {
        config.baseUrl = String(baseUrl)
    }
    const proxyUrl = record?.['proxy-url']
    if (proxyUrl) {
        config.proxyUrl = String(proxyUrl)
    }
    const models = normalizeModelAliases(record?.models)
    if (models.length) {
        config.models = models
    }
    const headers = normalizeHeaders(record?.headers)
    if (headers) {
        config.headers = headers
    }
    const excludedModels = normalizeExcludedModels(record?.['excluded-models'])
    if (excludedModels.length) {
        config.excludedModels = excludedModels
    }
    return config
}

const normalizeOpenAIProvider = (provider: unknown): OpenAIProviderConfig | null => {
    if (!isRecord(provider)) {
        return null
    }
    const name    = provider.name
    const baseUrl = provider['base-url']
    if (!name || !baseUrl) {
        return null
    }

    let apiKeyEntries: ApiKeyEntry[] = []
    if (Array.isArray(provider['api-key-entries'])) {
        apiKeyEntries = provider['api-key-entries']
            .map((entry) => normalizeApiKeyEntry(entry))
            .filter(Boolean) as ApiKeyEntry[]
    } else if (Array.isArray(provider['api-keys'])) {
        apiKeyEntries = provider['api-keys']
            .map((key) => normalizeApiKeyEntry({ 'api-key': key }))
            .filter(Boolean) as ApiKeyEntry[]
    }

    const headers   = normalizeHeaders(provider.headers)
    const models    = normalizeModelAliases(provider.models)
    const priority  = provider.priority
    const testModel = provider['test-model']
    const disabled  = normalizeBoolean(provider.disabled)
    const authIndex = provider['auth-index']

    const result: OpenAIProviderConfig = {
        name: String(name),
        baseUrl: String(baseUrl),
        apiKeyEntries,
    }

    const prefix = normalizePrefix(provider.prefix ?? provider['prefix'])
    if (prefix) {
        result.prefix = prefix
    }
    if (headers) {
        result.headers = headers
    }
    if (models.length) {
        result.models = models
    }
    if (priority !== undefined) {
        result.priority = Number(priority)
    }
    if (testModel) {
        result.testModel = String(testModel)
    }
    if (disabled !== undefined) {
        result.disabled = disabled
    }
    if (typeof authIndex === 'string' || typeof authIndex === 'number') {
        const normalizedAuthIndex = String(authIndex).trim()
        if (normalizedAuthIndex) {
            result.authIndex     = normalizedAuthIndex
            result.apiKeyEntries = result.apiKeyEntries.map((entry) => ({
                ...entry,
                authIndex: entry.authIndex ?? normalizedAuthIndex,
            }))
        }
    }
    return result
}

const normalizeOauthExcluded = (payload: unknown): Record<string, string[]> | undefined => {
    if (!isRecord(payload)) {
        return undefined
    }
    const source = payload['oauth-excluded-models'] ?? payload
    if (!isRecord(source)) {
        return undefined
    }
    const map: Record<string, string[]> = {}
    Object.entries(source).forEach(([provider, models]) => {
        const key = String(provider || '').trim()
        if (!key) {
            return
        }
        map[key.toLowerCase()] = normalizeExcludedModels(models)
    })
    return map
}

const normalizeAmpcodeModelMappings = (input: unknown): AmpcodeModelMapping[] => {
    if (!Array.isArray(input)) {
        return []
    }
    const seen                            = new Set<string>()
    const mappings: AmpcodeModelMapping[] = []

    input.forEach((entry) => {
        if (!isRecord(entry)) {
            return
        }
        const from = String(entry.from ?? entry['from'] ?? '').trim()
        const to   = String(entry.to ?? entry['to'] ?? '').trim()
        if (!from || !to) {
            return
        }
        const key = from.toLowerCase()
        if (seen.has(key)) {
            return
        }
        seen.add(key)
        mappings.push({ from, to })
    })

    return mappings
}

const normalizeAmpcodeUpstreamApiKeys = (input: unknown): AmpcodeUpstreamApiKeyMapping[] => {
    if (!Array.isArray(input)) {
        return []
    }

    const seen                                     = new Set<string>()
    const mappings: AmpcodeUpstreamApiKeyMapping[] = []

    input.forEach((entry) => {
        if (!isRecord(entry)) {
            return
        }

        const upstreamApiKey = String(entry['upstream-api-key'] ?? '').trim()
        if (!upstreamApiKey || seen.has(upstreamApiKey)) {
            return
        }

        const rawApiKeys = entry['api-keys'] ?? []
        const apiKeys    = Array.isArray(rawApiKeys)
                           ? Array.from(new Set(rawApiKeys.map((item) => String(item ?? '').trim()).filter(Boolean)))
                           : []
        if (!apiKeys.length) {
            return
        }

        seen.add(upstreamApiKey)
        mappings.push({ upstreamApiKey, apiKeys })
    })

    return mappings
}

const normalizePluginsConfig = (payload: unknown): PluginsConfig | undefined => {
    if (!isRecord(payload)) {
        return undefined
    }

    const config: PluginsConfig = {}
    const enabled               = normalizeBoolean(payload.enabled)
    if (enabled !== undefined) {
        config.enabled = enabled
    }
    if (typeof payload.dir === 'string' && payload.dir.trim()) {
        config.dir = payload.dir.trim()
    }
    const rawConfigs = payload.configs
    if (isRecord(rawConfigs)) {
        config.configs = {}
        Object.entries(rawConfigs).forEach(([id, value]) => {
            if (!isRecord(value)) {
                return
            }
            config.configs![id] = { ...value }
            const itemEnabled   = normalizeBoolean(value.enabled)
            if (itemEnabled !== undefined) {
                config.configs![id].enabled = itemEnabled
            }
            const priority = normalizeNumber(value.priority)
            if (priority !== undefined) {
                config.configs![id].priority = priority
            }
        })
    }

    return Object.keys(config).length ? config : undefined
}

const normalizeRemoteManagementConfig = (payload: unknown): RemoteManagementConfig | undefined => {
    if (!isRecord(payload)) {
        return undefined
    }

    const config: RemoteManagementConfig = {}
    const allowRemote                    = normalizeBoolean(payload['allow-remote'])
    if (allowRemote !== undefined) {
        config.allowRemote = allowRemote
    }
    const secretKey = payload['secret-key']
    if (typeof secretKey === 'string' && secretKey.trim()) {
        config.secretKey = secretKey
    }
    const disableControlPanel = normalizeBoolean(payload['disable-control-panel'])
    if (disableControlPanel !== undefined) {
        config.disableControlPanel = disableControlPanel
    }
    const autoUpdatePanel = normalizeBoolean(payload['auto-update-panel'])
    if (autoUpdatePanel !== undefined) {
        config.autoUpdatePanel = autoUpdatePanel
    }
    const autoUpdateCPA = normalizeBoolean(payload['auto-update-cpa'])
    if (autoUpdateCPA !== undefined) {
        config.autoUpdateCPA = autoUpdateCPA
    }
    const autoCheckUpdate = normalizeBoolean(payload['auto-check-update'])
    if (autoCheckUpdate !== undefined) {
        config.autoCheckUpdate = autoCheckUpdate
    }
    const checkInterval = payload['check-interval']
    if (checkInterval !== undefined && checkInterval !== null) {
        const parsed = Number(checkInterval)
        if (Number.isFinite(parsed)) {
            config.checkInterval = parsed
        }
    }
    const panelGithubRepository = payload['panel-github-repository']
    if (typeof panelGithubRepository === 'string' && panelGithubRepository.trim()) {
        config.panelGithubRepository = panelGithubRepository
    }
    const cpaGithubRepository = payload['cpa-github-repository']
    if (typeof cpaGithubRepository === 'string' && cpaGithubRepository.trim()) {
        config.cpaGithubRepository = cpaGithubRepository
    }

    return Object.keys(config).length ? config : undefined
}

const normalizeAmpcodeConfig = (payload: unknown): AmpcodeConfig | undefined => {
    const sourceRaw = isRecord(payload) ? (payload.ampcode ?? payload) : payload
    if (!isRecord(sourceRaw)) {
        return undefined
    }
    const source = sourceRaw

    const config: AmpcodeConfig = {}
    const upstreamUrl           = source['upstream-url']
    if (upstreamUrl) {
        config.upstreamUrl = String(upstreamUrl)
    }
    const upstreamApiKey = source['upstream-api-key']
    if (upstreamApiKey) {
        config.upstreamApiKey = String(upstreamApiKey)
    }

    const upstreamApiKeys = normalizeAmpcodeUpstreamApiKeys(source['upstream-api-keys'])
    if (upstreamApiKeys.length) {
        config.upstreamApiKeys = upstreamApiKeys
    }

    const forceModelMappings = normalizeBoolean(source['force-model-mappings'])
    if (forceModelMappings !== undefined) {
        config.forceModelMappings = forceModelMappings
    }

    const modelMappings = normalizeAmpcodeModelMappings(source['model-mappings'])
    if (modelMappings.length) {
        config.modelMappings = modelMappings
    }

    return config
}

/**
 * 规范化 /config 返回值
 */
export const normalizeConfigResponse = (raw: unknown): Config => {
    const config: Config = { raw: isRecord(raw) ? raw : {} }
    if (!isRecord(raw)) {
        return config
    }

    config.debug       = normalizeBoolean(raw.debug)
    const proxyUrl     = raw['proxy-url']
    config.proxyUrl    =
        typeof proxyUrl === 'string'
        ? proxyUrl
        : proxyUrl === undefined || proxyUrl === null
          ? undefined
          : String(proxyUrl)
    const requestRetry = raw['request-retry']
    if (typeof requestRetry === 'number' && Number.isFinite(requestRetry)) {
        config.requestRetry = requestRetry
    } else if (typeof requestRetry === 'string' && requestRetry.trim() !== '') {
        const parsed = Number(requestRetry)
        if (Number.isFinite(parsed)) {
            config.requestRetry = parsed
        }
    }

    const quota = raw['quota-exceeded']
    if (isRecord(quota)) {
        config.quotaExceeded = {
            switchProject: normalizeBoolean(quota['switch-project']),
            switchPreviewModel: normalizeBoolean(quota['switch-preview-model']),
            antigravityCredits: normalizeBoolean(quota['antigravity-credits']),
        }
    }

    const quotaRefresh = raw['quota-refresh']
    if (isRecord(quotaRefresh)) {
        const enabled     = normalizeBoolean(quotaRefresh.enabled)
        const interval    = normalizeNumber(quotaRefresh.interval, 0)
        const maxInterval = normalizeNumber(quotaRefresh['max-interval'], 0)
        if (enabled !== undefined || interval !== undefined || maxInterval !== undefined) {
            config.quotaRefresh = {}
            if (enabled !== undefined) {
                config.quotaRefresh.enabled = enabled
            }
            if (interval !== undefined) {
                config.quotaRefresh.interval = interval
            }
            if (maxInterval !== undefined) {
                config.quotaRefresh.maxInterval = maxInterval
            }
        }
    }

    config.usageStatisticsEnabled = normalizeBoolean(raw['usage-statistics-enabled'])
    config.requestLog             = normalizeBoolean(raw['request-log'])
    config.loggingToFile          = normalizeBoolean(raw['logging-to-file'])
    const logsMaxTotalSizeMb      = raw['logs-max-total-size-mb']
    if (typeof logsMaxTotalSizeMb === 'number' && Number.isFinite(logsMaxTotalSizeMb)) {
        config.logsMaxTotalSizeMb = logsMaxTotalSizeMb
    } else if (typeof logsMaxTotalSizeMb === 'string' && logsMaxTotalSizeMb.trim() !== '') {
        const parsed = Number(logsMaxTotalSizeMb)
        if (Number.isFinite(parsed)) {
            config.logsMaxTotalSizeMb = parsed
        }
    }
    const errorLogsMaxFiles = raw['error-logs-max-files']
    if (typeof errorLogsMaxFiles === 'number' && Number.isFinite(errorLogsMaxFiles)) {
        config.errorLogsMaxFiles = errorLogsMaxFiles
    } else if (typeof errorLogsMaxFiles === 'string' && errorLogsMaxFiles.trim() !== '') {
        const parsed = Number(errorLogsMaxFiles)
        if (Number.isFinite(parsed)) {
            config.errorLogsMaxFiles = parsed
        }
    }
    const usageRetention = raw['usage-retention']
    if (isRecord(usageRetention)) {
        const days                = normalizeNumber(usageRetention.days, 0)
        const maxDbSizeMb         = normalizeNumber(usageRetention['max-db-size-mb'], 0)
        const warningThresholdPct = normalizeNumber(usageRetention['warning-threshold-pct'], 0)
        if (days !== undefined || maxDbSizeMb !== undefined || warningThresholdPct !== undefined) {
            config.usageRetention = {}
            if (days !== undefined) {
                config.usageRetention.days = days
            }
            if (maxDbSizeMb !== undefined) {
                config.usageRetention.maxDbSizeMb = maxDbSizeMb
            }
            if (warningThresholdPct !== undefined) {
                config.usageRetention.warningThresholdPct = warningThresholdPct
            }
        }
    }
    config.wsAuth           = normalizeBoolean(raw['ws-auth'])
    config.forceModelPrefix = normalizeBoolean(raw['force-model-prefix'])
    const routing           = raw.routing
    const strategyRaw       = isRecord(routing) ? routing.strategy : raw['routing-strategy']
    if (strategyRaw !== undefined && strategyRaw !== null) {
        config.routingStrategy = String(strategyRaw)
    }
    const sessionAffinity = isRecord(routing) ? normalizeBoolean(routing['session-affinity']) : undefined
    if (sessionAffinity !== undefined) {
        config.routingSessionAffinity = sessionAffinity
    }
    const sessionAffinityTtl = isRecord(routing) ? routing['session-affinity-ttl'] : undefined
    if (typeof sessionAffinityTtl === 'string' && sessionAffinityTtl.trim()) {
        config.routingSessionAffinityTTL = sessionAffinityTtl.trim()
    }
    const apiKeysRaw = raw['api-keys']
    if (Array.isArray(apiKeysRaw)) {
        config.apiKeys = apiKeysRaw.map((key) => String(key)).filter((key) => key.trim() !== '')
    }

    const geminiList = raw['gemini-api-key']
    if (Array.isArray(geminiList)) {
        config.geminiApiKeys = geminiList
            .map((item) => normalizeGeminiKeyConfig(item))
            .filter(Boolean) as GeminiKeyConfig[]
    }

    const codexList = raw['codex-api-key']
    if (Array.isArray(codexList)) {
        config.codexApiKeys = codexList
            .map((item) => normalizeProviderKeyConfig(item))
            .filter(Boolean) as ProviderKeyConfig[]
    }

    const claudeList = raw['claude-api-key']
    if (Array.isArray(claudeList)) {
        config.claudeApiKeys = claudeList
            .map((item) => normalizeProviderKeyConfig(item))
            .filter(Boolean) as ProviderKeyConfig[]
    }

    const vertexList = raw['vertex-api-key']
    if (Array.isArray(vertexList)) {
        config.vertexApiKeys = vertexList
            .map((item) => normalizeProviderKeyConfig(item))
            .filter(Boolean) as ProviderKeyConfig[]
    }

    const openaiList = raw['openai-compatibility']
    if (Array.isArray(openaiList)) {
        config.openaiCompatibility = openaiList
            .map((item) => normalizeOpenAIProvider(item))
            .filter(Boolean) as OpenAIProviderConfig[]
    }

    const ampcode = normalizeAmpcodeConfig(raw.ampcode)
    if (ampcode) {
        config.ampcode = ampcode
    }

    const oauthExcluded = normalizeOauthExcluded(raw['oauth-excluded-models'])
    if (oauthExcluded) {
        config.oauthExcludedModels = oauthExcluded
    }

    const autoRefreshRaw      = raw['auto-refresh-interval']
    const autoRefreshInterval = normalizeNumber(autoRefreshRaw, 0)
    if (autoRefreshInterval !== undefined) {
        config.autoRefreshInterval = autoRefreshInterval
    }

    const modelRefreshRaw      = raw['model-refresh-interval']
    const modelRefreshInterval = normalizeNumber(modelRefreshRaw, 0)
    if (modelRefreshInterval !== undefined) {
        config.modelRefreshInterval = modelRefreshInterval
    }

    const remoteManagement = normalizeRemoteManagementConfig(raw['remote-management'])
    if (remoteManagement) {
        config.remoteManagement = remoteManagement
    }

    const plugins = normalizePluginsConfig(raw.plugins)
    if (plugins) {
        config.plugins = plugins
    }

    return config
}

export {normalizeGeminiKeyConfig, normalizeOpenAIProvider, normalizeProviderKeyConfig, normalizeAmpcodeConfig}
