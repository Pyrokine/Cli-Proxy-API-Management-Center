import type {ProviderFormState} from '@/components/providers'
import {excludedModelsToText, parseTextList} from '@/components/providers/utils'
import {Input} from '@/components/ui/Input'
import {entriesToModels, modelsToEntries} from '@/components/ui/modelInputListUtils'
import {ToggleSwitch} from '@/components/ui/ToggleSwitch'
import {useModelDiscovery} from '@/hooks/useModelDiscovery'
import {
    buildBaseSignatureFields,
    normalizeModelEntriesForSignature,
    useProviderEditForm,
} from '@/hooks/useProviderEditForm'
import {modelsApi, providersApi} from '@/services/api'
import type {ProviderKeyConfig} from '@/types'
import {buildHeaderObject, headersToEntries} from '@/utils/headers'
import {getErrorMessage} from '@/utils/helpers'
import {useTranslation} from 'react-i18next'
import {ProviderEditShell} from './ProviderEditShell'
import {HeadersField, PrefixField, PriorityField, ProviderModelSection} from './ProviderFormFields'

// ---- Form helpers ----

const buildEmptyForm = (): ProviderFormState => ({
    apiKey: '',
    priority: undefined,
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
          } = useProviderEditForm<ProviderFormState, ProviderKeyConfig>({
                                                                            configKey: 'codex-api-key',
                                                                            buildEmptyForm,
                                                                            buildSignature,
                                                                            loadConfigs: async ({ fetchConfig }) => {
                                                                                const value = await fetchConfig(
                                                                                    'codex-api-key')
                                                                                return Array.isArray(value) ?
                                                                                       (value as ProviderKeyConfig[]) :
                                                                                    []
                                                                            },
                                                                            configToForm: (config) => ({
                                                                                ...config,
                                                                                websockets: Boolean(config.websockets),
                                                                                headers: headersToEntries(config.headers),
                                                                                modelEntries: modelsToEntries(config.models),
                                                                                excludedText: excludedModelsToText(
                                                                                    config.excludedModels),
                                                                            }),
                                                                            formToPayload: (form) => ({
                                                                                apiKey: form.apiKey.trim(),
                                                                                priority: form.priority !== undefined ?
                                                                                          Math.trunc(form.priority) :
                                                                                          undefined,
                                                                                prefix: form.prefix?.trim() ||
                                                                                        undefined,
                                                                                baseUrl: (form.baseUrl ?? '').trim() ||
                                                                                         undefined,
                                                                                websockets: Boolean(form.websockets),
                                                                                proxyUrl: form.proxyUrl?.trim() ||
                                                                                          undefined,
                                                                                headers: buildHeaderObject(form.headers),
                                                                                models: entriesToModels(form.modelEntries),
                                                                                excludedModels: parseTextList(form.excludedText),
                                                                            }),
                                                                            saveConfigs: (configs) => providersApi.saveCodexConfigs(
                                                                                configs),
                                                                            validateBeforeSave: (form) => {
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
                                                                        })

    // ---- Model discovery ----

    const discovery = useModelDiscovery(
        form,
        setForm,
        { disableControls, saving, loading, invalidIndexParam, invalidIndex },
        {
            buildEndpoint: (baseUrl) => modelsApi.buildV1ModelsEndpoint(baseUrl),
            fetchModels: (baseUrl, apiKey, headers) => {
                const hasCustomAuthorization = Object.keys(headers).some((key) => key.toLowerCase() ===
                                                                                  'authorization')
                return modelsApi.fetchV1ModelsViaApiCall(baseUrl, hasCustomAuthorization ? undefined : apiKey, headers)
            },
            canAutoFetch: (apiKey, headers) => {
                const hasCustomAuthorization = Object.keys(headers).some((key) => key.toLowerCase() ===
                                                                                  'authorization')
                return Boolean(apiKey) || hasCustomAuthorization
            },
            buildErrorMessage: (err) => `${t('ai_providers.codex_models_fetch_error')}: ${getErrorMessage(err)}`,
            i18nPrefix: 'codex',
        },
    )

    const canOpenDiscovery = discovery.canOpen && Boolean((form.baseUrl ?? '').trim())

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
                label={t('ai_providers.codex_add_modal_key_label')}
                value={form.apiKey}
                onChange={(e) => setForm((prev) => ({ ...prev, apiKey: e.target.value }))}
                disabled={disabled}
            />
            <PriorityField form={form} setForm={setForm} disabled={disabled} />
            <PrefixField form={form} setForm={setForm} disabled={disabled} />
            <Input
                label={t('ai_providers.codex_add_modal_url_label')}
                value={form.baseUrl ?? ''}
                onChange={(e) => setForm((prev) => ({ ...prev, baseUrl: e.target.value }))}
                disabled={disabled}
            />
            <div className='form-group'>
                <label>{t('ai_providers.codex_websockets_label')}</label>
                <ToggleSwitch
                    checked={Boolean(form.websockets)}
                    onChange={(value) => setForm((prev) => ({ ...prev, websockets: value }))}
                    disabled={disabled}
                    ariaLabel={t('ai_providers.codex_websockets_label')}
                />
                <div className='hint'>{t('ai_providers.codex_websockets_hint')}</div>
            </div>
            <Input
                label={t('ai_providers.codex_add_modal_proxy_label')}
                value={form.proxyUrl ?? ''}
                onChange={(e) => setForm((prev) => ({ ...prev, proxyUrl: e.target.value }))}
                disabled={disabled}
            />
            <HeadersField
                entries={form.headers}
                onChange={(entries) => setForm((prev) => ({ ...prev, headers: entries }))}
                disabled={disabled}
            />
            <ProviderModelSection
                form={form}
                setForm={setForm}
                disabled={disabled}
                discovery={discovery}
                discoveryDisabled={!canOpenDiscovery}
                i18nPrefix='codex'
            />
        </ProviderEditShell>
    )
}
