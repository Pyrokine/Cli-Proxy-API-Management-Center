import type { AmpcodeConfig, AmpcodeModelMapping, ApiKeyEntry } from '@/types'
import type { AmpcodeFormState, ModelEntry } from './types'

export const parseTextList = (text: string): string[] =>
    text
        .split(/[\n,]+/)
        .map((item) => item.trim())
        .filter(Boolean)

export const excludedModelsToText = (models?: string[]) => (Array.isArray(models) ? models.join('\n') : '')

const normalizeOpenAIBaseUrl = (baseUrl: string): string => {
    let trimmed = String(baseUrl || '').trim()
    if (!trimmed) {
        return ''
    }
    trimmed = trimmed.replace(/\/?v0\/management\/?$/i, '')
    trimmed = trimmed.replace(/\/+$/g, '')
    if (!/^https?:\/\//i.test(trimmed)) {
        // noinspection HttpUrlsUsage
        trimmed = `http://${trimmed}`
    }
    return trimmed
}

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

export const buildOpenAIChatCompletionsEndpoint = (baseUrl: string): string => {
    const trimmed = normalizeOpenAIBaseUrl(baseUrl)
    if (!trimmed) {
        return ''
    }
    if (trimmed.endsWith('/chat/completions')) {
        return trimmed
    }
    return `${trimmed}/chat/completions`
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
})

const ampcodeMappingsToEntries = (mappings?: AmpcodeModelMapping[]): ModelEntry[] => {
    if (!Array.isArray(mappings) || mappings.length === 0) {
        return [{ name: '', alias: '' }]
    }
    return mappings.map((mapping) => ({
        name: mapping.from ?? '',
        alias: mapping.to ?? '',
    }))
}

export const entriesToAmpcodeMappings = (entries: ModelEntry[]): AmpcodeModelMapping[] => {
    const seen = new Set<string>()
    const mappings: AmpcodeModelMapping[] = []

    entries.forEach((entry) => {
        const from = entry.name.trim()
        const to = entry.alias.trim()
        if (!from || !to) {
            return
        }
        const key = from.toLowerCase()
        if (seen.has(key)) {
            return
        }
        seen.add(key)
        mappings.push({ from, to })
    })

    return mappings
}

export const buildAmpcodeFormState = (ampcode?: AmpcodeConfig | null): AmpcodeFormState => ({
    upstreamUrl: ampcode?.upstreamUrl ?? '',
    upstreamApiKey: '',
    forceModelMappings: ampcode?.forceModelMappings ?? false,
    mappingEntries: ampcodeMappingsToEntries(ampcode?.modelMappings),
})
