/**
 * Amp CLI Integration (ampcode) 相关 API
 */

import type {AmpcodeConfig, AmpcodeUpstreamApiKeyMapping} from '@/types'
import {apiClient} from './client'
import {normalizeAmpcodeConfig} from './transformers'

const serializeUpstreamApiKeyMappings = (mappings: AmpcodeUpstreamApiKeyMapping[]) =>
    mappings.map((entry) => ({
        'upstream-api-key': entry.upstreamApiKey,
        'api-keys': entry.apiKeys,
    }))

export const ampcodeApi = {
    async getAmpcode(): Promise<AmpcodeConfig> {
        const data = await apiClient.get('/ampcode')
        return normalizeAmpcodeConfig(data) ?? {}
    },

    updateUpstreamUrl: (url: string) => apiClient.put('/ampcode/upstream-url', { value: url }),
    clearUpstreamUrl: () => apiClient.delete('/ampcode/upstream-url'),

    updateUpstreamApiKey: (apiKey: string) => apiClient.put('/ampcode/upstream-api-key', { value: apiKey }),
    clearUpstreamApiKey: () => apiClient.delete('/ampcode/upstream-api-key'),

    saveUpstreamApiKeys: (mappings: AmpcodeUpstreamApiKeyMapping[]) =>
        apiClient.put('/ampcode/upstream-api-keys', { value: serializeUpstreamApiKeyMappings(mappings) }),

    saveModelMappings: (mappings: Array<{ from: string; to: string }>) =>
        apiClient.put('/ampcode/model-mappings', { value: mappings }),
    clearModelMappings: () => apiClient.delete('/ampcode/model-mappings'),

    updateForceModelMappings: (enabled: boolean) => apiClient.put('/ampcode/force-model-mappings', { value: enabled }),
}
