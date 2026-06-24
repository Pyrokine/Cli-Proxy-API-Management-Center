import {modelsApi} from '@/services/api'
import {buildHeaderObject, hasHeader} from '@/utils/headers'
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

    const buildEndpoint = useCallback(() => modelsApi.buildV1ModelsEndpoint(form.baseUrl), [form.baseUrl])

    const fetchModels = useCallback(async () => {
        const trimmedBaseUrl = form.baseUrl.trim()
        if (!trimmedBaseUrl) {
            return []
        }

        const headerObject = buildHeaderObject(form.headers)
        const keyEntry     = form.apiKeyEntries.find((entry) => entry.apiKey?.trim() || entry.authIndex?.trim())
        const firstKey     = keyEntry?.apiKey?.trim()
        const authIndex    = keyEntry?.authIndex?.trim() || form.authIndex?.trim()
        const authKey      = hasHeader(headerObject, 'authorization') ? undefined : firstKey

        try {
            return await modelsApi.fetchV1ModelsViaApiCall(
                trimmedBaseUrl,
                authKey,
                headerObject,
                keyEntry?.proxyUrl,
                authIndex,
            )
        } catch (v1Error: unknown) {
            try {
                return await modelsApi.fetchModelsViaApiCall(
                    trimmedBaseUrl,
                    authKey,
                    headerObject,
                    keyEntry?.proxyUrl,
                    authIndex,
                )
            } catch {
                try {
                    return await modelsApi.fetchV1ModelsViaApiCall(
                        trimmedBaseUrl,
                        undefined,
                        undefined,
                        undefined,
                        authIndex,
                    )
                } catch {
                    try {
                        return await modelsApi.fetchModelsViaApiCall(
                            trimmedBaseUrl,
                            undefined,
                            undefined,
                            undefined,
                            authIndex,
                        )
                    } catch {
                        throw v1Error
                    }
                }
            }
        }
    }, [form.apiKeyEntries, form.authIndex, form.baseUrl, form.headers])

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
