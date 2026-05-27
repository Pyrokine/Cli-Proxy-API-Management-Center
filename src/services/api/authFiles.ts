/**
 * 认证文件与 OAuth 排除模型相关 API
 */

import type {OAuthModelAliasEntry} from '@/types'
import type {AuthFileItem, AuthFilesResponse, RecentRequestBucket} from '@/types/authFile'
import {apiClient} from './client'

type StatusError = { status?: number }
type AuthFileStatusResponse = { status: string; disabled: boolean }
export type AuthFileFieldsPatch = {
    prefix?: string
    proxy_url?: string
    headers?: Record<string, string>
    priority?: number
    note?: string
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
        lastRefresh:
            typeof entry.last_refresh === 'string' || typeof entry.last_refresh === 'number'
            ? (entry.last_refresh as string | number)
            : typeof entry.lastRefresh === 'string' || typeof entry.lastRefresh === 'number'
              ? (entry.lastRefresh as string | number)
              : undefined,
        modified: normalizeNumber(entry.modtime ?? entry.modified),
        priority: normalizeNumber(entry.priority),
        note: normalizeString(entry.note ?? entry.description ?? entry.comment),
        success: normalizeNumber(entry.success),
        failed: normalizeNumber(entry.failed),
        recentRequests: normalizeRecentRequestBuckets(entry.recent_requests ?? entry.recentRequests),
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

const getStatusCode = (err: unknown): number | undefined => {
    if (!err || typeof err !== 'object') {
        return undefined
    }
    if ('status' in err) {
        return (err as StatusError).status
    }
    return undefined
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

const normalizeOauthExcludedModels = (payload: unknown): Record<string, string[]> => {
    if (!payload || typeof payload !== 'object') {
        return {}
    }

    const record = payload as Record<string, unknown>
    const source = record['oauth-excluded-models'] ?? record.items ?? payload
    if (!source || typeof source !== 'object') {
        return {}
    }

    const result: Record<string, string[]> = {}

    Object.entries(source as Record<string, unknown>).forEach(([provider, models]) => {
        const key = String(provider ?? '')
            .trim()
            .toLowerCase()
        if (!key) {
            return
        }

        const rawList = Array.isArray(models) ? models : typeof models === 'string' ? models.split(/[\n,]+/) : []

        const seen                 = new Set<string>()
        const normalized: string[] = []
        rawList.forEach((item) => {
            const trimmed = String(item ?? '').trim()
            if (!trimmed) {
                return
            }
            const modelKey = trimmed.toLowerCase()
            if (seen.has(modelKey)) {
                return
            }
            seen.add(modelKey)
            normalized.push(trimmed)
        })

        result[key] = normalized
    })

    return result
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
                const fork = entry.fork === true
                return fork ? { name, alias, fork } : { name, alias }
            })
            .filter(Boolean)
            .filter((entry) => {
                const aliasEntry = entry as OAuthModelAliasEntry
                const forkFlag   = aliasEntry.fork ? '1' : '0'
                const dedupeKey  = `${aliasEntry.name.toLowerCase()}::${aliasEntry.alias.toLowerCase()}::${forkFlag}`
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
    list: async (): Promise<AuthFilesResponse> => {
        const data     = await apiClient.get<unknown>('/auth-files')
        const record   = data && typeof data === 'object' ? (data as Record<string, unknown>) : null
        const filesRaw = Array.isArray(record?.files) ? record.files : []
        return {
            files: filesRaw.map(normalizeAuthFileItem).filter(Boolean) as AuthFileItem[],
            total: typeof record?.total === 'number' ? record.total : undefined,
        }
    },

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

    downloadText: async (name: string): Promise<string> => {
        const response = await apiClient.getRaw(`/auth-files/download?name=${encodeURIComponent(name)}`, {
            responseType: 'blob',
        })
        const blob     = response.data as Blob
        return blob.text()
    },

    // OAuth 排除模型
    async getOauthExcludedModels(): Promise<Record<string, string[]>> {
        const data = await apiClient.get('/oauth-excluded-models')
        return normalizeOauthExcludedModels(data)
    },

    saveOauthExcludedModels: (provider: string, models: string[]) =>
        apiClient.patch('/oauth-excluded-models', { provider, models }),

    deleteOauthExcludedEntry: (provider: string) =>
        apiClient.delete(`/oauth-excluded-models?provider=${encodeURIComponent(provider)}`),

    // OAuth 模型别名
    async getOauthModelAlias(): Promise<Record<string, OAuthModelAliasEntry[]>> {
        const data = await apiClient.get(OAUTH_MODEL_ALIAS_ENDPOINT)
        return normalizeOauthModelAlias(data)
    },

    saveOauthModelAlias: async (channel: string, aliases: OAuthModelAliasEntry[]) => {
        const normalizedChannel = String(channel ?? '')
            .trim()
            .toLowerCase()
        const normalizedAliases = normalizeOauthModelAlias({ [normalizedChannel]: aliases })[normalizedChannel] ?? []
        await apiClient.patch(OAUTH_MODEL_ALIAS_ENDPOINT, {
            channel: normalizedChannel,
            aliases: normalizedAliases,
        })
    },

    deleteOauthModelAlias: async (channel: string) => {
        const normalizedChannel = String(channel ?? '')
            .trim()
            .toLowerCase()

        try {
            await apiClient.patch(OAUTH_MODEL_ALIAS_ENDPOINT, {
                channel: normalizedChannel,
                aliases: [],
            })
        } catch (err: unknown) {
            const status = getStatusCode(err)
            if (status !== 405) {
                throw err
            }
            await apiClient.delete(`${OAUTH_MODEL_ALIAS_ENDPOINT}?channel=${encodeURIComponent(normalizedChannel)}`)
        }
    },

    // 获取指定 channel 的模型定义
    async getModelDefinitions(
        channel: string,
    ): Promise<{ id: string; display_name?: string; type?: string; owned_by?: string }[]> {
        const normalizedChannel = String(channel ?? '')
            .trim()
            .toLowerCase()
        if (!normalizedChannel) {
            return []
        }
        const data   = await apiClient.get<Record<string, unknown>>(
            `/model-definitions/${encodeURIComponent(normalizedChannel)}`,
        )
        const models = data.models ?? data['models']
        return Array.isArray(models)
               ? (models as { id: string; display_name?: string; type?: string; owned_by?: string }[])
               : []
    },
}
