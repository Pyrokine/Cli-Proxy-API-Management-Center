import {Button} from '@/components/ui/Button'
import {Input} from '@/components/ui/Input'
import {Pagination} from '@/components/ui/Pagination'
import {SelectionCheckbox} from '@/components/ui/SelectionCheckbox'
import {invalidateAuthFileModelsCache, loadAuthFileModels} from '@/features/authFiles/authFileModelsCache'
import {authFileSelectionKey} from '@/features/authFiles/identity'
import {usePagination} from '@/hooks/usePagination'
import {authFilesApi} from '@/services/api/authFiles'
import {apiClient} from '@/services/api/client'
import {useAuthStore} from '@/stores'
import type {AuthFileItem, AuthFileModelItem} from '@/types/authFile'
import {
    formatExcludedModelsText,
    hasExcludedModelRule,
    isModelExcludedByRules,
    isModelExcludedByWildcardRule,
    normalizeExcludedModelRules,
    parseExcludedModelsText,
    replaceCustomExcludedModelRules,
    splitExcludedModelRules,
    toggleExcludedModelRule,
} from '@/utils/excludedModels'
import {useEffect, useMemo, useState} from 'react'
import {useTranslation} from 'react-i18next'
import styles from './AuthFileExcludedModelsField.module.scss'

interface AuthFileExcludedModelsFieldProps {
    fileName: string
    authIndex?: AuthFileItem['authIndex']
    value: string
    disabled: boolean
    onChange: (value: string) => void
}

const mergeConfiguredModels = (models: AuthFileModelItem[], rules: string[]): AuthFileModelItem[] => {
    const byId = new Map<string, AuthFileModelItem>()
    models.forEach((model) => {
        const id = model.id.trim()
        if (id) {
            byId.set(id, { ...model, id })
        }
    })
    rules.forEach((rule) => {
        if (!rule.includes('*') && ![...byId.keys()].some((id) => id.toLowerCase() === rule.toLowerCase())) {
            byId.set(rule, { id: rule })
        }
    })
    return [...byId.values()].sort((left, right) =>
                                       left.id.localeCompare(right.id, undefined, { sensitivity: 'base' }),
    )
}

export function AuthFileExcludedModelsField({
                                                fileName,
                                                authIndex,
                                                value,
                                                disabled,
                                                onChange,
                                            }: AuthFileExcludedModelsFieldProps) {
    const { t }                               = useTranslation()
    const generation                          = useAuthStore(() => apiClient.getAuthGeneration())
    const [search, setSearch]                 = useState('')
    const [retry, setRetry]                   = useState(0)
    const [loadedIdentity, setLoadedIdentity] = useState('')
    const identity                            = `${generation}:${authFileSelectionKey({ name: fileName, authIndex })}`
    const rules                               = useMemo(() => parseExcludedModelsText(value), [value])
    const [models, setModels]                 = useState<AuthFileModelItem[]>([])
    const [loading, setLoading]               = useState(true)
    const [loadFailed, setLoadFailed]         = useState(false)

    useEffect(() => {
        let active = true
        queueMicrotask(() => {
            if (active) {
                setLoading(true)
                setLoadFailed(false)
            }
        })
        void loadAuthFileModels(fileName, authFilesApi.getModelsForAuthFile, authIndex)
            .then((items) => {
                if (!active) {
                    return
                }
                if (items === null) {
                    setLoadFailed(true);
                    return
                }
                setModels(items)
                setLoadedIdentity(identity)
            })
            .catch(() => {
                if (active) {
                    setLoadFailed(true)
                }
            })
            .finally(() => {
                if (active) {
                    setLoading(false)
                }
            })
        return () => {
            active = false
        }
    }, [authIndex, fileName, generation, identity, retry])

    const mergedModels = useMemo(
        () => mergeConfiguredModels(loadedIdentity === identity ? models : [], rules),
        [identity, loadedIdentity, models, rules],
    )

    const candidateIds = useMemo(() => mergedModels.map((model) => model.id), [mergedModels])

    const visibleModels = useMemo(
        () => mergedModels.filter((model) => `${model.id} ${model.display_name ??
                                                            ''}`.toLowerCase()
                                                                .includes(search.trim()
                                                                                .toLowerCase())),
        [mergedModels, search],
    )

    const pagination = usePagination(visibleModels)

    const customRules = useMemo(
        () => splitExcludedModelRules(rules, candidateIds).customRules,
        [candidateIds, rules],
    )

    const commit = (next: Iterable<string>) => onChange(formatExcludedModelsText(normalizeExcludedModelRules(next)))

    const applyVisible = (excluded: boolean) => {
        let next = rules
        visibleModels.forEach((model) => {
            const exact = hasExcludedModelRule(next, model.id)
            if ((isModelExcludedByWildcardRule(next, model.id) && !exact) || exact === excluded) {
                return
            }
            next = toggleExcludedModelRule(next, model.id, excluded)
        })
        commit(next)
    }

    const reload = () => {
        invalidateAuthFileModelsCache([fileName])
        setRetry((value) => value + 1)
    }

    return (
        <div className={styles.root}>
            <div className={styles.header}>
                <span>{t('auth_files.excluded_models_label')}</span>
                <span className={styles.status}>
                    {loading
                     ? t('common.loading')
                     : loadFailed
                       ? t('notification.load_failed')
                       : t('auth_files.excluded_models_count', {
                                count: candidateIds.filter((id) => isModelExcludedByRules(rules, id)).length,
                            })}
                </span>
            </div>
            <Input value={search} onChange={(event) => {
                setSearch(event.target.value);
                pagination.goToPage(1)
            }} placeholder={t('common.search')} aria-label={t('auth_files.excluded_models_search')}
                   disabled={disabled} />
            <div className={styles.actions}>
                <Button variant='secondary' size='sm' onClick={() => applyVisible(true)}
                        disabled={disabled || loading || visibleModels.length === 0}>{t(
                    'auth_files.excluded_models_exclude_matching')}</Button>
                <Button variant='secondary' size='sm' onClick={() => applyVisible(false)}
                        disabled={disabled || loading || visibleModels.length === 0}>{t(
                    'auth_files.excluded_models_clear_matching')}</Button>
                {loadFailed &&
                 <Button variant='secondary' size='sm' onClick={reload}
                         disabled={disabled || loading}>{t('common.retry')}</Button>}
            </div>
            {visibleModels.length > 0 && (
                <div className={styles.catalog} role='group' aria-label={t('auth_files.excluded_models_label')}>
                    {pagination.currentItems.map((model) => {
                        const exact    = hasExcludedModelRule(rules, model.id)
                        const wildcard = isModelExcludedByWildcardRule(rules, model.id)
                        return (
                            <SelectionCheckbox
                                key={model.id}
                                checked={exact || wildcard}
                                disabled={disabled || (wildcard && !exact)}
                                title={wildcard && !exact
                                       ? t('auth_files.excluded_models_wildcard_hint', {
                                        defaultValue: 'This model is excluded by a wildcard rule',
                                    })
                                       : undefined}
                                onChange={(excluded) => commit(toggleExcludedModelRule(rules, model.id, excluded))}
                                label={model.display_name && model.display_name !== model.id
                                       ? `${model.id} · ${model.display_name}`
                                       : model.id}
                            />
                        )
                    })}
                </div>
            )}
            <Pagination total={visibleModels.length} page={pagination.currentPage} pageSize={pagination.pageSize}
                        onPageChange={pagination.goToPage} />
            <div className='hint'>{t('auth_files.excluded_models_source_hint')}</div>
            <textarea
                aria-label={t('auth_files.excluded_models_custom_rules')}
                className={`input ${styles.rules}`}
                value={formatExcludedModelsText(customRules)}
                disabled={disabled}
                placeholder={t('auth_files.excluded_models_placeholder')}
                spellCheck={false}
                onChange={(event) =>
                    commit(replaceCustomExcludedModelRules(rules, candidateIds, event.target.value))}
            />
            <div className='hint'>{t('auth_files.excluded_models_hint')}</div>
        </div>
    )
}
