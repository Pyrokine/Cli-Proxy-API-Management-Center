import {SecondaryScreenShell} from '@/components/common/SecondaryScreenShell'
import {Button} from '@/components/ui/Button'
import {Card} from '@/components/ui/Card'
import {Input} from '@/components/ui/Input'
import {useEdgeSwipeBack} from '@/hooks/useEdgeSwipeBack'
import type {ModelInfo} from '@/utils/models'
import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {useNavigate} from 'react-router-dom'
import {ModelCheckboxList} from './ModelCheckboxList'
import styles from './ProviderEditForm.module.scss'
import layoutStyles from './ProviderEditLayout.module.scss'

export type ProviderModelsPageProps = {
    /** i18n key prefix, e.g. "claude_models" or "openai_models" */
    i18nPrefix: string
    disableControls: boolean
    initialLoading: boolean
    saving: boolean
    mergeDiscoveredModels: (selectedModels: ModelInfo[]) => void
    /** Build the display endpoint URL from the current base URL */
    buildEndpoint: () => string
    /** Perform the model discovery fetch; returns the model list */
    fetchModels: () => Promise<ModelInfo[]>
    /** Dependencies that trigger endpoint recalculation and auto-fetch */
    fetchDeps: readonly unknown[]
    /** Whether auto-fetch should proceed (e.g. credentials are present) */
    canAutoFetch: () => boolean
    /** Optional: build a dedup signature to prevent redundant auto-fetches */
    buildAutoFetchSignature?: () => string
    /** Optional: build extra error diagnostic string */
    buildErrorDiagnostic?: (message: string) => string
}

export function ProviderModelsPage({
                                       i18nPrefix,
                                       disableControls,
                                       initialLoading,
                                       saving,
                                       mergeDiscoveredModels,
                                       buildEndpoint,
                                       fetchModels,
                                       fetchDeps,
                                       canAutoFetch,
                                       buildAutoFetchSignature,
                                       buildErrorDiagnostic,
                                   }: ProviderModelsPageProps) {
    const { t }    = useTranslation()
    const navigate = useNavigate()

    const [endpoint, setEndpoint] = useState('')
    const [models, setModels]     = useState<ModelInfo[]>([])
    const [fetching, setFetching] = useState(false)
    const [error, setError]       = useState('')
    const [search, setSearch]     = useState('')
    const [selected, setSelected] = useState<Set<string>>(new Set())
    const autoFetchSignatureRef   = useRef('')

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

    const doFetch = useCallback(async () => {
        setFetching(true)
        setError('')
        try {
            const list = await fetchModels()
            setModels(list)
        } catch (err: unknown) {
            setModels([])
            const message = err instanceof Error ? err.message : typeof err === 'string' ? err : ''
            const diag    = buildErrorDiagnostic?.(message) ?? ''
            setError(`${t(`ai_providers.${i18nPrefix}_fetch_error`)}: ${message}${diag}`)
        } finally {
            setFetching(false)
        }
    }, [buildErrorDiagnostic, fetchModels, i18nPrefix, t])

    // Reset state and auto-fetch when dependencies change
    useEffect(() => {
        if (initialLoading) {
            return
        }

        queueMicrotask(() => {
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

    const handleBack = useCallback(() => {
        navigate(-1)
    }, [navigate])

    const swipeRef = useEdgeSwipeBack({ onBack: handleBack })

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                handleBack()
            }
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [handleBack])

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

    const handleApply = () => {
        const selectedModels = models.filter((model) => selected.has(model.name))
        if (selectedModels.length) {
            mergeDiscoveredModels(selectedModels)
        }
        handleBack()
    }

    const canApply = !disableControls && !saving && !fetching

    return (
        <SecondaryScreenShell
            ref={swipeRef}
            contentClassName={layoutStyles.content}
            title={t(`ai_providers.${i18nPrefix}_fetch_title`)}
            onBack={handleBack}
            backLabel={t('common.back')}
            backAriaLabel={t('common.back')}
            hideTopBarBackButton
            hideTopBarRightAction
            floatingAction={
                <div className={layoutStyles.floatingActions}>
                    <Button
                        variant='secondary'
                        size='sm'
                        onClick={handleBack}
                        className={layoutStyles.floatingBackButton}
                    >
                        {t('common.back')}
                    </Button>
                    <Button
                        size='sm'
                        onClick={handleApply}
                        disabled={!canApply}
                        className={layoutStyles.floatingSaveButton}
                    >
                        {t(`ai_providers.${i18nPrefix}_fetch_apply`)}
                    </Button>
                </div>
            }
            isLoading={initialLoading}
            loadingLabel={t('common.loading')}
        >
            <Card>
                <div className={styles.openaiModelsContent}>
                    <div className={styles.sectionHint}>{t(`ai_providers.${i18nPrefix}_fetch_hint`)}</div>
                    <div className={styles.openaiModelsEndpointSection}>
                        <label className={styles.openaiModelsEndpointLabel}>
                            {t(`ai_providers.${i18nPrefix}_fetch_url_label`)}
                        </label>
                        <div className={styles.openaiModelsEndpointControls}>
                            <input className={`input ${styles.openaiModelsEndpointInput}`} readOnly value={endpoint} />
                            <Button
                                variant='secondary'
                                size='sm'
                                onClick={() => void doFetch()}
                                loading={fetching}
                                disabled={disableControls || saving}
                            >
                                {t(`ai_providers.${i18nPrefix}_fetch_refresh`)}
                            </Button>
                        </div>
                    </div>
                    <Input
                        label={t(`ai_providers.${i18nPrefix}_search_label`)}
                        placeholder={t(`ai_providers.${i18nPrefix}_search_placeholder`)}
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        disabled={fetching}
                    />
                    {error && <div className='error-box'>{error}</div>}
                    {fetching ? (
                        <div className={styles.sectionHint}>{t(`ai_providers.${i18nPrefix}_fetch_loading`)}</div>
                    ) : models.length === 0 ? (
                        <div className={styles.sectionHint}>{t(`ai_providers.${i18nPrefix}_fetch_empty`)}</div>
                    ) : filteredModels.length === 0 ? (
                        <div className={styles.sectionHint}>{t(`ai_providers.${i18nPrefix}_search_empty`)}</div>
                    ) : (
                            <ModelCheckboxList models={filteredModels} selected={selected} onToggle={toggleSelection} />
                        )}
                </div>
            </Card>
        </SecondaryScreenShell>
    )
}
