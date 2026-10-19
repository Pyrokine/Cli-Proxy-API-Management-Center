import {describe, expect, test} from 'bun:test'
import {readFileSync} from 'node:fs'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {CredentialCard, type CredentialField} from '@/components/credentials/CredentialCard'
import i18n from '@/i18n'
import type {ClaudeQuotaState, ClaudeResetGrants} from '@/types'
import {buildClaudeQuotaWindows} from '@/utils/quota/builders'
import {parseClaudeResetGrants} from '@/utils/quota/claudeResetGrants'
import {resolveClaudePlanType} from '@/utils/quota/resolvers'
import {MINUTE_CLOCK} from '@/utils/time/sharedClock'
import {sourceCallback} from './sourceCallbacks'

const NOW = Date.parse('2026-10-10T12:00:00Z')
const grant = {
    id: 'fixture', label: 'Fixture grant', resets_total: 4, resets_left: 3,
    starts_at: '2026-10-01T00:00:00Z', ends_at: '2026-11-01T00:00:00Z', usable_now: true,
}
const block = {eligible: true, grants: [grant]}
const mapClaude = sourceCallback<(data: unknown) => ClaudeQuotaState>(
    'components/credentials/hooks/useBackendQuotaRegistration.ts', 'mapClaude', {
        buildClaudeQuotaWindows, resolveClaudePlanType, parseClaudeResetGrants, i18n,
        parseClaudeExtraUsage: () => null,
        invalidQuotaPayload: () => new Error('invalid Claude quota'),
    },
)
const formatDateLike = sourceCallback<(value: string | null, language: string) => string | null>(
    'components/credentials/VendorSection.tsx', 'formatDateLike', {
        parseDateLike: (value: string | null) => value ? new Date(value) : null,
        formatDateTime: (date: Date) => date.toISOString(),
    },
)
const fields = sourceCallback<(status: ClaudeResetGrants, language: string, t: typeof i18n.t, now: number) => CredentialField[]>(
    'components/credentials/VendorSection.tsx', 'buildClaudeResetGrantFields', {formatDateLike},
)

describe('Claude read-only reset grants', () => {
    test('preserves multi-reset balances and rejects secrets from the display projection', () => {
        expect(parseClaudeResetGrants({
            ...block, api_key: 'must-not-propagate', grants: [{...grant, access_token: 'must-not-propagate'}],
            weekly_resets_at: '2026-10-15T00:00:00Z', cooldown_until: '2026-10-10T13:00:00Z',
        })).toEqual({
            state: 'present', eligible: true,
            grants: [{id: 'fixture', label: 'Fixture grant', resetsTotal: 4, resetsLeft: 3,
                startsAt: grant.starts_at, endsAt: grant.ends_at, paused: false, usableNow: true}],
            weeklyResetsAt: '2026-10-15T00:00:00Z', cooldownUntil: '2026-10-10T13:00:00Z',
        })
    })

    test('distinguishes missing data, an empty balance, and an ineligible account', () => {
        expect(parseClaudeResetGrants(undefined)).toEqual({state: 'missing'})
        expect(parseClaudeResetGrants(null)).toEqual({state: 'missing'})
        expect(parseClaudeResetGrants({eligible: true, grants: []})).toMatchObject({
            state: 'present', eligible: true, grants: [],
        })
        expect(parseClaudeResetGrants({eligible: false})).toMatchObject({
            state: 'present', eligible: false, grants: [],
        })
    })

    test('rejects malformed blocks without presenting partial balances', () => {
        for (const value of [
            [], 'invalid', {}, {...block, eligible: 'true'}, {...block, grants: {}},
            {...block, grants: [grant, grant]}, {...block, weekly_resets_at: 'invalid'},
            {...block, cooldown_until: 0},
            ...[
                {id: '../bad'}, {resets_total: -1}, {resets_left: 5}, {resets_left: '3'},
                {resets_left: 1.2}, {resets_total: Infinity}, {resets_total: Number.MAX_SAFE_INTEGER + 1},
                {starts_at: 'invalid'}, {ends_at: true}, {paused: 'false'}, {usable_now: 1},
                {starts_at: '2026-12-01T00:00:00Z'},
            ].map((patch) => ({...block, grants: [{...grant, ...patch}]})),
            {...block, grants: [
                {...grant, resets_total: Number.MAX_SAFE_INTEGER, resets_left: Number.MAX_SAFE_INTEGER},
                {...grant, id: 'second'},
            ]},
        ]) {
            expect(parseClaudeResetGrants(value)).toEqual({state: 'invalid'})
        }
    })

    test('bounds display labels and preserves missing time information', () => {
        const status = parseClaudeResetGrants({eligible: true, grants: [{
            id: 'fixture', label: 'a\u0000b\n' + 'x'.repeat(200), resets_total: 2, resets_left: 1,
        }]})
        expect(status).toMatchObject({state: 'present', grants: [{
            label: ('a b ' + 'x'.repeat(200)).slice(0, 120), startsAt: null, endsAt: null, usableNow: false,
        }]})
    })

    test('consumes the backend usage envelope and retains valid windows when grant data is invalid', () => {
        const mapped = mapClaude({usage: {five_hour: {utilization: 40}, cedar_ember: block}})
        expect(mapped.resetGrants).toEqual(parseClaudeResetGrants(block))
        expect(mapped.windows[0]).toMatchObject({usedPercent: 40})
        expect(mapClaude({usage: {five_hour: {utilization: 40}, cedar_ember: {}}})).toMatchObject({
            status: 'success', resetGrants: {state: 'invalid'},
        })
        expect(mapClaude({usage: JSON.stringify({cedar_ember: block})})).toMatchObject({
            status: 'success', windows: [], resetGrants: {state: 'present'},
        })
    })

    test('renders translated counts, expiry, eligibility and unavailable states without a spend action', async () => {
        const originalLanguage = i18n.language
        try {
            for (const language of ['en', 'ru', 'zh-CN', 'zh-TW']) {
                await i18n.changeLanguage(language)
                const status = parseClaudeResetGrants({
                    ...block, eligible: false, grants: [{...grant, label: '<script>fixture</script>', paused: true}],
                    weekly_resets_at: '2026-10-15T00:00:00Z', cooldown_until: '2026-10-10T13:00:00Z',
                })
                const displayed = fields(status, language, i18n.t.bind(i18n), NOW)
                const markup = renderToStaticMarkup(createElement(CredentialCard, {
                    category: 'auth-file', title: 'Claude fixture', controlLabel: 'Claude fixture-index',
                    fields: displayed, disableControls: true,
                }))
                expect(displayed.find((field) => field.id === 'claude-reset-grants')?.value).toBe('3')
                expect(markup).toContain(i18n.t('claude_quota.reset_grant_count', {left: 3, total: 4}))
                expect(markup).toContain(i18n.t('claude_quota.reset_grants_ineligible'))
                expect(markup).toContain(i18n.t('claude_quota.reset_grant_paused'))
                expect(markup).toContain('2026-11-01T00:00:00.000Z')
                expect(markup).toContain('data-field-id="claude-reset-weekly"')
                expect(markup).toContain('data-field-id="claude-reset-cooldown"')
                expect(markup).not.toContain('<script>')
                expect(markup).not.toContain('must-not-propagate')
                expect(displayed.some((field) => field.id === 'claude-reset-grant-fixture' && field.wrap)).toBe(true)
                for (const state of ['missing', 'invalid'] as const) {
                    expect(fields({state}, language, i18n.t.bind(i18n), NOW)[0]?.value).toBe(
                        i18n.t(state === 'invalid' ? 'codex_quota.reset_credits_count_invalid' :
                            'codex_quota.reset_credits_count_missing'),
                    )
                }
            }
        } finally {
            await i18n.changeLanguage(originalLanguage)
        }
    })

    test('marks expired grants and unknown expiries without inventing availability', () => {
        const t = i18n.getFixedT('en')
        const expired = fields(parseClaudeResetGrants(block), 'en', t, Date.parse('2026-12-01T00:00:00Z'))
        expect(String(expired[1]?.value)).toContain('Expired on')
        const unknown = fields(parseClaudeResetGrants({eligible: true, grants: [{
            id: 'fixture', resets_total: 4, resets_left: 0,
        }]}), 'en', t, NOW)
        expect(String(unknown[1]?.value)).toContain('Expiry time not returned')
        expect(String(unknown[1]?.value)).toContain('Currently unavailable')
    })

    test('orders grants by expiry without changing the input and keeps unknown dates last', () => {
        const status = parseClaudeResetGrants({eligible: true, grants: [
            {...grant, id: 'unknown', label: 'Unknown', ends_at: null},
            {...grant, id: 'later', label: 'Later', ends_at: '2026-11-02T00:00:00Z'},
            {...grant, id: 'first', label: 'First'},
        ]})
        if (status.state !== 'present') {
            throw new Error('Invalid grant fixture')
        }
        const displayed = fields(status, 'en', i18n.getFixedT('en'), NOW)
        expect(displayed.slice(1).map((field) => field.id)).toEqual([
            'claude-reset-grant-first', 'claude-reset-grant-later', 'claude-reset-grant-unknown',
        ])
        expect(status.grants.map((item) => item.id)).toEqual(['unknown', 'later', 'first'])
        expect(displayed.find((field) => field.id === 'claude-reset-grant-unknown')?.value).toContain('Expiry time not returned')
    })

    test('renders grant expiry relative to the current shared clock', async () => {
        const originalLanguage = i18n.language
        const getSnapshot = MINUTE_CLOCK.getSnapshot
        try {
            await i18n.changeLanguage('en')
            const endsAt = NOW + 11 * 86_400_000
            const status = parseClaudeResetGrants({...block, grants: [
                {...grant, ends_at: new Date(endsAt).toISOString()},
            ]})
            const displayed = fields(status, 'en', i18n.t.bind(i18n), NOW)
            expect(displayed[1]).toMatchObject({expiresAtMs: endsAt})
            const render = () => renderToStaticMarkup(createElement(CredentialCard, {
                category: 'auth-file', title: 'Claude fixture', controlLabel: 'Claude fixture-index',
                fields: displayed, disableControls: true,
            }))
            MINUTE_CLOCK.getSnapshot = () => NOW
            expect(render()).toContain('in 11 days')
            MINUTE_CLOCK.getSnapshot = () => NOW + 86_400_000
            expect(render()).toContain('in 10 days')
        } finally {
            MINUTE_CLOCK.getSnapshot = getSnapshot
            await i18n.changeLanguage(originalLanguage)
        }
    })

    test('connects parsed grants to the quota store and the shared credential card', () => {
        const hook = readFileSync(new URL('../src/hooks/useCredentialQuota.ts', import.meta.url), 'utf8')
        const vendor = readFileSync(new URL('../src/components/credentials/VendorSection.tsx', import.meta.url), 'utf8')
        expect(hook).toContain('claudeResetGrants: claude.resetGrants')
        expect(vendor).toContain('claudeResetGrants: quotaClaudeResetGrants')
        expect(vendor).toContain('fields.push(...buildClaudeResetGrantFields(quotaClaudeResetGrants, i18n.language, t))')
        expect(vendor).toContain("!isPluginQuota && quotaProvider.toLowerCase() === 'claude'")
        expect(vendor).not.toContain('claimClaudeResetGrant')
        expect(vendor).not.toContain('reset_rate_limits')
    })
})
