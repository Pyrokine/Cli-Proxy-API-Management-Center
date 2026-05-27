import {useEditPageNavigation} from '@/hooks/useEditPageNavigation'
import {useUnsavedChangesGuard} from '@/hooks/useUnsavedChangesGuard'
import {useAuthStore, useConfigStore, useNotificationStore} from '@/stores'
import type {RawConfigSection} from '@/types/config'
import {normalizeHeaderEntries} from '@/utils/headers'
import {parseIndexParam} from '@/utils/helpers'
import {type Dispatch, type SetStateAction, useCallback, useEffect, useMemo, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {useParams} from 'react-router-dom'

// ---- Generic form state constraint ----

interface BaseFormState {
    apiKey: string
    priority?: number
    prefix?: string
    baseUrl?: string
    proxyUrl?: string
    headers: Array<{ key: string; value: string }>
    modelEntries: Array<{ name: string; alias: string }>
}

// ---- Configuration for provider-specific behavior ----

export interface ProviderEditFormConfig<TForm extends BaseFormState, TConfig> {
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

    /**
     * Save the full config list to server.
     */
    saveConfigs: (configs: TConfig[]) => Promise<unknown>

    /** Optional pre-save validation. Return an error notification key to abort, or undefined to proceed. */
    validateBeforeSave?: (form: TForm) => string | undefined

    /** Translation keys */
    i18n: {
        editTitle: string
        addTitle: string
        saveSuccessEdit: string
        saveSuccessAdd: string
    }
}

// ---- Return type ----

interface ProviderEditFormReturn<TForm extends BaseFormState, TConfig> {
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
export function useProviderEditForm<TForm extends BaseFormState, TConfig>(
    config: ProviderEditFormConfig<TForm, TConfig>,
): ProviderEditFormReturn<TForm, TConfig> {
    const { t }  = useTranslation()
    const params = useParams<{ index?: string }>()

    const { showNotification } = useNotificationStore()
    const connectionStatus     = useAuthStore((state) => state.connectionStatus)
    const disableControls      = connectionStatus !== 'connected'

    const fetchConfig       = useConfigStore((state) => state.fetchConfig)
    const updateConfigValue = useConfigStore((state) => state.updateConfigValue)
    const clearCache        = useConfigStore((state) => state.clearCache)

    const [configs, setConfigs]                     = useState<TConfig[]>([])
    const [loading, setLoading]                     = useState(true)
    const [saving, setSaving]                       = useState(false)
    const [error, setError]                         = useState('')
    const [form, setForm]                           = useState<TForm>(() => config.buildEmptyForm())
    const [baselineSignature, setBaselineSignature] = useState(() => config.buildSignature(config.buildEmptyForm()))

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
            if (cancelled) {
                return
            }
            setLoading(true)
            setError('')

            config
                .loadConfigs({ fetchConfig, updateConfigValue, clearCache })
                .then((result) => {
                    if (cancelled) {
                        return
                    }
                    setConfigs(result)
                })
                .catch((err: unknown) => {
                    if (cancelled) {
                        return
                    }
                    const message = err instanceof Error ? err.message : ''
                    setError(message || t('notification.refresh_failed'))
                })
                .finally(() => {
                    if (cancelled) {
                        return
                    }
                    setLoading(false)
                })
        })

        return () => {
            cancelled = true
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fetchConfig, t])

    // ---- Populate form from loaded data ----

    useEffect(() => {
        if (loading) {
            return
        }

        queueMicrotask(() => {
            if (initialData) {
                const nextForm = config.configToForm(initialData)
                setForm(nextForm)
                setBaselineSignature(config.buildSignature(nextForm))
                return
            }
            const nextForm = config.buildEmptyForm()
            setForm(nextForm)
            setBaselineSignature(config.buildSignature(nextForm))
        })
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [initialData, loading])

    // ---- Dirty tracking ----

    const currentSignature = useMemo(() => config.buildSignature(form), [config, form])
    const isDirty          = baselineSignature !== currentSignature

    // ---- Unsaved changes guard ----

    const canSave  = !disableControls && !saving && !loading && !invalidIndexParam && !invalidIndex
    const canGuard = isDirty && !loading && !saving && !invalidIndexParam && !invalidIndex

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
        if (!canSave) {
            return
        }

        if (config.validateBeforeSave) {
            const validationError = config.validateBeforeSave(form)
            if (validationError) {
                showNotification(t(validationError), 'error')
                return
            }
        }

        setSaving(true)
        setError('')
        try {
            const payload = config.formToPayload(form)

            const nextList =
                      editIndex !== null
                      ? configs.map((item, idx) => (idx === editIndex ? payload : item))
                      : [...configs, payload]

            await config.saveConfigs(nextList)
            updateConfigValue(config.configKey, nextList)
            clearCache(config.configKey)
            showNotification(
                editIndex !== null ? t(config.i18n.saveSuccessEdit) : t(config.i18n.saveSuccessAdd),
                'success',
            )
            allowNextNavigation()
            setBaselineSignature(config.buildSignature(form))
            handleBack()
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : ''
            setError(message)
            showNotification(`${t('notification.update_failed')}: ${message}`, 'error')
        } finally {
            setSaving(false)
        }
    }, [
                                       allowNextNavigation,
                                       canSave,
                                       clearCache,
                                       config,
                                       configs,
                                       editIndex,
                                       form,
                                       handleBack,
                                       showNotification,
                                       t,
                                       updateConfigValue,
                                   ])

    return {
        form,
        setForm,
        configs,
        loading,
        saving,
        error,
        isDirty,
        editIndex,
        invalidIndexParam,
        invalidIndex,
        disableControls,
        canSave,
        disabled: disableControls || saving,
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
    prefix: String(form.prefix ?? '').trim(),
    baseUrl: String(form.baseUrl ?? '').trim(),
    proxyUrl: String(form.proxyUrl ?? '').trim(),
    headers: normalizeHeaderEntries(form.headers),
})

/**
 * Normalize model entries for signature comparison.
 * Strips entries where both name and alias are empty.
 */
export const normalizeModelEntriesForSignature = (
    entries: Array<{ name: string; alias: string }>,
    normalizeName: (name: string) => string = (name) => String(name ?? '').trim(),
) =>
    (entries ?? []).reduce<Array<{ name: string; alias: string }>>((acc, entry) => {
        const name = normalizeName(entry?.name ?? '')
        let alias  = String(entry?.alias ?? '').trim()
        if (name && alias === name) {
            alias = ''
        }
        if (!name && !alias) {
            return acc
        }
        acc.push({ name, alias })
        return acc
    }, [])
