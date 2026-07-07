/**
 * Generic API call helper (proxied via management API).
 */

import type {AxiosRequestConfig} from 'axios'
import {apiClient} from './client'

interface ApiCallRequest {
    authIndex?: string
    method: string
    url: string
    header?: Record<string, string>
    data?: string
    proxyUrl?: string
    proxy_url?: string
}

interface ApiCallResult<T = unknown> {
    statusCode: number
    header: Record<string, string[]>
    bodyText: string
    body: T | null
}

const normalizeBody = (input: unknown): { bodyText: string; body: unknown | null } => {
    if (input === undefined || input === null) {
        return { bodyText: '', body: null }
    }

    if (typeof input === 'string') {
        const text    = input
        const trimmed = text.trim()
        if (!trimmed) {
            return { bodyText: text, body: null }
        }
        try {
            return { bodyText: text, body: JSON.parse(trimmed) }
        } catch {
            return { bodyText: text, body: text }
        }
    }

    try {
        return { bodyText: JSON.stringify(input), body: input }
    } catch {
        return { bodyText: String(input), body: input }
    }
}

const REDACTED = '[redacted]'

const redactApiCallMessage = (input: string): string =>
    input
        .replace(/(?<prefix>Bearer\s+)(?:[A-Za-z0-9._~+/=-]+)/gi, `$<prefix>${REDACTED}`)
        .replace(
            /(?<prefix>["']?(?:authorization|x-goog-api-key|x-api-key|api[-_ ]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|cookie|set-cookie)["']?\s*[:=]\s*["']?)(?:[^"'\s,;}]+)/gi,
            `$<prefix>${REDACTED}`,
        )
        .replace(
            /(?<prefix>[?&](?:key|api_key|apiKey|x-goog-api-key|access_token|token)=)(?:[^&#\s"']+)/gi,
            `$<prefix>${REDACTED}`,
        )

export const getApiCallErrorMessage = (result: ApiCallResult): string => {
    const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object'

    const status   = result.statusCode
    const body     = result.body
    const bodyText = result.bodyText
    let message    = ''

    if (isRecord(body)) {
        const errorValue = body.error
        if (isRecord(errorValue) && typeof errorValue.message === 'string') {
            message = errorValue.message
        } else if (typeof errorValue === 'string') {
            message = errorValue
        }
        if (!message && typeof body.message === 'string') {
            message = body.message
        }
    } else if (typeof body === 'string') {
        message = body
    }

    if (!message && bodyText) {
        message = bodyText
    }

    const safeMessage = message ? redactApiCallMessage(message) : ''

    if (status && safeMessage) {
        return `${status} ${safeMessage}`.trim()
    }
    if (status) {
        return `HTTP ${status}`
    }
    return safeMessage || 'Request failed'
}

export const apiCallApi = {
    request: async (payload: ApiCallRequest, config?: AxiosRequestConfig): Promise<ApiCallResult> => {
        const response           = await apiClient.post<Record<string, unknown>>('/api-call', payload, config)
        const statusCode         = Number(response?.status_code ?? 0)
        const header             = (response?.header ?? {}) as Record<string, string[]>
        const { bodyText, body } = normalizeBody(response?.body)

        return {
            statusCode,
            header,
            bodyText,
            body,
        }
    },
}
