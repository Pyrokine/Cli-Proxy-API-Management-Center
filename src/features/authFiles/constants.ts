import type {AuthFileItem} from '@/types'
import {formatDateTime} from '@/utils/format'

const AUTH_FILE_PREFIX_REGEX =
          /^(?<vendor>gemini-cli|claude|anthropic|antigravity|codex|gemini|aistudio|kimi|qwen|x-ai|xai|grok|vertex|iflow)-(?<rest>.+)$/i
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
