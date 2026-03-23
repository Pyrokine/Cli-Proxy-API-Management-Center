/**
 * 配置文件相关 API（/config.yaml）
 */

import {apiClient} from './client'

export interface ConfigValidationError {
    field: string;
    message: string;
}

interface ConfigValidationResult {
    valid: boolean;
    errors: ConfigValidationError[];
    warnings: string[];
}

export const configFileApi = {
    async fetchConfigYaml(): Promise<string> {
        const response      = await apiClient.getRaw('/config.yaml', {
            responseType: 'text',
            headers: { Accept: 'application/yaml, text/yaml, text/plain' },
        })
        const data: unknown = response.data
        if (typeof data === 'string') {
            return data
        }
        if (data === undefined || data === null) {
            return ''
        }
        return String(data)
    },

    async saveConfigYaml(content: string): Promise<void> {
        await apiClient.put('/config.yaml', content, {
            headers: {
                'Content-Type': 'application/yaml',
                Accept: 'application/json, text/plain, */*',
            },
        })
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
