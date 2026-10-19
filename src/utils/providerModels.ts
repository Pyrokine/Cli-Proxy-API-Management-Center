import type {ModelEntry} from '@/components/ui/modelInputListUtils'
import type {ModelInfo} from '@/utils/models'

export function buildProviderAutoFetchSignature(
    endpoint: string,
    credentialGeneration: number,
    authIndex: string,
): string {
    return JSON.stringify({ endpoint, credentialGeneration, authIndex })
}

export function canApplyDiscoveredModels(
    selectedCount: number,
    disableControls: boolean,
    saving: boolean,
    fetching: boolean,
): boolean {
    return selectedCount > 0 && !disableControls && !saving && !fetching
}

export function findMissingProviderModelNames(
    entries: ModelEntry[],
    discoveredModels: ModelInfo[],
    normalizeName: (name: string) => string = (name) => name.trim(),
): Set<string> {
    const configured = new Set(
        entries
            .map((entry) => normalizeName(entry.name).toLowerCase())
            .filter(Boolean),
    )
    const missing    = new Set<string>()
    discoveredModels.forEach((model) => {
        const name = normalizeName(model.name)
        const key  = name.toLowerCase()
        if (!name || configured.has(key)) {
            return
        }
        configured.add(key)
        missing.add(model.name)
    })
    return missing
}

export function mergeProviderModelEntries(
    entries: ModelEntry[],
    discoveredModels: ModelInfo[],
    normalizeName: (name: string) => string = (name) => name.trim(),
): { entries: ModelEntry[]; addedCount: number } {
    const configured = new Set(
        entries.map((entry) => normalizeName(entry.name).toLowerCase()).filter(Boolean),
    )
    const mergedEntries = [...entries]
    const placeholderIndex = mergedEntries.findIndex(
        (entry) => !normalizeName(entry.name) && !entry.alias.trim() &&
            Object.entries(entry).every(([key, value]) => key === 'name' || key === 'alias' || value === undefined),
    )
    if (placeholderIndex >= 0) {
        mergedEntries.splice(placeholderIndex, 1)
    }

    let addedCount = 0
    discoveredModels.forEach((model) => {
        const name = normalizeName(model.name)
        const key = name.toLowerCase()
        if (!name || configured.has(key)) {
            return
        }
        configured.add(key)
        mergedEntries.push({ name, alias: model.alias?.trim() ?? '' })
        ++addedCount
    })

    return {
        entries: mergedEntries.length ? mergedEntries : [{ name: '', alias: '' }],
        addedCount,
    }
}
