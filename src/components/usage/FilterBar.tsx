import {Button} from '@/components/ui/Button'
import {DateRangePicker} from '@/components/ui/DateRangePicker'
import {MultiSelect} from '@/components/ui/MultiSelect'
import {Select} from '@/components/ui/Select'
import {formatAuthFileDisplayName, inferProviderFromAuthFileName} from '@/features/authFiles/constants'
import type {UsageSummary} from '@/services/api/usage'
import type {CredentialInfo} from '@/types/sourceInfo'
import {formatDateTime} from '@/utils/format'
import {getCredentialSourcesFromUsage, getModelNamesFromUsage, getSummaryDataStart} from '@/utils/usage'
import {summaryToCredentialEntries} from '@/utils/usage/summaryHelpers'
import {useMemo} from 'react'
import {useTranslation} from 'react-i18next'
import styles from './FilterBar.module.scss'
import type {UsagePayload} from './hooks/useUsageData'

function formatTime(date: Date): string {
    const full = formatDateTime(date)
    return full ? (full.split(' ')[1] ?? full) : ''
}

// capitalizeProvider keeps credential vendor tags consistent across the
// filter dropdown and stats cards.
function capitalizeProvider(name: string): string {
    if (!name) {
        return ''
    }
    if (name === 'gemini-cli' || name === 'aistudio') {
        return 'Gemini'
    }
    if (name === 'antigravity') {
        return 'Claude'
    }
    return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase()
}

function formatCredentialOptionLabel(
    provider: string,
    source: string,
    sourceKind: 'api_key' | 'identity' | '',
    aliases?: Record<string, string>,
): string {
    const aliasOrMasked = aliases?.[source] || maskSensitiveKey(source)
    const kindLabel     = sourceKind === 'api_key' ? 'API key' : sourceKind === 'identity' ? 'Identity' : ''
    const display       = kindLabel ? `${aliasOrMasked} · ${kindLabel}` : aliasOrMasked
    if (provider) {
        return `[${capitalizeProvider(provider)}] ${display}`
    }
    return display
}

function normalizeCredentialOption(
    entry: {
        filterKey: string
        provider: string
        source: string
        sourceKind: 'api_key' | 'identity' | ''
    },
    aliases?: Record<string, string>,
): { value: string; label: string } {
    const inferredProvider = entry.provider || inferProviderFromAuthFileName(entry.source)
    const normalizedSource = inferredProvider ? formatAuthFileDisplayName(entry.source) || entry.source : entry.source
    return {
        value: entry.filterKey,
        label: formatCredentialOptionLabel(inferredProvider, normalizedSource, entry.sourceKind, aliases),
    }
}

function normalizeCredentialProviderForDisplay(provider: string): string {
    return capitalizeProvider(provider).toLowerCase()
}

function buildCredentialOptionDisplayKey(provider: string, source: string, aliases?: Record<string, string>): string {
    const displaySource = aliases?.[source] || maskSensitiveKey(source)
    return `${normalizeCredentialProviderForDisplay(provider)}::${displaySource.toLowerCase()}`
}

function buildCredentialOptionsFromSummary(
    sourceSummary: UsageSummary | null | undefined,
    aliases?: Record<string, string>,
): Array<{ value: string; label: string }> {
    if (!sourceSummary?.by_credential) {
        return []
    }

    const deduped = new Map<string, { value: string; label: string; sortKey: string }>()
    summaryToCredentialEntries(sourceSummary.by_credential).forEach((entry) => {
        const option    = normalizeCredentialOption(entry, aliases)
        const dedupeKey = entry.filterKey || buildCredentialOptionDisplayKey(entry.provider, entry.source, aliases)
        if (!deduped.has(dedupeKey)) {
            deduped.set(dedupeKey, { ...option, sortKey: option.label.toLowerCase() })
        }
    })

    return Array.from(deduped.values())
                .sort((a, b) => a.sortKey.localeCompare(b.sortKey))
                .map(({ value, label }) => ({ value, label }))
}

// alias 缺失时的脱敏:保留可识别前缀 + 后 8 位指纹,既不泄露完整 secret,
// 也不让操作员只看到一团 *** 失去识别力，短串(<16)直接放过——业务里多
// 是 OAuth 邮箱、文件名,不属于 secret 范畴，
function maskSensitiveKey(key: string): string {
    if (!key || key.length < 16) {
        return key
    }
    if (key.startsWith('sk-')) {
        return `sk-***${key.slice(-8)}`
    }
    return `${key.slice(0, 4)}***${key.slice(-8)}`
}

// (none) sentinel 用于筛选 api_key 为空的 OAuth 行,后端在 inClause
// 里专门支持 IS NULL 分支(internal/usage/sqlite_query.go),这里把它从
// 排除名单挪到展示名单，
const NONE_API_KEY_SENTINEL = '(none)'
const STATUS_ALL            = ''
const STATUS_SUCCESS        = 'success'
const STATUS_FAILURE        = 'failure'

interface FilterBarProps {
    usage: UsagePayload | null
    dateFrom: string
    dateTo: string
    activePreset: string | undefined
    onDateRangeChange: (from: string, to: string, preset?: string) => void
    selectedModels: string[]
    onSelectedModelsChange: (models: string[]) => void
    selectedCredentials: string[]
    onSelectedCredentialsChange: (credentials: string[]) => void
    selectedApiKeys?: string[]
    onSelectedApiKeysChange?: (keys: string[]) => void
    selectedStatus?: string
    onSelectedStatusChange?: (status: string) => void
    summary?: UsageSummary | null
    // Separate summary without filter params, used to populate option lists.
    // Without this, selecting one option would collapse the dropdown to just that option.
    optionsSummary?: UsageSummary | null
    aliases?: Record<string, string>
    authFileMap?: Map<string, CredentialInfo>
    onExport: () => void
    onImport: () => void
    onRefresh: () => void
    loading: boolean
    exporting: boolean
    importing: boolean
    lastRefreshedAt: Date | null
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
                              selectedApiKeys,
                              onSelectedApiKeysChange,
                              selectedStatus,
                              onSelectedStatusChange,
                              summary,
                              optionsSummary,
                              aliases,
                              authFileMap,
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
        const sourceSummary = optionsSummary ?? summary
        if (sourceSummary?.by_model) {
            const names = Object.keys(sourceSummary.by_model).filter((name) => name.trim().length > 0)
            if (names.length > 0) {
                return names.sort().map((name) => ({ value: name, label: name }))
            }
        }
        const names = getModelNamesFromUsage(usage)
        return names.map((name) => ({ value: name, label: name }))
    }, [usage, optionsSummary, summary])

    const credentialOptions = useMemo(() => {
        const sourceSummary  = optionsSummary ?? summary
        const summaryOptions = buildCredentialOptionsFromSummary(sourceSummary, aliases)
        if (summaryOptions.length > 0) {
            return summaryOptions
        }

        if (authFileMap && authFileMap.size > 0) {
            const seen    = new Set<string>()
            const options = Array.from(authFileMap.values()).reduce<
                Array<{ value: string; label: string; sortKey: string }>
            >((result, info) => {
                const rawName = info.rawName || info.name
                if (!rawName || seen.has(rawName)) {
                    return result
                }
                seen.add(rawName)
                const provider = info.type || inferProviderFromAuthFileName(rawName)
                const source   = formatAuthFileDisplayName(rawName) || info.name
                result.push({
                                value: rawName,
                                label: formatCredentialOptionLabel(provider, source, '', aliases),
                                sortKey: `${normalizeCredentialProviderForDisplay(provider)}::${source.toLowerCase()}`,
                            })
                return result
            }, [])
            return options
                .sort((a, b) => a.sortKey.localeCompare(b.sortKey))
                .map(({ value, label }) => ({ value, label }))
        }

        const sources = getCredentialSourcesFromUsage(usage)
        return sources.sort().map((source) => ({ value: source, label: source }))
    }, [usage, optionsSummary, summary, aliases, authFileMap])

    const apiKeyOptions = useMemo(() => {
        const sourceSummary = optionsSummary ?? summary
        if (!sourceSummary?.by_api_key) {
            return []
        }
        // "(none)" 是后端给 OAuth 行分配的 synthetic bucket,保证 by_api_key
        // 守恒等于 totals，允许用户选它来定向看 OAuth 流量,后端 inClause
        // 已支持 NULL 分支(IS NULL OR IN ...)，
        return Object.keys(sourceSummary.by_api_key)
                     .filter((k) => k.trim().length > 0)
                     .sort()
                     .map((k) => ({
                         value: k,
                         label:
                             k === NONE_API_KEY_SENTINEL
                             ? t('usage_stats.filter_api_key_none', { defaultValue: '(无 API Key / OAuth)' })
                             : aliases?.[k] || maskSensitiveKey(k),
                     }))
    }, [optionsSummary, summary, aliases, t])

    const statusOptions = useMemo(
        () => [
            { value: STATUS_ALL, label: t('usage_stats.filter_all') },
            { value: STATUS_SUCCESS, label: t('stats.success') },
            { value: STATUS_FAILURE, label: t('stats.failure') },
        ],
        [t],
    )

    const earliestDate = useMemo(() => getSummaryDataStart(summary), [summary])

    return (
        <div className={styles.filterBar}>
            <div className={styles.filters}>
                <div className={`${styles.filterItem} ${styles.rangeFilterItem}`}>
                    <span className={styles.filterLabel}>{t('usage_stats.range_filter')}</span>
                    <DateRangePicker
                        from={dateFrom}
                        to={dateTo}
                        onChange={(from, to, preset) => onDateRangeChange(from, to, preset)}
                        activePreset={activePreset}
                        earliestDate={earliestDate}
                    />
                </div>
                <div className={styles.criteriaFilters}>
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
                    {apiKeyOptions.length > 0 && selectedApiKeys && onSelectedApiKeysChange && (
                        <div className={styles.filterItem}>
                            <span className={styles.filterLabel}>{t('usage_stats.filter_api_key')}</span>
                            <MultiSelect
                                values={selectedApiKeys}
                                options={apiKeyOptions}
                                onChange={onSelectedApiKeysChange}
                                allLabel={t('usage_stats.filter_all')}
                                fullWidth={false}
                                ariaLabel='API Key'
                                className={styles.filterSelect}
                            />
                        </div>
                    )}
                    {selectedStatus !== undefined && onSelectedStatusChange && (
                        <div className={styles.filterItem}>
                            <span className={styles.filterLabel}>{t('usage_stats.request_events_result')}</span>
                            <Select
                                value={selectedStatus}
                                options={statusOptions}
                                onChange={onSelectedStatusChange}
                                fullWidth={false}
                                ariaLabel={t('usage_stats.request_events_result')}
                                className={styles.statusSelect}
                            />
                        </div>
                    )}
                </div>
            </div>
            <div className={styles.actions}>
                <Button
                    variant='secondary'
                    size='sm'
                    onClick={onExport}
                    loading={exporting}
                    disabled={loading || importing}
                >
                    {t('usage_stats.export')}
                </Button>
                <Button
                    variant='secondary'
                    size='sm'
                    onClick={onImport}
                    loading={importing}
                    disabled={loading || exporting}
                >
                    {t('usage_stats.import')}
                </Button>
                <Button
                    variant='secondary'
                    size='sm'
                    onClick={onRefresh}
                    loading={loading}
                    disabled={exporting || importing}
                >
                    {t('usage_stats.refresh')}
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
