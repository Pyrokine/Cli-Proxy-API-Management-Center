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

const OFFICIAL_PLUGIN_REPO_OWNER       = 'router-for-me'
const DEFAULT_PLUGIN_STORE_SOURCE_ID   = 'official'
const DEFAULT_PLUGIN_STORE_SOURCE_NAME = 'official'
const GITHUB_REPOSITORY_HOSTS          = new Set(['github.com', 'www.github.com'])

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

const getGitHubRepositoryOwner = (repository: string | undefined): string => {
    const repositoryURL = buildRepositoryURL(repository)
    if (!repositoryURL) {
        return ''
    }
    try {
        const url = new URL(repositoryURL)
        if (url.protocol !== 'https:' || !GITHUB_REPOSITORY_HOSTS.has(url.hostname.toLowerCase())) {
            return ''
        }
        const segments = url.pathname.split('/').filter(Boolean)
        if (segments.length !== 2) {
            return ''
        }
        const [owner = '', repo = ''] = segments
        return owner && repo ? owner.toLowerCase() : ''
    } catch {
        return ''
    }
}

export const isOfficialPlugin = (entry: PluginStoreEntry): boolean =>
    entry.source_id.trim().toLowerCase() === DEFAULT_PLUGIN_STORE_SOURCE_ID &&
    getGitHubRepositoryOwner(entry.repository) === OFFICIAL_PLUGIN_REPO_OWNER

export const isDefaultPluginStoreSource = (entry: Pick<PluginStoreEntry, 'source_id' | 'source_name'>): boolean => {
    const sourceID = entry.source_id.trim().toLowerCase()
    return sourceID === DEFAULT_PLUGIN_STORE_SOURCE_ID ||
           (!sourceID && entry.source_name.trim().toLowerCase() === DEFAULT_PLUGIN_STORE_SOURCE_NAME)
}

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
