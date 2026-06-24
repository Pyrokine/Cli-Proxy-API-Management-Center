import {apiClient} from './client'

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

export const pluginsApi = {
    list: () => apiClient.get<PluginListResponse>('/plugins'),
    setEnabled: (id: string, enabled: boolean) =>
        apiClient.patch<void>(`/plugins/${encodeURIComponent(id)}/enabled`, { enabled }),
    patchConfig: (id: string, config: PluginConfigObject) =>
        apiClient.patch<void>(`/plugins/${encodeURIComponent(id)}/config`, config),
}
