import {Button} from '@/components/ui/Button'
import layoutStyles from '@/pages/ProviderEditLayout.module.scss'
import {useTranslation} from 'react-i18next'

interface FloatingEditActionsProps {
    onBack: () => void;
    onSave: () => void;
    saving: boolean;
    canSave: boolean;
}

export function FloatingEditActions({ onBack, onSave, saving, canSave }: FloatingEditActionsProps) {
    const { t } = useTranslation()

    return (
        <div className={layoutStyles.floatingActions}>
            <Button variant='secondary' size='sm' onClick={onBack} className={layoutStyles.floatingBackButton}>
                {t('common.back')}
            </Button>
            <Button
                size='sm'
                onClick={onSave}
                loading={saving}
                disabled={!canSave}
                className={layoutStyles.floatingSaveButton}
            >
                {t('common.save')}
            </Button>
        </div>
    )
}
