import {IconChevronRight} from '@/components/ui/icons'
import {Select} from '@/components/ui/Select'
import {ToggleSwitch} from '@/components/ui/ToggleSwitch'
import {configApi} from '@/services/api/config'
import {useQuotaScheduler} from '@/services/quota/useQuotaScheduler'
import {useConfigStore, useNotificationStore} from '@/stores'
import type {Config} from '@/types'
import {useMemo} from 'react'
import {useTranslation} from 'react-i18next'
import {useNavigate} from 'react-router-dom'
import styles from './GlobalSettings.module.scss'

interface GlobalSettingsProps {
    config: Config | null;
    disableControls: boolean;
}

export function GlobalSettings({ config, disableControls }: GlobalSettingsProps) {
    const { t }             = useTranslation()
    const navigate          = useNavigate()
    const updateConfigValue = useConfigStore((s) => s.updateConfigValue)
    const showNotification  = useNotificationStore((s) => s.showNotification)
    const scheduler         = useQuotaScheduler()

    const pollIntervalOptions = useMemo(() => [
        { value: '0', label: t('credentials.poll_interval_disabled') },
        { value: '60000', label: t('credentials.poll_interval_1min') },
        { value: '180000', label: t('credentials.poll_interval_3min') },
        { value: '300000', label: t('credentials.poll_interval_5min') },
        { value: '600000', label: t('credentials.poll_interval_10min') },
    ], [t])

    const switchProject      = config?.quotaExceeded?.switchProject ?? false
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

    const handleIntervalChange = (value: string) => {
        const ms = Number(value)
        if (Number.isFinite(ms) && ms >= 0) {
            scheduler.setBaseInterval(ms)
        }
    }

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

            <div className={styles.pollInterval}>
                <label className={styles.pollIntervalLabel}>
                    {t('credentials.quota_poll_interval')}
                </label>
                <Select
                    value={String(scheduler.currentBaseInterval)}
                    onChange={handleIntervalChange}
                    options={pollIntervalOptions}
                />
            </div>

            <div className={styles.oauthLinks}>
                <h4 className={styles.subtitle}>{t('credentials.oauth_settings')}</h4>
                <div className={styles.linkList}>
                    <button
                        type='button'
                        className={styles.linkItem}
                        onClick={() => navigate('/credentials/oauth-model-alias')}
                        disabled={disableControls}
                    >
                        <span>{t('credentials.oauth_model_alias_manage')}</span>
                        <IconChevronRight size={14} />
                    </button>
                    <button
                        type='button'
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
