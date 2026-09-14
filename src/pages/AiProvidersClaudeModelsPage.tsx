import {modelsApi} from '@/services/api'
import {buildHeaderObject, hasHeader} from '@/utils/headers'
import {buildProviderAutoFetchSignature} from '@/utils/providerModels'
import {useCallback, useMemo, useRef} from 'react'
import {useTranslation} from 'react-i18next'
import {useOutletContext} from 'react-router-dom'
import type {ClaudeEditOutletContext} from './AiProvidersClaudeEditLayout'
import {ProviderModelsPage} from './ProviderModelsPage'
import {resolveClaudeModelDiscovery} from './providerQuickFill'

type CredentialMaterial = {
    apiKey: string
    proxyUrl: string
    headers: Array<[string, string]>
    generation: number
}

const hasSameCredentialMaterial = (
    current: CredentialMaterial,
    apiKey: string,
    proxyUrl: string,
    headers: Array<[string, string]>,
) => current.apiKey === apiKey &&
     current.proxyUrl === proxyUrl &&
     current.headers.length === headers.length &&
     current.headers.every(([key, value], index) => key === headers[index]?.[0] && value === headers[index]?.[1])

export function AiProvidersClaudeModelsPage() {
    const { t }                 = useTranslation()
    const {
              disableControls,
              loading: initialLoading,
              saving,
              apiKeyIsMasked,
              maskedCredentialHeaderNames,
              credentialIdentityAvailable,
              form,
              mergeDiscoveredModels,
          }                     = useOutletContext<ClaudeEditOutletContext>()
    const credentialMaterialRef = useRef<CredentialMaterial>({ apiKey: '', proxyUrl: '', headers: [], generation: 0 })

    const discovery     = useMemo(() => resolveClaudeModelDiscovery(form.baseUrl ?? ''), [form.baseUrl])
    const buildEndpoint = useCallback(
        () => modelsApi.buildClaudeModelsEndpoint(form.baseUrl ?? '', discovery),
        [discovery, form.baseUrl],
    )

    const fetchModels = useCallback(async (signal: AbortSignal) => {
        if (!credentialIdentityAvailable) {
            throw new Error(t('common.invalid_provider_index'))
        }
        const headerObject = buildHeaderObject(form.headers)
        return modelsApi.fetchClaudeModelsViaApiCall(
            form.baseUrl ?? '',
            form.apiKey.trim() || undefined,
            headerObject,
            form.proxyUrl?.trim() || undefined,
            form.authIndex?.trim() || undefined,
            discovery,
            apiKeyIsMasked,
            maskedCredentialHeaderNames,
            signal,
        )
    }, [
                                        apiKeyIsMasked,
                                        credentialIdentityAvailable,
                                        discovery,
                                        form.apiKey,
                                        form.authIndex,
                                        form.baseUrl,
                                        form.headers,
                                        form.proxyUrl,
                                        maskedCredentialHeaderNames,
                                        t,
                                    ])

    const fetchDeps = useMemo(
        () => [fetchModels, discovery, form.apiKey, form.authIndex, form.baseUrl, form.headers, form.proxyUrl] as const,
        [discovery, fetchModels, form.apiKey, form.authIndex, form.baseUrl, form.headers, form.proxyUrl],
    )

    const canAutoFetch = useCallback(() => {
        if (!credentialIdentityAvailable) {
            return false
        }
        const headerObject     = buildHeaderObject(form.headers)
        const hasCustomXApiKey = hasHeader(headerObject, 'x-api-key')
        const hasAuthorization = hasHeader(headerObject, 'authorization')
        return Boolean(form.apiKey.trim()) || hasCustomXApiKey || hasAuthorization || Boolean(form.authIndex?.trim())
    }, [credentialIdentityAvailable, form.apiKey, form.authIndex, form.headers])

    const buildAutoFetchSignature = useCallback(() => {
        const headerObject      = buildHeaderObject(form.headers)
        const nextEndpoint      = modelsApi.buildClaudeModelsEndpoint(form.baseUrl ?? '', discovery)
        const credentialHeaders = Object.entries(headerObject)
                                        .sort(([a], [b]) => a.toLowerCase().localeCompare(b.toLowerCase()) ||
                                                            a.localeCompare(b))
        const apiKey            = form.apiKey.trim()
        const proxyUrl          = form.proxyUrl?.trim() ?? ''
        const previous          = credentialMaterialRef.current
        if (!hasSameCredentialMaterial(previous, apiKey, proxyUrl, credentialHeaders)) {
            credentialMaterialRef.current = {
                apiKey,
                proxyUrl,
                headers: credentialHeaders,
                generation: previous.generation + 1,
            }
        }

        return buildProviderAutoFetchSignature(
            nextEndpoint,
            credentialMaterialRef.current.generation,
            form.authIndex?.trim() ?? '',
        )
    }, [discovery, form.apiKey, form.authIndex, form.baseUrl, form.headers, form.proxyUrl])

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

    const providerLabel     = discovery?.providerLabel
    const fetchTitle        = providerLabel ?
                              t('ai_providers.provider_models_fetch_title', { provider: providerLabel }) :
                              undefined
    const fetchHint         = providerLabel ?
                              t('ai_providers.provider_models_fetch_hint', { endpoint: discovery.endpoint }) :
                              undefined
    const fetchLoadingLabel = providerLabel ?
                              t('ai_providers.provider_models_fetch_loading', { provider: providerLabel }) :
                              undefined
    const fetchEmptyLabel   = providerLabel ?
                              t('ai_providers.provider_models_fetch_empty', { provider: providerLabel }) :
                              undefined
    const fetchErrorLabel   = providerLabel ?
                              t('ai_providers.provider_models_fetch_error', { provider: providerLabel }) :
                              undefined

    return (
        <ProviderModelsPage
            i18nPrefix='claude_models'
            disableControls={disableControls}
            initialLoading={initialLoading}
            saving={saving}
            configuredModelEntries={form.modelEntries}
            mergeDiscoveredModels={mergeDiscoveredModels}
            buildEndpoint={buildEndpoint}
            fetchModels={fetchModels}
            fetchDeps={fetchDeps}
            canAutoFetch={canAutoFetch}
            buildAutoFetchSignature={buildAutoFetchSignature}
            buildErrorDiagnostic={buildErrorDiagnostic}
            fetchTitle={fetchTitle}
            fetchHint={fetchHint}
            fetchLoadingLabel={fetchLoadingLabel}
            fetchEmptyLabel={fetchEmptyLabel}
            fetchErrorLabel={fetchErrorLabel}
        />
    )
}
