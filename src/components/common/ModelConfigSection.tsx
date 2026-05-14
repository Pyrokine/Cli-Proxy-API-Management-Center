import type { ModelEntry } from '@/components/providers/types'
import { Button } from '@/components/ui/Button'
import { ModelInputList } from '@/components/ui/ModelInputList'
import styles from '@/pages/ProviderEditForm.module.scss'
import type { Dispatch, ReactNode, SetStateAction } from 'react'
import { useTranslation } from 'react-i18next'

interface ModelConfigSectionProps<F extends { modelEntries: ModelEntry[] }> {
    /** Section title label */
    title: string
    /** Hint text displayed below the title */
    hint: string
    /** Add model button label */
    addLabel: string
    /** Fetch/discover models button label */
    fetchLabel: string
    /** Model entries from form state */
    entries: ModelEntry[]
    /** Form state setter for updating model entries */
    setForm: Dispatch<SetStateAction<F>>
    /** Callback to open model discovery */
    onFetchModels: () => void
    /** Whether controls should be disabled */
    disabled: boolean
    /** Extra disabled condition for the fetch button */
    fetchDisabled?: boolean
    /** Content rendered after the ModelInputList (e.g. ModelTestPanel) */
    children?: ReactNode
}

/**
 * Shared model configuration section used across provider edit pages.
 * Renders the section header (title + add/fetch buttons), hint, ModelInputList, and optional children.
 */
export function ModelConfigSection<F extends { modelEntries: ModelEntry[] }>({
    title,
    hint,
    addLabel,
    fetchLabel,
    entries,
    setForm,
    onFetchModels,
    disabled,
    fetchDisabled,
    children,
}: ModelConfigSectionProps<F>) {
    const { t } = useTranslation()

    return (
        <div className={styles.modelConfigSection}>
            <div className={styles.modelConfigHeader}>
                <label className={styles.modelConfigTitle}>{title}</label>
                <div className={styles.modelConfigToolbar}>
                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={() =>
                            setForm((prev) => ({
                                ...prev,
                                modelEntries: [...prev.modelEntries, { name: '', alias: '' }],
                            }))
                        }
                        disabled={disabled}
                    >
                        {addLabel}
                    </Button>
                    <Button variant="secondary" size="sm" onClick={onFetchModels} disabled={disabled || fetchDisabled}>
                        {fetchLabel}
                    </Button>
                </div>
            </div>

            <div className={styles.sectionHint}>{hint}</div>

            <ModelInputList
                entries={entries}
                onChange={(updated) => setForm((prev) => ({ ...prev, modelEntries: updated }))}
                namePlaceholder={t('common.model_name_placeholder')}
                aliasPlaceholder={t('common.model_alias_placeholder')}
                disabled={disabled}
                hideAddButton
                className={styles.modelInputList}
                rowClassName={styles.modelInputRow}
                inputClassName={styles.modelInputField}
                removeButtonClassName={styles.modelRowRemoveButton}
                removeButtonTitle={t('common.delete')}
                removeButtonAriaLabel={t('common.delete')}
            />

            {children}
        </div>
    )
}
