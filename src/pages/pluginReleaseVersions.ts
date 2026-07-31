import {pluginStoreApi} from '@/services/api'
import type {AxiosRequestConfig} from 'axios'

export interface PluginReleaseVersion {
    tagName: string
    name: string
    publishedAt: string
    prerelease: boolean
    htmlUrl: string
    assetNames: string[]
}

const GITHUB_HOSTS               = new Set(['github.com', 'www.github.com'])
const MANUAL_RELEASE_TAG_PATTERN = /^[vV]?[0-9][0-9A-Za-z.+-]*$/

export const supportsPluginVersionSelection = (installType: string): boolean =>
    installType.trim().toLowerCase() === 'github-release'

const isRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value)

const stripGitSuffix = (value: string) => value.replace(/\.git$/i, '')

export const getGitHubRepositorySlug = (repository?: string | null): string => {
    const trimmed = repository?.trim() ?? ''
    if (!trimmed) {
        return ''
    }

    try {
        const repositoryURL = /^https?:\/\//i.test(trimmed) ?
                              new URL(trimmed) :
                              new URL(`https://github.com/${trimmed.replace(/^github\.com\//i, '').replace(/^\/+/, '')}`)
        if (!GITHUB_HOSTS.has(repositoryURL.hostname.toLowerCase())) {
            return ''
        }
        const segments = repositoryURL.pathname.split('/').filter(Boolean)
        if (segments.length !== 2) {
            return ''
        }
        const [owner = '', rawRepo = ''] = segments
        const repo                      = stripGitSuffix(rawRepo)
        if (!owner || !repo || !/^[A-Za-z0-9-]+$/.test(owner) || !/^[A-Za-z0-9._-]+$/.test(repo)) {
            return ''
        }
        return `${owner}/${repo}`
    } catch {
        return ''
    }
}

export const buildGitHubReleasesPageURL = (repository?: string | null): string => {
    const slug = getGitHubRepositorySlug(repository)
    return slug ? `https://github.com/${slug}/releases` : ''
}

export const isValidManualReleaseTag = (value: string): boolean => {
    const trimmed = value.trim()
    return !trimmed || MANUAL_RELEASE_TAG_PATTERN.test(trimmed)
}

const normalizeAssetNames = (value: unknown): string[] => {
    if (!Array.isArray(value)) {
        return []
    }
    return value.map((asset) => String(asset ?? '').trim()).filter(Boolean)
}

const normalizeRelease = (value: unknown): PluginReleaseVersion | null => {
    if (!isRecord(value) || typeof value.tag_name !== 'string') {
        return null
    }
    const tagName = value.tag_name.trim()
    if (!tagName) {
        return null
    }

    return {
        tagName,
        name: typeof value.name === 'string' ? value.name.trim() : '',
        publishedAt: typeof value.published_at === 'string' ? value.published_at : '',
        prerelease: value.prerelease === true,
        htmlUrl: typeof value.html_url === 'string' ? value.html_url.trim() : '',
        assetNames: normalizeAssetNames(value.asset_names),
    }
}

export const normalizePluginReleaseVersions = (value: unknown): PluginReleaseVersion[] => {
    if (!Array.isArray(value)) {
        throw new Error('GitHub releases response is not a list')
    }
    return value
        .map(normalizeRelease)
        .filter((release): release is PluginReleaseVersion => Boolean(release))
        .filter((release) => isValidManualReleaseTag(release.tagName))
}

export const fetchPluginReleaseVersions = async (
    pluginId: string,
    sourceId: string,
    config?: AxiosRequestConfig,
): Promise<PluginReleaseVersion[]> =>
    normalizePluginReleaseVersions(await pluginStoreApi.listReleases(pluginId, sourceId, config))
