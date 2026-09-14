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
    const mergedMap = new Map<string, ModelEntry>()
    entries.forEach((entry) => {
        const name = normalizeName(entry.name)
        if (!name) {
            return
        }
        mergedMap.set(name.toLowerCase(), {
            ...entry,
            name,
            alias: entry.alias.trim(),
        })
    })

    let addedCount = 0
    discoveredModels.forEach((model) => {
        const name = normalizeName(model.name)
        if (!name || mergedMap.has(name.toLowerCase())) {
            return
        }
        mergedMap.set(name.toLowerCase(), { name, alias: '' })
        ++addedCount
    })

    const mergedEntries = Array.from(mergedMap.values())
    return {
        entries: mergedEntries.length ? mergedEntries : [{ name: '', alias: '' }],
        addedCount,
    }
}
