import {CredentialCard} from '@/components/credentials/CredentialCard'
import {formatAuthFileDisplayName, formatModified, inferProviderFromAuthFileName} from '@/features/authFiles/constants'
import {deriveAuthFileIdentity} from '@/features/authFiles/identity'
import {useCredentialQuota} from '@/hooks/useCredentialQuota'
import i18n from '@/i18n'
import {apiClient} from '@/services/api/client'
import {useAuthFileRefreshStore} from '@/stores/useAuthFileRefreshStore'
import {authFileStatusRequestKey, useAuthFileStatusStore} from '@/stores/useAuthFileStatusStore'
import {useNotificationStore} from '@/stores/useNotificationStore'
import {useQuotaStore} from '@/stores/useQuotaStore'
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
import {describe, expect, test} from 'bun:test'
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
    }}
    try {
        // SSR reads the initial store snapshot; all quota values come from the production mapper.
        Object.assign(serverState, {codexQuota, quotaMetadata})
        useQuotaStore.setState({codexQuota, quotaMetadata})
        refreshServerState.request = null
        return renderToStaticMarkup(createElement(AuthFileCardWithQuota, {
            file: {name: 'reset-fixture.json', type: 'codex', authIndex: 'reset-fixture-index', disabled},
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
})
