/**
 * 日志相关 API
 */

import { LOGS_TIMEOUT_MS } from '@/utils/constants'
import { apiClient } from './client'

interface LogsQuery {
    after?: number
    limit?: number
}

interface LogsResponse {
    lines: string[]
    'line-count': number
    'latest-timestamp': number
}

interface ErrorLogFile {
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

export const logsApi = {
    fetchLogSize: (): Promise<LogSizeResponse> => apiClient.get('/log-size'),

    fetchLogs: (params: LogsQuery = {}): Promise<LogsResponse> =>
        apiClient.get('/logs', { params, timeout: LOGS_TIMEOUT_MS }),

    clearLogs: () => apiClient.delete('/logs'),

    fetchErrorLogs: (): Promise<ErrorLogsResponse> =>
        apiClient.get('/request-error-logs', { timeout: LOGS_TIMEOUT_MS }),

    downloadErrorLog: (filename: string) =>
        apiClient.getRaw(`/request-error-logs/${encodeURIComponent(filename)}`, {
            responseType: 'blob',
            timeout: LOGS_TIMEOUT_MS,
        }),

    previewErrorLog: (filename: string, lines = 200): Promise<ErrorLogPreview> =>
        apiClient.get(`/request-error-logs/${encodeURIComponent(filename)}`, {
            params: { lines },
            timeout: LOGS_TIMEOUT_MS,
        }),

    downloadRequestLogById: (id: string) =>
        apiClient.getRaw(`/request-log-by-id/${encodeURIComponent(id)}`, {
            responseType: 'blob',
            timeout: LOGS_TIMEOUT_MS,
        }),
}
