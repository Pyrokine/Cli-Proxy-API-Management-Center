import {Card} from '@/components/ui/Card'
import {CostRecalculationCard} from '@/components/usage/CostRecalculationCard'
import {MaintenanceTaskTimes} from '@/components/usage/MaintenanceTaskTimes'
import {SettingsTab} from '@/components/usage/SettingsTab'
import {UsageStorageUpgradeCard} from '@/components/usage/UsageStorageUpgradeCard'
import i18n from '@/i18n'
import type {CostRecalculationStatus} from '@/services/api/modelPrices'
import type {UsageStorageUpgradeStatus} from '@/services/api/usage'
import {formatDateTime} from '@/utils/format'
import {formatDurationMs, formatUsd} from '@/utils/usage'
import {describe, expect, test} from 'bun:test'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {sourceCallback, sourceInitializer} from './sourceCallbacks'

const costFile                           = 'components/usage/CostRecalculationCard.tsx'
const upgradeFile                        = 'components/usage/UsageStorageUpgradeCard.tsx'
const timeFile                           = 'components/usage/MaintenanceTaskTimes.tsx'
const startedAt                          = '2026-11-19T10:00:00Z'
const completedAt                        = '2026-11-19T11:02:03Z'
const completed: CostRecalculationStatus = {
    status: 'ok', running: false, percent: 100, processed_events: 1787583, total_events: 1787583,
    started_at: startedAt, completed_at: completedAt, total_cost: 15, recalculated_days: 3, resumed: true,
}

function pollingHarness<T extends CostRecalculationStatus | UsageStorageUpgradeStatus>(file: string) {
    const replies: Array<T | Error | Promise<T>> = []
    const requests: AbortSignal[]                = []
    const timers                                 = new Map<number, { callback: () => void; delay: number }>()
    const state                                  = { status: null as T | null, error: '', loading: true }
    let timerID                                  = 0
    const load                                   = async ({ signal }: { signal: AbortSignal }) => {
        requests.push(signal)
        const reply = replies.shift()
        if (reply instanceof Error) {
            throw reply
        }
        if (!reply) {
            throw new Error('Unexpected status request')
        }
        return reply
    }
    const effect                                 = sourceCallback<() => () => void>(file, 'useEffect', {
        AbortController,
        usageApi: { getStorageUpgradeStatus: load },
        modelPricesApi: { getRecalculationStatus: load },
        setStatus: (status: T) => {
            state.status = status
        },
        setRequestError: (error: string) => {
            state.error = error
        },
        setLoading: (loading: boolean) => {
            state.loading = loading
        },
        t: i18n.t.bind(i18n),
        setTimeout: (callback: () => void, delay: number) => {
            const id = ++timerID
            timers.set(id, { callback, delay })
            return id
        },
        clearTimeout: (id: number) => {
            timers.delete(id)
        },
    })
    const flush                                  = async () => {
        for (let index = 0; index < 8; ++index) {
            await Promise.resolve()
        }
    }
    const advance                                = async () => {
        const next = [...timers][0]
        expect(next).toBeDefined()
        timers.delete(next[0])
        next[1].callback()
        await flush()
    }
    return { replies, requests, timers, state, effect, flush, advance }
}

function renderStatus(
    file: string, status: CostRecalculationStatus | UsageStorageUpgradeStatus | null,
    error = '', loading = false, embedded = false,
): string {
    let stateIndex    = 0
    const stateValues = file === costFile ? [status, loading, false, error, 0] : [status, loading, error]
    const View        = sourceCallback<React.ComponentType<{ embedded?: boolean }>>(
        file,
        file === costFile ?
        'CostRecalculationCard' :
        'UsageStorageUpgradeCard', {
            React,
            Card,
            MaintenanceTaskTimes,
            Button: ({ children }: React.PropsWithChildren) => <button>{children}</button>,
            useTranslation: () => ({
                t: i18n.t.bind(i18n), i18n,
            }),
            useState: () => [
                stateValues[stateIndex++],
                () => undefined,
            ],
            useEffect: () => undefined,
            styles: {},
            formatUsd,
            formatNumber: (
                value: number,
                locale: string,
            ) => value.toLocaleString(locale),
            progressValue: sourceCallback(
                costFile,
                'progressValue',
                {},
            ),
            phaseLabel: sourceCallback(
                costFile,
                'phaseLabel',
                {},
            ),
        },
    )
    return renderToStaticMarkup(<View embedded={embedded} />)
}

function renderTimes(
    running: boolean, start = startedAt, end?: string,
    now                     = Date.parse('2026-11-19T12:00:00Z'),
) {
    const subscribe                = () => () => undefined
    const subscriptions: unknown[] = []
    const Times                    = sourceCallback<typeof MaintenanceTaskTimes>(timeFile, 'MaintenanceTaskTimes', {
        React, styles: {}, formatDateTime, formatDurationMs,
        useTranslation: () => ({ t: i18n.t.bind(i18n), i18n }),
        SECOND_CLOCK: { subscribe, getSnapshot: () => now, getServerSnapshot: () => now },
        stoppedClockSubscription: () => () => undefined,
        useSyncExternalStore: (listener: unknown, getSnapshot: () => number) => {
            subscriptions.push(listener)
            return getSnapshot()
        },
    })
    return {
        markup: renderToStaticMarkup(<Times running={running} startedAt={start} completedAt={end} />),
        usesClock: subscriptions[0] === subscribe,
    }
}

describe('usage maintenance progress', () => {
    test('settings groups both independent tasks in one maintenance card', () => {
        const Settings = sourceCallback<typeof SettingsTab>('components/usage/SettingsTab.tsx', 'SettingsTab', {
            React, Card, UsageStorageUpgradeCard, CostRecalculationCard,
            UsageRetentionCard: () => null,
            useTranslation: () => ({ t: i18n.t.bind(i18n) }),
        })
        const children = React.Children.toArray(Settings().props.children) as React.ReactElement[]
        expect(children[0].type).toBe(Card)
        const tasks = React.Children.toArray((children[0].props as React.PropsWithChildren).children) as React.ReactElement<{
            embedded: boolean
        }>[]
        expect(tasks[0].type).toBe(UsageStorageUpgradeCard)
        expect(tasks[1].type).toBe(CostRecalculationCard)
        expect(tasks.every((task) => task.props.embedded)).toBe(true)
    })

    test('embedded tasks retain their own result and times without nested cards', () => {
        const cost    = renderStatus(costFile, completed, '', false, true)
        const upgrade = renderStatus(upgradeFile, {
            status: 'complete', running: false, percent: 100, processed_events: 10, total_events: 10,
            started_at: startedAt, completed_at: completedAt,
        }, '', false, true)
        for (const markup of [cost, upgrade]) {
            expect(markup).toContain('<section')
            expect(markup).not.toContain('class="card')
            expect(markup).toContain(`dateTime="${startedAt}"`)
            expect(markup).toContain(`dateTime="${completedAt}"`)
        }
        expect(cost).toContain(i18n.t('usage_stats.recalculate_latest_task'))
        expect(upgrade).toContain(i18n.t('usage_stats.storage_upgrade_complete'))
    })

    test('embedded tasks keep progress and times without nested cards', () => {
        for (const [file, status] of [
            [costFile, completed], [
                upgradeFile, {
                    status: 'complete', running: false, percent: 100,
                } satisfies UsageStorageUpgradeStatus,
            ],
        ] as const) {
            const embedded = renderStatus(file, status, '', false, true)
            expect(embedded).toContain('<section')
            expect(embedded).not.toContain('class="card"')
            expect(embedded).toContain(i18n.t('usage_stats.maintenance_started_at'))
            expect(embedded).toContain('aria-valuenow="100"')
            const standalone = renderStatus(file, status)
            expect(standalone).toContain('class="card"')
        }
    })

    test('storage status API is a read-only management GET with cancellation', async () => {
        const requests: unknown[][]             = []
        const status: UsageStorageUpgradeStatus = { status: 'running', running: true }
        const api                               = sourceInitializer<{
            getStorageUpgradeStatus: (options?: { signal: AbortSignal }) => Promise<unknown>
        }>(
            'services/api/usage.ts', 'usageApi', {
                apiClient: {
                    get: async (...args: unknown[]) => {
                        requests.push(args);
                        return status
                    },
                },
            })
        const controller                        = new AbortController()
        expect(await api.getStorageUpgradeStatus({ signal: controller.signal })).toBe(status)
        expect(requests).toEqual([['/usage/storage-upgrade', { signal: controller.signal }]])
    })

    for (const [file, done] of [
        [costFile, completed], [
            upgradeFile, {
                status: 'complete', running: false, percent: 100,
            } satisfies UsageStorageUpgradeStatus,
        ],
    ] as const) {
        test(`${file} observes externally started work after completion and recovers after read failure`, async () => {
            const poll = pollingHarness(file)
            poll.replies.push(done)
            const cleanup = poll.effect()
            await poll.flush()
            expect(poll.state.status).toBe(done)
            expect([...poll.timers.values()][0].delay).toBe(5000)
            poll.replies.push({ ...done, status: 'running', running: true, percent: 25 })
            await poll.advance()
            expect(poll.state.status?.running).toBe(true)
            expect([...poll.timers.values()][0].delay).toBe(1500)
            poll.replies.push(new Error('synthetic offline'))
            await poll.advance()
            expect(poll.state.error).toContain('synthetic offline')
            expect(poll.state.status?.percent).toBe(25)
            poll.replies.push(done)
            await poll.advance()
            expect(poll.state.error).toBe('')
            expect(poll.state.status).toBe(done)
            expect([...poll.timers.values()][0].delay).toBe(5000)
            cleanup()
            expect(poll.timers.size).toBe(0)
            expect(poll.requests.every((signal) => signal.aborted)).toBe(true)
        })

        test(`${file} ignores a response after leaving the page`, async () => {
            const poll = pollingHarness(file)
            let resolve!: (status: typeof done) => void
            poll.replies.push(new Promise((fulfill) => {
                resolve = fulfill
            }))
            const cleanup = poll.effect()
            expect(poll.requests).toHaveLength(1)
            cleanup()
            resolve(done)
            await poll.flush()
            expect(poll.state.status).toBeNull()
            expect(poll.state.loading).toBe(true)
            expect(poll.timers.size).toBe(0)
            expect(poll.requests[0].aborted).toBe(true)
        })
    }

    test('idle cards continue observing and unsupported upgrades stay explicit', async () => {
        for (const file of [costFile, upgradeFile]) {
            const poll = pollingHarness(file)
            poll.replies.push({ status: 'idle', running: false })
            const cleanup = poll.effect()
            await poll.flush()
            expect(poll.timers.size).toBe(1)
            cleanup()
        }
        for (const status of [404, 405, 501]) {
            const poll = pollingHarness(upgradeFile)
            poll.replies.push(Object.assign(new Error('synthetic unsupported'), { status }))
            const cleanup = poll.effect()
            await poll.flush()
            expect(poll.state.error).toBe(i18n.t('usage_stats.storage_upgrade_unsupported', { status }))
            expect(poll.timers.size).toBe(1)
            cleanup()
        }
    })

    test('current and historical cost results remain visible alongside progress errors', () => {
        const history = renderStatus(costFile, completed, 'synthetic read failure')
        expect(history).toContain('role="alert"')
        expect(history).toContain('synthetic read failure')
        expect(history).toContain(i18n.t('usage_stats.recalculate_latest_task'))
        expect(history).toContain(i18n.t('usage_stats.recalculate_complete'))
        expect(history).toContain('1787583')
        expect(history).toContain(i18n.t('usage_stats.recalculate_success', { days: 3, cost: formatUsd(15) }))
        const current = renderStatus(costFile, { ...completed, status: 'running', running: true, percent: 25 })
        expect(current).toContain(i18n.t('usage_stats.recalculate_current_task'))
        expect(current).not.toContain(i18n.t('usage_stats.recalculate_latest_task'))
        expect(current).toContain('aria-valuenow="25"')
        expect(current).toContain(i18n.t('usage_stats.maintenance_elapsed'))
    })

    test('upgrade card renders its own progress, failure, and unknown counters', () => {
        const running = renderStatus(upgradeFile, {
            status: 'running', running: true, percent: 40, processed_events: 400, total_events: 1000,
        })
        expect(running).toContain(i18n.t('usage_stats.storage_upgrade_running'))
        expect(running).toContain('aria-valuenow="40"')
        expect(running).not.toContain(i18n.t('usage_stats.recalculate_title'))
        const failed = renderStatus(upgradeFile, { status: 'error', running: false, error: 'synthetic task error' })
        expect(failed).toContain('synthetic task error')
        expect(failed).toContain(i18n.t('usage_stats.storage_upgrade_error'))
        expect(failed).toContain(i18n.t('usage_stats.request_events_not_recorded'))
        expect(failed).not.toContain('role="progressbar"')
        const unsupported = renderStatus(upgradeFile, null, 'synthetic unsupported')
        expect(unsupported).toContain('role="alert"')
        expect(unsupported).toContain('synthetic unsupported')
    })

    test('running duration advances; completed duration uses only completion and stops the shared clock', () => {
        const first = renderTimes(true, startedAt, undefined, Date.parse(startedAt) + 10_000)
        const later = renderTimes(true, startedAt, undefined, Date.parse(startedAt) + 15_000)
        expect(first.markup).toContain('10s')
        expect(later.markup).toContain('15s')
        expect(first.usesClock).toBe(true)
        const done = renderTimes(false, startedAt, completedAt)
        expect(done.markup).toContain('1h 2m 3s')
        expect(done.markup).toContain(`dateTime="${completedAt}"`)
        expect(done.usesClock).toBe(false)
        expect(renderTimes(false, startedAt, completedAt, Date.parse(completedAt) + 86400_000).markup).toBe(done.markup)
    })

    test('missing invalid or reversed times stay unrecorded without using updated_at', () => {
        const unrecorded = i18n.t('usage_stats.request_events_not_recorded')
        for (const [start, end] of [
            ['', ''], ['invalid', 'invalid'], [startedAt, undefined], [startedAt, '2026-11-19T09:00:00Z'],
        ]) {
            const result = renderTimes(false, start, end)
            expect(result.markup).toContain(unrecorded)
            expect(result.usesClock).toBe(false)
            expect(result.markup).not.toContain('NaN')
        }
        const legacy = renderStatus(costFile, {
            ...completed, completed_at: undefined, updated_at: completedAt,
        })
        expect(legacy).not.toContain(`dateTime="${completedAt}"`)
        expect(legacy).toContain(unrecorded)
        expect(renderTimes(true, 'invalid').usesClock).toBe(false)
    })

    test('all maintenance states and timing labels are translated in every locale', async () => {
        const original = i18n.language
        const keys     = [
            'maintenance_title',
            'recalculate_current_task',
            'recalculate_latest_task',
            'maintenance_started_at',
            'maintenance_completed_at',
            'maintenance_elapsed',
            'maintenance_total_duration',
            'maintenance_status_failed',
            'storage_upgrade_title',
            'storage_upgrade_idle',
            'storage_upgrade_running',
            'storage_upgrade_complete',
            'storage_upgrade_error',
            'storage_upgrade_events',
            'storage_upgrade_unsupported',
        ]
        try {
            for (const language of ['en', 'ru', 'zh-CN', 'zh-TW']) {
                await i18n.changeLanguage(language)
                for (const key of keys) {
                    expect(i18n.exists(`usage_stats.${key}`, { lng: language })).toBe(true)
                    expect(i18n.t(`usage_stats.${key}`)).not.toBe(`usage_stats.${key}`)
                }
                const result = renderTimes(false, startedAt, completedAt)
                expect(result.markup).toContain(formatDateTime(startedAt, language))
                expect(result.markup).toContain(formatDateTime(completedAt, language))
            }
        } finally {
            await i18n.changeLanguage(original)
        }
    })
})
