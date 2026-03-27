import {Button} from '@/components/ui/Button'
import {IconDownload, IconPencil, IconRefreshCw, IconTrash2} from '@/components/ui/icons'
import {ToggleSwitch} from '@/components/ui/ToggleSwitch'
import type {StatusBarData, StatusBlockDetail} from '@/utils/usage'
import {rateToColor} from '@/utils/usage'
import type React from 'react'
import {useCallback, useState} from 'react'
import {useTranslation} from 'react-i18next'
import styles from './CredentialCard.module.scss'

export interface QuotaItem {
    /** Model name or bucket label */
    model: string;
    /** Usage percentage 0-100 */
    percent: number;
    /** Human-readable reset label (e.g. "3h" or "2026-03-10 08:00") */
    resetLabel?: string;
}

interface RequestStats {
    success: number;
    failure: number;
}

interface RefreshState {
    lastRefreshTime: Date | null;
    nextRefreshTime: Date | null;
    isRefreshing: boolean;
    onRefresh: () => void;
}

interface CredentialCardProps {
    /** Visual category of the credential */
    category: 'api-key' | 'auth-file';
    /** Primary display text (masked key or file name) */
    title: string;
    /** Optional highlighted title (JSX with <mark> tags for search matching) */
    highlightTitle?: React.ReactNode;
    /** Current alias for this credential (displayed as subtitle) */
    alias?: string;
    /** Callback to set/update alias */
    onAliasChange?: (alias: string) => void;
    /** Colored badge (e.g. "API Key", "gemini-cli") */
    badge?: { label: string; color?: string; bgColor?: string };
    /** Key-value metadata */
    fields?: { label: string; value: string }[];
    /** Tags (model count, headers, etc.) */
    tags?: string[];
    /** Whether the credential is disabled/inactive */
    disabled?: boolean;
    /** Disable all interactive controls */
    disableControls?: boolean;
    /** Navigate to edit page */
    onEdit?: () => void;
    /** Delete credential */
    onDelete?: () => void;
    /** Toggle enabled/disabled state */
    onToggle?: (enabled: boolean) => void;
    /** Download credential file */
    onDownload?: () => void;
    /** Quota usage data */
    quotaItems?: QuotaItem[];
    /** Quota fetch error message */
    quotaError?: string;
    /** Quota is currently loading */
    quotaLoading?: boolean;
    /** Request success/failure stats */
    stats?: RequestStats;
    /** Status bar block data (20 time-bucketed blocks) */
    statusBar?: StatusBarData;
    /** Refresh scheduling state */
    refreshState?: RefreshState;
}

/** Classify quota bar color by remaining percentage. */
function quotaBarClass(percent: number): string {
    if (percent >= 50) {
        return styles.barHigh
    }
    if (percent >= 20) {
        return styles.barMedium
    }
    return styles.barLow
}

/** Format a Date to relative time string. */
function relativeTime(date: Date): string {
    const diff     = Date.now() - date.getTime()
    const absDiff  = Math.abs(diff)
    const isFuture = diff < 0

    if (absDiff < 60_000) {
        return '< 1m'
    }
    const minutes = Math.floor(absDiff / 60_000)
    if (minutes < 60) {
        return isFuture ? `${minutes}m` : `${minutes}m`
    }
    const hours = Math.floor(minutes / 60)
    return isFuture ? `${hours}h` : `${hours}h`
}

function statusRateClass(rate: number): string {
    if (rate >= 90) {
        return styles.statusRateHigh
    }
    if (rate >= 50) {
        return styles.statusRateMedium
    }
    return styles.statusRateLow
}

export function CredentialCard({
                                   title,
                                   highlightTitle,
                                   alias,
                                   onAliasChange,
                                   badge,
                                   fields,
                                   tags,
                                   disabled,
                                   disableControls,
                                   onEdit,
                                   onDelete,
                                   onToggle,
                                   onDownload,
                                   quotaItems,
                                   quotaError,
                                   quotaLoading,
                                   stats,
                                   statusBar,
                                   refreshState,
                               }: CredentialCardProps) {
    const { t }                           = useTranslation()
    const [editingAlias, setEditingAlias] = useState(false)
    const [aliasInput, setAliasInput]     = useState('')

    const totalRequests = stats ? stats.success + stats.failure : 0

    const handleAliasEditStart = useCallback(() => {
        setAliasInput(alias || '')
        setEditingAlias(true)
    }, [alias])

    const handleAliasEditConfirm = useCallback(() => {
        const trimmed = aliasInput.trim()
        onAliasChange?.(trimmed)
        setEditingAlias(false)
    }, [aliasInput, onAliasChange])

    const handleAliasKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            handleAliasEditConfirm()
        } else if (e.key === 'Escape') {
            setEditingAlias(false)
        }
    }, [handleAliasEditConfirm])

    return (
        <div className={`${styles.card} ${disabled ? styles.disabled : ''}`}>
            {/* Header: badge + title */}
            <div className={styles.header}>
                {badge && (
                    <span className={styles.badge} style={{ color: badge.color, backgroundColor: badge.bgColor }}>
                        {badge.label}
                    </span>
                )}
                <span className={styles.title} title={title}>
                    {highlightTitle ?? title}
                </span>
                {onAliasChange && (
                    editingAlias ? (
                        <span className={styles.aliasEdit}>
                            <input
                                className={styles.aliasInput}
                                value={aliasInput}
                                onChange={(e) => setAliasInput(e.target.value)}
                                onKeyDown={handleAliasKeyDown}
                                onBlur={handleAliasEditConfirm}
                                placeholder={t('credentials.alias_placeholder', { defaultValue: 'alias' })}
                                maxLength={20}
                                autoFocus
                            />
                        </span>
                    ) : (
                        <button
                            type='button'
                            className={styles.aliasButton}
                            onClick={handleAliasEditStart}
                            disabled={disableControls}
                            title={t('credentials.edit_alias', { defaultValue: 'Edit alias' })}
                        >
                            <IconPencil size={10} />
                            <span>{alias || t('credentials.set_alias', { defaultValue: 'Set alias' })}</span>
                        </button>
                    )
                )}
            </div>

            {/* Metadata fields */}
            {fields && fields.length > 0 && (
                <div className={styles.fields}>
                    {fields.map((field) => (
                        <div key={field.label} className={styles.field}>
                            <span className={styles.fieldLabel}>{field.label}</span>
                            <span className={styles.fieldValue}>{field.value}</span>
                        </div>
                    ))}
                </div>
            )}

            {/* Tags */}
            {tags && tags.length > 0 && (
                <div className={styles.tags}>
                    {tags.map((tag) => (
                        <span key={tag} className={styles.tag}>
              {tag}
            </span>
                    ))}
                </div>
            )}

            {/* Request statistics: badges + status blocks */}
            {stats && totalRequests > 0 && (
                <div className={styles.statsSection}>
                    <div className={styles.statsBadges}>
            <span className={styles.statsBadgeSuccess}>
              {t('common.success')}: {stats.success}
            </span>
                        <span className={styles.statsBadgeFailure}>
              {t('common.failure')}: {stats.failure}
            </span>
                    </div>
                    {statusBar && (statusBar.totalSuccess > 0 || statusBar.totalFailure > 0) && (
                        <div className={styles.statusBar}>
                            <div className={styles.statusBlocks}>
                                {statusBar.blockDetails.map((detail: StatusBlockDetail, idx: number) => {
                                    const isIdle = detail.rate === -1
                                    return (
                                        <div key={idx} className={styles.statusBlockWrapper}>
                                            <div
                                                className={`${styles.statusBlock} ${isIdle ?
                                                                                    styles.statusBlockIdle :
                                                                                    ''}`}
                                                style={isIdle ?
                                                       undefined :
                                                    { backgroundColor: rateToColor(detail.rate) }}
                                            />
                                        </div>
                                    )
                                })}
                            </div>
                            <span className={`${styles.statusRate} ${statusRateClass(statusBar.successRate)}`}>
                {statusBar.successRate.toFixed(1)}%
              </span>
                        </div>
                    )}
                </div>
            )}

            {/* Quota section: progress bars / error / loading */}
            {(quotaItems || quotaError || quotaLoading) && (
                <div className={styles.quotaSection}>
                    {quotaLoading ? (
                        <div className={styles.quotaLoading}>{t('common.loading')}</div>
                    ) : quotaError ? (
                        <div className={styles.quotaError} title={quotaError}>
                            {quotaError}
                        </div>
                    ) : quotaItems && quotaItems.length > 0 ? (
                        quotaItems.map((item) => (
                            <div key={item.model} className={styles.quotaRow}>
                                <div className={styles.quotaRowHeader}>
                                    <span className={styles.quotaModel}>{item.model}</span>
                                    <span className={styles.quotaMeta}>
                    <span className={styles.quotaPercent}>{Math.round(item.percent)}%</span>
                                        {item.resetLabel &&
                                         <span className={styles.quotaReset}>{item.resetLabel}</span>}
                  </span>
                                </div>
                                <div className={styles.quotaBar}>
                                    <div
                                        className={`${styles.quotaBarFill} ${quotaBarClass(item.percent)}`}
                                        style={{ width: `${Math.min(item.percent, 100)}%` }}
                                    />
                                </div>
                            </div>
                        ))
                    ) : null}
                </div>
            )}

            {/* Refresh state */}
            {refreshState && (
                <div className={styles.refreshSection}>
                    <div className={styles.refreshTimes}>
                        {refreshState.lastRefreshTime && (
                            <span className={styles.refreshTime}>{relativeTime(refreshState.lastRefreshTime)}</span>
                        )}
                        {refreshState.nextRefreshTime && (
                            <span className={styles.refreshNext}>→ {relativeTime(refreshState.nextRefreshTime)}</span>
                        )}
                    </div>
                    <button
                        type='button'
                        className={`${styles.refreshButton} ${refreshState.isRefreshing ? styles.spinning : ''}`}
                        onClick={refreshState.onRefresh}
                        disabled={refreshState.isRefreshing || disableControls}
                        title={t('common.refresh')}
                    >
                        <IconRefreshCw size={12} />
                    </button>
                </div>
            )}

            {/* Actions: toggle + buttons */}
            <div className={styles.actions}>
                {onToggle && (
                    <ToggleSwitch
                        checked={!disabled}
                        disabled={disableControls}
                        onChange={onToggle}
                        ariaLabel={t('auth_files.status_toggle_label')}
                    />
                )}
                <div className={styles.buttons}>
                    {onEdit && (
                        <Button variant='secondary' size='sm' onClick={onEdit} disabled={disableControls}
                                title={t('common.edit')}>
                            <IconPencil size={14} />
                        </Button>
                    )}
                    {onDownload && (
                        <Button
                            variant='secondary'
                            size='sm'
                            onClick={onDownload}
                            disabled={disableControls}
                            title={t('auth_files.download_button')}
                        >
                            <IconDownload size={14} />
                        </Button>
                    )}
                    {onDelete && (
                        <Button variant='danger' size='sm' onClick={onDelete} disabled={disableControls}
                                title={t('common.delete')}>
                            <IconTrash2 size={14} />
                        </Button>
                    )}
                </div>
            </div>
        </div>
    )
}
