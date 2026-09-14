import {
    quotaApi,
    type QuotaRefreshTargetStatus,
    type QuotaRefreshTask,
    type QuotaRefreshTaskStatus,
} from '@/services/api/quota'

const terminalTaskStatuses = new Set<QuotaRefreshTaskStatus>([
                                                                 'succeeded',
                                                                 'failed',
                                                                 'cancelled',
                                                                 'inconclusive',
                                                                 'interrupted',
                                                             ])

const terminalTargetStatuses = new Set<QuotaRefreshTargetStatus>([
                                                                     'succeeded',
                                                                     'failed',
                                                                     'skipped',
                                                                     'cancelled',
                                                                     'inconclusive',
                                                                     'interrupted',
                                                                 ])

const isQuotaRefreshTargetTerminal = (status: QuotaRefreshTargetStatus): boolean =>
    terminalTargetStatuses.has(status)

export const isQuotaRefreshTaskTerminal = (task: QuotaRefreshTask): boolean =>
    terminalTaskStatuses.has(task.status) && task.targets.every((target) => isQuotaRefreshTargetTerminal(target.status))

export class QuotaRefreshTaskWaitCancelledError extends Error {
    constructor() {
        super('quota refresh task wait cancelled')
        this.name = 'QuotaRefreshTaskWaitCancelledError'
    }
}

export class QuotaRefreshTaskWaitTimeoutError extends Error {
    readonly taskId: string

    constructor(taskId: string) {
        super(`quota refresh task ${taskId} did not reach a terminal state before timeout`)
        this.name   = 'QuotaRefreshTaskWaitTimeoutError'
        this.taskId = taskId
    }
}

type QuotaRefreshTaskRequest = (
    taskId: string,
    options?: { signal?: AbortSignal },
) => Promise<QuotaRefreshTask>

type WaitForQuotaRefreshTaskOptions = {
    signal?: AbortSignal
    timeoutMs?: number
    pollIntervalMs?: number
    fetchTask?: QuotaRefreshTaskRequest
    now?: () => number
    wait?: (milliseconds: number, signal?: AbortSignal) => Promise<void>
}

const throwIfWaitCancelled = (signal: AbortSignal | undefined): void => {
    if (signal?.aborted) {
        throw new QuotaRefreshTaskWaitCancelledError()
    }
}

const waitForDelay = (milliseconds: number, signal?: AbortSignal): Promise<void> =>
    new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(new QuotaRefreshTaskWaitCancelledError())
            return
        }
        const timeoutId   = globalThis.setTimeout(() => {
            signal?.removeEventListener('abort', handleAbort)
            resolve()
        }, milliseconds)
        const handleAbort = () => {
            globalThis.clearTimeout(timeoutId)
            reject(new QuotaRefreshTaskWaitCancelledError())
        }
        signal?.addEventListener('abort', handleAbort, { once: true })
    })

export async function waitForQuotaRefreshTask(
    initialTask: QuotaRefreshTask,
    options: WaitForQuotaRefreshTaskOptions = {},
): Promise<QuotaRefreshTask> {
    const fetchTask      = options.fetchTask ?? quotaApi.getTask
    const now            = options.now ?? Date.now
    const wait           = options.wait ?? waitForDelay
    const timeoutMs      = options.timeoutMs ?? 10 * 60 * 1000
    const pollIntervalMs = options.pollIntervalMs ?? 1000
    const startedAt      = now()
    let task             = initialTask

    for (; ;) {
        throwIfWaitCancelled(options.signal)
        if (isQuotaRefreshTaskTerminal(task)) {
            return task
        }
        if (now() - startedAt >= timeoutMs) {
            throw new QuotaRefreshTaskWaitTimeoutError(task.id)
        }
        try {
            task = await fetchTask(task.id, { signal: options.signal })
        } catch (error) {
            throwIfWaitCancelled(options.signal)
            throw error
        }
        throwIfWaitCancelled(options.signal)
        if (isQuotaRefreshTaskTerminal(task)) {
            return task
        }
        try {
            await wait(pollIntervalMs, options.signal)
        } catch (error) {
            throwIfWaitCancelled(options.signal)
            throw error
        }
    }
}
