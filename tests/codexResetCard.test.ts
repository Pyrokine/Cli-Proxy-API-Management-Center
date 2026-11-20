import {CredentialCard} from '@/components/credentials/CredentialCard'
import {buildPluginQuotaIdentity} from '@/components/credentials/pluginQuota'
import {formatAuthFileDisplayName, formatModified, inferProviderFromAuthFileName} from '@/features/authFiles/constants'
import {isRuntimeOnlyAuthFile} from '@/features/authFiles/hooks/useAuthFilesPrefixProxyEditor'
import {deriveAuthFileIdentity} from '@/features/authFiles/identity'
import {useCredentialQuota} from '@/hooks/useCredentialQuota'
import i18n from '@/i18n'
import {apiClient} from '@/services/api/client'
import {useAuthFileRefreshStore} from '@/stores/useAuthFileRefreshStore'
import {authFileStatusRequestKey, useAuthFileStatusStore} from '@/stores/useAuthFileStatusStore'
import {useNotificationStore} from '@/stores/useNotificationStore'
import {captureQuotaRequestClaim, commitQuotaSnapshot, useQuotaStore} from '@/stores/useQuotaStore'
import {useTimezoneStore} from '@/stores/useTimezoneStore'
import type {CodexQuotaState, QuotaFreshness} from '@/types'
import type {AuthFileItem} from '@/types/authFile'
import {formatDateTime} from '@/utils/format'
import {isModelScopedProviderError, parseProviderError} from '@/utils/providerError'
import {parseCodexResetCreditProbe, resolveCodexResetCredits} from '@/utils/quota/codexResetCredits'
import {quotaCredentialKey} from '@/utils/quota/credentialKey'
import {normalizeCodexAccountCredits, normalizePlanType} from '@/utils/quota/parsers'
import {parseOffsetSecondsToMs, resolveResetMs} from '@/utils/quota/resetInstants'
import {resolveCodexPlanType, resolveCodexSubscriptionActiveUntil} from '@/utils/quota/resolvers'
import {MINUTE_CLOCK} from '@/utils/time/sharedClock'
import {calculateStatusBarDataFromRecentRequests, calculateStatusBarDataFromSummaryPoints} from '@/utils/usage'
import {describe, expect, spyOn, test} from 'bun:test'
import React, {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {useTranslation} from 'react-i18next'
import {sourceCallback, sourceInitializer} from './sourceCallbacks'

const mapperPath                         = 'components/credentials/hooks/useBackendQuotaRegistration.ts'
const asRecord                           = sourceCallback(mapperPath, 'asRecord', {})
const mapCodex                           = sourceCallback<(data: unknown) => CodexQuotaState>(mapperPath, 'mapCodex', {
    i18n,
    formatDateTime,
    resolveCodexResetCredits,
    normalizeCodexAccountCredits,
    parseOffsetSecondsToMs,
    resolveResetMs,
    asRecord,
    numberValue: sourceCallback(mapperPath, 'numberValue', { asRecord }),
    invalidQuotaPayload: sourceCallback(mapperPath, 'invalidQuotaPayload', { i18n }),
})
const key                                = quotaCredentialKey('codex', 'reset-fixture.json', 'reset-fixture-index')
const expiresAt                          = '2099-11-07T07:22:17Z'
const scheduler                          = {
    getLastRefreshTime: () => new Date(), getNextRefreshTime: () => null,
    getStatus: () => 'success', isRefreshing: () => false, isAutoRefreshEnabled: () => false,
    refreshNow: () => {
    }, refreshMany: () => {
    },
}
const cardPath                           = 'components/credentials/VendorSection.tsx'
const cardScope: Record<string, unknown> = {
    React, ...React,
    useTranslation,
    CredentialCard,
    apiClient,
    useAuthFileRefreshStore,
    useTimezoneStore,
    isRuntimeOnlyAuthFile,
    // noinspection JSUnusedGlobalSymbols
    'buildPluginQuotaIdentity': buildPluginQuotaIdentity,
    useAuthFileStatusStore,
    authFileStatusRequestKey,
    useNotificationStore,
    useQuotaStore,
    // noinspection JSUnusedGlobalSymbols
    'useCredentialQuota': useCredentialQuota,
    formatAuthFileDisplayName,
    formatModified,
    inferProviderFromAuthFileName,
    deriveAuthFileIdentity,
    formatDateTime,
    isModelScopedProviderError,
    // noinspection JSUnusedGlobalSymbols
    'parseProviderError': parseProviderError,
    // noinspection JSUnusedGlobalSymbols
    'parseCodexResetCreditProbe': parseCodexResetCreditProbe,
    quotaCredentialKey,
    normalizePlanType,
    // noinspection JSUnusedGlobalSymbols
    'resolveCodexPlanType': resolveCodexPlanType,
    // noinspection JSUnusedGlobalSymbols
    'resolveCodexSubscriptionActiveUntil': resolveCodexSubscriptionActiveUntil,
    // noinspection JSUnusedGlobalSymbols
    'calculateStatusBarDataFromRecentRequests': calculateStatusBarDataFromRecentRequests,
}
for (const name of [
    'parseDateLike', 'formatDateLike', 'dateLikeToISOString', 'formatPlanLabel', 'comparePlanRank',
    'formatCodexResetCreditCount', 'formatCodexResetCreditExpiry', 'codexResetCreditDetailsMessage',
    'codexResetCreditAvailabilityMessage',
]) {
    cardScope[name] = sourceCallback(cardPath, name, cardScope)
}
for (const name of ['authFileQuotaProvider', 'authFileQuotaKey', 'authFileProviderLabel', 'PREMIUM_CODEX_PLAN_TYPES']) {
    cardScope[name] = sourceInitializer(cardPath, name, cardScope)
}
const AuthFileCardWithQuota = sourceCallback<React.ComponentType<{
    persistedStatusBar?: ReturnType<typeof calculateStatusBarDataFromSummaryPoints>;
    file: AuthFileItem;
    position: number;
    scheduler: typeof scheduler;
    disableControls: boolean
    onRefresh: () => Promise<void>;
    onToggle: () => Promise<void>;
    onEdit: () => void
    onDelete: () => void;
    onDownload: () => Promise<void>
}>>(cardPath, 'AuthFileCardWithQuota', cardScope)

function renderCard(
    available: number | undefined,
    applicable: number,
    freshness: QuotaFreshness = 'fresh',
    disabled                  = false,
    detailAvailable           = available,
    observation: {
        persistedStatusBar?: ReturnType<typeof calculateStatusBarDataFromSummaryPoints>;
        payload?: Record<string, unknown>;
        lastError?: string;
        file?: Partial<AuthFileItem>
    }                         = {},
): string {
    const quota                  = mapCodex({
                                                plan_type: 'pro',
                                                rate_limit: {
                                                    secondary_window: {
                                                        used_percent: 43,
                                                        limit_window_seconds: 604800,
                                                    },
                                                },
                                                rate_limit_reset_credits: {
                                                    ...(available === undefined ? {} : { available_count: available }),
                                                    applicable_available_count: applicable,
                                                },
                                                rate_limit_reset_credits_details: {
                                                    ...(detailAvailable === undefined ?
                                                        {} :
                                                        { available_count: detailAvailable }),
                                                    credits: available ? [
                                                        {
                                                            id: 'synthetic-credit',
                                                            reset_type: 'codex_rate_limits',
                                                            status: 'available',
                                                            expires_at: expiresAt,
                                                        },
                                                    ] : [],
                                                },
                                                ...observation.payload,
                                            })
    const serverState            = useQuotaStore.getInitialState()
    const originalServerState    = { ...serverState }
    const originalQuota          = useQuotaStore.getState()
    const refreshServerState     = useAuthFileRefreshStore.getInitialState()
    const originalRefreshRequest = refreshServerState.request
    const codexQuota             = { [key]: quota }
    const quotaMetadata          = {
        [key]: {
            fileName: 'reset-fixture.json', type: 'codex', status: 'success' as const,
            freshness, backendGeneration: 1, backendStateRevision: 1, successfulEmpty: false,
            lastError: observation.lastError,
        },
    }
    try {
        // SSR reads the initial store snapshot; all quota values come from the production mapper.
        Object.assign(serverState, { codexQuota, quotaMetadata })
        useQuotaStore.setState({ codexQuota, quotaMetadata })
        refreshServerState.request = null
        return renderToStaticMarkup(createElement(AuthFileCardWithQuota, {
            persistedStatusBar: observation.persistedStatusBar,
            file: {
                name: 'reset-fixture.json',
                type: 'codex',
                authIndex: 'reset-fixture-index',
                disabled,
                status: 'active', ...observation.file,
            },
            position: 1, scheduler, disableControls: false, onRefresh: async () => {
            },
            onToggle: async () => {
            }, onEdit: () => {
            }, onDelete: () => {
            }, onDownload: async () => {
            },
        }))
    } finally {
        Object.assign(serverState, originalServerState)
        useQuotaStore.setState(originalQuota, true)
        refreshServerState.request = originalRefreshRequest
    }
}

function resetButton(html: string): string {
    const label  = i18n.t('auth_files.quota_reset_codex_title')
    const button = Array.from(html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g), ([markup]) => markup)
                        .find((markup) => markup.includes(`aria-label="${label}"`))
    expect(button).toBeDefined()
    return button!
}

function countField(html: string): string {
    const field = html.match(/data-field-id="reset-credits-available"[^>]*>[\s\S]*?<\/div>/)?.[0]
    expect(field).toBeDefined()
    return field!
}

describe('Codex reset credits in the actual vendor card', () => {
    test('shows the owned reset and enables confirmation when the applicable count is zero', () => {
        const html = renderCard(1, 0)
        expect(countField(html)).toContain('>1</span>')
        expect(resetButton(html)).not.toContain('disabled=""')
        expect(html).toContain(formatDateTime(expiresAt, i18n.language))
        expect(html).not.toContain('data-field-id="reset-credits-applicable"')
    })

    test('uses the owned count when the two counts differ in either direction', () => {
        const available = renderCard(3, 1)
        expect(countField(available)).toContain('>3</span>')
        expect(resetButton(available)).not.toContain('disabled=""')
        const empty = renderCard(0, 1)
        expect(countField(empty)).toContain('>0</span>')
        expect(resetButton(empty)).not.toContain('disabled=""')
    })

    test('keeps an unknown owned count unknown even when the applicable count is positive', () => {
        const html = renderCard(undefined, 1)
        expect(countField(html)).toContain(i18n.t('codex_quota.reset_credits_count_missing'))
        expect(resetButton(html)).not.toContain('disabled=""')
    })

    test('allows old snapshots to start a read-only check while preserving disabled-account protection', () => {
        for (const freshness of ['stale', 'partial', 'outdated'] as const) {
            const html = renderCard(1, 0, freshness)
            expect(countField(html)).toContain('>1</span>')
            expect(resetButton(html)).not.toContain('disabled=""')
        }
        expect(resetButton(renderCard(1, 0, 'fresh', true))).toContain('disabled=""')
    })

    test('reports conflicting owned counts and blocks the reset', () => {
        const html = renderCard(1, 0, 'fresh', false, 2)
        expect(countField(html)).toContain(i18n.t('codex_quota.reset_credits_count_conflict', {
            values: 'usage: 1, details: 2',
        }))
        expect(resetButton(html)).not.toContain('disabled=""')
    })

    test('scopes a subscription 403 while retaining the active account, weekly quota, and owned reset', () => {
        const error = 'codex subscription returned status 403'
        const post  = spyOn(apiClient, 'post').mockRejectedValue(new Error('Unexpected mutation'))
        try {
            const html = renderCard(1, 0, 'partial', false, 1, {
                lastError: error,
                payload: {
                    rate_limit: { secondary_window: { used_percent: 95, limit_window_seconds: 604800 } },
                    subscription_error: error,
                    subscription_active_until: expiresAt,
                    subscription_active_until_source: 'codex_subscriptions',
                },
            })
            expect(html).toContain('5%')
            expect(html).toContain(i18n.t('credentials.inspection_status_normal'))
            expect(html).toContain(i18n.t('credentials.quota_subscription_partial'))
            expect(html).toContain('data-field-id="subscription-query-status"')
            expect(html).toContain(error)
            expect(html).toContain(i18n.t('credentials.refresh_status_partial'))
            expect(html).toContain(i18n.t('credentials.auto_refresh_off'))
            expect(html).toContain('data-field-id="reset-credits-status"')
            expect(html).toContain(i18n.t('codex_quota.reset_credits_refresh_required'))
            expect(html).not.toContain(i18n.t('credentials.quota_freshness_partial'))
            expect(html).not.toContain(i18n.t('credentials.quota_status_banned'))
            expect(html).not.toContain(i18n.t('credentials.quota_status_exceeded'))
            expect(html).not.toContain('data-field-id="subscription-active-until"')
            expect(countField(html)).toContain('>1</span>')
            expect(html).toContain(formatDateTime(expiresAt, i18n.language))
            expect(resetButton(html)).not.toContain('disabled=""')
            expect(post).not.toHaveBeenCalled()
        } finally {
            post.mockRestore()
        }
    })

    test('separates an exhausted 429 runtime from the owned reset and subscription 403', () => {
        const error   = 'codex subscription returned status 403'
        const retryAt = new Date(Date.now() + 3_600_000).toISOString()
        const post    = spyOn(apiClient, 'post').mockRejectedValue(new Error('Unexpected mutation'))
        try {
            const html = renderCard(1, 0, 'partial', false, 1, {
                lastError: error,
                payload: {
                    rate_limit: { secondary_window: { used_percent: 100, limit_window_seconds: 604800 } },
                    subscription_error: error,
                },
                file: {
                    status: 'unavailable', unavailable: true,
                    runtimeError: {
                        code: 'usage_limit_reached', message: 'usage_limit_reached', httpStatus: 429,
                        model: 'gpt-5.5', effectScope: 'model', effectKey: 'gpt-5.5', nextRetryAfter: retryAt,
                    },
                    cooldownSnapshot: {
                        receivedAtMs: Date.now(), records: [
                            {
                                scope: 'model', modelKey: 'gpt-5.5',
                                retryAt, remainingSeconds: 3600, reason: 'usage_limit_reached', httpStatus: 429,
                            },
                        ],
                    },
                },
            })
            expect(html).toContain('0%')
            expect(html).toContain('usage_limit_reached')
            expect(html).toContain('429')
            expect(html).toContain('data-field-id="subscription-query-status"')
            expect(html).toContain(error)
            expect(html).toContain(i18n.t('credentials.auto_refresh_off'))
            expect(html).toContain(i18n.t('codex_quota.reset_credits_refresh_required'))
            expect(countField(html)).toContain('>1</span>')
            expect(html).toContain(formatDateTime(expiresAt, i18n.language))
            expect(resetButton(html)).not.toContain('disabled=""')
            expect(post).not.toHaveBeenCalled()
        } finally {
            post.mockRestore()
        }
    })

    test('keeps reset-credit failures visible beside a separate subscription failure', () => {
        const subscriptionError = 'codex subscription returned status 403'
        const resetError        = 'codex reset credits returned status 502'
        const html              = renderCard(1, 0, 'partial', false, 1, {
            lastError: `${resetError}; ${subscriptionError}`,
            payload: { subscription_error: subscriptionError, rate_limit_reset_credits_error: resetError },
        })
        expect(html).toContain(i18n.t('credentials.quota_freshness_partial'))
        expect(html).not.toContain(i18n.t('credentials.quota_subscription_partial'))
        expect(html).toContain('codex reset credits returned')
        expect(html).toContain('502')
        expect(html).toContain(subscriptionError)
        expect(html).toContain('data-field-id="reset-credit-expiry-details"')
        expect(resetButton(html)).not.toContain('disabled=""')
    })

    test('a successful subscription snapshot replaces the previous error in the production store', () => {
        const original   = useQuotaStore.getState()
        const generation = apiClient.getAuthGeneration()
        const error      = 'codex subscription returned status 403'
        try {
            useQuotaStore.setState({ subjectVersions: {}, codexQuota: {}, quotaMetadata: {} })
            const claim = captureQuotaRequestClaim(generation)
            for (const [revision, subscriptionError] of [[1, error], [2, '']] as const) {
                const value = mapCodex({
                                           plan_type: 'pro', subscription_error: subscriptionError,
                                           subscription_active_until: expiresAt,
                                           subscription_active_until_source: 'codex_subscriptions',
                                       })
                expect(commitQuotaSnapshot(claim, generation, {
                    key,
                    payload: { provider: 'codex', value },
                    metadata: {
                        fileName: 'reset-fixture.json', type: 'codex', status: 'success',
                        freshness: subscriptionError ? 'partial' : 'fresh',
                        backendGeneration: 1, backendStateRevision: revision, successfulEmpty: false,
                        lastError: error,
                    },
                })).toBe('committed')
                const current = useQuotaStore.getState().codexQuota[key]!
                expect(current.subscriptionError).toBe(subscriptionError)
                expect(current.subscriptionActiveUntil).toBe(subscriptionError ? null : expiresAt)
            }
            const html = renderCard(1, 0, 'fresh', false, 1, {
                lastError: error,
                payload: {
                    subscription_active_until: expiresAt,
                    subscription_active_until_source: 'codex_subscriptions',
                },
            })
            expect(html).not.toContain('data-field-id="subscription-query-status"')
            expect(html).not.toContain(error)
            expect(html).toContain('data-field-id="subscription-active-until"')
            expect(html).toContain(i18n.t('credentials.refresh_status_success'))
        } finally {
            useQuotaStore.setState(original, true)
        }
    })
})

test('manual reset expiry renders a live countdown and an imminent-expiry marker', () => {
    const now   = Date.now()
    const clock = spyOn(MINUTE_CLOCK, 'getServerSnapshot').mockReturnValue(now)
    try {
        const expires = new Date(now + 30 * 60_000).toISOString()
        const html    = renderCard(1, 1, 'fresh', false, 1, {
            payload: {
                rate_limit_reset_credits_details: {
                    available_count: 1,
                    credits: [
                        {
                            id: 'near-expiry',
                            reset_type: 'codex_rate_limits',
                            status: 'available',
                            expires_at: expires,
                        },
                    ],
                },
            },
        })
        expect(html).toContain('data-field-id="reset-credit-expiry-near-expiry-0"')
        expect(html).toContain(i18n.t('codex_quota.reset_credit_expiring_soon'))
        expect(html).toContain(new Intl.RelativeTimeFormat(i18n.resolvedLanguage, { numeric: 'always' }).format(
            30,
            'minute',
        ))
    } finally {
        clock.mockRestore()
    }
})

test('auth-file reload keeps persisted four-hour health when in-memory recent requests are empty', () => {
    const now                = Date.now()
    const persistedStatusBar = calculateStatusBarDataFromSummaryPoints([
                                                                           {
                                                                               time: new Date(now -
                                                                                              600000).toISOString(),
                                                                               requests: 2,
                                                                               success: 1,
                                                                               failure: 1,
                                                                               tokens: {
                                                                                   input: 5,
                                                                                   output: 9,
                                                                                   cached: 0,
                                                                                   reasoning: 0,
                                                                                   total: 14,
                                                                               },
                                                                               cost: 0,
                                                                               has_cost: true,
                                                                           },
                                                                       ], now - 4 * 3600000, 600000, 24)
    const html               = renderCard(
        0,
        0,
        'fresh',
        false,
        0,
        { persistedStatusBar, file: { recentRequests: [], success: 0, failed: 0 } },
    )
    expect(html).toContain(`${i18n.t('common.success')}: 1`)
    expect(html).toContain(`${i18n.t('common.failure')}: 1`)
})

test('runtime-only credential identity is a heading with view/status actions and no file download or deletion', () => {
    const html = renderCard(1, 0, 'fresh', false, 1, { file: { runtimeOnly: true } })
    expect(html).toContain('<h3')
    expect(html).toContain(i18n.t('credentials.runtime_only_label'))
    expect(html).toContain(i18n.t('auth_files.runtime_only_readonly_hint'))
    expect(html).toContain(`title="${i18n.t('common.view')}"`)
    expect(html).not.toContain(`title="${i18n.t('auth_files.download_button')}"`)
    expect(html).not.toContain(`title="${i18n.t('common.delete')}"`)
    expect(html).toContain(i18n.t('credentials.card_toggle', { name: 'codex reset-fixture-index' }))
    const regular = renderCard(1, 0)
    expect(regular).toContain(`title="${i18n.t('auth_files.download_button')}"`)
    expect(regular).toContain(`title="${i18n.t('common.delete')}"`)
})

test('manual reset expiry names the same selected timezone used to format its timestamp', () => {
    const initial         = useTimezoneStore.getInitialState()
    const originalInitial = initial.timezone
    const original        = useTimezoneStore.getState().timezone
    try {
        for (const timezone of ['UTC', 'America/Los_Angeles', 'Asia/Tokyo']) {
            initial.timezone = timezone
            useTimezoneStore.setState({ timezone })
            const html = renderCard(1, 0)
            expect(html).toContain(`(${timezone})`)
            expect(html).toContain(formatDateTime(expiresAt, i18n.language))
        }
        initial.timezone = ''
        useTimezoneStore.setState({ timezone: '' })
        expect(renderCard(1, 0)).toContain(`(${Intl.DateTimeFormat().resolvedOptions().timeZone})`)
    } finally {
        initial.timezone = originalInitial
        useTimezoneStore.setState({ timezone: original })
    }
})

test('the actual OAuth credential card displays weight and its accessible scheduling explanation', () => {
    const html = renderCard(1, 0, 'fresh', false, 1, { file: { weight: 3 } })
    expect(html).toContain('data-field-id="weight"')
    expect(html).toContain('>3</span>')
    expect(html).toContain(`aria-label="${i18n.t('ai_providers.weight_label')}: ${i18n.t('ai_providers.weight_hint')}"`)
})
