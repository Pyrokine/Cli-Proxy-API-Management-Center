import type {ProviderFormState} from '@/components/providers/types'
import {excludedModelsToText, parseTextList} from '@/components/providers/utils'
import {entriesToModels, modelsToEntries} from '@/components/ui/modelInputListUtils'
import {normalizeModelEntriesForSignature} from '@/hooks/useProviderEditForm'
import {useProviderEditLayout} from '@/hooks/useProviderEditLayout'
import {findProviderConfigIndexByAuthIndex, providersApi} from '@/services/api'
import {normalizeClaudeFingerprintProfile} from '@/services/api/transformers'
import {useClaudeEditDraftStore, useConfigStore, useNotificationStore} from '@/stores'
import type {ProviderKeyConfig} from '@/types'
import {getCredentialWeightValidationKey} from '@/utils/credentialWeight'
import {getCredentialRetryValidationKey} from '@/utils/credentialOverrides'
import {buildHeaderObject, getChangedHeaderNames, headersToEntries, normalizeHeaderEntries} from '@/utils/headers'
import {getErrorMessage} from '@/utils/helpers'
import type {ModelInfo} from '@/utils/models'
import type {Dispatch, SetStateAction} from 'react'
import {useCallback, useMemo} from 'react'
import {useTranslation} from 'react-i18next'
import {Outlet} from 'react-router-dom'

type TestStatus = 'idle' | 'loading' | 'success' | 'error'

export type ClaudeEditOutletContext = {
    hasIndexParam: boolean
    editIndex: number | null
    invalidIndexParam: boolean
    invalidIndex: boolean
    disableControls: boolean
    loading: boolean
    saving: boolean
    apiKeyIsMasked: boolean
    maskedCredentialHeaderNames: string[]
    credentialIdentityAvailable: boolean
    form: ProviderFormState
    setForm: Dispatch<SetStateAction<ProviderFormState>>
    updateApiKey: (value: string) => void
    updateHeaders: (entries: ProviderFormState['headers']) => void
    testModel: string
    setTestModel: Dispatch<SetStateAction<string>>
    testStatus: TestStatus
    setTestStatus: Dispatch<SetStateAction<TestStatus>>
    testMessage: string
    setTestMessage: Dispatch<SetStateAction<string>>
    availableModels: string[]
    handleBack: () => void
    handleSave: () => Promise<void>
    mergeDiscoveredModels: (selectedModels: ModelInfo[]) => void
}

/* ------------------------------------------------------------------ */
/*  Signature helpers                                                  */
/* ------------------------------------------------------------------ */

const normalizeCloakConfig = (cloak: ProviderFormState['cloak']) => {
    if (!cloak) {
        return null
    }
    const mode           =
              String(cloak.mode ?? '')
                  .trim()
                  .toLowerCase() || 'auto'
    const strictMode     = Boolean(cloak.strictMode)
    const sensitiveWords = Array.isArray(cloak.sensitiveWords)
                           ? cloak.sensitiveWords.map((word) => String(word ?? '').trim()).filter(Boolean)
                           : []
    return {
        mode,
        strictMode,
        sensitiveWords: sensitiveWords.length ? sensitiveWords : null,
    }
}

const buildClaudeSignature = (form: ProviderFormState, _testModel: string) =>
    JSON.stringify({
                       apiKey: String(form.apiKey ?? '').trim(),
                       priority: form.priority !== undefined && Number.isFinite(form.priority) ?
                                 Math.trunc(form.priority) :
                                 null,
                       weight: form.weight !== undefined && Number.isFinite(form.weight) ? form.weight : null,
                       disableCooling: form.disableCooling ?? null,
                       requestRetry: form.requestRetry?.toString() ?? null,
                       prefix: String(form.prefix ?? '').trim(),
                       baseUrl: String(form.baseUrl ?? '').trim(),
                       proxyUrl: String(form.proxyUrl ?? '').trim(),
                       headers: normalizeHeaderEntries(form.headers),
                       models: normalizeModelEntriesForSignature(form.modelEntries, { aliasFallbackToName: true }),
                       excludedModels: parseTextList(form.excludedText ?? ''),
                       cloak: normalizeCloakConfig(form.cloak),
                       fingerprintProfile: normalizeClaudeFingerprintProfile(form.fingerprintProfile),
                   })

const buildEmptyForm = (): ProviderFormState => ({
    apiKey: '',
    fingerprintProfile: '',
    priority: undefined,
    weight: undefined,
    prefix: '',
    baseUrl: '',
    proxyUrl: '',
    headers: [],
    models: [],
    excludedModels: [],
    modelEntries: [{ name: '', alias: '' }],
    excludedText: '',
})

/* ------------------------------------------------------------------ */
/*  Component                                                          */

/* ------------------------------------------------------------------ */

export function AiProvidersClaudeEditLayout() {
    const { t }                = useTranslation()
    const { showNotification } = useNotificationStore()
    const updateConfigValue    = useConfigStore((state) => state.updateConfigValue)

    const buildEmptyDraftInit = useCallback(
        () => ({
            form: buildEmptyForm(),
            testModel: '',
            testStatus: 'idle' as const,
            testMessage: '',
            apiKeyEdited: false,
            editedCredentialHeaderNames: [],
            originalAuthIndex: '',
            originalApiKey: '',
            originalHeaders: {},
        }),
        [],
    )

    const seedDraftInit = useCallback((data: ProviderKeyConfig) => {
        const seededForm: ProviderFormState = {
            ...data,
            fingerprintProfile: normalizeClaudeFingerprintProfile(data.fingerprintProfile),
            headers: headersToEntries(data.headers),
            modelEntries: modelsToEntries(data.models),
            excludedText: excludedModelsToText(data.excludedModels),
        }
        const available                     = seededForm.modelEntries.map((e) => e.name.trim()).filter(Boolean)
        return {
            form: seededForm,
            testModel: available[0] || '',
            testStatus: 'idle' as const,
            testMessage: '',
            apiKeyEdited: false,
            editedCredentialHeaderNames: [],
            originalAuthIndex: data.authIndex?.trim() ?? '',
            originalApiKey: data.apiKey.trim(),
            originalHeaders: { ...(data.headers ?? {}) },
        }
    }, [])

    const onSave = useCallback(
        async (ctx: {
            form: ProviderFormState
            editIndex: number | null
            configs: ProviderKeyConfig[]
            setConfigs: Dispatch<SetStateAction<ProviderKeyConfig[]>>
            setSaving: Dispatch<SetStateAction<boolean>>
            allowNextNavigation: () => void
            updateBaselineSignature: (signature: string) => void
            handleBack: () => void
        }) => {
            const { form, editIndex, configs, setConfigs, setSaving, handleBack } = ctx
            const weightError                                                     = getCredentialWeightValidationKey(
                form.weight)
            if (weightError) {
                showNotification(t(weightError), 'error')
                return
            }

            const retryError = getCredentialRetryValidationKey(form.requestRetry)
            if (retryError) {
                showNotification(t(retryError), 'error')
                return
            }

            const fingerprintProfile = normalizeClaudeFingerprintProfile(form.fingerprintProfile)
            if (fingerprintProfile !== '' && fingerprintProfile !== 'claude-code-cli') {
                showNotification(t('ai_providers.claude_fingerprint_profile_unknown', { value: fingerprintProfile }), 'error')
                return
            }

            setSaving(true)
            try {
                const payload: ProviderKeyConfig = {
                    apiKey: form.apiKey.trim(),
                    priority: form.priority !== undefined ? Math.trunc(form.priority) : undefined,
                    weight: form.weight,
                    disableCooling: form.disableCooling,
                    requestRetry: form.requestRetry,
                    prefix: form.prefix?.trim() || undefined,
                    baseUrl: (form.baseUrl ?? '').trim() || undefined,
                    proxyUrl: form.proxyUrl?.trim() || undefined,
                    headers: buildHeaderObject(form.headers),
                    models: entriesToModels(form.modelEntries).map((model) => ({
                        ...model,
                        alias: model.alias ?? model.name,
                    })),
                    excludedModels: parseTextList(form.excludedText),
                    cloak: form.cloak,
                    fingerprintProfile,
                }

                let localList: ProviderKeyConfig[]
                if (editIndex !== null) {
                    const stableIndex = findProviderConfigIndexByAuthIndex(configs, form.authIndex ?? '')
                    if (stableIndex < 0) {
                        showNotification(
                            `${t('notification.update_failed')}: ${t('common.invalid_provider_index')}`,
                            'error',
                        )
                        return
                    }
                    const existing = configs[stableIndex]
                    await providersApi.patchClaudeConfig(stableIndex, payload, existing)
                    localList = configs.map((item, index) => index === stableIndex ? {
                        ...existing,
                        ...payload,
                        authIndex: existing.authIndex,
                    } : item)
                } else {
                    await providersApi.createClaudeConfig(payload)
                    localList = [...configs, payload]
                }

                showNotification(
                    editIndex !== null
                    ? t('notification.claude_config_updated')
                    : t('notification.claude_config_added'),
                    'success',
                )

                let nextList = localList
                try {
                    nextList = await providersApi.getClaudeConfigs()
                } catch (refreshError: unknown) {
                    const message = refreshError instanceof Error ? refreshError.message : ''
                    showNotification(`${t('notification.refresh_failed')}: ${message}`, 'warning')
                }
                setConfigs(nextList)
                updateConfigValue('claude-api-key', nextList)
                ctx.allowNextNavigation()
                ctx.updateBaselineSignature(buildClaudeSignature(form, ''))
                handleBack()
            } catch (err: unknown) {
                showNotification(`${t('notification.update_failed')}: ${getErrorMessage(err)}`, 'error')
            } finally {
                setSaving(false)
            }
        },
        [showNotification, t, updateConfigValue],
    )

    const layout                      = useProviderEditLayout({
                                                                  loadConfigs: providersApi.getClaudeConfigs,
                                                                  draftKeyPrefix: 'claude',
                                                                  routePrefix: '/credentials/claude',
                                                                  useDraftStore: useClaudeEditDraftStore,
                                                                  buildEmptyDraftInit,
                                                                  buildSignature: buildClaudeSignature,
                                                                  seedDraftInit,
                                                                  mergeNotificationKey: 'ai_providers.claude_models_fetch_added',
                                                                  onSave,
                                                              })
    const credentialDraft             = useClaudeEditDraftStore((state) => state.drafts[layout.draftKey])
    const markApiKeyEdited            = useClaudeEditDraftStore((state) => state.markDraftApiKeyEdited)
    const markCredentialHeadersEdited = useClaudeEditDraftStore(
        (state) => state.markDraftCredentialHeadersEdited,
    )
    const formAuthIndex               = layout.form.authIndex?.trim() ?? ''
    const stableIndex                 = findProviderConfigIndexByAuthIndex(layout.configs, formAuthIndex)
    const originalConfig              = stableIndex >= 0 ? layout.configs[stableIndex] : undefined
    const originalAuthIndex           = originalConfig?.authIndex?.trim() ?? credentialDraft?.originalAuthIndex ?? ''
    const originalApiKey              = originalConfig?.apiKey.trim() ?? credentialDraft?.originalApiKey ?? ''
    const credentialIdentityAvailable = layout.editIndex === null || Boolean(
        formAuthIndex && originalAuthIndex === formAuthIndex,
    )
    const apiKeyIsMasked              = Boolean(
        credentialIdentityAvailable &&
        formAuthIndex &&
        originalApiKey &&
        !credentialDraft?.apiKeyEdited &&
        layout.form.apiKey.trim() === originalApiKey,
    )
    const maskedCredentialHeaderNames = useMemo(() => {
        if (!credentialIdentityAvailable || !formAuthIndex) {
            return []
        }
        const editedNames     = new Set(credentialDraft?.editedCredentialHeaderNames ?? [])
        const originalHeaders = originalConfig?.headers ?? credentialDraft?.originalHeaders ?? {}
        return Object.entries(buildHeaderObject(layout.form.headers)).flatMap(([name, value]) => {
            if (editedNames.has(name.toLowerCase())) {
                return []
            }
            const original = Object.entries(originalHeaders).find(([key]) => key.toLowerCase() === name.toLowerCase())
            return original?.[1] === value ? [name] : []
        })
    }, [
                                                    credentialDraft?.editedCredentialHeaderNames,
                                                    credentialDraft?.originalHeaders,
                                                    credentialIdentityAvailable,
                                                    formAuthIndex,
                                                    layout.form.headers,
                                                    originalConfig?.headers,
                                                ])
    const draftKey                    = layout.draftKey
    const setForm                     = layout.setForm
    const currentHeaders              = layout.form.headers
    const updateApiKey                = useCallback(
        (value: string) => {
            markApiKeyEdited(draftKey)
            setForm((previous) => ({ ...previous, apiKey: value }))
        },
        [draftKey, markApiKeyEdited, setForm],
    )
    const updateHeaders               = useCallback(
        (entries: ProviderFormState['headers']) => {
            markCredentialHeadersEdited(draftKey, getChangedHeaderNames(currentHeaders, entries))
            setForm((previous) => ({ ...previous, headers: entries }))
        },
        [currentHeaders, draftKey, markCredentialHeadersEdited, setForm],
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
                    apiKeyIsMasked,
                    maskedCredentialHeaderNames,
                    credentialIdentityAvailable,
                    form: layout.form,
                    setForm: layout.setForm,
                    updateApiKey,
                    updateHeaders,
                    testModel: layout.testModel,
                    setTestModel: layout.setTestModel,
                    testStatus: layout.testStatus,
                    setTestStatus: layout.setTestStatus,
                    testMessage: layout.testMessage,
                    setTestMessage: layout.setTestMessage,
                    availableModels: layout.availableModels,
                    handleBack: layout.handleBack,
                    handleSave: layout.handleSave,
                    mergeDiscoveredModels: layout.mergeDiscoveredModels,
                } satisfies ClaudeEditOutletContext
            }
        />
    )
}
