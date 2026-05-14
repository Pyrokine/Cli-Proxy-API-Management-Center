import { apiKeysApi } from '@/services/api/apiKeys'
import { useConfigStore } from '@/stores'
import { normalizeApiKeyList } from '@/utils/format'
import { useCallback, useRef } from 'react'

/**
 * Resolves API keys from config or server with caching.
 * Shared by DashboardPage and SystemPage.
 */
export function useApiKeysResolver() {
    const config = useConfigStore((state) => state.config)
    const apiKeysCache = useRef<string[]>([])

    const clearCache = useCallback(() => {
        apiKeysCache.current = []
    }, [])

    const resolve = useCallback(async (): Promise<string[]> => {
        if (apiKeysCache.current.length) {
            return apiKeysCache.current
        }

        const configKeys = normalizeApiKeyList(config?.apiKeys)
        if (configKeys.length) {
            apiKeysCache.current = configKeys
            return configKeys
        }

        try {
            const list = await apiKeysApi.list()
            const normalized = normalizeApiKeyList(list)
            if (normalized.length) {
                apiKeysCache.current = normalized
            }
            return normalized
        } catch {
            return []
        }
    }, [config?.apiKeys])

    return { resolve, clearCache }
}
