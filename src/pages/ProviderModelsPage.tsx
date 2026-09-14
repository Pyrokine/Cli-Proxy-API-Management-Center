import {Button} from '@/components/ui/Button'
import {Card} from '@/components/ui/Card'
import type {ModelEntry} from '@/components/ui/modelInputListUtils'
import {useEdgeSwipeBack} from '@/hooks/useEdgeSwipeBack'
import {useProviderEditPresentation} from '@/hooks/useProviderEditPresentation'
import type {ModelInfo} from '@/utils/models'
import {canApplyDiscoveredModels, findMissingProviderModelNames} from '@/utils/providerModels'
import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {useNavigate} from 'react-router-dom'
import {ProviderModelSelectionContent} from './ModelDiscoveryModal'
import {ProviderPresentationShell} from './ProviderEditShell'
import layoutStyles from './ProviderEditLayout.module.scss'

export type ProviderModelsPageProps = {
    /** i18n key prefix, e.g. "claude_models" or "openai_models" */
    i18nPrefix: string
    disableControls: boolean
    initialLoading: boolean
    saving: boolean
    configuredModelEntries: ModelEntry[]
    mergeDiscoveredModels: (selectedModels: ModelInfo[]) => void
    /** Build the display endpoint URL from the current base URL */
    buildEndpoint: () => string
    /** Perform the model discovery fetch; returns the model list */
    fetchModels: (signal: AbortSignal) => Promise<ModelInfo[]>
    /** Dependencies that trigger endpoint recalculation and auto-fetch */
    fetchDeps: readonly unknown[]
    /** Whether auto-fetch should proceed (e.g. credentials are present) */
    canAutoFetch: () => boolean
    /** Optional: build a dedup signature to prevent redundant auto-fetches */
    buildAutoFetchSignature?: () => string
    /** Optional: build extra error diagnostic string */
    buildErrorDiagnostic?: (message: string) => string
    fetchTitle?: string
    fetchHint?: string
    fetchLoadingLabel?: string
    fetchEmptyLabel?: string
    fetchErrorLabel?: string
}

export function ProviderModelsPage({
                                       i18nPrefix,
                                       disableControls,
                                       initialLoading,
                                       saving,
                                       configuredModelEntries,
                                       mergeDiscoveredModels,
                                       buildEndpoint,
                                       fetchModels,
                                       fetchDeps,
                                       canAutoFetch,
                                       buildAutoFetchSignature,
                                       buildErrorDiagnostic,
                                       fetchTitle,
                                       fetchHint,
                                       fetchLoadingLabel,
                                       fetchEmptyLabel,
                                       fetchErrorLabel,
                                   }: ProviderModelsPageProps) {
    const { t }        = useTranslation()
    const navigate     = useNavigate()
    const presentation = useProviderEditPresentation()

    const [endpoint, setEndpoint] = useState('')
    const [models, setModels]     = useState<ModelInfo[]>([])
    const [fetching, setFetching] = useState(false)
    const [error, setError]       = useState('')
    const [search, setSearch]     = useState('')
    const [selected, setSelected] = useState<Set<string>>(new Set())
    const autoFetchSignatureRef   = useRef('')
    const requestGenerationRef    = useRef(0)
    const requestControllerRef    = useRef<AbortController | null>(null)

    const filteredModels = useMemo(() => {
        const filter = search.trim().toLowerCase()
        const sorted = [...models].sort((a, b) => (a.name || '').localeCompare(b.name || ''))
        if (!filter) {
            return sorted
        }
        return sorted.filter((model) => {
            const name  = (model.name || '').toLowerCase()
            const alias = (model.alias || '').toLowerCase()
            const desc  = (model.description || '').toLowerCase()
            return name.includes(filter) || alias.includes(filter) || desc.includes(filter)
        })
    }, [models, search])

    const missingModelNames = useMemo(
        () => findMissingProviderModelNames(configuredModelEntries, models),
        [configuredModelEntries, models],
    )

    const doFetch = useCallback(async () => {
        requestControllerRef.current?.abort()
        const controller             = new AbortController()
        requestControllerRef.current = controller
        const generation             = ++requestGenerationRef.current
        setFetching(true)
        setError('')
        try {
            const list = await fetchModels(controller.signal)
            if (requestGenerationRef.current !== generation || controller.signal.aborted) {
                return
            }
            setModels(list)
            setSelected(findMissingProviderModelNames(configuredModelEntries, list))
        } catch (err: unknown) {
            if (requestGenerationRef.current !== generation || controller.signal.aborted) {
                return
            }
            setModels([])
            const message = err instanceof Error ? err.message : typeof err === 'string' ? err : ''
            const diag    = buildErrorDiagnostic?.(message) ?? ''
            setError(`${fetchErrorLabel ?? t(`ai_providers.${i18nPrefix}_fetch_error`)}: ${message}${diag}`)
        } finally {
            if (requestControllerRef.current === controller) {
                requestControllerRef.current = null
            }
            if (requestGenerationRef.current === generation) {
                setFetching(false)
            }
        }
    }, [buildErrorDiagnostic, configuredModelEntries, fetchErrorLabel, fetchModels, i18nPrefix, t])

    // Reset state and auto-fetch when dependencies change
    useEffect(() => {
        if (initialLoading) {
            return
        }

        requestControllerRef.current?.abort()
        requestControllerRef.current = null
        ++requestGenerationRef.current

        queueMicrotask(() => {
            setFetching(false)
            setEndpoint(buildEndpoint())
            setModels([])
            setSearch('')
            setSelected(new Set())
            setError('')

            if (!canAutoFetch()) {
                return
            }

            if (buildAutoFetchSignature) {
                const signature = buildAutoFetchSignature()
                if (autoFetchSignatureRef.current === signature) {
                    return
                }
                autoFetchSignatureRef.current = signature
            }

            void doFetch()
        })
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [initialLoading, ...fetchDeps])

    useEffect(
        () => () => {
            requestControllerRef.current?.abort()
        },
        [],
    )

    const handleBack = useCallback(() => {
        if (presentation) {
            navigate(-1)
            return
        }
        navigate('..', { replace: true })
    }, [navigate, presentation])

    const swipeRef = useEdgeSwipeBack({ onBack: handleBack })

    useEffect(() => {
        if (presentation) {
            return
        }
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                handleBack()
            }
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [handleBack, presentation])

    const toggleSelection = (name: string) => {
        setSelected((prev) => {
            const next = new Set(prev)
            if (next.has(name)) {
                next.delete(name)
            } else {
                next.add(name)
            }
            return next
        })
    }

    const selectMissingModels = () => {
        setSelected(new Set(missingModelNames))
    }

    const handleApply = () => {
        const selectedModels = models.filter((model) => selected.has(model.name))
        if (selectedModels.length) {
            mergeDiscoveredModels(selectedModels)
        }
        handleBack()
    }

    const canApply = canApplyDiscoveredModels(selected.size, disableControls, saving, fetching)

    const title             = fetchTitle ?? t(`ai_providers.${i18nPrefix}_fetch_title`)
    const renderApplyAction = () => (
        <Button
            size='sm'
            onClick={handleApply}
            disabled={!canApply}
            className={layoutStyles.floatingSaveButton}
        >
            {t(`ai_providers.${i18nPrefix}_fetch_apply`)}{selected.size > 0 ? ` (${selected.size})` : ''}
        </Button>
    )
    const content           = (
        <Card>
            <ProviderModelSelectionContent
                i18nPrefix={i18nPrefix}
                endpoint={endpoint}
                discoveredModels={models}
                filteredModels={filteredModels}
                fetching={fetching}
                error={error}
                search={search}
                onSearchChange={setSearch}
                selected={selected}
                missingCount={missingModelNames.size}
                onToggleSelection={toggleSelection}
                onSelectMissing={selectMissingModels}
                onRefresh={() => void doFetch()}
                disabled={disableControls || saving}
                hint={fetchHint}
                loadingLabel={fetchLoadingLabel}
                emptyLabel={fetchEmptyLabel}
            />
        </Card>
    )

    return (
        <ProviderPresentationShell
            title={title}
            loading={initialLoading}
            closeDisabled={saving}
            onBack={handleBack}
            swipeRef={swipeRef}
            presentation={presentation}
            returnFocusId={presentation?.childReturnFocusId}
            renderPrimaryAction={renderApplyAction}
        >
            {content}
        </ProviderPresentationShell>
    )
}
