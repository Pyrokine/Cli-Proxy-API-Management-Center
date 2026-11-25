import type {VertexFormState} from '@/components/providers'
import {excludedModelsToText, parseTextList} from '@/components/providers/utils'
import {ModelInputList} from '@/components/ui/ModelInputList'
import {entriesToModels, modelsToEntries} from '@/components/ui/modelInputListUtils'
import {Select} from '@/components/ui/Select'
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

// ---- Form helpers ----

const buildEmptyForm = (): VertexFormState => ({
    apiKey: '',
    priority: undefined,
    weight: undefined,
    prefix: '',
    baseUrl: '',
    proxyUrl: '',
    headers: [],
    models: [],
    modelEntries: [{ name: '', alias: '' }],
    excludedText: '',
})

const buildSignature = (form: VertexFormState) =>
    JSON.stringify({
                       ...buildBaseSignatureFields(form),
                       models: normalizeModelEntriesForSignature(form.modelEntries),
                       interactions: form.interactions ?? null,
                       excludedModels: parseTextList(form.excludedText, /\r?\n/),
                   })

// ---- Page component ----

export function AiProvidersVertexEditPage() {
    const { t } = useTranslation()

    const editOptions: ProviderEditFormConfig<VertexFormState, ProviderKeyConfig> = {
        configKey: 'vertex-api-key',
        buildEmptyForm,
        buildSignature,
        loadConfigs: () => providersApi.getVertexConfigs(),
        configToForm: (config) => ({
            ...config,
            headers: headersToEntries(config.headers),
            modelEntries: modelsToEntries(config.models),
            excludedText: excludedModelsToText(config.excludedModels),
        }),
        formToPayload: (form) => ({
            apiKey: form.apiKey.trim(),
            priority:
                form.priority !== undefined && Number.isFinite(form.priority) ? Math.trunc(form.priority) : undefined,
            weight: form.weight,
            disableCooling: form.disableCooling,
            requestRetry: form.requestRetry,
            prefix: form.prefix?.trim() || undefined,
            baseUrl: (form.baseUrl ?? '').trim() || undefined,
            proxyUrl: form.proxyUrl?.trim() || undefined,
            headers: buildHeaderObject(form.headers),
            interactions: form.interactions,
            excludedModels: parseTextList(form.excludedText, /\r?\n/),
            models: entriesToModels(form.modelEntries),
        }),
        createConfig: (config) => providersApi.createVertexConfig(config),
        updateConfig: (index, config, original) => providersApi.patchVertexConfig(index, config, original),
        validateBeforeSave: (form) =>
            !form.apiKey.trim() ? 'ai_providers.api_key_required' : getCredentialWeightValidationKey(form.weight),
        i18n: {
            editTitle: 'ai_providers.vertex_edit_modal_title',
            addTitle: 'ai_providers.vertex_add_modal_title',
            saveSuccessEdit: 'notification.vertex_config_updated',
            saveSuccessAdd: 'notification.vertex_config_added',
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
          } = useProviderEditForm<VertexFormState, ProviderKeyConfig>(editOptions)

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
                supportsErrorRules={false}
                apiKeyLabel={t('ai_providers.vertex_add_modal_key_label')}
                apiKeyPlaceholder={t('ai_providers.vertex_add_modal_key_placeholder')}
                baseUrlLabel={t('ai_providers.vertex_add_modal_url_label')}
                baseUrlPlaceholder={t('ai_providers.vertex_add_modal_url_placeholder')}
                proxyUrlLabel={t('ai_providers.vertex_add_modal_proxy_label')}
                proxyUrlPlaceholder={t('ai_providers.vertex_add_modal_proxy_placeholder')}
            />
            <div className='form-group'>
                <label id='vertex-interactions-label'>{t('ai_providers.vertex_interactions_label')}</label>
                <Select
                    ariaLabelledBy='vertex-interactions-label'
                    disabled={disabled}
                    value={form.interactions === undefined ? 'default' : String(form.interactions)}
                    options={[
                        { value: 'default', label: t('ai_providers.vertex_interactions_default') },
                        { value: 'true', label: t('common.enabled') },
                        { value: 'false', label: t('common.disabled') },
                    ]}
                    onChange={(value) => setForm((prev) => ({
                        ...prev, interactions: value === 'default' ? undefined : value === 'true',
                    }))}
                />
            </div>
            <ExcludedModelsField
                value={form.excludedText}
                disabled={disabled}
                onChange={(excludedText) => setForm((prev) => ({ ...prev, excludedText }))}
            />
            <div className='form-group'>
                <label>{t('ai_providers.vertex_models_label')}</label>
                <ModelInputList
                    entries={form.modelEntries}
                    onChange={(entries) => setForm((prev) => ({ ...prev, modelEntries: entries }))}
                    addLabel={t('ai_providers.vertex_models_add_btn')}
                    namePlaceholder={t('common.model_name_placeholder')}
                    aliasPlaceholder={t('common.model_alias_placeholder')}
                    removeButtonTitle={t('common.delete')}
                    removeButtonAriaLabel={t('common.delete')}
                    disabled={disabled}
                    metadataEditing
                    provider='vertex'
                />
                <div className='hint'>{t('ai_providers.vertex_models_hint')}</div>
            </div>
        </ProviderEditShell>
    )
}
