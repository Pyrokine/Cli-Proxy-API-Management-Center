import {modelsApi} from '@/services/api'
import {buildHeaderObject, hasHeader} from '@/utils/headers'
import {useCallback, useMemo} from 'react'
import {useOutletContext} from 'react-router-dom'
import type {ClaudeEditOutletContext} from './AiProvidersClaudeEditLayout'
import {ProviderModelsPage} from './ProviderModelsPage'

export function AiProvidersClaudeModelsPage() {
    const {
              disableControls,
              loading: initialLoading,
              saving,
              form,
              mergeDiscoveredModels,
          } = useOutletContext<ClaudeEditOutletContext>()

    const buildEndpoint = useCallback(() => modelsApi.buildClaudeModelsEndpoint(form.baseUrl ?? ''), [form.baseUrl])

    const fetchModels = useCallback(async () => {
        const headerObject = buildHeaderObject(form.headers)
        return modelsApi.fetchClaudeModelsViaApiCall(form.baseUrl ?? '', form.apiKey.trim() || undefined, headerObject)
    }, [form.apiKey, form.baseUrl, form.headers])

    const fetchDeps = useMemo(
        () => [fetchModels, form.apiKey, form.baseUrl, form.headers] as const,
        [fetchModels, form.apiKey, form.baseUrl, form.headers],
    )

    const canAutoFetch = useCallback(() => {
        const headerObject     = buildHeaderObject(form.headers)
        const hasCustomXApiKey = hasHeader(headerObject, 'x-api-key')
        const hasAuthorization = hasHeader(headerObject, 'authorization')
        return Boolean(form.apiKey.trim()) || hasCustomXApiKey || hasAuthorization
    }, [form.apiKey, form.headers])

    const buildAutoFetchSignature = useCallback(() => {
        const headerObject    = buildHeaderObject(form.headers)
        const nextEndpoint    = modelsApi.buildClaudeModelsEndpoint(form.baseUrl ?? '')
        const headerSignature = Object.entries(headerObject)
                                      .sort(([a], [b]) => a.toLowerCase().localeCompare(b.toLowerCase()))
                                      .map(([key, value]) => `${key}:${value}`)
                                      .join('|')
        return `${nextEndpoint}||${form.apiKey.trim()}||${headerSignature}`
    }, [form.apiKey, form.baseUrl, form.headers])

    const buildErrorDiagnostic = useCallback(
        (message: string) => {
            const headerObject = buildHeaderObject(form.headers)
            const shouldAttach = message.toLowerCase().includes('x-api-key') || message.includes('401')
            if (!shouldAttach) {
                return ''
            }
            const hasCustomXApiKey = hasHeader(headerObject, 'x-api-key')
            const hasAuthorization = hasHeader(headerObject, 'authorization')
            return ` [diag: apiKeyField=${form.apiKey.trim() ? 'yes' : 'no'}, customXApiKey=${
                hasCustomXApiKey ? 'yes' : 'no'
            }, customAuthorization=${hasAuthorization ? 'yes' : 'no'}]`
        },
        [form.apiKey, form.headers],
    )

    return (
        <ProviderModelsPage
            i18nPrefix='claude_models'
            disableControls={disableControls}
            initialLoading={initialLoading}
            saving={saving}
            mergeDiscoveredModels={mergeDiscoveredModels}
            buildEndpoint={buildEndpoint}
            fetchModels={fetchModels}
            fetchDeps={fetchDeps}
            canAutoFetch={canAutoFetch}
            buildAutoFetchSignature={buildAutoFetchSignature}
            buildErrorDiagnostic={buildErrorDiagnostic}
        />
    )
}
