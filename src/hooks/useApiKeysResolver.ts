import {apiKeysApi} from '@/services/api/apiKeys'
import {useConfigStore} from '@/stores'
import {normalizeApiKeyList} from '@/utils/format'
import {useCallback, useEffect, useRef} from 'react'

/**
 * Resolves API keys from config or server with caching.
 * Shared by DashboardPage and SystemPage.
 */
export function useApiKeysResolver() {
    const config            = useConfigStore((state) => state.config)
    const apiKeysCache      = useRef<string[]>([])
    const requestGeneration = useRef(0)
    const inFlightRequest   = useRef<Promise<string[]> | null>(null)
    const requestController = useRef<AbortController | null>(null)

    const clearCache = useCallback(() => {
        ++requestGeneration.current
        requestController.current?.abort()
        apiKeysCache.current      = []
        inFlightRequest.current   = null
        requestController.current = null
    }, [])

    useEffect(() => {
        clearCache()
        return clearCache
    }, [config?.apiKeys, clearCache])

    const resolve = useCallback(async (): Promise<string[]> => {
        if (apiKeysCache.current.length) {
            return apiKeysCache.current
        }

        const configKeys = normalizeApiKeyList(config?.apiKeys)
        if (configKeys.length) {
            apiKeysCache.current = configKeys
            return configKeys
        }

        if (inFlightRequest.current) {
            return inFlightRequest.current
        }

        const generation = requestGeneration.current
        const controller = new AbortController()
        const request    = (async () => {
            try {
                const list       = await apiKeysApi.list({ signal: controller.signal })
                const normalized = normalizeApiKeyList(list)
                if (generation !== requestGeneration.current) {
                    const error = new Error('API key resolution invalidated')
                    error.name  = 'AbortError'
                    throw error
                }
                if (normalized.length) {
                    apiKeysCache.current = normalized
                }
                return normalized
            } catch (error: unknown) {
                if (generation !== requestGeneration.current || controller.signal.aborted) {
                    throw error
                }
                return []
            }
        })()
        requestController.current = controller
        inFlightRequest.current   = request

        try {
            return await request
        } finally {
            if (inFlightRequest.current === request) {
                inFlightRequest.current = null
            }
            if (requestController.current === controller) {
                requestController.current = null
            }
        }
    }, [config?.apiKeys])

    return { resolve, clearCache }
}
