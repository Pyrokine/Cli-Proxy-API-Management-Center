import {IconDiamond, IconDollarSign, IconSatellite, IconTimer, IconTrendingUp} from '@/components/ui/icons'
import styles from '@/pages/UsagePage.module.scss'
import type {UsageSummary} from '@/services/api/usage'
import {
    collectUsageDetails,
    extractTotalTokens,
    formatCompactNumber,
    formatPerMinuteValue,
    formatUsd,
} from '@/utils/usage'
import {sparklineOptions} from '@/utils/usage/chartConfig'
import {type CSSProperties, type ReactNode, useMemo} from 'react'
import {Line} from 'react-chartjs-2'
import {useTranslation} from 'react-i18next'
import type {SparklineBundle} from './hooks/useSparklines'
import type {UsagePayload} from './hooks/useUsageData'

interface StatCardData {
    key: string;
    label: string;
    icon: ReactNode;
    accent: string;
    accentSoft: string;
    accentBorder: string;
    value: string;
    meta?: ReactNode;
    trend: SparklineBundle | null;
}

interface StatCardsProps {
    usage: UsagePayload | null;
    loading: boolean;
    nowMs: number;
    sparklines: {
        requests: SparklineBundle | null;
        tokens: SparklineBundle | null;
        rpm: SparklineBundle | null;
        tpm: SparklineBundle | null;
        cost: SparklineBundle | null;
    };
    summary?: UsageSummary | null;
}

export function StatCards({ usage, loading, nowMs, sparklines, summary }: StatCardsProps) {
    const { t } = useTranslation()

    const hasCostData = useMemo(() => {
        return !!summary?.time_series?.some(p => p.has_cost)
    }, [summary])

    const { tokenBreakdown, rateStats, totalCost } = useMemo(() => {
        const empty = {
            tokenBreakdown: { cachedTokens: 0, reasoningTokens: 0 },
            rateStats: { rpm: 0, tpm: 0, windowMinutes: 30, requestCount: 0, tokenCount: 0 },
            totalCost: 0,
        }

        if (!usage) {
            return empty
        }

        // When summary is available, use pre-aggregated data for tokens/cost
        // and only compute RPM/TPM from raw details (30-min rolling window).
        if (summary) {
            const details       = collectUsageDetails(usage)
            const now           = nowMs
            const windowMinutes = 30
            const windowStart   = now - windowMinutes * 60 * 1000
            let requestCount    = 0
            let tokenCount      = 0
            const hasValidNow   = Number.isFinite(now) && now > 0

            details.forEach((detail) => {
                const timestamp = detail.__timestampMs ?? 0
                if (hasValidNow && Number.isFinite(timestamp) && timestamp >= windowStart && timestamp <= now) {
                    requestCount += 1
                    tokenCount += extractTotalTokens(detail)
                }
            })

            const denominator = windowMinutes > 0 ? windowMinutes : 1
            return {
                tokenBreakdown: {
                    cachedTokens: summary.totals.tokens.cached,
                    reasoningTokens: summary.totals.tokens.reasoning,
                },
                rateStats: {
                    rpm: requestCount / denominator,
                    tpm: tokenCount / denominator,
                    windowMinutes,
                    requestCount,
                    tokenCount,
                },
                totalCost: summary.totals.cost,
            }
        }

        const details = collectUsageDetails(usage)
        if (!details.length) {
            return empty
        }

        let cachedTokens    = 0
        let reasoningTokens = 0

        const now           = nowMs
        const windowMinutes = 30
        const windowStart   = now - windowMinutes * 60 * 1000
        let requestCount    = 0
        let tokenCount      = 0
        const hasValidNow   = Number.isFinite(now) && now > 0

        details.forEach((detail) => {
            const tokens = detail.tokens
            cachedTokens += Math.max(
                Math.max(tokens.cached_tokens, 0),
                typeof tokens.cache_tokens === 'number' ? Math.max(tokens.cache_tokens, 0) : 0,
            )
            reasoningTokens += tokens.reasoning_tokens

            const timestamp = detail.__timestampMs ?? 0
            if (hasValidNow && Number.isFinite(timestamp) && timestamp >= windowStart && timestamp <= now) {
                requestCount += 1
                tokenCount += extractTotalTokens(detail)
            }
        })

        const denominator = windowMinutes > 0 ? windowMinutes : 1
        return {
            tokenBreakdown: { cachedTokens, reasoningTokens },
            rateStats: {
                rpm: requestCount / denominator,
                tpm: tokenCount / denominator,
                windowMinutes,
                requestCount,
                tokenCount,
            },
            totalCost: 0,
        }
    }, [nowMs, summary, usage])

    const statsCards: StatCardData[] = [
        {
            key: 'requests',
            label: t('usage_stats.total_requests'),
            icon: <IconSatellite size={16} />,
            accent: 'var(--stat-requests-accent)',
            accentSoft: 'color-mix(in srgb, var(--stat-requests-accent) 18%, transparent)',
            accentBorder: 'color-mix(in srgb, var(--stat-requests-accent) 35%, transparent)',
            value: loading ? '-' : (summary?.totals.requests ?? usage?.total_requests ?? 0).toLocaleString(),
            meta: (
                <>
          <span className={styles.statMetaItem}>
            <span className={styles.statMetaDot} style={{ backgroundColor: 'var(--success-color)' }} />
              {t('usage_stats.success_requests')}:{' '}
              {loading ? '-' : (summary?.totals.success ?? usage?.success_count ?? 0)}
          </span>
                    <span className={styles.statMetaItem}>
            <span className={styles.statMetaDot} style={{ backgroundColor: 'var(--error-color)' }} />
                        {t('usage_stats.failed_requests')}: {loading ?
                                                             '-' :
                                                             (summary?.totals.failure ?? usage?.failure_count ?? 0)}
          </span>
                </>
            ),
            trend: sparklines.requests,
        },
        {
            key: 'tokens',
            label: t('usage_stats.total_tokens'),
            icon: <IconDiamond size={16} />,
            accent: 'var(--stat-tokens-accent)',
            accentSoft: 'color-mix(in srgb, var(--stat-tokens-accent) 18%, transparent)',
            accentBorder: 'color-mix(in srgb, var(--stat-tokens-accent) 35%, transparent)',
            value: loading ? '-' : formatCompactNumber(summary?.totals.tokens.total ?? usage?.total_tokens ?? 0),
            meta: (
                <>
          <span className={styles.statMetaItem}>
            {t('usage_stats.cached_tokens')}: {loading ? '-' : formatCompactNumber(tokenBreakdown.cachedTokens)}
          </span>
                    <span className={styles.statMetaItem}>
            {t('usage_stats.reasoning_tokens')}: {loading ? '-' : formatCompactNumber(tokenBreakdown.reasoningTokens)}
          </span>
                </>
            ),
            trend: sparklines.tokens,
        },
        {
            key: 'rpm',
            label: t('usage_stats.rpm_30m'),
            icon: <IconTimer size={16} />,
            accent: 'var(--stat-rpm-accent)',
            accentSoft: 'color-mix(in srgb, var(--stat-rpm-accent) 18%, transparent)',
            accentBorder: 'color-mix(in srgb, var(--stat-rpm-accent) 32%, transparent)',
            value: loading ? '-' : formatPerMinuteValue(rateStats.rpm),
            meta: (
                <span className={styles.statMetaItem}>
          {t('usage_stats.total_requests')}: {loading ? '-' : rateStats.requestCount.toLocaleString()}
        </span>
            ),
            trend: sparklines.rpm,
        },
        {
            key: 'tpm',
            label: t('usage_stats.tpm_30m'),
            icon: <IconTrendingUp size={16} />,
            accent: 'var(--stat-tpm-accent)',
            accentSoft: 'color-mix(in srgb, var(--stat-tpm-accent) 18%, transparent)',
            accentBorder: 'color-mix(in srgb, var(--stat-tpm-accent) 32%, transparent)',
            value: loading ? '-' : formatPerMinuteValue(rateStats.tpm),
            meta: (
                <span className={styles.statMetaItem}>
          {t('usage_stats.total_tokens')}: {loading ? '-' : formatCompactNumber(rateStats.tokenCount)}
        </span>
            ),
            trend: sparklines.tpm,
        },
        {
            key: 'cost',
            label: t('usage_stats.total_cost'),
            icon: <IconDollarSign size={16} />,
            accent: 'var(--stat-cost-accent)',
            accentSoft: 'color-mix(in srgb, var(--stat-cost-accent) 18%, transparent)',
            accentBorder: 'color-mix(in srgb, var(--stat-cost-accent) 32%, transparent)',
            value: loading ? '-' : hasCostData ? formatUsd(totalCost) : '--',
            meta: (
                <>
          <span className={styles.statMetaItem}>
            {t('usage_stats.total_tokens')}: {loading ? '-' : formatCompactNumber(usage?.total_tokens ?? 0)}
          </span>
                    {!hasCostData && (
                        <span className={`${styles.statMetaItem} ${styles.statSubtle}`}>
                            {t('usage_stats.cost_need_price')}
                        </span>
                    )}
                </>
            ),
            trend: hasCostData ? sparklines.cost : null,
        },
    ]

    return (
        <div className={styles.statsGrid}>
            {statsCards.map((card) => (
                <div
                    key={card.key}
                    className={styles.statCard}
                    style={
                        {
                            '--accent': card.accent,
                            '--accent-soft': card.accentSoft,
                            '--accent-border': card.accentBorder,
                        } as CSSProperties
                    }
                >
                    <div className={styles.statCardHeader}>
                        <div className={styles.statLabelGroup}>
                            <span className={styles.statLabel}>{card.label}</span>
                        </div>
                        <span className={styles.statIconBadge}>{card.icon}</span>
                    </div>
                    <div className={styles.statValue}>{card.value}</div>
                    {card.meta && <div className={styles.statMetaRow}>{card.meta}</div>}
                    <div className={styles.statTrend}>
                        {card.trend ? (
                            <Line className={styles.sparkline} data={card.trend.data} options={sparklineOptions} />
                        ) : (
                             <div className={styles.statTrendPlaceholder}></div>
                         )}
                    </div>
                </div>
            ))}
        </div>
    )
}
