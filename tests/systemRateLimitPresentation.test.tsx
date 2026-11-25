import {Sheet, type SheetColumn} from '@/components/common/Sheet'
import {Button} from '@/components/ui/Button'
import {Card} from '@/components/ui/Card'
import '@/i18n'
import {apiClient} from '@/services/api/client'
import {type BannedIPEntry, type RateLimitEventEntry, rateLimitsApi} from '@/services/api/rateLimits'
import {formatDateTime} from '@/utils/format'
import {getErrorMessage} from '@/utils/helpers'
import {redactSensitiveText} from '@/utils/redaction'
import type {AxiosInstance} from 'axios'
import {describe, expect, mock, test} from 'bun:test'
import React, {type ReactElement, type ReactNode} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {compile} from 'sass'
import ts from 'typescript'
import {sourceCallback, sourceExpression, sourceInitializer} from './sourceCallbacks'

const file                           = 'pages/SystemPage.tsx'
const styles                         = new Proxy<Record<string, string>>({}, { get: (_target, key) => String(key) })
const t                              = (key: string) => key
const noop                           = () => {
}
const banned: BannedIPEntry          = {
    ip: '2001:db8::10', banned_until: '2026-11-20T08:00:00Z', ban_remaining_seconds: 100, ban_count: 3,
}
const history: RateLimitEventEntry[] = Array.from({ length: 10003 }, (_, index) => ({
    ip: `2001:db8::${(index + 100).toString(16)}`,
    type: (['ban_started', 'automatic_expiry', 'manual_unban'] as const)[index % 3],
    occurred_at: new Date(Date.parse('2026-11-20T07:00:00Z') - index * 1000).toISOString(),
    banned_until: banned.banned_until, ban_count: index + 1,
}))

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
    if (Array.isArray(node)) {
        return node.flatMap(elements)
    }
    if (!React.isValidElement<Record<string, unknown>>(node)) {
        return []
    }
    return [node, ...elements(node.props.children as ReactNode)]
}

function columns(unban = noop, unbanning: string | null = null) {
    const active = sourceInitializer<SheetColumn<BannedIPEntry>[]>(file, 'bannedIPColumns', {
        React, Button, styles, t, formatDateTime, handleUnban: unban, authGeneration: 1,
        unbanning: unbanning === null ? null : { ip: unbanning, generation: 1 },
    })
    const events = sourceInitializer<SheetColumn<RateLimitEventEntry>[]>(file, 'rateLimitEventColumns', {
        React, styles, t, formatDateTime,
    })
    return { active, events }
}

function rateLimitCard(overrides: Record<string, unknown> = {}) {
    const { active, events } = columns()
    return sourceExpression<ReactElement>(file, (node, tree) => ts.isJsxElement(node) &&
                                                                node.openingElement.tagName.getText(tree) === 'Card' &&
                                                                node.openingElement.getText(tree).includes(
                                                                    't(\'system_info.rate_limit_title\')'), {
                                              React,
                                              Card,
                                              Button,
                                              Sheet,
                                              styles,
                                              t,
                                              redactSensitiveText,
                                              rateLimitLoadState: 'loaded',
                                              rateLimitLoading: false,
                                              rateLimitStale: false,
                                              rateLimitError: '',
                                              rateLimitClientIP: '192.0.2.1',
                                              rateLimitClientSource: 'remote_addr',
                                              rateLimitPersistenceAvailable: true,
                                              bannedIPs: [banned],
                                              rateLimitEvents: history,
                                              bannedIPColumns: active,
                                              rateLimitEventColumns: events,
                                              fetchRateLimitStatus: noop, ...overrides,
                                          })
}

describe('bounded rate limit tables', () => {
    test('separates current bans from historical events and mounts only one page of each', () => {
        const card   = rateLimitCard()
        const sheets = elements(card).filter((element) => element.type === Sheet)
        expect(sheets).toHaveLength(2)
        expect(sheets[0].props.rows).toEqual([banned])
        expect(sheets[1].props.rows).toBe(history)
        for (const sheet of sheets) {
            expect(sheet.props.pagination).toBe(true)
            expect(sheet.props.defaultPageSize).toBe(25)
            expect(sheet.props.pageSizeOptions).toEqual([25, 50, 100])
            expect(sheet.props.scrollClassName).toBe('rateLimitScroll')
        }
        const html   = renderToStaticMarkup(card)
        const active = html.match(/<section[^>]*aria-labelledby="rate-limit-active-title"[\s\S]*?<\/section>/)![0]
        const events = html.match(/<section[^>]*aria-labelledby="rate-limit-history-title"[\s\S]*?<\/section>/)![0]
        expect(active).toContain('system_info.rate_limit_active')
        expect(active).toContain(banned.ip)
        expect(active).toContain(formatDateTime(banned.banned_until))
        expect(active).toContain('system_info.rate_limit_unban')
        expect(events).not.toContain('system_info.rate_limit_unban')
        expect(events).toContain('system_info.rate_limit_event_history')
        expect(events).toContain('system_info.rate_limit_event_ban_started')
        expect(events).toContain('system_info.rate_limit_event_automatic_expiry')
        expect(events).toContain('system_info.rate_limit_event_manual_unban')
        expect(events.match(/<tbody>[\s\S]*?<\/tbody>/)![0].match(/<tr\b/g)).toHaveLength(25)
        expect(events).toContain(history[24].ip)
        expect(events).not.toContain(`>${history[25].ip}<`)
    })

    test('the actual Sheet paging calculation keeps later events accessible with a bounded page size', () => {
        for (const pageSize of [25, 50, 100]) {
            const totalPages = Math.ceil(history.length / pageSize)
            for (const page of [1, 2, totalPages, totalPages + 1]) {
                const currentPage = sourceInitializer<number>('components/common/Sheet.tsx', 'currentPage', {
                    pagination: true, page, totalPages,
                })
                const rows        = sourceInitializer<RateLimitEventEntry[]>(
                    'components/common/Sheet.tsx',
                    'pagedRows',
                    {
                        useMemo: (callback: () => unknown) => callback(),
                        pagination: true,
                        sortedRows: history,
                        currentPage,
                        pageSize,
                    },
                )
                expect(rows.length).toBeLessThanOrEqual(pageSize)
                expect(rows[0]).toBe(history[(Math.min(page, totalPages) - 1) * pageSize])
                if (page >= totalPages) {
                    expect(rows[rows.length - 1]).toBe(history[history.length - 1])
                }
            }
        }
    })

    test('keeps all current-ban fields and disables the selected unban action', () => {
        const unban              = mock()
        const { active, events } = columns(unban, banned.ip)
        expect(active.map((column) => column.key)).toEqual(['ip', 'expires', 'count', 'action'])
        expect(events.map((column) => column.key)).toEqual(['time', 'ip', 'type', 'count'])
        expect(active.find((column) => column.key === 'count')!.cell(banned)).toBe(3)
        const action = active.find((column) => column.key === 'action')!.cell(banned) as ReactElement<{
            disabled: boolean; onClick: () => void;
        }>
        expect(action.props.disabled).toBe(true)
        const available = columns(unban).active.find((column) => column.key === 'action')!.cell(banned) as typeof action
        expect(available.props.disabled).toBe(false)
        available.props.onClick()
        expect(unban).toHaveBeenCalledWith(banned.ip)
    })

    test('retains empty states, persistence diagnostics and redacted refresh failures alongside existing rows', () => {
        const empty = renderToStaticMarkup(rateLimitCard({ bannedIPs: [], rateLimitEvents: [] }))
        expect(empty).toContain('system_info.rate_limit_no_banned')
        expect(empty).toContain('system_info.rate_limit_no_events')
        const diagnostic = 'Synthetic failure api_key=synthetic-secret <timeout>'
        const stale      = renderToStaticMarkup(rateLimitCard({
                                                                  rateLimitStale: true,
                                                                  rateLimitError: diagnostic,
                                                                  rateLimitPersistenceAvailable: false,
                                                              }))
        expect(stale).toContain('role="alert"')
        expect(stale).toContain('system_info.rate_limit_stale')
        expect(stale).toContain('system_info.rate_limit_persistence_unavailable')
        expect(stale).toContain(banned.ip)
        expect(stale).toContain('[REDACTED]')
        expect(stale).not.toContain('synthetic-secret')
        expect(stale).toContain('&lt;timeout&gt;')
        const unavailable = renderToStaticMarkup(rateLimitCard({
                                                                   rateLimitLoadState: 'unavailable',
                                                                   rateLimitError: diagnostic,
                                                               }))
        expect(unavailable).toContain('system_info.rate_limit_unavailable')
        expect(unavailable).not.toContain('<table')
        expect(unavailable).not.toContain('synthetic-secret')
    })

    test('compiled CSS caps table height and keeps long IPs within compact fixed columns', () => {
        const css = compile(new URL('../src/pages/SystemPage.module.scss', import.meta.url).pathname).css
        expect(css).toMatch(/\.rateLimitScroll\s*\{[^}]*max-height: 360px[^}]*overflow: auto/s)
        expect(css).toMatch(/\.rateLimitTable\s*\{[^}]*table-layout: fixed/s)
        expect(css).toMatch(
            /\.rateLimitTable th,\s*\.rateLimitTable td\s*\{[^}]*padding: 8px 12px[^}]*overflow-wrap: anywhere/s)
        expect(css).toMatch(/\.rateLimitTable th\s*\{[^}]*position: sticky[^}]*top: 0[^}]*white-space: normal/s)
        expect(css).toMatch(/\.rateLimitIPColumn\s*\{[^}]*width: 240px/)
    })

    test('extra table width follows the historical count instead of separating it from the event', () => {
        const { active, events } = columns()
        const css                = compile(new URL('../src/pages/SystemPage.module.scss', import.meta.url).pathname).css
        expect(events.map((column) => column.headerClassName)).toEqual([
                                                                           'rateLimitTimeColumn',
                                                                           'rateLimitIPColumn',
                                                                           'rateLimitEventColumn',
                                                                           undefined,
                                                                       ])
        expect(css).toMatch(/\.rateLimitEventColumn\s*\{[^}]*width: 184px/)
        expect(active[2].headerClassName).toBe('rateLimitCountColumn')
        expect(events[3].cell(history[2])).toBe(history[2].ban_count)
    })
})

describe('rate limit action and error preservation', () => {
    for (const [outcome, message, tone] of [
        ['succeeded', 'system_info.rate_limit_unban_success', 'success'],
        ['partial', 'system_info.rate_limit_unban_persistence_pending', 'warning'],
        ['unchanged', 'system_info.rate_limit_already_unbanned', 'info'],
        ['uncertain', 'common.mutation_uncertain', 'warning'],
    ] as const) {
        test(`publishes refreshed unban status and distinguishes ${outcome}`, async () => {
            const instance        = (apiClient as unknown as { instance: AxiosInstance }).instance
            const adapter         = instance.defaults.adapter
            const calls: string[] = []
            const status          = {
                banned_ips: [],
                unban_history: [],
                rate_limit_events: [{ ...history[2], ip: banned.ip }],
            }
            let mutationId: string | undefined
            const result          = () => ({
                mutation_id: mutationId,
                request_id: 'fixture',
                outcome: outcome === 'unchanged' ? 'uncertain' : outcome,
                confirmed_effect: outcome === 'succeeded' || outcome === 'partial',
                audit_available: true,
                effects: outcome === 'succeeded' ? [
                    { kind: 'security.runtime_applied', target: 'security' },
                    { kind: 'security.persisted', target: 'security' },
                ] : outcome === 'partial' ?
                             [{ kind: 'security.runtime_applied', target: 'security' }] : [],
            })
            apiClient.setConfig({ apiBase: 'https://fixture.invalid', sessionToken: '' })
            instance.defaults.adapter = async (config) => {
                const { method, url } = config
                calls.push(`${method} ${url}`)
                if (method === 'delete' && url === '/rate-limit/ban') {
                    mutationId = String(config.headers['X-CPA-Mutation-ID'])
                    expect(JSON.parse(String(config.data))).toEqual({ ip: banned.ip })
                    return {
                        config, status: 200, statusText: 'OK',
                        data: {
                            status: 'ok',
                            unbanned: outcome !== 'unchanged',
                            persistence_pending: outcome === 'partial',
                        },
                        headers: { 'X-CPA-Mutation-Result': JSON.stringify(result()) },
                    }
                }
                if (method === 'get' && (url === '/rate-limit/status' || url === `/mutations/${mutationId}`)) {
                    return {
                        config, status: 200, statusText: 'OK', headers: {},
                        data: url === '/rate-limit/status' ? status : result(),
                    }
                }
                throw new Error(`Unexpected fixture request ${method} ${url}`)
            }
            try {
                let confirmation: { onConfirm: () => Promise<void> } | undefined
                const refresh        = mock()
                const notices        = mock()
                const busy           = mock()
                const authGeneration = apiClient.getAuthGeneration()
                const handleUnban    = sourceCallback<(ip: string) => void>(file, 'handleUnban', {
                    t, rateLimitsApi, fetchRateLimitStatus: refresh, getErrorMessage,
                    apiClient, authGeneration, setUnbanning: busy, showNotification: notices,
                    rateLimitLoaded: { current: true }, setRateLimitStale: noop, setRateLimitLoadState: noop,
                    showConfirmation: (value: typeof confirmation) => {
                        confirmation = value
                    },
                })
                handleUnban(banned.ip)
                expect(calls).toEqual([])
                await confirmation!.onConfirm()
                expect(calls.filter((call) => call.startsWith('delete'))).toEqual(['delete /rate-limit/ban'])
                expect(calls.filter((call) => call === 'get /rate-limit/status')).toHaveLength(1)
                expect(refresh).toHaveBeenCalledWith(status)
                expect(busy.mock.calls).toEqual([[{ ip: banned.ip, generation: authGeneration }], [null]])
                if (outcome === 'uncertain') {
                    expect(notices).toHaveBeenCalledWith(expect.stringContaining(mutationId!), tone)
                } else {
                    expect(notices).toHaveBeenCalledWith(message, tone)
                }
            } finally {
                instance.defaults.adapter = adapter
                apiClient.setConfig({ apiBase: '', sessionToken: '' })
            }
        })
    }

    test('keeps the last result on refresh failure and consumes legacy unban history', async () => {
        const loaded                             = { current: false }
        let currentBans: BannedIPEntry[]         = []
        let currentEvents: RateLimitEventEntry[] = []
        let state                                = ''
        let error                                = ''
        let stale                                = false
        let fail                                 = false
        const fetch                              = sourceCallback<() => Promise<void>>(file, 'fetchRateLimitStatus', {
            t,
            getErrorMessage,
            apiClient,
            authGeneration: apiClient.getAuthGeneration(),
            rateLimitRequest: { current: 0 },
            rateLimitLoaded: loaded,
            notifiedRateLimitEventKeys: { current: new Set<string>() },
            addPersistentNotification: noop,
            showNotification: noop,
            rateLimitsApi: {
                getStatus: async () => {
                    if (fail) {
                        throw new Error('Synthetic status failure')
                    }
                    return {
                        banned_ips: [banned], unban_history: [
                            {
                                ip: banned.ip,
                                unbanned_at: '2026-11-20T07:00:00Z',
                                banned_until: banned.banned_until,
                                ban_count: 3,
                            },
                        ],
                    }
                },
            },
            setRateLimitLoading: noop,
            setRateLimitClientIP: noop,
            setRateLimitClientSource: noop,
            setRateLimitPersistenceAvailable: noop,
            setBannedIPs: (value: BannedIPEntry[]) => {
                currentBans = value
            },
            setRateLimitEvents: (value: RateLimitEventEntry[]) => {
                currentEvents = value
            },
            setRateLimitLoadState: (value: string) => {
                state = value
            },
            setRateLimitError: (value: string) => {
                error = value
            },
            setRateLimitStale: (value: boolean) => {
                stale = value
            },
        })
        await fetch()
        expect(currentBans).toEqual([banned])
        expect(currentEvents).toMatchObject([{ type: 'manual_unban', ip: banned.ip, ban_count: 3 }])
        expect(state).toBe('loaded')
        expect(error).toBe('')
        fail = true
        await fetch()
        expect(state).toBe('loaded')
        expect(stale).toBe(true)
        expect(error).toBe('Synthetic status failure')
        expect(currentBans).toEqual([banned])
        expect(currentEvents).toHaveLength(1)
        loaded.current = false
        await fetch()
        expect(state).toBe('unavailable')
    })
})
