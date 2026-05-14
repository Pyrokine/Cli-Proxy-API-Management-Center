import { IconChevronRight } from '@/components/ui/icons'
import { Select } from '@/components/ui/Select'
import { ToggleSwitch } from '@/components/ui/ToggleSwitch'
import { configApi } from '@/services/api/config'
import { quotaApi } from '@/services/api/quota'
import { useConfigStore, useNotificationStore } from '@/stores'
import { TIMEZONE_OPTIONS, useTimezoneStore } from '@/stores/useTimezoneStore'
import type { Config } from '@/types'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import styles from './GlobalSettings.module.scss'

interface GlobalSettingsProps {
    config: Config | null
    disableControls: boolean
}

export function GlobalSettings({ config, disableControls }: GlobalSettingsProps) {
    const { t } = useTranslation()
    const navigate = useNavigate()
    const updateConfigValue = useConfigStore((s) => s.updateConfigValue)
    const { showNotification, showConfirmation } = useNotificationStore()
    const timezone = useTimezoneStore((s) => s.timezone)
    const setTimezone = useTimezoneStore((s) => s.setTimezone)

    // Backend quota config state
    const [quotaEnabled, setQuotaEnabled] = useState(false)
    const [quotaInterval, setQuotaInterval] = useState(600)

    useEffect(() => {
        void quotaApi
            .getConfig()
            .then((cfg) => {
                setQuotaEnabled(cfg.enabled)
                setQuotaInterval(cfg.interval)
            })
            .catch((e) => console.warn('Failed to load quota config:', e))
    }, [])

    const switchProject = config?.quotaExceeded?.switchProject ?? false
    const switchPreviewModel = config?.quotaExceeded?.switchPreviewModel ?? false

    const handleToggleSwitchProject = async (value: boolean) => {
        try {
            await configApi.updateSwitchProject(value)
            updateConfigValue('quota-exceeded', {
                ...(config?.quotaExceeded || {}),
                switchProject: value,
            })
        } catch {
            showNotification(t('common.error'), 'error')
        }
    }

    const handleToggleSwitchPreview = async (value: boolean) => {
        try {
            await configApi.updateSwitchPreviewModel(value)
            updateConfigValue('quota-exceeded', {
                ...(config?.quotaExceeded || {}),
                switchPreviewModel: value,
            })
        } catch {
            showNotification(t('common.error'), 'error')
        }
    }

    const handleQuotaEnabledChange = useCallback(
        (enabled: boolean) => {
            if (enabled) {
                showConfirmation({
                    title: t('credentials.quota_enable_confirm_title', { defaultValue: 'Enable Quota Polling?' }),
                    message: t('credentials.quota_enable_confirm_message', {
                        defaultValue:
                            'This will make the backend periodically query provider APIs to check quota status. This may count toward provider rate limits.',
                    }),
                    confirmText: t('common.confirm'),
                    variant: 'primary',
                    onConfirm: async () => {
                        try {
                            await quotaApi.putConfig({ enabled: true, interval: quotaInterval })
                            setQuotaEnabled(true)
                            showNotification(
                                t('credentials.quota_enabled_success', { defaultValue: 'Quota polling enabled' }),
                                'success'
                            )
                        } catch {
                            showNotification(t('common.error'), 'error')
                        }
                    },
                })
            } else {
                void quotaApi
                    .putConfig({ enabled: false })
                    .then(() => {
                        setQuotaEnabled(false)
                        showNotification(
                            t('credentials.quota_disabled_success', { defaultValue: 'Quota polling disabled' }),
                            'success'
                        )
                    })
                    .catch(() => showNotification(t('common.error'), 'error'))
            }
        },
        [quotaInterval, showConfirmation, showNotification, t]
    )

    const handleIntervalChange = useCallback(
        (value: string) => {
            const seconds = Number(value)
            if (!Number.isFinite(seconds) || seconds < 60) {
                return
            }
            setQuotaInterval(seconds)
            if (quotaEnabled) {
                void quotaApi
                    .putConfig({ enabled: true, interval: seconds })
                    .catch(() => showNotification(t('common.error'), 'error'))
            }
        },
        [quotaEnabled, showNotification, t]
    )

    const intervalOptions = useMemo(
        () => [
            { value: '60', label: '1 min' },
            { value: '180', label: '3 min' },
            { value: '300', label: '5 min' },
            { value: '600', label: '10 min' },
            { value: '1800', label: '30 min' },
        ],
        []
    )

    const timezoneOptions = useMemo(
        () =>
            TIMEZONE_OPTIONS.map((tz) => ({
                value: tz.value,
                label: tz.value === '' ? t('credentials.timezone_system') : tz.label,
            })),
        [t]
    )

    return (
        <div className={styles.section}>
            <h3 className={styles.title}>{t('credentials.global_settings')}</h3>
            <div className={styles.toggles}>
                <ToggleSwitch
                    label={t('credentials.switch_project_on_quota')}
                    checked={switchProject}
                    disabled={disableControls}
                    onChange={handleToggleSwitchProject}
                />
                <ToggleSwitch
                    label={t('credentials.switch_preview_on_quota')}
                    checked={switchPreviewModel}
                    disabled={disableControls}
                    onChange={handleToggleSwitchPreview}
                />
            </div>
            <p className={styles.hint}>{t('credentials.settings_sync_hint')}</p>

            <div className={styles.pollInterval}>
                <ToggleSwitch
                    label={t('credentials.quota_auto_refresh', { defaultValue: 'Backend Quota Polling' })}
                    checked={quotaEnabled}
                    disabled={disableControls}
                    onChange={handleQuotaEnabledChange}
                />
            </div>

            {quotaEnabled && (
                <div className={styles.pollInterval}>
                    <label className={styles.pollIntervalLabel}>{t('credentials.quota_poll_interval')}</label>
                    <Select value={String(quotaInterval)} onChange={handleIntervalChange} options={intervalOptions} />
                </div>
            )}

            <div className={styles.pollInterval}>
                <label className={styles.pollIntervalLabel}>{t('credentials.timezone')}</label>
                <Select value={timezone} onChange={setTimezone} options={timezoneOptions} />
            </div>

            <div className={styles.oauthLinks}>
                <h4 className={styles.subtitle}>{t('credentials.oauth_settings')}</h4>
                <div className={styles.linkList}>
                    <button
                        type="button"
                        className={styles.linkItem}
                        onClick={() => navigate('/credentials/oauth-model-alias')}
                        disabled={disableControls}
                    >
                        <span>{t('credentials.oauth_model_alias_manage')}</span>
                        <IconChevronRight size={14} />
                    </button>
                    <button
                        type="button"
                        className={styles.linkItem}
                        onClick={() => navigate('/credentials/oauth-excluded')}
                        disabled={disableControls}
                    >
                        <span>{t('credentials.oauth_excluded_manage')}</span>
                        <IconChevronRight size={14} />
                    </button>
                </div>
            </div>
        </div>
    )
}
