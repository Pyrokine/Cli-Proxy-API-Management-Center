import {ModelTestPanel} from '@/components/common/ModelTestPanel'
import type {GeminiFormState} from '@/components/providers'
import {excludedModelsToText, parseTextList} from '@/components/providers/utils'
import {Input} from '@/components/ui/Input'
import {entriesToModels, modelsToEntries} from '@/components/ui/modelInputListUtils'
import {useModelDiscovery} from '@/hooks/useModelDiscovery'
import {useModelSelectOptions} from '@/hooks/useModelSelectOptions'
import {
    buildBaseSignatureFields,
    normalizeModelEntriesForSignature,
    type ProviderEditFormConfig,
    useProviderEditForm,
} from '@/hooks/useProviderEditForm'
import {apiCallApi, getApiCallErrorMessage, modelsApi, providersApi} from '@/services/api'
import {useNotificationStore} from '@/stores'
import type {GeminiKeyConfig} from '@/types'
import {normalizeApiBase} from '@/utils/connection'
import {buildHeaderObject, hasHeader, headersToEntries} from '@/utils/headers'
import {getErrorMessage} from '@/utils/helpers'
import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {ProviderEditShell} from './ProviderEditShell'
import {HeadersField, PrefixField, PriorityField, ProviderModelSection} from './ProviderFormFields'

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
                       models: normalizeModelEntriesForSignature(form.modelEntries, (name) =>
                           stripGeminiModelResourceName(name).trim(),
                       ),
                       excludedModels: parseTextList(form.excludedText ?? ''),
                   })

// ---- Page component ----

export function AiProvidersGeminiEditPage() {
    const { t }                = useTranslation()
    const { showNotification } = useNotificationStore()

    const editOptions: ProviderEditFormConfig<GeminiFormState, GeminiKeyConfig> = {
        configKey: 'gemini-api-key',
        buildEmptyForm,
        buildSignature,
        loadConfigs: async ({ fetchConfig }) => {
            const value = await fetchConfig('gemini-api-key')
            return Array.isArray(value) ? (value as GeminiKeyConfig[]) : []
        },
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
                prefix: form.prefix?.trim() || undefined,
                baseUrl: form.baseUrl?.trim() || undefined,
                proxyUrl: form.proxyUrl?.trim() || undefined,
                headers: buildHeaderObject(form.headers),
                models: entriesToModels(normalizedModelEntries),
                excludedModels: parseTextList(form.excludedText),
            }
        },
        saveConfigs: (configs) => providersApi.saveGeminiKeys(configs),
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

    const [testModel, setTestModel]     = useState('')
    const [testStatus, setTestStatus]   = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
    const [testMessage, setTestMessage] = useState('')
    const [isTesting, setIsTesting]     = useState(false)
    const controlsDisabled              = disabled || isTesting

    const modelSelectOptions = useModelSelectOptions(form.modelEntries)
    const availableModels    = useMemo(
        () => modelSelectOptions.map((option) => stripGeminiModelResourceName(option.value)).filter(Boolean),
        [modelSelectOptions],
    )
    const resolvedTestModel  = useMemo(() => {
        const selectedModel = stripGeminiModelResourceName(testModel)
        if (!selectedModel) {
            return ''
        }
        const stillAvailable = availableModels.some((model) => model.toLowerCase() === selectedModel.toLowerCase())
        return stillAvailable ? selectedModel : ''
    }, [availableModels, testModel])

    const connectivityConfigSignature = useMemo(() => {
        const headersSignature = form.headers.map((entry) => `${entry.key.trim()}:${entry.value.trim()}`).join('|')
        const modelsSignature  = form.modelEntries.map((entry) => `${entry.name.trim()}:${entry.alias.trim()}`)
                                     .join('|')
        return [
            form.apiKey.trim(),
            form.baseUrl?.trim() ?? '',
            form.proxyUrl?.trim() ?? '',
            resolvedTestModel,
            headersSignature,
            modelsSignature,
        ].join('||')
    }, [form.apiKey, form.baseUrl, form.headers, form.modelEntries, form.proxyUrl, resolvedTestModel])

    const previousConnectivityConfigRef = useRef(connectivityConfigSignature)

    useEffect(() => {
        if (previousConnectivityConfigRef.current === connectivityConfigSignature) {
            return
        }
        previousConnectivityConfigRef.current = connectivityConfigSignature
        setTestStatus('idle')
        setTestMessage('')
    }, [connectivityConfigSignature])

    const showTestError = useCallback(
        (message: string) => {
            setTestStatus('error')
            setTestMessage(message)
            showNotification(message, 'error')
        },
        [showNotification],
    )

    const runGeminiConnectivityTest = useCallback(
        async () => {
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

            const headers: Record<string, string> = {
                'Content-Type': 'application/json',
                ...customHeaders,
            }
            if (apiKey && !hasCustomGeminiKey && !hasCustomAuthHeader) {
                headers['x-goog-api-key'] = apiKey
            }

            setIsTesting(true)
            setTestStatus('loading')
            setTestMessage(t('ai_providers.gemini_test_running'))

            try {
                const result = await apiCallApi.request(
                    {
                        method: 'POST',
                        url: endpoint,
                        header: headers,
                        data: JSON.stringify({
                                                 contents: [{ role: 'user', parts: [{ text: 'Hi' }] }],
                                                 generationConfig: { maxOutputTokens: 8 },
                                             }),
                        proxyUrl: form.proxyUrl?.trim() || undefined,
                    },
                    { timeout: GEMINI_TEST_TIMEOUT_MS },
                )

                if (result.statusCode < 200 || result.statusCode >= 300) {
                    const detail   = getApiCallErrorMessage(result) || t('common.unknown_error')
                    const errorMsg = `${t('ai_providers.gemini_test_failed')}: ${detail}`
                    setTestStatus('error')
                    setTestMessage(errorMsg)
                    showNotification(errorMsg, 'error')
                } else {
                    const message = t('ai_providers.gemini_test_success')
                    setTestStatus('success')
                    setTestMessage(message)
                    showNotification(message, 'success')
                }
            } catch (err: unknown) {
                const message         = getErrorMessage(err)
                const errorCode       =
                          typeof err === 'object' && err !== null && 'code' in err ?
                          String((err as { code?: string }).code) :
                          ''
                const isTimeout       = errorCode === 'ECONNABORTED' || message.toLowerCase().includes('timeout')
                const resolvedMessage = isTimeout
                                        ?
                                        t(
                                            'ai_providers.gemini_test_timeout',
                                            { seconds: GEMINI_TEST_TIMEOUT_MS / 1000 },
                                        )
                                        :
                                        `${t('ai_providers.gemini_test_failed')}: ${message ||
                                                                                    t('common.unknown_error')}`
                setTestStatus('error')
                setTestMessage(resolvedMessage)
                showNotification(resolvedMessage, 'error')
            } finally {
                setIsTesting(false)
            }
        },
        [
            availableModels,
            form.apiKey,
            form.baseUrl,
            form.headers,
            form.proxyUrl,
            isTesting,
            resolvedTestModel,
            showNotification,
            showTestError,
            t,
        ],
    )

    const discovery = useModelDiscovery(
        form,
        setForm,
        { disableControls, saving, loading, invalidIndexParam, invalidIndex },
        {
            buildEndpoint: (baseUrl) => modelsApi.buildGeminiModelsEndpoint(baseUrl),
            fetchModels: (baseUrl, apiKey, headers, proxyUrl) =>
                modelsApi.fetchGeminiModelsViaApiCall(baseUrl, apiKey, headers, proxyUrl),
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
            <Input
                label={t('ai_providers.gemini_add_modal_key_label')}
                placeholder={t('ai_providers.gemini_add_modal_key_placeholder')}
                value={form.apiKey}
                onChange={(e) => setForm((prev) => ({ ...prev, apiKey: e.target.value }))}
                disabled={controlsDisabled}
                secret
            />
            <PriorityField form={form} setForm={setForm} disabled={controlsDisabled} />
            <PrefixField form={form} setForm={setForm} disabled={controlsDisabled} />
            <Input
                label={t('ai_providers.gemini_base_url_label')}
                placeholder={t('ai_providers.gemini_base_url_placeholder')}
                value={form.baseUrl ?? ''}
                onChange={(e) => setForm((prev) => ({ ...prev, baseUrl: e.target.value }))}
                disabled={controlsDisabled}
            />
            <Input
                label={t('ai_providers.gemini_add_modal_proxy_label')}
                placeholder={t('ai_providers.gemini_add_modal_proxy_placeholder')}
                value={form.proxyUrl ?? ''}
                onChange={(e) => setForm((prev) => ({ ...prev, proxyUrl: e.target.value }))}
                disabled={controlsDisabled}
            />
            <HeadersField
                entries={form.headers}
                onChange={(entries) => setForm((prev) => ({ ...prev, headers: entries }))}
                disabled={controlsDisabled}
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
