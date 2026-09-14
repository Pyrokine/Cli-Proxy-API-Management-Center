import {SelectionCheckbox} from '@/components/ui/SelectionCheckbox'
import {loadAuthFileModels} from '@/features/authFiles/authFileModelsCache'
import {authFilesApi} from '@/services/api/authFiles'
import type {AuthFileModelItem} from '@/types/authFile'
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
    value: string
    disabled: boolean
    onChange: (value: string) => void
}

const mergeConfiguredModels = (models: AuthFileModelItem[], rules: string[]): AuthFileModelItem[] => {
    const byId = new Map<string, AuthFileModelItem>()
    models.forEach((model) => {
        const id = model.id.trim()
        if (id) {
            byId.set(id.toLowerCase(), { ...model, id })
        }
    })
    rules.forEach((rule) => {
        if (!rule.includes('*') && !byId.has(rule.toLowerCase())) {
            byId.set(rule.toLowerCase(), { id: rule })
        }
    })
    return [...byId.values()].sort((left, right) =>
                                       left.id.localeCompare(right.id, undefined, { sensitivity: 'base' }),
    )
}

export function AuthFileExcludedModelsField({
                                                fileName,
                                                value,
                                                disabled,
                                                onChange,
                                            }: AuthFileExcludedModelsFieldProps) {
    const { t }                       = useTranslation()
    const rules                       = useMemo(() => parseExcludedModelsText(value), [value])
    const [models, setModels]         = useState<AuthFileModelItem[]>([])
    const [loading, setLoading]       = useState(true)
    const [loadFailed, setLoadFailed] = useState(false)

    useEffect(() => {
        let active = true
        queueMicrotask(() => {
            if (active) {
                setLoading(true)
                setLoadFailed(false)
            }
        })
        void loadAuthFileModels(fileName, authFilesApi.getModelsForAuthFile)
            .then((items) => {
                if (!active || items === null) {
                    return
                }
                setModels(items)
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
    }, [fileName])

    const mergedModels = useMemo(() => mergeConfiguredModels(models, rules), [models, rules])
    const candidateIds = useMemo(() => mergedModels.map((model) => model.id), [mergedModels])
    const customRules  = useMemo(
        () => splitExcludedModelRules(rules, candidateIds).customRules,
        [candidateIds, rules],
    )

    const commit = (next: Iterable<string>) => onChange(formatExcludedModelsText(normalizeExcludedModelRules(next)))

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
            {mergedModels.length > 0 && (
                <div className={styles.catalog} role='group' aria-label={t('auth_files.excluded_models_label')}>
                    {mergedModels.map((model) => {
                        const exact    = hasExcludedModelRule(rules, model.id)
                        const wildcard = isModelExcludedByWildcardRule(rules, model.id)
                        return (
                            <SelectionCheckbox
                                key={model.id.toLowerCase()}
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
            <textarea
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
