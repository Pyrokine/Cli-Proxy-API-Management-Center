import {describe, expect, spyOn, test} from 'bun:test'
import {readFileSync} from 'node:fs'
import {AxiosHeaders} from 'axios'
import {fileURLToPath, URL} from 'node:url'
import {apiClient} from '../src/services/api/client'
import {logsApi} from '../src/services/api/logs'
import {createLogRequestGuard, createLogRequestQueue} from '../src/pages/hooks/logRequests'

describe('log request guard', () => {
    test('only allows the latest request in the current authentication generation to publish', () => {
        const guard = createLogRequestGuard()
        const first = guard.begin(4)
        const next  = guard.begin(4)

        expect(first.controller.signal.aborted).toBe(true)
        expect(guard.isCurrent(first, 4)).toBe(false)
        expect(guard.isCurrent(next, 4)).toBe(true)
        expect(guard.isCurrent(next, 5)).toBe(false)
        expect(guard.finish(first)).toBe(false)
        expect(guard.finish(next)).toBe(true)
    })

    test('invalidates captured confirmation scopes on session changes', () => {
        const guard   = createLogRequestGuard()
        const session = guard.capture(7)

        expect(guard.isCurrent(session, 7)).toBe(true)
        guard.invalidate()
        expect(guard.isCurrent(session, 7)).toBe(false)
    })

    test('close during asynchronous decoding prevents a late result from publishing', async () => {
        const guard   = createLogRequestGuard()
        const request = guard.begin(2)
        let resolve!: (value: string) => void
        const decoding = new Promise<string>((done) => {
            resolve = done
        })
        let published = ''
        const completion = decoding.then((value) => {
            if (guard.isCurrent(request, 2)) {
                published = value
            }
        })

        guard.invalidate()
        resolve('obsolete content')
        await completion

        expect(request.controller.signal.aborted).toBe(true)
        expect(published).toBe('')
    })
})

describe('log read and clear queue', () => {
    test('serializes reads, drops polling overlap and coalesces full reloads', () => {
        const queue = createLogRequestQueue()
        const first = queue.startRead(true, 3)!

        expect(queue.startRead(true, 3)).toBeNull()
        expect(queue.startRead(false, 3)).toBeNull()
        expect(queue.startRead(false, 3)).toBeNull()
        expect(first.controller.signal.aborted).toBe(true)
        expect(queue.isCurrent(first, 3)).toBe(false)
        expect(queue.finish(first, 3)).toEqual({ finished: true, reload: true })

        const next = queue.startRead(false, 3)!
        expect(queue.finish(next, 3)).toEqual({ finished: true, reload: false })
    })

    test('clear supersedes an old read and blocks new reads until deletion settles', () => {
        const queue    = createLogRequestQueue()
        const reading  = queue.startRead(false, 9)!
        const clearing = queue.startClear(9)!

        expect(reading.controller.signal.aborted).toBe(true)
        expect(queue.isCurrent(reading, 9)).toBe(false)
        expect(queue.finish(reading, 9)).toEqual({ finished: false, reload: false })
        expect(queue.startRead(true, 9)).toBeNull()
        expect(queue.startRead(false, 9)).toBeNull()
        expect(queue.finish(clearing, 9)).toEqual({ finished: true, reload: true })
    })

    test('failed clear requests a recovery reload without letting stale finally drain it', () => {
        const queue    = createLogRequestQueue()
        const reading  = queue.startRead(false, 1)!
        const clearing = queue.startClear(1)!

        expect(queue.finish(clearing, 1, true)).toEqual({ finished: true, reload: true })
        const recovery = queue.startRead(false, 1)!
        expect(queue.finish(reading, 1)).toEqual({ finished: false, reload: false })
        expect(queue.isCurrent(recovery, 1)).toBe(true)
        expect(queue.finish(recovery, 1)).toEqual({ finished: true, reload: false })
    })

    test('authentication changes discard queued work and allow a fresh request', () => {
        const queue = createLogRequestQueue()
        const old   = queue.startRead(false, 10)!
        queue.startRead(false, 10)

        expect(queue.finish(old, 11)).toEqual({ finished: false, reload: false })
        const fresh = queue.startRead(false, 11)!
        expect(queue.isCurrent(fresh, 11)).toBe(true)
    })
})

describe('log API cancellation', () => {
    test('propagates AbortSignal through clear, list, preview and download requests', async () => {
        const originalGet    = apiClient.get
        const originalDelete = apiClient.delete
        const originalGetRaw = apiClient.getRaw
        const seenSignals    = new Map<string, AbortSignal | undefined>()
        apiClient.get        = (async (url: string, config?: { signal?: AbortSignal }) => {
            seenSignals.set(`get:${url}`, config?.signal)
            if (url === '/request-error-logs') {
                return { files: [] }
            }
            return { content: '', truncated: false, total_lines: 0 }
        }) as typeof apiClient.get
        apiClient.delete     = (async (url: string, config?: { signal?: AbortSignal }) => {
            seenSignals.set(`delete:${url}`, config?.signal)
            return undefined
        }) as typeof apiClient.delete
        apiClient.getRaw     = (async (url: string, config?: { signal?: AbortSignal }) => {
            seenSignals.set(`raw:${url}`, config?.signal)
            return { data: new Blob([]), headers: {} }
        }) as typeof apiClient.getRaw

        const controller = new AbortController()
        try {
            const options = { signal: controller.signal }
            await logsApi.clearLogs(options)
            await logsApi.fetchErrorLogs(options)
            await logsApi.previewErrorLog('error.log', 500, options)
            await logsApi.downloadErrorLog('error.log', options)
            await logsApi.previewRequestLogById('request/id', 300, '192.0.2.4', options)
            await logsApi.downloadRequestLogById('request/id', '192.0.2.4', options)

            expect(Array.from(seenSignals.values()).every((signal) => signal === controller.signal)).toBe(true)
            expect(seenSignals.size).toBe(6)
        } finally {
            apiClient.get    = originalGet
            apiClient.delete = originalDelete
            apiClient.getRaw = originalGetRaw
        }
    })
})

describe('log API response handling', () => {
    test('accepts an empty list and validates file metadata from the management server', async () => {
        const get = spyOn(apiClient, 'get')
            .mockResolvedValueOnce({ files: [] })
            .mockResolvedValueOnce({ files: [{ name: 'error.log', size: 4096, modified: 1720000000 }] })
            .mockResolvedValueOnce({ files: [{ name: '', size: 4096, modified: 1720000000 }] })
            .mockResolvedValueOnce({ status: 'ok' })
        try {
            await expect(logsApi.fetchErrorLogs()).resolves.toEqual({ files: [] })
            await expect(logsApi.fetchErrorLogs()).resolves.toEqual({
                files: [{ name: 'error.log', size: 4096, modified: 1720000000 }],
            })
            await expect(logsApi.fetchErrorLogs()).rejects.toThrow('Invalid error log file metadata')
            await expect(logsApi.fetchErrorLogs()).rejects.toThrow('Invalid error log list response')
            expect(get).toHaveBeenCalledTimes(4)
        } finally {
            get.mockRestore()
        }
    })

    test('decodes JSON blob errors without changing request identity or treating successful logs as errors', async () => {
        const failure = Object.assign(new Error('Request failed with status code 403'), {
            status: 403,
            code: 'ERR_BAD_REQUEST',
            data: new Blob([JSON.stringify({ error: { message: 'Download denied', code: 'access_denied' } })]),
        })
        const malformed = Object.assign(new Error('Request failed with status code 500'), {
            status: 500,
            data: new Blob(['not JSON']),
        })
        const success = {
            data: new Blob(['{"error":"literal log content"}']),
            status: 200,
            statusText: 'OK',
            headers: new AxiosHeaders(),
            config: { headers: new AxiosHeaders() },
        }
        const getRaw = spyOn(apiClient, 'getRaw')
            .mockRejectedValueOnce(failure)
            .mockRejectedValueOnce(malformed)
            .mockResolvedValueOnce(success)
        try {
            await expect(logsApi.downloadErrorLog('bad.log')).rejects.toBe(failure)
            expect(failure.message).toBe('Download denied')
            expect(failure.status).toBe(403)
            expect(failure.code).toBe('ERR_BAD_REQUEST')
            expect((failure as typeof failure & { backendCode?: string }).backendCode).toBe('access_denied')
            await expect(logsApi.downloadRequestLogById('request/id', '192.0.2.7')).rejects.toBe(malformed)
            expect(malformed.message).toBe('Request failed with status code 500')
            expect(malformed.status).toBe(500)
            await expect(logsApi.downloadErrorLog('plain.log')).resolves.toBe(success)
            expect(await success.data.text()).toBe('{"error":"literal log content"}')
            expect(getRaw).toHaveBeenNthCalledWith(2, '/request-log-by-id/request%2Fid', {
                params: { home_ip: '192.0.2.7' },
                responseType: 'blob',
                timeout: expect.any(Number),
                signal: undefined,
            })
        } finally {
            getRaw.mockRestore()
        }
    })
})

describe('logs page lifecycle wiring', () => {
    const source = readFileSync(
        fileURLToPath(new URL('../src/pages/LogsPage.tsx', import.meta.url)),
        'utf8',
    )

    test('invalidates requests synchronously on connection identity changes and unmount', () => {
        expect(source).toContain('useAuthStore.subscribe')
        expect(source).toContain('next.apiBase === previous.apiBase')
        expect(source).toContain('next.managementKey === previous.managementKey')
        expect(source).toContain('next.connectionStatus === previous.connectionStatus')
        expect(source).toContain('next.isAuthenticated === previous.isAuthenticated')
        expect(source).toContain('unsubscribeAuth()')
        expect(source).toContain('invalidateRequests()')
    })

    test('checks request ownership after response and blob decoding', () => {
        const errorDownload = source.indexOf('const downloadErrorLog = async')
        const requestDownload = source.indexOf('const downloadRequestLog = async')
        const nextFunction = source.indexOf('const previewErrorLog = async', errorDownload)
        const errorDownloadSource = source.slice(errorDownload, nextFunction)
        const requestDownloadSource = source.slice(requestDownload, source.indexOf('const toggleRequestLog', requestDownload))

        expect(errorDownloadSource.match(/requests\.errorDownload\.isCurrent/g)?.length).toBeGreaterThanOrEqual(4)
        expect(requestDownloadSource.match(/requests\.requestDownload\.isCurrent/g)?.length).toBeGreaterThanOrEqual(4)
        expect(errorDownloadSource.indexOf('await responseDataToText')).toBeLessThan(
            errorDownloadSource.lastIndexOf('requests.errorDownload.isCurrent'),
        )
        expect(requestDownloadSource.indexOf('await responseDataToText')).toBeLessThan(
            requestDownloadSource.lastIndexOf('requests.requestDownload.isCurrent'),
        )
    })

    test('keeps Home log identity and bounded list behavior', () => {
        expect(source).toContain('requestLogHomeIpByIdRef.current[id]')
        expect(source).toContain('...data.requestLogHomeIpById')
        expect(source).toContain('const MAX_BUFFER_LINES          = 10000')
        expect(source).toMatch(/title=\{line\.requestId\}>\s*\{line\.requestId\}\s*<\/span>/)
    })
})
