/**
 * Releases API — proxied GitHub releases with server-side caching.
 */

import {apiClient} from './client'

export interface ReleaseAsset {
    name: string
    size: number
    browser_download_url: string
}

export interface Release {
    tag_name: string
    name: string
    body: string
    draft: boolean
    prerelease: boolean
    published_at: string
    html_url: string
    assets: ReleaseAsset[]
}

interface ReleasesResponse {
    releases: Release[]
    total: number
    page: number
    per_page: number
    target?: 'cpa' | 'panel'
}

export type ReleasesTarget = 'cpa' | 'panel'

export const releasesApi = {
    list: (page = 1, perPage = 100, target: ReleasesTarget = 'cpa', force = false) =>
        apiClient.get<ReleasesResponse>(
            `/releases?page=${page}&per_page=${perPage}&target=${target}${force ? '&force=1' : ''}`,
        ),
}
