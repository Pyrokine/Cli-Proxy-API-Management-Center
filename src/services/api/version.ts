/**
 * 版本相关 API
 */

import {apiClient} from './client'

export interface ServerFeatureFlags {
    plugins?: boolean
}

export interface ServerVersionInfo {
    version: string
    build_time: string
    commit: string
    min_panel_version: string
    features?: ServerFeatureFlags
}

let inflightVersionRequest: Promise<ServerVersionInfo> | null = null

function getRunningVersion(): Promise<ServerVersionInfo> {
    if (inflightVersionRequest) {
        return inflightVersionRequest
    }
    inflightVersionRequest = apiClient.get<ServerVersionInfo>('/version').finally(() => {
        inflightVersionRequest = null
    })
    return inflightVersionRequest
}

/**
 * versionApi.checkLatest fetches the latest release tag from GitHub.
 * versionApi.get fetches the *running* server's build metadata and the minimum
 * panel version it is compatible with. An old backend will 404 here — callers
 * should treat that as "no compat data" rather than surfacing the error.
 */
export const versionApi = {
    checkLatest: () => apiClient.get<Record<string, unknown>>('/latest-version'),
    get: () => getRunningVersion(),
}
