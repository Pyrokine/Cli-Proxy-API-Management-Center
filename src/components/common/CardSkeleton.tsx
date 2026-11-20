import {useTranslation} from 'react-i18next'
import styles from './CardSkeleton.module.scss'

export interface CardSkeletonProps {
    variant?: 'rows' | 'chart' | 'grid'
    rowCount?: number
    showTitle?: boolean
    className?: string
}

export function CardSkeleton({ variant = 'rows', rowCount = 3, showTitle = true, className }: CardSkeletonProps) {
    const { t } = useTranslation()
    const cls   = `${styles.skeletonRoot} ${className || ''}`.trim()
    return (
        <div className={cls} aria-busy='true' aria-label={t('common.loading')} role='status'>
            {showTitle && (
                <div className={styles.skeletonHeader}>
                    <div className={`${styles.skeletonBar} ${styles.skeletonTitle}`} />
                </div>
            )}
            {variant === 'rows' &&
             Array.from({ length: rowCount }).map((_, i) => (
                 <div
                     key={i}
                     className={`${styles.skeletonBar} ${styles.skeletonRow} ${
                         i === rowCount - 1 ? styles.skeletonRowShort : ''
                     }`}
                 />
             ))}
            {variant === 'chart' && <div className={`${styles.skeletonBar} ${styles.skeletonChart}`} />}
            {variant === 'grid' && (
                <div className={styles.skeletonGrid}>
                    {Array.from({ length: rowCount }).map((_, i) => (
                        <div key={i} className={`${styles.skeletonBar} ${styles.skeletonGridCell}`} />
                    ))}
                </div>
            )}
        </div>
    )
}
