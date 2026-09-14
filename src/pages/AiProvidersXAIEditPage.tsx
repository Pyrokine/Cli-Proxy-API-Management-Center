import type {ProviderFormState} from '@/components/providers'
import {excludedModelsToText, parseTextList} from '@/components/providers/utils'
import {ModelInputList} from '@/components/ui/ModelInputList'
import {entriesToModels, modelsToEntries} from '@/components/ui/modelInputListUtils'
import {ToggleSwitch} from '@/components/ui/ToggleSwitch'
import {
    buildBaseSignatureFields,
    normalizeModelEntriesForSignature,
    type ProviderEditFormConfig,
    useProviderEditForm,
} from '@/hooks/useProviderEditForm'
import {providersApi} from '@/services/api'
import type {ProviderKeyConfig} from '@/types'
import {getCredentialWeightValidationKey} from '@/utils/credentialWeight'
import {buildHeaderObject, headersToEntries} from '@/utils/headers'
import {useTranslation} from 'react-i18next'
import {ProviderEditShell} from './ProviderEditShell'
import {ExcludedModelsField, ProviderConnectionFields} from './ProviderFormFields'

const DEFAULT_XAI_BASE_URL = 'https://api.x.ai/v1'

const buildEmptyForm = (): ProviderFormState => ({
    apiKey: '',
    priority: undefined,
    weight: undefined,
    prefix: '',
    baseUrl: DEFAULT_XAI_BASE_URL,
    websockets: false,
    disableCooling: false,
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
                       disableCooling: Boolean(form.disableCooling),
                       models: normalizeModelEntriesForSignature(form.modelEntries),
                       excludedModels: parseTextList(form.excludedText),
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
            disableCooling: Boolean(config.disableCooling),
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
            disableCooling: Boolean(form.disableCooling),
            proxyUrl: form.proxyUrl?.trim() || undefined,
            headers: buildHeaderObject(form.headers),
            models: entriesToModels(form.modelEntries),
            excludedModels: parseTextList(form.excludedText),
        }),
        createConfig: (config) => providersApi.createXAIConfig(config),
        updateConfig: (index, config, original) => providersApi.patchXAIConfig(index, config, original),
        validateBeforeSave: (form) => {
            const weightError = getCredentialWeightValidationKey(form.weight)
            if (weightError) {
                return weightError
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
              canSave,
              disabled,
              title,
              handleSave,
              handleBack,
              swipeRef,
          } = useProviderEditForm<ProviderFormState, ProviderKeyConfig>(editOptions)

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
                        <div className='form-group'>
                            <label>{t('ai_providers.xai_disable_cooling_label')}</label>
                            <ToggleSwitch
                                checked={Boolean(form.disableCooling)}
                                onChange={(value) => setForm((previous) => ({ ...previous, disableCooling: value }))}
                                disabled={disabled}
                                ariaLabel={t('ai_providers.xai_disable_cooling_label')}
                            />
                            <div className='hint'>{t('ai_providers.xai_disable_cooling_hint')}</div>
                        </div>
                    </>
                }
            />
            <div className='form-group'>
                <label>{t('ai_providers.xai_models_label')}</label>
                <ModelInputList
                    entries={form.modelEntries}
                    onChange={(entries) => setForm((previous) => ({ ...previous, modelEntries: entries }))}
                    addLabel={t('ai_providers.xai_models_add_btn')}
                    namePlaceholder={t('common.model_name_placeholder')}
                    aliasPlaceholder={t('common.model_alias_placeholder')}
                    removeButtonTitle={t('common.delete')}
                    removeButtonAriaLabel={t('common.delete')}
                    disabled={disabled}
                    metadataEditing
                />
                <div className='hint'>{t('ai_providers.xai_models_hint')}</div>
            </div>
            <ExcludedModelsField
                value={form.excludedText}
                onChange={(value) => setForm((previous) => ({ ...previous, excludedText: value }))}
                disabled={disabled}
            />
        </ProviderEditShell>
    )
}
