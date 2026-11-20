/**
 * Update API — trigger and monitor CPA backend self-update.
 */

import i18n from '@/i18n'
import type {ManagementMutationReceipt} from '@/types/api'
import {apiClient, MUTATION_TARGET_REACHED} from './client'

export interface UpdateStatus {
    status: 'idle' | 'downloading' | 'verifying' | 'draining' | 'replacing' | 'done' | 'error'
    message: string
    target_version: string
    percent: number
    current_version: string
    attempt_id?: string
    guard_phase?: string
    result_code?: string
    state_available?: boolean
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
    supports_client_attempt_id?: boolean
    warnings?: string[]
    usage: UpdateCompatibilityUsage
}

export interface PanelUpdateState {
    installed: boolean
    digest: string
    target_digest: string
    matches_target: boolean
}

export const updateApi = {
    trigger: (version: string, attemptID: string) =>
        apiClient.post<{
            status: string;
            target_version: string;
            attempt_id: string;
            compatibility?: UpdateCompatibility
        }>(
            '/update',
            {
                version,
                attempt_id: attemptID,
            },
            {
                ...({ validateStatus: (status) => status === 202 }),
                mutationReadback: () => updateApi.status({ attemptID }),
            },
        ),

    status: (options?: { signal?: AbortSignal; attemptID?: string }) =>
        apiClient.get<UpdateStatus>('/update-status', {
            signal: options?.signal,
            params: options?.attemptID ? { attempt_id: options.attemptID } : undefined,
        }),

    compatibility: (version: string) =>
        apiClient.get<UpdateCompatibility>(`/update-compatibility?version=${encodeURIComponent(version)}`),

    // version is optional; empty string means "latest".
    getPanelUpdateState: (version?: string) => apiClient.get<PanelUpdateState>('/panel-update', {
        params: version ? { version } : undefined,
    }),

    async panelUpdate(version?: string) {
        let receipt: ManagementMutationReceipt | undefined
        let alreadyCurrent = false
        const result       = await apiClient.post<{ status: string; message: string }>(
            '/panel-update',
            { version: version ?? '' },
            {
                onMutationReceipt: (value) => {
                    receipt = value
                },
                mutationReadback: async (
                    _data,
                    current,
                ) => {
                    receipt = current
                    if (!current.metadata_present &&
                        !current.result &&
                        !current.recovery) {
                        return
                    }
                    const state  = await updateApi.getPanelUpdateState(version)
                    const digest = /^sha256:[a-f\d]{64}$/i
                    // noinspection PointlessBooleanExpressionJS
                    if (state?.installed !==
                        true ||
                        state.matches_target !==
                        true ||
                        typeof state.digest !==
                        'string' ||
                        typeof state.target_digest !==
                        'string' ||
                        !digest.test(state.digest) ||
                        !digest.test(state.target_digest) ||
                        state.digest.toLowerCase() !==
                        state.target_digest.toLowerCase()) {
                        throw new Error(i18n.t('common.mutation_uncertain'))
                    }
                    alreadyCurrent =
                        current.result?.outcome ===
                        'uncertain' &&
                        !current.result.confirmed_effect &&
                        current.result.effects.length ===
                        0
                    return MUTATION_TARGET_REACHED
                },
            },
        )
        return { ...result, alreadyCurrent, ...(receipt ? { mutation: receipt } : {}) }
    },
}
