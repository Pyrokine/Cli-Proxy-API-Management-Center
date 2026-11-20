/**
 * Axios API 客户端
 * 替代原项目 src/core/api-client.js
 */

import i18n from '@/i18n'
import type {ApiClientConfig, ApiError} from '@/types'
import type {ManagementMutationReceipt, ManagementMutationResult} from '@/types/api'
import {computeApiUrl} from '@/utils/connection'
import {BUILD_DATE_HEADER_KEYS, REQUEST_TIMEOUT_MS, VERSION_HEADER_KEYS} from '@/utils/constants'
import axios, {AxiosInstance, AxiosRequestConfig, AxiosResponse} from 'axios'

type AuthScopedRequestConfig = AxiosRequestConfig & {
    __authGeneration?: number
    __mutationId?: string
    onMutationReceipt?: (receipt: ManagementMutationReceipt) => void
    /** GET 创建操作通过此回调声明意图并读回资源 */
    mutationReadback?: (data: unknown, receipt: ManagementMutationReceipt) => Promise<unknown>
}

export const MUTATION_TARGET_REACHED = Symbol('mutation-target-reached')

const OAUTH_CREATION_PATHS = new Set([
                                         '/anthropic-auth-url',
                                         '/codex-auth-url',
                                         '/gemini-cli-auth-url',
                                         '/antigravity-auth-url',
                                         '/qwen-auth-url',
                                         '/kimi-auth-url',
                                         '/kimi-ai-auth-url',
                                         '/xai-auth-url',
                                         '/meta-auth-url',
                                         '/devin-auth-url',
                                         '/iflow-auth-url',
                                     ])

export function parseManagementMutationResult(
    value: unknown,
    mutationId: string,
): ManagementMutationResult | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return undefined
    }
    const result = value as Record<string, unknown>
    if (result.mutation_id !==
        mutationId ||
        typeof result.request_id !==
        'string' ||
        !result.request_id.trim() ||
        typeof result.outcome !==
        'string' ||
        !['succeeded', 'rejected', 'partial', 'uncertain'].includes(result.outcome) ||
        typeof result.confirmed_effect !==
        'boolean' ||
        typeof result.audit_available !==
        'boolean' ||
        !Array.isArray(result.effects) ||
        result.effects.some((effect: unknown) => !effect ||
        typeof effect !==
        'object' ||
        typeof (effect as Record<string, unknown>).kind !==
        'string' ||
        !(effect as Record<string, unknown>).kind ||
        typeof (effect as Record<string, unknown>).target !==
        'string' ||
        !(effect as Record<string, unknown>).target) ||
        result.confirmed_effect !==
        (result.effects.length > 0)) {
        return undefined
    }
    if ((result.outcome === 'succeeded' || result.outcome === 'partial') &&
        (!result.confirmed_effect || !result.audit_available)) {
        return undefined
    }
    if (result.outcome === 'rejected' && (result.confirmed_effect || !result.audit_available)) {
        return undefined
    }
    return result as unknown as ManagementMutationResult
}

export function mutationReceiptError(receipt: ManagementMutationReceipt): ApiError {
    const outcome  = receipt.recovery ?? receipt.result?.outcome ?? 'uncertain'
    const message  = i18n.t(`common.mutation_${outcome}`)
    const identity = i18n.t(
        'common.mutation_identity',
        { mutationId: receipt.mutation_id, requestId: receipt.request_id ?? '—' },
    )
    return Object.assign(
        new Error(`${message} ${identity}`),
        { name: 'ApiError', mutation: receipt, requestId: receipt.request_id },
    )
}

const finiteNonNegativeNumber = (value: unknown): number | undefined => {
    const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim()) : Number.NaN
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

export function parseRetryAfterSeconds(value: unknown, nowMs = Date.now()): number | undefined {
    const seconds = finiteNonNegativeNumber(value)
    if (seconds !== undefined) {
        return Math.ceil(seconds)
    }
    if (typeof value !== 'string') {
        return undefined
    }
    const retryAt = Date.parse(value)
    if (!Number.isFinite(retryAt)) {
        return undefined
    }
    return Math.max(0, Math.ceil((retryAt - nowMs) / 1000))
}

class ApiClient {
    private instance: AxiosInstance
    private apiBase: string       = ''
    private managementKey: string = ''

    /** 标记认证已失败，阻止后续请求继续发送 */
    private authFailed: boolean = false

    /** 请求所属的认证会话，配置变化时递增 */
    private authGeneration: number = 0

    constructor() {
        this.instance = axios.create({
                                         timeout: REQUEST_TIMEOUT_MS,
                                         headers: {
                                             'Content-Type': 'application/json',
                                         },
                                     })

        this.setupInterceptors()
    }

    /**
     * 设置 API 配置
     */
    setConfig(config: ApiClientConfig): void
    setConfig(config: ApiClientConfig, rotateResourceSession: true): Promise<void>
    setConfig(config: ApiClientConfig, rotateResourceSession = false): void | Promise<void> {
        this.authGeneration += 1
        this.apiBase       = computeApiUrl(config.apiBase)
        this.managementKey = config.managementKey
        this.authFailed    = false

        if (config.timeout) {
            this.instance.defaults.timeout = config.timeout
        } else {
            this.instance.defaults.timeout = REQUEST_TIMEOUT_MS
        }
        if (rotateResourceSession) {
            const generation = this.authGeneration
            const base       = this.apiBase.replace(/\/v0\/management$/, '')
            const signal     = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
            let started      = false
            const rotate     = async () => {
                signal.throwIfAborted()
                if (generation !== this.authGeneration) {
                    throw new Error(i18n.t('common.connection_changed'))
                }
                started        = true
                const response = await fetch(`${base}/v0/resource/plugins/session`, {
                    method: 'POST', credentials: 'include', redirect: 'error', signal,
                    headers: { Authorization: `Bearer ${config.managementKey}` },
                })
                if (generation !== this.authGeneration) {
                    throw new Error(i18n.t('common.connection_changed'))
                }
                if (response.status === 404 || response.status === 405) {
                    console.warn('Server does not support plugin resource session rotation', response.status)
                    return
                }
                if (response.status !== 204) {
                    const failedConfig  = { headers: new axios.AxiosHeaders(), __authGeneration: generation }
                    const data: unknown = await response.json().catch(() => null)
                    throw this.handleError(new axios.AxiosError(
                        `${response.status} ${response.statusText}`.trim(), undefined, failedConfig, undefined,
                        {
                            status: response.status, statusText: response.statusText, data,
                            headers: Object.fromEntries(response.headers.entries()), config: failedConfig,
                        },
                    ))
                }
            }
            return typeof navigator !== 'undefined' && typeof navigator.locks?.request === 'function' ?
                   navigator.locks.request(`cpam:plugin-resource-session:${new URL(base).hostname}`, { signal }, rotate)
                            .catch((error: unknown) => {
                                if (started || signal.aborted) {
                                    throw error
                                }
                                console.warn('Plugin session cross-tab coordination unavailable:', error)
                                return rotate()
                            }) : rotate()
        }
    }

    getAuthGeneration(): number {
        return this.authGeneration
    }

    /**
     * GET 请求
     */
    async get<T = unknown>(url: string, config?: AuthScopedRequestConfig): Promise<T> {
        const response = await this.instance.get<T>(url, this.scopeRequest(config))
        return response.data
    }

    /**
     * POST 请求
     */
    async post<T = unknown>(url: string, data?: unknown, config?: AuthScopedRequestConfig): Promise<T> {
        const response = await this.instance.post<T>(url, data, this.scopeRequest(config))
        return response.data
    }

    /**
     * PUT 请求
     */
    async put<T = unknown>(url: string, data?: unknown, config?: AuthScopedRequestConfig): Promise<T> {
        const response = await this.instance.put<T>(url, data, this.scopeRequest(config))
        return response.data
    }

    /**
     * PATCH 请求
     */
    async patch<T = unknown>(url: string, data?: unknown, config?: AuthScopedRequestConfig): Promise<T> {
        const response = await this.instance.patch<T>(url, data, this.scopeRequest(config))
        return response.data
    }

    /**
     * DELETE 请求
     */
    async delete<T = unknown>(url: string, config?: AuthScopedRequestConfig): Promise<T> {
        const response = await this.instance.delete<T>(url, this.scopeRequest(config))
        return response.data
    }

    /**
     * 获取原始响应（用于下载等场景）
     */
    async getRaw(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse> {
        return this.instance.get(url, this.scopeRequest(config))
    }

    /**
     * 发送 FormData
     */
    async postForm<T = unknown>(url: string, formData: FormData, config?: AuthScopedRequestConfig): Promise<T> {
        const response = await this.instance.post<T>(url, formData, this.scopeRequest(
            {
                ...config,
                headers: {
                    ...(config?.headers ||
                        {}),
                    'Content-Type': 'multipart/form-data',
                },
            }))
        return response.data
    }

    async reconcileMutation(receipt: ManagementMutationReceipt): Promise<ManagementMutationReceipt> {
        if (receipt.authGeneration !==
            this.authGeneration ||
            (receipt.result && receipt.result.outcome !== 'uncertain' && receipt.result.audit_available)) {
            return receipt
        }
        try {
            const value = await this.get<unknown>(
                `/mutations/${encodeURIComponent(receipt.mutation_id)}`,
                this.scopeRequest({ __authGeneration: receipt.authGeneration }),
            )
            if (receipt.authGeneration !== this.authGeneration) {
                return receipt
            }
            const result = parseManagementMutationResult(value, receipt.mutation_id)
            return result ?
                { ...receipt, recovery: undefined, request_id: result.request_id, result } :
                { ...receipt, recovery: 'unavailable' }
        } catch (error: unknown) {
            if (receipt.authGeneration !== this.authGeneration) {
                return receipt
            }
            return { ...receipt, recovery: (error as ApiError)?.status === 404 ? 'unknown' : 'unavailable' }
        }
    }

    private scopeRequest(config?: AuthScopedRequestConfig): AuthScopedRequestConfig {
        return { ...config, __authGeneration: config?.__authGeneration ?? this.authGeneration }
    }

    private async reconcileResourceMutation(
        receipt: ManagementMutationReceipt,
        readback: NonNullable<AuthScopedRequestConfig['mutationReadback']>,
        data: unknown,
        error?: ApiError,
    ): Promise<void> {
        if (receipt.authGeneration !== this.authGeneration) {
            return
        }
        const current = receipt.metadata_present || error ? await this.reconcileMutation(receipt) : receipt
        if (receipt.authGeneration !== this.authGeneration) {
            return
        }
        let readbackError: Error | undefined
        let targetState: unknown
        try {
            targetState = await readback(data, current)
        } catch (cause: unknown) {
            readbackError = cause instanceof Error ? cause : new Error(String(cause))
        }
        if (receipt.authGeneration !== this.authGeneration) {
            return
        }
        const unchangedTarget = targetState === MUTATION_TARGET_REACHED && current.result?.outcome === 'uncertain' &&
                                !current.result.confirmed_effect && current.result.effects.length === 0
        if (error ||
            readbackError ||
            (current.metadata_present &&
             !unchangedTarget &&
             (current.recovery || current.result?.outcome !== 'succeeded'))) {
            const failure     = error ?? mutationReceiptError(current)
            failure.mutation  = current
            failure.requestId = current.request_id
            if (error) {
                failure.message = `${failure.message} ${mutationReceiptError(current).message}`
            }
            if (readbackError) {
                failure.message += ` ${i18n.t('notification.refresh_failed')}: ${readbackError.message}`
            }
            throw failure
        }
    }

    private mutationReceipt(
        config: AuthScopedRequestConfig | undefined,
        headers?: Record<string, unknown>,
    ): ManagementMutationReceipt | undefined {
        if (!config?.__mutationId) {
            return undefined
        }
        const encoded = this.readHeader(headers, ['X-CPA-Mutation-Result'])
        let result: ManagementMutationResult | undefined
        if (encoded !== null) {
            try {
                result = parseManagementMutationResult(JSON.parse(encoded), config.__mutationId)
            } catch {
                result = undefined
            }
        }
        return {
            mutation_id: config.__mutationId,
            authGeneration: config.__authGeneration ?? this.authGeneration,
            metadata_present: encoded !==
                              null ||
                              Object.keys(headers ?? {}).some((key) => key.toLowerCase() === 'x-cpa-mutation-result'),
            request_id: result?.request_id ??
                        this.readHeader(headers, ['X-Request-ID', 'X-CPA-Request-ID']) ??
                        undefined,
            ...(result ? { result } : {}),
        }
    }

    private readHeader(headers: Record<string, unknown> | undefined, keys: string[]): string | null {
        if (!headers) {
            return null
        }

        const normalizeValue = (value: unknown): string | null => {
            if (value === undefined || value === null) {
                return null
            }
            if (Array.isArray(value)) {
                const first = value.find((entry) => entry !== undefined && entry !== null && String(entry).trim())
                return first !== undefined ? String(first) : null
            }
            const text = String(value)
            return text ? text : null
        }

        const headerGetter = (headers as { get?: (name: string) => unknown }).get
        if (typeof headerGetter === 'function') {
            for (const key of keys) {
                const match = normalizeValue(headerGetter.call(headers, key))
                if (match) {
                    return match
                }
            }
        }

        const entries =
                  typeof (headers as { entries?: () => Iterable<[string, unknown]> }).entries === 'function'
                  ? Array.from((headers as { entries: () => Iterable<[string, unknown]> }).entries())
                  : Object.entries(headers)

        const normalized = Object.fromEntries(entries.map(([key, value]) => [String(key).toLowerCase(), value]))
        for (const key of keys) {
            const match = normalizeValue(normalized[key.toLowerCase()])
            if (match) {
                return match
            }
        }
        return null
    }

    /**
     * 设置请求/响应拦截器
     */
    private setupInterceptors(): void {
        // 请求拦截器
        this.instance.interceptors.request.use(
            (config) => {
                // 认证已失败，阻止后续请求发出
                if (this.authFailed) {
                    return Promise.reject(new axios.Cancel('Authentication failed, request aborted'))
                }

                // 记录请求发起时的认证会话
                const authScopedConfig = config as AuthScopedRequestConfig
                if (authScopedConfig.__authGeneration !== undefined &&
                    authScopedConfig.__authGeneration !== this.authGeneration) {
                    return Promise.reject(new axios.Cancel(i18n.t('common.connection_changed')))
                }
                authScopedConfig.__authGeneration = this.authGeneration

                // 设置 baseURL
                config.baseURL = this.apiBase
                if (config.url) {
                    // Normalize deprecated Gemini endpoint to the current path.
                    config.url = config.url.replace(/\/generative-language-api-key\b/g, '/gemini-api-key')
                }

                if (['post', 'put', 'patch', 'delete'].includes(config.method ?? '') ||
                    (config.method === 'get' && (OAUTH_CREATION_PATHS.has(config.url?.split(/[?#]/, 1)[0] ?? '') ||
                                                 typeof authScopedConfig.mutationReadback === 'function'))) {
                    const bytes                         = crypto.getRandomValues(new Uint8Array(16))
                    bytes[6]                            = (bytes[6] & 0x0f) | 0x40
                    bytes[8]                            = (bytes[8] & 0x3f) | 0x80
                    const hex                           = Array.from(
                        bytes,
                        (byte) => byte.toString(16).padStart(2, '0'),
                    )
                                                               .join('')
                    const id                            = this.readHeader(config.headers, ['X-CPA-Mutation-ID']) ??
                                                          `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(
                                                              12,
                                                              16,
                                                          )}-${hex.slice(
                                                              16,
                                                              20,
                                                          )}-${hex.slice(20)}`
                    authScopedConfig.__mutationId       = id
                    config.headers['X-CPA-Mutation-ID'] = id
                }

                // 添加认证头
                if (this.managementKey) {
                    config.headers.Authorization = `Bearer ${this.managementKey}`
                }

                return config
            },
            (error) => Promise.reject(this.handleError(error)),
        )

        // 响应拦截器
        this.instance.interceptors.response.use(
            async (response) => {
                const responseGeneration = (response.config as AuthScopedRequestConfig).__authGeneration
                if (responseGeneration !== this.authGeneration) {
                    return response
                }

                const headers = response.headers as Record<string, string | undefined>
                const receipt = this.mutationReceipt(response.config as AuthScopedRequestConfig, headers)
                if (receipt) {
                    (response.config as AuthScopedRequestConfig).onMutationReceipt?.(receipt)
                }
                const readback = (response.config as AuthScopedRequestConfig).mutationReadback
                if (receipt && (readback || response.config.method === 'get')) {
                    try {
                        await this.reconcileResourceMutation(
                            receipt,
                            readback ?? (async () => undefined),
                            response.data,
                        )
                    } catch (error: unknown) {
                        const failure   = error as ApiError
                        failure.status ??= response.status
                        failure.data    = response.data
                        failure.details = response.data
                        throw failure
                    }
                }
                if (responseGeneration !== this.authGeneration) {
                    return response
                }
                const version   = this.readHeader(headers, VERSION_HEADER_KEYS)
                const buildDate = this.readHeader(headers, BUILD_DATE_HEADER_KEYS)

                // 触发版本更新事件（后续通过 store 处理）
                if (version || buildDate) {
                    window.dispatchEvent(
                        new CustomEvent('server-version-update', {
                            detail: { version: version || null, buildDate: buildDate || null },
                        }),
                    )
                }

                return response
            },
            async (error) => {
                const failure = this.handleError(error)
                const config  = error?.config as AuthScopedRequestConfig | undefined
                if (failure.mutation && (config?.mutationReadback || config?.method === 'get')) {
                    await this.reconcileResourceMutation(
                        failure.mutation,
                        config.mutationReadback ?? (async () => undefined),
                        failure.data,
                        failure,
                    )
                }
                return Promise.reject(failure)
            },
        )
    }

    /**
     * 错误处理
     */
    private handleError(error: unknown): ApiError {
        const isRecord = (value: unknown): value is Record<string, unknown> =>
            value !== null && typeof value === 'object'

        if (axios.isAxiosError(error)) {
            const responseData: unknown = error.response?.data
            const responseRecord        = isRecord(responseData) ? responseData : null
            const errorValue            = responseRecord?.error
            const message               =
                      typeof errorValue === 'string'
                      ?
                      (typeof responseRecord?.message ===
                       'string' &&
                       responseRecord.message.trim() &&
                       responseRecord.message !==
                       errorValue ?
                       `${errorValue}: ${responseRecord.message}` : errorValue)
                      :
                      isRecord(errorValue) && typeof errorValue.message === 'string'
                      ? errorValue.message
                      : typeof responseRecord?.message === 'string'
                        ? responseRecord.message
                        : error.message || 'Request failed'
            const apiError              = new Error(message) as ApiError
            const bodyRetryAfter        = finiteNonNegativeNumber(responseRecord?.retry_after_seconds)
            const headerRetryAfter      = parseRetryAfterSeconds(
                this.readHeader(error.response?.headers as Record<string, unknown> | undefined, ['Retry-After']),
            )
            const retryAfterSeconds     = Math.max(
                bodyRetryAfter === undefined ? 0 : Math.ceil(bodyRetryAfter),
                headerRetryAfter ?? 0,
            )
            const bannedUntil           =
                      typeof responseRecord?.banned_until === 'string' && responseRecord.banned_until.trim()
                      ? responseRecord.banned_until
                      : retryAfterSeconds > 0
                        ? new Date(Date.now() + retryAfterSeconds * 1000).toISOString()
                        : undefined
            apiError.name               = 'ApiError'
            apiError.status             = error.response?.status
            apiError.code               = error.code
            apiError.backendCode        = typeof responseRecord?.code === 'string' ? responseRecord.code : undefined
            apiError.retryAfterSeconds  = retryAfterSeconds > 0 ? retryAfterSeconds : undefined
            apiError.rateLimitUntil     = bannedUntil
            apiError.details            = responseData
            apiError.data               = responseData
            apiError.mutation           = this.mutationReceipt(
                error.config as AuthScopedRequestConfig | undefined,
                error.response?.headers as Record<string, unknown> | undefined,
            )
            apiError.requestId          = apiError.mutation?.request_id ?? this.readHeader(
                error.response?.headers as Record<string, unknown> | undefined, ['X-Request-ID', 'X-CPA-Request-ID'],
            ) ?? undefined

            // 只有当前认证会话的 401 可以使会话失效
            const requestGeneration = (error.config as AuthScopedRequestConfig | undefined)?.__authGeneration
            if (error.response?.status === 401 &&
                requestGeneration === this.authGeneration &&
                !this.authFailed) {
                this.authFailed = true
                window.dispatchEvent(new Event('unauthorized'))
            }

            return apiError
        }

        const fallbackMessage =
                  error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown error occurred'
        const fallback        = new Error(fallbackMessage) as ApiError
        fallback.name         = 'ApiError'
        return fallback
    }
}

// 导出单例
export const apiClient = new ApiClient()
