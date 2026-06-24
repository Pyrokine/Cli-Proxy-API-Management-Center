import {ToggleSwitch} from '@/components/ui/ToggleSwitch'
import {configApi} from '@/services/api/config'
import {useConfigStore, useNotificationStore} from '@/stores'
import type {Config} from '@/types'
import {useTranslation} from 'react-i18next'
import styles from './GlobalSettings.module.scss'

interface GlobalSettingsProps {
    config: Config | null
    disableControls: boolean
}

export function GlobalSettings({ config, disableControls }: GlobalSettingsProps) {
    const { t }             = useTranslation()
    const updateConfigValue = useConfigStore((s) => s.updateConfigValue)
    const showNotification  = useNotificationStore((s) => s.showNotification)

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
        </div>
    )
}
