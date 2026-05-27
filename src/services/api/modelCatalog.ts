/**
 * Model catalog refresh metadata (backend state for remote models.json pulls).
 */

import {apiClient} from './client'

export interface ModelCatalogMeta {
    last_refresh_at: string
    next_refresh_at: string
    interval_hours: number
    source: string
    last_error?: string
    sources: string[]
}

export const modelCatalogApi = {
    getMeta: () => apiClient.get<ModelCatalogMeta>('/models-catalog-meta'),
    refresh: () => apiClient.post<ModelCatalogMeta>('/models-catalog-refresh'),
}
