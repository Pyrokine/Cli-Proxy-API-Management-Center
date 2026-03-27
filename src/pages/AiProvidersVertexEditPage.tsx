import type {VertexFormState} from '@/components/providers'
import {Input} from '@/components/ui/Input'
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
import {buildHeaderObject, headersToEntries} from '@/utils/headers'
import {useTranslation} from 'react-i18next'
import {ProviderEditShell} from './ProviderEditShell'
import {HeadersField, PrefixField} from './ProviderFormFields'

// ---- Form helpers ----

const buildEmptyForm = (): VertexFormState => ({
    apiKey: '',
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
        loadConfigs: async ({ fetchConfig, updateConfigValue, clearCache }) => {
            const [configResult, vertexResult] = await Promise.all([
                                                                       fetchConfig('vertex-api-key'),
                                                                       providersApi.getVertexConfigs(),
                                                                   ])
            const list                         = Array.isArray(vertexResult)
                                                 ? (vertexResult as ProviderKeyConfig[])
                                                 : Array.isArray(configResult)
                                                   ? (configResult as ProviderKeyConfig[])
                                                   : []
            updateConfigValue('vertex-api-key', list)
            clearCache('vertex-api-key')
            return list
        },
        configToForm: (config) => ({
            ...config,
            headers: headersToEntries(config.headers),
            modelEntries: modelsToEntries(config.models),
        }),
        formToPayload: (form) => ({
            apiKey: form.apiKey.trim(),
            priority: form.priority !== undefined && Number.isFinite(form.priority)
                      ? Math.trunc(form.priority)
                      : undefined,
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
                            return { name, alias }
                        })
                        .filter(Boolean) as ProviderKeyConfig['models'],
        }),
        saveConfigs: (configs) => providersApi.saveVertexConfigs(configs),
        validateBeforeSave: (form) => {
            if (!(form.baseUrl ?? '').trim()) {
                return 'notification.vertex_base_url_required'
            }
            return undefined
        },
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
            <Input
                label={t('ai_providers.vertex_add_modal_key_label')}
                placeholder={t('ai_providers.vertex_add_modal_key_placeholder')}
                value={form.apiKey}
                onChange={(e) => setForm((prev) => ({ ...prev, apiKey: e.target.value }))}
                disabled={disabled}
            />
            <PrefixField form={form} setForm={setForm} disabled={disabled} />
            <Input
                label={t('ai_providers.vertex_add_modal_url_label')}
                placeholder={t('ai_providers.vertex_add_modal_url_placeholder')}
                value={form.baseUrl ?? ''}
                onChange={(e) => setForm((prev) => ({ ...prev, baseUrl: e.target.value }))}
                disabled={disabled}
            />
            <Input
                label={t('ai_providers.vertex_add_modal_proxy_label')}
                placeholder={t('ai_providers.vertex_add_modal_proxy_placeholder')}
                value={form.proxyUrl ?? ''}
                onChange={(e) => setForm((prev) => ({ ...prev, proxyUrl: e.target.value }))}
                disabled={disabled}
            />
            <HeadersField
                entries={form.headers}
                onChange={(entries) => setForm((prev) => ({ ...prev, headers: entries }))}
                disabled={disabled}
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
                />
                <div className='hint'>{t('ai_providers.vertex_models_hint')}</div>
            </div>
        </ProviderEditShell>
    )
}
