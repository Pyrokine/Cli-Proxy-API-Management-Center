import {getModelEntriesValidationKey, type ModelEntry} from '@/components/ui/modelInputListUtils'
import {useEditPageNavigation} from '@/hooks/useEditPageNavigation'
import {useUnsavedChangesGuard} from '@/hooks/useUnsavedChangesGuard'
import {apiClient} from '@/services/api/client'
import {useAuthStore, useConfigStore, useNotificationStore} from '@/stores'
import type {CredentialOverrides, RequestScopedErrorRule} from '@/types'
import type {RawConfigSection} from '@/types/config'
import {getCredentialRetryValidationKey} from '@/utils/credentialOverrides'
import {normalizeHeaderEntries} from '@/utils/headers'
import {parseIndexParam} from '@/utils/helpers'
import {type Dispatch, type SetStateAction, useCallback, useEffect, useMemo, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {useParams} from 'react-router-dom'

export {normalizeModelEntriesForSignature} from '@/utils/modelMetadata'

// ---- Generic form state constraint ----

interface BaseFormState extends CredentialOverrides {
    requestScopedErrors?: RequestScopedErrorRule[]
    apiKey: string
    priority?: number
    weight?: number
    prefix?: string
    baseUrl?: string
    proxyUrl?: string
    headers: Array<{ key: string; value: string }>
    modelEntries: ModelEntry[]
}

// ---- Configuration for provider-specific behavior ----

export interface ProviderEditFormConfig<TForm extends BaseFormState, TConfig extends { authIndex?: string }> {
    /** Config key used in config store (e.g. 'codex-api-key') */
    configKey: RawConfigSection

    /** Build a blank form */
    buildEmptyForm: () => TForm

    /**
     * Build a deterministic signature string from the form for dirty checking.
     * Must use consistent normalization so baseline and current can be compared.
     */
    buildSignature: (form: TForm) => string

    /**
     * Load configs from server. Receives fetchConfig + extra helpers.
     * Should return the config array.
     */
    loadConfigs: (helpers: {
        fetchConfig: (key: RawConfigSection) => Promise<unknown>
        updateConfigValue: (key: RawConfigSection, value: unknown) => void
        clearCache: (key: RawConfigSection) => void
    }) => Promise<TConfig[]>

    /** Convert a stored config entry into form state */
    configToForm: (config: TConfig) => TForm

    /** Convert form state to the payload for saving */
    formToPayload: (form: TForm) => TConfig

    /** Create one provider entry without replacing the current server list. */
    createConfig: (config: TConfig) => Promise<unknown>

    /** Update one provider entry using its stable server identity when available. */
    updateConfig: (index: number, config: TConfig, original: TConfig) => Promise<unknown>

    /** Optional pre-save validation. Return an error notification key to abort, or undefined to proceed. */
    validateBeforeSave?: (form: TForm, original?: TConfig) => string | undefined

    /** Translation keys */
    i18n: {
        editTitle: string
        addTitle: string
        saveSuccessEdit: string
        saveSuccessAdd: string
    }
}

// ---- Return type ----

interface ProviderEditFormReturn<TForm extends BaseFormState, TConfig extends { authIndex?: string }> {
    // Form
    form: TForm
    setForm: Dispatch<SetStateAction<TForm>>
    configs: TConfig[]

    // State
    loading: boolean
    saving: boolean
    error: string
    isDirty: boolean

    // Index
    editIndex: number | null
    invalidIndexParam: boolean
    invalidIndex: boolean

    // Controls
    disableControls: boolean
    canSave: boolean
    disabled: boolean
    title: string

    // Actions
    handleSave: () => Promise<void>
    handleBack: () => void
    swipeRef: ReturnType<typeof useEditPageNavigation>['swipeRef']
}

/**
 * Shared hook for Codex / Gemini / Vertex provider edit pages.
 * Encapsulates: config loading, form state, dirty tracking, unsaved-changes guard, save logic.
 */
export function useProviderEditForm<TForm extends BaseFormState, TConfig extends { authIndex?: string }>(
    config: ProviderEditFormConfig<TForm, TConfig>,
): ProviderEditFormReturn<TForm, TConfig> {
    const { t }  = useTranslation()
    const params = useParams<{ index?: string }>()

    const { showNotification } = useNotificationStore()
    const connectionStatus     = useAuthStore((state) => state.connectionStatus)
    const authGeneration       = useAuthStore(() => apiClient.getAuthGeneration())
    const isCurrent            = useCallback(() => apiClient.getAuthGeneration() === authGeneration, [authGeneration])
    const disableControls      = connectionStatus !== 'connected'

    const fetchConfig       = useConfigStore((state) => state.fetchConfig)
    const updateConfigValue = useConfigStore((state) => state.updateConfigValue)
    const clearCache        = useConfigStore((state) => state.clearCache)

    const configHelpers = useMemo(() => {
        const assertCurrent = () => {
            if (!isCurrent()) {
                throw new Error(t('common.connection_changed'))
            }
        }
        return {
            fetchConfig: async (key: RawConfigSection) => {
                assertCurrent()
                const value = await fetchConfig(key)
                assertCurrent()
                return value
            },
            updateConfigValue: (key: RawConfigSection, value: unknown) => {
                assertCurrent()
                updateConfigValue(key, value)
            },
            clearCache: (key: RawConfigSection) => {
                assertCurrent()
                clearCache(key)
            },
        }
    }, [clearCache, fetchConfig, isCurrent, t, updateConfigValue])

    const [storedConfigs, setConfigs]               = useState<TConfig[]>([])
    const [configGeneration, setConfigGeneration]   = useState<number | null>(null)
    const [loading, setLoading]                     = useState(true)
    const [savingGeneration, setSavingGeneration]   = useState<number | null>(null)
    const saving = savingGeneration === authGeneration
    const setSaving = useCallback((value: boolean) => {
        if (isCurrent()) {
            setSavingGeneration(value ? authGeneration : null)
        }
    }, [authGeneration, isCurrent])
    const [error, setError]                         = useState('')
    const [storedForm, setStoredForm]               = useState<TForm>(() => config.buildEmptyForm())
    const [baselineSignature, setBaselineSignature] = useState(() => config.buildSignature(config.buildEmptyForm()))
    const sourceLoaded = configGeneration === authGeneration
    const configs = useMemo(() => sourceLoaded ? storedConfigs : [], [sourceLoaded, storedConfigs])
    const form = sourceLoaded ? storedForm : config.buildEmptyForm()
    const resolvedLoading = loading || !sourceLoaded
    const setForm: Dispatch<SetStateAction<TForm>> = useCallback((action) => {
        if (isCurrent()) {
            setStoredForm(action)
        }
    }, [isCurrent])

    // ---- Index parsing ----

    const hasIndexParam     = typeof params.index === 'string'
    const editIndex         = useMemo(() => parseIndexParam(params.index), [params.index])
    const invalidIndexParam = hasIndexParam && editIndex === null

    const initialData = useMemo(() => {
        if (editIndex === null) {
            return undefined
        }
        return configs[editIndex]
    }, [configs, editIndex])

    const invalidIndex = editIndex !== null && !initialData

    const title = editIndex !== null ? t(config.i18n.editTitle) : t(config.i18n.addTitle)

    // ---- Navigation ----

    const { handleBack, swipeRef } = useEditPageNavigation()

    // ---- Load configs ----

    useEffect(() => {
        let cancelled = false
        queueMicrotask(() => {
            if (cancelled || !isCurrent()) {
                return
            }
            setLoading(true)
            setError('')
            setConfigs([])
            const emptyForm = config.buildEmptyForm()
            setStoredForm(emptyForm)
            setBaselineSignature(config.buildSignature(emptyForm))

            config
                .loadConfigs(configHelpers)
                .then((result) => {
                    if (cancelled || !isCurrent()) {
                        return
                    }
                    setConfigs(result)
                })
                .catch((err: unknown) => {
                    if (cancelled || !isCurrent()) {
                        return
                    }
                    const message = err instanceof Error ? err.message : ''
                    setError(message || t('notification.refresh_failed'))
                })
                .finally(() => {
                    if (cancelled || !isCurrent()) {
                        return
                    }
                    setConfigGeneration(authGeneration)
                    setLoading(false)
                })
        })

        return () => {
            cancelled = true
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [authGeneration, fetchConfig, isCurrent])

    // ---- Populate form from loaded data ----

    useEffect(() => {
        if (resolvedLoading) {
            return
        }
        let cancelled = false
        queueMicrotask(() => {
            if (cancelled || !isCurrent()) {
                return
            }
            const nextForm = initialData ? config.configToForm(initialData) : config.buildEmptyForm()
            setStoredForm(nextForm)
            setBaselineSignature(config.buildSignature(nextForm))
        })
        return () => {
            cancelled = true
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [initialData, isCurrent, resolvedLoading])

    // ---- Dirty tracking ----

    const currentSignature = useMemo(() => config.buildSignature(form), [config, form])
    const isDirty          = baselineSignature !== currentSignature

    // ---- Unsaved changes guard ----

    const canSave  = !disableControls && !saving && !resolvedLoading && !invalidIndexParam && !invalidIndex &&
                     !getCredentialRetryValidationKey(form.requestRetry) &&
                     !getModelEntriesValidationKey(form.modelEntries)
    const canGuard = isDirty && !resolvedLoading && !saving && !invalidIndexParam && !invalidIndex

    const { allowNextNavigation } = useUnsavedChangesGuard({
                                                               enabled: canGuard,
                                                               shouldBlock: ({ currentLocation, nextLocation }) =>
                                                                   isDirty &&
                                                                   currentLocation.pathname !==
                                                                   nextLocation.pathname,
                                                               dialog: {
                                                                   title: t('common.unsaved_changes_title'),
                                                                   message: t('common.unsaved_changes_message'),
                                                                   confirmText: t('common.leave'),
                                                                   cancelText: t('common.stay'),
                                                                   variant: 'danger',
                                                               },
                                                           })

    // ---- Save ----

    const handleSave = useCallback(async () => {
        if (!canSave || !isCurrent()) {
            return
        }

        if (config.validateBeforeSave) {
            const validationError = config.validateBeforeSave(form, editIndex !== null ? configs[editIndex] : undefined)
            if (validationError) {
                showNotification(t(validationError), 'error')
                return
            }
        }

        setSaving(true)
        setError('')
        try {
            const payload  = config.formToPayload(form)
            const original = editIndex !== null ? configs[editIndex] : undefined
            if (editIndex !== null && !original) {
                const message = t('common.invalid_provider_index')
                setError(message)
                showNotification(`${t('notification.update_failed')}: ${message}`, 'error')
                return
            }

            if (editIndex !== null && original) {
                await config.updateConfig(editIndex, payload, original)
            } else {
                await config.createConfig(payload)
            }
            if (!isCurrent()) {
                return
            }

            const localValue = editIndex !== null && original
                               ? ({ ...payload, authIndex: original.authIndex } as TConfig)
                               : payload
            const localList  = editIndex !== null
                               ? configs.map((item, idx) => (idx === editIndex ? localValue : item))
                               : [...configs, localValue]
            showNotification(
                editIndex !== null ? t(config.i18n.saveSuccessEdit) : t(config.i18n.saveSuccessAdd),
                'success',
            )

            let nextList = localList
            try {
                nextList = await config.loadConfigs(configHelpers)
            } catch (refreshError: unknown) {
                if (!isCurrent()) {
                    return
                }
                const message = refreshError instanceof Error ? refreshError.message : ''
                showNotification(`${t('notification.refresh_failed')}: ${message}`, 'warning')
            }
            if (!isCurrent()) {
                return
            }

            setConfigs(nextList)
            configHelpers.updateConfigValue(config.configKey, nextList)
            allowNextNavigation()
            setBaselineSignature(config.buildSignature(form))
            handleBack()
        } catch (err: unknown) {
            if (!isCurrent()) {
                return
            }
            const message = err instanceof Error ? err.message : ''
            setError(message)
            showNotification(`${t('notification.update_failed')}: ${message}`, 'error')
        } finally {
            if (isCurrent()) {
                setSaving(false)
            }
        }
    }, [
                                       allowNextNavigation,
                                       canSave,
                                       config,
                                       configHelpers,
                                       configs,
                                       editIndex,
                                       form,
                                       handleBack,
                                       isCurrent,
                                       setSaving,
                                       showNotification,
                                       t,
                                   ])

    return {
        form,
        setForm,
        configs,
        loading: resolvedLoading,
        saving,
        error,
        isDirty,
        editIndex,
        invalidIndexParam,
        invalidIndex,
        disableControls,
        canSave,
        disabled: disableControls || saving || resolvedLoading,
        title,
        handleSave,
        handleBack,
        swipeRef,
    }
}

// ---- Shared signature helpers ----

/**
 * Build signature fields common to Codex / Gemini / Vertex.
 * Provider pages extend this with provider-specific fields.
 */
export const buildBaseSignatureFields = (form: BaseFormState) => ({
    apiKey: String(form.apiKey ?? '').trim(),
    priority: form.priority !== undefined && Number.isFinite(form.priority) ? Math.trunc(form.priority) : null,
    weight: form.weight !== undefined && Number.isFinite(form.weight) ? form.weight : null,
    disableCooling: form.disableCooling ?? null,
    requestRetry: form.requestRetry?.toString() ?? null,
    requestScopedErrors: form.requestScopedErrors ?? null,
    prefix: String(form.prefix ?? '').trim(),
    baseUrl: String(form.baseUrl ?? '').trim(),
    proxyUrl: String(form.proxyUrl ?? '').trim(),
    headers: normalizeHeaderEntries(form.headers),
})
