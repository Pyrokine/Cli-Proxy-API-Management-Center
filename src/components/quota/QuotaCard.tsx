/**
 * Generic quota card component.
 */

import type styles from '@/pages/QuotaPage.module.scss'
import type {ReactElement} from 'react'

export interface QuotaProgressBarProps {
    percent: number | null;
    highThreshold: number;
    mediumThreshold: number;
}

export interface QuotaRenderHelpers {
    styles: typeof styles;
    QuotaProgressBar: (props: QuotaProgressBarProps) => ReactElement;
}
