import {apiClient} from '@/services/api/client'
import {modelPricesApi} from '@/services/api/modelPrices'
import {type RequestSpeed, usageApi} from '@/services/api/usage'
import {USAGE_STATS_STALE_TIME_MS, useNotificationStore, useUsageStatsStore} from '@/stores'
import type {NotificationType} from '@/types'
import {downloadBlob} from '@/utils/download'
import {formatUsd, loadModelPrices, type ModelPrice, saveModelPrices} from '@/utils/usage'
import {type ChangeEvent, type ReactNode, type RefObject, useCallback, useEffect, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {useUsageBackupPassword} from './useUsageBackupPassword'

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
    api_key_identity?: 'canonical'
    credential?: string
    speed?: RequestSpeed | ''
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
    handleExport: (filters?: ExportFilters) => void
    backupPasswordDialog: ReactNode
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

function describeUsageImport(payload: unknown): { count: number | null; needsPassword: boolean } {
    if (typeof payload === 'string') {
        const rows   = payload.trimStart().match(/(?:[^"\r\n]|"(?:[^"]|"")*")+/g) ?? []
        const fields = (row: string) => Array.from(
            `,${row}`.matchAll(/,("(?:[^"]|"")*"|[^,"]*)(?=,|$)/g),
            ([, field]) => field.replace(/^"|"$/g, '').trim(),
        )
        const column = fields(rows[0] ?? '').findIndex((field) => field.toLowerCase() === 'import_data')
        return {
            count: Math.max(0, rows.length - 1),
            needsPassword: column >= 0 && rows.some((row, index) => index > 0 && Boolean(fields(row)[column])),
        }
    }
    const envelope = payload as {
                                    format?: string
                                    details?: unknown
                                    usage?: {
                                        apis?: Record<string, { models?: Record<string, { details?: unknown }> }>
                                    }
                                } | null
    if (envelope?.format === 'cliproxy-usage-backup') {
        return { count: null, needsPassword: true }
    }
    const details = Array.isArray(payload) ? payload : envelope?.details
    if (Array.isArray(details)) {
        return {
            count: details.length,
            needsPassword: details.some((event) => typeof event?.import_data === 'string' && !!event.import_data),
        }
    }
    if (envelope?.usage?.apis) {
        let count = 0
        for (const api of Object.values(envelope.usage.apis)) {
            for (const model of Object.values(api?.models ?? {})) {
                if (Array.isArray(model?.details)) {
                    count += model.details.length
                }
            }
        }
        return { count, needsPassword: false }
    }
    return { count: null, needsPassword: false }
}

export function useUsageData(options: UseUsageDataOptions = {}): UseUsageDataReturn {
    const {
              enabled                = true,
              loadModelPricesEnabled = true,
              onAfterImport,
              onAfterPricesSaved,
          }                                               = options
    const { t }                                           = useTranslation()
    const { requestBackupPassword, backupPasswordDialog } = useUsageBackupPassword()
    const {
              showNotification,
              showConfirmation,
              addPersistentNotification,
          }                                               = useNotificationStore()

    const usageSnapshot     = useUsageStatsStore((state) => state.usage)
    const loading           = useUsageStatsStore((state) => state.loading)
    const storeError        = useUsageStatsStore((state) => state.error)
    const lastRefreshedAtTs = useUsageStatsStore((state) => state.lastRefreshedAt)
    const loadUsageStats    = useUsageStatsStore((state) => state.loadUsageStats)

    const [modelPrices, setModelPrices]             = useState<Record<string, ModelPrice>>({})
    const [priceSaveFeedback, setPriceSaveFeedback] = useState<PriceSaveFeedback | null>(null)
    const [exporting, setExporting]                 = useState(false)
    const [importing, setImporting]                 = useState(false)
    const importInputRef                            = useRef<HTMLInputElement | null>(null)
    const exportControllerRef                       = useRef<AbortController | null>(null)

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
                message                    = `${t('usage_stats.model_price_saved')}, ${recalculationMessage}`
                type                       = result.already_running ? 'warning' : 'success'
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

    useEffect(
        () => () => {
            exportControllerRef.current?.abort()
        },
        [],
    )

    const handleExport = (filters?: ExportFilters) => {
        requestBackupPassword({
                                  title: t('usage_stats.export'),
                                  confirmText: t('usage_stats.export'),
                                  message: t('usage_stats.backup_export_scope'),
                                  onConfirm: async (backupPassword) => {
                                      const generation = apiClient.getAuthGeneration()
                                      exportControllerRef.current?.abort()
                                      const controller            = new AbortController()
                                      exportControllerRef.current = controller
                                      setExporting(true)
                                      try {
                                          const response = await usageApi.exportUsage(
                                              filters,
                                              {
                                                  signal: controller.signal,
                                                  backupPassword,
                                              },
                                          )
                                          if (controller.signal.aborted ||
                                              generation !==
                                              apiClient.getAuthGeneration()) {
                                              return
                                          }
                                          const headerValue = response.headers?.['content-disposition']
                                          const match       = typeof headerValue === 'string'
                                                              ? headerValue.match(/filename="?(?<filename>[^";]+)"?/i)
                                                              : null
                                          const filename    = match?.groups?.filename ??
                                                              `usage-backup-${new Date().toISOString().replace(
                                                                  /[:.]/g,
                                                                  '-',
                                                              )}.json`
                                          const blob        = response.data instanceof Blob
                                                              ? response.data
                                                              : new Blob([response.data], { type: 'application/json' })
                                          downloadBlob({ filename, blob, revokeDelayMs: 60000 })
                                          showNotification(t('usage_stats.export_success'), 'success')
                                      } catch (err: unknown) {
                                          if (!controller.signal.aborted) {
                                              const message = err instanceof Error ? err.message : ''
                                              throw new Error(
                                                  `${t('notification.download_failed')}${message ?
                                                                                         `: ${message}` :
                                                                                         ''}`,
                                                  { cause: err },
                                              )
                                          }
                                      } finally {
                                          if (exportControllerRef.current === controller) {
                                              exportControllerRef.current = null
                                              setExporting(false)
                                          }
                                      }
                                  },
                              })
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

        const generation = apiClient.getAuthGeneration()
        let payload: unknown
        try {
            const text = await file.text()
            payload    = /\.csv$/i.test(file.name) ? text : JSON.parse(text)
        } catch {
            showNotification(t('usage_stats.import_invalid'), 'error')
            return
        }
        if (generation !== apiClient.getAuthGeneration()) {
            return
        }

        const { count, needsPassword } = describeUsageImport(payload)
        const title                    = t('usage_stats.import_confirm_title')
        const message                  = count === null
                                         ? t('usage_stats.import_confirm_unknown')
                                         : t('usage_stats.import_confirm_message', { count })
        const importFile               = async (backupPassword?: string) => {
            if (generation !== apiClient.getAuthGeneration()) {
                return
            }
            setImporting(true)
            try {
                const result = await usageApi.importUsage(payload, { backupPassword })
                if (generation !== apiClient.getAuthGeneration()) {
                    return
                }
                const unknown = t('usage_stats.request_events_observation_unknown')
                const counts  = { added: result?.added ?? unknown, skipped: result?.skipped ?? unknown }
                const outcome = typeof result?.total_requests === 'number' && typeof result.failed_requests === 'number'
                                ? t('usage_stats.import_success', {
                        ...counts, total: result.total_requests, failed: result.failed_requests,
                    })
                                : t('usage_stats.import_success_counts', counts)
                const notice  = result?.warning ? `${outcome} — ${result.warning}` : outcome
                showNotification(notice, result?.warning ? 'warning' : 'success')
                addPersistentNotification(notice, result?.warning ? 'warning' : 'info', 'import')
                try {
                    await loadUsageStats({ force: true, staleTimeMs: USAGE_STATS_STALE_TIME_MS })
                    if (generation === apiClient.getAuthGeneration()) {
                        await onAfterImport?.()
                    }
                } catch (err: unknown) {
                    if (generation === apiClient.getAuthGeneration()) {
                        const detail = err instanceof Error ? err.message : ''
                        showNotification(`${t('notification.refresh_failed')}${detail ? `: ${detail}` : ''}`, 'error')
                    }
                }
            } finally {
                setImporting(false)
            }
        }
        if (needsPassword) {
            requestBackupPassword({
                                      mode: 'import',
                                      title,
                                      message,
                                      confirmText: t('usage_stats.import'),
                                      onConfirm: importFile,
                                  })
            return
        }
        showConfirmation({
                             title,
                             message,
                             variant: 'primary',
                             confirmText: t('common.confirm'),
                             cancelText: t('common.cancel'),
                             onConfirm: async () => {
                                 try {
                                     await importFile()
                                 } catch (err: unknown) {
                                     if (generation === apiClient.getAuthGeneration()) {
                                         const detail = err instanceof Error ? err.message : ''
                                         showNotification(`${t('notification.upload_failed')}${detail ?
                                                                                               `: ${detail}` :
                                                                                               ''}`, 'error')
                                     }
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
                        const status              = await modelPricesApi.waitForRecalculation()
                        const recalculationFailed = t('usage_stats.recalculate_failed')
                        let completionFeedback: PriceSaveFeedback
                        if (!status) {
                            completionFeedback = {
                                message: `${recalculationFailed}: ${t('usage_stats.recalculate_timeout')}`,
                                type: 'error',
                            }
                        } else if (status.status === 'ok') {
                            completionFeedback = {
                                message: t('usage_stats.recalculate_success', {
                                    days: status.recalculated_days ?? 0,
                                    cost: formatUsd(status.total_cost ?? 0),
                                }),
                                type: 'success',
                            }
                        } else {
                            completionFeedback = {
                                message: `${recalculationFailed}${status.error ? `: ${status.error}` : ''}`,
                                type: 'error',
                            }
                        }
                        setPriceSaveFeedback(completionFeedback)
                        showNotification(completionFeedback.message, completionFeedback.type)
                    } catch (err: unknown) {
                        const message                                  = err instanceof Error ? err.message : ''
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
        backupPasswordDialog,
        handleImport,
        handleImportChange,
        importInputRef,
        exporting,
        importing,
    }
}
