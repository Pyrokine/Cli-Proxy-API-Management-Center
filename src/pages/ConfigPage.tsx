import {DiffModal} from '@/components/config/DiffModal'
import {VisualConfigEditor} from '@/components/config/VisualConfigEditor'
import {findConfigFieldById, type ConfigFieldSearchEntry} from '@/components/config/configSearchIndex'
import {Button} from '@/components/ui/Button'
import {IconCheck, IconChevronDown, IconChevronUp, IconRefreshCw, IconSearch} from '@/components/ui/icons'
import {Input} from '@/components/ui/Input'
import {Tabs} from '@/components/ui/Tabs'
import {useUnsavedChangesGuard} from '@/hooks/useUnsavedChangesGuard'
import {useVisualConfig} from '@/hooks/useVisualConfig'
import {artifactsApi} from '@/services/api/artifacts'
import {apiClient} from '@/services/api/client'
import {configFileApi, type ConfigValidationError} from '@/services/api/configFile'
import {logsApi} from '@/services/api/logs'
import {usageApi} from '@/services/api/usage'
import {useAuthStore, useConfigStore, useNotificationStore, useThemeStore} from '@/stores'
import type {VisualConfigRuntimeInfo, VisualConfigValues} from '@/types/visualConfig'
import {yaml} from '@codemirror/lang-yaml'
import {highlightSelectionMatches, search, searchKeymap} from '@codemirror/search'
import {keymap} from '@codemirror/view'
import CodeMirror, {ReactCodeMirrorRef} from '@uiw/react-codemirror'
import type {KeyboardEvent as ReactKeyboardEvent} from 'react'
import {useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react'
import {createPortal} from 'react-dom'
import {useTranslation} from 'react-i18next'
import {useLocation, useNavigate} from 'react-router-dom'
import {parse as parseYaml, parseDocument} from 'yaml'
import {ConfigEditorRevisionState, type ConfigRevisionSnapshot} from './configEditorRevision'
import styles from './ConfigPage.module.scss'

type ConfigEditorTab = 'visual' | 'source'

type ConfigFieldJumpRequest = Readonly<{
    key: string
    entry: ConfigFieldSearchEntry
}>

type PreparedConfigSave = Readonly<{
    revision: ConfigRevisionSnapshot
    origin: ConfigEditorTab
    content: string
    serverYaml: string
    diffOriginalYaml: string
    serverEtag: string
}>

function apiErrorStatus(error: unknown): number | undefined {
    if (error === null || typeof error !== 'object' || !('status' in error)) {
        return undefined
    }
    const status = (error as { status?: unknown }).status
    return typeof status === 'number' ? status : undefined
}

function readCommercialModeFromYaml(yamlContent: string): boolean {
    try {
        const parsed = parseYaml(yamlContent)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return false
        }
        return Boolean((parsed as Record<string, unknown>)['commercial-mode'])
    } catch {
        return false
    }
}

export function ConfigPage() {
    const { t }            = useTranslation()
    const location         = useLocation()
    const navigate         = useNavigate()
    const showNotification = useNotificationStore((state) => state.showNotification)
    const showConfirmation = useNotificationStore((state) => state.showConfirmation)
    const connectionStatus = useAuthStore((state) => state.connectionStatus)
    const apiBase = useAuthStore((state) => state.apiBase)
    const managementKey = useAuthStore((state) => state.managementKey)
    const authGeneration = useAuthStore(() => apiClient.getAuthGeneration())
    const mountedRef = useRef(true)
    const isCurrentConnection = useCallback(
        () => mountedRef.current && authGeneration === apiClient.getAuthGeneration(),
        [authGeneration],
    )
    const clearConfigCache = useConfigStore((state) => state.clearCache)
    const fetchConfig      = useConfigStore((state) => state.fetchConfig)
    const resolvedTheme    = useThemeStore((state) => state.resolvedTheme)
    const requestedField   = useMemo(
        () => findConfigFieldById(new URLSearchParams(location.search).get('field')),
        [location.search],
    )

    const {
              visualValues,
              visualDirty,
              visualParseError,
              validationErrors: visualValidationErrors,
              visualHasPayloadValidationErrors,
              loadVisualValuesFromYaml,
              applyVisualChangesToYaml,
              setVisualValues,
          } = useVisualConfig()

    const [activeTab, setActiveTab] = useState<ConfigEditorTab>(() => {
        if (requestedField) {
            return 'visual'
        }
        const saved = localStorage.getItem('config-management:tab')
        if (saved === 'visual' || saved === 'source') {
            return saved
        }
        return 'visual'
    })

    const [content, setContent]                       = useState('')
    const [loading, setLoading]                       = useState(true)
    const [saving, setSaving]                         = useState(false)
    const [saveNeedsReload, setSaveNeedsReload] = useState(false)
    const [error, setError]                           = useState('')
    const [dirty, setDirty]                           = useState(false)
    const [diffModalOpen, setDiffModalOpen]           = useState(false)
    const [diffOriginalYaml, setDiffOriginalYaml]     = useState('')
    const [mergedYaml, setMergedYaml]                 = useState('')
    const [validationWarnings, setValidationWarnings] = useState<string[]>([])
    const [validationErrors, setValidationErrors]     = useState<ConfigValidationError[]>([])
    const [runtimeInfo, setRuntimeInfo]               = useState<VisualConfigRuntimeInfo>({
                                                                                              logSize: { status: 'loading' },
                                                                                              usageDbSize: { status: 'loading' },
                                                                                              imageArtifactCacheSize: { status: 'loading' },
                                                                                          })

    // Search state
    const [searchQuery, setSearchQuery]             = useState('')
    const [searchResults, setSearchResults]         = useState<{ current: number; total: number }>({
                                                                                                       current: 0,
                                                                                                       total: 0,
                                                                                                   })
    const [lastSearchedQuery, setLastSearchedQuery] = useState('')
    const editorRef                                 = useRef<ReactCodeMirrorRef>(null)
    const floatingActionsRef                        = useRef<HTMLDivElement>(null)
    const revisionStateRef = useRef(new ConfigEditorRevisionState(() => apiClient.getAuthGeneration()))
    const runtimeRequestSequenceRef = useRef(0)
    const preparedSaveRef                           = useRef<PreparedConfigSave | null>(null)
    const isDirtyRef                                = useRef(false)
    const handledFieldRequestRef                    = useRef('')
    const pendingFieldRequestRef                    = useRef('')
    const [fieldJumpRequest, setFieldJumpRequest]   = useState<ConfigFieldJumpRequest | null>(null)

    const disableControls = connectionStatus !== 'connected' ||
                            revisionStateRef.current.snapshot().authGeneration !== authGeneration
    const isDirty                   = dirty || visualDirty
    isDirtyRef.current              = isDirty
    const { allowNextNavigation }   = useUnsavedChangesGuard({
                                                                 enabled: isDirty && !disableControls,
                                                                 shouldBlock: isDirty,
                                                                 dialog: {
                                                                     title: t('common.unsaved_changes_title'),
                                                                     message: t('common.unsaved_changes_message'),
                                                                     confirmText: t('common.leave'),
                                                                     cancelText: t('common.stay'),
                                                                     variant: 'danger',
                                                                 },
                                                             })
    const hasVisualModeError        = !!visualParseError
    const hasVisualValidationErrors =
              activeTab === 'visual' &&
              (Object.values(visualValidationErrors).some(Boolean) || visualHasPayloadValidationErrors)
    const loadRuntimeInfo           = useCallback(async () => {
        if (!isCurrentConnection()) {
            return
        }
        const sequence = ++runtimeRequestSequenceRef.current
        const generation = apiClient.getAuthGeneration()
        setRuntimeInfo({
                           logSize: { status: 'loading' },
                           usageDbSize: { status: 'loading' },
                           imageArtifactCacheSize: { status: 'loading' },
                       })

        const [logSizeResult, usageDbSizeResult, imageArtifactCacheSizeResult] = await Promise.allSettled([
                                                                                                              logsApi.fetchLogSize(),
                                                                                                              usageApi.getDBSize(),
                                                                                                              artifactsApi.fetchImageArtifactCacheSize(),
                                                                                                          ])
        if (sequence !== runtimeRequestSequenceRef.current || generation !== apiClient.getAuthGeneration()) {
            return
        }

        setRuntimeInfo({
                           logSize:
                               logSizeResult.status === 'fulfilled'
                               ? {
                                       status: 'ready',
                                       totalBytes: logSizeResult.value.total_bytes ?? 0,
                                       fileCount: logSizeResult.value.file_count ?? 0,
                                   }
                               : { status: 'error' },
                           usageDbSize:
                               usageDbSizeResult.status === 'fulfilled'
                               ? {
                                       status: 'ready',
                                       sizeBytes: usageDbSizeResult.value.size_bytes ?? 0,
                                       maxSizeBytes: usageDbSizeResult.value.max_size_bytes ?? undefined,
                                       warningThresholdPct: usageDbSizeResult.value.warning_threshold_pct ?? undefined,
                                       warning: Boolean(usageDbSizeResult.value.warning),
                                       capped: Boolean(usageDbSizeResult.value.capped),
                                   }
                               : { status: 'error' },
                           imageArtifactCacheSize:
                               imageArtifactCacheSizeResult.status === 'fulfilled'
                               ? {
                                       status: 'ready',
                                       totalBytes: imageArtifactCacheSizeResult.value.total_bytes ?? 0,
                                       fileCount: imageArtifactCacheSizeResult.value.file_count ?? 0,
                                   }
                               : { status: 'error' },
                       })
    }, [isCurrentConnection])

    const clearPreparedSave = useCallback(() => {
        if (!isCurrentConnection()) {
            return
        }
        preparedSaveRef.current = null
        setDiffModalOpen(false)
    }, [isCurrentConnection])

    const markDraftChanged = useCallback(() => {
        if (!isCurrentConnection()) {
            return
        }
        revisionStateRef.current.markDraftChanged()
        isDirtyRef.current = true
        clearPreparedSave()
    }, [clearPreparedSave, isCurrentConnection])

    const handleVisualChange = useCallback((values: Partial<VisualConfigValues>) => {
        if (!isCurrentConnection() || saveNeedsReload) {
            return
        }
        markDraftChanged()
        setVisualValues(values)
    }, [isCurrentConnection, markDraftChanged, saveNeedsReload, setVisualValues])

    const loadConfig = useCallback(async (discardDraft = false) => {
        if (!isCurrentConnection()) {
            return
        }
        const request = revisionStateRef.current.beginLoad()
        if (!revisionStateRef.current.isCurrentGeneration(request)) {
            return
        }
        setLoading(true)
        setError('')
        try {
            const snapshot = await configFileApi.fetchConfigYaml()
            const merged   = snapshot.content
            if (!revisionStateRef.current.isCurrentRequest(request)) {
                return
            }

            preparedSaveRef.current = null
            setDiffModalOpen(false)
            setDiffOriginalYaml(snapshot.content)
            if (isDirtyRef.current && !discardDraft) {
                revisionStateRef.current.observeServerRevision()
                return
            }

            revisionStateRef.current.acceptServerRevision()
            isDirtyRef.current = false
            revisionStateRef.current.resetSource(snapshot.content)
            setSaveNeedsReload(false)
            setContent(merged)
            setDirty(false)
            setMergedYaml(merged)
            setValidationWarnings([])
            setValidationErrors([])
            loadVisualValuesFromYaml(merged, snapshot.content)
        } catch (err: unknown) {
            if (!revisionStateRef.current.isCurrentRequest(request)) {
                return
            }
            const message = err instanceof Error ? err.message : t('notification.refresh_failed')
            setError(message)
        } finally {
            if (revisionStateRef.current.isCurrentGeneration(request)) {
                setLoading(false)
            }
        }
    }, [isCurrentConnection, loadVisualValuesFromYaml, t])

    useEffect(() => {
        mountedRef.current = true
        return () => {
            mountedRef.current = false
        }
    }, [])

    useEffect(() => {
        const revisions = revisionStateRef
        const preparedSaves = preparedSaveRef
        const runtimeRequests = runtimeRequestSequenceRef
        let cancelled = false
        queueMicrotask(() => {
            if (cancelled || authGeneration !== apiClient.getAuthGeneration()) {
                return
            }
            if (revisions.current.snapshot().authGeneration !== authGeneration) {
                revisions.current.invalidate()
                revisions.current = new ConfigEditorRevisionState(() => apiClient.getAuthGeneration())
                preparedSaves.current = null
                isDirtyRef.current = false
                setContent('')
                setDirty(false)
                setSaving(false)
                setSaveNeedsReload(false)
                setDiffModalOpen(false)
                setDiffOriginalYaml('')
                setMergedYaml('')
                setValidationWarnings([])
                setValidationErrors([])
                loadVisualValuesFromYaml('')
            }
            if (connectionStatus !== 'connected') {
                setLoading(false)
                return
            }
            void loadConfig()
            void loadRuntimeInfo()
        })
        return () => {
            cancelled = true
            revisions.current.invalidate()
            preparedSaves.current = null
            ++runtimeRequests.current
        }
    }, [apiBase, managementKey, authGeneration, connectionStatus, loadConfig, loadRuntimeInfo, loadVisualValuesFromYaml])

    useEffect(() => {
        if (activeTab !== 'visual' || !visualParseError) {
            return
        }

        queueMicrotask(() => {
            if (!isCurrentConnection()) {
                return
            }
            setActiveTab('source')
            localStorage.setItem('config-management:tab', 'source')
            showNotification(
                t('config_management.visual_mode_unavailable_detail', { message: visualParseError }),
                'error',
            )
        })
    }, [activeTab, isCurrentConnection, showNotification, t, visualParseError])

    const handleConfirmSave = async () => {
        if (!isCurrentConnection()) {
            return
        }
        const prepared = preparedSaveRef.current
        if (disableControls || saveNeedsReload || !prepared || !revisionStateRef.current.matches(prepared.revision)) {
            clearPreparedSave()
            return
        }

        const request = revisionStateRef.current.beginSave()
        setSaving(true)
        try {
            const previousCommercialMode = readCommercialModeFromYaml(prepared.serverYaml)
            const nextCommercialMode     = readCommercialModeFromYaml(prepared.content)
            const commercialModeChanged  = previousCommercialMode !== nextCommercialMode
            const saveResult             = await configFileApi.saveConfigYaml(prepared.content, prepared.serverEtag)
            if (!revisionStateRef.current.isCurrentRequest(request)) {
                return
            }

            preparedSaveRef.current = null
            revisionStateRef.current.acceptServerRevision()
            isDirtyRef.current = false
            setDirty(false)
            setDiffModalOpen(false)
            revisionStateRef.current.resetSource(prepared.content)
            setContent(prepared.content)
            setDiffOriginalYaml(prepared.content)
            setMergedYaml(prepared.content)
            setValidationWarnings([])
            setValidationErrors([])
            loadVisualValuesFromYaml(prepared.content, prepared.content)
            allowNextNavigation()
            showNotification(t('config_management.save_success'), 'success')
            if (saveResult.cleanupError) {
                showNotification(
                    t('config_management.cleanup_warning', { message: saveResult.cleanupError }),
                    'warning',
                )
            }
            if (commercialModeChanged) {
                showNotification(t('notification.commercial_mode_restart_required'), 'warning')
            }

            const refreshRequest = revisionStateRef.current.beginLoad()
            try {
                clearConfigCache()
                await fetchConfig(undefined, true)
                if (!revisionStateRef.current.isCurrentRequest(refreshRequest)) {
                    return
                }

                const latestSnapshot = await configFileApi.fetchConfigYaml()
                const latestMerged   = latestSnapshot.content
                if (!revisionStateRef.current.isCurrentRequest(refreshRequest)) {
                    return
                }

                revisionStateRef.current.acceptServerRevision()
                isDirtyRef.current = false
                revisionStateRef.current.resetSource(latestSnapshot.content)
                setContent(latestMerged)
                setDiffOriginalYaml(latestSnapshot.content)
                setMergedYaml(latestMerged)
                loadVisualValuesFromYaml(latestMerged, latestSnapshot.content)
            } catch (refreshError: unknown) {
                if (!revisionStateRef.current.isCurrentRequest(refreshRequest)) {
                    return
                }
                const message = refreshError instanceof Error ? refreshError.message : ''
                showNotification(`${t('notification.refresh_failed')}: ${message}`, 'warning')
            }
        } catch (err: unknown) {
            if (!revisionStateRef.current.isCurrentRequest(request)) {
                return
            }
            if (apiErrorStatus(err) === 412) {
                preparedSaveRef.current = null
                try {
                    const latestSnapshot = await configFileApi.fetchConfigYaml()
                    if (!revisionStateRef.current.isCurrentRequest(request)) {
                        return
                    }

                    setDiffOriginalYaml(latestSnapshot.content)
                    let nextMergedYaml = prepared.content
                    let diffOriginal   = latestSnapshot.content
                    if (prepared.origin !== 'source') {
                        const latestDocument = parseDocument(latestSnapshot.content)
                        if (latestDocument.errors.length > 0) {
                            const message = t('config_management.visual_mode_latest_yaml_invalid', {
                                message:
                                    latestDocument.errors[0]?.message ??
                                    t('config_management.visual_mode_save_blocked'),
                            })
                            revisionStateRef.current.observeServerRevision()
                            preparedSaveRef.current = null
                            setDiffOriginalYaml(latestSnapshot.content)
                            setMergedYaml(prepared.content)
                            setValidationWarnings([])
                            setValidationErrors([{ field: '', message }])
                            setDiffModalOpen(true)
                            showNotification(t('config_management.config_changed'), 'warning')
                            return
                        }
                        nextMergedYaml = applyVisualChangesToYaml(latestSnapshot.content)
                        diffOriginal   = latestDocument.toString({ indent: 2, lineWidth: 120, minContentWidth: 0 })
                    }

                    let validation
                    try {
                        validation = await configFileApi.validateConfigYaml(nextMergedYaml)
                    } catch (validationError: unknown) {
                        if (!revisionStateRef.current.isCurrentRequest(request)) {
                            return
                        }
                        const detail  = validationError instanceof Error ?
                                        validationError.message :
                                        t('config_management.validation_unavailable')
                        const message = t('config_management.validation_unavailable_message', { message: detail })
                        revisionStateRef.current.observeServerRevision()
                        preparedSaveRef.current = null
                        setDiffOriginalYaml(diffOriginal)
                        setMergedYaml(nextMergedYaml)
                        setValidationWarnings([])
                        setValidationErrors([{ field: '', message }])
                        setDiffModalOpen(true)
                        showNotification(t('config_management.config_changed'), 'warning')
                        showNotification(message, 'error')
                        return
                    }
                    if (!revisionStateRef.current.isCurrentRequest(request)) {
                        return
                    }

                    const revision                         = revisionStateRef.current.observeServerRevision()
                    const nextPrepared: PreparedConfigSave = {
                        revision,
                        origin: prepared.origin,
                        content: nextMergedYaml,
                        serverYaml: latestSnapshot.content,
                        diffOriginalYaml: diffOriginal,
                        serverEtag: latestSnapshot.etag,
                    }
                    preparedSaveRef.current                = nextPrepared
                    setDiffOriginalYaml(nextPrepared.diffOriginalYaml)
                    setMergedYaml(nextPrepared.content)
                    setValidationErrors(validation.valid ? [] : (validation.errors ?? []))
                    setValidationWarnings(validation.warnings ?? [])
                    setDiffModalOpen(true)
                    showNotification(t('config_management.config_changed'), 'warning')
                    return
                } catch (reloadError: unknown) {
                    if (!revisionStateRef.current.isCurrentRequest(request)) {
                        return
                    }
                    revisionStateRef.current.observeServerRevision()
                    setMergedYaml(prepared.content)
                    setDiffModalOpen(true)
                    const message = reloadError instanceof Error ? reloadError.message : ''
                    setValidationErrors([{ field: '', message }])
                    showNotification(`${t('notification.refresh_failed')}: ${message}`, 'error')
                    return
                }
            }
            const status = apiErrorStatus(err)
            if (status === undefined || status >= 500 || status === 408) {
                clearPreparedSave()
                setSaveNeedsReload(true)
                try {
                    const latestSnapshot = await configFileApi.fetchConfigYaml()
                    if (!revisionStateRef.current.isCurrentRequest(request)) {
                        return
                    }
                    setDiffOriginalYaml(latestSnapshot.content)
                    const data = (err as {data?: {error?: unknown}} | null)?.data
                    if (status === 503 && data?.error === 'runtime_sync_failed') {
                        revisionStateRef.current.acceptServerRevision()
                        revisionStateRef.current.resetSource(latestSnapshot.content)
                        isDirtyRef.current = false
                        setDirty(false)
                        setContent(latestSnapshot.content)
                        setMergedYaml(latestSnapshot.content)
                        setValidationWarnings([])
                        setValidationErrors([])
                        setError('')
                        setSaveNeedsReload(false)
                        loadVisualValuesFromYaml(latestSnapshot.content, latestSnapshot.content)
                        clearConfigCache()
                        showNotification(t('config_management.save_committed_runtime_failed'), 'error')
                        try {
                            await fetchConfig(undefined, true)
                        } catch (refreshError: unknown) {
                            if (!revisionStateRef.current.isCurrentGeneration(request)) {
                                return
                            }
                            const message = refreshError instanceof Error ? refreshError.message : ''
                            showNotification(`${t('notification.refresh_failed')}: ${message}`, 'warning')
                        }
                        return
                    }
                } catch (reloadError: unknown) {
                    if (!revisionStateRef.current.isCurrentRequest(request)) {
                        return
                    }
                    const message = reloadError instanceof Error ? reloadError.message : ''
                    showNotification(`${t('notification.refresh_failed')}: ${message}`, 'error')
                }
                setError(t('config_management.save_result_uncertain'))
                showNotification(t('config_management.save_result_uncertain'), 'error')
                return
            }
            const message = err instanceof Error ? err.message : ''
            showNotification(`${t('notification.save_failed')}: ${message}`, 'error')
        } finally {
            if (revisionStateRef.current.isCurrentGeneration(request)) {
                setSaving(false)
            }
        }
    }

    const handleSave = async () => {
        if (!isCurrentConnection()) {
            return
        }
        if (saveNeedsReload) {
            showNotification(t('config_management.save_result_uncertain'), 'error')
            return
        }
        if (disableControls || !revisionStateRef.current.matches(revisionStateRef.current.snapshot())) {
            clearPreparedSave()
            return
        }
        if (activeTab === 'visual' && revisionStateRef.current.sourceDirty) {
            showNotification(t('config_management.source_changes_before_visual'), 'warning')
            return
        }
        if (activeTab === 'visual' && visualParseError) {
            showNotification(t('config_management.visual_mode_save_blocked'), 'error')
            return
        }

        const mode              = activeTab
        const origin: ConfigEditorTab = revisionStateRef.current.sourceDirty || revisionStateRef.current.sourceNeedsReload ? 'source' : 'visual'
        const request           = revisionStateRef.current.beginSave()
        preparedSaveRef.current = null
        setDiffModalOpen(false)
        setLoading(false)
        setSaving(true)
        try {
            const latestSnapshot   = await configFileApi.fetchConfigYaml()
            const latestServerYaml = latestSnapshot.content
            if (!revisionStateRef.current.isCurrentRequest(request)) {
                return
            }

            let latestDocument: ReturnType<typeof parseDocument> | null = null
            if (origin !== 'source') {
                latestDocument = parseDocument(latestServerYaml)
                if (latestDocument.errors.length > 0) {
                    revisionStateRef.current.observeServerRevision()
                    setDiffOriginalYaml(latestServerYaml)
                    showNotification(
                        t('config_management.visual_mode_latest_yaml_invalid', {
                            message:
                                latestDocument.errors[0]?.message ?? t('config_management.visual_mode_save_blocked'),
                        }),
                        'error',
                    )
                    return
                }
            }

            const nextMergedYaml = revisionStateRef.current.buildSaveDraft(latestServerYaml, mode, applyVisualChangesToYaml)

            let validation
            try {
                validation = await configFileApi.validateConfigYaml(nextMergedYaml)
            } catch (validationError: unknown) {
                if (!revisionStateRef.current.isCurrentRequest(request)) {
                    return
                }
                const message = validationError instanceof Error ?
                                validationError.message :
                                t('config_management.validation_unavailable')
                revisionStateRef.current.observeServerRevision()
                setDiffOriginalYaml(
                    latestDocument ?
                    latestDocument.toString({ indent: 2, lineWidth: 120, minContentWidth: 0 }) :
                    latestServerYaml,
                )
                showNotification(
                    t('config_management.validation_unavailable_message', { message }),
                    'error',
                )
                return
            }
            if (!revisionStateRef.current.isCurrentRequest(request)) {
                return
            }

            setValidationErrors(validation.valid ? [] : (validation.errors ?? []))
            setValidationWarnings(validation.warnings ?? [])

            // Normalize the visual diff without replacing the raw server snapshot.
            const diffOriginal = latestDocument ?
                                 latestDocument.toString({ indent: 2, lineWidth: 120, minContentWidth: 0 }) :
                                 latestServerYaml

            if (diffOriginal === nextMergedYaml) {
                revisionStateRef.current.acceptServerRevision()
                isDirtyRef.current = false
                setDirty(false)
                revisionStateRef.current.resetSource(latestServerYaml)
                setContent(latestServerYaml)
                setDiffOriginalYaml(latestServerYaml)
                setMergedYaml(nextMergedYaml)
                loadVisualValuesFromYaml(latestServerYaml, latestServerYaml)
                showNotification(t('config_management.diff.no_changes'), 'info')
                return
            }

            const revision                     = revisionStateRef.current.observeServerRevision()
            const prepared: PreparedConfigSave = {
                revision,
                origin,
                content: nextMergedYaml,
                serverYaml: latestServerYaml,
                diffOriginalYaml: diffOriginal,
                serverEtag: latestSnapshot.etag,
            }
            preparedSaveRef.current            = prepared
            setDiffOriginalYaml(prepared.diffOriginalYaml)
            setMergedYaml(prepared.content)
            setDiffModalOpen(true)
        } catch (err: unknown) {
            if (!revisionStateRef.current.isCurrentRequest(request)) {
                return
            }
            const message = err instanceof Error ? err.message : ''
            showNotification(`${t('notification.save_failed')}: ${message}`, 'error')
        } finally {
            if (revisionStateRef.current.isCurrentGeneration(request)) {
                setSaving(false)
            }
        }
    }

    const handleChange = useCallback((value: string) => {
        if (!isCurrentConnection() || saveNeedsReload) {
            return
        }
        const revisions = revisionStateRef.current
        if (!revisions.editSource(value)) {
            return
        }
        markDraftChanged()
        setContent(value)
        setDirty(revisions.sourceDirty)
        if (!revisions.sourceDirty && revisions.sourceNeedsReload) {
            const result = loadVisualValuesFromYaml(value, value)
            if (result.ok) {
                revisions.acceptVisualSource()
            }
        }
    }, [isCurrentConnection, loadVisualValuesFromYaml, markDraftChanged, saveNeedsReload])

    const handleTabChange = useCallback(
        (tab: ConfigEditorTab) => {
            if (!isCurrentConnection() || tab === activeTab) {
                return
            }
            if (tab === 'visual' && revisionStateRef.current.sourceDirty) {
                showNotification(t('config_management.source_changes_before_visual'), 'warning')
                return
            }

            clearPreparedSave()
            if (tab === 'source') {
                if (visualDirty && hasVisualValidationErrors) {
                    showNotification(t('config_management.visual.validation.validation_blocked'), 'error')
                    return
                }

                // Only rewrite YAML when there are pending visual changes; otherwise preserve raw YAML + comments.
                {
                    let nextContent: string
                    try {
                        nextContent = revisionStateRef.current.materializeSource(applyVisualChangesToYaml)
                    } catch (err: unknown) {
                        const message = err instanceof Error ?
                                        err.message :
                                        t('config_management.visual_mode_save_blocked')
                        showNotification(
                            t('config_management.visual_mode_unavailable_detail', { message }),
                            'error',
                        )
                        return
                    }
                    if (nextContent !== content) {
                        setContent(nextContent)
                    }
                }
            } else if (revisionStateRef.current.sourceNeedsReload || visualParseError) {
                const result = loadVisualValuesFromYaml(content, content)
                if (!result.ok) {
                    showNotification(
                        t('config_management.visual_mode_unavailable_detail', { message: result.error }),
                        'error',
                    )
                    return
                }
                revisionStateRef.current.acceptVisualSource()
            }

            setActiveTab(tab)
            localStorage.setItem('config-management:tab', tab)
        },
        [
            activeTab,
            applyVisualChangesToYaml,
            clearPreparedSave,
            content,
            hasVisualValidationErrors,
            isCurrentConnection,
            loadVisualValuesFromYaml,
            showNotification,
            t,
            visualDirty,
            visualParseError,
        ],
    )

    useEffect(() => {
        if (!isCurrentConnection() || !requestedField || loading || saving || (activeTab === 'visual' && visualParseError)) {
            return
        }

        const requestKey = `${location.key}:${requestedField.fieldId}`
        if (handledFieldRequestRef.current === requestKey) {
            return
        }
        if (activeTab !== 'visual') {
            if (pendingFieldRequestRef.current !== requestKey) {
                pendingFieldRequestRef.current = requestKey
                queueMicrotask(() => {
                    if (!isCurrentConnection()) {
                        return
                    }
                    pendingFieldRequestRef.current = ''
                    handleTabChange('visual')
                })
            }
            return
        }

        handledFieldRequestRef.current = requestKey
        queueMicrotask(() => {
            if (!isCurrentConnection()) {
                return
            }
            setFieldJumpRequest({ key: requestKey, entry: requestedField })
            const params = new URLSearchParams(location.search)
            params.delete('field')
            const search = params.toString()
            allowNextNavigation()
            void navigate({
                              pathname: location.pathname,
                              search: search ? `?${search}` : '',
                              hash: location.hash,
                          }, { replace: true })
        })
    }, [
        activeTab,
        allowNextNavigation,
        handleTabChange,
        isCurrentConnection,
        loading,
        location.hash,
        location.key,
        location.pathname,
        location.search,
        navigate,
        requestedField,
        saving,
        visualParseError,
    ])

    // Search functionality
    const performSearch = useCallback((query: string, direction: 'next' | 'prev' = 'next') => {
        if (!query || !editorRef.current?.view) {
            return
        }

        const view              = editorRef.current.view
        const doc               = view.state.doc.toString()
        const matches: number[] = []
        const lowerQuery        = query.toLowerCase()
        const lowerDoc          = doc.toLowerCase()

        let pos = 0
        while (pos < lowerDoc.length) {
            const index = lowerDoc.indexOf(lowerQuery, pos)
            if (index === -1) {
                break
            }
            matches.push(index)
            pos = index + 1
        }

        if (matches.length === 0) {
            setSearchResults({ current: 0, total: 0 })
            return
        }

        // Find current match based on cursor position
        const selection  = view.state.selection.main
        const cursorPos  = direction === 'prev' ? selection.from : selection.to
        let currentIndex = 0

        if (direction === 'next') {
            // Find next match after cursor
            for (let i = 0; i < matches.length; i++) {
                if (matches[i] > cursorPos) {
                    currentIndex = i
                    break
                }
                // If no match after cursor, wrap to first
                if (i === matches.length - 1) {
                    currentIndex = 0
                }
            }
        } else {
            // Find previous match before cursor
            for (let i = matches.length - 1; i >= 0; i--) {
                if (matches[i] < cursorPos) {
                    currentIndex = i
                    break
                }
                // If no match before cursor, wrap to last
                if (i === 0) {
                    currentIndex = matches.length - 1
                }
            }
        }

        const matchPos = matches[currentIndex]
        setSearchResults({ current: currentIndex + 1, total: matches.length })

        // Scroll to and select the match
        view.dispatch({
                          selection: { anchor: matchPos, head: matchPos + query.length },
                          scrollIntoView: true,
                      })
        view.focus()
    }, [])

    const handleSearchChange = useCallback((value: string) => {
        setSearchQuery(value)
        // Do not auto-search on each keystroke. Clear previous results when query changes.
        if (!value) {
            setSearchResults({ current: 0, total: 0 })
            setLastSearchedQuery('')
        } else {
            setSearchResults({ current: 0, total: 0 })
        }
    }, [])

    const executeSearch = useCallback(
        (direction: 'next' | 'prev' = 'next') => {
            if (!searchQuery) {
                return
            }
            setLastSearchedQuery(searchQuery)
            performSearch(searchQuery, direction)
        },
        [searchQuery, performSearch],
    )

    const handleSearchKeyDown = useCallback(
        (e: ReactKeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Enter') {
                e.preventDefault()
                executeSearch(e.shiftKey ? 'prev' : 'next')
            }
        },
        [executeSearch],
    )

    const handlePrevMatch = useCallback(() => {
        if (!lastSearchedQuery) {
            return
        }
        performSearch(lastSearchedQuery, 'prev')
    }, [lastSearchedQuery, performSearch])

    const handleNextMatch = useCallback(() => {
        if (!lastSearchedQuery) {
            return
        }
        performSearch(lastSearchedQuery, 'next')
    }, [lastSearchedQuery, performSearch])

    // Keep bottom floating actions from covering page content by syncing its height to a CSS variable.
    useLayoutEffect(() => {
        if (typeof window === 'undefined') {
            return
        }

        const actionsEl = floatingActionsRef.current
        if (!actionsEl) {
            return
        }

        const updatePadding = () => {
            const height = actionsEl.getBoundingClientRect().height
            document.documentElement.style.setProperty('--config-action-bar-height', `${height}px`)
        }

        updatePadding()
        window.addEventListener('resize', updatePadding)

        const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updatePadding)
        ro?.observe(actionsEl)

        return () => {
            ro?.disconnect()
            window.removeEventListener('resize', updatePadding)
            document.documentElement.style.removeProperty('--config-action-bar-height')
        }
    }, [])

    // CodeMirror extensions
    const extensions = useMemo(() => [yaml(), search(), highlightSelectionMatches(), keymap.of(searchKeymap)], [])

    // Status text
    const getStatusText = () => {
        if (disableControls) {
            return t('config_management.status_disconnected')
        }
        if (loading) {
            return t('config_management.status_loading')
        }
        if (saveNeedsReload) {
            return t('config_management.status_save_failed')
        }
        if (error) {
            return t('config_management.status_load_failed')
        }
        if (hasVisualModeError) {
            return t('config_management.visual_mode_unavailable')
        }
        if (hasVisualValidationErrors) {
            return t('config_management.visual.validation.validation_blocked')
        }
        if (saving) {
            return t('config_management.status_saving')
        }
        if (isDirty) {
            return t('config_management.status_dirty')
        }
        return t('config_management.status_loaded')
    }

    const getStatusClass = () => {
        if (error || saveNeedsReload || hasVisualModeError || hasVisualValidationErrors) {
            return styles.error
        }
        if (isDirty) {
            return styles.modified
        }
        if (!loading && !saving) {
            return styles.saved
        }
        return ''
    }

    const handleReload = useCallback(() => {
        if (!isCurrentConnection()) {
            return
        }
        if (!isDirty) {
            void Promise.all([loadConfig(), loadRuntimeInfo()])
            return
        }

        showConfirmation({
                             title: t('common.unsaved_changes_title'),
                             message: t('config_management.reload_confirm_message'),
                             confirmText: t('config_management.reload'),
                             cancelText: t('common.cancel'),
                             variant: 'danger',
                             onConfirm: () => {
                                 void Promise.all([loadConfig(true), loadRuntimeInfo()])
                             },
                         })
    }, [isCurrentConnection, isDirty, loadConfig, loadRuntimeInfo, showConfirmation, t])

    const shouldShowFloatingActions =
              isDirty || saving || loading || Boolean(error) || hasVisualModeError || hasVisualValidationErrors

    const floatingActions = shouldShowFloatingActions ? (
        <div className={styles.floatingActionContainer} ref={floatingActionsRef}>
            <div className={styles.floatingActionList}>
                <div className={`${styles.floatingStatus} ${getStatusClass()}`}>{getStatusText()}</div>
                <button
                    type='button'
                    className={styles.floatingActionButton}
                    onClick={handleReload}
                    disabled={loading || saving}
                    title={t('config_management.reload')}
                    aria-label={t('config_management.reload')}
                >
                    <IconRefreshCw size={16} />
                </button>
                <button
                    type='button'
                    className={styles.floatingActionButton}
                    onClick={handleSave}
                    disabled={
                        disableControls ||
                        loading ||
                        saving ||
                        saveNeedsReload ||
                        !isDirty ||
                        diffModalOpen ||
                        hasVisualModeError ||
                        hasVisualValidationErrors
                    }
                    title={t('config_management.save')}
                    aria-label={t('config_management.save')}
                >
                    <IconCheck size={16} />
                    {isDirty && <span className={styles.dirtyDot} aria-hidden='true' />}
                </button>
            </div>
        </div>
    ) : null

    const pageEyebrow     =
              activeTab === 'visual'
              ? t('config_management.tabs.visual', { defaultValue: '可视化编辑' })
              : t('config_management.tabs.source', { defaultValue: '源文件编辑' })
    const pageDescription =
              activeTab === 'visual' ? t('config_management.visual.notice') : t('config_management.description')

    return (
        <div className={styles.container}>
            <div className={styles.pageHeader}>
                <div className={styles.pageHeaderCopy}>
                    <span className={styles.pageEyebrow}>{pageEyebrow}</span>
                    <h1 className={styles.pageTitle}>{t('config_management.title')}</h1>
                    <p className={styles.description}>{pageDescription}</p>
                </div>

                <div className={styles.pageMeta}>
                    <div className={`${styles.statusBadge} ${getStatusClass()}`}>{getStatusText()}</div>
                </div>
            </div>

            <div className={styles.configToolbar}>
                <Tabs
                    items={[
                        {
                            value: 'visual',
                            label: t('config_management.tabs.visual', { defaultValue: '可视化编辑' }),
                            disabled: saving || loading,
                        },
                        {
                            value: 'source',
                            label: t('config_management.tabs.source', { defaultValue: '源代码编辑' }),
                            disabled: saving || loading,
                        },
                    ]}
                    activeValue={activeTab}
                    onChange={handleTabChange}
                    ariaLabel={t('config_management.title')}
                />
            </div>

            <div className={styles.workspaceShell}>
                <div className={styles.content}>
                    {error && <div className='error-box'>{error}</div>}
                    {!error && visualParseError && (
                        <div className='error-box'>
                            {t('config_management.visual_mode_unavailable_detail', { message: visualParseError })}
                        </div>
                    )}

                    {activeTab === 'visual' ? (
                        <VisualConfigEditor
                            values={visualValues}
                            validationErrors={visualValidationErrors}
                            hasPayloadValidationErrors={visualHasPayloadValidationErrors}
                            disabled={disableControls || loading || saving || saveNeedsReload}
                            runtimeInfo={runtimeInfo}
                            requestedField={fieldJumpRequest?.entry}
                            requestedFieldRequestKey={fieldJumpRequest?.key}
                            onChange={handleVisualChange}
                        />
                    ) : (
                         <div className={styles.sourceWorkspace}>
                             <div className={styles.sourceToolbar}>
                                 <div className={styles.searchInputWrapper}>
                                     <Input
                                         value={searchQuery}
                                         onChange={(e) => handleSearchChange(e.target.value)}
                                         onKeyDown={handleSearchKeyDown}
                                         placeholder={t('config_management.search_placeholder', {
                                             defaultValue: '搜索配置内容...',
                                         })}
                                         disabled={disableControls || loading || saving}
                                         className={styles.searchInput}
                                         rightElement={
                                             <div className={styles.searchRight}>
                                                 {searchQuery && lastSearchedQuery === searchQuery && (
                                                     <span className={styles.searchCount}>
                                                        {searchResults.total > 0
                                                         ? `${searchResults.current} / ${searchResults.total}`
                                                         : t('config_management.search_no_results', {
                                                                defaultValue: '无结果',
                                                            })}
                                                    </span>
                                                 )}
                                                 <button
                                                     type='button'
                                                     className={styles.searchButton}
                                                     onClick={() => executeSearch('next')}
                                                     disabled={!searchQuery || disableControls || loading || saving}
                                                     title={t('config_management.search_button', {
                                                         defaultValue: '搜索',
                                                     })}
                                                 >
                                                     <IconSearch size={16} />
                                                 </button>
                                             </div>
                                         }
                                     />
                                 </div>

                                 <div className={styles.searchActions}>
                                     <Button
                                         variant='secondary'
                                         size='sm'
                                         onClick={handlePrevMatch}
                                         disabled={
                                             !searchQuery ||
                                             lastSearchedQuery !== searchQuery ||
                                             searchResults.total === 0
                                         }
                                         title={t('config_management.search_prev', { defaultValue: '上一个' })}
                                     >
                                         <IconChevronUp size={16} />
                                     </Button>
                                     <Button
                                         variant='secondary'
                                         size='sm'
                                         onClick={handleNextMatch}
                                         disabled={
                                             !searchQuery ||
                                             lastSearchedQuery !== searchQuery ||
                                             searchResults.total === 0
                                         }
                                         title={t('config_management.search_next', { defaultValue: '下一个' })}
                                     >
                                         <IconChevronDown size={16} />
                                     </Button>
                                 </div>
                             </div>

                             <div className={styles.editorWrapper}>
                                 <CodeMirror
                                     ref={editorRef}
                                     value={content}
                                     onChange={handleChange}
                                     extensions={extensions}
                                     theme={resolvedTheme}
                                     editable={!disableControls && !loading && !saving && !saveNeedsReload}
                                     readOnly={saveNeedsReload}
                                     placeholder={t('config_management.editor_placeholder')}
                                     height='100%'
                                     style={{ height: '100%' }}
                                     basicSetup={{
                                         lineNumbers: true,
                                         highlightActiveLineGutter: true,
                                         highlightActiveLine: true,
                                         foldGutter: true,
                                         dropCursor: true,
                                         allowMultipleSelections: true,
                                         indentOnInput: true,
                                         bracketMatching: true,
                                         closeBrackets: true,
                                         autocompletion: false,
                                         rectangularSelection: true,
                                         crosshairCursor: false,
                                         highlightSelectionMatches: true,
                                         closeBracketsKeymap: true,
                                         searchKeymap: true,
                                         foldKeymap: true,
                                         completionKeymap: false,
                                         lintKeymap: true,
                                     }}
                                 />
                             </div>
                         </div>
                     )}
                </div>
            </div>

            {typeof document !== 'undefined' ? createPortal(floatingActions, document.body) : null}
            <DiffModal
                open={diffModalOpen}
                original={diffOriginalYaml}
                modified={mergedYaml}
                onConfirm={handleConfirmSave}
                onCancel={clearPreparedSave}
                loading={saving}
                warnings={validationWarnings}
                errors={validationErrors}
            />
        </div>
    )
}
