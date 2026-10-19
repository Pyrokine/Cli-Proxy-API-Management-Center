/**
 * 认证文件与 OAuth 排除模型相关 API
 */

import i18n from '@/i18n'
import {useAuthFileRefreshStore, type AuthFileRefreshRequest} from '@/stores/useAuthFileRefreshStore'
import {authFileStatusRequestKey, useAuthFileStatusStore} from '@/stores/useAuthFileStatusStore'
import type {OAuthModelAliasEntry} from '@/types'
import {readAuthFileDisableCooling, readAuthFileRequestRetry, readAuthFileWebsockets} from '@/features/authFiles/constants'
import type {
    AuthFileItem,
    AuthFileModelItem,
    AuthFileRuntimeError,
    AuthFileCooldown,
    AuthFileCooldownSnapshot,
    AuthFilesResponse,
    RecentRequestBucket,
} from '@/types/authFile'
import {normalizeBooleanValue} from '@/utils/boolean'
import {getCredentialRetryValidationKey} from '@/utils/credentialOverrides'
import {normalizeExcludedModelsValue} from '@/utils/excludedModels'
import {apiClient} from './client'

type AuthFileStatusResponse = { status: string; disabled: boolean }
export type AuthFileRefreshResult = {
    filename: string
    provider: string
    auth_index: string
    status: string
    refreshed_at: string
}
export type AuthFileRefreshBatchItem = AuthFileRefreshResult & {
    success: boolean
    error?: string
}
export type AuthFileRefreshBatchResult = {
    results: AuthFileRefreshBatchItem[]
}
export type AuthFileFieldsPatch = {
    prefix?: string
    proxy_url?: string
    headers?: Record<string, string>
    priority?: number
    weight?: number | null
    note?: string
    disable_cooling?: boolean | null
    request_retry?: number | null
    websockets?: boolean
    using_api?: boolean
    excluded_models?: string[]
    model_aliases?: Array<Record<string, unknown>>
    request_scoped_errors?: Array<Record<string, unknown>>
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

const normalizeTimestamp = (value: unknown): string | undefined => {
    if (typeof value !== 'string') {
        return undefined
    }
    const trimmed = value.trim()
    const timestamp = Date.parse(trimmed)
    return trimmed && Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined
}

const normalizeOptionalNonNegativeInteger = (value: unknown): number | undefined =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined

const normalizeCooldown = (value: unknown): AuthFileCooldown | null => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null
    }

    const entry            = value as Record<string, unknown>
    const scope            = normalizeString(entry.scope)?.toLowerCase()
    const modelKey         = normalizeString(entry.model_key ?? entry.modelKey)
    const retryAt          = normalizeTimestamp(entry.retry_at ?? entry.retryAt)
    const remainingSeconds = entry.remaining_seconds ?? entry.remainingSeconds
    const reason           = normalizeString(entry.reason) ?? 'unknown'
    const backoffValue     = entry.backoff_level === undefined ? entry.backoffLevel : entry.backoff_level
    const backoffLevel     = normalizeOptionalNonNegativeInteger(backoffValue)
    const httpStatusValue  = entry.http_status === undefined ? entry.httpStatus : entry.http_status
    const httpStatus       = typeof httpStatusValue === 'number' && Number.isSafeInteger(httpStatusValue) &&
                             httpStatusValue >= 400 && httpStatusValue <= 599 ? httpStatusValue : undefined

    if (
        (scope !== 'credential' && scope !== 'model') ||
        (scope === 'model' && !modelKey) ||
        retryAt === undefined ||
        typeof remainingSeconds !== 'number' ||
        !Number.isSafeInteger(remainingSeconds) ||
        remainingSeconds <= 0
    ) {
        return null
    }

    return {
        scope,
        ...(modelKey ? {modelKey} : {}),
        retryAt,
        remainingSeconds,
        reason,
        ...(backoffLevel === undefined ? {} : {backoffLevel}),
        ...(httpStatus === undefined ? {} : {httpStatus}),
    }
}

const normalizeCooldownSnapshot = (
    entry: Record<string, unknown>,
    observedAt: string | undefined,
    receivedAtMs: number,
): AuthFileCooldownSnapshot | undefined => {
    if (!Object.prototype.hasOwnProperty.call(entry, 'cooldowns')) {
        return undefined
    }
    const snapshot = {observedAt, receivedAtMs}
    if (!Array.isArray(entry.cooldowns)) {
        return {...snapshot, records: null}
    }

    const records = entry.cooldowns.map(normalizeCooldown)
    return {
        ...snapshot,
        records: records.every((cooldown): cooldown is AuthFileCooldown => cooldown !== null) ? records : null,
    }
}

const normalizeAuthFileItem = (
    value: unknown,
    observedAt: string | undefined,
    receivedAtMs: number,
): AuthFileItem | null => {
    if (!value || typeof value !== 'object') {
        return null
    }

    const entry            = value as Record<string, unknown>
    const cooldownSnapshot = normalizeCooldownSnapshot(entry, observedAt, receivedAtMs)
    const name             = String(entry.name ?? '').trim()
    if (!name) {
        return null
    }

    return {
        ...entry,
        name,
        type: typeof entry.type === 'string' ? entry.type : undefined,
        provider: typeof entry.provider === 'string' ? entry.provider : undefined,
        supportsQuota: entry.supports_quota === true || entry.supportsQuota === true,
        quotaProvider: normalizeString(entry.quota_provider ?? entry.quotaProvider),
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
        manualTokenRefreshAvailable:
            typeof entry.manual_refresh_available === 'boolean' ? entry.manual_refresh_available : undefined,
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
        websockets: readAuthFileWebsockets(entry),
        disableCooling: readAuthFileDisableCooling(entry),
        requestRetry: readAuthFileRequestRetry(entry),
        excludedModels: normalizeExcludedModelsValue(
            entry.excluded_models ?? entry['excluded-models'] ?? entry.excludedModels,
        ),
        success: normalizeNumber(entry.success),
        failed: normalizeNumber(entry.failed),
        recentRequests: normalizeRecentRequestBuckets(entry.recent_requests ?? entry.recentRequests),
        cooldownSnapshot,
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
    if (merged.cooldownSnapshot === undefined && secondary.cooldownSnapshot !== undefined) {
        merged.cooldownSnapshot = secondary.cooldownSnapshot
    }
    Object.entries(secondary).forEach(([key, value]) => {
        if (['disable_cooling', 'disable-cooling', 'disableCooling',
             'request_retry', 'request-retry', 'requestRetry', 'websockets',
             'model_aliases', 'model-aliases', 'request_scoped_errors', 'request-scoped-errors',
             'cooldowns', 'cooldownSnapshot'].includes(key)) {
            return
        }
        if (!hasMeaningfulValue(merged[key]) && hasMeaningfulValue(value)) {
            merged[key] = value
        }
    })
    return merged
}

const mergeAuthFileRows = (rows: AuthFileItem[]): AuthFileItem | null =>
    rows.reduce<AuthFileItem | null>(
        (current, row) => current ? mergeAuthFileItems(current, row) : row,
        null,
    )

const mergeAuthFileNameGroup = (rows: AuthFileItem[]): AuthFileItem[] => {
    const byAuthIndex = new Map<string, AuthFileItem[]>()
    const sharedRows: AuthFileItem[] = []
    for (const row of rows) {
        const authIndex = String(row.authIndex ?? '').trim()
        if (!authIndex) {
            sharedRows.push(row)
            continue
        }
        byAuthIndex.set(authIndex, [...(byAuthIndex.get(authIndex) ?? []), row])
    }

    if (byAuthIndex.size <= 1) {
        const merged = mergeAuthFileRows(rows)
        return merged ? [merged] : []
    }

    const shared = mergeAuthFileRows(sharedRows)
    return Array.from(byAuthIndex.values()).flatMap((identityRows) => {
        const identity = mergeAuthFileRows(identityRows)
        if (!identity) {
            return []
        }
        return [shared ? mergeAuthFileItems(shared, identity) : identity]
    })
}

export const normalizeAuthFilesResponse = (
    value: unknown,
    receivedAtMs = Date.now(),
): AuthFilesResponse => {
    const record     = value && typeof value === 'object' ? (value as Record<string, unknown>) : null
    const filesRaw   = Array.isArray(record?.files) ? record.files : []
    const observedAt = normalizeTimestamp(record?.observed_at ?? record?.observedAt)
    const byName     = new Map<string, AuthFileItem[]>()
    filesRaw.forEach((item) => {
        const normalized = normalizeAuthFileItem(item, observedAt, receivedAtMs)
        if (!normalized) {
            return
        }
        byName.set(normalized.name, [...(byName.get(normalized.name) ?? []), normalized])
    })
    const files = Array.from(byName.values()).flatMap(mergeAuthFileNameGroup)
    return {
        files,
        total: files.length,
        ...(observedAt === undefined ? {} : {observedAt}),
        receivedAtMs,
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

const normalizeAuthFileRefreshResult = (value: unknown): AuthFileRefreshResult => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('auth_files.refresh_invalid_response')
    }
    const entry       = value as Record<string, unknown>
    const filename    = normalizeString(entry.filename)
    const provider    = normalizeString(entry.provider)
    const authIndex   = normalizeString(entry.auth_index)
    const status      = normalizeString(entry.status)
    const refreshedAt = normalizeTimestamp(entry.refreshed_at)
    if (!filename || !provider || !authIndex || !status || !refreshedAt) {
        throw new Error('auth_files.refresh_invalid_response')
    }
    return {
        filename,
        provider,
        auth_index: authIndex,
        status,
        refreshed_at: refreshedAt,
    }
}

const normalizeAuthFileRefreshBatchResult = (value: unknown): AuthFileRefreshBatchResult => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('auth_files.refresh_invalid_response')
    }
    const results = (value as Record<string, unknown>).results
    if (!Array.isArray(results)) {
        throw new Error('auth_files.refresh_invalid_response')
    }
    return {
        results: results.map((item) => {
            if (!item || typeof item !== 'object' || Array.isArray(item)) {
                throw new Error('auth_files.refresh_invalid_response')
            }
            const entry   = item as Record<string, unknown>
            const result  = normalizeAuthFileRefreshResult(entry)
            const success = entry.success
            if (typeof success !== 'boolean') {
                throw new Error('auth_files.refresh_invalid_response')
            }
            const error = normalizeString(entry.error)
            return {...result, success, ...(error ? {error} : {})}
        }),
    }
}

const OAUTH_MODEL_ALIAS_ENDPOINT  = '/oauth-model-alias'
const AUTH_FILE_REFRESH_TIMEOUT_MS = 35_000
const AUTH_FILE_REFRESH_ALL_TIMEOUT_MS = 300_000

const refreshAuthFileTokens = async (
    target: AuthFileRefreshRequest['target'],
    timeout: number,
): Promise<unknown> => {
    const generation = apiClient.getAuthGeneration()
    if (useAuthFileRefreshStore.getState().request?.generation === generation) {
        throw new Error(i18n.t('credentials.manual_token_refresh_in_progress'))
    }
    const request = {generation, target}
    useAuthFileRefreshStore.setState({request})
    try {
        return await apiClient.post<unknown>('/auth-files/refresh', target, {timeout})
    } finally {
        if (useAuthFileRefreshStore.getState().request === request) {
            useAuthFileRefreshStore.setState({request: null})
        }
    }
}

export const authFilesApi = {
    list: async (): Promise<AuthFilesResponse> =>
        normalizeAuthFilesResponse(await apiClient.get<unknown>('/auth-files')),

    setStatus: async (name: string, disabled: boolean, authIndex?: string | number | null) => {
        name = name.trim()
        const identity = String(authIndex ?? '').trim()
        const generation = apiClient.getAuthGeneration()
        const key = authFileStatusRequestKey(generation, name, identity)
        if (useAuthFileStatusStore.getState().requests.has(key)) {
            throw new Error(i18n.t('credentials.status_update_in_progress'))
        }
        const request = {generation, name, authIndex: identity}
        useAuthFileStatusStore.setState((state) => ({requests: new Map(state.requests).set(key, request)}))
        try {
            const result = await apiClient.patch<AuthFileStatusResponse>('/auth-files/status', {
                name,
                disabled,
                ...(identity ? {auth_index: identity} : {}),
            })
            if (result?.status !== 'ok' || result.disabled !== disabled) {
                throw new Error(i18n.t('credentials.batch_status_invalid_response'))
            }
            return result
        } finally {
            useAuthFileStatusStore.setState((state) => {
                if (state.requests.get(key) !== request) {
                    return state
                }
                const requests = new Map(state.requests)
                requests.delete(key)
                return {requests}
            })
        }
    },

    requestManualRefresh: (
        name: string,
        authIndex?: string | number | null,
    ): Promise<AuthFileRefreshResult> => {
        const normalizedName = String(name ?? '').trim()
        const identity       = String(authIndex ?? '').trim()
        if (!normalizedName || !identity) {
            throw new Error('auth_files.refresh_identity_required')
        }
        return refreshAuthFileTokens({
            name: normalizedName,
            auth_index: identity,
        }, AUTH_FILE_REFRESH_TIMEOUT_MS).then(normalizeAuthFileRefreshResult)
    },

    requestManualRefreshAll: async (): Promise<AuthFileRefreshBatchResult> =>
        normalizeAuthFileRefreshBatchResult(
            await refreshAuthFileTokens({all: true}, AUTH_FILE_REFRESH_ALL_TIMEOUT_MS),
        ),

    clearLocalCooldown: async (authIndex: string): Promise<void> => {
        const identity = String(authIndex ?? '').trim()
        if (!identity) {
            throw new Error('auth_files.cooldown_identity_required')
        }
        const result = await apiClient.post<{status: string; auth_index: string}>(
            '/routing/cooldown/reset', {auth_index: identity},
        )
        if (result?.status !== 'ok' || result.auth_index !== identity) {
            throw new Error('auth_files.cooldown_reset_invalid_response')
        }
    },

    patchFields: (
        name: string,
        fields: AuthFileFieldsPatch,
        authIndex?: string | number | null,
    ) => {
        const errorKey = getCredentialRetryValidationKey(fields.request_retry ?? undefined)
        if (errorKey) {
            throw new Error(errorKey)
        }
        const identity = String(authIndex ?? '').trim()
        const payload = {
            name,
            ...(identity ? { 'auth-index': identity } : {}),
            ...fields,
        }
        if (typeof payload.request_retry === 'number' && payload.request_retry < 0) {
            payload.request_retry = null
        }
        return apiClient.patch('/auth-files/fields', payload)
    },

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
