import {Card} from '@/components/ui/Card'
import type {UsageSummary} from '@/services/api/usage'
import {useTranslation} from 'react-i18next'
import {UnifiedTrendChart} from './UnifiedTrendChart'

interface TokenBreakdownChartProps {
    summary: UsageSummary | null
    loading: boolean
    isMobile: boolean
}

export function TokenBreakdownChart({ summary, loading, isMobile }: TokenBreakdownChartProps) {
    const { t } = useTranslation()

    return (
        <Card title={t('usage_stats.token_breakdown')}>
            <UnifiedTrendChart
                summary={summary}
                loading={loading}
                chartDimension='total'
                isMobile={isMobile}
                metric='token_breakdown'
            />
        </Card>
    )
}
