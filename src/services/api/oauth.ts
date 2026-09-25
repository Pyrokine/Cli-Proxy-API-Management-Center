/**
 * OAuth 与设备码登录相关 API
 */

import {apiClient} from './client'

export type OAuthProvider =
    'codex' | 'anthropic' | 'antigravity' | 'gemini-cli' | 'kimi' | 'qwen' | 'xai' | 'devin'

interface OAuthStartResponse {
    url: string
    state?: string
}

interface OAuthCallbackResponse {
    status: 'ok'
}

interface OAuthCancelResponse {
    status: 'ok'
    cancelled: boolean
}

export interface OAuthStatusResponse {
    status: 'ok' | 'wait' | 'error'
    phase?: 'pending' | 'accepted' | 'saving' | 'success' | 'error' | 'expired'
    error?: string
}

interface OAuthRequestOptions {
    projectId?: string
    nonce?: string
    signal?: AbortSignal
}

interface IFlowCookieAuthResponse {
    status: 'ok' | 'error'
    error?: string
    saved_path?: string
    email?: string
    expired?: string
    type?: string
}

const WEBUI_SUPPORTED: OAuthProvider[]                              = [
    'codex',
    'anthropic',
    'antigravity',
    'gemini-cli',
    'xai',
    'devin',
]
const CALLBACK_PROVIDER_MAP: Partial<Record<OAuthProvider, string>> = {
    'gemini-cli': 'gemini',
}

export const oauthApi = {
    startAuth: (provider: OAuthProvider, options?: OAuthRequestOptions) => {
        const params: Record<string, string | boolean> = {}
        if (WEBUI_SUPPORTED.includes(provider)) {
            params.is_webui = true
        }
        if (provider === 'gemini-cli' && options?.projectId) {
            params.project_id = options.projectId
        }
        if (options?.nonce) {
            params.nonce = options.nonce
        }
        return apiClient.get<OAuthStartResponse>(`/${provider}-auth-url`, {
            params: Object.keys(params).length ? params : undefined,
            signal: options?.signal,
        })
    },

    getAuthStatus: (state: string, nonce?: string, signal?: AbortSignal) =>
        apiClient.get<OAuthStatusResponse>(`/get-auth-status`, {
            params: nonce ? { state, nonce } : { state },
            signal,
        }),

    cancelSession: (state: string, nonce?: string, signal?: AbortSignal) =>
        apiClient.delete<OAuthCancelResponse>('/oauth-session', {
            params: nonce ? { state, nonce } : { state },
            signal,
        }),

    submitCallback: (provider: OAuthProvider, redirectUrl: string, signal?: AbortSignal) => {
        const callbackProvider = CALLBACK_PROVIDER_MAP[provider] ?? provider
        return apiClient.post<OAuthCallbackResponse>('/oauth-callback', {
            provider: callbackProvider,
            redirect_url: redirectUrl,
        }, { signal })
    },

    /** iFlow cookie 认证 */
    iflowCookieAuth: (cookie: string) => apiClient.post<IFlowCookieAuthResponse>('/iflow-auth-url', { cookie }),
}
