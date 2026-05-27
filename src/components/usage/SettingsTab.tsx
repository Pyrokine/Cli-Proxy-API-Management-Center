import styles from '@/pages/UsagePage.module.scss'
import type {ModelPrice} from '@/utils/usage'
import type {PriceSaveFeedback} from './hooks/useUsageData'
import {PriceSettingsCard} from './PriceSettingsCard'
import {UsageRetentionCard} from './UsageRetentionCard'

interface SettingsTabProps {
    modelNames: string[]
    modelPrices: Record<string, ModelPrice>
    priceSaveFeedback: PriceSaveFeedback | null
    onPricesChange: (prices: Record<string, ModelPrice>) => Promise<void>
}

export function SettingsTab({ modelNames, modelPrices, priceSaveFeedback, onPricesChange }: SettingsTabProps) {
    return (
        <div className={styles.settingsCardsGrid}>
            <PriceSettingsCard
                modelNames={modelNames}
                modelPrices={modelPrices}
                priceSaveFeedback={priceSaveFeedback}
                onPricesChange={onPricesChange}
            />
            <UsageRetentionCard />
        </div>
    )
}
