import i18n from '@/i18n'
import type {ApiClientConfig} from '@/types'
import {normalizeApiBase} from '@/utils/connection'
import {REQUEST_TIMEOUT_MS} from '@/utils/constants'
import {normalizeOAuthProviderKey} from '@/utils/providerKeys'
import type {AxiosRequestConfig} from 'axios'
import {apiClient} from './client'
import type {OAuthProvider} from './oauth'

export type PluginConfigValue = string | number | boolean | null | PluginConfigValue[] | {
    [key: string]: PluginConfigValue
}
export type PluginConfigObject = Record<string, PluginConfigValue>

export interface PluginConfigField {
    name: string
    type: 'string' | 'number' | 'integer' | 'boolean' | 'enum' | 'array' | 'object' | string
    enum_values: string[]
    description: string
}

export interface PluginMenu {
    path: string
    menu: string
    description: string
}

export interface PluginMetadata {
    name: string
    version: string
    author: string
    github_repository: string
    logo: string
    config_fields: PluginConfigField[]
}

export interface PluginEntry {
    id: string
    path: string
    configured: boolean
    registered: boolean
    enabled: boolean
    effective_enabled: boolean
    supports_oauth: boolean
    oauth_provider?: OAuthProvider
    logo: string
    config: PluginConfigObject
    config_fields: PluginConfigField[]
    menus: PluginMenu[]
    metadata: PluginMetadata | null
}

interface PluginListResponse {
    plugins_enabled: boolean
    plugins_dir: string
    plugins: PluginEntry[]
}

interface PluginDeleteResult {
    status: string
    id: string
    path: string
    file_deleted: boolean
    configured_removed: boolean
    runtime_unloaded: boolean
    restart_required: boolean
}

export interface PluginStorePlatform {
    goos: string
    goarch: string
}

export interface PluginStoreEntry {
    store_id: string
    source_id: string
    source_name: string
    source_url: string
    id: string
    name: string
    description: string
    author: string
    version: string
    repository: string
    install_type: string
    auth_required: boolean
    auth_configured: boolean
    platforms?: PluginStorePlatform[]
    logo?: string
    homepage?: string
    license?: string
    tags?: string[]
    installed: boolean
    installed_version: string
    path: string
    configured: boolean
    registered: boolean
    enabled: boolean
    effective_enabled: boolean
    update_available: boolean
}

export interface PluginStoreSource {
    id: string
    name: string
    url: string
}

export interface PluginStoreSourceError {
    source_id: string
    source_name: string
    source_url: string
    message: string
}

export interface PluginStoreResponse {
    plugins_enabled: boolean
    plugins_dir: string
    sources: PluginStoreSource[]
    source_errors?: PluginStoreSourceError[]
    plugins: PluginStoreEntry[]
}

interface PluginStoreInstallResult {
    status: string
    source_id: string
    source_name: string
    source_url: string
    id: string
    version: string
    install_type: string
    path: string
    plugins_enabled: boolean
    restart_required: boolean
}

interface PluginStoreInstallOptions {
    sourceId?: string
    version?: string
}

interface PluginStoreRelease {
    tag_name: string
    name: string
    published_at: string
    prerelease: boolean
    html_url: string
    asset_names: string[]
}

export const buildPluginStoreReleasesPath = (id: string, sourceId?: string): string => {
    const params = new URLSearchParams()
    if (sourceId?.trim()) {
        params.set('source', sourceId.trim())
    }
    const query = params.size > 0 ? `?${params.toString()}` : ''
    return `/plugin-store/${encodeURIComponent(id)}/releases${query}`
}

const OAUTH_PROVIDER_ALIASES = new Map<string, OAuthProvider>([
                                                                  ['anthropic', 'anthropic'],
                                                                  ['antigravity', 'antigravity'],
                                                                  ['claude', 'anthropic'],
                                                                  ['codex', 'codex'],
                                                                  ['gemini', 'gemini-cli'],
                                                                  ['gemini-cli', 'gemini-cli'],
                                                                  ['kimi', 'kimi'],
                                                                  ['meta', 'meta'],
                                                                  ['qwen', 'qwen'],
                                                                  ['xai', 'xai'],
                                                              ])

const normalizePluginOAuthProvider = (value: unknown): OAuthProvider | undefined => {
    if (typeof value !== 'string') {
        return undefined
    }
    const provider = normalizeOAuthProviderKey(value)
    return /^[a-z0-9-]+$/.test(provider) ? provider : undefined
}

const normalizePluginEntry = (plugin: PluginEntry): PluginEntry => {
    const oauthProvider = plugin.supports_oauth
                          ? plugin.oauth_provider !== undefined
                            ? normalizePluginOAuthProvider(plugin.oauth_provider)
                            : OAUTH_PROVIDER_ALIASES.get(normalizeOAuthProviderKey(String(plugin.id)))
                          : undefined
    return { ...plugin, oauth_provider: oauthProvider }
}

const normalizePluginListResponse = (response: PluginListResponse): PluginListResponse => ({
    ...response,
    plugins: (response.plugins ?? []).map(normalizePluginEntry),
})

const resourceSessionRevocations = new Map<string, Promise<void>>()
// Cookie 按主机共享，协议和端口变化仍需等待原会话撤销
const resourceSessionLockName    = (apiBase: string) => `cpam:plugin-resource-session:${new URL(apiBase).hostname}`

async function withResourceSessionLock(
    apiBase: string,
    operation: (signal: AbortSignal) => Promise<void>,
): Promise<void> {
    const lockName   = resourceSessionLockName(apiBase)
    const pending    = resourceSessionRevocations.get(lockName)
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout    = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
            const error = new Error('Plugin session request timed out')
            controller.abort(error)
            reject(error)
        }, REQUEST_TIMEOUT_MS)
    })
    try {
        let started     = false
        const run       = async () => {
            controller.signal.throwIfAborted()
            started = true
            await pending
            controller.signal.throwIfAborted()
            await operation(controller.signal)
        }
        // noinspection ES6MissingAwait
        const request   = typeof navigator !== 'undefined' && typeof navigator.locks?.request === 'function' ?
                          navigator.locks.request(resourceSessionLockName(apiBase), { signal: controller.signal }, run)
                                   .catch((error: unknown) => {
                                       if (started || controller.signal.aborted) {
                                           throw error
                                       }
                                       console.warn('Plugin session cross-tab coordination unavailable:', error)
                                       return run()
                                   }) :
                          run()
        const completed = Promise.race([request, timeout])
        const settled   = completed.then(() => {
        }, () => {
        })
        resourceSessionRevocations.set(lockName, settled)
        void settled.then(() => {
            if (resourceSessionRevocations.get(lockName) === settled) {
                resourceSessionRevocations.delete(lockName)
            }
        })
        await completed
    } finally {
        clearTimeout(timer)
    }
}

export const pluginsApi = {
    revokeResourceSession: async (connection: Pick<ApiClientConfig, 'apiBase' | 'managementKey'>): Promise<void> => {
        const apiBase       = normalizeApiBase(connection.apiBase)
        const managementKey = connection.managementKey.trim()
        const lockName      = resourceSessionLockName(apiBase)
        const pending       = resourceSessionRevocations.get(lockName)
        const request       = withResourceSessionLock(apiBase, async (signal) => {
            await pending
            signal.throwIfAborted()
            const response = await fetch(`${apiBase}/v0/resource/plugins/session`, {
                method: 'DELETE',
                credentials: 'include',
                headers: managementKey ? { Authorization: `Bearer ${managementKey}` } : undefined,
                redirect: 'error',
                signal,
            })
            if (response.status !== 204) {
                throw new Error(`${response.status} ${response.statusText}`.trim())
            }
        })
        const settled       = request.then(() => {
        }, () => {
        })
        resourceSessionRevocations.set(lockName, settled)
        void settled.then(() => {
            if (resourceSessionRevocations.get(lockName) === settled) {
                resourceSessionRevocations.delete(lockName)
            }
        })
        await request
    },
    waitForResourceSessionRevocation: async (apiBase: string): Promise<void> => {
        const pending = resourceSessionRevocations.get(resourceSessionLockName(apiBase))
        await withResourceSessionLock(apiBase, async (signal) => {
            await pending
            signal.throwIfAborted()
        })
    },
    list: async (config?: AxiosRequestConfig) => normalizePluginListResponse(
        await apiClient.get<PluginListResponse>('/plugins', config),
    ),
    getConfig: async (id: string): Promise<PluginConfigObject> => {
        const value = await apiClient.get<unknown>(`/plugins/${encodeURIComponent(id)}/config`)
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            throw new Error(i18n.t('plugin_management.invalid_config_response'))
        }
        return value as PluginConfigObject
    },
    setEnabled: (id: string, enabled: boolean) =>
        apiClient.patch<void>(
            `/plugins/${encodeURIComponent(id)}/enabled`,
            { enabled },
            { mutationReadback: () => pluginsApi.list() },
        ),
    deletePlugin: (id: string) => apiClient.delete<PluginDeleteResult>(
        `/plugins/${encodeURIComponent(id)}`,
        { mutationReadback: () => pluginsApi.list() },
    ),
    patchConfig: (id: string, config: PluginConfigObject) =>
        apiClient.patch<void>(
            `/plugins/${encodeURIComponent(id)}/config`,
            config,
            { mutationReadback: () => pluginsApi.list() },
        ),
}

export const pluginStoreApi = {
    list: (config?: AxiosRequestConfig) => apiClient.get<PluginStoreResponse>('/plugin-store', config),
    listReleases: (id: string, sourceId?: string, config?: AxiosRequestConfig) =>
        apiClient.get<PluginStoreRelease[]>(buildPluginStoreReleasesPath(id, sourceId), config),
    install: (id: string, options: PluginStoreInstallOptions = {}, config?: AxiosRequestConfig) => {
        const params   = new URLSearchParams()
        const sourceId = options.sourceId?.trim()
        const version  = options.version?.trim()
        if (sourceId) {
            params.set('source', sourceId)
        }
        if (version) {
            params.set('version', version)
        }
        const query = params.size > 0 ? `?${params.toString()}` : ''
        return apiClient.post<PluginStoreInstallResult>(
            `/plugin-store/${encodeURIComponent(id)}/install${query}`,
            version ? { version } : undefined,
            { ...(config), mutationReadback: () => pluginsApi.list() },
        )
    },
}
