/**
 * API 相关类型定义
 * 基于原项目 src/core/api-client.js 和各模块 API
 */

// API 客户端配置
export interface ApiClientConfig {
    apiBase: string
    managementKey: string
    timeout?: number
}

export interface ManagementMutationResult {
    mutation_id: string
    request_id: string
    outcome: 'succeeded' | 'rejected' | 'partial' | 'uncertain'
    confirmed_effect: boolean
    effects: Array<{ kind: string; target: string }>
    audit_available: boolean
}

export interface ManagementMutationReceipt {
    mutation_id: string
    request_id?: string
    authGeneration: number
    metadata_present: boolean
    result?: ManagementMutationResult
    recovery?: 'unknown' | 'unavailable'
}

// API 错误
export type ApiError = Error & {
    status?: number
    code?: string
    backendCode?: string
    retryAfterSeconds?: number
    rateLimitUntil?: string
    details?: unknown
    data?: unknown
    requestId?: string
    mutation?: ManagementMutationReceipt
}
