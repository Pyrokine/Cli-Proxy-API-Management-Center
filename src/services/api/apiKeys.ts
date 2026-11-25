/**
 * API 密钥管理
 */

import type {AxiosRequestConfig} from 'axios'
import {apiClient} from './client'

export const apiKeysApi = {
    async list(config?: AxiosRequestConfig): Promise<string[]> {
        const data = await apiClient.get<string[] | { 'api-keys'?: unknown }>('/api-keys', config)
        const keys = Array.isArray(data) ? data : data['api-keys']
        return Array.isArray(keys) ? keys.map((key) => String(key)) : []
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
