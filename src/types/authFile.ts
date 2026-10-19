/**
 * 认证文件相关类型
 * 基于原项目 src/modules/auth-files.js
 */

export type AuthFileType =
    | 'qwen'
    | 'kimi'
    | 'gemini'
    | 'gemini-cli'
    | 'aistudio'
    | 'claude'
    | 'codex'
    | 'antigravity'
    | 'xai'
    | 'devin'
    | 'iflow'
    | 'vertex'
    | 'empty'
    | 'unknown'

export interface RecentRequestBucket {
    time: string
    startTimeMs?: number
    endTimeMs?: number
    success: number
    failed: number
}

export interface AuthFileRuntimeError {
    code?: string
    message: string
    httpStatus?: number
    model?: string
    effectScope?: string
    effectKey?: string
    nextRetryAfter?: string | number
    stateGeneration?: number
    observedAt?: string | number
}

export interface AuthFileCooldown {
    scope: 'credential' | 'model'
    modelKey?: string
    retryAt: string
    remainingSeconds: number
    reason: string
    backoffLevel?: number
    httpStatus?: number
}

export interface AuthFileCooldownSnapshot {
    /** Server observation time for this read-only projection. */
    observedAt?: string
    /** Local receipt time anchors countdown projection without assuming synchronized clocks. */
    receivedAtMs: number
    /** null = unknown; [] = known empty; non-empty = active credential/model cooldowns. */
    records: AuthFileCooldown[] | null
}

export interface AuthFileItem {
    name: string
    type?: AuthFileType | string
    provider?: string
    email?: string
    projectId?: string
    size?: number
    authIndex?: string | number | null
    supportsQuota?: boolean
    quotaProvider?: string
    runtimeOnly?: boolean | string
    disabled?: boolean
    unavailable?: boolean
    status?: string
    statusMessage?: string
    runtimeError?: AuthFileRuntimeError
    updatedAt?: string | number
    lastRefresh?: string | number
    manualTokenRefreshAvailable?: boolean
    nextRetryAfter?: string | number
    modified?: number
    priority?: number
    weight?: number
    note?: string
    usingApi?: boolean
    using_api?: boolean
    websockets?: boolean
    disableCooling?: boolean | null
    disable_cooling?: boolean | null
    'disable-cooling'?: boolean | null
    requestRetry?: number | null
    request_retry?: number | null
    'request-retry'?: number | null
    excludedModels?: string[]
    excluded_models?: string[]
    'excluded-models'?: string[]
    success?: number
    failed?: number
    recentRequests?: RecentRequestBucket[]
    cooldownSnapshot?: AuthFileCooldownSnapshot

    [key: string]: unknown
}

export interface AuthFileModelItem {
    id: string
    display_name?: string
    type?: string
    owned_by?: string
}

export interface AuthFilesResponse {
    files: AuthFileItem[]
    total?: number
    observedAt?: string
    receivedAtMs?: number
}
