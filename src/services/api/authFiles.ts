/**
 * 认证文件与 OAuth 排除模型相关 API
 */

import type {OAuthModelAliasEntry} from '@/types'
import type {
    AuthFileItem,
    AuthFileModelItem,
    AuthFileRuntimeError,
    AuthFilesResponse,
    RecentRequestBucket,
} from '@/types/authFile'
import {normalizeBooleanValue} from '@/utils/boolean'
import {normalizeExcludedModelsValue} from '@/utils/excludedModels'
import {apiClient} from './client'

type AuthFileStatusResponse = { status: string; disabled: boolean }
export type AuthFileFieldsPatch = {
    prefix?: string
    proxy_url?: string
    headers?: Record<string, string>
    priority?: number
    weight?: number | null
    note?: string
    disable_cooling?: boolean
    using_api?: boolean
    excluded_models?: string[]
}
type AuthFileBatchFailure = { name: string; error: string }

const normalizeRecentRequestBuckets = (value: unknown): RecentRequestBucket[] => {
    if (!Array.isArray(value)) {
        return []
    }

    return value.reduce<RecentRequestBucket[]>((result, item) => {
        if (!item || typeof item !== 'object') {
            return result
        }
        const entry   = item as Record<string, unknown>
        const time    = String(entry.time ?? '').trim()
        const success = normalizeRequiredNumber(entry.success)
        const failed  = normalizeRequiredNumber(entry.failed)
        if (!time) {
            return result
        }
        result.push({
                        time,
                        startTimeMs: normalizeNumber(entry.start_time_ms ?? entry.startTimeMs),
                        endTimeMs: normalizeNumber(entry.end_time_ms ?? entry.endTimeMs),
                        success: Number.isFinite(success) ? success : 0,
                        failed: Number.isFinite(failed) ? failed : 0,
                    })
        return result
    }, [])
}

const normalizeNumber = (value: unknown): number | undefined => {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value
    }
    if (typeof value === 'string' && value.trim()) {
        const parsed = Number(value)
        return Number.isFinite(parsed) ? parsed : undefined
    }
    return undefined
}

const normalizeRequiredNumber = (value: unknown): number => normalizeNumber(value) ?? 0

const normalizeString = (value: unknown): string | undefined => {
    if (typeof value !== 'string') {
        return undefined
    }
    const trimmed = value.trim()
    return trimmed || undefined
}

const normalizeStringOrNumber = (value: unknown): string | number | undefined =>
    typeof value === 'string' || typeof value === 'number' ? value : undefined

const normalizeRuntimeError = (value: unknown): AuthFileRuntimeError | undefined => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return undefined
    }
    const error   = value as Record<string, unknown>
    const code    = normalizeString(error.code)
    const message = normalizeString(error.message) ?? code
    if (!message) {
        return undefined
    }
    return {
        code,
        message,
        httpStatus: normalizeNumber(error.http_status ?? error.httpStatus),
        model: normalizeString(error.model),
        effectScope: normalizeString(error.effect_scope ?? error.effectScope),
        effectKey: normalizeString(error.effect_key ?? error.effectKey),
        nextRetryAfter: normalizeStringOrNumber(error.next_retry_after ?? error.nextRetryAfter),
        stateGeneration: normalizeNumber(error.state_generation ?? error.stateGeneration),
        observedAt: normalizeStringOrNumber(
            error.observed_at ?? error.observedAt ?? error.updated_at ?? error.updatedAt,
        ),
    }
}

const normalizeAuthFileItem = (value: unknown): AuthFileItem | null => {
    if (!value || typeof value !== 'object') {
        return null
    }

    const entry = value as Record<string, unknown>
    const name  = String(entry.name ?? '').trim()
    if (!name) {
        return null
    }

    return {
        ...entry,
        name,
        type: typeof entry.type === 'string' ? entry.type : undefined,
        provider: typeof entry.provider === 'string' ? entry.provider : undefined,
        size: normalizeNumber(entry.size),
        authIndex:
            typeof entry.auth_index === 'string' || typeof entry.auth_index === 'number'
            ? (entry.auth_index as string | number)
            : typeof entry.authIndex === 'string' || typeof entry.authIndex === 'number'
              ? (entry.authIndex as string | number)
              : undefined,
        runtimeOnly:
            typeof entry.runtime_only === 'boolean' || typeof entry.runtime_only === 'string'
            ? (entry.runtime_only as boolean | string)
            : typeof entry.runtimeOnly === 'boolean' || typeof entry.runtimeOnly === 'string'
              ? (entry.runtimeOnly as boolean | string)
              : undefined,
        disabled: typeof entry.disabled === 'boolean' ? entry.disabled : undefined,
        unavailable: typeof entry.unavailable === 'boolean' ? entry.unavailable : undefined,
        status: typeof entry.status === 'string' ? entry.status : undefined,
        statusMessage:
            typeof entry.status_message === 'string'
            ? entry.status_message
            : typeof entry.statusMessage === 'string'
              ? entry.statusMessage
              : undefined,
        runtimeError: normalizeRuntimeError(entry.runtime_error ?? entry.runtimeError),
        updatedAt: normalizeStringOrNumber(entry.updated_at ?? entry.updatedAt),
        lastRefresh:
            typeof entry.last_refresh === 'string' || typeof entry.last_refresh === 'number'
            ? (entry.last_refresh as string | number)
            : typeof entry.lastRefresh === 'string' || typeof entry.lastRefresh === 'number'
              ? (entry.lastRefresh as string | number)
              : undefined,
        nextRetryAfter:
            typeof entry.next_retry_after === 'string' || typeof entry.next_retry_after === 'number'
            ? (entry.next_retry_after as string | number)
            : typeof entry.nextRetryAfter === 'string' || typeof entry.nextRetryAfter === 'number'
              ? (entry.nextRetryAfter as string | number)
              : undefined,
        modified: normalizeNumber(entry.modtime ?? entry.modified),
        priority: normalizeNumber(entry.priority),
        weight: normalizeNumber(entry.weight),
        note: normalizeString(entry.note ?? entry.description ?? entry.comment),
        email: normalizeString(entry.email),
        projectId: normalizeString(entry.project_id ?? entry.projectId),
        usingApi: normalizeBooleanValue(entry.using_api ?? entry.usingApi),
        disableCooling: normalizeBooleanValue(
            entry.disable_cooling ?? entry['disable-cooling'] ?? entry.disableCooling,
        ),
        excludedModels: normalizeExcludedModelsValue(
            entry.excluded_models ?? entry['excluded-models'] ?? entry.excludedModels,
        ),
        success: normalizeNumber(entry.success),
        failed: normalizeNumber(entry.failed),
        recentRequests: normalizeRecentRequestBuckets(entry.recent_requests ?? entry.recentRequests),
    }
}
const hasMeaningfulValue    = (value: unknown): boolean => {
    if (value === null || value === undefined) {
        return false
    }
    if (typeof value === 'string') {
        return value.trim().length > 0
    }
    if (Array.isArray(value)) {
        return value.length > 0
    }
    return true
}

const authFileEntryScore = (file: AuthFileItem): number => {
    let score = 0
    if (String(file.source ?? '').trim().toLowerCase() === 'file') {
        score += 16
    }
    if (String(file.path ?? '').trim()) {
        score += 8
    }
    if (file.runtimeOnly !== true && file.runtimeOnly !== 'true') {
        score += 4
    }
    if (file.disabled !== true) {
        score += 2
    }
    if (typeof file.modified === 'number' && file.modified > 0) {
        score += 1
    }
    return score
}

const mergeAuthFileItems = (left: AuthFileItem, right: AuthFileItem): AuthFileItem => {
    const leftScore            = authFileEntryScore(left)
    const rightScore           = authFileEntryScore(right)
    const primary              = rightScore > leftScore ? right : left
    const secondary            = primary === left ? right : left
    const merged: AuthFileItem = { ...primary }
    Object.entries(secondary).forEach(([key, value]) => {
        if (!hasMeaningfulValue(merged[key]) && hasMeaningfulValue(value)) {
            merged[key] = value
        }
    })
    return merged
}

export const normalizeAuthFilesResponse = (value: unknown): AuthFilesResponse => {
    const record   = value && typeof value === 'object' ? (value as Record<string, unknown>) : null
    const filesRaw = Array.isArray(record?.files) ? record.files : []
    const byName   = new Map<string, AuthFileItem>()
    filesRaw.forEach((item) => {
        const normalized = normalizeAuthFileItem(item)
        if (!normalized) {
            return
        }
        const current = byName.get(normalized.name)
        byName.set(normalized.name, current ? mergeAuthFileItems(current, normalized) : normalized)
    })
    const files = [...byName.values()]
    return {
        files,
        total: files.length,
    }
}

type AuthFileBatchUploadResponse = {
    status?: string
    uploaded?: number
    files?: unknown
    failed?: unknown
}
type AuthFileBatchDeleteResponse = {
    status?: string
    deleted?: number
    files?: unknown
    failed?: unknown
}
type AuthFileBatchUploadResult = {
    status: string
    uploaded: number
    files: string[]
    failed: AuthFileBatchFailure[]
}
type AuthFileBatchDeleteResult = {
    status: string
    deleted: number
    files: string[]
    failed: AuthFileBatchFailure[]
}

const normalizeRequestedAuthFileNames = (names: string[]): string[] => {
    const seen                 = new Set<string>()
    const normalized: string[] = []

    names.forEach((name) => {
        const trimmed = String(name ?? '').trim()
        if (!trimmed || seen.has(trimmed)) {
            return
        }
        seen.add(trimmed)
        normalized.push(trimmed)
    })

    return normalized
}

const normalizeBatchFileNames = (value: unknown): string[] => {
    if (!Array.isArray(value)) {
        return []
    }
    return normalizeRequestedAuthFileNames(value.map((item) => String(item ?? '')))
}

const normalizeBatchFailures = (value: unknown): AuthFileBatchFailure[] => {
    if (!Array.isArray(value)) {
        return []
    }

    return value.reduce<AuthFileBatchFailure[]>((result, item) => {
        if (!item || typeof item !== 'object') {
            return result
        }
        const entry = item as Record<string, unknown>
        const name  = String(entry.name ?? '').trim()
        const error =
                  typeof entry.error === 'string'
                  ? entry.error.trim()
                  : typeof entry.message === 'string'
                    ? entry.message.trim()
                    : ''

        if (!name && !error) {
            return result
        }
        result.push({ name, error: error || 'Unknown error' })
        return result
    }, [])
}

const deriveSuccessfulFileNames = (requestedNames: string[], failed: AuthFileBatchFailure[]): string[] => {
    const failedNames = new Set(failed.map((entry) => entry.name.trim()).filter(Boolean))

    if (failedNames.size === 0) {
        return [...requestedNames]
    }

    return requestedNames.filter((name) => !failedNames.has(name))
}

const normalizeBatchUploadResponse = (
    payload: AuthFileBatchUploadResponse | undefined,
    requestedNames: string[],
): AuthFileBatchUploadResult => {
    const failed                   = normalizeBatchFailures(payload?.failed)
    const uploadedFilesFromPayload = normalizeBatchFileNames(payload?.files)
    const uploaded                 =
              typeof payload?.uploaded === 'number'
              ? payload.uploaded
              : uploadedFilesFromPayload.length > 0
                ? uploadedFilesFromPayload.length
                : requestedNames.length === 1 && failed.length === 0
                  ? 1
                  : 0

    let uploadedFiles = uploadedFilesFromPayload
    if (uploadedFiles.length === 0 && uploaded > 0) {
        if (failed.length === 0 && uploaded === requestedNames.length) {
            uploadedFiles = [...requestedNames]
        } else {
            const derivedNames = deriveSuccessfulFileNames(requestedNames, failed)
            if (derivedNames.length === uploaded) {
                uploadedFiles = derivedNames
            }
        }
    }

    return {
        status: typeof payload?.status === 'string' ? payload.status : failed.length > 0 ? 'partial' : 'ok',
        uploaded,
        files: uploadedFiles,
        failed,
    }
}

const normalizeBatchDeleteResponse = (
    payload: AuthFileBatchDeleteResponse | undefined,
    requestedNames: string[],
): AuthFileBatchDeleteResult => {
    const failed                  = normalizeBatchFailures(payload?.failed)
    const deletedFilesFromPayload = normalizeBatchFileNames(payload?.files)
    const deleted                 =
              typeof payload?.deleted === 'number'
              ? payload.deleted
              : deletedFilesFromPayload.length > 0
                ? deletedFilesFromPayload.length
                : requestedNames.length === 1 && failed.length === 0
                  ? 1
                  : 0

    let deletedFiles = deletedFilesFromPayload
    if (deletedFiles.length === 0 && deleted > 0) {
        if (failed.length === 0 && deleted === requestedNames.length) {
            deletedFiles = [...requestedNames]
        } else {
            const derivedNames = deriveSuccessfulFileNames(requestedNames, failed)
            if (derivedNames.length === deleted) {
                deletedFiles = derivedNames
            }
        }
    }

    return {
        status: typeof payload?.status === 'string' ? payload.status : failed.length > 0 ? 'partial' : 'ok',
        deleted,
        files: deletedFiles,
        failed,
    }
}

const normalizeOauthModelAlias = (payload: unknown): Record<string, OAuthModelAliasEntry[]> => {
    if (!payload || typeof payload !== 'object') {
        return {}
    }

    const record = payload as Record<string, unknown>
    const source = record['oauth-model-alias'] ?? record.items ?? payload
    if (!source || typeof source !== 'object') {
        return {}
    }

    const result: Record<string, OAuthModelAliasEntry[]> = {}

    Object.entries(source as Record<string, unknown>).forEach(([channel, mappings]) => {
        const key = String(channel ?? '')
            .trim()
            .toLowerCase()
        if (!key) {
            return
        }
        if (!Array.isArray(mappings)) {
            return
        }

        const seen       = new Set<string>()
        const normalized = mappings
            .map((item) => {
                if (!item || typeof item !== 'object') {
                    return null
                }
                const entry = item as Record<string, unknown>
                const name  = String(entry.name ?? entry.id ?? entry.model ?? '').trim()
                const alias = String(entry.alias ?? '').trim()
                if (!name || !alias) {
                    return null
                }
                const forceMappingValue                     = entry['force-mapping'] ?? entry.forceMapping
                const normalizedEntry: OAuthModelAliasEntry = { name, alias }
                if (entry.fork === false) {
                    normalizedEntry.fork = false
                }
                if (entry.fork === true) {
                    normalizedEntry.fork = true
                }
                if (typeof forceMappingValue === 'boolean') {
                    normalizedEntry['force-mapping'] = forceMappingValue
                }
                return normalizedEntry
            })
            .filter(Boolean)
            .filter((entry) => {
                const aliasEntry        = entry as OAuthModelAliasEntry
                const forkFlag          = aliasEntry.fork ? '1' : '0'
                const forceMappingValue = aliasEntry['force-mapping'] ?? aliasEntry.forceMapping
                const forceMappingFlag  = typeof forceMappingValue === 'boolean' ? String(forceMappingValue) : 'unset'
                const dedupeKey         = JSON.stringify([
                                                             aliasEntry.name.toLowerCase(),
                                                             aliasEntry.alias.toLowerCase(),
                                                             forkFlag,
                                                             forceMappingFlag,
                                                         ])
                if (seen.has(dedupeKey)) {
                    return false
                }
                seen.add(dedupeKey)
                return true
            }) as OAuthModelAliasEntry[]

        if (normalized.length) {
            result[key] = normalized
        }
    })

    return result
}

const OAUTH_MODEL_ALIAS_ENDPOINT = '/oauth-model-alias'

export const authFilesApi = {
    list: async (): Promise<AuthFilesResponse> =>
        normalizeAuthFilesResponse(await apiClient.get<unknown>('/auth-files')),

    setStatus: (name: string, disabled: boolean) =>
        apiClient.patch<AuthFileStatusResponse>('/auth-files/status', { name, disabled }),

    patchFields: (name: string, fields: AuthFileFieldsPatch) =>
        apiClient.patch('/auth-files/fields', { name, ...fields }),

    /**
     * Bulk enable a list of auth files. Sibling to setStatus but flips many files
     * in one round trip so the credentials page can offer "enable selected".
     * Returns {updated, failed} — failed is a map of name -> error message.
     */
    bulkEnable: (names: string[]) =>
        apiClient.patch<{ updated: string[]; failed?: Record<string, string> }>('/auth-files/bulk-enable', { names }),

    bulkDisable: (names: string[]) =>
        apiClient.patch<{ updated: string[]; failed?: Record<string, string> }>('/auth-files/bulk-disable', { names }),

    uploadFiles: async (files: File[]): Promise<AuthFileBatchUploadResult> => {
        const requestedNames = files.map((file) => file.name)
        if (requestedNames.length === 0) {
            return { status: 'ok', uploaded: 0, files: [], failed: [] }
        }

        const formData = new FormData()
        files.forEach((file) => {
            formData.append('file', file, file.name)
        })
        const payload = await apiClient.postForm<AuthFileBatchUploadResponse>('/auth-files', formData)
        return normalizeBatchUploadResponse(payload, requestedNames)
    },

    upload: (file: File) => authFilesApi.uploadFiles([file]),

    deleteFiles: async (names: string[]): Promise<AuthFileBatchDeleteResult> => {
        const requestedNames = normalizeRequestedAuthFileNames(names)
        if (requestedNames.length === 0) {
            return { status: 'ok', deleted: 0, files: [], failed: [] }
        }

        const payload = await apiClient.delete<AuthFileBatchDeleteResponse>('/auth-files', {
            data: { names: requestedNames },
        })
        return normalizeBatchDeleteResponse(payload, requestedNames)
    },

    deleteFile: (name: string) => authFilesApi.deleteFiles([name]),

    download: async (name: string): Promise<Blob> => {
        const response = await apiClient.getRaw(`/auth-files/download?name=${encodeURIComponent(name)}`, {
            responseType: 'blob',
        })
        return response.data as Blob
    },

    downloadText: async (name: string): Promise<string> => {
        const blob = await authFilesApi.download(name)
        return blob.text()
    },

    getModelsForAuthFile: async (name: string): Promise<AuthFileModelItem[]> => {
        const data = await apiClient.get<Record<string, unknown>>(
            `/auth-files/models?name=${encodeURIComponent(name)}`,
        )
        return Array.isArray(data.models) ? (data.models as AuthFileModelItem[]) : []
    },

    // OAuth 模型别名
    async getOauthModelAlias(): Promise<Record<string, OAuthModelAliasEntry[]>> {
        const data = await apiClient.get(OAUTH_MODEL_ALIAS_ENDPOINT)
        return normalizeOauthModelAlias(data)
    },

}
