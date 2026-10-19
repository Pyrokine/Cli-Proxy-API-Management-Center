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
import {resolveProviderDraftInitAction} from '@/hooks/providerEditLayoutState'
import {useUnsavedChangesGuard} from '@/hooks/useUnsavedChangesGuard'
import {apiClient} from '@/services/api/client'
import {useAuthStore, useNotificationStore} from '@/stores'
import type {BaseDraft, DraftSliceState} from '@/stores/createDraftSlice'
import {getErrorMessage, parseIndexParam} from '@/utils/helpers'
import type {ModelInfo} from '@/utils/models'
import {mergeProviderModelEntries} from '@/utils/providerModels'
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
type DraftInitPayload<D extends BaseDraft> = Omit<D, 'initialized' | 'baselineSignature'>

/** Save context passed to the provider-specific `onSave` callback. */
interface SaveContext<F, C> {
    isCurrent: () => boolean
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
interface ProviderEditLayoutOptions<F, C, D extends BaseDraft> {
    /** Load provider entries from the endpoint that includes stable runtime identities. */
    loadConfigs: () => Promise<C[]>

    /** Prefix for the draft key (e.g. 'claude' or 'openai'). */
    draftKeyPrefix: string

    /** Route prefix for unsaved-changes guard (e.g. '/ai-providers/claude'). */
    routePrefix: string

    /** Zustand draft store hook. */
    useDraftStore: UseBoundStore<StoreApi<DraftSliceState<D>>>

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
interface ProviderEditLayoutResult<F, C> {
    hasIndexParam: boolean
    editIndex: number | null
    invalidIndexParam: boolean
    invalidIndex: boolean
    disableControls: boolean
    isCurrent: () => boolean
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
              loadConfigs,
              draftKeyPrefix,
              routePrefix,
              useDraftStore,
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
    const authGeneration = useAuthStore(() => apiClient.getAuthGeneration())
    const isCurrent = useCallback(() => apiClient.getAuthGeneration() === authGeneration, [authGeneration])
    const disableControls  = connectionStatus !== 'connected'

    const [storedConfigs, setStoredConfigs] = useState<C[]>([])
    const [configGeneration, setConfigGeneration] = useState<number | null>(null)
    const [loading, setLoading] = useState(true)
    const [savingGeneration, setSavingGeneration] = useState<number | null>(null)
    const saving = savingGeneration === authGeneration
    const sourceLoaded = configGeneration === authGeneration
    const configs = useMemo(() => sourceLoaded ? storedConfigs : [], [sourceLoaded, storedConfigs])
    const setConfigs: Dispatch<SetStateAction<C[]>> = useCallback((action) => {
        if (isCurrent()) {
            setStoredConfigs(action)
        }
    }, [isCurrent])
    const setSaving: Dispatch<SetStateAction<boolean>> = useCallback((action) => {
        if (isCurrent()) {
            setSavingGeneration((previous) => {
                const value = typeof action === 'function' ? action(previous === authGeneration) : action
                return value ? authGeneration : null
            })
        }
    }, [authGeneration, isCurrent])

    /* ---- Draft store binding ---- */
    const draftKey = useMemo(() => {
        const sourceKey = `${draftKeyPrefix}:${authGeneration}`
        if (invalidIndexParam) {
            return `${sourceKey}:invalid:${params.index ?? 'unknown'}`
        }
        if (editIndex === null) {
            return `${sourceKey}:new`
        }
        return `${sourceKey}:${editIndex}`
    }, [authGeneration, draftKeyPrefix, editIndex, invalidIndexParam, params.index])

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
            if (isCurrent()) {
                setDraftForm(draftKey, action as SetStateAction<D['form']>)
            }
        },
        [draftKey, isCurrent, setDraftForm],
    )

    const setTestModel: Dispatch<SetStateAction<string>> = useCallback(
        (action) => {
            if (isCurrent()) {
                setDraftTestModel(draftKey, action)
            }
        },
        [draftKey, isCurrent, setDraftTestModel],
    )

    const setTestStatus: Dispatch<SetStateAction<TestStatus>> = useCallback(
        (action) => {
            if (isCurrent()) {
                setDraftTestStatus(draftKey, action as SetStateAction<D['testStatus']>)
            }
        },
        [draftKey, isCurrent, setDraftTestStatus],
    )

    const setTestMessage: Dispatch<SetStateAction<string>> = useCallback(
        (action) => {
            if (isCurrent()) {
                setDraftTestMessage(draftKey, action)
            }
        },
        [draftKey, isCurrent, setDraftTestMessage],
    )

    const updateBaselineSignature = useCallback(
        (signature: string) => {
            if (isCurrent()) {
                setDraftBaselineSignature(draftKey, signature)
            }
        },
        [draftKey, isCurrent, setDraftBaselineSignature],
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
        let cancelled = false

        queueMicrotask(() => {
            if (cancelled || !isCurrent()) {
                return
            }
            setLoading(true)
            setConfigs([])

            loadConfigs()
                .then((value) => {
                    if (cancelled || !isCurrent()) {
                        return
                    }
                    setConfigs(value)
                })
                .catch((err: unknown) => {
                    if (cancelled || !isCurrent()) {
                        return
                    }
                    const message = getErrorMessage(err) || t('notification.refresh_failed')
                    showNotification(`${t('notification.load_failed')}: ${message}`, 'error')
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
    }, [authGeneration, isCurrent, loadConfigs, setConfigs, showNotification])

    /* ---- Draft initialization ---- */
    useEffect(() => {
        if (!isCurrent()) {
            return
        }
        const action = resolveProviderDraftInitAction({
                                                          loading: loading || !sourceLoaded,
                                                          initialized: Boolean(draft?.initialized),
                                                          hasIndexParam,
                                                          invalidIndexParam,
                                                          initialData,
                                                      })
        if (action === 'wait') {
            return
        }

        const payload           =
                  action === 'seed' && initialData !== undefined ? seedDraftInit(initialData) : buildEmptyDraftInit()
        const baselineSignature = buildSignature(payload.form as F, payload.testModel)
        initDraft(draftKey, { ...payload, baselineSignature } as Omit<D, 'initialized'>)
    }, [
                  buildEmptyDraftInit,
                  buildSignature,
                  draft?.initialized,
                  draftKey,
                  hasIndexParam,
                  initDraft,
                  initialData,
                  invalidIndexParam,
                  isCurrent,
                  loading,
                  seedDraftInit,
                  sourceLoaded,
              ])

    /* ---- Resolved loading (config or draft not yet initialized) ---- */
    const draftRequired   = !invalidIndexParam && !invalidIndex
    const resolvedLoading = loading || !sourceLoaded || (draftRequired && !draft?.initialized)

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
                const merged          = mergeProviderModelEntries(prevWithEntries.modelEntries, selectedModels)
                addedCount            = merged.addedCount
                return {
                    ...prev,
                    modelEntries: merged.entries,
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
        if (!canSave || !isCurrent()) {
            return
        }

        await onSave({
                         isCurrent,
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
                                       isCurrent,
                                       onSave,
                                       resolvedLoading,
                                       saving,
                                       setConfigs,
                                       setSaving,
                                       testModel,
                                       updateBaselineSignature,
                                   ])

    return {
        hasIndexParam,
        editIndex,
        invalidIndexParam,
        invalidIndex,
        disableControls,
        isCurrent,
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
