import {ModelTestPanel} from '@/components/common/ModelTestPanel'
import type {GeminiFormState} from '@/components/providers'
import {
    buildEmptyGeminiForm,
    buildInteractionsEndpoint,
    buildInteractionsProbePayload,
    excludedModelsToText,
    INTERACTIONS_API_REVISION,
    parseTextList,
} from '@/components/providers/utils'
import {entriesToModels, modelsToEntries} from '@/components/ui/modelInputListUtils'
import {useModelDiscovery} from '@/hooks/useModelDiscovery'
import {
    useProviderConnectivityTestModel,
    useProviderConnectivityTestState,
} from '@/hooks/useProviderConnectivityTestState'
import {
    buildBaseSignatureFields,
    normalizeModelEntriesForSignature,
    type ProviderEditFormConfig,
    useProviderEditForm,
} from '@/hooks/useProviderEditForm'
import {apiCallApi, modelsApi, prepareApiCallAuth, providersApi} from '@/services/api'
import type {GeminiKeyConfig} from '@/types'
import {getRequestScopedErrorsValidationKey} from '@/utils/credentialOverrides'
import {getCredentialWeightValidationKey} from '@/utils/credentialWeight'
import {buildHeaderObject, hasHeader, headersToEntries} from '@/utils/headers'
import {getErrorMessage} from '@/utils/helpers'
import {useTranslation} from 'react-i18next'
import {ProviderEditShell} from './ProviderEditShell'
import {ProviderConnectionFields, ProviderModelSection} from './ProviderFormFields'

const INTERACTIONS_TEST_TIMEOUT_MS    = 30_000
const DEFAULT_INTERACTIONS_TEST_MODEL = 'gemini-3.6-flash'

const buildSignature = (form: GeminiFormState) =>
    JSON.stringify({
                       ...buildBaseSignatureFields(form),
                       models: normalizeModelEntriesForSignature(form.modelEntries),
                       excludedModels: parseTextList(form.excludedText),
                   })

export function AiProvidersInteractionsEditPage() {
    const { t } = useTranslation()

    const editOptions: ProviderEditFormConfig<GeminiFormState, GeminiKeyConfig> = {
        configKey: 'interactions-api-key',
        buildEmptyForm: buildEmptyGeminiForm,
        buildSignature,
        loadConfigs: () => providersApi.getInteractionsKeys(),
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
            disableCooling: form.disableCooling,
            requestRetry: form.requestRetry,
            requestScopedErrors: form.requestScopedErrors,
            prefix: form.prefix?.trim() || undefined,
            baseUrl: form.baseUrl?.trim() || undefined,
            proxyUrl: form.proxyUrl?.trim() || undefined,
            headers: buildHeaderObject(form.headers),
            models: entriesToModels(form.modelEntries),
            excludedModels: parseTextList(form.excludedText),
        }),
        createConfig: (config) => providersApi.createInteractionsKey(config),
        updateConfig: (index, config, original) => providersApi.patchInteractionsKey(index, config, original),
        validateBeforeSave: (form, original) =>
            getCredentialWeightValidationKey(form.weight) ??
            getRequestScopedErrorsValidationKey(form.requestScopedErrors, original?.requestScopedErrors),
        i18n: {
            editTitle: 'ai_providers.interactions_edit_modal_title',
            addTitle: 'ai_providers.interactions_add_modal_title',
            saveSuccessEdit: 'notification.interactions_key_updated',
            saveSuccessAdd: 'notification.interactions_key_added',
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
          } = useProviderEditForm<GeminiFormState, GeminiKeyConfig>(editOptions)

    const {
              testModel,
              setTestModel,
              modelSelectOptions,
              availableModels,
              resolvedTestModel,
          } = useProviderConnectivityTestModel(form.modelEntries)

    const {
              testStatus,
              setTestStatus,
              testMessage,
              setTestMessage,
              isTesting,
              runConnectivityTest,
              showTestError,
          }                = useProviderConnectivityTestState({
                                                                  authIndex: form.authIndex,
                                                                  apiKey: form.apiKey,
                                                                  baseUrl: form.baseUrl,
                                                                  proxyUrl: form.proxyUrl,
                                                                  testModel: resolvedTestModel,
                                                                  headers: form.headers,
                                                                  modelEntries: form.modelEntries,
                                                              })
    const controlsDisabled = disabled || isTesting

    const runInteractionsConnectivityTest = async () => {
        if (isTesting) {
            return
        }

        const modelName        = resolvedTestModel || availableModels[0] || DEFAULT_INTERACTIONS_TEST_MODEL
        const customHeaders    = buildHeaderObject(form.headers)
        const apiKey           = form.apiKey.trim()
        const authIndex        = form.authIndex?.trim() || undefined
        const hasGeminiKey     = hasHeader(customHeaders, 'x-goog-api-key')
        const hasAuthorization = hasHeader(customHeaders, 'authorization')

        if (!apiKey && !authIndex && !hasGeminiKey && !hasAuthorization) {
            showTestError(t('ai_providers.interactions_test_key_required'))
            return
        }

        const endpoint = buildInteractionsEndpoint(form.baseUrl ?? '')
        if (!endpoint) {
            showTestError(t('ai_providers.interactions_test_endpoint_invalid'))
            return
        }

        let preparedAuth: ReturnType<typeof prepareApiCallAuth>
        try {
            preparedAuth = prepareApiCallAuth({
                                                  headers: customHeaders,
                                                  apiKey,
                                                  authIndex,
                                                  preferredHeader: 'x-goog-api-key',
                                                  headerNames: ['Authorization'],
                                              })
        } catch (err: unknown) {
            showTestError(`${t('ai_providers.interactions_test_failed')}: ${getErrorMessage(err)}`)
            return
        }

        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            ...preparedAuth.headers,
        }
        if (!hasHeader(headers, 'api-revision')) {
            headers['Api-Revision'] = INTERACTIONS_API_REVISION
        }

        await runConnectivityTest(
            () => apiCallApi.request(
                {
                    authIndex,
                    method: 'POST',
                    url: endpoint,
                    header: headers,
                    data: JSON.stringify(buildInteractionsProbePayload(modelName)),
                    proxyUrl: form.proxyUrl?.trim() || undefined,
                    draftToken: preparedAuth.draftToken,
                },
                { timeout: INTERACTIONS_TEST_TIMEOUT_MS },
            ),
            {
                running: t('ai_providers.interactions_test_running'),
                success: t('ai_providers.interactions_test_success'),
                failed: t('ai_providers.interactions_test_failed'),
                timeout: t('ai_providers.interactions_test_timeout', {
                    seconds: INTERACTIONS_TEST_TIMEOUT_MS / 1000,
                }),
                unknownError: t('common.unknown_error'),
            },
        )
    }

    const discovery = useModelDiscovery(
        form,
        setForm,
        { disableControls, saving, loading, invalidIndexParam, invalidIndex },
        {
            buildEndpoint: (baseUrl) => modelsApi.buildGeminiModelsEndpoint(baseUrl),
            fetchModels: (baseUrl, apiKey, headers, proxyUrl, signal) =>
                modelsApi.fetchGeminiModelsViaApiCall(baseUrl, apiKey, headers, proxyUrl, form.authIndex, signal),
            canAutoFetch: (apiKey, headers) =>
                Boolean(apiKey) || hasHeader(headers, 'x-goog-api-key') || hasHeader(headers, 'authorization'),
            buildErrorMessage: (err) =>
                `${t('ai_providers.interactions_models_fetch_error')}: ${getErrorMessage(err)}`,
            i18nPrefix: 'interactions',
        },
    )

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
                apiKeyLabel={t('ai_providers.interactions_key_label')}
                apiKeyPlaceholder={t('ai_providers.interactions_key_placeholder')}
                baseUrlLabel={t('ai_providers.interactions_base_url_label')}
                baseUrlPlaceholder={t('ai_providers.interactions_base_url_placeholder')}
                proxyUrlLabel={t('ai_providers.interactions_proxy_label')}
                proxyUrlPlaceholder={t('ai_providers.interactions_proxy_placeholder')}
            />
            <ProviderModelSection
                form={form}
                setForm={setForm}
                disabled={controlsDisabled}
                discovery={discovery}
                i18nPrefix='interactions'
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
                    i18nPrefix='ai_providers.interactions'
                    onTest={() => void runInteractionsConnectivityTest()}
                    allowEmptyModelTest
                />
            </ProviderModelSection>
        </ProviderEditShell>
    )
}
