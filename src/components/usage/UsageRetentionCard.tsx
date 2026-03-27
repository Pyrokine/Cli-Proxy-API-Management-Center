import {Button} from '@/components/ui/Button'
import {Card} from '@/components/ui/Card'
import {Input} from '@/components/ui/Input'
import {ToggleSwitch} from '@/components/ui/ToggleSwitch'
import {usageApi, type UsageRetention} from '@/services/api/usage'
import {useNotificationStore} from '@/stores'
import {formatFileSize} from '@/utils/format'
import {useCallback, useEffect, useState} from 'react'
import {useTranslation} from 'react-i18next'
import styles from './UsageRetentionCard.module.scss'

interface RetentionDraft {
    daysEnabled: boolean;
    days: string;
    maxSizeEnabled: boolean;
    maxFileSizeMb: string;
    archiveEnabled: boolean;
    archiveMonths: string;
}

function toDraft(r: UsageRetention): RetentionDraft {
    return {
        daysEnabled: r.days > 0,
        days: r.days > 0 ? String(r.days) : '30',
        maxSizeEnabled: r.max_file_size_mb > 0,
        maxFileSizeMb: r.max_file_size_mb > 0 ? String(r.max_file_size_mb) : '50',
        archiveEnabled: r.archive_months > 0,
        archiveMonths: r.archive_months > 0 ? String(r.archive_months) : '3',
    }
}

function toPayload(d: RetentionDraft): Partial<UsageRetention> {
    return {
        days: d.daysEnabled ? Math.max(1, parseInt(d.days, 10) || 1) : -1,
        max_file_size_mb: d.maxSizeEnabled ? Math.max(1, parseInt(d.maxFileSizeMb, 10) || 1) : -1,
        archive_months: d.archiveEnabled ? Math.max(1, parseInt(d.archiveMonths, 10) || 1) : -1,
    }
}

function hasChanged(draft: RetentionDraft, retention: UsageRetention): boolean {
    const payload = toPayload(draft)
    return (
        payload.days !== retention.days ||
        payload.max_file_size_mb !== retention.max_file_size_mb ||
        payload.archive_months !== retention.archive_months
    )
}

export function UsageRetentionCard() {
    const { t }                                  = useTranslation()
    const { showNotification, showConfirmation } = useNotificationStore()
    const [retention, setRetention]              = useState<UsageRetention | null>(null)
    const [loading, setLoading]                  = useState(true)
    const [saving, setSaving]                    = useState(false)
    const [trimming, setTrimming]                = useState(false)
    const [draft, setDraft]                      = useState<RetentionDraft>({
                                                                                daysEnabled: true,
                                                                                days: '30',
                                                                                maxSizeEnabled: true,
                                                                                maxFileSizeMb: '50',
                                                                                archiveEnabled: true,
                                                                                archiveMonths: '3',
                                                                            })

    const loadRetention = useCallback(async () => {
        setLoading(true)
        try {
            const data = await usageApi.getRetention()
            setRetention(data)
            setDraft(toDraft(data))
        } catch {
            // Retention API may not be available
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        void loadRetention()
    }, [loadRetention])

    const handleSave = async () => {
        setSaving(true)
        try {
            const payload                 = toPayload(draft)
            const result                  = await usageApi.putRetention(payload)
            const updated: UsageRetention = {
                days: result.days ?? retention?.days ?? 0,
                max_file_size_mb: result.max_file_size_mb ?? retention?.max_file_size_mb ?? 0,
                archive_months: result.archive_months ?? retention?.archive_months ?? 0,
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
            // Fetch preview to show what will be cleaned
            const preview = await usageApi.trimPreview()
            if (preview.files_count === 0) {
                showNotification(t('usage_stats.trim_confirm_empty'), 'info')
                return
            }

            const from = preview.date_range?.oldest ?? '—'
            const to   = preview.date_range?.newest ?? '—'

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
                                     const result       = await usageApi.triggerTrim()
                                     const archiveCount = result.archives?.length ?? 0
                                     showNotification(
                                         t('usage_stats.trim_success', { archives: archiveCount }),
                                         'success',
                                     )
                                 },
                             })
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : ''
            showNotification(`${t('usage_stats.trim_preview_failed')}${message ? `: ${message}` : ''}`, 'error')
        } finally {
            setTrimming(false)
        }
    }

    const allDisabled = !draft.daysEnabled && !draft.maxSizeEnabled && !draft.archiveEnabled

    return (
        <Card
            title={t('usage_stats.retention_title')}
            extra={
                <Button variant='secondary' size='sm' onClick={handleTrim} loading={trimming}
                        disabled={loading || saving}>
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
                        {(
                            [
                                {
                                    label: 'retention_days',
                                    enabled: draft.daysEnabled,
                                    enabledKey: 'daysEnabled' as const,
                                    value: draft.days,
                                    valueKey: 'days' as const,
                                },
                                {
                                    label: 'retention_max_size',
                                    enabled: draft.maxSizeEnabled,
                                    enabledKey: 'maxSizeEnabled' as const,
                                    value: draft.maxFileSizeMb,
                                    valueKey: 'maxFileSizeMb' as const,
                                },
                                {
                                    label: 'retention_archive',
                                    enabled: draft.archiveEnabled,
                                    enabledKey: 'archiveEnabled' as const,
                                    value: draft.archiveMonths,
                                    valueKey: 'archiveMonths' as const,
                                },
                            ] as const
                        ).map((field) => (
                            <div key={field.label} className={styles.field}>
                                <div className={styles.fieldHeader}>
                                    <label className={styles.label}>{t(`usage_stats.${field.label}`)}</label>
                                    <ToggleSwitch
                                        checked={field.enabled}
                                        onChange={(enabled) => setDraft((d) => ({ ...d, [field.enabledKey]: enabled }))}
                                    />
                                </div>
                                {field.enabled ? (
                                    <Input
                                        type='number'
                                        min={1}
                                        step={1}
                                        value={field.value}
                                        onChange={(e) => setDraft((d) => ({ ...d, [field.valueKey]: e.target.value }))}
                                        className={styles.input}
                                    />
                                ) : (
                                     <span className={styles.disabledHint}>
                                         {t(`usage_stats.${field.label}_disabled`)}
                                     </span>
                                 )}
                                <span className={styles.hint}>{t(`usage_stats.${field.label}_hint`)}</span>
                            </div>
                        ))}

                        {/* Contextual warnings */}
                        {!draft.daysEnabled &&
                         <div className={styles.warning}>{t('usage_stats.retention_no_trim_warning')}</div>}
                        {draft.daysEnabled && !draft.archiveEnabled && (
                            <div className={styles.warning}>{t('usage_stats.retention_no_archive_warning')}</div>
                        )}
                        {allDisabled &&
                         <div className={styles.warningDanger}>{t('usage_stats.retention_all_disabled_warning')}</div>}

                        <div className={styles.actions}>
                            <Button
                                variant='primary'
                                size='sm'
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
