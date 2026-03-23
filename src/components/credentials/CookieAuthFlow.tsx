import {Button} from '@/components/ui/Button'
import {Input} from '@/components/ui/Input'
import {oauthApi} from '@/services/api/oauth'
import {useNotificationStore} from '@/stores'
import {type ChangeEvent, useCallback, useState} from 'react'
import {useTranslation} from 'react-i18next'
import styles from './VendorSection.module.scss'

interface CookieAuthFlowProps {
    disableControls: boolean;
    onSuccess: () => Promise<void>;
    onCancel: () => void;
}

export function CookieAuthFlow({ disableControls, onSuccess, onCancel }: CookieAuthFlowProps) {
    const { t }                 = useTranslation()
    const showNotification      = useNotificationStore((s) => s.showNotification)
    const [cookie, setCookie]   = useState('')
    const [loading, setLoading] = useState(false)

    const handleSubmit = useCallback(async () => {
        if (!cookie.trim()) {
            return
        }
        setLoading(true)
        try {
            const result = await oauthApi.iflowCookieAuth(cookie.trim())
            if (result.status === 'ok') {
                showNotification(t('common.success'), 'success')
                await onSuccess()
            } else {
                showNotification(result.error || t('common.error'), 'error')
            }
        } catch {
            showNotification(t('common.error'), 'error')
        } finally {
            setLoading(false)
        }
    }, [cookie, onSuccess, showNotification, t])

    return (
        <div className={styles.flowArea}>
            <Input
                placeholder={t('credentials.iflow_cookie_placeholder')}
                value={cookie}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setCookie(e.target.value)}
                disabled={disableControls || loading}
            />
            <div className={styles.flowButtons}>
                <Button variant='primary' size='xs' onClick={handleSubmit} loading={loading} disabled={!cookie.trim()}>
                    {t('credentials.oauth_callback_submit')}
                </Button>
                <Button variant='secondary' size='xs' onClick={onCancel}>
                    {t('common.cancel')}
                </Button>
            </div>
        </div>
    )
}
