import {ModelTestPanel} from '@/components/common/ModelTestPanel'
import type {ProviderFormState} from '@/components/providers'
import {excludedModelsToText, parseTextList} from '@/components/providers/utils'
import {entriesToModels, modelsToEntries} from '@/components/ui/modelInputListUtils'
import {ToggleSwitch} from '@/components/ui/ToggleSwitch'
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
import {getCredentialWeightValidationKey} from '@/utils/credentialWeight'
import {buildHeaderObject, hasHeader, headersToEntries} from '@/utils/headers'
import {getErrorMessage} from '@/utils/helpers'
import {useMemo, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {ProviderEditShell} from './ProviderEditShell'
import {
    ProviderConnectionFields,
    ProviderModelSection,
    QuickFillField,
} from './ProviderFormFields'
import {CODEX_QUICK_FILL_PRESETS} from './providerQuickFill'

// ---- Form helpers ----

const CODEX_TEST_TIMEOUT_MS    = 30000
const DEFAULT_CODEX_TEST_MODEL = 'gpt-5.4-mini'

const buildCodexChatCompletionsEndpoint = (baseUrl: string) =>
    modelsApi.buildV1ModelsEndpoint(baseUrl).replace(/\/models$/i, '/chat/completions')

const buildEmptyForm = (): ProviderFormState => ({
    apiKey: '',
    priority: undefined,
    weight: undefined,
    prefix: '',
    baseUrl: '',
    websockets: false,
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
                       websockets: Boolean(form.websockets),
                       models: normalizeModelEntriesForSignature(form.modelEntries),
                       excludedModels: parseTextList(form.excludedText ?? ''),
                   })

// ---- Page component ----

export function AiProvidersCodexEditPage() {
    const { t } = useTranslation()

    const editOptions: ProviderEditFormConfig<ProviderFormState, ProviderKeyConfig> = {
        configKey: 'codex-api-key',
        buildEmptyForm,
        buildSignature,
        loadConfigs: () => providersApi.getCodexConfigs(),
        configToForm: (config) => ({
            ...config,
            websockets: Boolean(config.websockets),
            headers: headersToEntries(config.headers),
            modelEntries: modelsToEntries(config.models),
            excludedText: excludedModelsToText(config.excludedModels),
        }),
        formToPayload: (form) => ({
            apiKey: form.apiKey.trim(),
            priority: form.priority !== undefined ? Math.trunc(form.priority) : undefined,
            weight: form.weight,
            prefix: form.prefix?.trim() || undefined,
            baseUrl: (form.baseUrl ?? '').trim() || undefined,
            websockets: Boolean(form.websockets),
            proxyUrl: form.proxyUrl?.trim() || undefined,
            headers: buildHeaderObject(form.headers),
            models: entriesToModels(form.modelEntries),
            excludedModels: parseTextList(form.excludedText),
        }),
        createConfig: (config) => providersApi.createCodexConfig(config),
        updateConfig: (index, config, original) => providersApi.patchCodexConfig(index, config, original),
        validateBeforeSave: (form) => {
            const weightError = getCredentialWeightValidationKey(form.weight)
            if (weightError) {
                return weightError
            }
            if (!(form.baseUrl ?? '').trim()) {
                return 'notification.codex_base_url_required'
            }
            return undefined
        },
        i18n: {
            editTitle: 'ai_providers.codex_edit_modal_title',
            addTitle: 'ai_providers.codex_add_modal_title',
            saveSuccessEdit: 'notification.codex_config_updated',
            saveSuccessAdd: 'notification.codex_config_added',
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

    // ---- Model discovery ----

    const discovery = useModelDiscovery(
        form,
        setForm,
        { disableControls, saving, loading, invalidIndexParam, invalidIndex },
        {
            buildEndpoint: (baseUrl) => modelsApi.buildV1ModelsEndpoint(baseUrl),
            fetchModels: (baseUrl, apiKey, headers, proxyUrl, signal) => {
                const hasCustomAuthorization = Object.keys(headers).some((key) => key.toLowerCase() === 'authorization')
                return modelsApi.fetchV1ModelsViaApiCall(
                    baseUrl,
                    hasCustomAuthorization ? undefined : apiKey,
                    headers,
                    proxyUrl,
                    form.authIndex,
                    signal,
                )
            },
            canAutoFetch: (apiKey, headers) => {
                const hasCustomAuthorization = Object.keys(headers).some((key) => key.toLowerCase() === 'authorization')
                return Boolean(apiKey) || hasCustomAuthorization
            },
            buildErrorMessage: (err) => `${t('ai_providers.codex_models_fetch_error')}: ${getErrorMessage(err)}`,
            i18nPrefix: 'codex',
        },
    )

    const [testModel, setTestModel] = useState('')

    const modelSelectOptions = useModelSelectOptions(form.modelEntries)
    const availableModels    = useMemo(() => modelSelectOptions.map((option) => option.value), [modelSelectOptions])
    const canOpenDiscovery   = discovery.canOpen && Boolean((form.baseUrl ?? '').trim())

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
                                                                  testModel,
                                                                  headers: form.headers,
                                                                  modelEntries: form.modelEntries,
                                                              })
    const controlsDisabled = disabled || isTesting

    const runCodexConnectivityTest = async () => {
        if (isTesting) {
            return
        }

        const baseUrl = (form.baseUrl ?? '').trim()
        if (!baseUrl) {
            showTestError(t('notification.codex_base_url_required'))
            return
        }

        const modelName     = testModel.trim() || availableModels[0] || DEFAULT_CODEX_TEST_MODEL
        const customHeaders = buildHeaderObject(form.headers)
        const apiKey        = form.apiKey.trim()
        const hasAuth       = hasHeader(customHeaders, 'authorization')
        if (!apiKey && !hasAuth) {
            showTestError(t('ai_providers.codex_test_key_required'))
            return
        }

        const endpoint = buildCodexChatCompletionsEndpoint(baseUrl)
        if (!endpoint) {
            showTestError(t('notification.codex_base_url_required'))
            return
        }

        const preparedAuth                    = prepareApiCallAuth({
                                                                       headers: customHeaders,
                                                                       apiKey,
                                                                       authIndex: form.authIndex,
                                                                       preferredHeader: 'Authorization',
                                                                       authorizationScheme: 'Bearer',
                                                                   })
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
                                             model: modelName,
                                             messages: [{ role: 'user', content: 'Hi' }],
                                             max_tokens: 8,
                                         }),
                    proxyUrl: form.proxyUrl?.trim() || undefined,
                    authIndex: form.authIndex?.trim() || undefined,
                    draftToken: preparedAuth.draftToken,
                },
                { timeout: CODEX_TEST_TIMEOUT_MS },
            ),
            {
                running: t('ai_providers.codex_test_running'),
                success: t('ai_providers.codex_test_success'),
                failed: t('ai_providers.codex_test_failed'),
                timeout: t('ai_providers.codex_test_timeout', { seconds: CODEX_TEST_TIMEOUT_MS / 1000 }),
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
            <QuickFillField
                presets={CODEX_QUICK_FILL_PRESETS}
                disabled={controlsDisabled}
                onApply={(preset) => setForm((prev) => ({ ...prev, baseUrl: preset.baseUrl }))}
            />
            <ProviderConnectionFields
                form={form}
                setForm={setForm}
                disabled={controlsDisabled}
                apiKeyLabel={t('ai_providers.codex_add_modal_key_label')}
                baseUrlLabel={t('ai_providers.codex_add_modal_url_label')}
                proxyUrlLabel={t('ai_providers.codex_add_modal_proxy_label')}
                afterBaseUrl={
                    <div className='form-group'>
                        <label>{t('ai_providers.codex_websockets_label')}</label>
                        <ToggleSwitch
                            checked={Boolean(form.websockets)}
                            onChange={(value) => setForm((prev) => ({ ...prev, websockets: value }))}
                            disabled={controlsDisabled}
                            ariaLabel={t('ai_providers.codex_websockets_label')}
                        />
                        <div className='hint'>{t('ai_providers.codex_websockets_hint')}</div>
                    </div>
                }
            />
            <ProviderModelSection
                form={form}
                setForm={setForm}
                disabled={controlsDisabled}
                discovery={discovery}
                discoveryDisabled={!canOpenDiscovery}
                i18nPrefix='codex'
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
                    i18nPrefix='ai_providers.codex'
                    onTest={() => void runCodexConnectivityTest()}
                    allowEmptyModelTest
                />
            </ProviderModelSection>
        </ProviderEditShell>
    )
}
