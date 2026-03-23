import {Button} from '@/components/ui/Button'
import styles from '@/pages/UsagePage.module.scss'
import type {ChartDimension} from '@/utils/usage'
import {useTranslation} from 'react-i18next'

interface DimensionSelectorProps {
    dimension: ChartDimension;
    onChange: (dimension: ChartDimension) => void;
}

const DIMENSIONS: ChartDimension[] = ['total', 'model', 'credential']

export function DimensionSelector({ dimension, onChange }: DimensionSelectorProps) {
    const { t } = useTranslation()

    const labels: Record<ChartDimension, string> = {
        total: t('usage_stats.dimension_total'),
        model: t('usage_stats.dimension_model'),
        credential: t('usage_stats.dimension_credential'),
    }

    return (
        <div className={styles.dimensionBar}>
            <span className={styles.dimensionLabel}>{t('usage_stats.dimension_label')}</span>
            <div className={styles.dimensionButtons}>
                {DIMENSIONS.map((dim) => (
                    <Button
                        key={dim}
                        variant={dimension === dim ? 'primary' : 'secondary'}
                        size='sm'
                        onClick={() => onChange(dim)}
                    >
                        {labels[dim]}
                    </Button>
                ))}
            </div>
        </div>
    )
}
