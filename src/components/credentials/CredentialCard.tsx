import {Button} from '@/components/ui/Button'
import {IconDownload, IconPencil, IconRefreshCw, IconTimer, IconTrash2} from '@/components/ui/icons'
import {SelectionCheckbox} from '@/components/ui/SelectionCheckbox'
import {ToggleSwitch} from '@/components/ui/ToggleSwitch'
import {formatDateTime} from '@/utils/format'
import type {StatusBarData, StatusBlockDetail} from '@/utils/usage'
import {rateToColor} from '@/utils/usage'
import type React from 'react'
import {useCallback, useState} from 'react'
import {useTranslation} from 'react-i18next'
import styles from './CredentialCard.module.scss'

export interface QuotaItem {
    /** Model name or bucket label */
    model: string
    /** Usage percentage 0-100 */
    percent: number
    /** Additional quota details, such as remaining credits */
    detail?: string
    /** Human-readable reset label (e.g. "3h" or "2026-03-10 08:00") */
    resetLabel?: string
}

interface RequestStats {
    success: number
    failure: number
}

interface RefreshState {
    lastRefreshTime: Date | null
    nextRefreshTime: Date | null
    isRefreshing: boolean
    autoRefreshEnabled: boolean
    /** Backend scheduler status: idle/loading/success/error/banned/quota_exceeded */
    status?: string
    onRefresh: () => void
    onResetQuota?: () => void
    resetQuotaDisabled?: boolean
    resetQuotaTitle?: string
}

interface CredentialCardProps {
    /** Visual category of the credential */
    category: 'api-key' | 'auth-file'
    /** Primary display text (masked key or file name) */
    title: string
    /** Optional highlighted title (JSX with <mark> tags for search matching) */
    highlightTitle?: React.ReactNode
    /** Current alias for this credential (displayed as subtitle) */
    alias?: string
    /** Callback to set/update alias */
    onAliasChange?: (alias: string) => void
    /** Colored badge (e.g. "API Key", "gemini-cli") */
    badge?: { label: string; color?: string; bgColor?: string; premium?: boolean }
    planComparison?: { configured: string; quota: string; direction: string }
    /** Key-value metadata */
    fields?: { label: string; value: string }[]
    /** Tags (model count, headers, etc.) */
    tags?: string[]
    /** Whether the credential is disabled/inactive */
    disabled?: boolean
    /** Whether this card is selected in batch mode */
    selected?: boolean
    /** Toggle selection callback */
    onSelect?: () => void
    /** Disable all interactive controls */
    disableControls?: boolean
    /** Navigate to edit page */
    onEdit?: () => void
    /** Delete credential */
    onDelete?: () => void
    /** Toggle enabled/disabled state */
    onToggle?: (enabled: boolean) => void
    /** Download credential file */
    onDownload?: () => void
    /** Quota usage data */
    quotaItems?: QuotaItem[]
    /** Quota fetch error message */
    quotaError?: string
    /** Quota is currently loading */
    quotaLoading?: boolean
    /** Request success/failure stats */
    stats?: RequestStats
    /** Status bar block data (24 time-bucketed blocks, 10min each, 4h window) */
    statusBar?: StatusBarData
    /** Refresh scheduling state */
    refreshState?: RefreshState
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

function statusRateClass(rate: number): string {
    if (rate >= 90) {
        return styles.statusRateHigh
    }
    if (rate >= 50) {
        return styles.statusRateMedium
    }
    return styles.statusRateLow
}

const quotaHttpStatusMessages: Record<string, string> = {
    '400': 'credentials.quota_status_http_400',
    '401': 'credentials.quota_status_http_401',
    '402': 'credentials.quota_status_http_402',
    '403': 'credentials.quota_status_http_403',
    '404': 'credentials.quota_status_http_404',
    '409': 'credentials.quota_status_http_409',
    '429': 'credentials.quota_status_http_429',
    '500': 'credentials.quota_status_http_500',
    '502': 'credentials.quota_status_http_502',
    '503': 'credentials.quota_status_http_503',
    '504': 'credentials.quota_status_http_504',
}

function formatQuotaErrorMessage(error: string, t: ReturnType<typeof useTranslation>['t']): string {
    const statusMatch = /\bstatus\s+(?<status>\d{3})\b/i.exec(error)
    if (!statusMatch?.groups) {
        return error
    }
    const status = statusMatch.groups.status
    return t(quotaHttpStatusMessages[status] ?? 'credentials.quota_status_http_default', {
        status,
        defaultValue: error,
    })
}

function refreshStatusLabel(status: string | undefined, t: ReturnType<typeof useTranslation>['t']): string {
    switch (status) {
        case 'loading':
            return t('credentials.refresh_status_loading', { defaultValue: '刷新中' })
        case 'success':
            return t('credentials.refresh_status_success', { defaultValue: '刷新成功' })
        case 'error':
            return t('credentials.refresh_status_error', { defaultValue: '刷新失败' })
        case 'banned':
            return t('credentials.quota_status_banned', { defaultValue: '账号封禁' })
        case 'quota_exceeded':
            return t('credentials.quota_status_exceeded', { defaultValue: '配额耗尽' })
        default:
            return ''
    }
}

export function CredentialCard({
                                   category,
                                   title,
                                   highlightTitle,
                                   alias,
                                   onAliasChange,
                                   badge,
                                   planComparison,
                                   fields,
                                   tags,
                                   disabled,
                                   selected,
                                   onSelect,
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
    const { t, i18n }                     = useTranslation()
    const [editingAlias, setEditingAlias] = useState(false)
    const [aliasInput, setAliasInput]     = useState('')
    const quotaErrorText                  = quotaError ? formatQuotaErrorMessage(quotaError, t) : ''
    const refreshResultLabel              = refreshStatusLabel(refreshState?.status, t)
    const quotaStatusReasonShown          = Boolean(
        quotaErrorText && (refreshState?.status === 'banned' || refreshState?.status === 'quota_exceeded'),
    )
    const showQuotaSection                = category ===
                                            'auth-file' ||
                                            Boolean(quotaLoading || quotaError || quotaItems?.length || refreshState)
    const displayStats                    = statusBar
                                            ? { success: statusBar.totalSuccess, failure: statusBar.totalFailure }
                                            : stats

    const handleAliasEditStart = useCallback(() => {
        setAliasInput(alias || '')
        setEditingAlias(true)
    }, [alias])

    const handleAliasEditConfirm = useCallback(() => {
        const trimmed = aliasInput.trim()
        onAliasChange?.(trimmed)
        setEditingAlias(false)
    }, [aliasInput, onAliasChange])

    const handleAliasKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (e.key === 'Enter') {
                handleAliasEditConfirm()
            } else if (e.key === 'Escape') {
                setEditingAlias(false)
            }
        },
        [handleAliasEditConfirm],
    )

    return (
        <div className={`${styles.card} ${disabled ? styles.disabled : ''} ${selected ? styles.selected : ''}`}>
            {disabled && <div className={styles.disabledBanner}>{t('credentials.filter_disabled')}</div>}
            {/* Header: checkbox + badge + title */}
            <div className={styles.header}>
                {onSelect && <SelectionCheckbox checked={selected ?? false} onChange={onSelect} />}
                {badge && (
                    <span
                        className={`${styles.badge} ${badge.premium ? styles.badgePremium : ''}`}
                        style={{ color: badge.color, backgroundColor: badge.bgColor }}
                    >
                        {badge.label}
                    </span>
                )}
                <span className={styles.title} title={title}>
                    {highlightTitle ?? title}
                </span>
                {onAliasChange &&
                 (editingAlias ? (
                     <span className={styles.aliasEdit}>
                            <input
                                className={styles.aliasInput}
                                value={aliasInput}
                                onChange={(e) => setAliasInput(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ''))}
                                onKeyDown={handleAliasKeyDown}
                                onBlur={handleAliasEditConfirm}
                                placeholder={t('credentials.alias_placeholder', { defaultValue: 'alias' })}
                                maxLength={20}
                                pattern='[a-zA-Z0-9_-]+'
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
                  ))}
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

            {planComparison && (
                <div className={styles.planComparison}>
                    <span className={styles.planComparisonLabel}>
                        {t('credentials.plan_comparison_source', { defaultValue: '套餐来源' })}
                    </span>
                    <span className={styles.planComparisonItem}>
                        <span>{t('credentials.plan_comparison_configured', { defaultValue: '配置' })}</span>
                        <strong>{planComparison.configured}</strong>
                    </span>
                    <span className={styles.planComparisonItem}>
                        <span>{t('credentials.plan_comparison_quota', { defaultValue: '接口' })}</span>
                        <strong>{planComparison.quota}</strong>
                    </span>
                    <span className={`${styles.planComparisonItem} ${styles.planComparisonResult}`}>
                        <span>{t('credentials.plan_comparison_result', { defaultValue: '比较' })}</span>
                        <strong>{planComparison.direction}</strong>
                    </span>
                    <span className={styles.planComparisonHint}>
                        {t('credentials.plan_comparison_hint', { defaultValue: '前端按配置套餐与接口套餐等级比较' })}
                    </span>
                </div>
            )}

            {/* Request statistics: badges + status blocks */}
            {(stats || statusBar) && (
                <div className={styles.statsSection}>
                    <div className={styles.sectionLabel}>
                        {t('credentials.request_stats_section', { defaultValue: '请求统计' })}
                    </div>
                    {/* Badges read from statusBar so the left counts share the same
                     4h rolling window as the right-side success rate %. Previously
                     the left badges were cumulative while the right was windowed,
                     which made operators second-guess which number was current. */}
                    {displayStats && displayStats.success + displayStats.failure > 0 && (
                        <div className={styles.statsBadges}>
                            <span className={styles.statsBadgeSuccess}>
                                {t('common.success')}: {displayStats.success}
                            </span>
                            <span className={styles.statsBadgeFailure}>
                                {t('common.failure')}: {displayStats.failure}
                            </span>
                        </div>
                    )}
                    {statusBar && (
                        <div className={styles.statusBar}>
                            <div className={styles.statusBlocks}>
                                {statusBar.blockDetails.map((detail: StatusBlockDetail, idx: number) => {
                                    const isIdle = detail.rate === -1
                                    // R-485:与 ServiceHealthCard 热力图保持一致的 hover 信息——
                                    // 时段 + 成功/失败计数 + 该格 token 量,无请求时只显示
                                    // 时段,避免 "0/0 100%" 之类视觉噪声
                                    const rangeStr = `${formatDateTime(
                                        new Date(detail.startTime),
                                        i18n.language,
                                    )} – ${formatDateTime(new Date(detail.endTime), i18n.language)}`
                                    const tooltip  = isIdle
                                                     ? `${rangeStr}\n${t('credentials.status_block_idle', {
                                            defaultValue: 'No requests',
                                        })}`
                                                     : `${rangeStr}\n${t('common.success')}: ${detail.success}  ${t(
                                            'common.failure',
                                        )}: ${detail.failure}\n${t('credentials.status_block_tokens', {
                                            defaultValue: 'Tokens',
                                        })}: ${detail.totalTokens}`
                                    return (
                                        <div key={idx} className={styles.statusBlockWrapper} title={tooltip}>
                                            <div
                                                className={`${styles.statusBlock} ${
                                                    isIdle ? styles.statusBlockIdle : ''
                                                }`}
                                                style={
                                                    isIdle ? undefined : { backgroundColor: rateToColor(detail.rate) }
                                                }
                                            />
                                        </div>
                                    )
                                })}
                            </div>
                            <span className={`${styles.statusRate} ${statusRateClass(statusBar.successRate)}`}>
                                {statusBar.totalSuccess > 0 || statusBar.totalFailure > 0
                                 ? `${statusBar.successRate.toFixed(1)}%`
                                 : '--'}
                            </span>
                        </div>
                    )}
                </div>
            )}

            {/* Quota section */}
            {showQuotaSection && (
                <div className={styles.quotaSection}>
                    <div className={styles.quotaHeader}>
                        <span className={styles.sectionLabel}>
                            {t('credentials.quota_section_title', { defaultValue: '配额信息' })}
                        </span>
                    </div>
                    {/* Status warnings from backend scheduler */}
                    {refreshState?.status === 'banned' && (
                        <div className={styles.quotaStatusBanned}>
                            <span className={styles.quotaStatusTitle}>
                                {t('credentials.quota_status_banned', { defaultValue: 'Account banned' })}
                            </span>
                            <span className={styles.quotaStatusReason}>
                                {quotaErrorText ||
                                 t('credentials.quota_status_banned_reason', {
                                     defaultValue: 'Backend reported this account as unavailable for quota refresh',
                                 })}
                            </span>
                        </div>
                    )}
                    {refreshState?.status === 'quota_exceeded' && (
                        <div className={styles.quotaStatusExceeded}>
                            <span className={styles.quotaStatusTitle}>
                                {t('credentials.quota_status_exceeded', { defaultValue: 'Quota exceeded' })}
                            </span>
                            <span className={styles.quotaStatusReason}>
                                {quotaErrorText ||
                                 t('credentials.quota_status_exceeded_reason', {
                                     defaultValue: 'Backend reported HTTP 402 or an equivalent quota exhaustion signal',
                                 })}
                            </span>
                        </div>
                    )}
                    {refreshState?.status === 'error' && !quotaError && (
                        <div className={styles.quotaStatusError}>
                            {t('credentials.quota_status_error', { defaultValue: 'Refresh failed' })}
                        </div>
                    )}
                    {/* Quota data */}
                    {quotaLoading ? (
                        <div className={styles.quotaLoading}>{t('common.loading')}</div>
                    ) : quotaError && !quotaStatusReasonShown ? (
                        <div className={styles.quotaError} title={quotaErrorText}>
                            {quotaErrorText}
                        </div>
                    ) : quotaItems && quotaItems.length > 0 ? (
                        quotaItems.map((item) => (
                            <div key={item.model} className={styles.quotaRow}>
                                <div className={styles.quotaRowHeader}>
                                    <span className={styles.quotaModel}>
                                        <span>{item.model}</span>
                                        {item.detail && <span className={styles.quotaDetail}>{item.detail}</span>}
                                    </span>
                                    <span className={styles.quotaMeta}>
                                        <span className={styles.quotaPercent}>
                                            {t('credentials.quota_remaining_value', {
                                                percent: Math.round(item.percent),
                                                defaultValue: '{{percent}}% remaining',
                                            })}
                                        </span>
                                        <span className={styles.quotaReset}>
                                            {item.resetLabel
                                             ? t('credentials.quota_reset_value', {
                                                    value: item.resetLabel,
                                                    defaultValue: 'Renewal time {{value}}',
                                                })
                                             : t('credentials.quota_reset_unknown', { defaultValue: 'Renewal time -' })}
                                        </span>
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
                    ) : refreshState && !refreshState.lastRefreshTime ? (
                        <div className={styles.quotaLoading}>
                            {t('credentials.quota_click_refresh_detail', { defaultValue: '点击刷新按钮获取配额信息' })}
                        </div>
                    ) : quotaItems && quotaItems.length === 0 ? (
                        <div className={styles.quotaLoading}>
                            {t('credentials.quota_empty', { defaultValue: 'No quota data returned' })}
                        </div>
                    ) : (
                            <div className={styles.quotaLoading}>{t('credentials.quota_pending')}</div>
                        )}
                </div>
            )}

            {refreshState && (
                <div className={styles.refreshSection}>
                    <div className={styles.refreshMetaGroup}>
                        <span className={styles.refreshMetaLine}>
                            {refreshState.lastRefreshTime ? (
                                <span className={styles.refreshMetaItem}>
                                    <span className={styles.refreshMetaLabel}>
                                        {t('credentials.last_refresh_at', { defaultValue: 'Last refresh' })}
                                    </span>
                                    <span className={styles.refreshTime}>
                                        {formatDateTime(refreshState.lastRefreshTime, i18n.language)}
                                    </span>
                                </span>
                            ) : null}
                            {refreshResultLabel ? (
                                <span className={styles.refreshResult}>{refreshResultLabel}</span>
                            ) : null}
                        </span>
                        <span className={styles.refreshMetaLine}>
                            {refreshState.isRefreshing ? (
                                <span className={`${styles.refreshMetaItem} ${styles.refreshingHint}`}>
                                    {t('credentials.refreshing', { defaultValue: 'Refreshing...' })}
                                </span>
                            ) : !refreshState.autoRefreshEnabled ? (
                                <span className={`${styles.refreshMetaItem} ${styles.refreshHint}`}>
                                    {t('credentials.auto_refresh_off', { defaultValue: 'Auto-refresh off' })}
                                </span>
                            ) : refreshState.nextRefreshTime ? (
                                <span className={styles.refreshMetaItem}>
                                    <span className={styles.refreshMetaLabel}>
                                        {t('credentials.next_refresh_at', { defaultValue: 'Next refresh' })}
                                    </span>
                                    <span className={styles.refreshNext}>
                                        {formatDateTime(refreshState.nextRefreshTime, i18n.language)}
                                    </span>
                                </span>
                            ) : null}
                        </span>
                    </div>
                </div>
            )}

            {/* Actions: toggle + buttons (edit, download, refresh, delete) */}
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
                        <Button
                            variant='secondary'
                            size='sm'
                            onClick={onEdit}
                            disabled={disableControls}
                            title={t('common.edit')}
                        >
                            <IconPencil size={14} />
                        </Button>
                    )}
                    {refreshState && (
                        <Button
                            variant='secondary'
                            size='sm'
                            onClick={refreshState.onRefresh}
                            disabled={refreshState.isRefreshing}
                            title={
                                refreshState.isRefreshing
                                ? t('credentials.refreshing', { defaultValue: 'Refreshing...' })
                                : t('common.refresh')
                            }
                            className={refreshState.isRefreshing ? styles.spinning : ''}
                        >
                            <IconRefreshCw size={14} />
                            {refreshState.isRefreshing && (
                                <span className={styles.refreshButtonLabel}>
                                    {t('credentials.refreshing', { defaultValue: 'Refreshing...' })}
                                </span>
                            )}
                        </Button>
                    )}
                    {refreshState?.onResetQuota && (
                        <Button
                            variant='secondary'
                            size='sm'
                            onClick={refreshState.onResetQuota}
                            disabled={refreshState.isRefreshing || refreshState.resetQuotaDisabled}
                            title={refreshState.resetQuotaTitle ?? t('credentials.quota_reset_manual_hint', {
                                defaultValue: 'Clear backend quota and cooldown state for this credential',
                            })}
                        >
                            <IconTimer size={14} />
                        </Button>
                    )}
                    {onDownload && (
                        <Button
                            variant='secondary'
                            size='sm'
                            onClick={onDownload}
                            title={t('auth_files.download_button')}
                        >
                            <IconDownload size={14} />
                        </Button>
                    )}
                    {onDelete && (
                        <Button variant='danger' size='sm' onClick={onDelete} title={t('common.delete')}>
                            <IconTrash2 size={14} />
                        </Button>
                    )}
                </div>
            </div>
        </div>
    )
}
