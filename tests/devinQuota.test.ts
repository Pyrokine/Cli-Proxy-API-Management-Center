import {beforeEach, describe, expect, test} from 'bun:test'
import {authFileMutationQuotaKeys} from '@/components/credentials/credentialsDataLifecycle'
import {buildDevinQuotaItems} from '@/hooks/useCredentialQuota'
import {
    captureQuotaRequestClaim,
    commitQuotaSnapshot,
    useQuotaStore,
} from '@/stores/useQuotaStore'
import type {QuotaCacheMetadata} from '@/types'
import {parseDevinQuotaPayload} from '@/utils/quota/devin'
import {quotaCredentialKey} from '@/utils/quota/credentialKey'

const quotaMetadata = (
    authIndex: string,
    stateRevision: number,
    overrides: Partial<QuotaCacheMetadata> = {},
): QuotaCacheMetadata => ({
    fileName: 'shared.json',
    type: 'devin',
    backendGeneration: 1,
    backendStateRevision: stateRevision,
    status: 'success',
    freshness: 'fresh',
    observedAt: '2026-09-17T00:00:00Z',
    fetchedAt: '2026-09-17T00:00:00Z',
    successfulEmpty: false,
    ...overrides,
    source: authIndex,
})

beforeEach(() => {
    useQuotaStore.getState().clearQuotaCache()
})

describe('Devin quota identity and payload', () => {
    test('uses auth_index only for Devin sibling credentials', () => {
        expect(quotaCredentialKey('devin', 'shared.json', 'auth-a')).toBe('devin::shared.json::auth-a')
        expect(quotaCredentialKey('cognition', 'shared.json', 'auth-b')).toBe('devin::shared.json::auth-b')
        expect(quotaCredentialKey('codex', 'shared.json', 'auth-a')).toBe('codex::shared.json')
    })

    test('invalidates every Devin identity when its backing file is deleted', () => {
        expect(authFileMutationQuotaKeys([
            {name: 'shared.json', provider: 'devin', authIndex: 'auth-a'},
            {name: 'shared.json', provider: 'devin', authIndex: 'auth-b'},
        ], {kind: 'delete', names: ['shared.json']})).toEqual([
            'devin::shared.json::auth-a',
            'devin::shared.json::auth-b',
        ])
    })

    test('keeps same-name auth indexes independent and preserves stale last-known-good data', () => {
        const firstKey  = quotaCredentialKey('devin', 'shared.json', 'auth-a')
        const secondKey = quotaCredentialKey('devin', 'shared.json', 'auth-b')
        const firstClaim = captureQuotaRequestClaim(7)
        expect(commitQuotaSnapshot(firstClaim, 7, {
            key: firstKey,
            metadata: quotaMetadata('auth-a', 1),
            payload: {
                provider: 'devin',
                value: {
                    status: 'success',
                    windows: [
                        {id: 'daily', remainingPercent: 25, resetAtMs: null, periodHours: 24},
                        {id: 'weekly', remainingPercent: null, resetAtMs: null, periodHours: 168},
                    ],
                    planType: 'Pro',
                },
            },
        })).toBe('committed')
        const secondClaim = captureQuotaRequestClaim(7)
        expect(commitQuotaSnapshot(secondClaim, 7, {
            key: secondKey,
            metadata: quotaMetadata('auth-b', 1),
            payload: {
                provider: 'devin',
                value: {
                    status: 'success',
                    windows: [
                        {id: 'daily', remainingPercent: null, resetAtMs: null, periodHours: 24},
                        {id: 'weekly', remainingPercent: 80, resetAtMs: null, periodHours: 168},
                    ],
                    planType: 'Teams',
                },
            },
        })).toBe('committed')

        const failedClaim = captureQuotaRequestClaim(7)
        expect(commitQuotaSnapshot(failedClaim, 7, {
            key: firstKey,
            metadata: quotaMetadata('auth-a', 2, {status: 'error', freshness: 'stale'}),
            failure: 'provider unavailable',
        })).toBe('committed')

        const state = useQuotaStore.getState()
        expect(state.devinQuota[firstKey]?.windows[0]?.remainingPercent).toBe(25)
        expect(state.quotaMetadata[firstKey]).toMatchObject({
            status: 'error',
            freshness: 'stale',
            lastError: 'provider unavailable',
        })
        expect(state.devinQuota[secondKey]?.windows[1]?.remainingPercent).toBe(80)
        expect(state.quotaMetadata[secondKey]).toMatchObject({status: 'success', freshness: 'fresh'})

        expect(buildDevinQuotaItems(state.devinQuota[firstKey]!)).toEqual([
            expect.objectContaining({id: 'devin-daily', percent: 25}),
        ])
        expect(buildDevinQuotaItems(state.devinQuota[secondKey]!)).toEqual([
            expect.objectContaining({id: 'devin-weekly', percent: 80}),
        ])
    })

    test('preserves explicit zero and absent quota windows', () => {
        const parsed = parseDevinQuotaPayload({
            daily_quota_present: true,
            daily_quota_remaining_percent: 0,
            daily_quota_reset_at: '2026-09-17T12:00:00Z',
            weekly_quota_present: false,
            weekly_quota_remaining_percent: 90,
            plan: 'Pro',
            plan_start: '2026-09-01T00:00:00Z',
            plan_end: '2026-10-01T00:00:00Z',
        })

        expect(parsed).toMatchObject({
            status: 'success',
            planType: 'Pro',
            planStart: '2026-09-01T00:00:00Z',
            planEnd: '2026-10-01T00:00:00Z',
            windows: [
                {id: 'daily', remainingPercent: 0, periodHours: 24},
                {id: 'weekly', remainingPercent: null, resetAtMs: null, periodHours: 168},
            ],
        })
        expect(parsed?.windows[0]?.resetAtMs).toBe(Date.parse('2026-09-17T12:00:00Z'))
    })

    test('rejects missing presence and malformed present percentages', () => {
        expect(parseDevinQuotaPayload({daily_quota_present: true, daily_quota_remaining_percent: 50})).toBeNull()
        expect(parseDevinQuotaPayload({
            daily_quota_present: true,
            daily_quota_remaining_percent: 101,
            weekly_quota_present: false,
        })).toBeNull()
    })
})
