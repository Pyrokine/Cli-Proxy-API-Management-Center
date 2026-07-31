import {apiClient} from './client'

export interface ImageArtifactCacheSizeResponse {
    total_bytes: number
    file_count: number
}

export const artifactsApi = {
    fetchImageArtifactCacheSize: (): Promise<ImageArtifactCacheSizeResponse> =>
        apiClient.get('/image-artifact-cache/size'),
}
