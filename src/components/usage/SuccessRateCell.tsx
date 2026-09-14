import styles from '@/pages/UsagePage.module.scss'

interface SuccessRateCellProps {
    value: number
}

export function SuccessRateCell({ value }: SuccessRateCellProps) {
    const className =
              value >= 95 ? styles.statSuccess : value >= 80 ? styles.statNeutral : styles.statFailure

    return <span className={className}>{value.toFixed(1)}%</span>
}
