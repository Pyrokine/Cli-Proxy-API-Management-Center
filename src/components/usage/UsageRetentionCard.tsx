import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { ToggleSwitch } from '@/components/ui/ToggleSwitch'
import { usageApi, type UsageRetention } from '@/services/api/usage'
import { useNotificationStore } from '@/stores'
import { formatFileSize } from '@/utils/format'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styles from './UsageRetentionCard.module.scss'

interface RetentionDraft {
    daysEnabled: boolean
    days: string
    maxDbSizeMb: string
    warningThresholdPct: string
}

const RETENTION_PRESETS = [7, 30, 90, 365]

function toDraft(r: UsageRetention): RetentionDraft {
    return {
        daysEnabled: r.days > 0,
        days: r.days > 0 ? String(r.days) : '30',
        maxDbSizeMb: String(r.max_db_size_mb ?? 0),
        warningThresholdPct: String(r.warning_threshold_pct ?? 80),
    }
}

function toPayload(d: RetentionDraft): Partial<UsageRetention> {
    return {
        days: d.daysEnabled ? Math.max(1, parseInt(d.days, 10) || 1) : -1,
        max_db_size_mb: Math.max(0, parseInt(d.maxDbSizeMb, 10) || 0),
        warning_threshold_pct: Math.min(100, Math.max(1, parseInt(d.warningThresholdPct, 10) || 80)),
    }
}

function hasChanged(draft: RetentionDraft, retention: UsageRetention): boolean {
    return toPayload(draft).days !== retention.days
}

export function UsageRetentionCard() {
    const { t } = useTranslation()
    const { showNotification, showConfirmation } = useNotificationStore()
    const [retention, setRetention] = useState<UsageRetention | null>(null)
    const [dbSize, setDbSize] = useState<number | null>(null)
    const [dbMaxSize, setDbMaxSize] = useState<number | null>(null)
    const [dbSizeWarning, setDbSizeWarning] = useState(false)
    const [dbSizeCapped, setDbSizeCapped] = useState(false)
    const [loading, setLoading] = useState(false)
    const [saving, setSaving] = useState(false)
    const [trimming, setTrimming] = useState(false)
    const [draft, setDraft] = useState<RetentionDraft>({
        daysEnabled: false,
        days: '30',
        maxDbSizeMb: '0',
        warningThresholdPct: '80',
    })

    const loadRetention = useCallback(async () => {
        setLoading(true)
        try {
            const [data, sizeRes] = await Promise.all([
                usageApi.getRetention(),
                usageApi.getDBSize().catch(() => ({
                    size_bytes: 0,
                    max_size_bytes: 0,
                    warning_threshold_pct: 80,
                    warning: false,
                    capped: false,
                })),
            ])
            setRetention(data)
            setDraft(toDraft(data))
            setDbSize(sizeRes.size_bytes ?? 0)
            setDbMaxSize(sizeRes.max_size_bytes ?? null)
            setDbSizeWarning(Boolean(sizeRes.warning))
            setDbSizeCapped(Boolean(sizeRes.capped))
        } catch {
            // Retention API may not be available
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        queueMicrotask(() => {
            void loadRetention()
        })
    }, [loadRetention])

    const handleSave = async () => {
        setSaving(true)
        try {
            const payload = toPayload(draft)
            const result = await usageApi.putRetention(payload)
            const updated: UsageRetention = {
                days: result.days ?? retention?.days ?? 0,
                max_db_size_mb: result.max_db_size_mb ?? retention?.max_db_size_mb ?? 0,
                warning_threshold_pct: result.warning_threshold_pct ?? retention?.warning_threshold_pct ?? 80,
            }
            setRetention(updated)
            setDraft(toDraft(updated))
            showNotification(t('usage_stats.retention_saved'), 'success')
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : ''
            showNotification(`${t('usage_stats.retention_save_failed')}${message ? `: ${message}` : ''}`, 'error')
        } finally {
            setSaving(false)
        }
    }

    const handleTrim = async () => {
        setTrimming(true)
        try {
            const preview = await usageApi.trimPreview()
            if (preview.files_count === 0) {
                showNotification(t('usage_stats.trim_confirm_empty'), 'info')
                return
            }

            const from = preview.date_range?.oldest ?? '—'
            const to = preview.date_range?.newest ?? '—'

            showConfirmation({
                title: t('usage_stats.trim_confirm_title'),
                message: t('usage_stats.trim_confirm_message', {
                    count: preview.files_count,
                    size: formatFileSize(preview.total_size_bytes),
                    from,
                    to,
                }),
                variant: 'danger',
                confirmText: t('usage_stats.retention_trim'),
                cancelText: t('common.cancel'),
                onConfirm: async () => {
                    await usageApi.triggerTrim()
                    showNotification(t('usage_stats.trim_success'), 'success')
                },
            })
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : ''
            showNotification(`${t('usage_stats.trim_preview_failed')}${message ? `: ${message}` : ''}`, 'error')
        } finally {
            setTrimming(false)
        }
    }

    return (
        <Card
            title={t('usage_stats.retention_title')}
            extra={
                <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleTrim}
                    loading={trimming}
                    disabled={loading || saving}
                >
                    {t('usage_stats.retention_trim')}
                </Button>
            }
        >
            {loading ? (
                <div className={styles.hint}>{t('common.loading')}</div>
            ) : !retention ? (
                <div className={styles.hint}>{t('usage_stats.retention_unavailable')}</div>
            ) : (
                <div className={styles.form}>
                    {dbSize !== null && (
                        <div className={styles.dbSizeRow}>
                            <span className={styles.dbSizeLabel}>{t('usage_stats.retention_db_size')}</span>
                            <span className={styles.dbSizeValue}>
                                {formatFileSize(dbSize)}
                                {dbMaxSize && dbMaxSize > 0 ? ` / ${formatFileSize(dbMaxSize)}` : ''}
                            </span>
                        </div>
                    )}
                    {dbSizeCapped && (
                        <div className={styles.warningDanger}>{t('usage_stats.retention_db_size_capped')}</div>
                    )}
                    {!dbSizeCapped && dbSizeWarning && (
                        <div className={styles.warning}>{t('usage_stats.retention_db_size_warning')}</div>
                    )}
                    <div className={styles.field}>
                        <div className={styles.fieldHeader}>
                            <label className={styles.label}>{t('usage_stats.retention_days')}</label>
                            <ToggleSwitch
                                checked={draft.daysEnabled}
                                onChange={(enabled) => setDraft((d) => ({ ...d, daysEnabled: enabled }))}
                            />
                        </div>
                        {draft.daysEnabled ? (
                            <>
                                <div className={styles.presets}>
                                    {RETENTION_PRESETS.map((preset) => (
                                        <Button
                                            key={preset}
                                            variant={parseInt(draft.days, 10) === preset ? 'primary' : 'secondary'}
                                            size="sm"
                                            onClick={() => setDraft((d) => ({ ...d, days: String(preset) }))}
                                        >
                                            {t('usage_stats.retention_preset_days', { count: preset })}
                                        </Button>
                                    ))}
                                </div>
                                <Input
                                    type="number"
                                    min={1}
                                    step={1}
                                    value={draft.days}
                                    onChange={(e) => setDraft((d) => ({ ...d, days: e.target.value }))}
                                    className={styles.input}
                                />
                            </>
                        ) : (
                            <span className={styles.disabledHint}>{t('usage_stats.retention_days_disabled')}</span>
                        )}
                        <span className={styles.hint}>{t('usage_stats.retention_days_hint')}</span>
                    </div>

                    {!draft.daysEnabled && (
                        <div className={styles.warning}>{t('usage_stats.retention_no_trim_warning')}</div>
                    )}

                    <div className={styles.field}>
                        <label className={styles.label}>{t('usage_stats.retention_max_db_size')}</label>
                        <Input
                            type="number"
                            min={0}
                            step={1}
                            value={draft.maxDbSizeMb}
                            onChange={(e) => setDraft((d) => ({ ...d, maxDbSizeMb: e.target.value }))}
                            className={styles.input}
                        />
                        <span className={styles.hint}>{t('usage_stats.retention_max_db_size_hint')}</span>
                    </div>

                    <div className={styles.field}>
                        <label className={styles.label}>{t('usage_stats.retention_warning_threshold')}</label>
                        <Input
                            type="number"
                            min={1}
                            max={100}
                            step={1}
                            value={draft.warningThresholdPct}
                            onChange={(e) => setDraft((d) => ({ ...d, warningThresholdPct: e.target.value }))}
                            className={styles.input}
                        />
                        <span className={styles.hint}>{t('usage_stats.retention_warning_threshold_hint')}</span>
                    </div>

                    <div className={styles.actions}>
                        <Button
                            variant="primary"
                            size="sm"
                            onClick={handleSave}
                            loading={saving}
                            disabled={!hasChanged(draft, retention) || trimming}
                        >
                            {t('usage_stats.retention_save')}
                        </Button>
                    </div>
                </div>
            )}
        </Card>
    )
}
