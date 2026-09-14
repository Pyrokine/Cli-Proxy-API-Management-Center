/**
 * Generic API call helper (proxied via management API).
 */

import {redactSensitiveText} from '@/utils/redaction'
import type {AxiosRequestConfig} from 'axios'
import {apiClient} from './client'

interface ApiCallRequest {
    authIndex?: string
    draftToken?: string
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

export const API_CALL_TOKEN          = '$TOKEN$'
const MASKED_API_KEY_PATTERN         = /^(?:\*{3,4}|.{3,}\.{3,4}.{4,})(?:#\d+)?$/u
const AUTHORIZATION_TOKEN_PREFIX     = /^(?<prefix>\S+\s+)(?<token>.+)$/
const CREDENTIAL_HEADER_NAME_PATTERN = new RegExp(
    String.raw`(?:^|[-_ ])(?:authorization|cookie|token|key|` +
    String.raw`secret|password|passwd)(?:$|[-_ ])`,
    'i',
)

export const isCredentialHeaderName = (name: string) => CREDENTIAL_HEADER_NAME_PATTERN.test(name.trim())

const isMaskedApiKey = (value: string) => MASKED_API_KEY_PATTERN.test(value.trim())

const headerEntry = (headers: Record<string, string>, name: string) => {
    const target = name.toLowerCase()
    return Object.entries(headers).find(([key]) => key.toLowerCase() === target)
}

const tokenHeaderValue = (name: string, value: string) => {
    if (value.includes(API_CALL_TOKEN)) {
        const preparedValue = name.toLowerCase() === 'authorization' && value.trim() === API_CALL_TOKEN ?
                              `Bearer ${API_CALL_TOKEN}` :
                              value
        return { value: preparedValue, token: '' }
    }
    if (name.toLowerCase() !== 'authorization') {
        return { value: API_CALL_TOKEN, token: value.trim() }
    }
    const match = value.trim().match(AUTHORIZATION_TOKEN_PREFIX)
    return {
        value: `${match?.groups?.prefix ?? 'Bearer '}${API_CALL_TOKEN}`,
        token: match?.groups?.token?.trim() ?? value.trim(),
    }
}

export const prepareApiCallAuth = (options: {
    headers?: Record<string, string>
    apiKey?: string
    authIndex?: string
    preferredHeader: string
    headerNames?: string[]
    authorizationScheme?: string
    apiKeyIsMasked?: boolean
    maskedHeaderNames?: string[]
}) => {
    const headers           = { ...(options.headers ?? {}) }
    const rawApiKey         = String(options.apiKey ?? '').trim()
    const apiKeyIsMasked    = options.apiKeyIsMasked ?? Boolean(options.authIndex?.trim() && isMaskedApiKey(rawApiKey))
    const maskedHeaderNames = options.maskedHeaderNames ?
                              new Set(
                                  options.maskedHeaderNames
                                         .map((name) => name.trim().toLowerCase())
                                         .filter(Boolean),
                              ) :
                              undefined
    let draftToken          = rawApiKey && !apiKeyIsMasked ? rawApiKey : ''
    const headerNames       = Array.from(new Set([options.preferredHeader, ...(options.headerNames ?? [])]))
    const recognizedNames   = new Set(headerNames.map((name) => name.toLowerCase()))
    const seenNames         = new Set<string>()
    Object.keys(headers).forEach((name) => {
        const normalizedName = name.toLowerCase()
        if (!recognizedNames.has(normalizedName)) {
            return
        }
        if (seenNames.has(normalizedName)) {
            throw new Error(`Duplicate credential header: ${name}`)
        }
        seenNames.add(normalizedName)
    })
    let hasTokenHeader       = false
    let hasStoredHeaderToken = false
    let explicitHeaderToken  = ''

    headerNames.forEach((name) => {
        const existing = headerEntry(headers, name)
        if (!existing) {
            return
        }
        const [existingName, existingValue] = existing
        const prepared                      = tokenHeaderValue(existingName, String(existingValue ?? ''))
        headers[existingName]               = prepared.value
        hasTokenHeader                      = true
        if (prepared.token) {
            const headerIsMasked = maskedHeaderNames ?
                                   maskedHeaderNames.has(existingName.toLowerCase()) :
                                   Boolean(options.authIndex?.trim() && isMaskedApiKey(prepared.token))
            if (headerIsMasked) {
                hasStoredHeaderToken = true
            } else {
                if (explicitHeaderToken && explicitHeaderToken !== prepared.token) {
                    throw new Error('Multiple credential headers require different tokens')
                }
                explicitHeaderToken = prepared.token
            }
        } else if (prepared.value.includes(API_CALL_TOKEN) && !draftToken) {
            hasStoredHeaderToken = true
        }
    })

    if (explicitHeaderToken && hasStoredHeaderToken) {
        throw new Error('Multiple credential headers require different tokens')
    }
    if (explicitHeaderToken) {
        draftToken = explicitHeaderToken
    }
    if (!hasTokenHeader && (draftToken || options.authIndex?.trim())) {
        const prefix                     = options.authorizationScheme ? `${options.authorizationScheme} ` : ''
        headers[options.preferredHeader] = `${prefix}${API_CALL_TOKEN}`
    }

    return {
        headers,
        draftToken: draftToken || undefined,
    }
}

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

    const safeMessage = message ? redactSensitiveText(message) : ''

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
