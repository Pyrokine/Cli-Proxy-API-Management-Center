import defaultPricesJson from '@/data/defaultModelPrices.json'
import {usageApi} from '@/services/api/usage'
import {USAGE_STATS_STALE_TIME_MS, useNotificationStore, useUsageStatsStore} from '@/stores'
import type {NotificationType} from '@/types'
import {downloadBlob} from '@/utils/download'
import {formatUsd, loadModelPrices, type ModelPrice, saveModelPrices} from '@/utils/usage'
import {type ChangeEvent, type RefObject, useCallback, useEffect, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'

export interface UsagePayload {
    total_requests?: number
    success_count?: number
    failure_count?: number
    total_tokens?: number
    apis?: Record<string, unknown>

    [key: string]: unknown
}

export interface ExportFilters {
    from?: string
    to?: string
    model?: string
    api_key?: string
    credential?: string
}

export interface PriceSaveFeedback {
    message: string
    type: NotificationType
}

interface UseUsageDataReturn {
    usage: UsagePayload | null
    loading: boolean
    error: string
    lastRefreshedAt: Date | null
    modelPrices: Record<string, ModelPrice>
    priceSaveFeedback: PriceSaveFeedback | null
    setModelPrices: (prices: Record<string, ModelPrice>) => Promise<void>
    loadUsage: () => Promise<void>
    handleExport: (filters?: ExportFilters) => Promise<void>
    handleImport: () => void
    handleImportChange: (event: ChangeEvent<HTMLInputElement>) => Promise<void>
    importInputRef: RefObject<HTMLInputElement | null>
    exporting: boolean
    importing: boolean
}

interface UseUsageDataOptions {
    enabled?: boolean
    loadModelPricesEnabled?: boolean
    onAfterImport?: () => void | Promise<void>
    onAfterPricesSaved?: () => void | Promise<void>
}

export function useUsageData(options: UseUsageDataOptions = {}): UseUsageDataReturn {
    const { enabled = true, loadModelPricesEnabled = true, onAfterImport, onAfterPricesSaved } = options
    const { t }                                                                                = useTranslation()
    const { showNotification, showConfirmation, addPersistentNotification }                    = useNotificationStore()
    const usageSnapshot                                                                        = useUsageStatsStore((state) => state.usage)
    const loading                                                                              = useUsageStatsStore((state) => state.loading)
    const storeError                                                                           = useUsageStatsStore((state) => state.error)
    const lastRefreshedAtTs                                                                    = useUsageStatsStore((state) => state.lastRefreshedAt)
    const loadUsageStats                                                                       = useUsageStatsStore((state) => state.loadUsageStats)

    const [modelPrices, setModelPrices]             = useState<Record<string, ModelPrice>>({})
    const [priceSaveFeedback, setPriceSaveFeedback] = useState<PriceSaveFeedback | null>(null)
    const [exporting, setExporting]                 = useState(false)
    const [importing, setImporting]                 = useState(false)
    const importInputRef                            = useRef<HTMLInputElement | null>(null)

    const buildPriceSaveFeedback = useCallback(
        (result: Awaited<ReturnType<typeof saveModelPrices>>): PriceSaveFeedback => {
            let message: string
            let type: NotificationType = 'success'

            if (result === null) {
                message = t('usage_stats.model_price_saved_local')
                type    = 'warning'
            } else if (result.recalculation_error) {
                const base =
                          result.status === 'busy' ?
                          t('usage_stats.recalculate_busy') :
                          t('usage_stats.recalculate_failed')
                message    = `${t('usage_stats.model_price_saved')}, ${base}: ${result.recalculation_error}`
                type       = result.status === 'busy' ? 'warning' : 'error'
            } else if (result.recalculation) {
                message = `${t('usage_stats.model_price_saved')}, ${t('usage_stats.recalculate_success', {
                    days: result.recalculated_days ?? 0,
                    cost: formatUsd(result.total_cost ?? 0),
                })}`
            } else {
                message = t('usage_stats.model_price_saved')
            }

            return { message, type }
        },
        [t],
    )

    const loadUsage = useCallback(async () => {
        await loadUsageStats({ force: true, staleTimeMs: USAGE_STATS_STALE_TIME_MS })
    }, [loadUsageStats])

    const handleAfterPricesSaved = useCallback(
        async (result: Awaited<ReturnType<typeof saveModelPrices>>) => {
            if (result === null) {
                return
            }
            if (enabled) {
                await loadUsageStats({ force: true, staleTimeMs: USAGE_STATS_STALE_TIME_MS })
            }
            if (onAfterPricesSaved) {
                await onAfterPricesSaved()
            }
        },
        [enabled, loadUsageStats, onAfterPricesSaved],
    )

    useEffect(() => {
        if (enabled) {
            void loadUsageStats({ staleTimeMs: USAGE_STATS_STALE_TIME_MS }).catch(() => {
            })
        }
        if (!loadModelPricesEnabled) {
            return
        }
        void loadModelPrices()
            .then((loaded) => {
                const defaults: Record<string, ModelPrice> = {}
                for (const [model, p] of Object.entries(defaultPricesJson)) {
                    defaults[model] = p as ModelPrice
                }

                if (!loaded || Object.keys(loaded).length === 0) {
                    setModelPrices(defaults)
                    void saveModelPrices(defaults).then(async (result) => {
                        await handleAfterPricesSaved(result)
                    })
                    return
                }

                const merged: Record<string, ModelPrice> = { ...defaults, ...loaded }
                setModelPrices(merged)

                if (Object.keys(merged).length !== Object.keys(loaded).length) {
                    void saveModelPrices(merged).then(async (result) => {
                        await handleAfterPricesSaved(result)
                    })
                }
            })
            .catch(() => {
            })
    }, [enabled, handleAfterPricesSaved, loadModelPricesEnabled, loadUsageStats])

    const handleExport = async (filters?: ExportFilters) => {
        setExporting(true)
        try {
            const data          = await usageApi.exportUsage(filters)
            const exportedAt    = typeof data?.exported_at === 'string' ? new Date(data.exported_at) : new Date()
            const safeTimestamp = Number.isNaN(exportedAt.getTime())
                                  ? new Date().toISOString()
                                  : exportedAt.toISOString()
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
                                     addPersistentNotification(
                                         t('usage_stats.import_success', {
                                             added: result?.added ?? 0,
                                             skipped: result?.skipped ?? 0,
                                             total: result?.total_requests ?? 0,
                                             failed: result?.failed_requests ?? 0,
                                         }),
                                         'info',
                                         'import',
                                     )
                                     try {
                                         await loadUsageStats({ force: true, staleTimeMs: USAGE_STATS_STALE_TIME_MS })
                                         if (onAfterImport) {
                                             await onAfterImport()
                                         }
                                     } catch (err: unknown) {
                                         const message = err instanceof Error ? err.message : ''
                                         showNotification(`${t('notification.refresh_failed')}${message ?
                                                                                                `: ${message}` :
                                                                                                ''}`, 'error')
                                     }
                                 } catch (err: unknown) {
                                     const message = err instanceof Error ? err.message : ''
                                     showNotification(`${t('notification.upload_failed')}${message ?
                                                                                           `: ${message}` :
                                                                                           ''}`, 'error')
                                 } finally {
                                     setImporting(false)
                                 }
                             },
                         })
    }

    const handleSetModelPrices = useCallback(
        async (prices: Record<string, ModelPrice>) => {
            setModelPrices(prices)
            try {
                const result   = await saveModelPrices(prices)
                const feedback = buildPriceSaveFeedback(result)
                setPriceSaveFeedback(feedback)
                showNotification(feedback.message, feedback.type)
                await handleAfterPricesSaved(result)
            } catch (err: unknown) {
                const message                     = err instanceof Error ? err.message : ''
                const feedback: PriceSaveFeedback = {
                    message: `${t('notification.update_failed')}${message ? `: ${message}` : ''}`,
                    type: 'error',
                }
                setPriceSaveFeedback(feedback)
                showNotification(feedback.message, feedback.type)
            }
        },
        [buildPriceSaveFeedback, handleAfterPricesSaved, showNotification, t],
    )

    const usage           = usageSnapshot as UsagePayload | null
    const error           = storeError || ''
    const lastRefreshedAt = lastRefreshedAtTs ? new Date(lastRefreshedAtTs) : null

    return {
        usage,
        loading,
        error,
        lastRefreshedAt,
        modelPrices,
        priceSaveFeedback,
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
