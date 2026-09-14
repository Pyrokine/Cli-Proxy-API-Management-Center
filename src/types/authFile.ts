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

export interface AuthFileItem {
    name: string
    type?: AuthFileType | string
    provider?: string
    email?: string
    projectId?: string
    size?: number
    authIndex?: string | number | null
    runtimeOnly?: boolean | string
    disabled?: boolean
    unavailable?: boolean
    status?: string
    statusMessage?: string
    runtimeError?: AuthFileRuntimeError
    updatedAt?: string | number
    lastRefresh?: string | number
    nextRetryAfter?: string | number
    modified?: number
    priority?: number
    weight?: number
    note?: string
    usingApi?: boolean
    using_api?: boolean
    disableCooling?: boolean
    disable_cooling?: boolean
    'disable-cooling'?: boolean
    excludedModels?: string[]
    excluded_models?: string[]
    'excluded-models'?: string[]
    success?: number
    failed?: number
    recentRequests?: RecentRequestBucket[]

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
}
