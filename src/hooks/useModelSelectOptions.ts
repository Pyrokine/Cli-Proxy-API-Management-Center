import type {ModelEntry} from '@/components/providers/types'
import {useMemo} from 'react'

/**
 * Derives `{ value, label }[]` options from model entries for use in <Select>.
 * Deduplicates by trimmed name and appends the alias when it differs from the name.
 */
export function useModelSelectOptions(modelEntries: ModelEntry[]) {
    return useMemo(() => {
        const seen = new Set<string>()
        return modelEntries.reduce<Array<{ value: string; label: string }>>((acc, entry) => {
            const name = entry.name.trim()
            if (!name || seen.has(name)) {
                return acc
            }
            seen.add(name)
            const alias = entry.alias.trim()
            acc.push({
                         value: name,
                         label: alias && alias !== name ? `${name} (${alias})` : name,
                     })
            return acc
        }, [])
    }, [modelEntries])
}
