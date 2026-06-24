import {Button} from '@/components/ui/Button'
import {HeaderInputList} from '@/components/ui/HeaderInputList'
import {Input} from '@/components/ui/Input'
import {ModelInputList} from '@/components/ui/ModelInputList'
import type {ModelDiscoveryReturn} from '@/hooks/useModelDiscovery'
import type {Dispatch, ReactNode, SetStateAction} from 'react'
import {useTranslation} from 'react-i18next'
import {ModelDiscoveryModal} from './ModelDiscoveryModal'
import styles from './ProviderEditForm.module.scss'

// ---- Shared form field change helpers ----

type FormUpdater<T> = Dispatch<SetStateAction<T>>

const fieldChange = <T extends Record<string, unknown>>(setForm: FormUpdater<T>, field: keyof T, value: unknown) =>
    setForm((prev) => ({ ...prev, [field]: value }))

// ---- Priority Input ----

interface PriorityFieldProps<T extends { priority?: number }> {
    form: T
    setForm: FormUpdater<T>
    disabled: boolean
}

export function PriorityField<T extends { priority?: number }>({ form, setForm, disabled }: PriorityFieldProps<T>) {
    const { t } = useTranslation()
    return (
        <Input
            label={t('ai_providers.priority_label')}
            hint={t('ai_providers.priority_hint')}
            type='number'
            step={1}
            value={form.priority ?? ''}
            onChange={(e) => {
                const raw    = e.target.value
                const parsed = raw.trim() === '' ? undefined : Number(raw)
                fieldChange(
                    setForm,
                    'priority' as keyof T,
                    parsed !== undefined && Number.isFinite(parsed) ? parsed : undefined,
                )
            }}
            disabled={disabled}
        />
    )
}

// ---- Prefix Input ----

interface PrefixFieldProps<T extends { prefix?: string }> {
    form: T
    setForm: FormUpdater<T>
    disabled: boolean
}

export function PrefixField<T extends { prefix?: string }>({ form, setForm, disabled }: PrefixFieldProps<T>) {
    const { t } = useTranslation()
    return (
        <Input
            label={t('ai_providers.prefix_label')}
            placeholder={t('ai_providers.prefix_placeholder')}
            value={form.prefix ?? ''}
            onChange={(e) => fieldChange(setForm, 'prefix' as keyof T, e.target.value)}
            hint={t('ai_providers.prefix_hint')}
            disabled={disabled}
        />
    )
}

// ---- Custom Headers ----

interface HeadersFieldProps {
    entries: Array<{ key: string; value: string }>
    onChange: (entries: Array<{ key: string; value: string }>) => void
    disabled: boolean
}

export function HeadersField({ entries, onChange, disabled }: HeadersFieldProps) {
    const { t } = useTranslation()
    return (
        <HeaderInputList
            entries={entries}
            onChange={onChange}
            addLabel={t('common.custom_headers_add')}
            keyPlaceholder={t('common.custom_headers_key_placeholder')}
            valuePlaceholder={t('common.custom_headers_value_placeholder')}
            removeButtonTitle={t('common.delete')}
            removeButtonAriaLabel={t('common.delete')}
            disabled={disabled}
        />
    )
}

// ---- Model Config Section (with optional discovery button) ----

interface ModelConfigSectionProps {
    entries: Array<{ name: string; alias: string }>
    onChange: (entries: Array<{ name: string; alias: string }>) => void
    onAddRow: () => void
    disabled: boolean
    /** Translation key prefix for labels (e.g. 'codex', 'gemini') */
    i18nPrefix: string
    /** If provided, shows a "Discover Models" button */
    onDiscovery?: () => void
    discoveryDisabled?: boolean
}

function ModelConfigSection({
                                entries,
                                onChange,
                                onAddRow,
                                disabled,
                                i18nPrefix,
                                onDiscovery,
                                discoveryDisabled,
                            }: ModelConfigSectionProps) {
    const { t } = useTranslation()

    return (
        <div className={styles.modelConfigSection}>
            <div className={styles.modelConfigHeader}>
                <label className={styles.modelConfigTitle}>{t(`ai_providers.${i18nPrefix}_models_label`)}</label>
                <div className={styles.modelConfigToolbar}>
                    <Button variant='secondary' size='sm' onClick={onAddRow} disabled={disabled}>
                        {t(`ai_providers.${i18nPrefix}_models_add_btn`)}
                    </Button>
                    {onDiscovery && (
                        <Button variant='secondary' size='sm' onClick={onDiscovery}
                                disabled={disabled || discoveryDisabled}>
                            {t(`ai_providers.${i18nPrefix}_models_fetch_button`)}
                        </Button>
                    )}
                </div>
            </div>
            <div className={styles.sectionHint}>{t(`ai_providers.${i18nPrefix}_models_hint`)}</div>
            <ModelInputList
                entries={entries}
                onChange={onChange}
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
        </div>
    )
}

// ---- Excluded Models Textarea ----

interface ExcludedModelsFieldProps {
    value: string
    onChange: (value: string) => void
    disabled: boolean
}

export function ExcludedModelsField({ value, onChange, disabled }: ExcludedModelsFieldProps) {
    const { t } = useTranslation()
    return (
        <div className='form-group'>
            <label>{t('ai_providers.excluded_models_label')}</label>
            <textarea
                className='input'
                placeholder={t('ai_providers.excluded_models_placeholder')}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                rows={4}
                disabled={disabled}
            />
            <div className='hint'>{t('ai_providers.excluded_models_hint')}</div>
        </div>
    )
}

// ---- Combined Model Discovery Section ----
// Renders ModelConfigSection + ExcludedModelsField + ModelDiscoveryModal together.
// Used by Codex and Gemini pages to avoid duplicated prop wiring.

interface ProviderModelSectionProps<
    T extends { modelEntries: Array<{ name: string; alias: string }>; excludedText: string },
> {
    form: T
    setForm: FormUpdater<T>
    disabled: boolean
    discovery: ModelDiscoveryReturn
    discoveryDisabled?: boolean
    i18nPrefix: string
    children?: ReactNode
}

export function ProviderModelSection<
    T extends { modelEntries: Array<{ name: string; alias: string }>; excludedText: string },
>({ form, setForm, disabled, discovery, discoveryDisabled, i18nPrefix, children }: ProviderModelSectionProps<T>) {
    return (
        <>
            <ModelConfigSection
                entries={form.modelEntries}
                onChange={(entries) => setForm((prev) => ({ ...prev, modelEntries: entries }))}
                onAddRow={() =>
                    setForm((prev) => ({
                        ...prev,
                        modelEntries: [...prev.modelEntries, { name: '', alias: '' }],
                    }))
                }
                disabled={disabled}
                i18nPrefix={i18nPrefix}
                onDiscovery={() => discovery.setOpen(true)}
                discoveryDisabled={discoveryDisabled ?? !discovery.canOpen}
            />
            {children}
            <ExcludedModelsField
                value={form.excludedText}
                onChange={(value) => setForm((prev) => ({ ...prev, excludedText: value }))}
                disabled={disabled}
            />
            <ModelDiscoveryModal
                open={discovery.open}
                onClose={() => discovery.setOpen(false)}
                endpoint={discovery.endpoint}
                discoveredModels={discovery.discoveredModels}
                filteredModels={discovery.filteredModels}
                fetching={discovery.fetching}
                error={discovery.error}
                search={discovery.search}
                onSearchChange={discovery.setSearch}
                selected={discovery.selected}
                onToggleSelection={discovery.toggleSelection}
                onApply={discovery.applySelected}
                onRefresh={() => void discovery.fetchDiscovery()}
                canApply={discovery.canApply}
                disabled={disabled}
                i18nPrefix={i18nPrefix}
            />
        </>
    )
}
