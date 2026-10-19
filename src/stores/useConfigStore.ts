/**
 * 配置状态管理
 * 从原项目 src/core/config-service.js 迁移
 */

import {configApi} from '@/services/api/config'
import type {Config} from '@/types'
import type {RawConfigSection} from '@/types/config'
import {getCacheExpiryMs} from '@/utils/constants'
import {create} from 'zustand'

interface ConfigCache {
    data: unknown
    timestamp: number
}

interface ConfigState {
    config: Config | null
    cache: Map<string, ConfigCache>
    loading: boolean
    error: string | null

    // 操作
    fetchConfig: {
        (section?: undefined, forceRefresh?: boolean): Promise<Config>
        (section: RawConfigSection, forceRefresh?: boolean): Promise<unknown>
    }
    updateConfigValue: (section: RawConfigSection, value: unknown) => void
    clearCache: (section?: RawConfigSection) => void
    isCacheValid: (section?: RawConfigSection) => boolean
}

let configRequestToken                                                     = 0
let inFlightConfigRequest: { id: number; promise: Promise<Config> } | null = null

interface ConfigSectionDescriptor {
    get: (config: Config) => unknown
    set: (config: Config, value: unknown) => void
}

function configField<K extends keyof Config>(key: K): ConfigSectionDescriptor {
    return {
        get: (config) => config[key],
        set: (config, value) => {
            config[key] = value as Config[K]
        },
    }
}

const CONFIG_SECTION_DESCRIPTORS: Record<RawConfigSection, ConfigSectionDescriptor> = {
    'debug': configField('debug'),
    'proxy-url': configField('proxyUrl'),
    'request-retry': configField('requestRetry'),
    'quota-exceeded': configField('quotaExceeded'),
    'usage-statistics-enabled': configField('usageStatisticsEnabled'),
    'request-log': configField('requestLog'),
    'logging-to-file': configField('loggingToFile'),
    'logs-max-total-size-mb': configField('logsMaxTotalSizeMb'),
    'error-logs-max-files': configField('errorLogsMaxFiles'),
    'usage-retention': configField('usageRetention'),
    'image-artifact-cache': configField('imageArtifactCache'),
    'ws-auth': configField('wsAuth'),
    'force-model-prefix': configField('forceModelPrefix'),
    'routing/strategy': configField('routingStrategy'),
    'api-keys': configField('apiKeys'),
    'gemini-api-key': configField('geminiApiKeys'),
    'interactions-api-key': configField('interactionsApiKeys'),
    'codex-api-key': configField('codexApiKeys'),
    'meta-api-key': configField('metaApiKeys'),
    'claude-api-key': configField('claudeApiKeys'),
    'xai-api-key': configField('xaiApiKeys'),
    'vertex-api-key': configField('vertexApiKeys'),
    'openai-compatibility': configField('openaiCompatibility'),
    'oauth-excluded-models': configField('oauthExcludedModels'),
    'auto-refresh-interval': configField('autoRefreshInterval'),
    'model-refresh-interval': configField('modelRefreshInterval'),
    'quota-refresh': configField('quotaRefresh'),
    'remote-management': configField('remoteManagement'),
    'plugins': configField('plugins'),
}

const SECTION_KEYS = Object.keys(CONFIG_SECTION_DESCRIPTORS) as RawConfigSection[]

const extractSectionValue = (config: Config | null, section?: RawConfigSection) =>
    config && section ? CONFIG_SECTION_DESCRIPTORS[section].get(config) : undefined

export const useConfigStore = create<ConfigState>((set, get) => ({
    config: null,
    cache: new Map(),
    loading: false,
    error: null,

    fetchConfig: (async (section?: RawConfigSection, forceRefresh: boolean = false) => {
        const { cache, isCacheValid } = get()

        // 检查缓存
        const cacheKey = section || '__full__'
        if (!forceRefresh && isCacheValid(section)) {
            const cached = cache.get(cacheKey)
            if (cached) {
                return cached.data
            }
        }

        // section 缓存未命中但 full 缓存可用时，直接复用已获取到的配置，避免重复 /config 请求
        if (!forceRefresh && section && isCacheValid()) {
            const fullCached = cache.get('__full__')
            if (fullCached?.data) {
                return extractSectionValue(fullCached.data as Config, section)
            }
        }

        // 同一时刻合并多个 /config 请求（如 StrictMode 或多个页面同时触发）
        if (inFlightConfigRequest) {
            const data = await inFlightConfigRequest.promise
            return section ? extractSectionValue(data, section) : data
        }

        // 获取新数据
        set({ loading: true, error: null })

        const requestId = (configRequestToken += 1)
        try {
            const requestPromise  = configApi.getConfig()
            inFlightConfigRequest = { id: requestId, promise: requestPromise }
            const data            = await requestPromise
            const now             = Date.now()

            // 如果在请求过程中连接已被切换/登出，
            // 则忽略旧请求的结果，避免覆盖新会话的状态
            if (requestId !== configRequestToken) {
                return section ? extractSectionValue(data, section) : data
            }

            // 更新缓存
            const newCache = new Map(cache)
            newCache.set('__full__', { data, timestamp: now })
            SECTION_KEYS.forEach((key) => {
                const value = extractSectionValue(data, key)
                if (value !== undefined) {
                    newCache.set(key, { data: value, timestamp: now })
                }
            })

            set({
                    config: data,
                    cache: newCache,
                    loading: false,
                })

            return section ? extractSectionValue(data, section) : data
        } catch (error: unknown) {
            const message =
                      error instanceof Error ?
                      error.message :
                      typeof error === 'string' ? error : 'Failed to fetch config'
            if (requestId === configRequestToken) {
                set({
                        error: message || 'Failed to fetch config',
                        loading: false,
                    })
            }
            throw error
        } finally {
            if (inFlightConfigRequest?.id === requestId) {
                inFlightConfigRequest = null
            }
        }
    }) as ConfigState['fetchConfig'],

    updateConfigValue: (section, value) => {
        set((state) => {
            const raw                = { ...(state.config?.raw || {}) }
            raw[section]             = value
            const nextConfig: Config = { ...(state.config || {}), raw }

            CONFIG_SECTION_DESCRIPTORS[section].set(nextConfig, value)

            return { config: nextConfig }
        })

        // 清除该 section 的缓存
        get().clearCache(section)
    },

    clearCache: (section) => {
        const { cache } = get()
        const newCache  = new Map(cache)

        // 任何配置变更都使更早发出的全量请求失效
        configRequestToken += 1
        inFlightConfigRequest = null

        if (section) {
            newCache.delete(section)
            // 同时清除完整配置缓存
            newCache.delete('__full__')

            set({ cache: newCache, loading: false })
            return
        } else {
            newCache.clear()
        }

        set({ config: null, cache: newCache, loading: false, error: null })
    },

    isCacheValid: (section) => {
        const { cache } = get()
        const cacheKey  = section || '__full__'
        const cached    = cache.get(cacheKey)

        if (!cached) {
            return false
        }

        return Date.now() - cached.timestamp < getCacheExpiryMs()
    },
}))
