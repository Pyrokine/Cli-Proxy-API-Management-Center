/**
 * 配置文件相关 API（/config.yaml）
 */

import i18n from '@/i18n'
import type {ApiError, ManagementMutationReceipt} from '@/types/api'
import {getOAuthModelAliasError} from '@/utils/oauthModelAlias'
import {isNode, parseDocument} from 'yaml'
import {apiClient, mutationReceiptError} from './client'

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
    mutation?: ManagementMutationReceipt
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
        let receipt: ManagementMutationReceipt | undefined
        let result: unknown
        try {
            result = await apiClient.put<unknown>('/config.yaml', content, {
                headers: {
                    'Content-Type': 'application/yaml',
                    Accept: 'application/json, text/plain, */*',
                    ...(etag ? { 'If-Match': etag } : {}),
                },
                onMutationReceipt: (value) => {
                    receipt = value
                },
            })
        } catch (error: unknown) {
            const failure = error as ApiError
            if (failure?.mutation) {
                failure.mutation  = await apiClient.reconcileMutation(failure.mutation)
                failure.requestId = failure.mutation.request_id
                failure.message   = `${failure.message} ${mutationReceiptError(failure.mutation).message}`
            }
            throw error
        }
        if (receipt?.metadata_present) {
            receipt = await apiClient.reconcileMutation(receipt)
            if (receipt.result?.outcome !== 'succeeded' || receipt.recovery) {
                throw Object.assign(mutationReceiptError(receipt), { status: 200, data: result, details: result })
            }
        }
        return { ...normalizeConfigYamlSaveResult(result), ...(receipt ? { mutation: receipt } : {}) }
    },

    async validateConfigYaml(content: string, baseline?: string): Promise<ConfigValidationResult> {
        const result = await apiClient.post<ConfigValidationResult>('/config.yaml/validate', content, {
            headers: {
                'Content-Type': 'application/yaml',
                Accept: 'application/json',
            },
        })
        if (!result.valid || baseline === undefined) {
            return result
        }
        const current  = parseDocument(content)
        const original = parseDocument(baseline)
        if (current.errors.length) {
            throw new Error(current.errors[0].message)
        }
        const block = (document: typeof current, source: string) => {
            const node = document.get('oauth-model-alias', true)
            return isNode(node) && node.range ? source.slice(node.range[0], node.range[1]) : ''
        }
        if (block(current, content) === block(original, baseline)) {
            return result
        }
        const currentAliases  = (current.toJS() as Record<string, unknown> | null)?.['oauth-model-alias']
        const originalAliases = original.errors.length ?
                                undefined :
                                (original.toJS() as Record<string, unknown> | null)?.['oauth-model-alias']
        if (JSON.stringify(currentAliases) === JSON.stringify(originalAliases)) {
            return result
        }
        const error = getOAuthModelAliasError(JSON.stringify(currentAliases) ?? '')
        return error ? {
            ...result, valid: false, errors: [
                ...(result.errors ?? []), {
                    field: 'oauth-model-alias', message: i18n.t(`config_management.visual.validation.${error}`),
                },
            ],
        } : result
    },
}
