/**
 * Shared layout lifecycle logic for provider editor pages.
 *
 * Both Claude and OpenAI edit layouts follow the same pattern:
 * index parsing, config loading, draft store binding, model auto-selection,
 * unsaved-changes guard, and discovered-model merging.
 *
 * This hook extracts that common logic and exposes the provider-specific
 * seams (form seeding, signature building, save handling) as parameters.
 */

import type {ModelEntry} from '@/components/providers/types'
import {useUnsavedChangesGuard} from '@/hooks/useUnsavedChangesGuard'
import {useAuthStore, useConfigStore, useNotificationStore} from '@/stores'
import type {BaseDraft, DraftSliceState} from '@/stores/createDraftSlice'
import type {Config, RawConfigSection} from '@/types/config'
import {getErrorMessage, parseIndexParam} from '@/utils/helpers'
import type {ModelInfo} from '@/utils/models'
import type {Dispatch, SetStateAction} from 'react'
import {useCallback, useEffect, useMemo, useState} from 'react'
import {useTranslation} from 'react-i18next'
import type {BlockerFunction} from 'react-router'
import {useLocation, useNavigate, useParams} from 'react-router-dom'
import type {StoreApi, UseBoundStore} from 'zustand'

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type LocationState = { fromAiProviders?: boolean } | null

type TestStatus = 'idle' | 'loading' | 'success' | 'error'

/**
 * Draft init payload returned by `seedForm` / used for empty form.
 * Contains all fields the draft store needs except `initialized` and `baselineSignature`,
 * which the hook computes automatically.
 */
export type DraftInitPayload<D extends BaseDraft> = Omit<D, 'initialized' | 'baselineSignature'>

/** Save context passed to the provider-specific `onSave` callback. */
export interface SaveContext<F, C> {
    form: F
    testModel: string
    editIndex: number | null
    configs: C[]
    setConfigs: Dispatch<SetStateAction<C[]>>
    setSaving: Dispatch<SetStateAction<boolean>>
    allowNextNavigation: () => void
    updateBaselineSignature: (signature: string) => void
    handleBack: () => void
}

/** Configuration for the hook, parameterizing provider-specific differences. */
export interface ProviderEditLayoutOptions<F, C, D extends BaseDraft> {
    /** Config section key for fetching and caching. */
    configKey: RawConfigSection

    /** Prefix for the draft key (e.g. 'claude' or 'openai'). */
    draftKeyPrefix: string

    /** Route prefix for unsaved-changes guard (e.g. '/ai-providers/claude'). */
    routePrefix: string

    /** Zustand draft store hook. */
    useDraftStore: UseBoundStore<StoreApi<DraftSliceState<D>>>

    /** Extract the provider config array from the global config object. */
    extractConfigs: (config: Config | null) => C[]

    /** Build draft init payload for an empty (new) form. */
    buildEmptyDraftInit: () => DraftInitPayload<D>

    /** Build a deterministic signature string for dirty detection. */
    buildSignature: (form: F, testModel: string) => string

    /** Seed draft init payload from existing config data (edit mode). */
    seedDraftInit: (initialData: C) => DraftInitPayload<D>

    /** Notification key for the merge-models toast. */
    mergeNotificationKey: string

    /** Provider-specific save handler. */
    onSave: (ctx: SaveContext<F, C>) => Promise<void>
}

/** Return value of the hook. */
export interface ProviderEditLayoutResult<F, C> {
    hasIndexParam: boolean
    editIndex: number | null
    invalidIndexParam: boolean
    invalidIndex: boolean
    disableControls: boolean
    loading: boolean
    saving: boolean
    setSaving: Dispatch<SetStateAction<boolean>>
    form: F
    setForm: Dispatch<SetStateAction<F>>
    testModel: string
    setTestModel: Dispatch<SetStateAction<string>>
    testStatus: TestStatus
    setTestStatus: Dispatch<SetStateAction<TestStatus>>
    testMessage: string
    setTestMessage: Dispatch<SetStateAction<string>>
    availableModels: string[]
    configs: C[]
    setConfigs: Dispatch<SetStateAction<C[]>>
    draftKey: string
    handleBack: () => void
    handleSave: () => Promise<void>
    mergeDiscoveredModels: (selectedModels: ModelInfo[]) => void
    allowNextNavigation: () => void
    updateBaselineSignature: (signature: string) => void
}

/* ------------------------------------------------------------------ */
/*  Hook                                                               */

/* ------------------------------------------------------------------ */

export function useProviderEditLayout<F, C, D extends BaseDraft>(
    options: ProviderEditLayoutOptions<F, C, D>,
): ProviderEditLayoutResult<F, C> {
    const {
              configKey,
              draftKeyPrefix,
              routePrefix,
              useDraftStore,
              extractConfigs,
              buildEmptyDraftInit,
              buildSignature,
              seedDraftInit,
              mergeNotificationKey,
              onSave,
          } = options

    const { t }                = useTranslation()
    const navigate             = useNavigate()
    const location             = useLocation()
    const { showNotification } = useNotificationStore()

    /* ---- Index parsing ---- */
    const params            = useParams<{ index?: string }>()
    const hasIndexParam     = typeof params.index === 'string'
    const editIndex         = useMemo(() => parseIndexParam(params.index), [params.index])
    const invalidIndexParam = hasIndexParam && editIndex === null

    /* ---- Connection status ---- */
    const connectionStatus = useAuthStore((state) => state.connectionStatus)
    const disableControls  = connectionStatus !== 'connected'

    /* ---- Config store ---- */
    const config       = useConfigStore((state) => state.config)
    const fetchConfig  = useConfigStore((state) => state.fetchConfig)
    const isCacheValid = useConfigStore((state) => state.isCacheValid)

    const [configs, setConfigs] = useState<C[]>(() => extractConfigs(config))
    const [loading, setLoading] = useState(() => !isCacheValid(configKey))
    const [saving, setSaving]   = useState(false)

    /* ---- Draft store binding ---- */
    const draftKey = useMemo(() => {
        if (invalidIndexParam) {
            return `${draftKeyPrefix}:invalid:${params.index ?? 'unknown'}`
        }
        if (editIndex === null) {
            return `${draftKeyPrefix}:new`
        }
        return `${draftKeyPrefix}:${editIndex}`
    }, [draftKeyPrefix, editIndex, invalidIndexParam, params.index])

    const draft                     = useDraftStore((state) => state.drafts[draftKey])
    const acquireDraft              = useDraftStore((state) => state.acquireDraft)
    const releaseDraft              = useDraftStore((state) => state.releaseDraft)
    const initDraft                 = useDraftStore((state) => state.initDraft)
    const setDraftBaselineSignature = useDraftStore((state) => state.setDraftBaselineSignature)
    const setDraftForm              = useDraftStore((state) => state.setDraftForm)
    const setDraftTestModel         = useDraftStore((state) => state.setDraftTestModel)
    const setDraftTestStatus        = useDraftStore((state) => state.setDraftTestStatus)
    const setDraftTestMessage       = useDraftStore((state) => state.setDraftTestMessage)

    const emptyInit   = useMemo(() => buildEmptyDraftInit(), [buildEmptyDraftInit])
    const form        = (draft?.form as F) ?? (emptyInit.form as F)
    const testModel   = draft?.testModel ?? ''
    const testStatus  = (draft?.testStatus ?? 'idle') as TestStatus
    const testMessage = draft?.testMessage ?? ''

    const setForm: Dispatch<SetStateAction<F>> = useCallback(
        (action) => {
            setDraftForm(draftKey, action as SetStateAction<D['form']>)
        },
        [draftKey, setDraftForm],
    )

    const setTestModel: Dispatch<SetStateAction<string>> = useCallback(
        (action) => {
            setDraftTestModel(draftKey, action)
        },
        [draftKey, setDraftTestModel],
    )

    const setTestStatus: Dispatch<SetStateAction<TestStatus>> = useCallback(
        (action) => {
            setDraftTestStatus(draftKey, action as SetStateAction<D['testStatus']>)
        },
        [draftKey, setDraftTestStatus],
    )

    const setTestMessage: Dispatch<SetStateAction<string>> = useCallback(
        (action) => {
            setDraftTestMessage(draftKey, action)
        },
        [draftKey, setDraftTestMessage],
    )

    const updateBaselineSignature = useCallback(
        (signature: string) => {
            setDraftBaselineSignature(draftKey, signature)
        },
        [draftKey, setDraftBaselineSignature],
    )

    /* ---- Derived state ---- */
    const initialData = useMemo(() => {
        if (editIndex === null) {
            return undefined
        }
        return configs[editIndex]
    }, [configs, editIndex])

    const invalidIndex = editIndex !== null && !initialData

    const availableModels = useMemo(() => {
        const seen = new Map<string, string>()
        ;(form as F & { modelEntries: ModelEntry[] }).modelEntries.forEach((entry) => {
            const name = entry.name.trim()
            if (!name) {
                return
            }
            const key = name.toLowerCase()
            if (!seen.has(key)) {
                seen.set(key, name)
            }
        })
        return Array.from(seen.values()).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
    }, [form])

    /* ---- Draft acquire/release ---- */
    useEffect(() => {
        acquireDraft(draftKey)
        return () => releaseDraft(draftKey)
    }, [acquireDraft, draftKey, releaseDraft])

    /* ---- Navigation ---- */
    const handleBack = useCallback(() => {
        const state = location.state as LocationState
        if (state?.fromAiProviders) {
            navigate(-1)
            return
        }
        navigate('/credentials', { replace: true })
    }, [location.state, navigate])

    /* ---- Config loading ---- */
    useEffect(() => {
        let cancelled       = false
        const hasValidCache = isCacheValid(configKey)

        queueMicrotask(() => {
            if (cancelled) {
                return
            }
            if (!hasValidCache) {
                setLoading(true)
            }

            fetchConfig(configKey)
                .then((value) => {
                    if (cancelled) {
                        return
                    }
                    setConfigs(Array.isArray(value) ? (value as C[]) : [])
                })
                .catch((err: unknown) => {
                    if (cancelled) {
                        return
                    }
                    const message = getErrorMessage(err) || t('notification.refresh_failed')
                    showNotification(`${t('notification.load_failed')}: ${message}`, 'error')
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
    }, [configKey, fetchConfig, isCacheValid, showNotification, t])

    /* ---- Draft initialization ---- */
    useEffect(() => {
        if (loading) {
            return
        }
        if (draft?.initialized) {
            return
        }

        if (initialData) {
            const payload           = seedDraftInit(initialData)
            const baselineSignature = buildSignature(payload.form as F, payload.testModel)
            initDraft(draftKey, { ...payload, baselineSignature } as Omit<D, 'initialized'>)
            return
        }

        const payload           = buildEmptyDraftInit()
        const baselineSignature = buildSignature(payload.form as F, payload.testModel)
        initDraft(draftKey, { ...payload, baselineSignature } as Omit<D, 'initialized'>)
    }, [
                  buildEmptyDraftInit,
                  buildSignature,
                  draft?.initialized,
                  draftKey,
                  initDraft,
                  initialData,
                  loading,
                  seedDraftInit,
              ])

    /* ---- Resolved loading (draft not yet initialized) ---- */
    const resolvedLoading = !draft?.initialized

    /* ---- Dirty detection ---- */
    const currentSignature  = useMemo(() => buildSignature(form, testModel), [buildSignature, form, testModel])
    const baselineSignature = draft?.baselineSignature ?? ''
    const isDirty           = Boolean(draft?.initialized) && baselineSignature !== currentSignature

    /* ---- Unsaved-changes guard ---- */
    const editorRootPath = useMemo(() => {
        if (hasIndexParam) {
            return `${routePrefix}/${params.index ?? ''}`
        }
        return `${routePrefix}/new`
    }, [hasIndexParam, params.index, routePrefix])
    const canGuard       = isDirty && !resolvedLoading && !saving && !invalidIndexParam && !invalidIndex

    const guardOptions = {
        enabled: canGuard,
        shouldBlock: (({ nextLocation }) => {
            const nextPath     = nextLocation.pathname
            const isWithinRoot = nextPath === editorRootPath || nextPath.startsWith(`${editorRootPath}/`)
            return isDirty && !isWithinRoot
        }) as BlockerFunction,
        dialog: {
            title: t('common.unsaved_changes_title'),
            message: t('common.unsaved_changes_message'),
            confirmText: t('common.leave'),
            cancelText: t('common.stay'),
            variant: 'danger' as const,
        },
    }

    const { allowNextNavigation } = useUnsavedChangesGuard(guardOptions)

    /* ---- Model auto-selection ---- */
    useEffect(() => {
        if (resolvedLoading) {
            return
        }

        if (availableModels.length === 0) {
            if (testModel) {
                setTestModel('')
                setTestStatus('idle')
                setTestMessage('')
            }
            return
        }

        if (!testModel || !availableModels.includes(testModel)) {
            setTestModel(availableModels[0])
            setTestStatus('idle')
            setTestMessage('')
        }
    }, [availableModels, resolvedLoading, setTestMessage, setTestModel, setTestStatus, testModel])

    /* ---- Merge discovered models ---- */
    const mergeDiscoveredModels = useCallback(
        (selectedModels: ModelInfo[]) => {
            if (!selectedModels.length) {
                return
            }

            let addedCount = 0
            setForm((prev) => {
                const prevWithEntries = prev as F & { modelEntries: ModelEntry[] }
                const mergedMap       = new Map<string, ModelEntry>()
                prevWithEntries.modelEntries.forEach((entry) => {
                    const name = entry.name.trim()
                    if (!name) {
                        return
                    }
                    mergedMap.set(name, { name, alias: entry.alias?.trim() || '' })
                })

                selectedModels.forEach((model) => {
                    const name = model.name.trim()
                    if (!name || mergedMap.has(name)) {
                        return
                    }
                    mergedMap.set(name, { name, alias: model.alias ?? '' })
                    addedCount += 1
                })

                const mergedEntries = Array.from(mergedMap.values())
                return {
                    ...prev,
                    modelEntries: mergedEntries.length ? mergedEntries : [{ name: '', alias: '' }],
                }
            })

            if (addedCount > 0) {
                showNotification(t(mergeNotificationKey, { count: addedCount }), 'success')
            }
        },
        [mergeNotificationKey, setForm, showNotification, t],
    )

    /* ---- Save (delegated to provider-specific callback) ---- */
    const handleSave = useCallback(async () => {
        const canSave = !disableControls && !saving && !resolvedLoading && !invalidIndexParam && !invalidIndex
        if (!canSave) {
            return
        }

        await onSave({
                         form,
                         testModel,
                         editIndex,
                         configs,
                         setConfigs,
                         setSaving,
                         allowNextNavigation,
                         updateBaselineSignature,
                         handleBack,
                     })
    }, [
                                       allowNextNavigation,
                                       configs,
                                       disableControls,
                                       editIndex,
                                       form,
                                       handleBack,
                                       invalidIndex,
                                       invalidIndexParam,
                                       onSave,
                                       resolvedLoading,
                                       saving,
                                       testModel,
                                       updateBaselineSignature,
                                   ])

    return {
        hasIndexParam,
        editIndex,
        invalidIndexParam,
        invalidIndex,
        disableControls,
        loading: resolvedLoading,
        saving,
        setSaving,
        form,
        setForm,
        testModel,
        setTestModel,
        testStatus,
        setTestStatus,
        testMessage,
        setTestMessage,
        availableModels,
        configs,
        setConfigs,
        draftKey,
        handleBack,
        handleSave,
        mergeDiscoveredModels,
        allowNextNavigation,
        updateBaselineSignature,
    }
}
