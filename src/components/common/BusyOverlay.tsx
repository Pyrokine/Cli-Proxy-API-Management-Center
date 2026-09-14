import {LoadingSpinner} from '@/components/ui/LoadingSpinner'
import type {ReactNode} from 'react'
import styles from './BusyOverlay.module.scss'

interface BusyOverlayProps {
    label: ReactNode
}

export function BusyOverlay({ label }: BusyOverlayProps) {
    return (
        <div className={styles.overlay} aria-busy='true'>
            <div className={styles.pill}>
                <LoadingSpinner size={16} className={styles.spinner} />
                <span>{label}</span>
            </div>
        </div>
    )
}
