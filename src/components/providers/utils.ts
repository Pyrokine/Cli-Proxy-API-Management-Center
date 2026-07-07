import type {ApiKeyEntry} from '@/types'

export const parseTextList = (text: string): string[] =>
    text
        .split(/[\n,]+/)
        .map((item) => item.trim())
        .filter(Boolean)

export const excludedModelsToText = (models?: string[]) => (Array.isArray(models) ? models.join('\n') : '')

const normalizeClaudeBaseUrl = (baseUrl: string): string => {
    let trimmed = String(baseUrl || '').trim()
    if (!trimmed) {
        return 'https://api.anthropic.com'
    }
    trimmed = trimmed.replace(/\/?v0\/management\/?$/i, '')
    trimmed = trimmed.replace(/\/+$/g, '')
    if (!/^https?:\/\//i.test(trimmed)) {
        // noinspection HttpUrlsUsage
        trimmed = `http://${trimmed}`
    }
    return trimmed
}

export const buildClaudeMessagesEndpoint = (baseUrl: string): string => {
    const trimmed = normalizeClaudeBaseUrl(baseUrl)
    if (!trimmed) {
        return ''
    }
    if (trimmed.endsWith('/v1/messages')) {
        return trimmed
    }
    if (trimmed.endsWith('/v1')) {
        return `${trimmed}/messages`
    }
    return `${trimmed}/v1/messages`
}

export const buildApiKeyEntry = (input?: Partial<ApiKeyEntry>): ApiKeyEntry => ({
    apiKey: input?.apiKey ?? '',
    proxyUrl: input?.proxyUrl ?? '',
    headers: input?.headers ?? {},
    authIndex: input?.authIndex ?? '',
})
