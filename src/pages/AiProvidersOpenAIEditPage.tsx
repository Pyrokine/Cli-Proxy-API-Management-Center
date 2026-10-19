import {ModelConfigSection} from '@/components/common/ModelConfigSection'
import {ModelTestPanel} from '@/components/common/ModelTestPanel'
import {ClaudeCodeConfigPanel} from '@/components/providers/ClaudeCodeConfigPanel'
import {buildApiKeyEntry} from '@/components/providers/utils'
import {CredentialOverrideFields, RequestScopedErrorsField} from '@/components/providers/CredentialOverrideFields'
import {getCredentialRetryValidationKey} from '@/utils/credentialOverrides'
import {Button} from '@/components/ui/Button'
import {IconEye, IconEyeOff} from '@/components/ui/icons'
import {Input} from '@/components/ui/Input'
import {getModelEntriesValidationKey} from '@/components/ui/modelInputListUtils'
import {ToggleSwitch} from '@/components/ui/ToggleSwitch'
import {useEdgeSwipeBack} from '@/hooks/useEdgeSwipeBack'
import {useEscapeKey} from '@/hooks/useEscapeKey'
import {resolveProviderEditModalState, withProviderEditReturnFocus} from '@/hooks/useProviderEditPresentation'
import {modelsApi} from '@/services/api'
import {apiCallApi, getApiCallErrorMessage, prepareApiCallAuth} from '@/services/api/apiCall'
import {apiClient} from '@/services/api/client'
import {useAuthStore, useNotificationStore} from '@/stores'
import type {KeyTestStatus} from '@/stores/useOpenAIEditDraftStore'
import type {ApiKeyEntry} from '@/types'
import {MAX_CREDENTIAL_WEIGHT} from '@/utils/credentialWeight'
import {buildHeaderObject, hasHeader} from '@/utils/headers'
import {getErrorMessage} from '@/utils/helpers'
import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {useLocation, useNavigate, useOutletContext} from 'react-router-dom'
import type {OpenAIEditOutletContext} from './AiProvidersOpenAIEditLayout'
import styles from './ProviderEditForm.module.scss'
import {ProviderEditShell} from './ProviderEditShell'
import {HeadersField, PrefixField, PriorityField, QuickFillField} from './ProviderFormFields'
import {applyProviderQuickFill, OPENAI_QUICK_FILL_PRESETS} from './providerQuickFill'

const OPENAI_TEST_TIMEOUT_MS           = 30000
const OPENAI_MODEL_DISCOVERY_BUTTON_ID = 'provider-model-discovery-openai'

const buildOpenAIChatCompletionsEndpoint = (baseUrl: string) =>
    modelsApi.buildV1ModelsEndpoint(baseUrl).replace(/\/models$/i, '/chat/completions')

const idleKeyTestStatus = (): KeyTestStatus => ({ status: 'idle', message: '' })

export function AiProvidersOpenAIEditPage() {
    const { t }                = useTranslation()
    const navigate             = useNavigate()
    const location             = useLocation()
    const modalPresentation    = resolveProviderEditModalState(location.state, location.pathname)
    const { showNotification } = useNotificationStore()
    const authGeneration       = useAuthStore(() => apiClient.getAuthGeneration())
    const {
              hasIndexParam,
              invalidIndexParam,
              invalidIndex,
              disableControls,
              loading,
              saving,
              form,
              setForm,
              testModel,
              setTestModel,
              testStatus,
              setTestStatus,
              testMessage,
              setTestMessage,
              keyTestStatuses,
              setDraftKeyTestStatus,
              setDraftKeyTestStatuses,
              availableModels,
              handleBack,
              handleSave,
          }                    = useOutletContext<OpenAIEditOutletContext>()

    const title = hasIndexParam ? t('ai_providers.openai_edit_modal_title') : t('ai_providers.openai_add_modal_title')

    const swipeRef                                  = useEdgeSwipeBack({ onBack: handleBack })
    const [visibleApiKeyRows, setVisibleApiKeyRows] = useState<Record<number, boolean>>({})
    const [isTesting, setIsTesting]                 = useState(false)
    const activeTestAbortRef                        = useRef<AbortController | null>(null)
    const activeTestRequestIdRef                    = useRef(0)

    useEscapeKey(handleBack, !modalPresentation)

    const modelSelectOptions = useMemo(
        () => availableModels.map((model) => ({ value: model, label: model })),
        [availableModels],
    )

    const resolvedTestModel = testModel || availableModels[0] || ''

    const connectivityConfigSignature   = useMemo(
        () => JSON.stringify({
                                 authGeneration,
                                 baseUrl: form.baseUrl.trim(),
                                 headers: form.headers.map((entry) => [entry.key.trim(), entry.value.trim()]),
                                 authIndex: form.authIndex?.trim() ?? '',
                                 model: resolvedTestModel.trim(),
                                 keys: form.apiKeyEntries.map((entry) => ({
                                     apiKey: entry.apiKey.trim(),
                                     authIndex: entry.authIndex?.trim() ?? '',
                                     proxyUrl: entry.proxyUrl?.trim() ?? '',
                                 })),
                             }),
        [authGeneration, form.apiKeyEntries, form.authIndex, form.baseUrl, form.headers, resolvedTestModel],
    )
    const previousConnectivityConfigRef = useRef(connectivityConfigSignature)

    const cancelActiveTest = useCallback(() => {
        ++activeTestRequestIdRef.current
        activeTestAbortRef.current?.abort()
        activeTestAbortRef.current = null
    }, [])

    useEffect(() => () => cancelActiveTest(), [cancelActiveTest])

    useEffect(() => {
        if (previousConnectivityConfigRef.current === connectivityConfigSignature) {
            return
        }
        previousConnectivityConfigRef.current = connectivityConfigSignature
        cancelActiveTest()
        setIsTesting(false)
        setTestStatus('idle')
        setTestMessage('')
        setDraftKeyTestStatuses(form.apiKeyEntries.map(idleKeyTestStatus))
    }, [
                  cancelActiveTest,
                  connectivityConfigSignature,
                  form.apiKeyEntries,
                  setDraftKeyTestStatuses,
                  setTestMessage,
                  setTestStatus,
              ])

    const canSave          = !disableControls &&
                             !loading &&
                             !saving &&
                             !invalidIndexParam &&
                             !invalidIndex &&
                             !isTesting &&
                             !getCredentialRetryValidationKey(form.requestRetry) &&
                             !getModelEntriesValidationKey(form.modelEntries)
    const controlsDisabled = saving || disableControls || isTesting

    const openOpenaiModelDiscovery = () => {
        const baseUrl = form.baseUrl.trim()
        if (!baseUrl) {
            showNotification(t('ai_providers.openai_models_fetch_invalid_url'), 'error')
            return
        }
        navigate('models', {
            state: withProviderEditReturnFocus(location.state, OPENAI_MODEL_DISCOVERY_BUTTON_ID),
        })
    }

    const runOpenAIConnectivityTest = async (keyIndex?: number) => {
        if (authGeneration !== apiClient.getAuthGeneration() || isTesting || activeTestAbortRef.current) {
            return
        }

        const baseUrl = form.baseUrl.trim()
        if (!baseUrl) {
            const message = t('notification.openai_test_url_required')
            setTestStatus('error')
            setTestMessage(message)
            showNotification(message, 'error')
            return
        }

        const modelName = resolvedTestModel.trim()
        if (!modelName) {
            const message = t('notification.openai_test_model_required')
            setTestStatus('error')
            setTestMessage(message)
            showNotification(message, 'error')
            return
        }

        const headerObject = buildHeaderObject(form.headers)
        const keyEntry     = keyIndex !== undefined
                             ? form.apiKeyEntries[keyIndex]
                             : form.apiKeyEntries.find((entry) => entry.apiKey?.trim() || entry.authIndex?.trim())
        const authIndex    = keyEntry?.authIndex?.trim()
        const apiKey       = keyEntry?.apiKey?.trim()
        const hasAuth      = hasHeader(headerObject, 'authorization')
        if (!apiKey && !hasAuth && !authIndex) {
            const message = t('notification.openai_test_key_required')
            setTestStatus('error')
            setTestMessage(message)
            if (keyIndex !== undefined) {
                setDraftKeyTestStatus(keyIndex, { status: 'error', message })
            }
            showNotification(message, 'error')
            return
        }

        const endpoint = buildOpenAIChatCompletionsEndpoint(baseUrl)
        if (!endpoint) {
            const message = t('notification.openai_test_url_required')
            setTestStatus('error')
            setTestMessage(message)
            showNotification(message, 'error')
            return
        }

        let preparedAuth: ReturnType<typeof prepareApiCallAuth>
        try {
            preparedAuth = prepareApiCallAuth({
                                                  headers: headerObject,
                                                  apiKey,
                                                  authIndex,
                                                  preferredHeader: 'Authorization',
                                                  authorizationScheme: 'Bearer',
                                              })
        } catch (err: unknown) {
            const message = `${t('ai_providers.openai_test_failed')}: ${getErrorMessage(err)}`
            setTestStatus('error')
            setTestMessage(message)
            if (keyIndex !== undefined) {
                setDraftKeyTestStatus(keyIndex, { status: 'error', message })
            }
            showNotification(message, 'error')
            return
        }

        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            ...preparedAuth.headers,
        }
        const requestId                       = ++activeTestRequestIdRef.current
        const controller                      = new AbortController()
        activeTestAbortRef.current            = controller

        const runningMessage = t('ai_providers.openai_test_running')
        setIsTesting(true)
        setTestStatus('loading')
        setTestMessage(runningMessage)
        if (keyIndex !== undefined) {
            setDraftKeyTestStatus(keyIndex, { status: 'loading', message: runningMessage })
        }

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
                    proxyUrl: keyEntry?.proxyUrl?.trim() || undefined,
                    authIndex,
                    draftToken: preparedAuth.draftToken,
                },
                { timeout: OPENAI_TEST_TIMEOUT_MS, signal: controller.signal },
            )

            if (authGeneration !== apiClient.getAuthGeneration() || requestId !== activeTestRequestIdRef.current ||
                controller.signal.aborted) {
                return
            }
            if (result.statusCode < 200 || result.statusCode >= 300) {
                const detail  = getApiCallErrorMessage(result) || t('common.unknown_error')
                const message = `${t('ai_providers.openai_test_failed')}: ${detail}`
                setTestStatus('error')
                setTestMessage(message)
                if (keyIndex !== undefined) {
                    setDraftKeyTestStatus(keyIndex, { status: 'error', message })
                }
                showNotification(message, 'error')
            } else {
                const message = t('ai_providers.openai_test_success')
                setTestStatus('success')
                setTestMessage(message)
                if (keyIndex !== undefined) {
                    setDraftKeyTestStatus(keyIndex, { status: 'success', message })
                }
                showNotification(message, 'success')
            }
        } catch (err: unknown) {
            const message   = getErrorMessage(err)
            const errorCode = typeof err === 'object' && err !== null && 'code' in err
                              ? String((err as { code?: string }).code)
                              : ''
            if (
                authGeneration !== apiClient.getAuthGeneration() ||
                requestId !== activeTestRequestIdRef.current ||
                controller.signal.aborted ||
                errorCode === 'ERR_CANCELED'
            ) {
                return
            }
            const isTimeout       = errorCode === 'ECONNABORTED' || message.toLowerCase().includes('timeout')
            const resolvedMessage = isTimeout
                                    ? t('ai_providers.openai_test_timeout', { seconds: OPENAI_TEST_TIMEOUT_MS / 1000 })
                                    : `${t('ai_providers.openai_test_failed')}: ${message || t('common.unknown_error')}`
            setTestStatus('error')
            setTestMessage(resolvedMessage)
            if (keyIndex !== undefined) {
                setDraftKeyTestStatus(keyIndex, { status: 'error', message: resolvedMessage })
            }
            showNotification(resolvedMessage, 'error')
        } finally {
            if (requestId === activeTestRequestIdRef.current) {
                activeTestAbortRef.current = null
                if (authGeneration === apiClient.getAuthGeneration() && !controller.signal.aborted) {
                    setIsTesting(false)
                }
            }
        }
    }

    const renderKeyEntries = (entries: ApiKeyEntry[]) => {
        const list = entries.length ? entries : [buildApiKeyEntry()]

        const updateEntry = (idx: number, patch: Partial<ApiKeyEntry>) => {
            const next = list.map((entry, i) => (i === idx ? { ...entry, ...patch } : entry))
            setForm((prev) => ({ ...prev, apiKeyEntries: next }))
            setDraftKeyTestStatus(idx, idleKeyTestStatus())
        }

        const removeEntry = (idx: number) => {
            const next = list.filter((_, i) => i !== idx)
            setForm((prev) => ({
                ...prev,
                apiKeyEntries: next.length ? next : [buildApiKeyEntry()],
            }))
            const nextStatuses = keyTestStatuses.filter((_, i) => i !== idx)
            setDraftKeyTestStatuses(next.length ? nextStatuses : [idleKeyTestStatus()])
            setVisibleApiKeyRows((prev) => {
                const shifted: Record<number, boolean> = {}
                Object.entries(prev).forEach(([rawIndex, value]) => {
                    const rowIndex = Number(rawIndex)
                    if (!Number.isInteger(rowIndex) || rowIndex === idx) {
                        return
                    }
                    shifted[rowIndex > idx ? rowIndex - 1 : rowIndex] = value
                })
                return shifted
            })
        }

        const addEntry = () => {
            setForm((prev) => ({ ...prev, apiKeyEntries: [...list, buildApiKeyEntry()] }))
            setDraftKeyTestStatuses([...keyTestStatuses, idleKeyTestStatus()])
        }

        return (
            <div className={styles.keyEntriesList}>
                <div className={styles.keyEntriesToolbar}>
                    <span className={styles.keyEntriesCount}>
                        {t('ai_providers.openai_keys_count')}: {list.length}
                    </span>
                    <Button
                        variant='secondary'
                        size='sm'
                        onClick={addEntry}
                        disabled={controlsDisabled}
                        className={styles.addKeyButton}
                    >
                        {t('ai_providers.openai_keys_add_btn')}
                    </Button>
                </div>
                <div className={styles.keyTableShell}>
                    <div className={styles.keyTableHeader}>
                        <div className={styles.keyTableColIndex}>#</div>
                        <div className={styles.keyTableColKey}>{t('common.api_key')}</div>
                        <div className={styles.keyTableColProxy}>{t('common.proxy_url')}</div>
                        <div className={styles.keyTableColAuth}>{t('usage_stats.request_events_auth_index')}</div>
                        <div className={styles.keyTableColWeight}>{t('ai_providers.weight_label')}</div>
                        <div className={styles.keyTableColAction}>{t('common.action')}</div>
                    </div>

                    {list.map((entry, index) => (
                        <div key={index} className={styles.keyTableRow}>
                            <div className={styles.keyTableColIndex}>{index + 1}</div>

                            <div className={styles.keyTableColKey}>
                                <div className={styles.keyInputWrapper}>
                                    <input
                                        type={visibleApiKeyRows[index] ? 'text' : 'password'}
                                        value={entry.apiKey}
                                        onChange={(e) => updateEntry(index, { apiKey: e.target.value })}
                                        disabled={controlsDisabled}
                                        className={`input ${styles.keyTableInput} ${styles.keyTableSecretInput}`}
                                        placeholder={t('ai_providers.openai_key_placeholder')}
                                        autoComplete='new-password'
                                        spellCheck={false}
                                        autoCapitalize='none'
                                        autoCorrect='off'
                                    />
                                    <button
                                        type='button'
                                        className={styles.keyVisibilityButton}
                                        onClick={() =>
                                            setVisibleApiKeyRows((prev) => ({ ...prev, [index]: !prev[index] }))
                                        }
                                        disabled={controlsDisabled}
                                        aria-label={
                                            visibleApiKeyRows[index]
                                            ? t('login.hide_key', { defaultValue: 'Hide key' })
                                            : t('login.show_key', { defaultValue: 'Show key' })
                                        }
                                    >
                                        {visibleApiKeyRows[index] ? <IconEyeOff size={16} /> : <IconEye size={16} />}
                                    </button>
                                </div>
                            </div>

                            <div className={styles.keyTableColProxy}>
                                <input
                                    type='text'
                                    value={entry.proxyUrl ?? ''}
                                    onChange={(e) => updateEntry(index, { proxyUrl: e.target.value })}
                                    disabled={controlsDisabled}
                                    className={`input ${styles.keyTableInput}`}
                                    placeholder={t('ai_providers.openai_proxy_placeholder')}
                                    autoComplete='off'
                                    spellCheck={false}
                                    autoCapitalize='none'
                                    autoCorrect='off'
                                />
                            </div>

                            <div className={styles.keyTableColAuth}>
                                <input
                                    type='text'
                                    value={entry.authIndex ?? ''}
                                    readOnly
                                    disabled={controlsDisabled}
                                    className={`input ${styles.keyTableInput}`}
                                    placeholder='auth_index'
                                    autoComplete='off'
                                    spellCheck={false}
                                    autoCapitalize='none'
                                    autoCorrect='off'
                                />
                            </div>

                            <div className={styles.keyTableColWeight}>
                                <input
                                    type='number'
                                    step={1}
                                    max={MAX_CREDENTIAL_WEIGHT}
                                    value={entry.weight ?? ''}
                                    onChange={(e) => updateEntry(index, {
                                        weight: e.target.value.trim() === '' ? undefined : Number(e.target.value),
                                    })}
                                    disabled={controlsDisabled}
                                    className={`input ${styles.keyTableInput}`}
                                    placeholder='1'
                                    aria-label={t('ai_providers.weight_label')}
                                />
                            </div>

                            <div className={styles.keyTableColAction}>
                                <Button
                                    variant={keyTestStatuses[index]?.status === 'error' ? 'danger' : 'secondary'}
                                    size='sm'
                                    onClick={() => void runOpenAIConnectivityTest(index)}
                                    loading={keyTestStatuses[index]?.status === 'loading'}
                                    disabled={controlsDisabled || isTesting}
                                >
                                    {t('ai_providers.openai_test_single_action')}
                                </Button>
                                <Button
                                    variant='ghost'
                                    size='sm'
                                    onClick={() => removeEntry(index)}
                                    disabled={controlsDisabled || list.length <= 1}
                                >
                                    {t('common.delete')}
                                </Button>
                                {keyTestStatuses[index]?.message && (
                                    <div
                                        className={`status-badge ${
                                            keyTestStatuses[index]?.status === 'error'
                                            ? 'error'
                                            : keyTestStatuses[index]?.status === 'success'
                                              ? 'success'
                                              : 'muted'
                                        } ${styles.keyTestStatusBadge}`}
                                    >
                                        {keyTestStatuses[index]?.message}
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        )
    }

    return (
        <ProviderEditShell
            swipeRef={swipeRef}
            title={title}
            loading={loading}
            saving={saving}
            canSave={canSave}
            invalidIndexParam={invalidIndexParam}
            invalidIndex={invalidIndex}
            onBack={handleBack}
            onSave={() => void handleSave()}
        >
            <div className={styles.openaiEditForm}>
                <QuickFillField
                    presets={OPENAI_QUICK_FILL_PRESETS}
                    disabled={controlsDisabled}
                    onApply={(preset) => setForm((prev) => applyProviderQuickFill(prev, preset))}
                />
                <Input
                    label={t('ai_providers.openai_add_modal_name_label')}
                    value={form.name}
                    onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                    disabled={controlsDisabled}
                />
                <PriorityField form={form} setForm={setForm} disabled={controlsDisabled} />
                <CredentialOverrideFields
                    disableCooling={form.disableCooling}
                    requestRetry={form.requestRetry}
                    disabled={controlsDisabled}
                    onChange={(overrides) => setForm((previous) => ({...previous, ...overrides}))}
                />
                <RequestScopedErrorsField
                    rules={form.requestScopedErrors}
                    onChange={(rules) => setForm((previous) => ({...previous, requestScopedErrors: rules}))}
                    disabled={controlsDisabled}
                />
                <PrefixField form={form} setForm={setForm} disabled={controlsDisabled} />
                <Input
                    label={t('ai_providers.openai_add_modal_url_label')}
                    value={form.baseUrl}
                    onChange={(e) => setForm((prev) => ({ ...prev, baseUrl: e.target.value }))}
                    disabled={controlsDisabled}
                />
                <div className='form-group'>
                    <ToggleSwitch
                        label={t('ai_providers.openai_disabled_label')}
                        checked={Boolean(form.disabled)}
                        onChange={(value) => setForm((prev) => ({ ...prev, disabled: value }))}
                        disabled={controlsDisabled}
                        ariaLabel={t('ai_providers.openai_disabled_label')}
                    />
                    <div className='hint'>{t('ai_providers.openai_disabled_hint')}</div>
                </div>
                <div className='form-group'>
                    <ToggleSwitch
                        label={t('ai_providers.openai_prompt_cache_key_label')}
                        checked={Boolean(form.supportPromptCacheKey)}
                        onChange={(value) => setForm((prev) => ({...prev, supportPromptCacheKey: value}))}
                        disabled={controlsDisabled}
                    />
                    <div className='hint'>{t('ai_providers.openai_prompt_cache_key_hint')}</div>
                </div>

                <HeadersField
                    entries={form.headers}
                    onChange={(entries) => setForm((prev) => ({ ...prev, headers: entries }))}
                    disabled={controlsDisabled}
                />

                <ModelConfigSection
                    provider='openai'
                    title={
                        hasIndexParam
                        ? t('ai_providers.openai_edit_modal_models_label')
                        : t('ai_providers.openai_add_modal_models_label')
                    }
                    hint={t('ai_providers.openai_models_hint')}
                    addLabel={t('ai_providers.openai_models_add_btn')}
                    fetchLabel={t('ai_providers.openai_models_fetch_button')}
                    entries={form.modelEntries}
                    setForm={setForm}
                    onFetchModels={openOpenaiModelDiscovery}
                    fetchButtonId={OPENAI_MODEL_DISCOVERY_BUTTON_ID}
                    disabled={controlsDisabled}
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
                        i18nPrefix='ai_providers.openai'
                        onTest={() => void runOpenAIConnectivityTest()}
                    />
                </ModelConfigSection>

                <ClaudeCodeConfigPanel models={form.modelEntries} disabled={controlsDisabled} />

                <div className={styles.keyEntriesSection}>
                    <div className={styles.keyEntriesHeader}>
                        <label className={styles.keyEntriesTitle}>
                            {t('ai_providers.openai_add_modal_keys_label')}
                        </label>
                        <span className={styles.keyEntriesHint}>{t('ai_providers.openai_keys_hint')}</span>
                    </div>
                    {renderKeyEntries(form.apiKeyEntries)}
                </div>
            </div>
        </ProviderEditShell>
    )
}
