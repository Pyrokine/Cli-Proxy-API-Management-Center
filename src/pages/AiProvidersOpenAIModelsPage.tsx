import {ToggleSwitch} from '@/components/ui/ToggleSwitch'
import {modelsApi} from '@/services/api'
import {isCredentialHeaderName} from '@/services/api/apiCall'
import {apiClient} from '@/services/api/client'
import {buildHeaderObject, hasHeader} from '@/utils/headers'
import {useCallback, useMemo, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {useOutletContext} from 'react-router'
import type {OpenAIEditOutletContext} from './AiProvidersOpenAIEditLayout'
import {ProviderModelsPage} from './ProviderModelsPage'

export function AiProvidersOpenAIModelsPage() {
    const { t }                     = useTranslation()
    const [anonymous, setAnonymous] = useState(false)
    const {
              disableControls,
              loading: initialLoading,
              saving,
              form,
              mergeDiscoveredModels,
          }                         = useOutletContext<OpenAIEditOutletContext>()

    const buildEndpoint = useCallback(() => modelsApi.buildV1ModelsEndpoint(form.baseUrl), [form.baseUrl])

    const fetchModels = useCallback(async (signal: AbortSignal) => {
        const authGeneration = apiClient.getAuthGeneration()
        const trimmedBaseUrl = form.baseUrl.trim()
        if (!trimmedBaseUrl) {
            return []
        }

        const configuredHeaders = buildHeaderObject(form.headers)
        const headerObject      = anonymous ?
                                  Object.fromEntries(Object.entries(configuredHeaders)
                                                           .filter(([name]) => !isCredentialHeaderName(name))) :
                                  configuredHeaders
        const keyEntry          = form.apiKeyEntries.find((entry) => entry.apiKey?.trim() || entry.authIndex?.trim())
        const firstKey          = keyEntry?.apiKey?.trim()
        const authIndex         = anonymous ? undefined : keyEntry?.authIndex?.trim() || form.authIndex?.trim()
        const authKey           = anonymous || hasHeader(headerObject, 'authorization') ? undefined : firstKey
        if (!anonymous && !authKey && !authIndex && !Object.entries(headerObject)
                                                           .some(([name, value]) => isCredentialHeaderName(name) &&
            Boolean(value.trim()))) {
            throw new Error(t('ai_providers.openai_models_auth_required'))
        }

        try {
            return await modelsApi.fetchV1ModelsViaApiCall(
                trimmedBaseUrl,
                authKey,
                headerObject,
                keyEntry?.proxyUrl,
                authIndex,
                signal,
            )
        } catch (v1Error: unknown) {
            if (signal.aborted || authGeneration !== apiClient.getAuthGeneration()) {
                throw v1Error
            }
            try {
                return await modelsApi.fetchModelsViaApiCall(
                    trimmedBaseUrl,
                    authKey,
                    headerObject,
                    keyEntry?.proxyUrl,
                    authIndex,
                    signal,
                )
            } catch {
                if (signal.aborted || authGeneration !== apiClient.getAuthGeneration()) {
                    throw v1Error
                }
                throw v1Error
            }
        }
    }, [anonymous, form.apiKeyEntries, form.authIndex, form.baseUrl, form.headers, t])

    const fetchDeps = useMemo(() => [fetchModels, form.baseUrl] as const, [fetchModels, form.baseUrl])

    const canAutoFetch = useCallback(() => true, [])

    return (
        <ProviderModelsPage
            i18nPrefix='openai_models'
            controls={<ToggleSwitch checked={anonymous} onChange={setAnonymous}
                                    label={t('ai_providers.openai_models_anonymous')}
                                    disabled={disableControls || initialLoading || saving} />}
            fetchHint={anonymous ? t('ai_providers.openai_models_anonymous_hint') : undefined}
            disableControls={disableControls}
            initialLoading={initialLoading}
            saving={saving}
            configuredModelEntries={form.modelEntries}
            mergeDiscoveredModels={mergeDiscoveredModels}
            buildEndpoint={buildEndpoint}
            fetchModels={fetchModels}
            fetchDeps={fetchDeps}
            canAutoFetch={canAutoFetch}
        />
    )
}
