import {authFilesApi} from '@/services/api/authFiles'
import {useConfigStore} from '@/stores'
import type {Config} from '@/types'
import type {AuthFileItem} from '@/types/authFile'
import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import type {AnyKeyConfig, VendorDefinition} from './useVendorRegistry'

export interface VendorData {
    /** API key configs from server config */
    apiKeys: AnyKeyConfig[]
    /** Auth files belonging to this vendor */
    authFiles: AuthFileItem[]
}

interface UseCredentialsDataReturn {
    vendorData: Map<string, VendorData>
    config: Config | null
    authFiles: AuthFileItem[]
    loading: boolean
    error: string | null
    refresh: () => Promise<void>
}

const createEmptyVendorData = (): VendorData => ({
    apiKeys: [],
    authFiles: [],
})

/**
 * Aggregate credentials data from config store, auth files API, and usage stats.
 * Groups everything by vendor.
 */
export function useCredentialsData(vendors: VendorDefinition[]): UseCredentialsDataReturn {
    const config        = useConfigStore((state) => state.config)
    const fetchConfig   = useConfigStore((state) => state.fetchConfig)
    const configLoading = useConfigStore((state) => state.loading)

    const [authFiles, setAuthFiles]               = useState<AuthFileItem[]>([])
    const [authFilesLoading, setAuthFilesLoading] = useState(true)
    const [error, setError]                       = useState<string | null>(null)

    const loadingRef = useRef(false)

    const loadAll = useCallback(async () => {
        if (loadingRef.current) {
            return
        }
        loadingRef.current = true
        setError(null)

        try {
            const configPromise = fetchConfig(undefined, true)
            const authPromise   = authFilesApi.list()

            const [, authFilesResponse] = await Promise.all([configPromise, authPromise])
            setAuthFiles(authFilesResponse.files || [])
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Failed to load credentials data'
            setError(message)
        } finally {
            loadingRef.current = false
        }
    }, [fetchConfig])

    const refresh = useCallback(async () => {
        setAuthFilesLoading(true)
        try {
            await loadAll()
        } finally {
            setAuthFilesLoading(false)
        }
    }, [loadAll])

    // Initial load
    useEffect(() => {
        queueMicrotask(() => {
            void refresh()
        })
    }, [refresh])

    // Aggregate by vendor
    const vendorData = useMemo(() => {
        const map = new Map<string, VendorData>()

        for (const vendor of vendors) {
            const data = createEmptyVendorData()

            // API keys from config via vendor's extractor
            if (vendor.configExtractor && config) {
                data.apiKeys = vendor.configExtractor(config)
            }

            // Auth files matching this vendor
            if (vendor.authFileTypes.length > 0) {
                data.authFiles = authFiles.filter((f) => f.type && vendor.authFileTypes.includes(f.type))
            }

            map.set(vendor.id, data)
        }

        return map
    }, [vendors, config, authFiles])

    const loading = configLoading || authFilesLoading

    return { vendorData, config, authFiles, loading, error, refresh }
}
