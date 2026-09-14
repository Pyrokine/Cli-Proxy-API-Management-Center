import type {ApiKeyEntry} from '@/types'
import type {GeminiFormState} from './types'

export const parseTextList = (text: string): string[] =>
    text
        .split(/[\n,]+/)
        .map((item) => item.trim())
        .filter(Boolean)

export const excludedModelsToText = (models?: string[]) => (Array.isArray(models) ? models.join('\n') : '')

export const buildEmptyGeminiForm = (): GeminiFormState => ({
    apiKey: '',
    priority: undefined,
    weight: undefined,
    prefix: '',
    baseUrl: '',
    proxyUrl: '',
    headers: [],
    modelEntries: [{ name: '', alias: '' }],
    excludedModels: [],
    excludedText: '',
})

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

const DEFAULT_GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com'

export const INTERACTIONS_API_REVISION = '2026-05-20'

export const buildInteractionsProbePayload = (model: string) => ({
    model,
    input: 'Hi',
})

export const buildInteractionsEndpoint = (baseUrl: string): string => {
    let trimmed = String(baseUrl || '').trim() || DEFAULT_GEMINI_BASE_URL
    trimmed     = trimmed.replace(/\/+$/g, '')
    if (!/^https?:\/\//i.test(trimmed)) {
        // noinspection HttpUrlsUsage
        trimmed = `http://${trimmed}`
    }
    if (/\/v1beta\/interactions$/i.test(trimmed)) {
        return trimmed
    }

    let root = trimmed.replace(/\/v1beta\/models$/i, '')
    if (/\/v1beta$/i.test(root)) {
        return `${root}/interactions`
    }
    root = root.replace(/\/v1beta(?:\/.*)?$/i, '')
    return `${root}/v1beta/interactions`
}

export const buildApiKeyEntry = (input?: Partial<ApiKeyEntry>): ApiKeyEntry => ({
    apiKey: input?.apiKey ?? '',
    proxyUrl: input?.proxyUrl ?? '',
    headers: input?.headers ?? {},
    authIndex: input?.authIndex ?? '',
    weight: input?.weight,
})
