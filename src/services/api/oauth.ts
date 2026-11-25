/**
 * OAuth 与设备码登录相关 API
 */

import {apiClient, MUTATION_TARGET_REACHED} from './client'

export type OAuthProvider = string

interface OAuthStartResponse {
    url: string
    state?: string
    user_code?: string
    flow?: string
    expires_in?: number
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
    phase?: 'pending' | 'accepted' | 'exchanging' | 'saving' | 'publishing_file' | 'publishing_auth' | 'success'
            | 'error' | 'expired'
    error?: string
}

interface OAuthRequestOptions {
    projectId?: string
    plugin?: boolean
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
const oauthProof                                                    = (nonce?: string) => nonce ?
    { 'X-CPA-OAuth-Token': nonce } :
                                                                                          undefined

export const oauthApi = {
    startAuth: (provider: OAuthProvider, options?: OAuthRequestOptions) => {
        const params: Record<string, string | boolean> = {}
        if (options?.plugin || WEBUI_SUPPORTED.includes(provider)) {
            params.is_webui = true
        }
        if (!options?.plugin && provider === 'gemini-cli' && options?.projectId) {
            params.project_id = options.projectId
        }
        return apiClient.get<OAuthStartResponse>(`/${encodeURIComponent(provider)}-auth-url`, {
            params: Object.keys(params).length ? params : undefined,
            headers: oauthProof(options?.nonce),
            signal: options?.signal,
            mutationReadback: async (data, receipt) => {
                if (!receipt.metadata_present || options?.signal?.aborted ||
                    receipt.authGeneration !== apiClient.getAuthGeneration()) {
                    return
                }
                const state = (data as Partial<OAuthStartResponse> | null)?.state
                if (typeof state !== 'string' || !state.trim()) {
                    return
                }
                const observed = await oauthApi.getAuthStatus(state.trim(), options?.nonce, options?.signal)
                if (options?.signal?.aborted || receipt.authGeneration !== apiClient.getAuthGeneration()) {
                    return
                }
                if ((observed.status ===
                     'wait' &&
                     ['pending', 'accepted', 'exchanging', 'saving', 'publishing_file', 'publishing_auth'].includes(
                         observed.phase ?? '')) ||
                    (observed.status === 'ok' && observed.phase === 'success')) {
                    return MUTATION_TARGET_REACHED
                }
            },
        })
    },

    getAuthStatus: (state: string, nonce?: string, signal?: AbortSignal) =>
        apiClient.get<OAuthStatusResponse>(`/get-auth-status`, {
            params: { state },
            headers: oauthProof(nonce),
            signal,
        }),

    cancelSession: (state: string, nonce?: string, signal?: AbortSignal) =>
        apiClient.delete<OAuthCancelResponse>('/oauth-session', {
            params: { state },
            headers: oauthProof(nonce),
            signal,
            mutationReadback: async () => {
                if (!signal?.aborted) {
                    await oauthApi.getAuthStatus(state, nonce, signal)
                }
            },
        }),

    submitCallback: (
        provider: OAuthProvider,
        redirectUrl: string,
        nonce: string,
        signal?: AbortSignal,
        plugin = false,
    ) => {
        const callbackProvider = plugin ? provider : CALLBACK_PROVIDER_MAP[provider] ?? provider
        return apiClient.post<OAuthCallbackResponse>('/oauth-callback', {
            provider: callbackProvider,
            redirect_url: redirectUrl,
        }, { headers: oauthProof(nonce), signal, mutationReadback: () => apiClient.get('/auth-files') })
    },

    /** iFlow cookie 认证 */
    iflowCookieAuth: (cookie: string) => apiClient.post<IFlowCookieAuthResponse>(
        '/iflow-auth-url',
        { cookie },
        {
            mutationReadback: () => apiClient.get('/auth-files'),
        },
    ),
}
