/**
 * API 密钥管理
 */

import i18n from '@/i18n'
import type {AxiosRequestConfig} from 'axios'
import {apiClient} from './client'

export const apiKeysApi = {
    async list(config?: AxiosRequestConfig): Promise<string[]> {
        const data = await apiClient.get<string[] | { 'api-keys'?: unknown }>('/api-keys', config)
        const keys = Array.isArray(data) ? data : data['api-keys']
        return Array.isArray(keys) ? keys.map((key) => String(key)) : []
    },

    async search(query: string, config?: AxiosRequestConfig): Promise<string[]> {
        const data    = await apiClient.get<{ 'api-keys'?: unknown; 'api-key-matches'?: unknown } | null>('/api-keys', {
            ...config, params: { ...config?.params, api_key_search: query },
        })
        const keys    = data?.['api-keys']
        const matches = data?.['api-key-matches']
        if (!Array.isArray(keys) ||
            keys.some((key) => typeof key !== 'string' || !/^__CLI_PROXY_CONFIG_SECRET_[0-9a-f]{32}__$/.test(key))) {
            throw new Error(i18n.t('config_management.visual.api_keys.search_failed'))
        }
        const references = new Set(keys)
        if (!Array.isArray(matches) || matches.some((match) => !references.has(match))) {
            throw new Error(i18n.t('config_management.visual.api_keys.search_failed'))
        }
        return matches
    },

    replace: (keys: string[]) => apiClient.put('/api-keys', keys, { mutationReadback: () => apiKeysApi.list() }),

    update: (index: number, value: string) => apiClient.patch(
        '/api-keys',
        { index, value },
        { mutationReadback: () => apiKeysApi.list() },
    ),

    delete: (index: number) => apiClient.delete(
        `/api-keys?index=${index}`,
        { mutationReadback: () => apiKeysApi.list() },
    ),
}

export const apiKeyAliasApi = {
    async list(): Promise<Record<string, string>> {
        const data = await apiClient.get<Record<string, unknown>>('/api-key-aliases')
        return (data['api-key-aliases'] ?? {}) as Record<string, string>
    },

    set: (key: string, alias: string) => apiClient.patch(
        '/api-key-aliases',
        { key, alias },
        { mutationReadback: () => apiKeyAliasApi.list() },
    ),

    remove: (key: string) => apiClient.delete(
        '/api-key-aliases',
        { ...({ data: { key } }), mutationReadback: () => apiKeyAliasApi.list() },
    ),
}
