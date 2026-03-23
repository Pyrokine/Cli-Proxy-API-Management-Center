/**
 * API 密钥管理
 */

import {apiClient} from './client'

export const apiKeysApi = {
    async list(): Promise<string[]> {
        const data = await apiClient.get<Record<string, unknown>>('/api-keys')
        const keys = data['api-keys'] ?? data.apiKeys
        return Array.isArray(keys) ? keys.map((key) => String(key)) : []
    },

    replace: (keys: string[]) => apiClient.put('/api-keys', keys),

    update: (index: number, value: string) => apiClient.patch('/api-keys', { index, value }),

    delete: (index: number) => apiClient.delete(`/api-keys?index=${index}`),
}

export const apiKeyAliasApi = {
    async list(): Promise<Record<string, string>> {
        const data = await apiClient.get<Record<string, unknown>>('/api-key-aliases')
        return (data['api-key-aliases'] ?? {}) as Record<string, string>
    },

    set: (key: string, alias: string) => apiClient.patch('/api-key-aliases', { key, alias }),

    remove: (key: string) => apiClient.delete(`/api-key-aliases?key=${encodeURIComponent(key)}`),
}
