import {authFilesApi} from '@/services/api/authFiles'
import {USAGE_STATS_STALE_TIME_MS, useConfigStore, useUsageStatsStore} from '@/stores'
import type {Config} from '@/types'
import type {AuthFileItem} from '@/types/authFile'
import type {KeyStats} from '@/utils/usage'
import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import type {AnyKeyConfig, VendorDefinition} from './useVendorRegistry'

export interface VendorData {
    /** API key configs from server config */
    apiKeys: AnyKeyConfig[];
    /** Auth files belonging to this vendor */
    authFiles: AuthFileItem[];
    /** Usage stats summary */
    stats: { requests: number };
}

interface UseCredentialsDataReturn {
    vendorData: Map<string, VendorData>;
    config: Config | null;
    authFiles: AuthFileItem[];
    keyStats: KeyStats;
    loading: boolean;
    error: string | null;
    refresh: () => Promise<void>;
}

const createEmptyVendorData = (): VendorData => ({
    apiKeys: [],
    authFiles: [],
    stats: { requests: 0 },
})

/**
 * Aggregate credentials data from config store, auth files API, and usage stats.
 * Groups everything by vendor.
 */
export function useCredentialsData(vendors: VendorDefinition[]): UseCredentialsDataReturn {
    const config        = useConfigStore((state) => state.config)
    const fetchConfig   = useConfigStore((state) => state.fetchConfig)
    const configLoading = useConfigStore((state) => state.loading)

    const keyStats       = useUsageStatsStore((state) => state.keyStats)
    const usageLoading   = useUsageStatsStore((state) => state.loading)
    const loadUsageStats = useUsageStatsStore((state) => state.loadUsageStats)

    const [authFiles, setAuthFiles]               = useState<AuthFileItem[]>([])
    const [authFilesLoading, setAuthFilesLoading] = useState(false)
    const [error, setError]                       = useState<string | null>(null)

    const loadingRef = useRef(false)

    const loadAll = useCallback(async () => {
        if (loadingRef.current) {
            return
        }
        loadingRef.current = true
        setError(null)

        try {
            const [, authFilesResponse] = await Promise.all([
                                                                fetchConfig(undefined, true),
                                                                authFilesApi.list()
                                                                            .catch(() => ({ files: [] as AuthFileItem[] })),
                                                                loadUsageStats({ staleTimeMs: USAGE_STATS_STALE_TIME_MS })
                                                                    .catch(() => {
                                                                    }),
                                                            ])
            setAuthFiles(authFilesResponse.files || [])
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Failed to load credentials data'
            setError(message)
        } finally {
            loadingRef.current = false
        }
    }, [fetchConfig, loadUsageStats])

    // Initial load
    useEffect(() => {
        setAuthFilesLoading(true)
        void loadAll().finally(() => setAuthFilesLoading(false))
    }, [loadAll])

    const refresh = useCallback(async () => {
        setAuthFilesLoading(true)
        try {
            await loadAll()
        } finally {
            setAuthFilesLoading(false)
        }
    }, [loadAll])

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

            // Usage stats: sum by source keys that match this vendor
            if (keyStats.bySource) {
                for (const [source, bucket] of Object.entries(keyStats.bySource)) {
                    const sourceLower = source.toLowerCase()
                    const matches     =
                              vendor.authFileTypes.some((t) => sourceLower.includes(t)) ||
                              (vendor.configExtractor && sourceLower.includes(vendor.id))
                    if (matches) {
                        data.stats.requests += (bucket.success ?? 0) + (bucket.failure ?? 0)
                    }
                }
            }

            map.set(vendor.id, data)
        }

        return map
    }, [vendors, config, authFiles, keyStats])

    const loading = configLoading || authFilesLoading || usageLoading

    return { vendorData, config, authFiles, keyStats, loading, error, refresh }
}
