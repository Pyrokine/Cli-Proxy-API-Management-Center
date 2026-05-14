import { modelsApi } from '@/services/api'
import { buildHeaderObject, hasHeader } from '@/utils/headers'
import { useCallback, useMemo } from 'react'
import { useOutletContext } from 'react-router-dom'
import type { OpenAIEditOutletContext } from './AiProvidersOpenAIEditLayout'
import { ProviderModelsPage } from './ProviderModelsPage'

export function AiProvidersOpenAIModelsPage() {
    const {
        disableControls,
        loading: initialLoading,
        saving,
        form,
        mergeDiscoveredModels,
    } = useOutletContext<OpenAIEditOutletContext>()

    const buildEndpoint = useCallback(() => modelsApi.buildV1ModelsEndpoint(form.baseUrl), [form.baseUrl])

    const fetchModels = useCallback(async () => {
        const trimmedBaseUrl = form.baseUrl.trim()
        if (!trimmedBaseUrl) {
            return []
        }

        const headerObject = buildHeaderObject(form.headers)
        const firstKey = form.apiKeyEntries.find((entry) => entry.apiKey?.trim())?.apiKey?.trim()
        const authKey = hasHeader(headerObject, 'authorization') ? undefined : firstKey

        try {
            return await modelsApi.fetchV1ModelsViaApiCall(trimmedBaseUrl, authKey, headerObject)
        } catch (v1Error: unknown) {
            try {
                return await modelsApi.fetchModelsViaApiCall(trimmedBaseUrl, authKey, headerObject)
            } catch {
                try {
                    return await modelsApi.fetchV1ModelsViaApiCall(trimmedBaseUrl)
                } catch {
                    try {
                        return await modelsApi.fetchModelsViaApiCall(trimmedBaseUrl)
                    } catch {
                        throw v1Error
                    }
                }
            }
        }
    }, [form.apiKeyEntries, form.baseUrl, form.headers])

    const fetchDeps = useMemo(() => [fetchModels, form.baseUrl] as const, [fetchModels, form.baseUrl])

    const canAutoFetch = useCallback(() => true, [])

    return (
        <ProviderModelsPage
            i18nPrefix="openai_models"
            disableControls={disableControls}
            initialLoading={initialLoading}
            saving={saving}
            mergeDiscoveredModels={mergeDiscoveredModels}
            buildEndpoint={buildEndpoint}
            fetchModels={fetchModels}
            fetchDeps={fetchDeps}
            canAutoFetch={canAutoFetch}
        />
    )
}
