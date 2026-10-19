import type {OpenAIFormState} from '@/components/providers/types'
import {buildApiKeyEntry} from '@/components/providers/utils'
import {entriesToModels, getModelEntriesValidationKey, modelsToEntries} from '@/components/ui/modelInputListUtils'
import {normalizeModelEntriesForSignature} from '@/hooks/useProviderEditForm'
import {useProviderEditLayout} from '@/hooks/useProviderEditLayout'
import {providersApi} from '@/services/api'
import {useConfigStore, useNotificationStore, useOpenAIEditDraftStore} from '@/stores'
import type {KeyTestStatus} from '@/stores/useOpenAIEditDraftStore'
import type {ApiKeyEntry, OpenAIProviderConfig} from '@/types'
import {getCredentialWeightValidationKey} from '@/utils/credentialWeight'
import {getCredentialRetryValidationKey, getRequestScopedErrorsValidationKey} from '@/utils/credentialOverrides'
import {buildHeaderObject, headersToEntries, normalizeHeaderEntries} from '@/utils/headers'
import {getErrorMessage} from '@/utils/helpers'
import type {ModelInfo} from '@/utils/models'
import type {Dispatch, SetStateAction} from 'react'
import {useCallback} from 'react'
import {useTranslation} from 'react-i18next'
import {Outlet} from 'react-router-dom'

export type OpenAIEditOutletContext = {
    hasIndexParam: boolean
    editIndex: number | null
    invalidIndexParam: boolean
    invalidIndex: boolean
    disableControls: boolean
    loading: boolean
    saving: boolean
    form: OpenAIFormState
    setForm: Dispatch<SetStateAction<OpenAIFormState>>
    testModel: string
    setTestModel: Dispatch<SetStateAction<string>>
    testStatus: 'idle' | 'loading' | 'success' | 'error'
    setTestStatus: Dispatch<SetStateAction<'idle' | 'loading' | 'success' | 'error'>>
    testMessage: string
    setTestMessage: Dispatch<SetStateAction<string>>
    keyTestStatuses: KeyTestStatus[]
    setDraftKeyTestStatus: (keyIndex: number, status: KeyTestStatus) => void
    setDraftKeyTestStatuses: (statuses: KeyTestStatus[]) => void
    resetDraftKeyTestStatuses: (count: number) => void
    availableModels: string[]
    handleBack: () => void
    handleSave: () => Promise<void>
    mergeDiscoveredModels: (selectedModels: ModelInfo[]) => void
}

/* ------------------------------------------------------------------ */
/*  Signature helpers                                                  */
/* ------------------------------------------------------------------ */

const normalizeKeyHeaders = (headers: ApiKeyEntry['headers']) => {
    if (!headers || typeof headers !== 'object') {
        return []
    }
    return Object.entries(headers)
                 .map(([key, value]) => ({ key: String(key ?? '').trim(), value: String(value ?? '').trim() }))
                 .filter((entry) => entry.key || entry.value)
                 .sort((a, b) => {
                     const byKey = a.key.toLowerCase().localeCompare(b.key.toLowerCase())
                     if (byKey !== 0) {
                         return byKey
                     }
                     return a.value.localeCompare(b.value)
                 })
}

const normalizeApiKeyEntries = (entries: ApiKeyEntry[]) =>
    (entries ?? []).reduce<
        Array<{
            apiKey: string
            proxyUrl: string
            authIndex: string
            weight: number | null
            headers: Array<{ key: string; value: string }>
        }>
    >((acc, entry) => {
        const apiKey    = String(entry?.apiKey ?? '').trim()
        const proxyUrl  = String(entry?.proxyUrl ?? '').trim()
        const authIndex = String(entry?.authIndex ?? '').trim()
        const headers   = normalizeKeyHeaders(entry?.headers)
        const weight    = entry?.weight !== undefined && Number.isFinite(entry.weight) ? entry.weight : null
        if (!apiKey && !proxyUrl && !authIndex && weight === null && headers.length === 0) {
            return acc
        }
        acc.push({ apiKey, proxyUrl, authIndex, weight, headers })
        return acc
    }, [])

const buildOpenAISignature = (form: OpenAIFormState, _testModel: string) =>
    JSON.stringify({
                       name: String(form.name ?? '').trim(),
                       priority: form.priority !== undefined && Number.isFinite(form.priority) ?
                                 Math.trunc(form.priority) :
                                 null,
                       prefix: String(form.prefix ?? '').trim(),
                       baseUrl: String(form.baseUrl ?? '').trim(),
                       disabled: Boolean(form.disabled),
                       supportPromptCacheKey: Boolean(form.supportPromptCacheKey),
                       disableCooling: form.disableCooling ?? null,
                       requestRetry: form.requestRetry?.toString() ?? null,
                       requestScopedErrors: form.requestScopedErrors ?? null,
                       authIndex: String(form.authIndex ?? '').trim(),
                       headers: normalizeHeaderEntries(form.headers),
                       apiKeyEntries: normalizeApiKeyEntries(form.apiKeyEntries),
                       models: normalizeModelEntriesForSignature(form.modelEntries),
                   })

const buildEmptyForm = (): OpenAIFormState => ({
    name: '',
    priority: undefined,
    prefix: '',
    baseUrl: '',
    headers: [],
    authIndex: undefined,
    apiKeyEntries: [buildApiKeyEntry()],
    modelEntries: [{ name: '', alias: '' }],
    disabled: false,
    supportPromptCacheKey: false,
})

/* ------------------------------------------------------------------ */
/*  Component                                                          */

/* ------------------------------------------------------------------ */

export function AiProvidersOpenAIEditLayout() {
    const { t }                = useTranslation()
    const { showNotification } = useNotificationStore()
    const updateConfigValue    = useConfigStore((state) => state.updateConfigValue)

    /* ---- OpenAI-specific draft store selectors (keyTestStatuses) ---- */
    const draftStore                   = useOpenAIEditDraftStore
    const rawDrafts                    = draftStore((state) => state.drafts)
    const rawSetDraftKeyTestStatus     = draftStore((state) => state.setDraftKeyTestStatus)
    const rawSetDraftKeyTestStatuses   = draftStore((state) => state.setDraftKeyTestStatuses)
    const rawResetDraftKeyTestStatuses = draftStore((state) => state.resetDraftKeyTestStatuses)

    const buildEmptyDraftInit = useCallback(
        () => ({
            form: buildEmptyForm(),
            testModel: '',
            testStatus: 'idle' as const,
            testMessage: '',
            keyTestStatuses: [] as KeyTestStatus[],
        }),
        [],
    )

    const seedDraftInit = useCallback((data: OpenAIProviderConfig) => {
        const modelEntries                = modelsToEntries(data.models)
        const seededForm: OpenAIFormState = {
            name: data.name,
            priority: data.priority,
            disableCooling: data.disableCooling,
            requestRetry: data.requestRetry,
            requestScopedErrors: data.requestScopedErrors,
            prefix: data.prefix ?? '',
            baseUrl: data.baseUrl,
            headers: headersToEntries(data.headers),
            authIndex: data.authIndex,
            modelEntries,
            apiKeyEntries: data.apiKeyEntries?.length
                           ?
                           data.apiKeyEntries.map((entry) => buildApiKeyEntry({
                                                                                  ...entry,
                                                                                  authIndex: entry.authIndex,
                                                                              }))
                           :
                [buildApiKeyEntry({ authIndex: data.authIndex })],
            disabled: data.disabled ?? false,
            supportPromptCacheKey: Boolean(data.supportPromptCacheKey),
        }

        const available        = modelEntries.map((entry) => entry.name.trim()).filter(Boolean)
        const initialTestModel = available[0] || ''

        return {
            form: seededForm,
            testModel: initialTestModel,
            testStatus: 'idle' as const,
            testMessage: '',
            keyTestStatuses: [] as KeyTestStatus[],
        }
    }, [])

    const onSave = useCallback(
        async (ctx: {
            isCurrent: () => boolean
            form: OpenAIFormState
            testModel: string
            editIndex: number | null
            configs: OpenAIProviderConfig[]
            setConfigs: Dispatch<SetStateAction<OpenAIProviderConfig[]>>
            setSaving: Dispatch<SetStateAction<boolean>>
            allowNextNavigation: () => void
            updateBaselineSignature: (signature: string) => void
            handleBack: () => void
        }) => {
            if (!ctx.isCurrent()) {
                return
            }
            const { form, testModel, editIndex, configs, setConfigs, setSaving, handleBack } = ctx
            const name                                                                       = form.name.trim()
            const baseUrl                                                                    = form.baseUrl.trim()

            if (!name || !baseUrl) {
                showNotification(t('notification.openai_provider_required'), 'error')
                return
            }
            const retryError = getCredentialRetryValidationKey(form.requestRetry)
            if (retryError) {
                showNotification(t(retryError), 'error')
                return
            }
            const modelError = getModelEntriesValidationKey(form.modelEntries)
            if (modelError) {
                showNotification(t(modelError), 'error')
                return
            }
            const rulesError = getRequestScopedErrorsValidationKey(
                form.requestScopedErrors, editIndex !== null ? configs[editIndex]?.requestScopedErrors : undefined)
            if (rulesError) {
                showNotification(t(rulesError), 'error')
                return
            }
            const weightError = form.apiKeyEntries
                                    .map((entry) => getCredentialWeightValidationKey(entry.weight))
                                    .find(Boolean)
            if (weightError) {
                showNotification(t(weightError), 'error')
                return
            }

            setSaving(true)
            try {
                const payload: OpenAIProviderConfig = {
                    name,
                    prefix: form.prefix?.trim() || undefined,
                    baseUrl,
                    disabled: form.disabled,
                    supportPromptCacheKey: Boolean(form.supportPromptCacheKey),
                    disableCooling: form.disableCooling,
                    requestRetry: form.requestRetry,
                    requestScopedErrors: form.requestScopedErrors,
                    headers: buildHeaderObject(form.headers),
                    apiKeyEntries: form.apiKeyEntries.map((entry: ApiKeyEntry) => ({
                        apiKey: entry.apiKey.trim(),
                        proxyUrl: entry.proxyUrl?.trim() || undefined,
                        headers: entry.headers,
                        authIndex: entry.authIndex?.trim() || undefined,
                        weight: entry.weight,
                    })),
                }
                if (form.priority !== undefined && Number.isFinite(form.priority)) {
                    payload.priority = Math.trunc(form.priority)
                }
                const models = entriesToModels(form.modelEntries)
                if (models.length) {
                    payload.models = models
                }

                let localProviders: OpenAIProviderConfig[]
                if (editIndex !== null) {
                    const existing = configs[editIndex]
                    if (!existing) {
                        showNotification(
                            `${t('notification.update_failed')}: ${t('common.invalid_provider_index')}`,
                            'error',
                        )
                        return
                    }
                    await providersApi.patchOpenAIProvider(editIndex, payload, existing)
                    localProviders = configs.map((item, index) => index === editIndex ? payload : item)
                } else {
                    await providersApi.createOpenAIProvider(payload)
                    localProviders = [...configs, payload]
                }
                if (!ctx.isCurrent()) {
                    return
                }

                showNotification(
                    editIndex !== null
                    ? t('notification.openai_provider_updated')
                    : t('notification.openai_provider_added'),
                    'success',
                )

                let syncedProviders = localProviders
                try {
                    syncedProviders = await providersApi.getOpenAIProviders()
                } catch (refreshError: unknown) {
                    if (!ctx.isCurrent()) {
                        return
                    }
                    const message = refreshError instanceof Error ? refreshError.message : ''
                    showNotification(`${t('notification.refresh_failed')}: ${message}`, 'warning')
                }
                if (!ctx.isCurrent()) {
                    return
                }

                setConfigs(syncedProviders)
                updateConfigValue('openai-compatibility', syncedProviders)
                ctx.allowNextNavigation()
                ctx.updateBaselineSignature(buildOpenAISignature(form, testModel))
                handleBack()
            } catch (err: unknown) {
                if (!ctx.isCurrent()) {
                    return
                }
                showNotification(`${t('notification.update_failed')}: ${getErrorMessage(err)}`, 'error')
            } finally {
                if (ctx.isCurrent()) {
                    setSaving(false)
                }
            }
        },
        [showNotification, t, updateConfigValue],
    )

    const layout = useProviderEditLayout({
                                             loadConfigs: providersApi.getOpenAIProviders,
                                             draftKeyPrefix: 'openai',
                                             routePrefix: '/credentials/openai',
                                             useDraftStore: draftStore,
                                             buildEmptyDraftInit,
                                             buildSignature: buildOpenAISignature,
                                             seedDraftInit,
                                             mergeNotificationKey: 'ai_providers.openai_models_fetch_added',
                                             onSave,
                                         })

    /* ---- OpenAI-specific: keyTestStatuses bound to current draftKey ---- */
    const { draftKey, isCurrent } = layout
    const keyTestStatuses = rawDrafts[draftKey]?.keyTestStatuses ?? []

    const handleSetDraftKeyTestStatus = useCallback(
        (keyIndex: number, status: KeyTestStatus) => {
            if (isCurrent()) {
                rawSetDraftKeyTestStatus(draftKey, keyIndex, status)
            }
        },
        [draftKey, isCurrent, rawSetDraftKeyTestStatus],
    )

    const handleSetDraftKeyTestStatuses = useCallback(
        (statuses: KeyTestStatus[]) => {
            if (isCurrent()) {
                rawSetDraftKeyTestStatuses(draftKey, statuses)
            }
        },
        [draftKey, isCurrent, rawSetDraftKeyTestStatuses],
    )

    const handleResetDraftKeyTestStatuses = useCallback(
        (count: number) => {
            if (isCurrent()) {
                rawResetDraftKeyTestStatuses(draftKey, count)
            }
        },
        [draftKey, isCurrent, rawResetDraftKeyTestStatuses],
    )

    return (
        <Outlet
            context={
                {
                    hasIndexParam: layout.hasIndexParam,
                    editIndex: layout.editIndex,
                    invalidIndexParam: layout.invalidIndexParam,
                    invalidIndex: layout.invalidIndex,
                    disableControls: layout.disableControls,
                    loading: layout.loading,
                    saving: layout.saving,
                    form: layout.form,
                    setForm: layout.setForm,
                    testModel: layout.testModel,
                    setTestModel: layout.setTestModel,
                    testStatus: layout.testStatus,
                    setTestStatus: layout.setTestStatus,
                    testMessage: layout.testMessage,
                    setTestMessage: layout.setTestMessage,
                    keyTestStatuses,
                    setDraftKeyTestStatus: handleSetDraftKeyTestStatus,
                    setDraftKeyTestStatuses: handleSetDraftKeyTestStatuses,
                    resetDraftKeyTestStatuses: handleResetDraftKeyTestStatuses,
                    availableModels: layout.availableModels,
                    handleBack: layout.handleBack,
                    handleSave: layout.handleSave,
                    mergeDiscoveredModels: layout.mergeDiscoveredModels,
                } satisfies OpenAIEditOutletContext
            }
        />
    )
}
