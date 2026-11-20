import {Card} from '@/components/ui/Card'
import {useTranslation} from 'react-i18next'
import {CostRecalculationCard} from './CostRecalculationCard'
import {UsageRetentionCard} from './UsageRetentionCard'
import {UsageStorageUpgradeCard} from './UsageStorageUpgradeCard'

export function SettingsTab() {
    const { t } = useTranslation()

    return (
        <>
            <Card title={t('usage_stats.maintenance_title')}>
                <UsageStorageUpgradeCard embedded />
                <CostRecalculationCard embedded />
            </Card>
            <UsageRetentionCard />
        </>
    )
}
