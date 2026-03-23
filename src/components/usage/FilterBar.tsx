import {Button} from '@/components/ui/Button'
import {DateRangePicker} from '@/components/ui/DateRangePicker'
import {MultiSelect} from '@/components/ui/MultiSelect'
import {getEffectiveTimezone} from '@/stores/useTimezoneStore'
import {getCredentialSourcesFromUsage, getModelNamesFromUsage} from '@/utils/usage'
import {useMemo} from 'react'
import {useTranslation} from 'react-i18next'
import styles from './FilterBar.module.scss'
import type {UsagePayload} from './hooks/useUsageData'

function formatTime(date: Date): string {
    const timeZone = getEffectiveTimezone()
    return date.toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        ...(timeZone ? { timeZone } : {}),
    })
}

interface FilterBarProps {
    usage: UsagePayload | null;
    dateFrom: string;
    dateTo: string;
    activePreset: string | undefined;
    onDateRangeChange: (from: string, to: string, preset?: string) => void;
    selectedModels: string[];
    onSelectedModelsChange: (models: string[]) => void;
    selectedCredentials: string[];
    onSelectedCredentialsChange: (credentials: string[]) => void;
    onExport: () => void;
    onImport: () => void;
    onRefresh: () => void;
    loading: boolean;
    exporting: boolean;
    importing: boolean;
    lastRefreshedAt: Date | null;
}

export function FilterBar({
                              usage,
                              dateFrom,
                              dateTo,
                              activePreset,
                              onDateRangeChange,
                              selectedModels,
                              onSelectedModelsChange,
                              selectedCredentials,
                              onSelectedCredentialsChange,
                              onExport,
                              onImport,
                              onRefresh,
                              loading,
                              exporting,
                              importing,
                              lastRefreshedAt,
                          }: FilterBarProps) {
    const { t } = useTranslation()

    const modelOptions = useMemo(() => {
        const names = getModelNamesFromUsage(usage)
        return names.map((name) => ({ value: name, label: name }))
    }, [usage])

    const credentialOptions = useMemo(() => {
        const sources = getCredentialSourcesFromUsage(usage)
        return sources.map((s) => ({ value: s, label: s }))
    }, [usage])

    return (
        <div className={styles.filterBar}>
            <div className={styles.filters}>
                <div className={styles.filterItem}>
                    <span className={styles.filterLabel}>{t('usage_stats.range_filter')}</span>
                    <DateRangePicker
                        from={dateFrom}
                        to={dateTo}
                        onChange={(from, to, preset) => onDateRangeChange(from, to, preset)}
                        activePreset={activePreset}
                    />
                </div>
                {modelOptions.length > 0 && (
                    <div className={styles.filterItem}>
                        <span className={styles.filterLabel}>{t('usage_stats.request_events_filter_model')}</span>
                        <MultiSelect
                            values={selectedModels}
                            options={modelOptions}
                            onChange={onSelectedModelsChange}
                            allLabel={t('usage_stats.filter_all')}
                            fullWidth={false}
                            ariaLabel={t('usage_stats.request_events_filter_model')}
                            className={styles.filterSelect}
                        />
                    </div>
                )}
                {credentialOptions.length > 0 && (
                    <div className={styles.filterItem}>
                        <span className={styles.filterLabel}>{t('usage_stats.credential_name')}</span>
                        <MultiSelect
                            values={selectedCredentials}
                            options={credentialOptions}
                            onChange={onSelectedCredentialsChange}
                            allLabel={t('usage_stats.filter_all')}
                            fullWidth={false}
                            ariaLabel={t('usage_stats.credential_name')}
                            className={styles.filterSelect}
                        />
                    </div>
                )}
            </div>
            <div className={styles.actions}>
                <Button variant='secondary' size='sm' onClick={onExport} loading={exporting}
                        disabled={loading || importing}>
                    {t('usage_stats.export')}
                </Button>
                <Button variant='secondary' size='sm' onClick={onImport} loading={importing}
                        disabled={loading || exporting}>
                    {t('usage_stats.import')}
                </Button>
                <Button variant='secondary' size='sm' onClick={onRefresh} disabled={loading || exporting || importing}>
                    {loading ? t('common.loading') : t('usage_stats.refresh')}
                </Button>
                {lastRefreshedAt && (
                    <span className={styles.lastRefreshed}>
            {t('usage_stats.last_updated')}: {formatTime(lastRefreshedAt)}
          </span>
                )}
            </div>
        </div>
    )
}
