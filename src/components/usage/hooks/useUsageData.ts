import {usageApi} from '@/services/api/usage'
import {USAGE_STATS_STALE_TIME_MS, useNotificationStore, useUsageStatsStore} from '@/stores'
import {downloadBlob} from '@/utils/download'
import {loadModelPrices, type ModelPrice, saveModelPrices} from '@/utils/usage'
import {type ChangeEvent, type RefObject, useCallback, useEffect, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'

export interface UsagePayload {
    total_requests?: number;
    success_count?: number;
    failure_count?: number;
    total_tokens?: number;
    apis?: Record<string, unknown>;

    [key: string]: unknown;
}

interface UseUsageDataReturn {
    usage: UsagePayload | null;
    loading: boolean;
    error: string;
    lastRefreshedAt: Date | null;
    modelPrices: Record<string, ModelPrice>;
    setModelPrices: (prices: Record<string, ModelPrice>) => void;
    loadUsage: () => Promise<void>;
    handleExport: () => Promise<void>;
    handleImport: () => void;
    handleImportChange: (event: ChangeEvent<HTMLInputElement>) => Promise<void>;
    importInputRef: RefObject<HTMLInputElement | null>;
    exporting: boolean;
    importing: boolean;
}

export function useUsageData(): UseUsageDataReturn {
    const { t }                                  = useTranslation()
    const { showNotification, showConfirmation } = useNotificationStore()
    const usageSnapshot                          = useUsageStatsStore((state) => state.usage)
    const loading                                = useUsageStatsStore((state) => state.loading)
    const storeError                             = useUsageStatsStore((state) => state.error)
    const lastRefreshedAtTs                      = useUsageStatsStore((state) => state.lastRefreshedAt)
    const loadUsageStats                         = useUsageStatsStore((state) => state.loadUsageStats)

    const [modelPrices, setModelPrices] = useState<Record<string, ModelPrice>>({})
    const [exporting, setExporting]     = useState(false)
    const [importing, setImporting]     = useState(false)
    const importInputRef                = useRef<HTMLInputElement | null>(null)

    const loadUsage = useCallback(async () => {
        await loadUsageStats({ force: true, staleTimeMs: USAGE_STATS_STALE_TIME_MS })
    }, [loadUsageStats])

    useEffect(() => {
        void loadUsageStats({ staleTimeMs: USAGE_STATS_STALE_TIME_MS }).catch(() => {
        })
        void loadModelPrices()
            .then(setModelPrices)
            .catch(() => {
            })
    }, [loadUsageStats])

    const handleExport = async () => {
        setExporting(true)
        try {
            const data          = await usageApi.exportUsage()
            const exportedAt    = typeof data?.exported_at === 'string' ? new Date(data.exported_at) : new Date()
            const safeTimestamp = Number.isNaN(exportedAt.getTime()) ?
                                  new Date().toISOString() :
                                  exportedAt.toISOString()
            const filename      = `usage-export-${safeTimestamp.replace(/[:.]/g, '-')}.json`
            downloadBlob({
                             filename,
                             blob: new Blob([JSON.stringify(data ?? {}, null, 2)], { type: 'application/json' }),
                         })
            showNotification(t('usage_stats.export_success'), 'success')
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : ''
            showNotification(`${t('notification.download_failed')}${message ? `: ${message}` : ''}`, 'error')
        } finally {
            setExporting(false)
        }
    }

    const handleImport = () => {
        importInputRef.current?.click()
    }

    const handleImportChange = async (event: ChangeEvent<HTMLInputElement>) => {
        const file         = event.target.files?.[0]
        event.target.value = ''
        if (!file) {
            return
        }

        let payload: unknown
        try {
            const text = await file.text()
            payload    = JSON.parse(text)
        } catch {
            showNotification(t('usage_stats.import_invalid'), 'error')
            return
        }

        // Count records for confirmation
        const exportPayload = payload as Record<string, unknown>
        const usageData     = exportPayload?.usage as Record<string, unknown> | undefined
        let recordCount     = 0
        if (usageData && typeof usageData === 'object') {
            for (const dateEntries of Object.values(usageData)) {
                if (Array.isArray(dateEntries)) {
                    recordCount += dateEntries.length
                }
            }
        }

        showConfirmation({
                             title: t('usage_stats.import_confirm_title'),
                             message: t('usage_stats.import_confirm_message', { count: recordCount }),
                             variant: 'primary',
                             confirmText: t('common.confirm'),
                             cancelText: t('common.cancel'),
                             onConfirm: async () => {
                                 setImporting(true)
                                 try {
                                     const result = await usageApi.importUsage(payload)
                                     showNotification(
                                         t('usage_stats.import_success', {
                                             added: result?.added ?? 0,
                                             skipped: result?.skipped ?? 0,
                                             total: result?.total_requests ?? 0,
                                             failed: result?.failed_requests ?? 0,
                                         }),
                                         'success',
                                     )
                                     try {
                                         await loadUsageStats({ force: true, staleTimeMs: USAGE_STATS_STALE_TIME_MS })
                                     } catch (err: unknown) {
                                         const message = err instanceof Error ? err.message : ''
                                         showNotification(
                                             `${t('notification.refresh_failed')}${message ? `: ${message}` : ''}`,
                                             'error',
                                         )
                                     }
                                 } catch (err: unknown) {
                                     const message = err instanceof Error ? err.message : ''
                                     showNotification(
                                         `${t('notification.upload_failed')}${message ? `: ${message}` : ''}`,
                                         'error',
                                     )
                                 } finally {
                                     setImporting(false)
                                 }
                             },
                         })
    }

    const handleSetModelPrices = useCallback((prices: Record<string, ModelPrice>) => {
        setModelPrices(prices)
        void saveModelPrices(prices)
    }, [])

    const usage           = usageSnapshot as UsagePayload | null
    const error           = storeError || ''
    const lastRefreshedAt = lastRefreshedAtTs ? new Date(lastRefreshedAtTs) : null

    return {
        usage,
        loading,
        error,
        lastRefreshedAt,
        modelPrices,
        setModelPrices: handleSetModelPrices,
        loadUsage,
        handleExport,
        handleImport,
        handleImportChange,
        importInputRef,
        exporting,
        importing,
    }
}
