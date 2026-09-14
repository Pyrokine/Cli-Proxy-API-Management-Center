import {Button} from '@/components/ui/Button'
import {IconDownload, IconPencil, IconRefreshCw, IconTimer, IconTrash2} from '@/components/ui/icons'
import {SelectionCheckbox} from '@/components/ui/SelectionCheckbox'
import {ToggleSwitch} from '@/components/ui/ToggleSwitch'
import type {QuotaFreshness} from '@/types'
import {formatDateTime} from '@/utils/format'
import type {ParsedProviderError} from '@/utils/providerError'
import {getNextAntigravityCountdownUpdateDelay, resolveAntigravityNowMs} from '@/utils/quota/antigravityCountdown'
import {projectQuotaProgress} from '@/utils/quota/projection'
import {buildResetDisplay} from '@/utils/quota/relativeTime'
import {pickUrgentRecoveryRowId} from '@/utils/quota/resetSchedule'
import {MINUTE_CLOCK} from '@/utils/time/sharedClock'
import type {StatusBarData, StatusBlockDetail} from '@/utils/usage'
import {rateToColor} from '@/utils/usage'
import type React from 'react'
import {useCallback, useEffect, useMemo, useState, useSyncExternalStore} from 'react'
import {useTranslation} from 'react-i18next'
import styles from './CredentialCard.module.scss'

export interface QuotaItem {
    /** Stable row identity from the provider payload */
    id: string
    /** Model name or bucket label */
    model: string
    /** Usage percentage 0-100 */
    percent: number
    /** Additional quota details, such as remaining credits */
    detail?: string
    /** Human-readable absolute reset label */
    resetLabel?: string
    /** Absolute reset instant used for live relative time */
    resetAtMs?: number | null
    /** Provider window length, preserved for quota timeline consumers */
    periodHours?: number | null
    /** Antigravity countdowns update on their exact rounded-minute boundary */
    liveCountdown?: boolean
    /** Provider clock offset captured by the backend quota fetch */
    serverTimeOffsetMs?: number | null
}

interface RequestStats {
    success: number
    failure: number
}

export interface CredentialRuntimeState {
    status: 'normal' | 'unavailable' | 'unknown' | 'disabled'
    reason?: string
    checkedAt?: string
    nextRetryAfter?: string
    message?: string
    warning?: string
    providerError?: ParsedProviderError
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

export interface CredentialField {
    id: string
    label: string
    value: string
    wrap?: boolean
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
    fields?: CredentialField[]
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
    /** Stable target for focus restoration after route-backed editing */
    editButtonId?: string
    /** Delete credential */
    onDelete?: () => void
    /** Toggle enabled/disabled state */
    onToggle?: (enabled: boolean) => void
    /** Download credential file */
    onDownload?: () => void
    /** Last known runtime health from account inspection */
    runtimeState?: CredentialRuntimeState
    /** Quota capability for credentials without a queryable quota endpoint */
    quotaCapability?: 'unsupported'
    /** Quota usage data */
    quotaItems?: QuotaItem[]
    /** Quota fetch error message */
    quotaError?: string
    /** Quota is currently loading */
    quotaLoading?: boolean
    /** Freshness of the last accepted backend quota snapshot */
    quotaFreshness?: QuotaFreshness
    /** Runtime evidence is newer than the displayed quota snapshot */
    quotaObservationWarning?: string
    /** Backend confirmed that the current quota result is empty */
    quotaSuccessfulEmpty?: boolean
    /** Request success/failure stats */
    stats?: RequestStats
    /** Request insight load error */
    statsError?: string
    /** Time-bucketed request status blocks */
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
    if (rate < 0) {
        return styles.statusRateIdle
    }
    if (rate >= 90) {
        return styles.statusRateHigh
    }
    if (rate >= 50) {
        return styles.statusRateMedium
    }
    return styles.statusRateLow
}

function runtimeStatusClass(status: CredentialRuntimeState['status']): string {
    switch (status) {
        case 'normal':
            return styles.runtimeStatusNormal
        case 'unavailable':
            return styles.runtimeStatusUnavailable
        case 'disabled':
            return styles.runtimeStatusDisabled
        default:
            return styles.runtimeStatusUnknown
    }
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

function providerErrorScopeLabel(
    scope: string,
    t: ReturnType<typeof useTranslation>['t'],
): string {
    switch (scope) {
        case 'exact_model':
            return t('credentials.provider_error_scope_exact_model', { defaultValue: 'Exact model' })
        case 'quota_family':
            return t('credentials.provider_error_scope_quota_family', { defaultValue: 'Quota family' })
        case 'credential':
            return t('credentials.provider_error_scope_credential', { defaultValue: 'Credential' })
        case 'group':
            return t('credentials.provider_error_scope_group', { defaultValue: 'Credential group' })
        case 'provider':
            return t('credentials.provider_error_scope_provider', { defaultValue: 'Provider' })
        case 'request':
            return t('credentials.provider_error_scope_request', { defaultValue: 'Request' })
        default:
            return scope
    }
}

function quotaFreshnessLabel(
    freshness: QuotaFreshness | undefined,
    t: ReturnType<typeof useTranslation>['t'],
): string {
    switch (freshness) {
        case 'stale':
            return t('credentials.quota_freshness_stale', { defaultValue: '正在显示上次成功获取的配额' })
        case 'partial':
            return t('credentials.quota_freshness_partial', { defaultValue: '配额数据不完整，正在显示已获取的数据' })
        case 'outdated':
            return t('credentials.quota_freshness_outdated', { defaultValue: '当前配额数据已失效' })
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
                                   editButtonId,
                                   onDelete,
                                   onToggle,
                                   onDownload,
                                   runtimeState,
                                   quotaCapability,
                                   quotaItems,
                                   quotaError,
                                   quotaLoading,
                                   quotaFreshness,
                                   quotaObservationWarning,
                                   quotaSuccessfulEmpty,
                                   stats,
                                   statsError,
                                   statusBar,
                                   refreshState,
                               }: CredentialCardProps) {
    const { t, i18n }                     = useTranslation()
    const [editingAlias, setEditingAlias] = useState(false)
    const [aliasInput, setAliasInput]     = useState('')
    const quotaErrorText                  = quotaError ? formatQuotaErrorMessage(quotaError, t) : ''
    const freshnessLabel                  = quotaFreshnessLabel(quotaFreshness, t)
    const refreshResultLabel              = refreshStatusLabel(refreshState?.status, t)
    const hasQuotaItems                   = Boolean(quotaItems?.length)
    const quotaStatusReasonShown          = Boolean(
        quotaErrorText && (refreshState?.status === 'banned' || refreshState?.status === 'quota_exceeded'),
    )
    const showFreshnessNotice             = Boolean(
        (freshnessLabel || quotaObservationWarning) && !quotaStatusReasonShown,
    )
    const showQuotaSection                = quotaCapability ===
                                            'unsupported' ||
                                            category ===
                                            'auth-file' ||
                                            Boolean(
                                            quotaLoading ||
                                            quotaError ||
                                            quotaItems?.length ||
                                            quotaFreshness ||
                                            quotaObservationWarning ||
                                            quotaSuccessfulEmpty ||
                                            refreshState,
                                            )
    const displayStats                    = statusBar
                                            ? { success: statusBar.totalSuccess, failure: statusBar.totalFailure }
                                            : stats
    const sharedNowMs                     = useSyncExternalStore(
        MINUTE_CLOCK.subscribe,
        MINUTE_CLOCK.getSnapshot,
        MINUTE_CLOCK.getSnapshot,
    )
    const providerError                   = runtimeState?.providerError
    const providerResetAtMs               = providerError?.resetAt ? Date.parse(providerError.resetAt) : Number.NaN
    const providerResetDisplay            = buildResetDisplay(
        undefined,
        Number.isFinite(providerResetAtMs) ? providerResetAtMs : null,
        sharedNowMs,
        i18n.resolvedLanguage,
    )
    const retryAtMs                       = runtimeState?.nextRetryAfter ?
                                            Date.parse(runtimeState.nextRetryAfter) :
                                            Number.NaN
    const retryDue                        = Number.isFinite(retryAtMs) && retryAtMs <= sharedNowMs
    const liveResetTimestamps             = useMemo(
        () =>
            (quotaItems ?? [])
                .filter((item) => item.liveCountdown && Number.isFinite(item.resetAtMs))
                .map((item) => item.resetAtMs as number),
        [quotaItems],
    )
    const liveServerTimeOffsetMs          = useMemo(
        () =>
            (quotaItems ?? []).find(
                (item) => item.liveCountdown && Number.isFinite(item.serverTimeOffsetMs),
            )?.serverTimeOffsetMs ?? 0,
        [quotaItems],
    )
    const [liveNowMs, setLiveNowMs]       = useState(() =>
                                                         resolveAntigravityNowMs(Date.now(), liveServerTimeOffsetMs),
    )

    useEffect(() => {
        if (liveResetTimestamps.length === 0) {
            return
        }
        let timeoutId: ReturnType<typeof setTimeout> | null = null
        const updateCountdown                               = () => {
            const nowMs = resolveAntigravityNowMs(Date.now(), liveServerTimeOffsetMs)
            setLiveNowMs(nowMs)
            const delay = getNextAntigravityCountdownUpdateDelay(liveResetTimestamps, nowMs)
            if (delay !== null) {
                timeoutId = setTimeout(updateCountdown, delay)
            }
        }
        updateCountdown()
        return () => {
            if (timeoutId !== null) {
                clearTimeout(timeoutId)
            }
        }
    }, [liveResetTimestamps, liveServerTimeOffsetMs])

    const quotaNowMs  = liveResetTimestamps.length > 0 ? liveNowMs : sharedNowMs
    const urgentRowId = useMemo(
        () =>
            pickUrgentRecoveryRowId(
                (quotaItems ?? []).flatMap((item) =>
                                               typeof item.resetAtMs === 'number' && Number.isFinite(item.resetAtMs) ?
                                                   [{ rowId: item.id, atMs: item.resetAtMs }] :
                                                   [],
                ),
                quotaNowMs,
            ),
        [quotaItems, quotaNowMs],
    )

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
                        <div
                            key={field.id}
                            className={`${styles.field} ${field.wrap ? styles.fieldWrap : ''}`}
                            data-field-id={field.id}
                        >
                            <span className={styles.fieldLabel}>{field.label}</span>
                            <span
                                className={`${styles.fieldValue} ${field.wrap ? styles.fieldValueWrap : ''}`}
                                title={field.value}
                            >
                                {field.value}
                            </span>
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

            {runtimeState && (
                <div className={styles.runtimeSection}>
                    <div className={styles.runtimeHeader}>
                        <span className={styles.sectionLabel}>
                            {t('credentials.inspection_runtime_status', { defaultValue: '运行状态' })}
                        </span>
                        <span className={`${styles.runtimeStatus} ${runtimeStatusClass(runtimeState.status)}`}>
                            {t(`credentials.inspection_status_${runtimeState.status}`, {
                                defaultValue: runtimeState.status,
                            })}
                        </span>
                    </div>
                    {(runtimeState.reason || runtimeState.checkedAt || runtimeState.nextRetryAfter || providerError) &&
                     (
                         <div className={styles.runtimeDetails}>
                             {runtimeState.reason && (
                                 <span>
                                    {t(`credentials.inspection_reason_${runtimeState.reason}`, {
                                        defaultValue: runtimeState.reason,
                                    })}
                                </span>
                             )}
                             {providerError?.type && (
                                 <span>
                                    {t('credentials.provider_error_type', { defaultValue: 'Type' })}{' '}
                                     {providerError.type}
                                </span>
                             )}
                             {providerError?.code && providerError.code !== providerError.type && (
                                 <span>
                                    {t('credentials.provider_error_code', { defaultValue: 'Code' })}{' '}
                                     {providerError.code}
                                </span>
                             )}
                             {providerError?.httpStatus && (
                                 <span>
                                    {t('credentials.provider_error_http_status', { defaultValue: 'HTTP status' })}{' '}
                                     {providerError.httpStatus}
                                </span>
                             )}
                             {providerError?.model && (
                                 <span>
                                    {t('credentials.provider_error_model', { defaultValue: 'Model' })}{' '}
                                     {providerError.model}
                                </span>
                             )}
                             {providerError?.effectScope && (
                                 <span>
                                    {t('credentials.provider_error_scope', { defaultValue: 'Scope' })}{' '}
                                     {providerErrorScopeLabel(providerError.effectScope, t)}
                                </span>
                             )}
                             {providerError?.effectKey && providerError.effectKey !== providerError.model && (
                                 <span>
                                    {t('credentials.provider_error_effect_key', { defaultValue: 'Affected key' })}{' '}
                                     {providerError.effectKey}
                                </span>
                             )}
                             {providerError?.planType && (
                                 <span>
                                    {t('credentials.provider_error_plan', { defaultValue: 'Plan' })}{' '}
                                     {providerError.planType}
                                </span>
                             )}
                             {providerError?.stateGeneration !== undefined && (
                                 <span>
                                    {t(
                                        'credentials.provider_error_state_generation',
                                        { defaultValue: 'State version' },
                                    )}{' '}
                                     {providerError.stateGeneration}
                                </span>
                             )}
                             {runtimeState.checkedAt && (
                                 <time dateTime={runtimeState.checkedAt}>
                                     {t('credentials.inspection_checked_at', { defaultValue: '检查时间' })}{' '}
                                     {formatDateTime(runtimeState.checkedAt, i18n.language)}
                                 </time>
                             )}
                             {runtimeState.nextRetryAfter && (
                                 <time dateTime={runtimeState.nextRetryAfter}>
                                     {t('credentials.provider_health_next_retry', {
                                         defaultValue: '下次恢复/轮询',
                                     })}{' '}
                                     {retryDue ?
                                      t('credentials.provider_error_retry_due', { defaultValue: 'Awaiting recheck' }) :
                                      formatDateTime(runtimeState.nextRetryAfter, i18n.language)}
                                 </time>
                             )}
                             {providerResetDisplay && (
                                 <span>
                                    {t('credentials.provider_error_reset_at', { defaultValue: 'Provider reset' })}{' '}
                                     {providerResetDisplay.absolute}
                                     {providerResetDisplay.relative ? ` · ${providerResetDisplay.relative}` : ''}
                                </span>
                             )}
                             {!providerResetDisplay && providerError?.resetsInSeconds !== undefined && (
                                 <span>
                                    {t('credentials.provider_error_reset_remaining', {
                                        seconds: providerError.resetsInSeconds,
                                        defaultValue: 'Provider reported {{seconds}} seconds remaining',
                                    })}
                                </span>
                             )}
                         </div>
                     )}
                    {runtimeState.message && <div className={styles.runtimeMessage}>{runtimeState.message}</div>}
                    {providerError?.rawDetails && (
                        <details className={styles.runtimeRawDetails}>
                            <summary>
                                {t(
                                    'credentials.provider_error_raw_details',
                                    { defaultValue: 'Original error details' },
                                )}
                            </summary>
                            <pre>{providerError.rawDetails}</pre>
                        </details>
                    )}
                    {runtimeState.warning && (
                        <div className={styles.runtimeWarning} role='status'>
                            {runtimeState.warning}
                        </div>
                    )}
                </div>
            )}

            {/* Request statistics: badges + status blocks */}
            {(stats || statusBar || statsError) && (
                <div className={styles.statsSection}>
                    <div className={styles.sectionLabel}>
                        {t('credentials.request_stats_section', { defaultValue: '请求统计' })}
                    </div>
                    {statsError && <div className={styles.statsError} role='status'>{statsError}</div>}
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
                    {quotaCapability === 'unsupported' ? (
                        <div className={styles.quotaUnsupported}>
                            {t('credentials.quota_not_supported', {
                                defaultValue: '该凭证类型没有可查询的配额接口',
                            })}
                        </div>
                    ) : (
                         <>
                             {refreshState?.status === 'banned' && (
                                 <div className={styles.quotaStatusBanned}>
                                    <span className={styles.quotaStatusTitle}>
                                        {t('credentials.quota_status_banned', { defaultValue: 'Account banned' })}
                                    </span>
                                     <span className={styles.quotaStatusReason}>
                                        {quotaErrorText ||
                                         t('credentials.quota_status_banned_reason', {
                                             defaultValue:
                                                 'Backend reported this account as unavailable ' +
                                                 'for quota refresh',
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
                                             defaultValue:
                                                 'Backend reported HTTP 402 or an equivalent ' +
                                                 'quota exhaustion signal',
                                         })}
                                    </span>
                                 </div>
                             )}
                             {refreshState?.status === 'error' && !quotaError && (
                                 <div className={styles.quotaStatusError}>
                                     {t('credentials.quota_status_error', { defaultValue: 'Refresh failed' })}
                                 </div>
                             )}
                             {showFreshnessNotice && (
                                 <div
                                     className={`${styles.quotaFreshnessNotice} ${
                                         quotaFreshness === 'outdated' ? styles.quotaFreshnessOutdated : ''
                                     }`}
                                     role='status'
                                 >
                                    <span className={styles.quotaFreshnessTitle}>
                                        {quotaObservationWarning || freshnessLabel}
                                    </span>
                                     {quotaObservationWarning && freshnessLabel && (
                                         <span className={styles.quotaFreshnessDetail}>{freshnessLabel}</span>
                                     )}
                                     {quotaErrorText &&
                                      <span className={styles.quotaFreshnessDetail}>{quotaErrorText}</span>}
                                 </div>
                             )}
                             {quotaLoading && (
                                 <div className={styles.quotaLoading} role='status'>
                                     {hasQuotaItems || quotaSuccessfulEmpty ?
                                      t('credentials.quota_updating_cached', {
                                          defaultValue: '正在刷新，暂时显示上次结果',
                                      }) :
                                      t('common.loading')}
                                 </div>
                             )}
                             {quotaError && !quotaStatusReasonShown && !showFreshnessNotice && (
                                 <div className={styles.quotaError} title={quotaErrorText}>
                                     {quotaErrorText}
                                 </div>
                             )}
                             {hasQuotaItems ? (
                                 quotaItems?.map((item) => {
                                     const resetDisplay      = buildResetDisplay(
                                         item.resetLabel,
                                         item.resetAtMs,
                                         quotaNowMs,
                                         i18n.resolvedLanguage,
                                     )
                                     const projectedProgress = projectQuotaProgress(
                                         item.percent,
                                         item.resetAtMs,
                                         quotaNowMs,
                                     )
                                     const displayPercent    = projectedProgress.percent
                                     const urgent            = item.id === urgentRowId
                                     return (
                                         <div
                                             key={item.id}
                                             className={styles.quotaRow}
                                             title={
                                                 urgent ?
                                                 t('credentials.quota_soonest_recovery_hint', {
                                                     defaultValue: 'This limit recovers first within the next hour',
                                                 }) :
                                                 undefined
                                             }
                                         >
                                             <div className={styles.quotaRowHeader}>
                                                <span className={styles.quotaModel}>
                                                    <span>{item.model}</span>
                                                    {item.detail && (
                                                        <span className={styles.quotaDetail}>{item.detail}</span>
                                                    )}
                                                </span>
                                                 <span className={styles.quotaMeta}>
                                                    {displayPercent !== null && (
                                                        <span className={styles.quotaPercent}>
                                                            {t('credentials.quota_remaining_value', {
                                                                percent: Math.round(displayPercent),
                                                                defaultValue: '{{percent}}% remaining',
                                                            })}
                                                        </span>
                                                    )}
                                                     {resetDisplay ? (
                                                         <span className={styles.quotaReset}>
                                                            <span>
                                                                {t('credentials.quota_reset_value', {
                                                                    value: resetDisplay.absolute,
                                                                    defaultValue: 'Renewal time {{value}}',
                                                                })}
                                                            </span>
                                                             {resetDisplay.relative && (
                                                                 <span
                                                                     className={
                                                                         urgent ?
                                                                         styles.quotaResetRelativeSoon :
                                                                         styles.quotaResetRelative
                                                                     }
                                                                 >
                                                                    {resetDisplay.relative}
                                                                </span>
                                                             )}
                                                             {urgent && (
                                                                 <span className={styles.quotaUrgentMarker}>
                                                                    {t('credentials.quota_soonest_recovery', {
                                                                        defaultValue: 'Soonest recovery',
                                                                    })}
                                                                </span>
                                                             )}
                                                        </span>
                                                     ) : (
                                                          <span className={styles.quotaReset}>
                                                            {t('credentials.quota_reset_unknown', {
                                                                defaultValue: 'Renewal time -',
                                                            })}
                                                        </span>
                                                      )}
                                                </span>
                                             </div>
                                             {displayPercent !== null && (
                                                 <div className={styles.quotaBar}>
                                                     <div
                                                         className={
                                                             `${styles.quotaBarFill} ` +
                                                             quotaBarClass(displayPercent)
                                                         }
                                                         style={{ width: `${Math.min(displayPercent, 100)}%` }}
                                                     />
                                                 </div>
                                             )}
                                         </div>
                                     )
                                 })
                             ) : quotaSuccessfulEmpty ? (
                                 <div className={styles.quotaEmpty} role='status'>
                                     {t('credentials.quota_successful_empty', {
                                         defaultValue: '上游已确认当前没有配额数据',
                                     })}
                                 </div>
                             ) : quotaLoading || showFreshnessNotice || (quotaError && !quotaStatusReasonShown) ? null :
                                 refreshState && !refreshState.lastRefreshTime ? (
                                     <div className={styles.quotaLoading}>
                                         {t(
                                             'credentials.quota_click_refresh_detail',
                                             { defaultValue: '点击刷新按钮获取配额信息' },
                                         )}
                                     </div>
                                 ) : quotaItems && quotaItems.length === 0 ? (
                                     <div className={styles.quotaLoading}>
                                         {t('credentials.quota_empty', { defaultValue: 'No quota data returned' })}
                                     </div>
                                 ) : (
                                         <div className={styles.quotaLoading}>{t('credentials.quota_pending')}</div>
                                     )}
                         </>
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
                            id={editButtonId}
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
                            disabled={disableControls || refreshState.isRefreshing}
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
                            disabled={disableControls || refreshState.isRefreshing || refreshState.resetQuotaDisabled}
                            title={refreshState.resetQuotaTitle ?? t('auth_files.quota_reset_manual_hint', {
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
                            disabled={disableControls}
                            title={t('auth_files.download_button')}
                        >
                            <IconDownload size={14} />
                        </Button>
                    )}
                    {onDelete && (
                        <Button
                            variant='danger'
                            size='sm'
                            onClick={onDelete}
                            disabled={disableControls}
                            title={t('common.delete')}
                        >
                            <IconTrash2 size={14} />
                        </Button>
                    )}
                </div>
            </div>
        </div>
    )
}
