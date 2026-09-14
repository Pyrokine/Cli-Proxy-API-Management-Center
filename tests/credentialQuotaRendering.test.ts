import {useTimezoneStore} from '@/stores/useTimezoneStore'
import {formatDateTime} from '@/utils/format'
import {projectQuotaProgress} from '@/utils/quota/projection'
import {buildResetDisplay} from '@/utils/quota/relativeTime'
import {pickUrgentRecoveryRowId} from '@/utils/quota/resetSchedule'
import {describe, expect, test} from 'bun:test'
import {readFileSync} from 'node:fs'

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
        expect(credentialQuotaHookSource).toContain('lastError: metadata?.lastError')
        expect(credentialQuotaHookSource).toContain('loading: metadata?.status === \'loading\'')
        expect(credentialQuotaHookSource).toContain('freshness: metadata?.freshness')
        expect(credentialQuotaHookSource).toContain('observedAt: metadata?.observedAt')
        expect(credentialCardSource).toContain('{showFreshnessNotice && (')
        expect(credentialCardSource).toContain('{quotaLoading && (')
        expect(credentialCardSource).toContain('{hasQuotaItems ? (')
    })

    test('renders authoritative successful-empty separately from failures and pending state', () => {
        expect(backendQuotaHookSource).toContain(
            'entry.status === \'success\' && entry.successful_empty === true && !hasData',
        )
        expect(backendQuotaHookSource).toContain('clearData: successfulEmpty')
        expect(credentialQuotaHookSource).toContain('successfulEmpty: metadata?.successfulEmpty')
        expect(credentialCardSource).toContain(') : quotaSuccessfulEmpty ? (')
        expect(credentialCardSource).toContain('\'credentials.quota_successful_empty\'')
    })

    test('uses runtime observations and keeps raw provider JSON behind expandable details', () => {
        expect(vendorSectionSource).toContain('parseProviderError(file.runtimeError ?? file.statusMessage)')
        expect(vendorSectionSource).toContain('dateLikeToISOString(file.updatedAt)')
        expect(vendorSectionSource).not.toContain('checkedAt: dateLikeToISOString(file.lastRefresh)')
        expect(vendorSectionSource).toContain('isModelScopedProviderError(providerError)')
        expect(vendorSectionSource).toContain('quotaObservedAtMs < runtimeObservedAtMs')
        expect(vendorSectionSource).toContain('quotaObservationWarning={quotaObservationWarning}')
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
        expect(backendQuotaHookSource).toContain('const terminalTask = await waitForQuotaRefreshTask(initialTask)')
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
