import {buildProviderHealthRows} from '@/components/credentials/providerHealth'
import type {AccountInspectionSchedule} from '@/services/api/accountInspection'
import {apiClient} from '@/services/api/client'
import {quotaApi, type QuotaRefreshTask} from '@/services/api/quota'
import {expect, spyOn, test} from 'bun:test'
import React, {type ReactElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import ts from 'typescript'
import {sourceCallback, sourceExpression, sourceInitializer} from './sourceCallbacks'

const panel       = 'components/credentials/AccountInspectionPanel.tsx'
const t           = (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key
const passthrough = <T, >(value: T) => value
const noop        = () => undefined

type ReadState = { error: string; loading: boolean; scope?: string }
type Read = <T>(section: string, get: () => Promise<T>, apply: (value: T) => void, scope?: string) => Promise<void>

function panelReads() {
    const readOwners                     = { current: new Map<string, symbol>() }
    let reads: Record<string, ReadState> = {}
    let generation                       = 1
    const read                           = sourceCallback<Read>(panel, 'read', {
        authGeneration: 1,
        apiClient: { getAuthGeneration: () => generation },
        readOwners,
        setDataGeneration: noop,
        setReads: (apply: (state: typeof reads) => typeof reads) => {
            reads = apply(reads)
        },
        t,
    })
    return {
        read, readOwners, state: () => reads, disconnect: () => {
            generation++
        },
    }
}

function deferred<T>() {
    let resolve!: (value: T) => void
    let reject!: (error: Error) => void
    const promise = new Promise<T>((accept, fail) => {
        resolve = accept
        reject  = fail
    })
    return { promise, resolve, reject }
}

const savedSchedule: AccountInspectionSchedule = {
    enabled: false, interval_seconds: 3600, providers: ['codex'], max_concurrency: 4, timeout_seconds: 30,
    retention_runs: 20,
}
const scheduleDraftFrom                        = sourceCallback<(schedule: AccountInspectionSchedule) => {
    intervalSeconds: string; maxConcurrency: string; timeoutSeconds: string; retentionRuns: string
}>(panel, 'scheduleDraftFrom', {})

function resultFetcher(read: Read, getResults: (query: { page: number }) => Promise<unknown>) {
    let result: { scope: string; rows: { id: string }[]; total: number } | undefined
    const query = { current: { page: 1 } }
    const fetch = sourceCallback<() => Promise<void>>(panel, 'fetchResults', {
        resultsQueryRef: query,
        accountInspectionApi: { getResults },
        read,
        setPage: noop,
        setResultSnapshot: (snapshot: typeof result) => {
            result = snapshot
        },
    })
    return { fetch, query, result: () => result }
}

test('a slow or failed quota configuration read does not hide inspection status, results or logs', async () => {
    const { read, state }  = panelReads()
    const quotaConfig      = deferred<unknown>()
    const results          = resultFetcher(read, async () => ({ results: [{ id: 'account-a' }], total: 1 }))
    const status           = { schedule: savedSchedule }
    let shownStatus: unknown
    let shownLogs: unknown
    const fetchStatus      = sourceCallback<() => Promise<void>>(panel, 'fetchStatus', {
        read,
        accountInspectionApi: { getStatus: async () => status },
        normalizeStatusResponse: passthrough,
        setStatus: (value: unknown) => {
            shownStatus = value
        },
        scheduleDraftDirty: { current: true },
        setInspectionScheduleLoaded: noop,
    })
    let logsFailed         = false
    const fetchLogs        = sourceCallback<() => Promise<void>>(panel, 'fetchLogs', {
        read,
        accountInspectionApi: {
            getLogs: async () => {
                if (logsFailed) {
                    throw new Error('logs unavailable')
                }
                return { logs: [{ message: 'finished' }] }
            },
        },
        setLogs: (value: unknown) => {
            shownLogs = value
        },
    })
    const fetchQuotaConfig = sourceCallback<() => Promise<void>>(panel, 'fetchQuotaConfig', {
        read, quotaApi: { getConfig: () => quotaConfig.promise },
    })
    const fetchOverview    = sourceCallback<() => Promise<void>>(panel, 'fetchOverview', {
        fetchStatus, fetchLogs, fetchQuotaConfig, fetchQuotaStatus: noop, fetchUsage: noop, fetchAuthFiles: noop,
    })
    const fetchData        = sourceCallback<() => Promise<void>>(panel, 'fetchData', {
        fetchOverview, fetchResults: results.fetch,
    })
    const request          = fetchData()
    await Promise.resolve()
    expect(shownStatus).toEqual(status)
    expect(results.result()?.rows).toEqual([{ id: 'account-a' }])
    expect(shownLogs).toEqual([{ message: 'finished' }])
    expect(state().quotaConfig.loading).toBe(true)
    expect(sourceInitializer<boolean>(panel, 'loading', { reads: state() })).toBe(false)
    quotaConfig.reject(new Error('quota configuration down'))
    await request
    expect(state().quotaConfig.error).toBe('quota configuration down')
    expect(state().results.error).toBe('')
    expect(state().logs.error).toBe('')

    logsFailed = true
    await fetchLogs()
    expect(state().logs.error).toBe('logs unavailable')
    expect(shownLogs).toEqual([{ message: 'finished' }])
    const sheetDataStatus = sourceCallback<(hasRows: boolean, read: ReadState) => string>(panel, 'sheetDataStatus', {})
    expect(sheetDataStatus(true, state().logs)).toBe('ready')
    expect(sheetDataStatus(false, state().logs)).toBe('error')
    const renderReadError = sourceInitializer<(read: ReadState, retry: () => void) => ReactElement>(
        panel, 'renderReadError', { React, t, styles: {}, Button: () => null },
    )
    const html            = renderToStaticMarkup(renderReadError(state().logs, fetchLogs))
    expect(html).toContain('role="alert"')
    expect(html).toContain('logs unavailable')
})

test('the latest inspection query owns rows, errors and total across delayed responses', async () => {
    const { read, state, disconnect } = panelReads()
    const old                         = deferred<unknown>()
    const current                     = deferred<unknown>()
    const pending                     = deferred<unknown>()
    const results                     = resultFetcher(read, ({ page }) => [old, current, pending][page - 1].promise)
    const first                       = results.fetch()
    results.query.current             = { page: 2 }
    const second                      = results.fetch()
    current.resolve({ results: [{ id: 'page-two' }], total: 41 })
    await second
    old.resolve({ results: [{ id: 'page-one' }], total: 25 })
    await first
    expect(results.result()).toEqual({ scope: '{"page":2}', rows: [{ id: 'page-two' }], total: 41 })
    expect(state().results).toEqual({ scope: '{"page":2}', loading: false, error: '' })

    results.query.current = { page: 3 }
    const third           = results.fetch()
    disconnect()
    pending.reject(new Error('old connection'))
    await third
    expect(state().results.error).toBe('')
    expect(results.result()?.rows).toEqual([{ id: 'page-two' }])
})

test(
    'polling and a failed save keep the draft, and the schedule toggle changes only the saved enable flag',
    async () => {
        const { read, readOwners }                        = panelReads()
        let draft                                         = scheduleDraftFrom(savedSchedule)
        let invalid: string[]                             = []
        let schedule                                      = savedSchedule
        let status                                        = { schedule }
        const scheduleDraftDirty                          = { current: false }
        const setScheduleDraft                            = (next: typeof draft | ((prev: typeof draft) => typeof draft)) => {
            draft = typeof next === 'function' ? next(draft) : next
        }
        const setInvalidScheduleFields                    = (next: string[] | ((prev: string[]) => string[])) => {
            invalid = typeof next === 'function' ? next(invalid) : next
        }
        const edit                                        = sourceInitializer<(field: string, value: string) => void>(
            panel,
            'updateScheduleDraft',
            {
                scheduleDraftDirty,
                setScheduleDraft,
                setInvalidScheduleFields,
            },
        )
        const scheduleWrites: AccountInspectionSchedule[] = []
        const notifications: string[]                     = []
        let fail                                          = false
        const accountInspectionApi                        = {
            getStatus: async () => ({ schedule }),
            updateSchedule: async (value: AccountInspectionSchedule) => {
                scheduleWrites.push(value)
                if (fail) {
                    throw new Error('schedule write unavailable')
                }
                schedule = value
                return schedule
            },
        }
        const setStatus                                   = (next: typeof status | ((prev: typeof status) => typeof status)) => {
            status = typeof next === 'function' ? next(status) : next
        }
        const fetch                                       = sourceCallback<() => Promise<void>>(panel, 'fetchStatus', {
            read, accountInspectionApi, normalizeStatusResponse: passthrough, scheduleDraftDirty, setScheduleDraft,
            setStatus, setInspectionScheduleLoaded: noop, scheduleDraftFrom,
        })
        const inspectionScheduleFields                    = sourceInitializer(panel, 'inspectionScheduleFields', {})
        const save                                        = (enabled?: boolean) => sourceInitializer<(enabled?: boolean) => Promise<void>>(
            panel,
            'saveInspectionSchedule',
            {
                inspectionScheduleLoaded: true,
                status,
                scheduleDraft: draft,
                inspectionScheduleFields,
                setInvalidScheduleFields,
                accountInspectionApi,
                normalizeSchedule: passthrough,
                readOwners,
                setStatus,
                scheduleDraftDirty,
                setScheduleDraft,
                scheduleDraftFrom,
                showNotification: (message: string) => notifications.push(message),
                t,
                runAction: async (
                    _action: string,
                    apply: (isCurrent: () => boolean) => Promise<void>,
                ) => {
                    try {
                        await apply(() => true)
                    } finally {
                        await fetch()
                    }
                },
            },
        )(
            enabled)

        edit('intervalSeconds', '7200')
        await fetch()
        expect(draft.intervalSeconds).toBe('7200')
        for (const value of ['1.5', '0', '', '9223372037']) {
            edit('timeoutSeconds', value)
            await save()
            expect(invalid).toEqual(['timeoutSeconds'])
            expect(draft.timeoutSeconds).toBe(value)
        }
        expect(scheduleWrites).toHaveLength(0)
        await save(true)
        expect(schedule).toEqual({ ...savedSchedule, enabled: true })
        expect(draft.intervalSeconds).toBe('7200')
        expect(draft.timeoutSeconds).toBe('9223372037')

        edit('timeoutSeconds', '45')
        fail = true
        await expect(save()).rejects.toThrow('schedule write unavailable')
        expect(status.schedule.timeout_seconds).toBe(30)
        expect(draft.timeoutSeconds).toBe('45')
        expect(notifications).toHaveLength(1)
        fail = false
        await save()
        expect(schedule).toEqual({ ...savedSchedule, enabled: true, interval_seconds: 7200, timeout_seconds: 45 })
        expect(scheduleDraftDirty.current).toBe(false)
    },
)

function task(id: string, status: QuotaRefreshTask['status']): QuotaRefreshTask {
    return {
        id, status, created_at: '2026-11-23T00:00:00Z', targets: [],
        summary: {
            total: 0,
            queued: 0,
            running: 0,
            succeeded: 0,
            failed: 0,
            skipped: 0,
            cancelled: 0,
            inconclusive: 0,
            interrupted: 0,
        },
    }
}

test('the task picker finds an older paused task and sends controls to that selected ID', async () => {
    const paused = task('old-paused', 'paused')
    const newest = task('new-success', 'succeeded')
    const get    = spyOn(apiClient, 'get').mockResolvedValue({
                                                                 tasks: [newest, paused],
                                                                 total: 2,
                                                                 persistence_error: '',
                                                             })
    const post   = spyOn(apiClient, 'post').mockResolvedValue(task(paused.id, 'running'))
    try {
        const { read, state } = panelReads()
        let quotaTaskList: unknown
        const fetchQuotaTasks = sourceCallback<() => Promise<void>>(panel, 'fetchQuotaTasks', {
            read, quotaApi, setQuotaTaskList: (value: unknown) => {
                quotaTaskList = value
            },
        })
        await fetchQuotaTasks()
        expect(get.mock.calls[0]?.[0]).toBe('/quota/refresh-tasks')
        const quotaTasks = sourceInitializer<QuotaRefreshTask[]>(
            panel,
            'quotaTasks',
            { quotaTaskList, latestQuotaTask: newest },
        )
        const preview    = (selectedTaskId: string) => sourceInitializer<QuotaRefreshTask>(panel, 'taskPreview', {
            quotaTasks,
            selectedTaskId,
            isQuotaRefreshTaskTerminal: (item: QuotaRefreshTask) => item.status === 'succeeded',
        })
        expect(preview('')).toEqual(paused)
        let selected = ''
        const picker = sourceExpression<ReactElement<{ onChange: (id: string) => void; options: { value: string }[] }>>(
            panel,
            (node) => ts.isJsxSelfClosingElement(node) && node.getText().includes('credentials.quota_task_select'),
            {
                React,
                Select: () => null,
                quotaTasks,
                selectedQuotaTask: preview(''),
                setSelectedTaskId: (id: string) => {
                    selected = id
                },
                quotaTaskActionBusy: false,
                formatTime: passthrough,
                t,
            },
        )
        expect(picker.props.options.map(({ value }) => value)).toEqual([newest.id, paused.id])
        picker.props.onChange(newest.id)
        expect(preview(selected)).toEqual(newest)
        picker.props.onChange(paused.id)

        let detail: QuotaRefreshTask | undefined
        const fetchQuotaTask = sourceCallback<(id: string) => Promise<void>>(panel, 'fetchQuotaTask', {
            read, quotaApi, setStatus: noop, setQuotaTaskDetail: (task: QuotaRefreshTask) => {
                detail = task
            },
        })
        get.mockResolvedValueOnce(paused)
        await fetchQuotaTask(paused.id)
        get.mockRejectedValueOnce(new Error('task detail unavailable'))
        await fetchQuotaTask(paused.id)
        expect(detail).toEqual(paused)
        expect(state().quotaTask).toEqual({ scope: paused.id, loading: false, error: 'task detail unavailable' })
        expect(get.mock.calls[1]?.[0]).toBe('/quota/refresh-tasks/old-paused')

        const jobs: Promise<void>[] = []
        let readBackId: string | undefined
        const control               = sourceInitializer<(action: string, request: typeof quotaApi.resumeTask) => void>(
            panel,
            'runQuotaTaskAction',
            {
                selectedQuotaTask: preview(selected),
                runAction: (
                    _action: string,
                    apply: (current: () => boolean) => Promise<void>,
                ) => jobs.push(apply(() => true)),
                fetchQuotaTask: (id: string) => {
                    readBackId =
                        id
                },
            },
        )
        control('quota-resume', quotaApi.resumeTask)
        await Promise.all(jobs)
        expect(post.mock.calls[0]?.[0]).toBe('/quota/refresh-tasks/old-paused/resume')
        expect(readBackId).toBe(paused.id)
    } finally {
        get.mockRestore()
        post.mockRestore()
    }
})

test('provider summaries fall back per provider and distinguish zero errors from missing request data', () => {
    const status = {
        status: 'idle' as const, schedule: savedSchedule,
        summary: { total: 2, normal: 2, abnormal: 0, disabled: 0, token_invalid: 0, refresh_failed: 0 },
        summary_by_provider: {
            codex: {
                provider: ' Codex ',
                total: 2,
                normal: 2,
                abnormal: 0,
                disabled: 0,
                token_invalid: 0,
                refresh_failed: 0,
                unavailable: 0,
                unknown: 0,
            },
        },
        refresh_queue: { pending: 0, skipped: 0, failed: 0 }, updated_at: '',
    }
    const health = buildProviderHealthRows({
                                               inspectionStatus: status,
                                               authFiles: [
                                                   { name: 'codex.json', provider: 'codex' },
                                                   {
                                                       name: 'claude.json',
                                                       provider: ' Claude ',
                                                       disabled: true,
                                                       success: 5,
                                                       failed: 0,
                                                   },
                                                   { name: 'devin.json', provider: 'cognition' },
                                               ],
                                           })
    expect(health.find(({ provider }) => provider === 'codex')).toMatchObject({
                                                                                  accountTotal: 2,
                                                                                  inspectionAvailable: true,
                                                                              })
    expect(health.find(({ provider }) => provider === 'claude')).toMatchObject({
                                                                                   accountTotal: 1,
                                                                                   disabled: 1,
                                                                                   errorRate: 0,
                                                                               })
    expect(health.find(({ provider }) => provider === 'devin')).toMatchObject({
                                                                                  accountTotal: 1,
                                                                                  errorRate: null,
                                                                                  quotaAvailable: false,
                                                                              })
})

test('legacy quota values are displayed without controls that imply runtime routing', () => {
    const settings = sourceCallback<(props: Record<string, unknown>) => ReactElement>(
        'components/credentials/GlobalSettings.tsx',
        'GlobalSettings',
        { React, styles: {}, useTranslation: () => ({ t }) },
    )
    const html     = renderToStaticMarkup(settings({
                                                       config: {
                                                           quotaExceeded: {
                                                               switchProject: true,
                                                               switchPreviewModel: false,
                                                           },
                                                       }, disableControls: false,
                                                   }))
    expect(html).toContain('kept for compatibility')
    expect(html).toContain('common.enabled')
    expect(html).toContain('common.disabled')
    expect(html).not.toContain('<input')
})
