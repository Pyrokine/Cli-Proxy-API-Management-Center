/**
 * Model catalog refresh metadata (backend state for remote models.json pulls).
 */

import {apiClient} from './client'

export interface ModelCatalogRefreshMeta {
    last_refresh_at: string
    next_refresh_at: string
    interval_hours: number
    source: string
    last_error?: string
    sources: string[]
}

export const modelCatalogApi = {
    getMeta: () => apiClient.get<ModelCatalogRefreshMeta>('/models-catalog-meta'),
    refresh: () => apiClient.post<ModelCatalogRefreshMeta>('/models-catalog-refresh'),
}
