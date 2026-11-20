import type {ProviderFormState} from '@/components/providers'
import {excludedModelsToText, parseTextList} from '@/components/providers/utils'
import {entriesToModels, modelsToEntries} from '@/components/ui/modelInputListUtils'
import {ToggleSwitch} from '@/components/ui/ToggleSwitch'
import {useModelDiscovery} from '@/hooks/useModelDiscovery'
import {
    buildBaseSignatureFields,
    normalizeModelEntriesForSignature,
    type ProviderEditFormConfig,
    useProviderEditForm,
} from '@/hooks/useProviderEditForm'
import {modelsApi, providersApi} from '@/services/api'
import type {ProviderKeyConfig} from '@/types'
import {getRequestScopedErrorsValidationKey} from '@/utils/credentialOverrides'
import {getCredentialWeightValidationKey} from '@/utils/credentialWeight'
import {buildHeaderObject, hasHeader, headersToEntries} from '@/utils/headers'
import {getErrorMessage} from '@/utils/helpers'
import {useTranslation} from 'react-i18next'
import {ProviderEditShell} from './ProviderEditShell'
import {ProviderConnectionFields, ProviderModelSection} from './ProviderFormFields'

const DEFAULT_XAI_BASE_URL = 'https://api.x.ai/v1'

const buildEmptyForm = (): ProviderFormState => ({
    apiKey: '',
    priority: undefined,
    weight: undefined,
    prefix: '',
    baseUrl: DEFAULT_XAI_BASE_URL,
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
                       excludedModels: parseTextList(form.excludedText, /\r?\n/),
                   })

export function AiProvidersXAIEditPage() {
    const { t }                                                                     = useTranslation()
    const editOptions: ProviderEditFormConfig<ProviderFormState, ProviderKeyConfig> = {
        configKey: 'xai-api-key',
        buildEmptyForm,
        buildSignature,
        loadConfigs: () => providersApi.getXAIConfigs(),
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
            baseUrl: form.baseUrl?.trim() || undefined,
            websockets: Boolean(form.websockets),
            disableCooling: form.disableCooling,
            requestRetry: form.requestRetry,
            requestScopedErrors: form.requestScopedErrors,
            proxyUrl: form.proxyUrl?.trim() || undefined,
            headers: buildHeaderObject(form.headers),
            models: entriesToModels(form.modelEntries),
            excludedModels: parseTextList(form.excludedText, /\r?\n/),
        }),
        createConfig: (config) => providersApi.createXAIConfig(config),
        updateConfig: (index, config, original) => providersApi.patchXAIConfig(index, config, original),
        validateBeforeSave: (form, original) => {
            const validationError = getCredentialWeightValidationKey(form.weight) ??
                                    getRequestScopedErrorsValidationKey(
                                        form.requestScopedErrors,
                                        original?.requestScopedErrors,
                                    )
            if (validationError) {
                return validationError
            }
            if (!form.apiKey.trim()) {
                return 'notification.xai_key_required'
            }
            if (!form.baseUrl?.trim()) {
                return 'notification.xai_base_url_required'
            }
            return undefined
        },
        i18n: {
            editTitle: 'ai_providers.xai_edit_modal_title',
            addTitle: 'ai_providers.xai_add_modal_title',
            saveSuccessEdit: 'notification.xai_config_updated',
            saveSuccessAdd: 'notification.xai_config_added',
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

    const baseUrl   = form.baseUrl?.trim() || DEFAULT_XAI_BASE_URL
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
            canAutoFetch: (apiKey, headers) => Boolean(apiKey || form.authIndex?.trim()) ||
                                               hasHeader(headers, 'authorization'),
            buildErrorMessage: (err) => `${t('ai_providers.xai_models_fetch_error')}: ${getErrorMessage(err)}`,
            i18nPrefix: 'xai',
        },
    )

    return (
        <ProviderEditShell
            title={title}
            loading={loading}
            saving={saving}
            canSave={canSave}
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
                disabled={disabled}
                apiKeyLabel={t('ai_providers.xai_key_label')}
                apiKeyPlaceholder={t('ai_providers.xai_key_placeholder')}
                baseUrlLabel={t('ai_providers.xai_base_url_label')}
                baseUrlPlaceholder={t('ai_providers.xai_base_url_placeholder')}
                proxyUrlLabel={t('ai_providers.xai_proxy_label')}
                proxyUrlPlaceholder={t('ai_providers.xai_proxy_placeholder')}
                afterBaseUrl={
                    <>
                        <div className='form-group'>
                            <label>{t('ai_providers.xai_websockets_label')}</label>
                            <ToggleSwitch
                                checked={Boolean(form.websockets)}
                                onChange={(value) => setForm((previous) => ({ ...previous, websockets: value }))}
                                disabled={disabled}
                                ariaLabel={t('ai_providers.xai_websockets_label')}
                            />
                            <div className='hint'>{t('ai_providers.xai_websockets_hint')}</div>
                        </div>
                    </>
                }
            />
            <ProviderModelSection
                form={form}
                setForm={setForm}
                disabled={disabled}
                discovery={discovery}
                i18nPrefix='xai'
            />
        </ProviderEditShell>
    )
}
