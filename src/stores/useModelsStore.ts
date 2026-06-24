/**
 * 模型列表状态管理（带缓存）
 */

import {modelsApi} from '@/services/api/models'
import {getCacheExpiryMs} from '@/utils/constants'
import type {ModelInfo} from '@/utils/models'
import {create} from 'zustand'

type ModelsCacheScope = 'runtime' | 'public'

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
        const { cache, isCacheValid } = get()
        const canUseCache             = !apiKey

        if (canUseCache && !forceRefresh && isCacheValid(apiBase, 'public') && cache) {
            set({ models: cache.data, error: null })
            return cache.data
        }

        set({ loading: true, error: null })

        try {
            const list = await modelsApi.fetchModels(apiBase, apiKey)
            const now  = Date.now()

            set({
                    models: list,
                    loading: false,
                    cache: canUseCache ? { data: list, timestamp: now, apiBase, scope: 'public' } : null,
                })

            return list
        } catch (error: unknown) {
            const message =
                      error instanceof Error ?
                      error.message :
                      typeof error === 'string' ? error : 'Failed to fetch models'
            set({
                    error: message,
                    loading: false,
                    models: [],
                })
            throw error
        }
    },

    fetchRuntimeModels: async (apiBase, forceRefresh = false) => {
        const { runtimeCache, isCacheValid } = get()
        if (!forceRefresh && isCacheValid(apiBase, 'runtime') && runtimeCache) {
            set({ runtimeModels: runtimeCache.data, error: null })
            return runtimeCache.data
        }

        set({ loading: true, error: null })

        try {
            const list = await modelsApi.fetchRuntimeModels()
            const now  = Date.now()
            set({
                    runtimeModels: list,
                    loading: false,
                    runtimeCache: { data: list, timestamp: now, apiBase, scope: 'runtime' },
                })
            return list
        } catch (error: unknown) {
            const message =
                      error instanceof Error ?
                      error.message :
                      typeof error === 'string' ? error : 'Failed to fetch models'
            set({
                    error: message,
                    loading: false,
                    runtimeModels: [],
                })
            throw error
        }
    },

    clearCache: () => {
        set({ cache: null, runtimeCache: null, models: [], runtimeModels: [] })
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
