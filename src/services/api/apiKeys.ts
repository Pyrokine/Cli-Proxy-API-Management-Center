/**
 * API 密钥管理
 */

import type { RecentRequestBucket } from '@/types/authFile'
import { apiClient } from './client'

export interface ApiKeyUsageEntry {
    success: number
    failed: number
    recentRequests: RecentRequestBucket[]
}

export const apiKeysApi = {
    async list(): Promise<string[]> {
        const data = await apiClient.get<Record<string, unknown>>('/api-keys')
        const keys = data['api-keys'] ?? data.apiKeys
        return Array.isArray(keys) ? keys.map((key) => String(key)) : []
    },

    replace: (keys: string[]) => apiClient.put('/api-keys', keys),

    update: (index: number, value: string) => apiClient.patch('/api-keys', { index, value }),

    delete: (index: number) => apiClient.delete(`/api-keys?index=${index}`),

    async getUsage(): Promise<Record<string, Record<string, ApiKeyUsageEntry>>> {
        const data = await apiClient.get<Record<string, unknown>>('/api-key-usage')
        const result: Record<string, Record<string, ApiKeyUsageEntry>> = {}

        Object.entries(data).forEach(([provider, providerValue]) => {
            if (!providerValue || typeof providerValue !== 'object' || Array.isArray(providerValue)) {
                return
            }
            const providerEntries: Record<string, ApiKeyUsageEntry> = {}
            Object.entries(providerValue as Record<string, unknown>).forEach(([compositeKey, rawEntry]) => {
                if (!rawEntry || typeof rawEntry !== 'object') {
                    return
                }
                const entry = rawEntry as Record<string, unknown>
                const recentRaw = Array.isArray(entry.recent_requests) ? entry.recent_requests : []
                providerEntries[compositeKey] = {
                    success: Number(entry.success ?? 0),
                    failed: Number(entry.failed ?? 0),
                    recentRequests: recentRaw
                        .map((bucket) => {
                            if (!bucket || typeof bucket !== 'object') {
                                return null
                            }
                            const bucketEntry = bucket as Record<string, unknown>
                            const time = String(bucketEntry.time ?? '').trim()
                            if (!time) {
                                return null
                            }
                            return {
                                time,
                                success: Number(bucketEntry.success ?? 0),
                                failed: Number(bucketEntry.failed ?? 0),
                            }
                        })
                        .filter(Boolean) as RecentRequestBucket[],
                }
            })
            result[provider] = providerEntries
        })

        return result
    },
}

export const apiKeyAliasApi = {
    async list(): Promise<Record<string, string>> {
        const data = await apiClient.get<Record<string, unknown>>('/api-key-aliases')
        return (data['api-key-aliases'] ?? {}) as Record<string, string>
    },

    set: (key: string, alias: string) => apiClient.patch('/api-key-aliases', { key, alias }),

    remove: (key: string) => apiClient.delete(`/api-key-aliases?key=${encodeURIComponent(key)}`),
}
