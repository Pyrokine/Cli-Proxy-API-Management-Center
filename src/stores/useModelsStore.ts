/**
 * 模型列表状态管理（带缓存）
 */

import {modelsApi} from '@/services/api/models'
import {getCacheExpiryMs} from '@/utils/constants'
import type {ModelInfo} from '@/utils/models'
import {create} from 'zustand'

type ModelsCacheScope = 'runtime' | 'public'

let publicRequestGeneration  = 0
let runtimeRequestGeneration = 0

interface ModelsRequest {
    key: string
    generation: number
    controller: AbortController
    promise: Promise<ModelInfo[]>
}

let publicRequest: ModelsRequest | null  = null
let runtimeRequest: ModelsRequest | null = null

const getPublicRequestKey = (apiBase: string, apiKey?: string): string => JSON.stringify([apiBase, apiKey ?? ''])

interface ModelsCache {
    data: ModelInfo[]
    timestamp: number
    apiBase: string
    scope: ModelsCacheScope
}

interface ModelsState {
    models: ModelInfo[]
    runtimeModels: ModelInfo[]
    loading: boolean
    error: string | null
    cache: ModelsCache | null
    runtimeCache: ModelsCache | null

    fetchModels: (apiBase: string, apiKey?: string, forceRefresh?: boolean) => Promise<ModelInfo[]>
    fetchRuntimeModels: (apiBase: string, forceRefresh?: boolean) => Promise<ModelInfo[]>
    clearCache: () => void
    isCacheValid: (apiBase: string, scope?: ModelsCacheScope) => boolean
}

export const useModelsStore = create<ModelsState>((set, get) => ({
    models: [],
    runtimeModels: [],
    loading: false,
    error: null,
    cache: null,
    runtimeCache: null,

    fetchModels: async (apiBase, apiKey, forceRefresh = false) => {
        const requestKey               = getPublicRequestKey(apiBase, apiKey)
        const { cache, isCacheValid } = get()
        const canUseCache             = !apiKey

        if (!forceRefresh && publicRequest?.key === requestKey) {
            return publicRequest.promise
        }

        if (canUseCache && !forceRefresh && isCacheValid(apiBase, 'public') && cache) {
            if (publicRequest) {
                ++publicRequestGeneration
                publicRequest.controller.abort()
                publicRequest = null
            }
            set({ models: cache.data, loading: false, error: null })
            return cache.data
        }

        publicRequest?.controller.abort()
        const requestGeneration = ++publicRequestGeneration
        const controller        = new AbortController()
        const requestPromise    = modelsApi.fetchModels(apiBase, apiKey, {}, { signal: controller.signal })
        publicRequest           = { key: requestKey, generation: requestGeneration, controller, promise: requestPromise }
        set({ loading: true, error: null })

        try {
            const list = await requestPromise
            const now  = Date.now()

            if (requestGeneration === publicRequestGeneration) {
                set({
                        models: list,
                        loading: false,
                        error: null,
                        cache: canUseCache ? { data: list, timestamp: now, apiBase, scope: 'public' } : null,
                    })
            }

            return list
        } catch (error: unknown) {
            const message =
                      error instanceof Error ?
                      error.message :
                      typeof error === 'string' ? error : 'Failed to fetch models'
            if (requestGeneration === publicRequestGeneration) {
                set({
                        error: message,
                        loading: false,
                        models: [],
                    })
            }
            throw error
        } finally {
            if (publicRequest?.generation === requestGeneration) {
                publicRequest = null
            }
        }
    },

    fetchRuntimeModels: async (apiBase, forceRefresh = false) => {
        const { runtimeCache, isCacheValid } = get()
        if (!forceRefresh && runtimeRequest?.key === apiBase) {
            return runtimeRequest.promise
        }

        if (!forceRefresh && isCacheValid(apiBase, 'runtime') && runtimeCache) {
            if (runtimeRequest) {
                ++runtimeRequestGeneration
                runtimeRequest.controller.abort()
                runtimeRequest = null
            }
            set({ runtimeModels: runtimeCache.data, loading: false, error: null })
            return runtimeCache.data
        }

        runtimeRequest?.controller.abort()
        const requestGeneration = ++runtimeRequestGeneration
        const controller        = new AbortController()
        const requestPromise    = modelsApi.fetchRuntimeModels({ signal: controller.signal })
        runtimeRequest          = { key: apiBase, generation: requestGeneration, controller, promise: requestPromise }
        set({ loading: true, error: null })

        try {
            const list = await requestPromise
            const now  = Date.now()
            if (requestGeneration === runtimeRequestGeneration) {
                set({
                        runtimeModels: list,
                        loading: false,
                        error: null,
                        runtimeCache: { data: list, timestamp: now, apiBase, scope: 'runtime' },
                    })
            }
            return list
        } catch (error: unknown) {
            const message =
                      error instanceof Error ?
                      error.message :
                      typeof error === 'string' ? error : 'Failed to fetch models'
            if (requestGeneration === runtimeRequestGeneration) {
                set({
                        error: message,
                        loading: false,
                        runtimeModels: [],
                    })
            }
            throw error
        } finally {
            if (runtimeRequest?.generation === requestGeneration) {
                runtimeRequest = null
            }
        }
    },

    clearCache: () => {
        ++publicRequestGeneration
        ++runtimeRequestGeneration
        publicRequest?.controller.abort()
        runtimeRequest?.controller.abort()
        publicRequest  = null
        runtimeRequest = null
        set({ cache: null, runtimeCache: null, models: [], runtimeModels: [], loading: false, error: null })
    },

    isCacheValid: (apiBase, scope = 'public') => {
        const { cache, runtimeCache } = get()
        const targetCache             = scope === 'runtime' ? runtimeCache : cache
        if (!targetCache) {
            return false
        }
        if (targetCache.scope !== scope) {
            return false
        }
        if (targetCache.apiBase !== apiBase) {
            return false
        }
        return Date.now() - targetCache.timestamp < getCacheExpiryMs()
    },
}))
