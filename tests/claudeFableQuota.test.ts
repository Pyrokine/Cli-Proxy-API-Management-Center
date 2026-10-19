import {buildClaudeQuotaWindows} from '@/utils/quota/builders'
import {useCredentialQuota} from '@/hooks/useCredentialQuota'
import {useQuotaStore} from '@/stores/useQuotaStore'
import {describe, expect, test} from 'bun:test'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'

const translate = (key: string) => key

describe('Claude Fable quota', () => {
    test('maps the modern scoped Fable limit to a user-visible weekly row', () => {
        const reset   = '2099-07-27T10:00:00.000000+00:00'
        const windows = buildClaudeQuotaWindows({
                                                    limits: [
                                                        {
                                                            kind: 'weekly_scoped',
                                                            percent: 64,
                                                            resets_at: reset,
                                                            is_active: true,
                                                            scope: { model: { display_name: 'Fable 5' } },
                                                        },
                                                    ],
                                                }, translate)

        expect(windows).toHaveLength(1)
        expect(windows[0]).toMatchObject({
                                             id: 'seven-day-fable',
                                             labelKey: 'credentials.quota_window_seven_day_fable',
                                             usedPercent: 64,
                                             resetAtMs: Date.parse(reset),
                                             periodHours: 168,
                                         })
    })

    test('uses the legacy field without exposing its internal name', () => {
        const windows = buildClaudeQuotaWindows({
                                                    iguana_necktie: {
                                                        utilization: 41,
                                                        resets_at: '2099-07-28T10:00:00Z',
                                                    },
                                                }, translate)

        expect(windows[0]?.id).toBe('seven-day-fable')
        expect(windows[0]?.label).toBe('credentials.quota_window_seven_day_fable')
    })

    test('keeps dollar-denominated cloud credits separate from a modern Fable limit', async () => {
        const windows = buildClaudeQuotaWindows({
                                                    iguana_necktie: {
                                                        utilization: 25,
                                                        limit_dollars: 10,
                                                        resets_at: '2099-07-28T10:00:00Z',
                                                    },
                                                    limits: [{
                                                        kind: 'weekly_scoped', percent: 64, is_active: true,
                                                        scope: {model: {display_name: 'Fable 5'}},
                                                    }],
                                                }, translate)
        expect(windows.map(({id, labelKey, periodHours}) => ({id, labelKey, periodHours}))).toEqual([
            {id: 'cloud-session-credits', labelKey: 'claude_quota.cloud_session_credits', periodHours: null},
            {id: 'seven-day-fable', labelKey: 'credentials.quota_window_seven_day_fable', periodHours: 168},
        ])
        for (const locale of ['en', 'ru', 'zh-CN', 'zh-TW']) {
            const messages = JSON.parse(await Bun.file(new URL(`../src/i18n/locales/${locale}.json`, import.meta.url)).text())
            expect(messages.claude_quota.cloud_session_credits).toBeTruthy()
        }
    })

    test('preserves cloud-session credit reset without inventing a remaining percentage', () => {
        const reset = '2099-07-28T10:00:00Z'
        const windows = buildClaudeQuotaWindows({
            iguana_necktie: {utilization: null, limit_dollars: 10, resets_at: reset},
        }, translate)
        expect(windows).toMatchObject([{
            id: 'cloud-session-credits', usedPercent: null, resetAtMs: Date.parse(reset),
        }])

        const original = useQuotaStore.getState().claudeQuota
        const initial = useQuotaStore.getInitialState()
        const initialQuota = initial.claudeQuota
        let items: ReturnType<typeof useCredentialQuota>['items']
        const Probe = () => {
            items = useCredentialQuota('claude', 'sample.json').items
            return null
        }
        try {
            const claudeQuota = {'claude::sample.json': {status: 'success' as const, windows}}
            initial.claudeQuota = claudeQuota
            useQuotaStore.setState({claudeQuota})
            renderToStaticMarkup(createElement(Probe))
            expect(items).toMatchObject([{
                id: 'cloud-session-credits', percent: null, resetAtMs: Date.parse(reset),
            }])
        } finally {
            initial.claudeQuota = initialQuota
            useQuotaStore.setState({claudeQuota: original})
        }
    })
})
