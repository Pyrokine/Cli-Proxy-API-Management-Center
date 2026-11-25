import {apiClient} from '@/services/api/client'
import type {AuthFileItem, AuthFileModelItem} from '@/types/authFile'
import {authFileSelectionKey} from './identity'

type AuthFileModelsLoader = (name: string, authIndex?: AuthFileItem['authIndex']) => Promise<AuthFileModelItem[]>

type CacheEntry = {
    fileName: string
    authGeneration: number
    cacheGeneration: number
    fileGeneration: number
    models: AuthFileModelItem[]
}

type InFlightEntry = {
    signature: string
    promise: Promise<AuthFileModelItem[] | null>
}

const cache           = new Map<string, CacheEntry>()
const inFlight        = new Map<string, InFlightEntry>()
const fileGenerations = new Map<string, number>()
let cacheGeneration   = 0

const normalizeModelItems = (value: unknown): AuthFileModelItem[] => {
    if (!Array.isArray(value)) {
        return []
    }
    const byId = new Map<string, AuthFileModelItem>()
    value.forEach((item) => {
        if (!item || typeof item !== 'object') {
            return
        }
        const entry = item as Record<string, unknown>
        const id    = typeof entry.id === 'string' ? entry.id.trim() : ''
        if (!id) {
            return
        }
        const normalized: AuthFileModelItem = { id }
        if (typeof entry.display_name === 'string' && entry.display_name.trim()) {
            normalized.display_name = entry.display_name.trim()
        }
        if (typeof entry.type === 'string' && entry.type.trim()) {
            normalized.type = entry.type.trim()
        }
        if (typeof entry.owned_by === 'string' && entry.owned_by.trim()) {
            normalized.owned_by = entry.owned_by.trim()
        }
        const key = id
        if (!byId.has(key)) {
            byId.set(key, normalized)
        }
    })
    return [...byId.values()].sort((left, right) =>
                                       left.id.localeCompare(right.id, undefined, { sensitivity: 'base' }),
    )
}

const fileGenerationFor = (name: string): number => fileGenerations.get(name) ?? 0

export async function loadAuthFileModels(
    name: string,
    loader: AuthFileModelsLoader,
    authIndex?: AuthFileItem['authIndex'],
): Promise<AuthFileModelItem[] | null> {
    const fileName = name.trim()
    if (!fileName) {
        return []
    }

    const cacheKey               = authFileSelectionKey({ name: fileName, authIndex })
    const authGeneration         = apiClient.getAuthGeneration()
    const currentCacheGeneration = cacheGeneration
    const currentFileGeneration  = fileGenerationFor(fileName)
    const cached                 = cache.get(cacheKey)
    if (
        cached &&
        cached.authGeneration === authGeneration &&
        cached.cacheGeneration === currentCacheGeneration &&
        cached.fileGeneration === currentFileGeneration
    ) {
        return [...cached.models]
    }

    const signature = `${authGeneration}:${currentCacheGeneration}:${currentFileGeneration}`
    const pending   = inFlight.get(cacheKey)
    if (pending?.signature === signature) {
        const result = await pending.promise
        return result ? [...result] : null
    }

    const promise = loader(fileName, authIndex)
        .then((models) => normalizeModelItems(models))
        .then((models) => {
            const current =
                      authGeneration === apiClient.getAuthGeneration() &&
                      currentCacheGeneration === cacheGeneration &&
                      currentFileGeneration === fileGenerationFor(fileName)
            if (!current) {
                return null
            }
            cache.set(cacheKey, {
                fileName,
                authGeneration,
                cacheGeneration: currentCacheGeneration,
                fileGeneration: currentFileGeneration,
                models,
            })
            return models
        })
        .finally(() => {
            if (inFlight.get(cacheKey)?.promise === promise) {
                inFlight.delete(cacheKey)
            }
        })

    inFlight.set(cacheKey, { signature, promise })
    const result = await promise
    return result ? [...result] : null
}

export function invalidateAuthFileModelsCache(names?: string[]): void {
    if (names === undefined) {
        cacheGeneration += 1
        cache.clear()
        fileGenerations.clear()
        return
    }

    const normalized = new Set(names.map((name) => name.trim()).filter(Boolean))
    for (const [key, entry] of cache) {
        if (normalized.has(entry.fileName)) {
            cache.delete(key)
        }
    }
    normalized.forEach((name) => fileGenerations.set(name, fileGenerationFor(name) + 1))
}

export const clearAuthFileModelsCache = (): void => invalidateAuthFileModelsCache()

export const getCachedAuthFileModels = (
    name: string,
    authIndex?: AuthFileItem['authIndex'],
): AuthFileModelItem[] | null => {
    const fileName = name.trim()
    const entry    = cache.get(authFileSelectionKey({ name: fileName, authIndex }))
    if (
        !entry ||
        entry.authGeneration !== apiClient.getAuthGeneration() ||
        entry.cacheGeneration !== cacheGeneration ||
        entry.fileGeneration !== fileGenerationFor(fileName)
    ) {
        return null
    }
    return [...entry.models]
}
