import {CredentialCard} from '@/components/credentials/CredentialCard'
import {formatAuthFileDisplayName, formatModified, inferProviderFromAuthFileName} from '@/features/authFiles/constants'
import {deriveAuthFileIdentity} from '@/features/authFiles/identity'
import {useCredentialQuota} from '@/hooks/useCredentialQuota'
import i18n from '@/i18n'
import {apiClient} from '@/services/api/client'
import {useAuthFileRefreshStore} from '@/stores/useAuthFileRefreshStore'
import {authFileStatusRequestKey, useAuthFileStatusStore} from '@/stores/useAuthFileStatusStore'
import {useNotificationStore} from '@/stores/useNotificationStore'
import {captureQuotaRequestClaim, commitQuotaSnapshot, useQuotaStore} from '@/stores/useQuotaStore'
import type {CodexQuotaState, QuotaFreshness} from '@/types'
import type {AuthFileItem} from '@/types/authFile'
import {formatDateTime} from '@/utils/format'
import {isModelScopedProviderError, parseProviderError} from '@/utils/providerError'
import {codexResetCreditAvailability, resolveCodexResetCredits} from '@/utils/quota/codexResetCredits'
import {quotaCredentialKey} from '@/utils/quota/credentialKey'
import {normalizeCodexAccountCredits, normalizePlanType} from '@/utils/quota/parsers'
import {parseOffsetSecondsToMs, resolveResetMs} from '@/utils/quota/resetInstants'
import {resolveCodexPlanType, resolveCodexSubscriptionActiveUntil} from '@/utils/quota/resolvers'
import {calculateStatusBarDataFromRecentRequests} from '@/utils/usage'
import {describe, expect, spyOn, test} from 'bun:test'
import React, {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {useTranslation} from 'react-i18next'
import {sourceCallback, sourceInitializer} from './sourceCallbacks'

const mapperPath = 'components/credentials/hooks/useBackendQuotaRegistration.ts'
const asRecord = sourceCallback(mapperPath, 'asRecord', {})
const mapCodex = sourceCallback<(data: unknown) => CodexQuotaState>(mapperPath, 'mapCodex', {
    i18n, formatDateTime, resolveCodexResetCredits, normalizeCodexAccountCredits, parseOffsetSecondsToMs, resolveResetMs,
    asRecord,
    numberValue: sourceCallback(mapperPath, 'numberValue', {asRecord}),
    invalidQuotaPayload: sourceCallback(mapperPath, 'invalidQuotaPayload', {i18n}),
})
const key = quotaCredentialKey('codex', 'reset-fixture.json', 'reset-fixture-index')
const expiresAt = '2099-11-07T07:22:17Z'
const scheduler = {
    getLastRefreshTime: () => new Date(), getNextRefreshTime: () => null,
    getStatus: () => 'success', isRefreshing: () => false, isAutoRefreshEnabled: () => false,
    refreshNow: () => {}, refreshMany: () => {},
}
const cardPath = 'components/credentials/VendorSection.tsx'
const cardScope: Record<string, unknown> = {
    React, ...React, useTranslation, CredentialCard, apiClient, useAuthFileRefreshStore,
    useAuthFileStatusStore, authFileStatusRequestKey, useNotificationStore, useQuotaStore, useCredentialQuota,
    formatAuthFileDisplayName, formatModified, inferProviderFromAuthFileName, deriveAuthFileIdentity,
    formatDateTime, isModelScopedProviderError, parseProviderError, codexResetCreditAvailability,
    quotaCredentialKey, normalizePlanType, resolveCodexPlanType, resolveCodexSubscriptionActiveUntil,
    calculateStatusBarDataFromRecentRequests,
}
for (const name of ['parseDateLike', 'formatDateLike', 'dateLikeToISOString', 'formatPlanLabel', 'comparePlanRank',
    'formatCodexResetCreditCount', 'formatCodexResetCreditExpiry', 'codexResetCreditDetailsMessage',
    'codexResetCreditAvailabilityMessage']) {
    cardScope[name] = sourceCallback(cardPath, name, cardScope)
}
for (const name of ['authFileQuotaProvider', 'authFileQuotaKey', 'authFileProviderLabel', 'PREMIUM_CODEX_PLAN_TYPES']) {
    cardScope[name] = sourceInitializer(cardPath, name, cardScope)
}
const AuthFileCardWithQuota = sourceCallback<React.ComponentType<{
    file: AuthFileItem; position: number; scheduler: typeof scheduler; disableControls: boolean
    onRefresh: () => Promise<void>; onToggle: () => Promise<void>; onEdit: () => void
    onDelete: () => void; onDownload: () => Promise<void>
}>>(cardPath, 'AuthFileCardWithQuota', cardScope)

function renderCard(
    available: number | undefined,
    applicable: number,
    freshness: QuotaFreshness = 'fresh',
    disabled = false,
    detailAvailable = available,
    observation: {payload?: Record<string, unknown>; lastError?: string} = {},
): string {
    const quota = mapCodex({
        plan_type: 'pro',
        rate_limit: {secondary_window: {used_percent: 43, limit_window_seconds: 604800}},
        rate_limit_reset_credits: {
            ...(available === undefined ? {} : {available_count: available}),
            applicable_available_count: applicable,
        },
        rate_limit_reset_credits_details: {
            ...(detailAvailable === undefined ? {} : {available_count: detailAvailable}),
            credits: available ? [{
                id: 'synthetic-credit', reset_type: 'codex_rate_limits', status: 'available', expires_at: expiresAt,
            }] : [],
        },
        ...observation.payload,
    })
    const serverState = useQuotaStore.getInitialState()
    const originalServerState = {...serverState}
    const originalQuota = useQuotaStore.getState()
    const refreshServerState = useAuthFileRefreshStore.getInitialState()
    const originalRefreshRequest = refreshServerState.request
    const codexQuota = {[key]: quota}
    const quotaMetadata = {[key]: {
        fileName: 'reset-fixture.json', type: 'codex', status: 'success' as const,
        freshness, backendGeneration: 1, backendStateRevision: 1, successfulEmpty: false,
        lastError: observation.lastError,
    }}
    try {
        // SSR reads the initial store snapshot; all quota values come from the production mapper.
        Object.assign(serverState, {codexQuota, quotaMetadata})
        useQuotaStore.setState({codexQuota, quotaMetadata})
        refreshServerState.request = null
        return renderToStaticMarkup(createElement(AuthFileCardWithQuota, {
            file: {name: 'reset-fixture.json', type: 'codex', authIndex: 'reset-fixture-index', disabled, status: 'active'},
            position: 1, scheduler, disableControls: false, onRefresh: async () => {},
            onToggle: async () => {}, onEdit: () => {}, onDelete: () => {}, onDownload: async () => {},
        }))
    } finally {
        Object.assign(serverState, originalServerState)
        useQuotaStore.setState(originalQuota, true)
        refreshServerState.request = originalRefreshRequest
    }
}

function resetButton(html: string): string {
    const label = i18n.t('auth_files.quota_reset_codex_title')
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
        expect(resetButton(empty)).toContain('disabled=""')
    })

    test('keeps an unknown owned count unknown even when the applicable count is positive', () => {
        const html = renderCard(undefined, 1)
        expect(countField(html)).toContain(i18n.t('codex_quota.reset_credits_count_missing'))
        expect(resetButton(html)).toContain('disabled=""')
    })

    test('preserves snapshot freshness and disabled-account protection', () => {
        for (const freshness of ['stale', 'partial', 'outdated'] as const) {
            const html = renderCard(1, 0, freshness)
            expect(countField(html)).toContain('>1</span>')
            expect(resetButton(html)).toContain('disabled=""')
        }
        expect(resetButton(renderCard(1, 0, 'fresh', true))).toContain('disabled=""')
    })

    test('reports conflicting owned counts and blocks the reset', () => {
        const html = renderCard(1, 0, 'fresh', false, 2)
        expect(countField(html)).toContain(i18n.t('codex_quota.reset_credits_count_conflict', {
            values: 'usage: 1, details: 2',
        }))
        expect(resetButton(html)).toContain('disabled=""')
    })

    test('scopes a subscription 403 while retaining the active account, weekly quota, and owned reset', () => {
        const error = 'codex subscription returned status 403'
        const post = spyOn(apiClient, 'post').mockRejectedValue(new Error('Unexpected mutation'))
        try {
            const html = renderCard(1, 0, 'partial', false, 1, {
                lastError: error,
                payload: {
                    rate_limit: {secondary_window: {used_percent: 95, limit_window_seconds: 604800}},
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
            expect(resetButton(html)).toContain('disabled=""')
            expect(post).not.toHaveBeenCalled()
        } finally {
            post.mockRestore()
        }
    })

    test('keeps reset-credit failures visible beside a separate subscription failure', () => {
        const subscriptionError = 'codex subscription returned status 403'
        const resetError = 'codex reset credits returned status 502'
        const html = renderCard(1, 0, 'partial', false, 1, {
            lastError: `${resetError}; ${subscriptionError}`,
            payload: {subscription_error: subscriptionError, rate_limit_reset_credits_error: resetError},
        })
        expect(html).toContain(i18n.t('credentials.quota_freshness_partial'))
        expect(html).not.toContain(i18n.t('credentials.quota_subscription_partial'))
        expect(html).toContain('codex reset credits returned')
        expect(html).toContain('502')
        expect(html).toContain(subscriptionError)
        expect(html).toContain('data-field-id="reset-credit-expiry-details"')
        expect(resetButton(html)).toContain('disabled=""')
    })

    test('a successful subscription snapshot replaces the previous error in the production store', () => {
        const original = useQuotaStore.getState()
        const generation = apiClient.getAuthGeneration()
        const error = 'codex subscription returned status 403'
        try {
            useQuotaStore.setState({subjectVersions: {}, codexQuota: {}, quotaMetadata: {}})
            const claim = captureQuotaRequestClaim(generation)
            for (const [revision, subscriptionError] of [[1, error], [2, '']] as const) {
                const value = mapCodex({
                    plan_type: 'pro', subscription_error: subscriptionError,
                    subscription_active_until: expiresAt,
                    subscription_active_until_source: 'codex_subscriptions',
                })
                expect(commitQuotaSnapshot(claim, generation, {
                    key,
                    payload: {provider: 'codex', value},
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
                payload: {subscription_active_until: expiresAt, subscription_active_until_source: 'codex_subscriptions'},
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
