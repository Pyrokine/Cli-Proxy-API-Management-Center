import type {GeminiKeyConfig, OpenAIProviderConfig, ProviderKeyConfig} from '@/types'
import type {CredentialInfo, SourceInfo} from '@/types/sourceInfo'
import {buildCandidateUsageSourceIds, normalizeAuthIndex} from '@/utils/usage'

interface SourceInfoMapInput {
    geminiApiKeys?: GeminiKeyConfig[]
    claudeApiKeys?: ProviderKeyConfig[]
    codexApiKeys?: ProviderKeyConfig[]
    vertexApiKeys?: ProviderKeyConfig[]
    openaiCompatibility?: OpenAIProviderConfig[]
}

export function buildSourceInfoMap(input: SourceInfoMapInput): Map<string, SourceInfo> {
    const map = new Map<string, SourceInfo>()

    const registerSource = (sourceId: string, displayName: string, type: string) => {
        if (!sourceId || !displayName) {
            return
        }
        const info = { displayName, type }
        if (!map.has(sourceId)) {
            map.set(sourceId, info)
        }
        const qualifiedId = `${type}:${sourceId}`
        if (!map.has(qualifiedId)) {
            map.set(qualifiedId, info)
        }
    }

    const registerCandidates = (displayName: string, type: string, candidates: string[]) => {
        candidates.forEach((sourceId) => registerSource(sourceId, displayName, type))
    }

    const providers: Array<{
        items: Array<{ apiKey?: string; prefix?: string }>
        type: string
        label: string
    }> = [
        { items: input.geminiApiKeys || [], type: 'gemini', label: 'Gemini' },
        { items: input.claudeApiKeys || [], type: 'claude', label: 'Claude' },
        { items: input.codexApiKeys || [], type: 'codex', label: 'Codex' },
        { items: input.vertexApiKeys || [], type: 'vertex', label: 'Vertex' },
    ]

    providers.forEach(({ items, type, label }) => {
        items.forEach((item, index) => {
            const displayName = item.prefix?.trim() || `${label} #${index + 1}`
            registerCandidates(
                displayName,
                type,
                buildCandidateUsageSourceIds({ apiKey: item.apiKey, prefix: item.prefix }),
            )
        })
    })

    // OpenAI 特殊处理：多 apiKeyEntries
    ;(input.openaiCompatibility || []).forEach((provider, providerIndex) => {
        const displayName = provider.prefix?.trim() || provider.name || `OpenAI #${providerIndex + 1}`
        const candidates  = new Set<string>()
        buildCandidateUsageSourceIds({ prefix: provider.prefix }).forEach((id) => candidates.add(id))
        ;(provider.apiKeyEntries || []).forEach((entry) => {
            buildCandidateUsageSourceIds({ apiKey: entry.apiKey }).forEach((id) => candidates.add(id))
        })
        const sourceIds = Array.from(candidates)
        registerCandidates(displayName, 'openai', sourceIds)
        const providerType = provider.name?.trim().toLowerCase()
        if (providerType && providerType !== 'openai') {
            registerCandidates(displayName, providerType, sourceIds)
        }
    })

    return map
}

export function resolveSourceDisplay(
    sourceRaw: string,
    authIndex: unknown,
    sourceInfoMap: Map<string, SourceInfo>,
    authFileMap: Map<string, CredentialInfo>,
    providerRaw = '',
): SourceInfo {
    const source   = sourceRaw.trim()
    const provider = providerRaw.trim().toLowerCase()
    const matched  = (provider ? sourceInfoMap.get(`${provider}:${source}`) : undefined) ?? sourceInfoMap.get(source)
    if (matched && (!provider || matched.type.trim().toLowerCase() === provider)) {
        return matched
    }

    const sourceInfo = authFileMap.get(source)
    if (sourceInfo && (!provider || sourceInfo.type.trim().toLowerCase() === provider)) {
        return { displayName: sourceInfo.name || source, type: provider || sourceInfo.type }
    }

    const authIndexKey = normalizeAuthIndex(authIndex)
    if (authIndexKey) {
        const authInfo = authFileMap.get(authIndexKey)
        if (authInfo && (!provider || authInfo.type.trim().toLowerCase() === provider)) {
            return { displayName: authInfo.name || authIndexKey, type: provider || authInfo.type }
        }
    }

    return {
        displayName: source.startsWith('t:') ? source.slice(2) : source || '-',
        type: provider,
    }
}
