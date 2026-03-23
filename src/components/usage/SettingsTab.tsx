import {getModelNamesFromUsage, type ModelPrice} from '@/utils/usage'
import {useMemo} from 'react'
import type {UsagePayload} from './hooks/useUsageData'
import {PriceSettingsCard} from './PriceSettingsCard'
import {UsageRetentionCard} from './UsageRetentionCard'

interface SettingsTabProps {
    usage: UsagePayload | null;
    modelPrices: Record<string, ModelPrice>;
    onPricesChange: (prices: Record<string, ModelPrice>) => void;
}

export function SettingsTab({ usage, modelPrices, onPricesChange }: SettingsTabProps) {
    const modelNames = useMemo(() => getModelNamesFromUsage(usage), [usage])

    return (
        <>
            <PriceSettingsCard modelNames={modelNames} modelPrices={modelPrices} onPricesChange={onPricesChange} />
            <UsageRetentionCard />
        </>
    )
}
