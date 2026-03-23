/**
 * Update API — trigger and monitor CPA backend self-update.
 */

import {apiClient} from './client'

export interface UpdateStatus {
    status: 'idle' | 'downloading' | 'verifying' | 'replacing' | 'done' | 'error';
    message: string;
    target_version: string;
    percent: number;
    current_version: string;
}

export const updateApi = {
    trigger: (version: string) => apiClient.post<{ status: string; target_version: string }>('/update', { version }),

    status: () => apiClient.get<UpdateStatus>('/update-status'),

    panelUpdate: () => apiClient.post<{ status: string; message: string }>('/panel-update'),
}
