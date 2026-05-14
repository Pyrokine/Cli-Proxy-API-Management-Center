import { Button } from '@/components/ui/Button'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import styles from './NotFoundPage.module.scss'

export function NotFoundPage() {
    const { t } = useTranslation()
    const navigate = useNavigate()
    const location = useLocation()

    return (
        <div className={styles.page}>
            <span className={styles.code}>404</span>
            <h1 className={styles.title}>{t('not_found.title')}</h1>
            <p className={styles.path}>{location.pathname}</p>
            <Button variant="primary" size="sm" onClick={() => navigate('/', { replace: true })}>
                {t('not_found.back_home')}
            </Button>
        </div>
    )
}
