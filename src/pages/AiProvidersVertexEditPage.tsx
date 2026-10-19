import type {VertexFormState} from '@/components/providers'
import {ModelInputList} from '@/components/ui/ModelInputList'
import {modelsToEntries} from '@/components/ui/modelInputListUtils'
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
import {normalizeModelThinking} from '@/utils/modelMetadata'
import {useTranslation} from 'react-i18next'
import {ProviderEditShell} from './ProviderEditShell'
import {ProviderConnectionFields} from './ProviderFormFields'

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
})

const buildSignature = (form: VertexFormState) =>
    JSON.stringify({
                       ...buildBaseSignatureFields(form),
                       models: normalizeModelEntriesForSignature(form.modelEntries),
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
            models: form.modelEntries
                        .map((entry) => {
                            const name  = entry.name.trim()
                            const alias = entry.alias.trim()
                            if (!name || !alias) {
                                return null
                            }
                            const thinking    = normalizeModelThinking(entry.thinking)
                            const displayName = entry.displayName?.trim()
                            return {
                                name,
                                alias,
                                ...(displayName ? {displayName} : {}),
                                ...(thinking ? {thinking} : {}),
                            }
                        })
                        .filter(Boolean) as ProviderKeyConfig['models'],
        }),
        createConfig: (config) => providersApi.createVertexConfig(config),
        updateConfig: (index, config, original) => providersApi.patchVertexConfig(index, config, original),
        validateBeforeSave: (form) => getCredentialWeightValidationKey(form.weight),
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
