import type {AmpcodeConfig, AmpcodeModelMapping, AmpcodeUpstreamApiKeyMapping, ApiKeyEntry} from '@/types'
import type {AmpcodeFormState, AmpcodeUpstreamApiKeyEntry, ModelEntry} from './types'

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
    const seen                            = new Set<string>()
    const mappings: AmpcodeModelMapping[] = []

    entries.forEach((entry) => {
        const from = entry.name.trim()
        const to   = entry.alias.trim()
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

const ampcodeUpstreamApiKeysToEntries = (entries?: AmpcodeUpstreamApiKeyMapping[]): AmpcodeUpstreamApiKeyEntry[] => {
    if (!Array.isArray(entries) || entries.length === 0) {
        return [{ upstreamApiKey: '', clientApiKeysText: '' }]
    }
    return entries.map((entry) => ({
        upstreamApiKey: entry.upstreamApiKey ?? '',
        clientApiKeysText: Array.isArray(entry.apiKeys) ? entry.apiKeys.join('\n') : '',
    }))
}

export const entriesToAmpcodeUpstreamApiKeys = (
    entries: AmpcodeUpstreamApiKeyEntry[],
): AmpcodeUpstreamApiKeyMapping[] => {
    const seen                                     = new Set<string>()
    const mappings: AmpcodeUpstreamApiKeyMapping[] = []

    entries.forEach((entry) => {
        const upstreamApiKey = entry.upstreamApiKey.trim()
        if (!upstreamApiKey || seen.has(upstreamApiKey)) {
            return
        }
        const apiKeys = parseTextList(entry.clientApiKeysText)
        if (!apiKeys.length) {
            return
        }
        seen.add(upstreamApiKey)
        mappings.push({ upstreamApiKey, apiKeys: Array.from(new Set(apiKeys)) })
    })

    return mappings
}

export const buildAmpcodeFormState = (ampcode?: AmpcodeConfig | null): AmpcodeFormState => ({
    upstreamUrl: ampcode?.upstreamUrl ?? '',
    upstreamApiKey: '',
    upstreamApiKeyEntries: ampcodeUpstreamApiKeysToEntries(ampcode?.upstreamApiKeys),
    forceModelMappings: ampcode?.forceModelMappings ?? false,
    mappingEntries: ampcodeMappingsToEntries(ampcode?.modelMappings),
})
