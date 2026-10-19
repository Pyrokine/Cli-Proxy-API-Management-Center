import {
    applyAuthFileMutation,
    type AuthFileMutation,
    authFileMutationNames,
    authFileMutationQuotaKeys,
    authFileStatusQuotaKeys,
    createLatestCredentialsRequestTracker,
} from '@/components/credentials/credentialsDataLifecycle'
import {invalidateAuthFileDerivedCaches} from '@/features/authFiles/cacheInvalidation'
import {inferProviderFromAuthFileName} from '@/features/authFiles/constants'
import {authFilesApi} from '@/services/api/authFiles'
import {apiClient} from '@/services/api/client'
import {useConfigStore} from '@/stores'
import {useAuthFilesSummaryStore} from '@/stores/useAuthFilesSummaryStore'
import {useQuotaStore} from '@/stores/useQuotaStore'
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
    refreshing: boolean
    error: string | null
    refresh: () => Promise<void>
    completeMutation: (mutation: AuthFileMutation | AuthFileMutation[]) => Promise<void>
}

type LoadCredentialsOptions = {
    background?: boolean
}

const createEmptyVendorData = (): VendorData => ({
    apiKeys: [],
    authFiles: [],
})

const authFileSupplierTokens = (file: AuthFileItem): string[] =>
    [file.provider, file.type, inferProviderFromAuthFileName(file.name)]
        .filter((item): item is string => typeof item === 'string' && item.trim() !== '')
        .map((item) => item.trim().toLowerCase())

const authFileBelongsToVendor = (file: AuthFileItem, vendor: VendorDefinition): boolean => {
    const vendorTypes = new Set([...vendor.authFileTypes, ...vendor.oauthProviders].map((item) => item.toLowerCase()))
    return authFileSupplierTokens(file).some((token) => vendorTypes.has(token))
}

export function groupVendorAuthFiles(vendors: VendorDefinition[], authFiles: AuthFileItem[]): Map<string, AuthFileItem[]> {
    const groups = new Map<string, AuthFileItem[]>()
    for (const vendor of vendors) {
        if (vendor.id !== 'other') {
            groups.set(vendor.id, authFiles.filter((file) => authFileBelongsToVendor(file, vendor)))
        }
    }
    if (vendors.some((vendor) => vendor.id === 'other')) {
        groups.set('other', authFiles.filter((file) =>
            !vendors.some((vendor) => vendor.id !== 'other' && authFileBelongsToVendor(file, vendor))))
    }
    return groups
}

/**
 * Aggregate credentials data from config store and auth files API.
 * The current list stays visible during refreshes, while only the latest request
 * from the current authenticated connection may publish data or loading state.
 */
export function useCredentialsData(vendors: VendorDefinition[]): UseCredentialsDataReturn {
    const config        = useConfigStore((state) => state.config)
    const fetchConfig   = useConfigStore((state) => state.fetchConfig)
    const configLoading = useConfigStore((state) => state.loading)

    const [authFiles, setAuthFiles]   = useState<AuthFileItem[]>([])
    const [loading, setLoading]       = useState(true)
    const [refreshing, setRefreshing] = useState(false)
    const [error, setError]           = useState<string | null>(null)
    const authFilesRef                = useRef<AuthFileItem[]>([])
    const requestTrackerRef           = useRef(createLatestCredentialsRequestTracker())
    const setSummaryCount             = useAuthFilesSummaryStore((state) => state.setCount)

    useEffect(() => {
        authFilesRef.current = authFiles
    }, [authFiles])

    const loadAll = useCallback(async (options?: LoadCredentialsOptions) => {
        const background     = options?.background === true || authFilesRef.current.length > 0
        const authGeneration = apiClient.getAuthGeneration()
        const token          = requestTrackerRef.current.begin(authGeneration)

        if (background) {
            setRefreshing(true)
        } else {
            setLoading(true)
            setError(null)
        }

        try {
            const [, authFilesResponse] = await Promise.all([
                                                                fetchConfig(undefined, true),
                                                                authFilesApi.list(),
                                                            ])
            if (!requestTrackerRef.current.isCurrent(token, apiClient.getAuthGeneration())) {
                return
            }
            const files          = authFilesResponse.files ?? []
            authFilesRef.current = files
            setAuthFiles(files)
            setSummaryCount(files.length)
            setError(null)
        } catch (err: unknown) {
            if (!requestTrackerRef.current.isCurrent(token, apiClient.getAuthGeneration())) {
                return
            }
            setError(err instanceof Error ? err.message : 'Failed to load credentials data')
        } finally {
            if (requestTrackerRef.current.isCurrent(token, apiClient.getAuthGeneration())) {
                setLoading(false)
                setRefreshing(false)
            }
        }
    }, [fetchConfig, setSummaryCount])

    const refresh = useCallback(() => loadAll({ background: authFilesRef.current.length > 0 }), [loadAll])

    const completeMutation = useCallback(async (mutation: AuthFileMutation | AuthFileMutation[]) => {
        const mutations = Array.isArray(mutation) ? mutation : [mutation]
        if (mutations.length === 0) {
            // 状态写入后仍可返回错误，空成功列表也需读取服务端状态
            await loadAll({ background: true })
            return
        }
        requestTrackerRef.current.invalidate()
        let nextFiles = authFilesRef.current
        const statusQuotaKeys = new Set<string>()
        for (const item of mutations) {
            if (item.kind === 'status') {
                authFileStatusQuotaKeys(nextFiles, item).forEach((key) => statusQuotaKeys.add(key))
            }
            const quotaKeys = authFileMutationQuotaKeys(nextFiles, item)
            nextFiles = applyAuthFileMutation(nextFiles, item)
            invalidateAuthFileDerivedCaches(authFileMutationNames(item), quotaKeys)
        }
        useQuotaStore.getState().advanceQuotaSubjects(Array.from(statusQuotaKeys))
        authFilesRef.current = nextFiles
        setAuthFiles(nextFiles)
        setSummaryCount(nextFiles.length)
        setLoading(false)
        setRefreshing(false)
        await loadAll({ background: true })
    }, [loadAll, setSummaryCount])

    useEffect(() => {
        let cancelled = false
        const requestTracker = requestTrackerRef.current
        queueMicrotask(() => {
            if (!cancelled) {
                void loadAll()
            }
        })
        return () => {
            cancelled = true
            requestTracker.invalidate()
        }
    }, [loadAll])

    const vendorData = useMemo(() => {
        const map = new Map<string, VendorData>()
        const groupedFiles = groupVendorAuthFiles(vendors, authFiles)

        for (const vendor of vendors) {
            const data = createEmptyVendorData()
            if (vendor.configExtractor && config) {
                data.apiKeys = vendor.configExtractor(config)
            }
            data.authFiles = groupedFiles.get(vendor.id) ?? []
            map.set(vendor.id, data)
        }

        return map
    }, [vendors, config, authFiles])

    return {
        vendorData,
        config,
        authFiles,
        loading: loading || (configLoading && authFiles.length === 0),
        refreshing,
        error,
        refresh,
        completeMutation,
    }
}
