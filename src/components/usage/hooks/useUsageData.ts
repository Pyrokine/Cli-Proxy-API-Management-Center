import {modelPricesApi} from '@/services/api/modelPrices'
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
    api_key?: string | readonly string[]
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

            if (result.recalculation_error) {
                const base =
                          result.status === 'busy' ?
                          t('usage_stats.recalculate_busy') :
                          t('usage_stats.recalculate_failed')
                message    = `${t('usage_stats.model_price_saved')}, ${base}: ${result.recalculation_error}`
                type       = result.status === 'busy' ? 'warning' : 'error'
            } else if (result.recalculation_pending) {
                const recalculationMessage =
                          result.already_running ?
                          t('usage_stats.recalculate_busy') :
                          t('usage_stats.recalculate_started')
                message = `${t('usage_stats.model_price_saved')}, ${recalculationMessage}`
                type    = result.already_running ? 'warning' : 'success'
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
        async () => {
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

        let active = true
        const load = async () => {
            try {
                const loaded = await loadModelPrices()
                if (!active) {
                    return
                }
                setModelPrices(loaded)
            } catch (err: unknown) {
                if (active) {
                    const message = err instanceof Error ? err.message : ''
                    showNotification(`${t('notification.load_failed')}${message ? `: ${message}` : ''}`, 'error')
                }
            }
        }
        void load()
        return () => {
            active = false
        }
    }, [enabled, loadModelPricesEnabled, loadUsageStats, showNotification, t])

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
                if (result.recalculation_pending) {
                    try {
                        const status = await modelPricesApi.waitForRecalculation()
                        if (!status) {
                            throw new Error(t('usage_stats.recalculate_timeout'))
                        }
                        const completionFeedback: PriceSaveFeedback =
                                  status.status === 'ok' ?
                                  {
                                      message: t('usage_stats.recalculate_success', {
                                          days: status.recalculated_days ?? 0,
                                          cost: formatUsd(status.total_cost ?? 0),
                                      }),
                                      type: 'success',
                                  } :
                                  {
                                      message: `${t('usage_stats.recalculate_failed')}${status.error ?
                                                                                       `: ${status.error}` :
                                                                                       ''}`,
                                      type: 'error',
                                  }
                        setPriceSaveFeedback(completionFeedback)
                        showNotification(completionFeedback.message, completionFeedback.type)
                    } catch (err: unknown) {
                        const message = err instanceof Error ? err.message : ''
                        const recalculationFeedback: PriceSaveFeedback = {
                            message: `${t('usage_stats.recalculate_failed')}${message ? `: ${message}` : ''}`,
                            type: 'error',
                        }
                        setPriceSaveFeedback(recalculationFeedback)
                        showNotification(recalculationFeedback.message, recalculationFeedback.type)
                    }
                }
                await handleAfterPricesSaved()
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
