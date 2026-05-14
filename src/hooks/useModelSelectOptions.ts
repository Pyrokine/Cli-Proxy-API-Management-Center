import type { ModelEntry } from '@/components/providers/types'
import { useMemo } from 'react'

/**
 * Derives `{ value, label }[]` options from model entries for use in <Select>.
 * Deduplicates by normalized model name, keeps the first visible name, and sorts the result.
 */
export function useModelSelectOptions(modelEntries: ModelEntry[]) {
    return useMemo(() => {
        const entries = new Map<string, { value: string; alias: string }>()

        modelEntries.forEach((entry) => {
            const value = entry.name.trim()
            if (!value) {
                return
            }

            const key = value.toLowerCase()
            const alias = entry.alias.trim()
            const normalizedAlias = alias && alias !== value ? alias : ''
            const existing = entries.get(key)

            if (!existing) {
                entries.set(key, { value, alias: normalizedAlias })
                return
            }

            if (!existing.alias && normalizedAlias && normalizedAlias !== existing.value) {
                entries.set(key, { ...existing, alias: normalizedAlias })
            }
        })

        return Array.from(entries.values())
            .sort((a, b) => a.value.localeCompare(b.value, undefined, { sensitivity: 'base' }))
            .map((entry) => ({
                value: entry.value,
                label: entry.alias && entry.alias !== entry.value ? `${entry.value} (${entry.alias})` : entry.value,
            }))
    }, [modelEntries])
}
