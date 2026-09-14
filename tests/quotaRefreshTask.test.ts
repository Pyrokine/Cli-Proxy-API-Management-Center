import {describe, expect, test} from 'bun:test'

import {
    isQuotaRefreshTaskTerminal,
    QuotaRefreshTaskWaitCancelledError,
    QuotaRefreshTaskWaitTimeoutError,
    waitForQuotaRefreshTask,
} from '@/components/credentials/hooks/quotaRefreshTask'
import {apiClient} from '@/services/api/client'
import {
    quotaApi,
    type QuotaRefreshTargetStatus,
    type QuotaRefreshTask,
    type QuotaRefreshTaskStatus,
} from '@/services/api/quota'

const createTask = (
    status: QuotaRefreshTaskStatus,
    targetStatus: QuotaRefreshTargetStatus,
): QuotaRefreshTask => ({
    id: 'task-1',
    status,
    created_at: '2026-09-07T00:00:00Z',
    summary: {
        total: 1,
        queued: targetStatus === 'queued' ? 1 : 0,
        running: targetStatus === 'running' ? 1 : 0,
        succeeded: targetStatus === 'succeeded' ? 1 : 0,
        failed: targetStatus === 'failed' ? 1 : 0,
        skipped: targetStatus === 'skipped' ? 1 : 0,
        cancelled: targetStatus === 'cancelled' ? 1 : 0,
        inconclusive: targetStatus === 'inconclusive' ? 1 : 0,
        interrupted: targetStatus === 'interrupted' ? 1 : 0,
    },
    targets: [
        {
            id: 'claude::credential.json',
            entry_key: 'claude::credential.json',
            file_name: 'credential.json',
            provider: 'claude',
            status: targetStatus,
        },
    ],
})

describe('quota refresh task polling', () => {
    test('waits for both task and target terminal states', async () => {
        const responses    = [
            createTask('running', 'running'),
            createTask('succeeded', 'succeeded'),
        ]
        let requestCount   = 0
        const terminalTask = await waitForQuotaRefreshTask(createTask('queued', 'queued'), {
            fetchTask: async () => responses[requestCount++]!,
            wait: async () => undefined,
        })

        expect(terminalTask.status).toBe('succeeded')
        expect(terminalTask.targets[0]?.status).toBe('succeeded')
        expect(requestCount).toBe(2)
    })

    test('does not accept a terminal task with a non-terminal target', async () => {
        const inconsistent = createTask('succeeded', 'running')
        expect(isQuotaRefreshTaskTerminal(inconsistent)).toBe(false)

        let requestCount   = 0
        const terminalTask = await waitForQuotaRefreshTask(inconsistent, {
            fetchTask: async () => {
                requestCount += 1
                return createTask('succeeded', 'succeeded')
            },
            wait: async () => undefined,
        })

        expect(terminalTask.targets[0]?.status).toBe('succeeded')
        expect(requestCount).toBe(1)
    })

    test('continues polling after the initiating UI claim becomes stale', async () => {
        let uiClaimCurrent = true
        let requestCount   = 0
        const terminalTask = await waitForQuotaRefreshTask(createTask('queued', 'queued'), {
            fetchTask: async () => {
                requestCount += 1
                uiClaimCurrent = false
                return requestCount === 1
                       ? createTask('running', 'running')
                       : createTask('succeeded', 'succeeded')
            },
            wait: async () => undefined,
        })

        expect(uiClaimCurrent).toBe(false)
        expect(terminalTask.status).toBe('succeeded')
        expect(requestCount).toBe(2)
    })

    test('stops polling when its request signal is aborted', async () => {
        const controller = new AbortController()
        // noinspection ES6RedundantAwait
        await expect(waitForQuotaRefreshTask(createTask('queued', 'queued'), {
            signal: controller.signal,
            fetchTask: async () => {
                controller.abort()
                return createTask('running', 'running')
            },
            wait: async () => undefined,
        })).rejects.toBeInstanceOf(QuotaRefreshTaskWaitCancelledError)
    })

    test('reports timeout without inferring completion from quota timestamps', async () => {
        let now = 0
        // noinspection ES6RedundantAwait
        await expect(waitForQuotaRefreshTask(createTask('running', 'running'), {
            timeoutMs: 50,
            now: () => now,
            fetchTask: async () => createTask('running', 'running'),
            wait: async () => {
                now = 50
            },
        })).rejects.toBeInstanceOf(QuotaRefreshTaskWaitTimeoutError)
    })
})

describe('quota refresh task API', () => {
    test('creates a task and preserves the caller abort signal', async () => {
        const originalPost = apiClient.post
        const controller   = new AbortController()
        let capturedUrl    = ''
        let capturedData: unknown
        let capturedSignal: AbortSignal | undefined
        apiClient.post     = (async (url: string, data?: unknown, config?: { signal?: AbortSignal }) => {
            capturedUrl    = url
            capturedData   = data
            capturedSignal = config?.signal
            return createTask('queued', 'queued')
        }) as typeof apiClient.post
        try {
            const task = await quotaApi.refresh(['claude::credential.json'], { signal: controller.signal })
            expect(task.id).toBe('task-1')
            expect(capturedUrl).toBe('/quota/refresh')
            expect(capturedData).toEqual({ credentials: ['claude::credential.json'] })
            expect(capturedSignal).toBe(controller.signal)
        } finally {
            apiClient.post = originalPost
        }
    })

    test('uses the persistent task identity for reads and controls', async () => {
        const originalGet    = apiClient.get
        const originalPost   = apiClient.post
        const urls: string[] = []
        apiClient.get        = (async (url: string) => {
            urls.push(`GET ${url}`)
            return createTask('running', 'running')
        }) as typeof apiClient.get
        apiClient.post       = (async (url: string) => {
            urls.push(`POST ${url}`)
            return createTask('running', 'running')
        }) as typeof apiClient.post
        try {
            await quotaApi.getTask('task/id')
            await quotaApi.pauseTask('task/id')
            await quotaApi.resumeTask('task/id')
            await quotaApi.cancelTask('task/id')
        } finally {
            apiClient.get  = originalGet
            apiClient.post = originalPost
        }

        expect(urls).toEqual([
                                 'GET /quota/refresh-tasks/task%2Fid',
                                 'POST /quota/refresh-tasks/task%2Fid/pause',
                                 'POST /quota/refresh-tasks/task%2Fid/resume',
                                 'POST /quota/refresh-tasks/task%2Fid/cancel',
                             ])
    })
})
