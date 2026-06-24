import {ModelConfigSection} from '@/components/common/ModelConfigSection'
import {ModelTestPanel} from '@/components/common/ModelTestPanel'
import {buildClaudeMessagesEndpoint, parseTextList} from '@/components/providers/utils'
import {Input} from '@/components/ui/Input'
import {Select} from '@/components/ui/Select'
import {ToggleSwitch} from '@/components/ui/ToggleSwitch'
import {useEdgeSwipeBack} from '@/hooks/useEdgeSwipeBack'
import {useEscapeKey} from '@/hooks/useEscapeKey'
import {useModelSelectOptions} from '@/hooks/useModelSelectOptions'
import {apiCallApi, getApiCallErrorMessage} from '@/services/api'
import {useNotificationStore} from '@/stores'
import {buildHeaderObject, hasHeader} from '@/utils/headers'
import {getErrorMessage} from '@/utils/helpers'
import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {useNavigate, useOutletContext} from 'react-router-dom'
import type {ClaudeEditOutletContext} from './AiProvidersClaudeEditLayout'
import styles from './ProviderEditForm.module.scss'
import {ProviderEditShell} from './ProviderEditShell'
import {ExcludedModelsField, HeadersField, PrefixField, PriorityField} from './ProviderFormFields'

const CLAUDE_TEST_TIMEOUT_MS    = 30_000
const DEFAULT_ANTHROPIC_VERSION = '2023-06-01'

const resolveBearerTokenFromAuthorization = (headers: Record<string, string>): string => {
    const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === 'authorization')
    if (!entry) {
        return ''
    }
    const value = String(entry[1] ?? '').trim()
    if (!value) {
        return ''
    }
    const match = value.match(/^Bearer\s+(?<token>.+)$/i)
    return match?.groups?.token?.trim() || ''
}

export function AiProvidersClaudeEditPage() {
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
              availableModels,
              handleBack,
              handleSave,
          }                    = useOutletContext<ClaudeEditOutletContext>()

    const title = hasIndexParam ? t('ai_providers.claude_edit_modal_title') : t('ai_providers.claude_add_modal_title')

    const swipeRef                  = useEdgeSwipeBack({ onBack: handleBack })
    const [isTesting, setIsTesting] = useState(false)
    const lastCloakConfigRef        = useRef<typeof form.cloak>(null)

    useEscapeKey(handleBack)

    useEffect(() => {
        if (!form.cloak) {
            return
        }
        lastCloakConfigRef.current = form.cloak
    }, [form.cloak])

    const canSave = !disableControls && !loading && !saving && !invalidIndexParam && !invalidIndex && !isTesting

    const modelSelectOptions = useModelSelectOptions(form.modelEntries)
    const controlsDisabled   = saving || disableControls || isTesting

    const cloakModeOptions = useMemo(
        () => [
            { value: 'auto', label: t('ai_providers.claude_cloak_mode_auto') },
            { value: 'always', label: t('ai_providers.claude_cloak_mode_always') },
            { value: 'never', label: t('ai_providers.claude_cloak_mode_never') },
        ],
        [t],
    )

    const resolvedCloakMode = useMemo(() => {
        const mode = (form.cloak?.mode ?? '').trim().toLowerCase()
        if (!mode) {
            return 'auto'
        }
        if (mode === 'provider') {
            return 'auto'
        }
        if (mode === 'auto' || mode === 'always' || mode === 'never') {
            return mode
        }
        return 'auto'
    }, [form.cloak?.mode])

    const connectivityConfigSignature = useMemo(() => {
        const headersSignature = form.headers.map((entry) => `${entry.key.trim()}:${entry.value.trim()}`).join('|')
        const modelsSignature  = form.modelEntries.map((entry) => `${entry.name.trim()}:${entry.alias.trim()}`)
                                     .join('|')
        return [
            form.apiKey.trim(),
            form.baseUrl?.trim() ?? '',
            testModel.trim(),
            headersSignature,
            modelsSignature,
        ].join('||')
    }, [form.apiKey, form.baseUrl, form.headers, form.modelEntries, testModel])

    const previousConnectivityConfigRef = useRef(connectivityConfigSignature)

    useEffect(() => {
        if (previousConnectivityConfigRef.current === connectivityConfigSignature) {
            return
        }
        previousConnectivityConfigRef.current = connectivityConfigSignature
        setTestStatus('idle')
        setTestMessage('')
    }, [connectivityConfigSignature, setTestMessage, setTestStatus])

    const openClaudeModelDiscovery = () => {
        navigate('models')
    }

    const runClaudeConnectivityTest = useCallback(async () => {
        if (isTesting) {
            return
        }

        const modelName = testModel.trim() || availableModels[0] || ''
        if (!modelName) {
            const message = t('ai_providers.claude_test_model_required')
            setTestStatus('error')
            setTestMessage(message)
            showNotification(message, 'error')
            return
        }

        const customHeaders           = buildHeaderObject(form.headers)
        const apiKey                  = form.apiKey.trim()
        const hasApiKeyHeader         = hasHeader(customHeaders, 'x-api-key')
        const apiKeyFromAuthorization = resolveBearerTokenFromAuthorization(customHeaders)
        const resolvedApiKey          = apiKey || apiKeyFromAuthorization

        if (!resolvedApiKey && !hasApiKeyHeader) {
            const message = t('ai_providers.claude_test_key_required')
            setTestStatus('error')
            setTestMessage(message)
            showNotification(message, 'error')
            return
        }

        const endpoint = buildClaudeMessagesEndpoint(form.baseUrl ?? '')
        if (!endpoint) {
            const message = t('ai_providers.claude_test_endpoint_invalid')
            setTestStatus('error')
            setTestMessage(message)
            showNotification(message, 'error')
            return
        }

        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            ...customHeaders,
        }

        if (!hasHeader(headers, 'anthropic-version')) {
            headers['anthropic-version'] = DEFAULT_ANTHROPIC_VERSION
        }
        if (!Object.prototype.hasOwnProperty.call(headers, 'Anthropic-Version')) {
            headers['Anthropic-Version'] = headers['anthropic-version'] ?? DEFAULT_ANTHROPIC_VERSION
        }

        if (!hasApiKeyHeader && resolvedApiKey) {
            headers['x-api-key'] = resolvedApiKey
        }
        if (!Object.prototype.hasOwnProperty.call(headers, 'X-Api-Key') && resolvedApiKey) {
            headers['X-Api-Key'] = resolvedApiKey
        }

        setIsTesting(true)
        setTestStatus('loading')
        setTestMessage(t('ai_providers.claude_test_running'))

        try {
            const result = await apiCallApi.request(
                {
                    method: 'POST',
                    url: endpoint,
                    header: headers,
                    data: JSON.stringify({
                                             model: modelName,
                                             max_tokens: 8,
                                             messages: [{ role: 'user', content: 'Hi' }],
                                         }),
                },
                { timeout: CLAUDE_TEST_TIMEOUT_MS },
            )

            if (result.statusCode < 200 || result.statusCode >= 300) {
                const detail   = getApiCallErrorMessage(result) || t('common.unknown_error')
                const errorMsg = `${t('ai_providers.claude_test_failed')}: ${detail}`
                setTestStatus('error')
                setTestMessage(errorMsg)
                showNotification(errorMsg, 'error')
            } else {
                const message = t('ai_providers.claude_test_success')
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
                                    ? t('ai_providers.claude_test_timeout', { seconds: CLAUDE_TEST_TIMEOUT_MS / 1000 })
                                    : `${t('ai_providers.claude_test_failed')}: ${message || t('common.unknown_error')}`
            setTestStatus('error')
            setTestMessage(resolvedMessage)
            showNotification(resolvedMessage, 'error')
        } finally {
            setIsTesting(false)
        }
    }, [
                                                      availableModels,
                                                      form.apiKey,
                                                      form.baseUrl,
                                                      form.headers,
                                                      isTesting,
                                                      setTestMessage,
                                                      setTestStatus,
                                                      showNotification,
                                                      t,
                                                      testModel,
                                                  ])

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
                    label={t('ai_providers.claude_add_modal_key_label')}
                    value={form.apiKey}
                    onChange={(e) => setForm((prev) => ({ ...prev, apiKey: e.target.value }))}
                    disabled={controlsDisabled}
                    secret
                />
                <PriorityField form={form} setForm={setForm} disabled={controlsDisabled} />
                <PrefixField form={form} setForm={setForm} disabled={controlsDisabled} />
                <Input
                    label={t('ai_providers.claude_add_modal_url_label')}
                    value={form.baseUrl ?? ''}
                    onChange={(e) => setForm((prev) => ({ ...prev, baseUrl: e.target.value }))}
                    disabled={controlsDisabled}
                />
                <Input
                    label={t('ai_providers.claude_add_modal_proxy_label')}
                    value={form.proxyUrl ?? ''}
                    onChange={(e) => setForm((prev) => ({ ...prev, proxyUrl: e.target.value }))}
                    disabled={controlsDisabled}
                />
                <HeadersField
                    entries={form.headers}
                    onChange={(entries) => setForm((prev) => ({ ...prev, headers: entries }))}
                    disabled={controlsDisabled}
                />

                <ModelConfigSection
                    title={t('ai_providers.claude_models_label')}
                    hint={t('ai_providers.claude_models_hint')}
                    addLabel={t('ai_providers.claude_models_add_btn')}
                    fetchLabel={t('ai_providers.claude_models_fetch_button')}
                    entries={form.modelEntries}
                    setForm={setForm}
                    onFetchModels={openClaudeModelDiscovery}
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
                        i18nPrefix='ai_providers.claude'
                        onTest={() => void runClaudeConnectivityTest()}
                    />
                </ModelConfigSection>

                <ExcludedModelsField
                    value={form.excludedText}
                    onChange={(value) => setForm((prev) => ({ ...prev, excludedText: value }))}
                    disabled={controlsDisabled}
                />

                <div className={styles.modelConfigSection}>
                    <div className={styles.modelConfigHeader}>
                        <label className={styles.modelConfigTitle}>{t('ai_providers.claude_cloak_title')}</label>
                        <div className={styles.modelConfigToolbar}>
                            <ToggleSwitch
                                checked={Boolean(form.cloak)}
                                onChange={(enabled) =>
                                    setForm((prev) => {
                                        if (!enabled) {
                                            if (prev.cloak) {
                                                lastCloakConfigRef.current = prev.cloak
                                            }
                                            return { ...prev, cloak: undefined }
                                        }

                                        const restored = prev.cloak ??
                                                         lastCloakConfigRef.current ?? {
                                                mode: 'auto',
                                                strictMode: false,
                                                sensitiveWords: [],
                                            }
                                        const mode     = String(restored.mode ?? 'auto').trim() || 'auto'
                                        return {
                                            ...prev,
                                            cloak: {
                                                mode,
                                                strictMode: restored.strictMode ?? false,
                                                sensitiveWords: restored.sensitiveWords ?? [],
                                            },
                                        }
                                    })
                                }
                                disabled={controlsDisabled}
                                ariaLabel={t('ai_providers.claude_cloak_toggle_aria')}
                                label={t('ai_providers.claude_cloak_toggle_label')}
                            />
                        </div>
                    </div>
                    <div className={styles.sectionHint}>{t('ai_providers.claude_cloak_hint')}</div>

                    {form.cloak ? (
                        <>
                            <div className='form-group'>
                                <label>{t('ai_providers.claude_cloak_mode_label')}</label>
                                <Select
                                    value={resolvedCloakMode}
                                    options={cloakModeOptions}
                                    onChange={(value) =>
                                        setForm((prev) => ({
                                            ...prev,
                                            cloak: {
                                                ...(prev.cloak ?? {}),
                                                mode: value,
                                            },
                                        }))
                                    }
                                    ariaLabel={t('ai_providers.claude_cloak_mode_label')}
                                    disabled={controlsDisabled}
                                />
                                <div className='hint'>{t('ai_providers.claude_cloak_mode_hint')}</div>
                            </div>

                            <div className='form-group'>
                                <label>{t('ai_providers.claude_cloak_strict_label')}</label>
                                <ToggleSwitch
                                    checked={Boolean(form.cloak.strictMode)}
                                    onChange={(value) =>
                                        setForm((prev) => ({
                                            ...prev,
                                            cloak: {
                                                ...(prev.cloak ?? {}),
                                                strictMode: value,
                                            },
                                        }))
                                    }
                                    disabled={controlsDisabled}
                                    ariaLabel={t('ai_providers.claude_cloak_strict_label')}
                                />
                                <div className='hint'>{t('ai_providers.claude_cloak_strict_hint')}</div>
                            </div>

                            <div className='form-group'>
                                <label>{t('ai_providers.claude_cloak_sensitive_words_label')}</label>
                                <textarea
                                    className='input'
                                    placeholder={t('ai_providers.claude_cloak_sensitive_words_placeholder')}
                                    value={(form.cloak.sensitiveWords ?? []).join('\n')}
                                    onChange={(e) => {
                                        const nextWords = parseTextList(e.target.value)
                                        setForm((prev) => ({
                                            ...prev,
                                            cloak: {
                                                ...(prev.cloak ?? {}),
                                                sensitiveWords: nextWords.length ? nextWords : undefined,
                                            },
                                        }))
                                    }}
                                    rows={3}
                                    disabled={controlsDisabled}
                                />
                                <div className='hint'>{t('ai_providers.claude_cloak_sensitive_words_hint')}</div>
                            </div>
                        </>
                    ) : null}
                </div>
            </div>
        </ProviderEditShell>
    )
}
