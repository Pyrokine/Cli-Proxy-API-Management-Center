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

export interface PluginListResponse {
    plugins_enabled: boolean
    plugins_dir: string
    plugins: PluginEntry[]
}

export interface PluginDeleteResult {
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

export interface PluginStoreInstallResult {
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

export interface PluginStoreInstallOptions {
    sourceId?: string
    version?: string
}

export interface PluginStoreRelease {
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

const OAUTH_PROVIDER_ALIASES: Record<string, OAuthProvider> = {
    'anthropic': 'anthropic',
    'antigravity': 'antigravity',
    'claude': 'anthropic',
    'codex': 'codex',
    'gemini': 'gemini-cli',
    'gemini-cli': 'gemini-cli',
    'kimi': 'kimi',
    'qwen': 'qwen',
    'xai': 'xai',
}

const normalizePluginOAuthProvider = (value: unknown): OAuthProvider | undefined => {
    const key = String(value ?? '').trim().toLowerCase()
    return OAUTH_PROVIDER_ALIASES[key]
}

const normalizePluginEntry = (plugin: PluginEntry): PluginEntry => {
    const oauthProvider =
              normalizePluginOAuthProvider(plugin.oauth_provider) ??
              (plugin.supports_oauth ? normalizePluginOAuthProvider(plugin.id) : undefined)
    if (!oauthProvider || oauthProvider === plugin.oauth_provider) {
        return plugin
    }
    return { ...plugin, oauth_provider: oauthProvider }
}

const normalizePluginListResponse = (response: PluginListResponse): PluginListResponse => ({
    ...response,
    plugins: (response.plugins ?? []).map(normalizePluginEntry),
})

export const pluginsApi = {
    list: async (config?: AxiosRequestConfig) => normalizePluginListResponse(
        await apiClient.get<PluginListResponse>('/plugins', config),
    ),
    setEnabled: (id: string, enabled: boolean) =>
        apiClient.patch<void>(`/plugins/${encodeURIComponent(id)}/enabled`, { enabled }),
    deletePlugin: (id: string) => apiClient.delete<PluginDeleteResult>(`/plugins/${encodeURIComponent(id)}`),
    patchConfig: (id: string, config: PluginConfigObject) =>
        apiClient.patch<void>(`/plugins/${encodeURIComponent(id)}/config`, config),
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
            config,
        )
    },
}
