import type {GeminiFormState} from '@/components/providers'
import {excludedModelsToText, parseTextList} from '@/components/providers/utils'
import {Input} from '@/components/ui/Input'
import {entriesToModels, modelsToEntries} from '@/components/ui/modelInputListUtils'
import {useModelDiscovery} from '@/hooks/useModelDiscovery'
import {
    buildBaseSignatureFields,
    normalizeModelEntriesForSignature,
    useProviderEditForm,
} from '@/hooks/useProviderEditForm'
import {modelsApi, providersApi} from '@/services/api'
import type {GeminiKeyConfig} from '@/types'
import {buildHeaderObject, headersToEntries} from '@/utils/headers'
import {useTranslation} from 'react-i18next'
import {ProviderEditShell} from './ProviderEditShell'
import {HeadersField, PrefixField, PriorityField, ProviderModelSection} from './ProviderFormFields'

// ---- Gemini-specific helpers ----

const stripGeminiModelResourceName = (value: string) =>
    String(value ?? '')
        .trim()
        .replace(/^\/?models\//i, '')

const buildEmptyForm = (): GeminiFormState => ({
    apiKey: '',
    priority: undefined,
    prefix: '',
    baseUrl: '',
    proxyUrl: '',
    headers: [],
    modelEntries: [{ name: '', alias: '' }],
    excludedModels: [],
    excludedText: '',
})

const buildSignature = (form: GeminiFormState) =>
    JSON.stringify({
                       ...buildBaseSignatureFields(form),
                       models: normalizeModelEntriesForSignature(
                           form.modelEntries,
                           (name) => stripGeminiModelResourceName(name).trim(),
                       ),
                       excludedModels: parseTextList(form.excludedText ?? ''),
                   })

// ---- Page component ----

export function AiProvidersGeminiEditPage() {
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
          } = useProviderEditForm<GeminiFormState, GeminiKeyConfig>({
                                                                        configKey: 'gemini-api-key',
                                                                        buildEmptyForm,
                                                                        buildSignature,
                                                                        loadConfigs: async ({ fetchConfig }) => {
                                                                            const value = await fetchConfig(
                                                                                'gemini-api-key')
                                                                            return Array.isArray(value) ?
                                                                                   (value as GeminiKeyConfig[]) :
                                                                                []
                                                                        },
                                                                        configToForm: (config) => {
                                                                            const { headers, models, ...rest } = config
                                                                            return {
                                                                                ...rest,
                                                                                headers: headersToEntries(headers),
                                                                                modelEntries: modelsToEntries(models)
                                                                                    .map((entry) => ({
                                                                                        ...entry,
                                                                                        name: stripGeminiModelResourceName(
                                                                                            entry.name),
                                                                                    })),
                                                                                excludedText: excludedModelsToText(
                                                                                    config.excludedModels),
                                                                            }
                                                                        },
                                                                        formToPayload: (form) => {
                                                                            const normalizedModelEntries = form.modelEntries.map(
                                                                                (entry) => ({
                                                                                    ...entry,
                                                                                    name: stripGeminiModelResourceName(
                                                                                        entry.name),
                                                                                }))
                                                                            return {
                                                                                apiKey: form.apiKey.trim(),
                                                                                priority: form.priority !== undefined ?
                                                                                          Math.trunc(form.priority) :
                                                                                          undefined,
                                                                                prefix: form.prefix?.trim() ||
                                                                                        undefined,
                                                                                baseUrl: form.baseUrl?.trim() ||
                                                                                         undefined,
                                                                                proxyUrl: form.proxyUrl?.trim() ||
                                                                                          undefined,
                                                                                headers: buildHeaderObject(form.headers),
                                                                                models: entriesToModels(
                                                                                    normalizedModelEntries),
                                                                                excludedModels: parseTextList(form.excludedText),
                                                                            }
                                                                        },
                                                                        saveConfigs: (configs) => providersApi.saveGeminiKeys(
                                                                            configs),
                                                                        i18n: {
                                                                            editTitle: 'ai_providers.gemini_edit_modal_title',
                                                                            addTitle: 'ai_providers.gemini_add_modal_title',
                                                                            saveSuccessEdit: 'notification.gemini_key_updated',
                                                                            saveSuccessAdd: 'notification.gemini_key_added',
                                                                        },
                                                                    })

    // ---- Model discovery ----

    const hasHeader = (headers: Record<string, string>, name: string) =>
        Object.keys(headers).some((key) => key.toLowerCase() === name.toLowerCase())

    const discovery = useModelDiscovery(
        form,
        setForm,
        { disableControls, saving, loading, invalidIndexParam, invalidIndex },
        {
            buildEndpoint: (baseUrl) => modelsApi.buildGeminiModelsEndpoint(baseUrl),
            fetchModels: (baseUrl, apiKey, headers) => modelsApi.fetchGeminiModelsViaApiCall(baseUrl, apiKey, headers),
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
            canSave={canSave}
            error={error}
            invalidIndexParam={invalidIndexParam}
            invalidIndex={invalidIndex}
            onBack={handleBack}
            onSave={handleSave}
            swipeRef={swipeRef}
        >
            <Input
                label={t('ai_providers.gemini_add_modal_key_label')}
                placeholder={t('ai_providers.gemini_add_modal_key_placeholder')}
                value={form.apiKey}
                onChange={(e) => setForm((prev) => ({ ...prev, apiKey: e.target.value }))}
                disabled={disabled}
            />
            <PriorityField form={form} setForm={setForm} disabled={disabled} />
            <PrefixField form={form} setForm={setForm} disabled={disabled} />
            <Input
                label={t('ai_providers.gemini_base_url_label')}
                placeholder={t('ai_providers.gemini_base_url_placeholder')}
                value={form.baseUrl ?? ''}
                onChange={(e) => setForm((prev) => ({ ...prev, baseUrl: e.target.value }))}
                disabled={disabled}
            />
            <Input
                label={t('ai_providers.gemini_add_modal_proxy_label')}
                placeholder={t('ai_providers.gemini_add_modal_proxy_placeholder')}
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
                i18nPrefix='gemini'
            />
        </ProviderEditShell>
    )
}
