import type {PluginEntry, PluginMenu, PluginStoreEntry} from '@/services/api/plugins'
import {normalizeApiBase} from '@/utils/connection'

export const PLUGIN_RESOURCES_REFRESH_EVENT = 'plugin-resources-refresh'

export interface PluginResourceEntry {
    pluginID: string
    pluginTitle: string
    pluginLogo: string
    resourceKey: string
    menuIndex: number
    menu: PluginMenu
    label: string
    description: string
    route: string
}

export const notifyPluginResourcesChanged = () => {
    window.dispatchEvent(new Event(PLUGIN_RESOURCES_REFRESH_EVENT))
}

export const getPluginTitle = (plugin: PluginEntry): string => plugin.metadata?.name?.trim() || plugin.id

export const pluginResourceKey = (path: string): string => path.trim()

export const buildPluginResourceRoute = (pluginID: string, path: string): string =>
    `/plugin-pages/${encodeURIComponent(pluginID)}/${encodeURIComponent(pluginResourceKey(path))}`

export const resolvePluginAssetURL = (value: string | undefined, apiBase: string): string => {
    const trimmed = (value ?? '').trim()
    if (!trimmed) {
        return ''
    }
    if (/^(?:https?:|data:|blob:)/i.test(trimmed)) {
        return trimmed
    }
    if (!trimmed.startsWith('/')) {
        return trimmed
    }
    const base = normalizeApiBase(apiBase)
    return base ? `${base}${trimmed}` : trimmed
}

export const buildRepositoryURL = (repository: string | undefined): string => {
    const trimmed = (repository ?? '').trim()
    if (!trimmed) {
        return ''
    }
    if (/^https?:\/\//i.test(trimmed)) {
        return trimmed
    }
    return `https://github.com/${trimmed.replace(/^\/+/, '')}`
}

const OFFICIAL_PLUGIN_REPO_PREFIX      = 'https://github.com/router-for-me/'
const DEFAULT_PLUGIN_STORE_SOURCE_ID   = 'official'
const DEFAULT_PLUGIN_STORE_SOURCE_NAME = 'official'

export const getPluginRepositorySlug = (repository: string | undefined): string => {
    const trimmed = (repository ?? '').trim()
    if (!trimmed) {
        return ''
    }
    const withoutHost = /^https?:\/\/[^/]+\/(?<path>.+)$/i.exec(trimmed)?.groups?.path ?? trimmed
    const [owner      = '', repo = ''] = withoutHost.replace(/^\/+/, '').split('/')
    if (!owner) {
        return ''
    }
    return repo ? `${owner}/${repo.replace(/\.git$/i, '')}` : owner
}

export const isOfficialPlugin = (entry: PluginStoreEntry): boolean =>
    buildRepositoryURL(entry.repository).toLowerCase().startsWith(OFFICIAL_PLUGIN_REPO_PREFIX)

export const isDefaultPluginStoreSource = (entry: Pick<PluginStoreEntry, 'source_id' | 'source_name'>): boolean =>
    entry.source_id.trim().toLowerCase() === DEFAULT_PLUGIN_STORE_SOURCE_ID ||
    entry.source_name.trim().toLowerCase() === DEFAULT_PLUGIN_STORE_SOURCE_NAME

export const getPluginConfirmToken = (entry: PluginStoreEntry): string =>
    getPluginRepositorySlug(entry.repository) || entry.id

export const collectPluginResourceEntries = (plugins: PluginEntry[]): PluginResourceEntry[] =>
    plugins.flatMap((plugin) => {
        if (!plugin.effective_enabled) {
            return []
        }
        const pluginTitle = getPluginTitle(plugin)
        const pluginLogo  = plugin.logo || plugin.metadata?.logo || ''
        return plugin.menus
                     .map((menu, menuIndex): PluginResourceEntry | null => {
                         const path = menu.path.trim()
                         if (!path) {
                             return null
                         }
                         const menuLabel = menu.menu.trim()
                         return {
                             pluginID: plugin.id,
                             pluginTitle,
                             pluginLogo,
                             resourceKey: pluginResourceKey(path),
                             menuIndex,
                             menu: { ...menu, path },
                             label: menuLabel || pluginTitle,
                             description: menu.description.trim() || pluginTitle,
                             route: buildPluginResourceRoute(plugin.id, path),
                         }
                     })
                     .filter((entry): entry is PluginResourceEntry => Boolean(entry))
    })
