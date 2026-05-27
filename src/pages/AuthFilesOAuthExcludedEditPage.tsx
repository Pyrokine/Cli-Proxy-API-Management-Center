import {SecondaryScreenShell} from '@/components/common/SecondaryScreenShell'
import {Button} from '@/components/ui/Button'
import {Card} from '@/components/ui/Card'
import {EmptyState} from '@/components/ui/EmptyState'
import {LoadingSpinner} from '@/components/ui/LoadingSpinner'
import {useOAuthProviderEditor} from '@/features/authFiles/hooks/useOAuthProviderEditor'
import {authFilesApi} from '@/services/api'
import {useCallback, useMemo, useState} from 'react'
import styles from './AuthFilesOAuthExcludedEditPage.module.scss'
import {OAuthProviderSelector} from './OAuthProviderSelector'

export function AuthFilesOAuthExcludedEditPage() {
    const editor                                                                 = useOAuthProviderEditor('excluded')
    const { t, provider, resolvedProviderKey, disableControls, saving, canSave } = editor
    const { featureUnsupported, modelsList, modelsLoading, modelsError }         = editor

    const [selectedModelsOverride, setSelectedModelsOverride] = useState<{
                                                                             providerKey: string
                                                                             value: Set<string>
                                                                         } | null>(null)

    const isEditing = useMemo(() => {
        if (!resolvedProviderKey) {
            return false
        }
        return Object.prototype.hasOwnProperty.call(editor.excluded, resolvedProviderKey)
    }, [editor.excluded, resolvedProviderKey])

    const title = useMemo(() => {
        if (isEditing) {
            return t('oauth_excluded.edit_title', { provider: provider.trim() || resolvedProviderKey })
        }
        return t('oauth_excluded.add_title')
    }, [isEditing, provider, resolvedProviderKey, t])

    const baselineSelectedModels = useMemo(() => {
        if (!resolvedProviderKey) {
            return new Set<string>()
        }
        const existing = editor.excluded[resolvedProviderKey] ?? []
        return new Set(existing)
    }, [editor.excluded, resolvedProviderKey])

    const effectiveSelectedModels = useMemo(() => {
        if (selectedModelsOverride?.providerKey === resolvedProviderKey) {
            return selectedModelsOverride.value
        }
        return baselineSelectedModels
    }, [baselineSelectedModels, resolvedProviderKey, selectedModelsOverride])
    const toggleModel             = useCallback(
        (modelId: string, checked: boolean) => {
            setSelectedModelsOverride((prev) => {
                const base = prev?.providerKey === resolvedProviderKey ? prev.value : baselineSelectedModels
                const next = new Set(base)
                if (checked) {
                    next.add(modelId)
                } else {
                    next.delete(modelId)
                }
                return { providerKey: resolvedProviderKey, value: next }
            })
        },
        [baselineSelectedModels, resolvedProviderKey],
    )

    const handleSave = useCallback(async () => {
        const normalizedProvider = resolvedProviderKey
        if (!normalizedProvider) {
            editor.showNotification(t('oauth_excluded.provider_required'), 'error')
            return
        }

        const models = [...effectiveSelectedModels]
        editor.setSaving(true)
        try {
            if (models.length) {
                await authFilesApi.saveOauthExcludedModels(normalizedProvider, models)
            } else {
                await authFilesApi.deleteOauthExcludedEntry(normalizedProvider)
            }
            editor.showNotification(t('oauth_excluded.save_success'), 'success')
            editor.handleBack()
        } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : ''
            editor.showNotification(`${t('oauth_excluded.save_failed')}: ${errorMessage}`, 'error')
        } finally {
            editor.setSaving(false)
        }
    }, [editor, effectiveSelectedModels, resolvedProviderKey, t])

    return (
        <SecondaryScreenShell
            ref={editor.swipeRef}
            title={title}
            onBack={editor.handleBack}
            backLabel={t('common.back')}
            backAriaLabel={t('common.back')}
            contentClassName={styles.pageContent}
            rightAction={
                <Button size='sm' onClick={handleSave} loading={saving} disabled={!canSave}>
                    {t('oauth_excluded.save')}
                </Button>
            }
            isLoading={editor.initialLoading}
            loadingLabel={t('common.loading')}
        >
            {featureUnsupported ? (
                <Card>
                    <EmptyState
                        title={t('oauth_excluded.upgrade_required_title')}
                        description={t('oauth_excluded.upgrade_required_desc')}
                    />
                </Card>
            ) : (
                 <>
                     <OAuthProviderSelector
                         inputId='oauth-excluded-provider'
                         title={t('oauth_excluded.title')}
                         hint={t('oauth_excluded.description')}
                         label={t('oauth_excluded.provider_label')}
                         description={t('oauth_excluded.provider_hint')}
                         placeholder={t('oauth_excluded.provider_placeholder')}
                         provider={provider}
                         providerOptions={editor.providerOptions}
                         disabled={disableControls || saving}
                         getTypeLabel={editor.getTypeLabel}
                         onProviderChange={editor.updateProvider}
                     />

                     <Card className={styles.settingsCard}>
                         <div className={styles.settingsHeader}>
                             <div className={styles.settingsHeaderTitle}>{t('oauth_excluded.models_label')}</div>
                             {resolvedProviderKey && (
                                 <div className={styles.modelsHint}>
                                     {modelsLoading ? (
                                         <>
                                             <LoadingSpinner size={14} />
                                             <span>{t('oauth_excluded.models_loading')}</span>
                                         </>
                                     ) : modelsError === 'unsupported' ? (
                                         <span>{t('oauth_excluded.models_unsupported')}</span>
                                     ) : modelsList.length > 0 ? (
                                         <span>{t('oauth_excluded.models_loaded', { count: modelsList.length })}</span>
                                     ) : (
                                             <span>{t('oauth_excluded.no_models_available')}</span>
                                         )}
                                 </div>
                             )}
                         </div>

                         {modelsLoading ? (
                             <div className={styles.loadingModels}>
                                 <LoadingSpinner size={16} />
                                 <span>{t('common.loading')}</span>
                             </div>
                         ) : modelsList.length > 0 ? (
                             <div className={styles.modelList}>
                                 {modelsList.map((model) => {
                                     const checked = effectiveSelectedModels.has(model.id)
                                     return (
                                         <label key={model.id} className={styles.modelItem}>
                                             <input
                                                 type='checkbox'
                                                 checked={checked}
                                                 disabled={disableControls || saving}
                                                 onChange={(event) => toggleModel(model.id, event.target.checked)}
                                             />
                                             <span className={styles.modelText}>
                                                <span className={styles.modelId}>{model.id}</span>
                                                 {model.display_name && model.display_name !== model.id && (
                                                     <span className={styles.modelDisplayName}>
                                                        {model.display_name}
                                                    </span>
                                                 )}
                                            </span>
                                         </label>
                                     )
                                 })}
                             </div>
                         ) : resolvedProviderKey ? (
                             <div className={styles.emptyModels}>
                                 {modelsError === 'unsupported'
                                  ? t('oauth_excluded.models_unsupported')
                                  : t('oauth_excluded.no_models_available')}
                             </div>
                         ) : (
                                 <div className={styles.emptyModels}>{t('oauth_excluded.provider_required')}</div>
                             )}
                     </Card>
                 </>
             )}
        </SecondaryScreenShell>
    )
}
