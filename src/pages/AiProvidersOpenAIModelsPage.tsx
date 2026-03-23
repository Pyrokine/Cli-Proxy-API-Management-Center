import {buildOpenAIModelsEndpoint} from '@/components/providers/utils'
import {modelsApi} from '@/services/api'
import {buildHeaderObject} from '@/utils/headers'
import {useCallback, useMemo} from 'react'
import {useOutletContext} from 'react-router-dom'
import type {OpenAIEditOutletContext} from './AiProvidersOpenAIEditLayout'
import {ProviderModelsPage} from './ProviderModelsPage'

export function AiProvidersOpenAIModelsPage() {
    const {
              disableControls,
              loading: initialLoading,
              saving,
              form,
              mergeDiscoveredModels,
          } = useOutletContext<OpenAIEditOutletContext>()

    const buildEndpoint = useCallback(() => buildOpenAIModelsEndpoint(form.baseUrl), [form.baseUrl])

    const fetchModels = useCallback(async () => {
        const trimmedBaseUrl = form.baseUrl.trim()
        if (!trimmedBaseUrl) {
            return []
        }

        const headerObject  = buildHeaderObject(form.headers)
        const firstKey      = form.apiKeyEntries.find((entry) => entry.apiKey?.trim())?.apiKey?.trim()
        const hasAuthHeader = Boolean(headerObject.Authorization || headerObject['authorization'])

        try {
            return await modelsApi.fetchModelsViaApiCall(
                trimmedBaseUrl,
                hasAuthHeader ? undefined : firstKey,
                headerObject,
            )
        } catch (err: unknown) {
            // Fallback: retry without credentials
            try {
                return await modelsApi.fetchModelsViaApiCall(trimmedBaseUrl)
            } catch {
                throw err
            }
        }
    }, [form.apiKeyEntries, form.baseUrl, form.headers])

    const fetchDeps = useMemo(() => [fetchModels, form.baseUrl] as const, [fetchModels, form.baseUrl])

    const canAutoFetch = useCallback(() => true, [])

    return (
        <ProviderModelsPage
            i18nPrefix='openai_models'
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
