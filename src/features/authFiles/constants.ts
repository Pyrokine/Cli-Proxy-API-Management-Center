import type {AuthFileItem} from '@/types'
import {normalizeBooleanValue} from '@/utils/boolean'
import {formatDateTime} from '@/utils/format'

const AUTH_FILE_PREFIX_REGEX = new RegExp(
    '^(?<vendor>gemini-cli|claude|anthropic|antigravity|codex|' +
    'gemini|aistudio|kimi-ai|kimi|meta|muse|qwen|x-ai|xai|grok|devin|cognition|vertex|iflow)' +
    '-(?<rest>.+)$',
    'i',
)
const AUTH_FILE_SUFFIX_HINTS = new Set(['plus', 'pro', 'free', 'team', 'max', 'ultra', 'sonnet', 'opus', 'haiku'])
const INTEGER_STRING_PATTERN = /^[+-]?\d+$/

const appendUnique = (items: string[], value: string) => {
    const trimmed = value.trim()
    if (!trimmed || items.includes(trimmed)) {
        return
    }
    items.push(trimmed)
}

export function inferProviderFromAuthFileName(name: string): string {
    const trimmed = String(name ?? '').trim()
    if (!trimmed) {
        return ''
    }

    const nameWithoutExt = trimmed.replace(/\.[^/.]+$/, '')
    const base           = nameWithoutExt || trimmed
    const prefixMatch    = base.match(AUTH_FILE_PREFIX_REGEX)
    return prefixMatch?.groups?.vendor?.toLowerCase() || ''
}

export function formatAuthFileDisplayName(name: string): string {
    const trimmed = String(name ?? '').trim()
    if (!trimmed) {
        return ''
    }

    const nameWithoutExt = trimmed.replace(/\.[^/.]+$/, '')
    const base           = nameWithoutExt || trimmed
    const prefixMatch    = base.match(AUTH_FILE_PREFIX_REGEX)
    if (prefixMatch?.groups?.rest) {
        const candidates: string[] = []
        appendRemainderCandidates(candidates, prefixMatch.groups.rest)
        return candidates[candidates.length - 1] || prefixMatch.groups.rest
    }

    return base
}

const appendRemainderCandidates = (items: string[], value: string) => {
    appendUnique(items, value)

    let current   = value.trim()
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

export const normalizeAuthFileProvider = (provider: unknown): string => {
    const normalized = typeof provider === 'string' ? provider.trim().toLowerCase() : ''
    if (normalized === 'x-ai' || normalized === 'grok') {
        return 'xai'
    }
    if (normalized === 'cognition') {
        return 'devin'
    }
    return normalized === 'muse' ? 'meta' : normalized
}

export const supportsAuthFileUsingApi = (provider: unknown): boolean =>
    normalizeAuthFileProvider(provider) === 'xai'

export const supportsAuthFileWebsockets = (provider: unknown): boolean =>
    ['codex', 'xai'].includes(normalizeAuthFileProvider(provider))

export const readAuthFileWebsockets = (file: Record<string, unknown>): boolean | undefined =>
    normalizeBooleanValue(file.websockets)

export const readAuthFileUsingApi = (file: Record<string, unknown>): boolean =>
    normalizeBooleanValue(file.usingApi ?? file.using_api) ?? false

export const applyAuthFileUsingApi = (
    file: Record<string, unknown>,
    usingApi: boolean,
): Record<string, unknown> => ({ ...file, using_api: usingApi })

const readOverrideValue = (file: Record<string, unknown>, keys: string[]): unknown => {
    const key = keys.find((name) => Object.prototype.hasOwnProperty.call(file, name))
    return key === undefined ? undefined : file[key]
}

export const readAuthFileDisableCooling = (file: Record<string, unknown>): boolean | undefined =>
    normalizeBooleanValue(readOverrideValue(file, ['disable_cooling', 'disable-cooling', 'disableCooling']))

export const readAuthFileRequestRetry = (file: Record<string, unknown>): number | undefined => {
    const value = parsePriorityValue(readOverrideValue(file, ['request_retry', 'request-retry', 'requestRetry']))
    return value !== undefined && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

export const parsePriorityValue = (value: unknown): number | undefined => {
    if (typeof value === 'number') {
        return Number.isInteger(value) ? value : undefined
    }
    if (typeof value !== 'string') {
        return undefined
    }
    const trimmed = value.trim()
    if (!trimmed || !INTEGER_STRING_PATTERN.test(trimmed)) {
        return undefined
    }
    const parsed = Number.parseInt(trimmed, 10)
    return Number.isSafeInteger(parsed) ? parsed : undefined
}

export const formatModified = (item: AuthFileItem): string => {
    const raw = item['modtime'] ?? item.modified
    if (!raw) {
        return '-'
    }
    const asNumber = Number(raw)
    const date     =
              Number.isFinite(asNumber) && !Number.isNaN(asNumber)
              ? new Date(asNumber < 1e12 ? asNumber * 1000 : asNumber)
              : new Date(String(raw))
    return Number.isNaN(date.getTime()) ? '-' : formatDateTime(date)
}
