import type {Config} from '@/types'
import {useTranslation} from 'react-i18next'
import styles from './GlobalSettings.module.scss'

interface GlobalSettingsProps {
    config: Config | null
    disableControls: boolean
}

export function GlobalSettings({ config }: GlobalSettingsProps) {
    const { t }            = useTranslation()
    const formatSavedValue = (value: boolean | undefined) =>
        value === undefined ? '—' : t(value ? 'common.enabled' : 'common.disabled')

    return (
        <div className={styles.section}>
            <h3 className={styles.title}>
                {t('credentials.legacy_quota_settings', { defaultValue: 'Legacy quota settings' })}
            </h3>
            <p className={styles.hint}>
                {t('config_management.visual.quota_switch_inactive_hint', {
                    defaultValue: 'These values are kept for compatibility. The server does not use them for routing.',
                })}
            </p>
            <dl className={styles.settings}>
                <div>
                    <dt>{t('credentials.switch_project_on_quota')}</dt>
                    <dd>{formatSavedValue(config?.quotaExceeded?.switchProject)}</dd>
                </div>
                <div>
                    <dt>{t('credentials.switch_preview_on_quota')}</dt>
                    <dd>{formatSavedValue(config?.quotaExceeded?.switchPreviewModel)}</dd>
                </div>
            </dl>
        </div>
    )
}
