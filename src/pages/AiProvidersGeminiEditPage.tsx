import {ModelTestPanel} from '@/components/common/ModelTestPanel'
import type {GeminiFormState} from '@/components/providers'
import {buildEmptyGeminiForm, excludedModelsToText, parseTextList} from '@/components/providers/utils'
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
import {normalizeApiBase} from '@/utils/connection'
import {getCredentialWeightValidationKey} from '@/utils/credentialWeight'
import {buildHeaderObject, hasHeader, headersToEntries} from '@/utils/headers'
import {getErrorMessage} from '@/utils/helpers'
import {useTranslation} from 'react-i18next'
import {ProviderEditShell} from './ProviderEditShell'
import {
    ProviderConnectionFields,
    ProviderModelSection,
    QuickFillField,
} from './ProviderFormFields'
import {GEMINI_QUICK_FILL_PRESETS} from './providerQuickFill'

// ---- Gemini-specific helpers ----

const GEMINI_TEST_TIMEOUT_MS    = 30_000
const DEFAULT_GEMINI_BASE_URL   = 'https://generativelanguage.googleapis.com'
const DEFAULT_GEMINI_TEST_MODEL = 'gemini-2.5-flash'

const stripGeminiModelResourceName = (value: string) =>
    String(value ?? '')
        .trim()
        .replace(/^\/?models\//i, '')

const encodeGeminiModelPath = (value: string) =>
    stripGeminiModelResourceName(value)
        .split('/')
        .map((part) => encodeURIComponent(part))
        .join('/')

const buildGeminiGenerateContentEndpoint = (baseUrl: string, modelName: string): string => {
    const normalized = normalizeApiBase(baseUrl)
    const fallback   = normalized || DEFAULT_GEMINI_BASE_URL
    let trimmed      = fallback.replace(/\/+$/g, '')
    trimmed          = trimmed.replace(/\/v1beta\/models(?:\/.*)?$/i, '')
    trimmed          = trimmed.replace(/\/v1beta(?:\/.*)?$/i, '')
    const modelPath  = encodeGeminiModelPath(modelName)
    if (!modelPath) {
        return ''
    }
    return `${trimmed}/v1beta/models/${modelPath}:generateContent`
}

const buildSignature = (form: GeminiFormState) =>
    JSON.stringify({
                       ...buildBaseSignatureFields(form),
                       models: normalizeModelEntriesForSignature(form.modelEntries, {
                           normalizeName: (name) => stripGeminiModelResourceName(name).trim(),
                       }),
                       excludedModels: parseTextList(form.excludedText ?? ''),
                   })

// ---- Page component ----

export function AiProvidersGeminiEditPage() {
    const { t } = useTranslation()

    const editOptions: ProviderEditFormConfig<GeminiFormState, GeminiKeyConfig> = {
        configKey: 'gemini-api-key',
        buildEmptyForm: buildEmptyGeminiForm,
        buildSignature,
        loadConfigs: () => providersApi.getGeminiKeys(),
        configToForm: (config) => {
            const { headers, models, ...rest } = config
            return {
                ...rest,
                headers: headersToEntries(headers),
                modelEntries: modelsToEntries(models).map((entry) => ({
                    ...entry,
                    name: stripGeminiModelResourceName(entry.name),
                })),
                excludedText: excludedModelsToText(config.excludedModels),
            }
        },
        formToPayload: (form) => {
            const normalizedModelEntries = form.modelEntries.map((entry) => ({
                ...entry,
                name: stripGeminiModelResourceName(entry.name),
            }))
            return {
                apiKey: form.apiKey.trim(),
                priority: form.priority !== undefined ? Math.trunc(form.priority) : undefined,
                weight: form.weight,
                disableCooling: form.disableCooling,
                requestRetry: form.requestRetry,
                prefix: form.prefix?.trim() || undefined,
                baseUrl: form.baseUrl?.trim() || undefined,
                proxyUrl: form.proxyUrl?.trim() || undefined,
                headers: buildHeaderObject(form.headers),
                models: entriesToModels(normalizedModelEntries),
                excludedModels: parseTextList(form.excludedText),
            }
        },
        createConfig: (config) => providersApi.createGeminiKey(config),
        updateConfig: (index, config, original) => providersApi.patchGeminiKey(index, config, original),
        validateBeforeSave: (form) => getCredentialWeightValidationKey(form.weight),
        i18n: {
            editTitle: 'ai_providers.gemini_edit_modal_title',
            addTitle: 'ai_providers.gemini_add_modal_title',
            saveSuccessEdit: 'notification.gemini_key_updated',
            saveSuccessAdd: 'notification.gemini_key_added',
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

    // ---- Model discovery and connectivity test ----

    const {
              testModel,
              setTestModel,
              modelSelectOptions,
              availableModels,
              resolvedTestModel,
          } = useProviderConnectivityTestModel(form.modelEntries, stripGeminiModelResourceName)

    const {
              testStatus,
              setTestStatus,
              testMessage,
              setTestMessage,
              isTesting,
              runConnectivityTest,
              showTestError,
          }                = useProviderConnectivityTestState({
                                                                  apiKey: form.apiKey,
                                                                  baseUrl: form.baseUrl,
                                                                  proxyUrl: form.proxyUrl,
                                                                  testModel: resolvedTestModel,
                                                                  headers: form.headers,
                                                                  modelEntries: form.modelEntries,
                                                              })
    const controlsDisabled = disabled || isTesting

    const runGeminiConnectivityTest = async () => {
        if (isTesting) {
            return
        }

        const modelName = stripGeminiModelResourceName(resolvedTestModel ||
                                                       availableModels[0] ||
                                                       DEFAULT_GEMINI_TEST_MODEL)

        const customHeaders       = buildHeaderObject(form.headers)
        const apiKey              = form.apiKey.trim()
        const hasCustomGeminiKey  = hasHeader(customHeaders, 'x-goog-api-key')
        const hasCustomAuthHeader = hasHeader(customHeaders, 'authorization')

        if (!apiKey && !hasCustomGeminiKey && !hasCustomAuthHeader) {
            showTestError(t('ai_providers.gemini_test_key_required'))
            return
        }

        const endpoint = buildGeminiGenerateContentEndpoint(form.baseUrl ?? '', modelName)
        if (!endpoint) {
            showTestError(t('ai_providers.gemini_test_endpoint_invalid'))
            return
        }

        let preparedAuth: ReturnType<typeof prepareApiCallAuth>
        try {
            preparedAuth = prepareApiCallAuth({
                                                  headers: customHeaders,
                                                  apiKey,
                                                  authIndex: form.authIndex,
                                                  preferredHeader: 'x-goog-api-key',
                                                  headerNames: ['Authorization'],
                                              })
        } catch (err: unknown) {
            showTestError(`${t('ai_providers.gemini_test_failed')}: ${getErrorMessage(err)}`)
            return
        }
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            ...preparedAuth.headers,
        }

        await runConnectivityTest(
            () => apiCallApi.request(
                {
                    method: 'POST',
                    url: endpoint,
                    header: headers,
                    data: JSON.stringify({
                                             contents: [{ role: 'user', parts: [{ text: 'Hi' }] }],
                                             generationConfig: { maxOutputTokens: 8 },
                                         }),
                    proxyUrl: form.proxyUrl?.trim() || undefined,
                    authIndex: form.authIndex?.trim() || undefined,
                    draftToken: preparedAuth.draftToken,
                },
                { timeout: GEMINI_TEST_TIMEOUT_MS },
            ),
            {
                running: t('ai_providers.gemini_test_running'),
                success: t('ai_providers.gemini_test_success'),
                failed: t('ai_providers.gemini_test_failed'),
                timeout: t('ai_providers.gemini_test_timeout', {
                    seconds: GEMINI_TEST_TIMEOUT_MS / 1000,
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
            buildErrorMessage: (err, { apiKey, headers }) => {
                const message              = err instanceof Error ? err.message : typeof err === 'string' ? err : ''
                const hasCustomXGoogApiKey = hasHeader(headers, 'x-goog-api-key')
                const hasAuthorization     = hasHeader(headers, 'authorization')
                const shouldAttachDiag     = message.toLowerCase().includes('api key') || message.includes('401')
                const diag                 = shouldAttachDiag
                                             ? ` [diag: apiKeyField=${apiKey ? 'yes' : 'no'}, customXGoogApiKey=${
                        hasCustomXGoogApiKey ? 'yes' : 'no'
                    }, customAuthorization=${hasAuthorization ? 'yes' : 'no'}]`
                                             : ''
                return `${t('ai_providers.gemini_models_fetch_error')}: ${message}${diag}`
            },
            normalizeName: stripGeminiModelResourceName,
            i18nPrefix: 'gemini',
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
            <QuickFillField
                presets={GEMINI_QUICK_FILL_PRESETS}
                disabled={controlsDisabled}
                onApply={(preset) => setForm((prev) => ({ ...prev, baseUrl: preset.baseUrl }))}
            />
            <ProviderConnectionFields
                form={form}
                setForm={setForm}
                disabled={controlsDisabled}
                apiKeyLabel={t('ai_providers.gemini_add_modal_key_label')}
                apiKeyPlaceholder={t('ai_providers.gemini_add_modal_key_placeholder')}
                baseUrlLabel={t('ai_providers.gemini_base_url_label')}
                baseUrlPlaceholder={t('ai_providers.gemini_base_url_placeholder')}
                proxyUrlLabel={t('ai_providers.gemini_add_modal_proxy_label')}
                proxyUrlPlaceholder={t('ai_providers.gemini_add_modal_proxy_placeholder')}
            />
            <ProviderModelSection
                form={form}
                setForm={setForm}
                disabled={controlsDisabled}
                discovery={discovery}
                i18nPrefix='gemini'
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
                    i18nPrefix='ai_providers.gemini'
                    onTest={() => void runGeminiConnectivityTest()}
                    allowEmptyModelTest
                />
            </ProviderModelSection>
        </ProviderEditShell>
    )
}
