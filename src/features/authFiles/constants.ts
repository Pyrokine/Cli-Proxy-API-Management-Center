import type { AuthFileItem } from '@/types'
import { formatDateTime } from '@/utils/format'
import { type KeyStatBucket, type KeyStats, normalizeAuthIndex, normalizeUsageSourceId } from '@/utils/usage'

const AUTH_FILE_PROVIDER_ALIASES: Record<string, string[]> = {
    claude: ['claude', 'anthropic', 'antigravity'],
    antigravity: ['antigravity', 'claude', 'anthropic'],
    codex: ['codex'],
    gemini: ['gemini', 'gemini-cli', 'aistudio'],
    'gemini-cli': ['gemini-cli', 'gemini', 'aistudio'],
    aistudio: ['aistudio', 'gemini-cli', 'gemini'],
    vertex: ['vertex'],
    kimi: ['kimi'],
    qwen: ['qwen'],
    iflow: ['iflow'],
    ampcode: ['ampcode'],
}

const AUTH_FILE_PREFIX_REGEX =
    /^(gemini-cli|claude|anthropic|antigravity|codex|gemini|aistudio|kimi|qwen|vertex|iflow|ampcode)-(.+)$/i
const AUTH_FILE_SUFFIX_HINTS = new Set(['plus', 'pro', 'free', 'team', 'max', 'ultra', 'sonnet', 'opus', 'haiku'])

const hasTraffic = (bucket?: KeyStatBucket) => !!bucket && (bucket.success > 0 || bucket.failure > 0)

const appendUnique = (items: string[], value: string) => {
    const trimmed = value.trim()
    if (!trimmed || items.includes(trimmed)) {
        return
    }
    items.push(trimmed)
}

const normalizeProviderName = (value: unknown): string =>
    String(value ?? '')
        .trim()
        .toLowerCase()

export function inferProviderFromAuthFileName(name: string): string {
    const trimmed = String(name ?? '').trim()
    if (!trimmed) {
        return ''
    }

    const nameWithoutExt = trimmed.replace(/\.[^/.]+$/, '')
    const base = nameWithoutExt || trimmed
    const prefixMatch = base.match(AUTH_FILE_PREFIX_REGEX)
    return prefixMatch?.[1]?.toLowerCase() || ''
}

export function formatAuthFileDisplayName(name: string): string {
    const trimmed = String(name ?? '').trim()
    if (!trimmed) {
        return ''
    }

    const nameWithoutExt = trimmed.replace(/\.[^/.]+$/, '')
    const base = nameWithoutExt || trimmed
    const prefixMatch = base.match(AUTH_FILE_PREFIX_REGEX)
    if (prefixMatch?.[2]) {
        const candidates: string[] = []
        appendRemainderCandidates(candidates, prefixMatch[2])
        return candidates[candidates.length - 1] || prefixMatch[2]
    }

    return base
}

const buildAuthFileProviderCandidates = (file: AuthFileItem): string[] => {
    const providers: string[] = []
    const provider = normalizeProviderName(file.provider)
    const type = normalizeProviderName(file.type)

    const appendProviderAliases = (name: string) => {
        appendUnique(providers, name)
        ;(AUTH_FILE_PROVIDER_ALIASES[name] || []).forEach((candidate) => appendUnique(providers, candidate))
    }

    appendProviderAliases(provider)
    appendProviderAliases(type)
    return providers
}

const appendRemainderCandidates = (items: string[], value: string) => {
    appendUnique(items, value)

    let current = value.trim()
    const atIndex = current.indexOf('@')
    if (atIndex >= 0) {
        while (true) {
            const lastDash = current.lastIndexOf('-')
            if (lastDash <= 0 || lastDash < atIndex) {
                break
            }
            current = current.slice(0, lastDash)
            appendUnique(items, current)
        }
        return
    }

    while (true) {
        const lastDash = current.lastIndexOf('-')
        if (lastDash <= 0) {
            break
        }
        const suffix = current.slice(lastDash + 1).toLowerCase()
        if (!AUTH_FILE_SUFFIX_HINTS.has(suffix) && !/^\d+$/.test(suffix)) {
            break
        }
        current = current.slice(0, lastDash)
        appendUnique(items, current)
    }
}

function buildAuthFileSourceCandidates(file: AuthFileItem): string[] {
    const candidates: string[] = []
    const rawFileName = String(file?.name || '').trim()
    if (!rawFileName) {
        return candidates
    }

    appendUnique(candidates, rawFileName)

    const nameWithoutExt = rawFileName.replace(/\.[^/.]+$/, '')
    if (nameWithoutExt && nameWithoutExt !== rawFileName) {
        appendUnique(candidates, nameWithoutExt)
    }

    const base = nameWithoutExt || rawFileName
    const prefixMatch = base.match(AUTH_FILE_PREFIX_REGEX)
    if (prefixMatch?.[2]) {
        appendRemainderCandidates(candidates, prefixMatch[2])
    }

    return candidates
}

export function buildAuthFileUsageSourceIds(file: AuthFileItem): string[] {
    return buildAuthFileSourceCandidates(file)
        .map((candidate) => normalizeUsageSourceId(candidate))
        .filter((candidate, index, array) => !!candidate && array.indexOf(candidate) === index)
}

export function resolveAuthFileStats(file: AuthFileItem, stats: KeyStats): KeyStatBucket {
    const defaultStats: KeyStatBucket = { success: 0, failure: 0 }
    const sourceCandidates = buildAuthFileSourceCandidates(file)
    const providerCandidates = buildAuthFileProviderCandidates(file)

    for (const source of sourceCandidates) {
        for (const provider of providerCandidates) {
            const qualifiedKey = normalizeUsageSourceId(`${provider}:${source}`)
            const bucket = qualifiedKey ? stats.bySourceQualified?.[qualifiedKey] : undefined
            if (bucket && hasTraffic(bucket)) {
                return bucket
            }
        }
    }

    for (const source of sourceCandidates) {
        const sourceKey = normalizeUsageSourceId(source)
        const bucket = sourceKey ? stats.bySource?.[sourceKey] : undefined
        if (bucket && hasTraffic(bucket)) {
            return bucket
        }
    }

    const rawAuthIndex = file['auth_index'] ?? file.authIndex
    const authIndexKey = normalizeAuthIndex(rawAuthIndex)
    if (authIndexKey && stats.byAuthIndex?.[authIndexKey]) {
        return stats.byAuthIndex[authIndexKey]
    }

    return defaultStats
}

export const formatModified = (item: AuthFileItem): string => {
    const raw = item['modtime'] ?? item.modified
    if (!raw) {
        return '-'
    }
    const asNumber = Number(raw)
    const date =
        Number.isFinite(asNumber) && !Number.isNaN(asNumber)
            ? new Date(asNumber < 1e12 ? asNumber * 1000 : asNumber)
            : new Date(String(raw))
    return Number.isNaN(date.getTime()) ? '-' : formatDateTime(date)
}
