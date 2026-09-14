import {invalidateAuthFileModelsCache} from '@/features/authFiles/authFileModelsCache'
import {useQuotaStore} from '@/stores/useQuotaStore'

const normalizeAuthFileMutationNames = (names: string[]): string[] =>
    Array.from(new Set(names.map((name) => name.trim()).filter(Boolean)))

export function invalidateAuthFileDerivedCaches(names?: string[], quotaKeys?: string[]): void {
    if (names === undefined) {
        invalidateAuthFileModelsCache()
        useQuotaStore.getState().clearQuotaCache()
        return
    }

    const normalized = normalizeAuthFileMutationNames(names)
    if (normalized.length > 0) {
        invalidateAuthFileModelsCache(normalized)
    }
    useQuotaStore.getState().clearQuotaSubjects(quotaKeys ?? [])
}
