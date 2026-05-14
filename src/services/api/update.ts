/**
 * Update API — trigger and monitor CPA backend self-update.
 */

import { apiClient } from './client'

export interface UpdateStatus {
    status: 'idle' | 'downloading' | 'verifying' | 'replacing' | 'done' | 'error'
    message: string
    target_version: string
    percent: number
    current_version: string
}

export interface UpdateCompatibilityUsage {
    configured_data_dir?: string
    resolved_data_dir?: string
    db_path?: string
    db_exists: boolean
    persister_ready: boolean
    db_size_bytes: number
    schema_version?: string
    migrated_from?: string
    migrated_at?: string
}

export interface UpdateCompatibility {
    current_version: string
    target_version: string
    min_panel_version: string
    requires_restart: boolean
    compatible: boolean
    warnings?: string[]
    usage: UpdateCompatibilityUsage
}

export const updateApi = {
    trigger: (version: string) =>
        apiClient.post<{ status: string; target_version: string; compatibility?: UpdateCompatibility }>('/update', {
            version,
        }),

    status: () => apiClient.get<UpdateStatus>('/update-status'),

    compatibility: (version: string) =>
        apiClient.get<UpdateCompatibility>(`/update-compatibility?version=${encodeURIComponent(version)}`),

    // version is optional; empty string means "latest".
    panelUpdate: (version?: string) =>
        apiClient.post<{ status: string; message: string }>('/panel-update', { version: version ?? '' }),
}
