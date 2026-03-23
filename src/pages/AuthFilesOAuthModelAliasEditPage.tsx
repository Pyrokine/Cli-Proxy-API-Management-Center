import {SecondaryScreenShell} from '@/components/common/SecondaryScreenShell'
import {AutocompleteInput} from '@/components/ui/AutocompleteInput'
import {Button} from '@/components/ui/Button'
import {Card} from '@/components/ui/Card'
import {EmptyState} from '@/components/ui/EmptyState'
import {IconX} from '@/components/ui/icons'
import {ToggleSwitch} from '@/components/ui/ToggleSwitch'
import {useOAuthProviderEditor} from '@/features/authFiles/hooks/useOAuthProviderEditor'
import {authFilesApi} from '@/services/api'
import type {OAuthModelAliasEntry} from '@/types'
import {generateId} from '@/utils/helpers'
import {useCallback, useEffect, useMemo, useState} from 'react'
import styles from './AuthFilesOAuthModelAliasEditPage.module.scss'
import {OAuthProviderSelector} from './OAuthProviderSelector'

type OAuthModelMappingFormEntry = OAuthModelAliasEntry & { id: string };

const buildEmptyMappingEntry = (): OAuthModelMappingFormEntry => ({
    id: generateId(),
    name: '',
    alias: '',
    fork: true,
})

const normalizeMappingEntries = (entries?: OAuthModelAliasEntry[]): OAuthModelMappingFormEntry[] => {
    if (!Array.isArray(entries) || entries.length === 0) {
        return [buildEmptyMappingEntry()]
    }
    return entries.map((entry) => ({
        id: generateId(),
        name: entry.name ?? '',
        alias: entry.alias ?? '',
        fork: Boolean(entry.fork),
    }))
}

export function AuthFilesOAuthModelAliasEditPage() {
    const editor                                                                 = useOAuthProviderEditor('modelAlias')
    const { t, provider, resolvedProviderKey, disableControls, saving, canSave } = editor
    const { featureUnsupported, modelsList, modelsLoading, modelsError }         = editor

    const [mappings, setMappings] = useState<OAuthModelMappingFormEntry[]>([buildEmptyMappingEntry()])

    const title      = useMemo(() => t('oauth_model_alias.add_title'), [t])
    const headerHint = useMemo(() => {
        if (!provider.trim()) {
            return t('oauth_model_alias.provider_hint')
        }
        if (modelsLoading) {
            return t('oauth_model_alias.model_source_loading')
        }
        if (modelsError === 'unsupported') {
            return t('oauth_model_alias.model_source_unsupported')
        }
        return t('oauth_model_alias.model_source_loaded', { count: modelsList.length })
    }, [modelsError, modelsList.length, modelsLoading, provider, t])

    // 同步已有的 model alias 到表单
    useEffect(() => {
        if (!resolvedProviderKey) {
            setMappings([buildEmptyMappingEntry()])
            return
        }
        const existing = editor.modelAlias[resolvedProviderKey] ?? []
        setMappings(normalizeMappingEntries(existing))
    }, [editor.modelAlias, resolvedProviderKey])

    const updateMappingEntry = useCallback(
        (index: number, field: keyof OAuthModelAliasEntry, value: string | boolean) => {
            setMappings((prev) => prev.map((entry, idx) => (idx === index ? { ...entry, [field]: value } : entry)))
        },
        [],
    )

    const addMappingEntry = useCallback(() => {
        setMappings((prev) => [...prev, buildEmptyMappingEntry()])
    }, [])

    const removeMappingEntry = useCallback((index: number) => {
        setMappings((prev) => {
            const next = prev.filter((_, idx) => idx !== index)
            return next.length ? next : [buildEmptyMappingEntry()]
        })
    }, [])

    const handleSave = useCallback(async () => {
        const channel = provider.trim()
        if (!channel) {
            editor.showNotification(t('oauth_model_alias.provider_required'), 'error')
            return
        }

        const seen       = new Set<string>()
        const normalized = mappings
            .map((entry) => {
                const name  = String(entry.name ?? '').trim()
                const alias = String(entry.alias ?? '').trim()
                if (!name || !alias) {
                    return null
                }
                const key = `${name.toLowerCase()}::${alias.toLowerCase()}::${entry.fork ? '1' : '0'}`
                if (seen.has(key)) {
                    return null
                }
                seen.add(key)
                return entry.fork ? { name, alias, fork: true } : { name, alias }
            })
            .filter(Boolean) as OAuthModelAliasEntry[]

        editor.setSaving(true)
        try {
            if (normalized.length) {
                await authFilesApi.saveOauthModelAlias(channel, normalized)
            } else {
                await authFilesApi.deleteOauthModelAlias(channel)
            }
            editor.showNotification(t('oauth_model_alias.save_success'), 'success')
            editor.handleBack()
        } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : ''
            editor.showNotification(`${t('oauth_model_alias.save_failed')}: ${errorMessage}`, 'error')
        } finally {
            editor.setSaving(false)
        }
    }, [editor, mappings, provider, t])

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
                    {t('oauth_model_alias.save')}
                </Button>
            }
            isLoading={editor.initialLoading}
            loadingLabel={t('common.loading')}
        >
            {featureUnsupported ? (
                <Card>
                    <EmptyState
                        title={t('oauth_model_alias.upgrade_required_title')}
                        description={t('oauth_model_alias.upgrade_required_desc')}
                    />
                </Card>
            ) : (
                 <>
                     <OAuthProviderSelector
                         inputId='oauth-model-alias-provider'
                         title={t('oauth_model_alias.title')}
                         hint={headerHint}
                         label={t('oauth_model_alias.provider_label')}
                         description={t('oauth_model_alias.provider_hint')}
                         placeholder={t('oauth_model_alias.provider_placeholder')}
                         provider={provider}
                         providerOptions={editor.providerOptions}
                         disabled={disableControls || saving}
                         getTypeLabel={editor.getTypeLabel}
                         onProviderChange={editor.updateProvider}
                     />

                     <Card className={styles.settingsCard}>
                         <div className={styles.mappingsHeader}>
                             <div className={styles.mappingsTitle}>{t('oauth_model_alias.alias_label')}</div>
                             <Button
                                 variant='secondary'
                                 size='sm'
                                 onClick={addMappingEntry}
                                 disabled={disableControls || saving || featureUnsupported}
                             >
                                 {t('oauth_model_alias.add_alias')}
                             </Button>
                         </div>

                         <div className={styles.mappingsBody}>
                             {mappings.map((entry, index) => (
                                 <div key={entry.id} className={styles.mappingRow}>
                                     <AutocompleteInput
                                         wrapperStyle={{ flex: 1, marginBottom: 0 }}
                                         placeholder={t('oauth_model_alias.alias_name_placeholder')}
                                         value={entry.name}
                                         onChange={(val) => updateMappingEntry(index, 'name', val)}
                                         disabled={disableControls || saving}
                                         options={modelsList.map((model) => ({
                                             value: model.id,
                                             label: model.display_name && model.display_name !== model.id ?
                                                    model.display_name :
                                                    undefined,
                                         }))}
                                     />
                                     <span className={styles.mappingSeparator}>→</span>
                                     <input
                                         className={`input ${styles.mappingAliasInput}`}
                                         placeholder={t('oauth_model_alias.alias_placeholder')}
                                         value={entry.alias}
                                         onChange={(e) => updateMappingEntry(index, 'alias', e.target.value)}
                                         disabled={disableControls || saving}
                                     />
                                     <div className={styles.mappingFork}>
                                         <ToggleSwitch
                                             label={t('oauth_model_alias.alias_fork_label')}
                                             labelPosition='left'
                                             checked={Boolean(entry.fork)}
                                             onChange={(value) => updateMappingEntry(index, 'fork', value)}
                                             disabled={disableControls || saving}
                                         />
                                     </div>
                                     <Button
                                         variant='ghost'
                                         size='sm'
                                         onClick={() => removeMappingEntry(index)}
                                         disabled={disableControls || saving || mappings.length <= 1}
                                         title={t('common.delete')}
                                         aria-label={t('common.delete')}
                                     >
                                         <IconX size={14} />
                                     </Button>
                                 </div>
                             ))}
                         </div>
                     </Card>
                 </>
             )}
        </SecondaryScreenShell>
    )
}
