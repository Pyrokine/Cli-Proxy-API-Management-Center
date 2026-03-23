import {ModelConfigSection} from '@/components/common/ModelConfigSection'
import {ModelTestPanel} from '@/components/common/ModelTestPanel'
import {buildApiKeyEntry, buildOpenAIChatCompletionsEndpoint} from '@/components/providers/utils'
import {Button} from '@/components/ui/Button'
import {Input} from '@/components/ui/Input'
import {useEdgeSwipeBack} from '@/hooks/useEdgeSwipeBack'
import {useEscapeKey} from '@/hooks/useEscapeKey'
import {useModelSelectOptions} from '@/hooks/useModelSelectOptions'
import {apiCallApi, getApiCallErrorMessage} from '@/services/api'
import {useNotificationStore} from '@/stores'
import type {KeyTestStatus} from '@/stores/useOpenAIEditDraftStore'
import type {ApiKeyEntry} from '@/types'
import {buildHeaderObject} from '@/utils/headers'
import {getErrorMessage} from '@/utils/helpers'
import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {useNavigate, useOutletContext} from 'react-router-dom'
import type {OpenAIEditOutletContext} from './AiProvidersOpenAIEditLayout'
import styles from './ProviderEditForm.module.scss'
import {ProviderEditShell} from './ProviderEditShell'
import {HeadersField, PrefixField, PriorityField} from './ProviderFormFields'

const OPENAI_TEST_TIMEOUT_MS = 30_000

// Status icon components
function StatusLoadingIcon() {
    return (
        <svg width='16' height='16' viewBox='0 0 16 16' fill='none' className={styles.statusIconSpin}>
            <circle cx='8' cy='8' r='7' stroke='currentColor' strokeOpacity='0.25' strokeWidth='2' />
            <path d='M8 1A7 7 0 0 1 8 15' stroke='currentColor' strokeWidth='2' strokeLinecap='round' />
        </svg>
    )
}

function StatusSuccessIcon() {
    return (
        <svg width='16' height='16' viewBox='0 0 16 16' fill='none'>
            <circle cx='8' cy='8' r='8' fill='var(--success-color, #10b981)' />
            <path d='M4.5 8L7 10.5L11.5 6' stroke='white' strokeWidth='2' strokeLinecap='round'
                  strokeLinejoin='round' />
        </svg>
    )
}

function StatusErrorIcon() {
    return (
        <svg width='16' height='16' viewBox='0 0 16 16' fill='none'>
            <circle cx='8' cy='8' r='8' fill='var(--danger-color, #c65746)' />
            <path d='M5 5L11 11M11 5L5 11' stroke='white' strokeWidth='2' strokeLinecap='round'
                  strokeLinejoin='round' />
        </svg>
    )
}

function StatusIdleIcon() {
    return (
        <svg width='16' height='16' viewBox='0 0 16 16' fill='none'>
            <circle cx='8' cy='8' r='7' stroke='var(--text-tertiary, #9ca3af)' strokeWidth='2' />
        </svg>
    )
}

function StatusIcon({ status }: { status: KeyTestStatus['status'] }) {
    switch (status) {
        case 'loading':
            return <StatusLoadingIcon />
        case 'success':
            return <StatusSuccessIcon />
        case 'error':
            return <StatusErrorIcon />
        default:
            return <StatusIdleIcon />
    }
}

export function AiProvidersOpenAIEditPage() {
    const { t }                = useTranslation()
    const navigate             = useNavigate()
    const { showNotification } = useNotificationStore()
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
              resetDraftKeyTestStatuses,
              availableModels,
              handleBack,
              handleSave,
          }                    = useOutletContext<OpenAIEditOutletContext>()

    const title = hasIndexParam ? t('ai_providers.openai_edit_modal_title') : t('ai_providers.openai_add_modal_title')

    const swipeRef                          = useEdgeSwipeBack({ onBack: handleBack })
    const [isTestingKeys, setIsTestingKeys] = useState(false)

    useEscapeKey(handleBack)

    const canSave             = !disableControls &&
                                !loading &&
                                !saving &&
                                !invalidIndexParam &&
                                !invalidIndex &&
                                !isTestingKeys
    const hasConfiguredModels = form.modelEntries.some((entry) => entry.name.trim())
    const hasTestableKeys     = form.apiKeyEntries.some((entry) => entry.apiKey?.trim())
    const modelSelectOptions  = useModelSelectOptions(form.modelEntries)
    const controlsDisabled    = saving || disableControls || isTestingKeys

    const connectivityConfigSignature   = useMemo(() => {
        const headersSignature = form.headers.map((entry) => `${entry.key.trim()}:${entry.value.trim()}`).join('|')
        const modelsSignature  = form.modelEntries.map((entry) => `${entry.name.trim()}:${entry.alias.trim()}`)
                                     .join('|')
        return [form.baseUrl.trim(), testModel.trim(), headersSignature, modelsSignature].join('||')
    }, [form.baseUrl, form.headers, form.modelEntries, testModel])
    const previousConnectivityConfigRef = useRef(connectivityConfigSignature)

    useEffect(() => {
        if (previousConnectivityConfigRef.current === connectivityConfigSignature) {
            return
        }
        previousConnectivityConfigRef.current = connectivityConfigSignature
        resetDraftKeyTestStatuses(form.apiKeyEntries.length)
        setTestStatus('idle')
        setTestMessage('')
    }, [
                  connectivityConfigSignature,
                  form.apiKeyEntries.length,
                  resetDraftKeyTestStatuses,
                  setTestStatus,
                  setTestMessage,
              ])

    // Test a single key by index
    const runSingleKeyTest = useCallback(
        async (keyIndex: number): Promise<boolean> => {
            const baseUrl = form.baseUrl.trim()
            if (!baseUrl) {
                showNotification(t('notification.openai_test_url_required'), 'error')
                return false
            }

            const endpoint = buildOpenAIChatCompletionsEndpoint(baseUrl)
            if (!endpoint) {
                showNotification(t('notification.openai_test_url_required'), 'error')
                return false
            }

            const keyEntry = form.apiKeyEntries[keyIndex]
            if (!keyEntry?.apiKey?.trim()) {
                setDraftKeyTestStatus(keyIndex, {
                    status: 'error',
                    message: t('notification.openai_test_key_required'),
                })
                return false
            }

            const modelName = testModel.trim() || availableModels[0] || ''
            if (!modelName) {
                showNotification(t('notification.openai_test_model_required'), 'error')
                return false
            }

            const customHeaders                   = buildHeaderObject(form.headers)
            const headers: Record<string, string> = {
                'Content-Type': 'application/json',
                ...customHeaders,
            }
            if (!headers.Authorization && !headers['authorization']) {
                headers.Authorization = `Bearer ${keyEntry.apiKey.trim()}`
            }

            // Set loading state for this key
            setDraftKeyTestStatus(keyIndex, { status: 'loading', message: '' })

            try {
                const result = await apiCallApi.request(
                    {
                        method: 'POST',
                        url: endpoint,
                        header: Object.keys(headers).length ? headers : undefined,
                        data: JSON.stringify({
                                                 model: modelName,
                                                 messages: [{ role: 'user', content: 'Hi' }],
                                                 stream: false,
                                                 max_tokens: 5,
                                             }),
                    },
                    { timeout: OPENAI_TEST_TIMEOUT_MS },
                )

                if (result.statusCode < 200 || result.statusCode >= 300) {
                    const errorMessage = getApiCallErrorMessage(result) || t('common.unknown_error')
                    setDraftKeyTestStatus(keyIndex, { status: 'error', message: errorMessage })
                    return false
                }

                setDraftKeyTestStatus(keyIndex, { status: 'success', message: '' })
                return true
            } catch (err: unknown) {
                const message      = getErrorMessage(err)
                const errorCode    =
                          typeof err === 'object' && err !== null && 'code' in err ?
                          String((err as { code?: string }).code) :
                          ''
                const isTimeout    = errorCode === 'ECONNABORTED' || message.toLowerCase().includes('timeout')
                const errorMessage = isTimeout
                                     ? t('ai_providers.openai_test_timeout', { seconds: OPENAI_TEST_TIMEOUT_MS / 1000 })
                                     : message
                setDraftKeyTestStatus(keyIndex, { status: 'error', message: errorMessage })
                return false
            }
        },
        [
            form.baseUrl,
            form.apiKeyEntries,
            form.headers,
            testModel,
            availableModels,
            t,
            setDraftKeyTestStatus,
            showNotification,
        ],
    )

    const testSingleKey = useCallback(
        async (keyIndex: number): Promise<boolean> => {
            if (isTestingKeys) {
                return false
            }
            setIsTestingKeys(true)
            try {
                return await runSingleKeyTest(keyIndex)
            } finally {
                setIsTestingKeys(false)
            }
        },
        [isTestingKeys, runSingleKeyTest],
    )

    // Test all keys
    const testAllKeys = useCallback(async () => {
        if (isTestingKeys) {
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

        const endpoint = buildOpenAIChatCompletionsEndpoint(baseUrl)
        if (!endpoint) {
            const message = t('notification.openai_test_url_required')
            setTestStatus('error')
            setTestMessage(message)
            showNotification(message, 'error')
            return
        }

        const modelName = testModel.trim() || availableModels[0] || ''
        if (!modelName) {
            const message = t('notification.openai_test_model_required')
            setTestStatus('error')
            setTestMessage(message)
            showNotification(message, 'error')
            return
        }

        const validKeyIndexes = form.apiKeyEntries
                                    .map((entry, index) => (entry.apiKey?.trim() ? index : -1))
                                    .filter((index) => index >= 0)
        if (validKeyIndexes.length === 0) {
            const message = t('notification.openai_test_key_required')
            setTestStatus('error')
            setTestMessage(message)
            showNotification(message, 'error')
            return
        }

        setIsTestingKeys(true)
        setTestStatus('loading')
        setTestMessage(t('ai_providers.openai_test_running'))
        resetDraftKeyTestStatuses(form.apiKeyEntries.length)

        try {
            const results = await Promise.all(validKeyIndexes.map((index) => runSingleKeyTest(index)))

            const successCount = results.filter(Boolean).length
            const failCount    = validKeyIndexes.length - successCount

            if (failCount === 0) {
                const message = t('ai_providers.openai_test_all_success', { count: successCount })
                setTestStatus('success')
                setTestMessage(message)
                showNotification(message, 'success')
            } else if (successCount === 0) {
                const message = t('ai_providers.openai_test_all_failed', { count: failCount })
                setTestStatus('error')
                setTestMessage(message)
                showNotification(message, 'error')
            } else {
                const message = t('ai_providers.openai_test_all_partial', {
                    success: successCount,
                    failed: failCount,
                })
                setTestStatus('error')
                setTestMessage(message)
                showNotification(message, 'warning')
            }
        } finally {
            setIsTestingKeys(false)
        }
    }, [
                                        isTestingKeys,
                                        form.baseUrl,
                                        form.apiKeyEntries,
                                        testModel,
                                        availableModels,
                                        t,
                                        setTestStatus,
                                        setTestMessage,
                                        resetDraftKeyTestStatuses,
                                        runSingleKeyTest,
                                        showNotification,
                                    ])

    const openOpenaiModelDiscovery = () => {
        const baseUrl = form.baseUrl.trim()
        if (!baseUrl) {
            showNotification(t('ai_providers.openai_models_fetch_invalid_url'), 'error')
            return
        }
        navigate('models')
    }

    const renderKeyEntries = (entries: ApiKeyEntry[]) => {
        const list = entries.length ? entries : [buildApiKeyEntry()]

        const updateEntry = (idx: number, field: keyof ApiKeyEntry, value: string) => {
            const next = list.map((entry, i) => (i === idx ? { ...entry, [field]: value } : entry))
            setForm((prev) => ({ ...prev, apiKeyEntries: next }))
            setDraftKeyTestStatus(idx, { status: 'idle', message: '' })
            setTestStatus('idle')
            setTestMessage('')
        }

        const removeEntry = (idx: number) => {
            const next       = list.filter((_, i) => i !== idx)
            const nextLength = next.length ? next.length : 1
            setForm((prev) => ({
                ...prev,
                apiKeyEntries: next.length ? next : [buildApiKeyEntry()],
            }))
            resetDraftKeyTestStatuses(nextLength)
            setTestStatus('idle')
            setTestMessage('')
        }

        const addEntry = () => {
            setForm((prev) => ({ ...prev, apiKeyEntries: [...list, buildApiKeyEntry()] }))
            resetDraftKeyTestStatuses(list.length + 1)
            setTestStatus('idle')
            setTestMessage('')
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
                    {/* 表头 */}
                    <div className={styles.keyTableHeader}>
                        <div className={styles.keyTableColIndex}>#</div>
                        <div className={styles.keyTableColStatus}>{t('common.status')}</div>
                        <div className={styles.keyTableColKey}>{t('common.api_key')}</div>
                        <div className={styles.keyTableColProxy}>{t('common.proxy_url')}</div>
                        <div className={styles.keyTableColAction}>{t('common.action')}</div>
                    </div>

                    {/* 数据行 */}
                    {list.map((entry, index) => {
                        const keyStatus  = keyTestStatuses[index]?.status ?? 'idle'
                        const canTestKey = Boolean(entry.apiKey?.trim()) && hasConfiguredModels

                        return (
                            <div key={index} className={styles.keyTableRow}>
                                {/* 序号 */}
                                <div className={styles.keyTableColIndex}>{index + 1}</div>

                                {/* 状态指示灯 */}
                                <div className={styles.keyTableColStatus} title={keyTestStatuses[index]?.message || ''}>
                                    <StatusIcon status={keyStatus} />
                                </div>

                                {/* Key 输入框 */}
                                <div className={styles.keyTableColKey}>
                                    <input
                                        type='text'
                                        value={entry.apiKey}
                                        onChange={(e) => updateEntry(index, 'apiKey', e.target.value)}
                                        disabled={controlsDisabled}
                                        className={`input ${styles.keyTableInput}`}
                                        placeholder={t('ai_providers.openai_key_placeholder')}
                                    />
                                </div>

                                {/* Proxy 输入框 */}
                                <div className={styles.keyTableColProxy}>
                                    <input
                                        type='text'
                                        value={entry.proxyUrl ?? ''}
                                        onChange={(e) => updateEntry(index, 'proxyUrl', e.target.value)}
                                        disabled={controlsDisabled}
                                        className={`input ${styles.keyTableInput}`}
                                        placeholder={t('ai_providers.openai_proxy_placeholder')}
                                    />
                                </div>

                                {/* 操作按钮 */}
                                <div className={styles.keyTableColAction}>
                                    <Button
                                        variant='secondary'
                                        size='sm'
                                        onClick={() => void testSingleKey(index)}
                                        disabled={controlsDisabled || !canTestKey}
                                        loading={keyStatus === 'loading'}
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
                                </div>
                            </div>
                        )
                    })}
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
                <Input
                    label={t('ai_providers.openai_add_modal_name_label')}
                    value={form.name}
                    onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                    disabled={controlsDisabled}
                />
                <PriorityField form={form} setForm={setForm} disabled={controlsDisabled} />
                <PrefixField form={form} setForm={setForm} disabled={controlsDisabled} />
                <Input
                    label={t('ai_providers.openai_add_modal_url_label')}
                    value={form.baseUrl}
                    onChange={(e) => setForm((prev) => ({ ...prev, baseUrl: e.target.value }))}
                    disabled={controlsDisabled}
                />

                <HeadersField
                    entries={form.headers}
                    onChange={(entries) => setForm((prev) => ({ ...prev, headers: entries }))}
                    disabled={controlsDisabled}
                />

                <ModelConfigSection
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
                        isTesting={isTestingKeys}
                        disabled={controlsDisabled}
                        i18nPrefix='ai_providers.openai'
                        onTest={() => void testAllKeys()}
                        testButtonDisabled={!hasConfiguredModels || !hasTestableKeys}
                        testButtonLabel={t('ai_providers.openai_test_all_action')}
                        testButtonTitle={t('ai_providers.openai_test_all_hint')}
                    />
                </ModelConfigSection>

                <div className={styles.keyEntriesSection}>
                    <div className={styles.keyEntriesHeader}>
                        <label
                            className={styles.keyEntriesTitle}>{t('ai_providers.openai_add_modal_keys_label')}</label>
                        <span className={styles.keyEntriesHint}>{t('ai_providers.openai_keys_hint')}</span>
                    </div>
                    {renderKeyEntries(form.apiKeyEntries)}
                </div>
            </div>
        </ProviderEditShell>
    )
}
