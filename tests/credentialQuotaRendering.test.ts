import {CredentialCard} from '@/components/credentials/CredentialCard'
import {quotaErrorForDisplay} from '@/hooks/useCredentialQuota'
import i18n from '@/i18n'
import {useTimezoneStore} from '@/stores/useTimezoneStore'
import type {QuotaCacheMetadata} from '@/types'
import {formatDateTime} from '@/utils/format'
import {normalizePlanType} from '@/utils/quota/parsers'
import {projectQuotaProgress} from '@/utils/quota/projection'
import {buildResetDisplay} from '@/utils/quota/relativeTime'
import {pickUrgentRecoveryRowId} from '@/utils/quota/resetSchedule'
import {describe, expect, test} from 'bun:test'
import {readFileSync} from 'node:fs'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'

import {sourceCallback, sourceInitializer} from './sourceCallbacks'
import {expectSourceToContain} from './sourceContractAssertions'

const NOW                       = Date.parse('2026-08-02T12:00:00Z')
const credentialCardSource      = readFileSync(
    new URL('../src/components/credentials/CredentialCard.tsx', import.meta.url),
    'utf8',
)
const credentialCardStyles      = readFileSync(
    new URL('../src/components/credentials/CredentialCard.module.scss', import.meta.url),
    'utf8',
)
const credentialQuotaHookSource = readFileSync(
    new URL('../src/hooks/useCredentialQuota.ts', import.meta.url),
    'utf8',
)
const backendQuotaHookSource    = readFileSync(
    new URL('../src/components/credentials/hooks/useBackendQuotaRegistration.ts', import.meta.url),
    'utf8',
)
const vendorSectionSource       = readFileSync(
    new URL('../src/components/credentials/VendorSection.tsx', import.meta.url),
    'utf8',
)

describe('credential quota query results', () => {
    const render = (props: Partial<Parameters<typeof CredentialCard>[0]> = {}) => renderToStaticMarkup(createElement(
        CredentialCard,
        {
            category: 'auth-file', title: 'fixture.json', controlLabel: 'fixture',
            quotaItems: [{id: 'session', model: 'Retained quota', percent: 64}],
            refreshState: {
                status: 'success', lastRefreshTime: new Date(NOW), nextRefreshTime: null,
                isRefreshing: false, autoRefreshEnabled: false, onRefresh: () => {},
            },
            ...props,
        },
    ))

    test('partial endpoint failures preserve all error stages and show a partial refresh result', () => {
        const html = render({
            quotaFreshness: 'partial',
            quotaError: 'base quota: status 403; reset credit details: status 502; subscription: status 403',
            quotaSubscriptionError: 'subscription: status 403',
        })
        expect(html).toContain(i18n.t('credentials.refresh_status_partial'))
        expect(html).not.toContain(i18n.t('credentials.refresh_status_success'))
        for (const stage of ['base quota:', 'reset credit details:', 'subscription:', '403', '502', 'Retained quota']) {
            expect(html).toContain(stage)
        }
        expect(html).not.toContain(i18n.t('credentials.quota_status_banned'))
        expect(html).not.toContain(i18n.t('credentials.quota_status_exceeded'))
        expect(html).toContain(formatDateTime(new Date(NOW), i18n.language))
    })

    test('stale and outdated results report failure while retaining the successful quota and time', () => {
        for (const quotaFreshness of ['stale', 'outdated'] as const) {
            const html = render({quotaFreshness, quotaError: 'subscription: status 403'})
            expect(html).toContain(i18n.t('credentials.refresh_status_error'))
            expect(html).not.toContain(i18n.t('credentials.refresh_status_success'))
            expect(html).toContain('Retained quota')
            expect(html).toContain(formatDateTime(new Date(NOW), i18n.language))
        }
    })

    test('a credential awaiting its first refresh does not report a refresh failure', () => {
        const html = render({
            quotaItems: undefined, quotaFreshness: 'outdated',
            refreshState: {
                status: 'idle', lastRefreshTime: null, nextRefreshTime: null,
                isRefreshing: false, autoRefreshEnabled: false, onRefresh: () => {},
            },
        })
        expect(html).not.toContain(i18n.t('credentials.refresh_status_error'))
        expect(html).not.toContain(i18n.t('credentials.refresh_status_success'))
    })

    test('an in-flight partial refresh reports loading and retains the last successful quota', () => {
        const html = render({quotaFreshness: 'partial', quotaLoading: true, quotaError: 'subscription: status 403'})
        expect(html).toContain(i18n.t('credentials.refresh_status_loading'))
        expect(html).not.toContain(i18n.t('credentials.refresh_status_success'))
        expect(html).toContain('Retained quota')
    })

    test('separates the cooldown action from its observation time in a vertically spaced footer', () => {
        const now = Date.now()
        const html = render({
            cooldownSnapshot: {
                observedAt: new Date(now).toISOString(), receivedAtMs: now,
                records: [{
                    scope: 'model', modelKey: 'fixture-model', reason: 'rate_limit',
                    retryAt: new Date(now + 600_000).toISOString(), remainingSeconds: 600,
                }],
            },
            onClearCooldown: () => {},
        })
        expect(html).toMatch(/<div[^>]*><time\b[^>]*>[^<]*<\/time><button\b[^>]*>[\s\S]*?<\/button><\/div><\/details>/)
        const footer = credentialCardStyles.match(/\.cooldownFooter\s*\{([^}]+)\}/)?.[1]
        expect(footer).toContain('display: flex')
        expect(footer).toContain('flex-direction: column')
        expect(footer).toContain('align-items: flex-start')
        expect(footer).toContain('gap: $spacing-sm')
        expect(footer).toContain('margin-top: $spacing-sm')
    })

    test('refresh and reset action buttons remain icon-only in idle refreshing disabled and resetting states', () => {
        for (const state of ['idle', 'refreshing', 'disabled', 'resetting'] as const) {
            const html = render({
                disableControls: state === 'disabled',
                refreshState: {
                    status: state === 'refreshing' ? 'loading' : 'success',
                    lastRefreshTime: new Date(NOW), nextRefreshTime: null,
                    isRefreshing: state === 'refreshing', autoRefreshEnabled: false, onRefresh: () => {},
                },
                quotaResetState: {
                    isResetting: state === 'resetting', onReset: () => {},
                    title: i18n.t('auth_files.quota_reset_codex_title'),
                },
            })
            const buttons = Array.from(html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g), (match) => match[0])
            expect(buttons).toHaveLength(2)
            for (const button of buttons) {
                expect(button).toContain('aria-label=')
                expect(button.replace(/<[^>]*>/g, '').trim()).toBe('')
                expect((button.match(/<svg\b/g) ?? []).length).toBeLessThanOrEqual(1)
                if (state !== 'idle') {
                    expect(button).toContain('disabled=""')
                }
            }
            if (state === 'resetting') {
                expect(buttons[1]).toContain('loading-spinner')
                expect(buttons[1]).not.toContain('<svg')
            }
        }
        expect(credentialCardStyles).not.toContain('.refreshButtonLabel')
        expect(credentialCardStyles).toContain('flex: 0 0 32px')
        expect(credentialCardStyles).toContain('flex-wrap: wrap')
    })
})

describe('credential quota reset rendering contract', () => {
    test('keeps the absolute date and relative label for each reset row', () => {
        const first  = buildResetDisplay('08-02 12:30', NOW + 30 * 60_000, NOW, 'en')
        const second = buildResetDisplay('08-02 12:45', NOW + 45 * 60_000, NOW, 'en')

        expect(first).toMatchObject({ absolute: '08-02 12:30' })
        expect(second).toMatchObject({ absolute: '08-02 12:45' })
        expect(first?.relative).toContain('30 minutes')
        expect(second?.relative).toContain('45 minutes')
    })

    test('marks one deterministic row while preserving card order', () => {
        const items = [
            { id: 'weekly', resetAtMs: NOW + 45 * 60_000 },
            { id: 'session', resetAtMs: NOW + 30 * 60_000 },
        ]
        expect(pickUrgentRecoveryRowId(
            items.map(({ id, resetAtMs }) => ({ rowId: id, atMs: resetAtMs })),
            NOW,
        )).toBe('session')
        expect(items.map(({ id }) => id)).toEqual(['weekly', 'session'])
    })

    test('shows progress before reset and hides it at or after reset without losing the instant', () => {
        const resetAtMs = NOW + 30 * 60_000
        expect(projectQuotaProgress(35, resetAtMs, resetAtMs - 1)).toEqual({
                                                                               percent: 35,
                                                                               resetAtMs,
                                                                           })
        expect(projectQuotaProgress(35, resetAtMs, resetAtMs)).toEqual({
                                                                           percent: null,
                                                                           resetAtMs,
                                                                       })
        expect(projectQuotaProgress(35, resetAtMs, resetAtMs + 1)).toEqual({
                                                                               percent: null,
                                                                               resetAtMs,
                                                                           })
    })

    test('keeps last-known-good rows visible beside freshness and loading notices', () => {
        expect(credentialQuotaHookSource).toContain('lastError: quotaErrorForDisplay(metadata)')
        expect(credentialQuotaHookSource).toContain('loading: metadata?.status === \'loading\'')
        expect(credentialQuotaHookSource).toContain('freshness: metadata?.freshness')
        expect(credentialQuotaHookSource).toContain('observedAt: metadata?.observedAt')
        expect(credentialCardSource).toContain('{showFreshnessNotice && (')
        expect(credentialCardSource).toContain('{quotaLoading && (')
        expect(credentialCardSource).toContain('{hasQuotaItems ? (')
    })

    test('hides a historical quota error after a partial refresh fully recovers', () => {
        const partial: QuotaCacheMetadata = {
            fileName: 'codex.json',
            type: 'codex',
            backendGeneration: 1,
            backendStateRevision: 5,
            status: 'success',
            freshness: 'partial',
            lastError: 'subscription endpoint failed',
            successfulEmpty: false,
        }
        expect(quotaErrorForDisplay(partial)).toBe('subscription endpoint failed')
        expect(quotaErrorForDisplay({...partial, freshness: 'fresh', backendStateRevision: 6})).toBeUndefined()
        expect(quotaErrorForDisplay({
                                        ...partial,
                                        freshness: 'stale',
                                        status: 'error',
                                        backendStateRevision: 7,
                                        lastError: 'next refresh failed',
                                    })).toBe('next refresh failed')
        expect(quotaErrorForDisplay({...partial, freshness: 'outdated'})).toBe('subscription endpoint failed')
    })

    test('distinguishes a Codex quota subscription date from a credential record', () => {
        expect(backendQuotaHookSource).toContain(
            "d.subscription_active_until_source === 'codex_subscriptions'",
        )
        expect(backendQuotaHookSource).not.toContain('d.chatgpt_subscription_active_until ??')
        expect(vendorSectionSource).toContain(
            'const liveSubscriptionLabel = formatDateLike(quotaSubscriptionActiveUntil, i18n.language)',
        )
        expect(vendorSectionSource).toContain(
            'formatDateLike(resolveCodexSubscriptionActiveUntil(file), i18n.language)',
        )
        expect(vendorSectionSource).toContain("t('credentials.subscription_recorded_until')")
        expect(vendorSectionSource).not.toContain(
            'quotaSubscriptionActiveUntil ?? resolveCodexSubscriptionActiveUntil(file)',
        )
    })

    test('renders authoritative successful-empty separately from failures and pending state', () => {
        expect(backendQuotaHookSource).toContain(
            'entry.status === \'success\' && entry.successful_empty === true && !hasData',
        )
        expect(backendQuotaHookSource).toContain('clearData: successfulEmpty')
        expect(credentialQuotaHookSource).toContain('successfulEmpty: metadata?.successfulEmpty')
        expect(credentialCardSource).toContain('quotaSuccessfulEmpty ? (')
        expect(credentialCardSource).toContain('\'credentials.quota_successful_empty\'')
    })

    test('uses runtime observations and keeps raw provider JSON behind expandable details', () => {
        expect(vendorSectionSource).toContain('parseProviderError(file.runtimeError ?? file.statusMessage)')
        expect(vendorSectionSource).toContain('dateLikeToISOString(file.updatedAt)')
        expect(vendorSectionSource).not.toContain('checkedAt: dateLikeToISOString(file.lastRefresh)')
        expect(vendorSectionSource).toContain('isModelScopedProviderError(providerError)')
        expect(vendorSectionSource).toContain('quotaObservedAtMs < runtimeObservedAtMs')
        expect(vendorSectionSource).toContain('quotaObservationWarning={isPluginQuota ? undefined : quotaObservationWarning}')
        // noinspection JSUnresolvedReference
        expectSourceToContain(credentialCardSource, '<details className={styles.runtimeRawDetails}>')
        expect(credentialCardSource).toContain('t(\'credentials.provider_error_retry_due\'')
    })

    test('scopes poll reuse to one claim and reacts to credentials, cache, and language changes', () => {
        expect(backendQuotaHookSource).toContain('inFlight?.claimSignature === claimSignature')
        expect(backendQuotaHookSource).toContain(
            '[authFiles, cacheGeneration, quotaLanguage, pollLatest]',
        )
        expect(backendQuotaHookSource).toContain('result === \'stale_request\' || result === \'stale_subject\'')
        expect(backendQuotaHookSource).toContain('queueMicrotask(() => void poll())')
    })

    test('waits for a created refresh task independently from its initiating UI claim', () => {
        expect(backendQuotaHookSource).toContain('const terminalTask = await waitForQuotaRefreshTask(initialTask, {')
        expect(backendQuotaHookSource).toContain('if (isUIClaimCurrent()) {')
        expect(backendQuotaHookSource).toContain('await pollLatest()')
    })

    test('uses stable metadata IDs and wraps complete reset expiry values', () => {
        expect(credentialCardSource).toContain('fields?: CredentialField[]')
        expect(credentialCardSource).toContain('key={field.id}')
        expect(credentialCardSource).toContain('data-field-id={field.id}')
        expect(credentialCardSource).toContain('field.wrap ? styles.fieldValueWrap')
        expect(vendorSectionSource).toContain('id: `reset-credit-expiry-${creditIdentity}-${index}`')
        expect(vendorSectionSource).toContain('formatCodexResetCreditExpiry(credit, i18n.language, t)')
        expect(vendorSectionSource).toContain('wrap: true')
        expect(vendorSectionSource).not.toContain('formatShanghaiDateTime')
        expect(credentialCardStyles).toContain('.fieldValueWrap')
        expect(credentialCardStyles).toContain('white-space: normal')
        expect(credentialCardStyles).toContain('overflow-wrap: anywhere')
    })

    test('projects optional Codex account credits without manufacturing a balance', () => {
        expect(backendQuotaHookSource).toContain('normalizeCodexAccountCredits(d.credits)')
        expect(backendQuotaHookSource).toContain('creditBalance: accountCredits.balance')
        expect(backendQuotaHookSource).toContain('creditsUnlimited: accountCredits.unlimited')
        expect(credentialQuotaHookSource).toContain('creditBalance: codex.creditBalance')
        expect(credentialQuotaHookSource).toContain('creditsUnlimited: codex.creditsUnlimited')
        expect(vendorSectionSource).toContain('quotaCreditsUnlimited === true ||')
        expect(vendorSectionSource).toContain("id: 'codex-credit-balance'")
        expect(vendorSectionSource).toContain("quotaCreditsUnlimited ? t('codex_quota.credit_unlimited')")
        for (const locale of ['en', 'ru', 'zh-CN', 'zh-TW']) {
            const messages = JSON.parse(readFileSync(new URL(`../src/i18n/locales/${locale}.json`, import.meta.url), 'utf8'))
            expect(messages.codex_quota.credit_balance_label).toBeTruthy()
            expect(messages.codex_quota.credit_unlimited).toBeTruthy()
        }
    })

    test('preserves X Premium+ names and classifies the current card badge as premium', () => {
        const formatPlanLabel = sourceCallback<(plan: string, t: typeof i18n.t, provider: string) => string>(
            'components/credentials/VendorSection.tsx', 'formatPlanLabel', {normalizePlanType},
        )
        const premiumPlans = sourceInitializer<Set<string>>(
            'components/credentials/VendorSection.tsx', 'PREMIUM_CODEX_PLAN_TYPES', {},
        )
        for (const plan of ['X Premium+', 'XPremiumPlus', '  X-Premium-Plus  ']) {
            const key = normalizePlanType(plan)
            expect(key).toBe('xpremiumplus')
            const label = formatPlanLabel(plan, i18n.getFixedT('en'), 'xai')
            expect(label).toBe('X Premium+')
            const premium = sourceInitializer<boolean>(
                'components/credentials/VendorSection.tsx', 'isPremiumPlan', {
                    key, quotaPremium: undefined, PREMIUM_CODEX_PLAN_TYPES: premiumPlans, planLabelProvider: 'xai',
                },
            )
            expect(premium).toBe(true)
            const markup = renderToStaticMarkup(createElement(CredentialCard, {
                category: 'auth-file', title: 'xAI fixture', controlLabel: 'xAI fixture-index',
                badge: {label, premium}, disableControls: true,
            }))
            expect(markup).toContain('X Premium+')
        }
        expect(normalizePlanType('X Premium')).toBe('xpremium')
        expect(normalizePlanType('X Premium Future')).toBe('xpremiumfuture')
    })

    test('shows only the confirmed Codex Business Premium entitlement as premium', () => {
        expect(normalizePlanType('  SELF_SERVE_BUSINESS_PROLITE  ')).toBe('business_premium')
        expect(normalizePlanType('self_serve_business_usage_based')).not.toBe('business_premium')
        expect(normalizePlanType('self_serve_business_prolite_future')).not.toBe('business_premium')
        expect(vendorSectionSource).toContain("const translated = t(`codex_quota.plan_${normalized}`")
        expect(vendorSectionSource).toContain('formatPlanLabel(displayedQuotaPlanType, t, planLabelProvider)')
        for (const locale of ['en', 'ru', 'zh-CN', 'zh-TW']) {
            const messages = JSON.parse(readFileSync(new URL(`../src/i18n/locales/${locale}.json`, import.meta.url), 'utf8'))
            expect(messages.codex_quota.plan_prolite).toBe('Pro 100')
            expect(messages.codex_quota.plan_pro).toBe('Pro 200')
            expect(messages.codex_quota.plan_business_premium).toContain('Business Premium')
        }
    })

    test('shows known xAI prepaid balance in the credential metadata', () => {
        expect(credentialQuotaHookSource).toContain('prepaidBalance: billing && billing.prepaidBalance !== null')
        expect(vendorSectionSource).toContain("quotaKey.startsWith('xai::') && quotaPrepaidBalance")
        expect(vendorSectionSource).toContain("id: 'xai-prepaid-balance'")
        expect(vendorSectionSource).toContain("label: t('xai_quota.prepaid')")
        expect(vendorSectionSource).toContain('value: quotaPrepaidBalance')
        for (const locale of ['en', 'ru', 'zh-CN', 'zh-TW']) {
            const messages = JSON.parse(readFileSync(new URL(`../src/i18n/locales/${locale}.json`, import.meta.url), 'utf8'))
            expect(messages.xai_quota.prepaid).toBeTruthy()
        }
    })

    test('scopes reset progress to its card and blocks resets during sign-in renewal', () => {
        const file = {name: 'shared.json', disabled: false}
        const tokenRefreshRequest = {generation: 7, target: {name: file.name, auth_index: 'codex-a'}}
        for (const [authIndex, resetting] of [['codex-a', true], ['codex-b', false]] as const) {
            const scope = {file, authIndex, tokenRefreshRequest, authGeneration: 7,
                quotaResetGeneration: resetting ? 7 : null}
            const tokenRefreshBusy = sourceInitializer<boolean>('components/credentials/VendorSection.tsx', 'tokenRefreshBusy', scope)
            const quotaResetting = sourceInitializer<boolean>('components/credentials/VendorSection.tsx', 'quotaResetting', scope)
            expect(tokenRefreshBusy).toBe(true)
            expect(quotaResetting).toBe(resetting)
            const state = sourceInitializer<{isResetting: boolean; onReset: () => void; disabled: boolean; title: string}>(
                'components/credentials/VendorSection.tsx', 'quotaResetState', {
                    ...scope, tokenRefreshBusy, quotaResetting, handleResetQuota: () => {}, t: i18n.getFixedT('en'),
                    resetAvailability: 'available', effectiveQuotaFreshness: 'fresh', codexResetCreditAvailabilityMessage: () => null,
                },
            )
            expect(state.disabled).toBe(true)
            expect(state.isResetting).toBe(resetting)
            const html = renderToStaticMarkup(createElement(CredentialCard, {
                category: 'auth-file', title: file.name, controlLabel: authIndex, quotaResetState: state,
            }))
            expect(html).toContain('disabled=""')
            expect(html.includes('loading-spinner')).toBe(resetting)
        }
    })

    test('wraps long quota metadata instead of forcing the credential card wider', () => {
        const quotaMeta = credentialCardStyles.match(/\.quotaMeta\s*\{([^}]*)\}/)?.[1] ?? ''
        expect(quotaMeta).toContain('white-space: normal')
        expect(quotaMeta).toContain('flex: 0 1 auto')
        expect(quotaMeta).toContain('min-width: 0')
        expect(quotaMeta).toContain('overflow-wrap: anywhere')
    })

    test('formats reset expiry instants with the same effective timezone as logs', () => {
        const originalTimezone = useTimezoneStore.getState().timezone
        const instant          = new Date('2026-09-08T17:34:56Z')
        const locale           = 'en-CA'
        const baseOptions: Intl.DateTimeFormatOptions = {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
        }
        try {
            useTimezoneStore.setState({ timezone: 'UTC' })
            expect(formatDateTime(instant, locale)).toBe(
                instant.toLocaleString(locale, { ...baseOptions, timeZone: 'UTC' }),
            )

            useTimezoneStore.setState({ timezone: 'America/Los_Angeles' })
            expect(formatDateTime(instant, locale)).toBe(
                instant.toLocaleString(locale, { ...baseOptions, timeZone: 'America/Los_Angeles' }),
            )

            useTimezoneStore.setState({ timezone: '' })
            expect(formatDateTime(instant, locale)).toBe(instant.toLocaleString(locale, baseOptions))
        } finally {
            useTimezoneStore.setState({ timezone: originalTimezone })
        }
    })
})
