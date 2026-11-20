import type {VisualConfigValidationErrorCode} from '@/types/visualConfig'
import {parse as parseYaml} from 'yaml'

export function getOAuthModelAliasError(text: string): VisualConfigValidationErrorCode | undefined {
    if (!text.trim()) {
        return undefined
    }
    let value: unknown
    try {
        value = parseYaml(text)
    } catch {
        return 'oauth_alias_invalid'
    }
    if (value === null) {
        return undefined
    }
    if (typeof value !== 'object' || Array.isArray(value)) {
        return 'oauth_alias_invalid'
    }
    const channels = new Set<string>()
    for (const [channel, rows] of Object.entries(value as Record<string, unknown>)) {
        const channelKey = channel.trim().toLowerCase()
        if (!channelKey || channels.has(channelKey) || !Array.isArray(rows)) {
            return 'oauth_alias_invalid'
        }
        channels.add(channelKey)
        const edges = new Map<string, string>()
        for (const row of rows) {
            if (!row || typeof row !== 'object' || Array.isArray(row)) {
                return 'oauth_alias_invalid'
            }
            const item = row as Record<string, unknown>
            if (typeof item.name !==
                'string' ||
                typeof item.alias !==
                'string' ||
                !item.name.trim() ||
                !item.alias.trim()) {
                return 'oauth_alias_empty'
            }
            if (item.fork !== undefined && typeof item.fork !== 'boolean') {
                return 'oauth_alias_invalid'
            }
            const name  = item.name.trim().toLowerCase()
            const alias = item.alias.trim().toLowerCase()
            if (name === alias) {
                return 'oauth_alias_self'
            }
            if (edges.has(alias)) {
                return 'oauth_alias_conflict'
            }
            edges.set(alias, name)
        }
        const resolved = new Set<string>()
        for (const alias of edges.keys()) {
            const path  = new Set<string>()
            let current = alias
            while (true) {
                const target = edges.get(current)
                if (target === undefined || resolved.has(current)) {
                    break
                }
                if (path.has(current)) {
                    return 'oauth_alias_cycle'
                }
                path.add(current)
                current = target
            }
            path.forEach((node) => resolved.add(node))
        }
    }
    return undefined
}
