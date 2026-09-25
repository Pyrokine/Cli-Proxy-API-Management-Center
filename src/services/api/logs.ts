/**
 * 日志相关 API
 */

import {LOGS_TIMEOUT_MS} from '@/utils/constants'
import {apiClient} from './client'
import type {RequestLogState} from './usage'

type LogCursor = number | string

const maxCompleteHomeLogRows         = 10000
const maxCompleteHomeLogPageRequests = 32

export interface LogsQuery {
    after?: LogCursor
    cursor?: string
    limit?: number
    offset?: number
}

interface LogsResponse {
    lines: string[]
    lineCount: number
    latestAfter?: LogCursor
    nextCursor?: string
    cursorReset?: boolean
    logBackendKind: 'file' | 'home-db' | 'unknown'
    requestLogHomeIpById?: Record<string, string>
    total?: number
    limit?: number
    offset?: number
}

export interface ErrorLogFile {
    name: string
    size?: number
    modified?: number
}

interface ErrorLogsResponse {
    files?: ErrorLogFile[]
}

interface LogSizeResponse {
    total_bytes: number
    file_count: number
}

interface ErrorLogPreview {
    content: string
    truncated: boolean
    total_lines: number
}

export interface RequestLogPreview extends ErrorLogPreview {
    requestLogState: RequestLogState | ''
    requestLogHomeIp: string
    message: string
}

type RawLogRecord = Record<string, unknown>

const requestLogStates = new Set<RequestLogState>([
                                                      'pending',
                                                      'available',
                                                      'disabled',
                                                      'not_captured',
                                                      'publish_failed',
                                                      'expired',
                                                      'legacy_unknown',
                                                  ])

function asRecord(value: unknown): RawLogRecord | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as RawLogRecord : null
}

function numberValue(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value
    }
    if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value)
        return Number.isFinite(parsed) ? parsed : undefined
    }
    return undefined
}

function stringValue(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

export function parseRequestLogState(value: unknown): RequestLogState | '' {
    const state = stringValue(value)
    return state && requestLogStates.has(state as RequestLogState) ? state as RequestLogState : ''
}

function booleanValue(value: unknown): boolean {
    if (typeof value === 'boolean') {
        return value
    }
    return typeof value === 'string' && value.trim().toLowerCase() === 'true'
}

function rawLines(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((line): line is string => typeof line === 'string') : []
}

function logTimestampValue(record: RawLogRecord): LogCursor | undefined {
    const value   = record.timestamp ?? record.created_at
    const numeric = numberValue(value)
    if (numeric !== undefined) {
        return numeric
    }
    return stringValue(value)
}

function timestampRank(value: LogCursor | undefined): number {
    if (typeof value === 'number') {
        return value
    }
    if (typeof value === 'string') {
        const numeric = Number(value)
        if (Number.isFinite(numeric)) {
            return numeric
        }
        const parsed = Date.parse(value)
        if (Number.isFinite(parsed)) {
            return parsed
        }
    }
    return 0
}

function latestLogTimestamp(records: RawLogRecord[]): LogCursor | undefined {
    let latest: LogCursor | undefined
    let latestRank = 0
    for (const record of records) {
        const value = logTimestampValue(record)
        const rank  = timestampRank(value)
        if (rank > latestRank) {
            latest     = value
            latestRank = rank
        }
    }
    return latest
}

function normalizeCPALogs(raw: RawLogRecord): LogsResponse {
    const lines       = rawLines(raw.lines)
    const lineCount   = numberValue(raw['line-count']) ?? lines.length
    const latestAfter = numberValue(raw['latest-timestamp']) ?? stringValue(raw['latest-timestamp'])
    const nextCursor  = stringValue(raw['next-cursor'])
    return {
        lines,
        lineCount,
        latestAfter,
        nextCursor,
        cursorReset: booleanValue(raw['cursor-reset']),
        logBackendKind: 'file',
    }
}

function normalizeHomeLogs(raw: RawLogRecord): LogsResponse {
    const rawLogs                                      = Array.isArray(raw.logs) ?
                                                         raw.logs.map(asRecord)
                                                            .filter((item): item is RawLogRecord => item !== null) :
        []
    const records                                      = [...rawLogs].reverse()
    const lines                                        = records
        .map((record) => stringValue(record.line))
        .filter((line): line is string => typeof line === 'string')
    const requestLogHomeIpById: Record<string, string> = {}
    for (const record of rawLogs) {
        const requestId = stringValue(record.request_id ?? record.requestId)
        const homeIp    = stringValue(record.home_ip ?? record.homeIp)
        if (requestId && homeIp) {
            requestLogHomeIpById[requestId] = homeIp
        }
    }
    return {
        lines,
        lineCount: numberValue(raw.total) ?? lines.length,
        latestAfter: latestLogTimestamp(rawLogs),
        logBackendKind: 'home-db',
        requestLogHomeIpById,
        total: numberValue(raw.total),
        limit: numberValue(raw.limit),
        offset: numberValue(raw.offset),
    }
}

function normalizeLogsResponse(raw: unknown): LogsResponse {
    const record = asRecord(raw)
    if (!record) {
        return { lines: [], lineCount: 0, logBackendKind: 'unknown' }
    }
    if (Array.isArray(record.logs)) {
        return normalizeHomeLogs(record)
    }
    if (Array.isArray(record.lines)) {
        return normalizeCPALogs(record)
    }
    return { lines: [], lineCount: 0, logBackendKind: 'unknown' }
}

function normalizeRequestLogPreview(raw: unknown): RequestLogPreview {
    const record = asRecord(raw)
    return {
        content: typeof record?.content === 'string' ? record.content : '',
        truncated: booleanValue(record?.truncated),
        total_lines: numberValue(record?.total_lines) ?? 0,
        requestLogState: parseRequestLogState(record?.request_log_state),
        requestLogHomeIp: stringValue(record?.request_log_home_ip) ?? '',
        message: stringValue(record?.error) ?? '',
    }
}

async function fetchCompleteHomeLogs(
    firstPage: unknown,
    params: LogsQuery,
    signal?: AbortSignal,
): Promise<unknown> {
    const firstRecord = asRecord(firstPage)
    if (!firstRecord || !Array.isArray(firstRecord.logs)) {
        return firstPage
    }

    const firstLogs         = firstRecord.logs
    const total             = numberValue(firstRecord.total)
    const offset            = numberValue(firstRecord.offset) ?? params.offset ?? 0
    const requestedCountRaw = params.limit && params.limit > 0 ? params.limit : maxCompleteHomeLogRows
    const requestedCount    = Math.min(requestedCountRaw, maxCompleteHomeLogRows)
    const targetEnd         = total && requestedCount ? Math.min(total, offset + requestedCount) : total
    if (!total || !targetEnd || firstLogs.length <= 0 || offset + firstLogs.length >= targetEnd) {
        return firstPage
    }

    const pageParamsBase = { ...params }
    delete pageParamsBase.cursor

    const logs       = [...firstLogs]
    let nextOffset   = offset + firstLogs.length
    let pageRequests = 0
    while (nextOffset < targetEnd && pageRequests < maxCompleteHomeLogPageRequests) {
        const nextLimit = Math.min(maxCompleteHomeLogRows, targetEnd - nextOffset)
        const page      = asRecord(await apiClient.get('/logs', {
            params: { ...pageParamsBase, limit: nextLimit, offset: nextOffset },
            timeout: LOGS_TIMEOUT_MS,
            signal,
        }))
        const pageLogs  = Array.isArray(page?.logs) ? page.logs : []
        if (pageLogs.length === 0) {
            break
        }
        logs.push(...pageLogs)
        nextOffset += pageLogs.length
        pageRequests += 1
    }
    if (nextOffset < targetEnd) {
        console.warn('[Logs] home-db pagination stopped after maximum supplemental pages')
    }
    return { ...firstRecord, logs }
}

export const logsApi = {
    fetchLogSize: (options?: { signal?: AbortSignal }): Promise<LogSizeResponse> =>
        apiClient.get('/log-size', { signal: options?.signal }),

    fetchLogs: async (params: LogsQuery = {}, options?: { signal?: AbortSignal }): Promise<LogsResponse> => {
        const raw = await apiClient.get('/logs', {
            params,
            timeout: LOGS_TIMEOUT_MS,
            signal: options?.signal,
        })
        return normalizeLogsResponse(await fetchCompleteHomeLogs(raw, params, options?.signal))
    },

    clearLogs: (options?: { signal?: AbortSignal }) => apiClient.delete('/logs', { signal: options?.signal }),

    fetchErrorLogs: (options?: { signal?: AbortSignal }): Promise<ErrorLogsResponse> =>
        apiClient.get('/request-error-logs', {
            timeout: LOGS_TIMEOUT_MS,
            signal: options?.signal,
        }),

    downloadErrorLog: (filename: string, options?: { signal?: AbortSignal }) =>
        apiClient.getRaw(`/request-error-logs/${encodeURIComponent(filename)}`, {
            responseType: 'blob',
            timeout: LOGS_TIMEOUT_MS,
            signal: options?.signal,
        }),

    previewErrorLog: (
        filename: string,
        lines = 200,
        options?: { signal?: AbortSignal },
    ): Promise<ErrorLogPreview> =>
        apiClient.get(`/request-error-logs/${encodeURIComponent(filename)}`, {
            params: { lines },
            timeout: LOGS_TIMEOUT_MS,
            signal: options?.signal,
        }),

    downloadRequestLogById: (id: string, homeIp?: string, options?: { signal?: AbortSignal }) =>
        apiClient.getRaw(`/request-log-by-id/${encodeURIComponent(id)}`, {
            params: homeIp ? { home_ip: homeIp } : undefined,
            responseType: 'blob',
            timeout: LOGS_TIMEOUT_MS,
            signal: options?.signal,
        }),

    previewRequestLogById: async (
        id: string,
        lines = 200,
        homeIp?: string,
        options?: { signal?: AbortSignal },
    ): Promise<RequestLogPreview> => {
        const raw = await apiClient.get(`/request-log-by-id/${encodeURIComponent(id)}`, {
            params: homeIp ? { lines, home_ip: homeIp } : { lines },
            timeout: LOGS_TIMEOUT_MS,
            signal: options?.signal,
        })
        return normalizeRequestLogPreview(raw)
    },
}
