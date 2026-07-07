import {ModelTestPanel} from '@/components/common/ModelTestPanel'
import type {ProviderFormState} from '@/components/providers'
import {excludedModelsToText, parseTextList} from '@/components/providers/utils'
import {Input} from '@/components/ui/Input'
import {entriesToModels, modelsToEntries} from '@/components/ui/modelInputListUtils'
import {ToggleSwitch} from '@/components/ui/ToggleSwitch'
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
import type {ProviderKeyConfig} from '@/types'
import {buildHeaderObject, hasHeader, headersToEntries} from '@/utils/headers'
import {getErrorMessage} from '@/utils/helpers'
import {useEffect, useMemo, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {ProviderEditShell} from './ProviderEditShell'
import {HeadersField, PrefixField, PriorityField, ProviderModelSection} from './ProviderFormFields'

// ---- Form helpers ----

const CODEX_TEST_TIMEOUT_MS    = 30000
const DEFAULT_CODEX_TEST_MODEL = 'gpt-5.4-mini'

const buildCodexChatCompletionsEndpoint = (baseUrl: string) =>
    modelsApi.buildV1ModelsEndpoint(baseUrl).replace(/\/models$/i, '/chat/completions')

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

    const editOptions: ProviderEditFormConfig<ProviderFormState, ProviderKeyConfig> = {
        configKey: 'codex-api-key',
        buildEmptyForm,
        buildSignature,
        loadConfigs: async ({ fetchConfig }) => {
            const value = await fetchConfig('codex-api-key')
            return Array.isArray(value) ? (value as ProviderKeyConfig[]) : []
        },
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
            prefix: form.prefix?.trim() || undefined,
            baseUrl: (form.baseUrl ?? '').trim() || undefined,
            websockets: Boolean(form.websockets),
            proxyUrl: form.proxyUrl?.trim() || undefined,
            headers: buildHeaderObject(form.headers),
            models: entriesToModels(form.modelEntries),
            excludedModels: parseTextList(form.excludedText),
        }),
        saveConfigs: (configs) => providersApi.saveCodexConfigs(configs),
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
            fetchModels: (baseUrl, apiKey, headers, proxyUrl) => {
                const hasCustomAuthorization = Object.keys(headers).some((key) => key.toLowerCase() === 'authorization')
                return modelsApi.fetchV1ModelsViaApiCall(
                    baseUrl,
                    hasCustomAuthorization ? undefined : apiKey,
                    headers,
                    proxyUrl,
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

    const [testModel, setTestModel]     = useState('')
    const [testStatus, setTestStatus]   = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
    const [testMessage, setTestMessage] = useState('')
    const [isTesting, setIsTesting]     = useState(false)
    const { showNotification }          = useNotificationStore()
    const controlsDisabled              = disabled || isTesting

    const modelSelectOptions = useModelSelectOptions(form.modelEntries)
    const availableModels    = useMemo(() => modelSelectOptions.map((option) => option.value), [modelSelectOptions])
    const canOpenDiscovery   = discovery.canOpen && Boolean((form.baseUrl ?? '').trim())

    const connectivityConfigSignature = useMemo(() => {
        const headersSignature = form.headers.map((entry) => `${entry.key.trim()}:${entry.value.trim()}`).join('|')
        const modelsSignature  = form.modelEntries.map((entry) => `${entry.name.trim()}:${entry.alias.trim()}`)
                                     .join('|')
        return [
            form.apiKey.trim(),
            form.baseUrl?.trim() ?? '',
            form.proxyUrl?.trim() ?? '',
            testModel.trim(),
            headersSignature,
            modelsSignature,
        ].join('||')
    }, [form.apiKey, form.baseUrl, form.headers, form.modelEntries, form.proxyUrl, testModel])

    const previousConnectivityConfigRef = useRef(connectivityConfigSignature)

    useEffect(() => {
        if (previousConnectivityConfigRef.current === connectivityConfigSignature) {
            return
        }
        previousConnectivityConfigRef.current = connectivityConfigSignature
        setTestStatus('idle')
        setTestMessage('')
    }, [connectivityConfigSignature])

    const runCodexConnectivityTest = async () => {
        if (isTesting) {
            return
        }

        const baseUrl = (form.baseUrl ?? '').trim()
        if (!baseUrl) {
            const message = t('notification.codex_base_url_required')
            setTestStatus('error')
            setTestMessage(message)
            showNotification(message, 'error')
            return
        }

        const modelName     = testModel.trim() || availableModels[0] || DEFAULT_CODEX_TEST_MODEL
        const customHeaders = buildHeaderObject(form.headers)
        const apiKey        = form.apiKey.trim()
        const hasAuth       = hasHeader(customHeaders, 'authorization')
        if (!apiKey && !hasAuth) {
            const message = t('ai_providers.codex_test_key_required')
            setTestStatus('error')
            setTestMessage(message)
            showNotification(message, 'error')
            return
        }

        const endpoint = buildCodexChatCompletionsEndpoint(baseUrl)
        if (!endpoint) {
            const message = t('notification.codex_base_url_required')
            setTestStatus('error')
            setTestMessage(message)
            showNotification(message, 'error')
            return
        }

        const headers: Record<string, string> = { 'Content-Type': 'application/json', ...customHeaders }
        if (apiKey && !hasAuth) {
            headers.Authorization = `Bearer ${apiKey}`
        }

        setIsTesting(true)
        setTestStatus('loading')
        setTestMessage(t('ai_providers.codex_test_running'))

        try {
            const result = await apiCallApi.request(
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
                },
                { timeout: CODEX_TEST_TIMEOUT_MS },
            )

            if (result.statusCode < 200 || result.statusCode >= 300) {
                const detail  = getApiCallErrorMessage(result) || t('common.unknown_error')
                const message = `${t('ai_providers.codex_test_failed')}: ${detail}`
                setTestStatus('error')
                setTestMessage(message)
                showNotification(message, 'error')
            } else {
                const message = t('ai_providers.codex_test_success')
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
                                    ? t('ai_providers.codex_test_timeout', { seconds: CODEX_TEST_TIMEOUT_MS / 1000 })
                                    : `${t('ai_providers.codex_test_failed')}: ${message || t('common.unknown_error')}`
            setTestStatus('error')
            setTestMessage(resolvedMessage)
            showNotification(resolvedMessage, 'error')
        } finally {
            setIsTesting(false)
        }
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
            <Input
                label={t('ai_providers.codex_add_modal_key_label')}
                value={form.apiKey}
                onChange={(e) => setForm((prev) => ({ ...prev, apiKey: e.target.value }))}
                disabled={controlsDisabled}
                secret
            />
            <PriorityField form={form} setForm={setForm} disabled={controlsDisabled} />
            <PrefixField form={form} setForm={setForm} disabled={controlsDisabled} />
            <Input
                label={t('ai_providers.codex_add_modal_url_label')}
                value={form.baseUrl ?? ''}
                onChange={(e) => setForm((prev) => ({ ...prev, baseUrl: e.target.value }))}
                disabled={controlsDisabled}
            />
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
            <Input
                label={t('ai_providers.codex_add_modal_proxy_label')}
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
