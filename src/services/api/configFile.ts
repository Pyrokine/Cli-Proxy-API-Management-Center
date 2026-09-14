/**
 * 配置文件相关 API（/config.yaml）
 */

import {apiClient} from './client'

export interface ConfigValidationError {
    field: string
    message: string
}

interface ConfigValidationResult {
    valid: boolean
    errors: ConfigValidationError[]
    warnings: string[]
}

interface ConfigYamlSnapshot {
    content: string
    etag: string
}

interface ConfigYamlSaveResult {
    cleanupError?: string
}

export function normalizeConfigYamlSaveResult(data: unknown): ConfigYamlSaveResult {
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
        return {}
    }
    const cleanupError = (data as Record<string, unknown>).cleanup_error
    if (typeof cleanupError !== 'string' || !cleanupError.trim()) {
        return {}
    }
    return { cleanupError: cleanupError.trim() }
}

function configYamlContent(data: unknown): string {
    if (typeof data === 'string') {
        return data
    }
    if (data === undefined || data === null) {
        return ''
    }
    return String(data)
}

export const configFileApi = {
    async fetchConfigYaml(): Promise<ConfigYamlSnapshot> {
        const response = await apiClient.getRaw('/config.yaml', {
            responseType: 'text',
            headers: { Accept: 'application/yaml, text/yaml, text/plain' },
        })
        const etag     = response.headers.etag
        return {
            content: configYamlContent(response.data),
            etag: typeof etag === 'string' ? etag : '',
        }
    },

    async saveConfigYaml(content: string, etag: string): Promise<ConfigYamlSaveResult> {
        const result = await apiClient.put<unknown>('/config.yaml', content, {
            headers: {
                'Content-Type': 'application/yaml',
                Accept: 'application/json, text/plain, */*',
                ...(etag ? { 'If-Match': etag } : {}),
            },
        })
        return normalizeConfigYamlSaveResult(result)
    },

    async validateConfigYaml(content: string): Promise<ConfigValidationResult> {
        return apiClient.post<ConfigValidationResult>('/config.yaml/validate', content, {
            headers: {
                'Content-Type': 'application/yaml',
                Accept: 'application/json',
            },
        })
    },
}
