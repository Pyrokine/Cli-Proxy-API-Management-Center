import {ModelTestPanel} from '@/components/common/ModelTestPanel'
import type {ProviderFormState} from '@/components/providers'
import {excludedModelsToText, parseTextList} from '@/components/providers/utils'
import {entriesToModels, modelsToEntries} from '@/components/ui/modelInputListUtils'
import {useModelDiscovery} from '@/hooks/useModelDiscovery'
import {useModelSelectOptions} from '@/hooks/useModelSelectOptions'
import {useProviderConnectivityTestState} from '@/hooks/useProviderConnectivityTestState'
import {
    buildBaseSignatureFields,
    normalizeModelEntriesForSignature,
    type ProviderEditFormConfig,
    useProviderEditForm,
} from '@/hooks/useProviderEditForm'
import {apiCallApi, modelsApi, prepareApiCallAuth, providersApi} from '@/services/api'
import type {ProviderKeyConfig} from '@/types'
import {getRequestScopedErrorsValidationKey} from '@/utils/credentialOverrides'
import {getCredentialWeightValidationKey} from '@/utils/credentialWeight'
import {buildHeaderObject, hasHeader, headersToEntries} from '@/utils/headers'
import {getErrorMessage} from '@/utils/helpers'
import {useMemo, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {ProviderEditShell} from './ProviderEditShell'
import {ProviderConnectionFields, ProviderModelSection} from './ProviderFormFields'

const DEFAULT_META_BASE_URL = 'https://api.meta.ai/v1'
const META_TEST_TIMEOUT_MS = 30000

const buildMetaResponsesEndpoint = (baseUrl: string) =>
    modelsApi.buildV1ModelsEndpoint(baseUrl).replace(/\/models$/i, '/responses')

const buildEmptyForm = (): ProviderFormState => ({
    apiKey: '',
    priority: undefined,
    weight: undefined,
    prefix: '',
    baseUrl: '',
    proxyUrl: '',
    headers: [],
    models: [],
    excludedModels: [],
    modelEntries: [{ name: '', alias: '' }],
    excludedText: '',
})

const buildSignature = (form: ProviderFormState) =>
    JSON.stringify({
                       ...buildBaseSignatureFields(form),
                       models: normalizeModelEntriesForSignature(form.modelEntries),
                       excludedModels: parseTextList(form.excludedText),
                   })

export function AiProvidersMetaEditPage() {
    const { t } = useTranslation()
    const editOptions: ProviderEditFormConfig<ProviderFormState, ProviderKeyConfig> = {
        configKey: 'meta-api-key',
        buildEmptyForm,
        buildSignature,
        loadConfigs: () => providersApi.getMetaConfigs(),
        configToForm: (config) => ({
            ...config,
            headers: headersToEntries(config.headers),
            modelEntries: modelsToEntries(config.models),
            excludedText: excludedModelsToText(config.excludedModels),
        }),
        formToPayload: (form) => ({
            apiKey: form.apiKey.trim(),
            priority: form.priority !== undefined ? Math.trunc(form.priority) : undefined,
            weight: form.weight,
            prefix: form.prefix?.trim() || undefined,
            baseUrl: form.baseUrl?.trim() || undefined,
            disableCooling: form.disableCooling,
            requestRetry: form.requestRetry,
            requestScopedErrors: form.requestScopedErrors,
            proxyUrl: form.proxyUrl?.trim() || undefined,
            headers: buildHeaderObject(form.headers),
            models: entriesToModels(form.modelEntries),
            excludedModels: parseTextList(form.excludedText),
        }),
        createConfig: (config) => providersApi.createMetaConfig(config),
        updateConfig: (index, config, original) => providersApi.patchMetaConfig(index, config, original),
        validateBeforeSave: (form, original) => {
            const validationError = getCredentialWeightValidationKey(form.weight) ??
                getRequestScopedErrorsValidationKey(form.requestScopedErrors, original?.requestScopedErrors)
            if (validationError) {
                return validationError
            }
            if (!form.apiKey.trim() || form.apiKey.trim().toLowerCase().startsWith('dca:')) {
                return 'notification.meta_key_required'
            }
            return undefined
        },
        i18n: {
            editTitle: 'ai_providers.meta_edit_modal_title',
            addTitle: 'ai_providers.meta_add_modal_title',
            saveSuccessEdit: 'notification.meta_config_updated',
            saveSuccessAdd: 'notification.meta_config_added',
        },
    }

    const {
              form,
              setForm,
              loading,
              saving,
              error,
              invalidIndexParam,
              invalidIndex,
              disableControls,
              canSave,
              disabled,
              title,
              handleSave,
              handleBack,
              swipeRef,
          } = useProviderEditForm<ProviderFormState, ProviderKeyConfig>(editOptions)

    const baseUrl = form.baseUrl?.trim() || DEFAULT_META_BASE_URL
    const discovery = useModelDiscovery(
        { ...form, baseUrl },
        setForm,
        { disableControls, saving, loading, invalidIndexParam, invalidIndex },
        {
            buildEndpoint: (url) => modelsApi.buildV1ModelsEndpoint(url),
            fetchModels: (url, apiKey, headers, proxyUrl, signal) =>
                modelsApi.fetchV1ModelsViaApiCall(
                    url,
                    hasHeader(headers, 'authorization') ? undefined : apiKey,
                    headers,
                    proxyUrl,
                    form.authIndex,
                    signal,
                ),
            canAutoFetch: (apiKey, headers) => Boolean(apiKey) || hasHeader(headers, 'authorization'),
            buildErrorMessage: (err) => `${t('ai_providers.meta_models_fetch_error')}: ${getErrorMessage(err)}`,
            i18nPrefix: 'meta',
        },
    )

    const [testModel, setTestModel] = useState('')
    const modelSelectOptions = useModelSelectOptions(form.modelEntries)
    const availableModels = useMemo(() => modelSelectOptions.map((option) => option.value), [modelSelectOptions])
    const {
              testStatus,
              setTestStatus,
              testMessage,
              setTestMessage,
              isTesting,
              runConnectivityTest,
              showTestError,
          } = useProviderConnectivityTestState({
                                                   authIndex: form.authIndex,
                                                   apiKey: form.apiKey,
                                                   baseUrl,
                                                   proxyUrl: form.proxyUrl,
                                                   testModel,
                                                   headers: form.headers,
                                                   modelEntries: form.modelEntries,
                                               })
    const controlsDisabled = disabled || isTesting

    const runMetaConnectivityTest = async () => {
        if (isTesting) {
            return
        }

        const modelName = testModel.trim() || availableModels[0]
        if (!modelName) {
            showTestError(t('ai_providers.meta_test_model_required'))
            return
        }

        const customHeaders = buildHeaderObject(form.headers)
        const apiKey = form.apiKey.trim()
        if ((!apiKey && !hasHeader(customHeaders, 'authorization')) || apiKey.toLowerCase().startsWith('dca:')) {
            showTestError(t('ai_providers.meta_test_key_required'))
            return
        }

        const endpoint = buildMetaResponsesEndpoint(baseUrl)
        if (!endpoint) {
            showTestError(t('ai_providers.meta_test_endpoint_invalid'))
            return
        }

        await runConnectivityTest(
            () => {
                const preparedAuth = prepareApiCallAuth({
                                                            headers: customHeaders,
                                                            apiKey,
                                                            authIndex: form.authIndex,
                                                            preferredHeader: 'Authorization',
                                                            authorizationScheme: 'Bearer',
                                                        })
                return apiCallApi.request(
                    {
                        method: 'POST',
                        url: endpoint,
                        header: { 'Content-Type': 'application/json', ...preparedAuth.headers },
                        data: JSON.stringify({ model: modelName, input: 'Hi', stream: false }),
                        proxyUrl: form.proxyUrl?.trim() || undefined,
                        authIndex: form.authIndex?.trim() || undefined,
                        draftToken: preparedAuth.draftToken,
                    },
                    { timeout: META_TEST_TIMEOUT_MS },
                )
            },
            {
                running: t('ai_providers.meta_test_running'),
                success: t('ai_providers.meta_test_success'),
                failed: t('ai_providers.meta_test_failed'),
                timeout: t('ai_providers.meta_test_timeout', { seconds: META_TEST_TIMEOUT_MS / 1000 }),
                unknownError: t('common.unknown_error'),
            },
        )
    }

    return (
        <ProviderEditShell
            title={title}
            loading={loading}
            saving={saving}
            canSave={canSave && !isTesting}
            error={error}
            invalidIndexParam={invalidIndexParam}
            invalidIndex={invalidIndex}
            onBack={handleBack}
            onSave={handleSave}
            swipeRef={swipeRef}
        >
            <ProviderConnectionFields
                form={form}
                setForm={setForm}
                disabled={controlsDisabled}
                apiKeyLabel={t('ai_providers.xai_key_label')}
                apiKeyPlaceholder={t('ai_providers.meta_key_placeholder')}
                baseUrlLabel={t('ai_providers.meta_base_url_label')}
                baseUrlPlaceholder={DEFAULT_META_BASE_URL}
                proxyUrlLabel={t('ai_providers.xai_proxy_label')}
            />
            <ProviderModelSection
                form={form}
                setForm={setForm}
                disabled={controlsDisabled}
                discovery={discovery}
                discoveryDisabled={isTesting || !discovery.canOpen}
                i18nPrefix='meta'
            >
                <ModelTestPanel
                    testModel={testModel}
                    setTestModel={setTestModel}
                    testStatus={testStatus}
                    setTestStatus={setTestStatus}
                    testMessage={testMessage}
                    setTestMessage={setTestMessage}
                    modelSelectOptions={modelSelectOptions}
                    availableModels={availableModels}
                    isTesting={isTesting}
                    disabled={controlsDisabled}
                    i18nPrefix='ai_providers.meta'
                    onTest={() => void runMetaConnectivityTest()}
                />
            </ProviderModelSection>
        </ProviderEditShell>
    )
}
