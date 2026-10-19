import {normalizeModelThinking} from '@/utils/modelMetadata'
import {Fragment} from 'react'
import {useTranslation} from 'react-i18next'
import {Button} from './Button'
import {IconX} from './icons'
import styles from './ModelInputList.module.scss'
import {type ModelEntry, getModelEntriesValidationKey, parseThinkingLevelsInput, updateModelNumericField} from './modelInputListUtils'

const THINKING_BOOLEAN_FIELDS = [
    { field: 'zeroAllowed', label: 'ai_providers.model_thinking_zero_allowed_label' },
    { field: 'dynamicAllowed', label: 'ai_providers.model_thinking_dynamic_allowed_label' },
] as const

const ADVANCED_BOOLEAN_FIELDS = [
    { field: 'isCompat', label: 'ai_providers.model_is_compat_label' },
    { field: 'forceMapping', label: 'ai_providers.model_force_mapping_label' },
    { field: 'supportConfigurationUpdate', label: 'ai_providers.model_configuration_update_label' },
    { field: 'useMaxCompletionTokens', label: 'ai_providers.model_max_completion_tokens_label' },
    { field: 'image', label: 'ai_providers.model_image_label' },
] as const

export type ModelProvider = 'gemini' | 'interactions' | 'claude' | 'codex' | 'xai' | 'meta' | 'vertex' | 'openai'

interface ModelInputListProps {
    entries: ModelEntry[]
    onChange: (entries: ModelEntry[]) => void
    addLabel?: string
    disabled?: boolean
    namePlaceholder?: string
    aliasPlaceholder?: string
    hideAddButton?: boolean
    onAdd?: () => void
    className?: string
    rowClassName?: string
    inputClassName?: string
    removeButtonClassName?: string
    removeButtonTitle?: string
    removeButtonAriaLabel?: string
    metadataEditing?: boolean
    provider: ModelProvider
}

export function ModelInputList({
                                   entries,
                                   onChange,
                                   addLabel,
                                   disabled = false,
                                   namePlaceholder = 'model-name',
                                   aliasPlaceholder = 'alias (optional)',
                                   hideAddButton = false,
                                   onAdd,
                                   className = '',
                                   rowClassName = '',
                                   inputClassName = '',
                                   removeButtonClassName = '',
                                   removeButtonTitle = 'Remove',
                                   removeButtonAriaLabel = 'Remove',
                                   metadataEditing = false,
                                   provider,
                               }: ModelInputListProps) {
    const { t }              = useTranslation()
    const currentEntries     = entries.length ? entries : [{ name: '', alias: '' }]
    const containerClassName = ['header-input-list', className].filter(Boolean).join(' ')
    const inputClassNames    = ['input', inputClassName].filter(Boolean).join(' ')
    const rowClassNames      = ['header-input-row', rowClassName].filter(Boolean).join(' ')
    const advancedFlags      = ADVANCED_BOOLEAN_FIELDS.filter(({field}) =>
        (field === 'isCompat' && provider !== 'vertex') ||
        (field === 'forceMapping' && ['codex', 'xai', 'meta'].includes(provider)) ||
        (field === 'supportConfigurationUpdate' && provider === 'codex') ||
        (['useMaxCompletionTokens', 'image'].includes(field) && provider === 'openai'),
    )

    const updateMetadata = (index: number, patch: Partial<ModelEntry>) => {
        onChange(currentEntries.map((entry, idx) => idx === index ? {...entry, ...patch} : entry))
    }

    const updateEntry = (index: number, field: 'name' | 'alias', value: string) => {
        const next = currentEntries.map((entry, idx) => (idx === index ? { ...entry, [field]: value } : entry))
        onChange(next)
    }

    const updateMaxContextLength = (index: number, value: string) => {
        onChange(currentEntries.map((entry, idx) =>
            idx === index ? updateModelNumericField(entry, 'maxContextLength', value) : entry))
    }

    const updateThinking = (
        index: number,
        field: 'min' | 'max' | 'zeroAllowed' | 'dynamicAllowed' | 'levels',
        value: unknown,
    ) => {
        const next = currentEntries.map((entry, idx) => {
            if (idx !== index) {
                return entry
            }
            const updated  = { ...entry }
            const thinking = field === 'levels'
                             ? { ...entry.thinking, levels: Array.isArray(value) ? value.map(String) : [] }
                             : normalizeModelThinking({ ...entry.thinking, [field]: value })
            if (thinking) {
                updated.thinking = thinking
            } else {
                delete updated.thinking
            }
            return updated
        })
        onChange(next)
    }

    const updateThinkingInteger = (index: number, field: 'min' | 'max', value: string) => {
        onChange(currentEntries.map((entry, idx) =>
            idx === index ? updateModelNumericField(entry, field, value) : entry))
    }

    const addEntry = () => {
        if (onAdd) {
            onAdd()
        } else {
            onChange([...currentEntries, { name: '', alias: '' }])
        }
    }

    const removeEntry = (index: number) => {
        const next = currentEntries.filter((_, idx) => idx !== index)
        onChange(next.length ? next : [{ name: '', alias: '' }])
    }

    return (
        <div className={containerClassName}>
            {currentEntries.map((entry, index) => {
                const validationKey = getModelEntriesValidationKey([entry])
                return (
                <Fragment key={index}>
                    <div className={rowClassNames}>
                        <input
                            className={inputClassNames}
                            placeholder={namePlaceholder}
                            aria-label={namePlaceholder}
                            value={entry.name}
                            onChange={(e) => updateEntry(index, 'name', e.target.value)}
                            disabled={disabled}
                        />
                        <span className='header-separator'>→</span>
                        <input
                            className={inputClassNames}
                            placeholder={aliasPlaceholder}
                            aria-label={aliasPlaceholder}
                            value={entry.alias}
                            onChange={(e) => updateEntry(index, 'alias', e.target.value)}
                            disabled={disabled}
                        />
                        <Button
                            variant='ghost'
                            size='sm'
                            onClick={() => removeEntry(index)}
                            disabled={disabled || currentEntries.length <= 1}
                            className={removeButtonClassName}
                            title={removeButtonTitle}
                            aria-label={removeButtonAriaLabel}
                        >
                            <IconX size={14} />
                        </Button>
                        {metadataEditing && (
                            <div className={styles.metadataFields}>
                                {provider !== 'vertex' && (
                                    <label className={styles.metadataField}>
                                        <span>{t('ai_providers.model_max_context_length_label')}</span>
                                        <input
                                            className={inputClassNames}
                                            type='text'
                                            inputMode='numeric'
                                            value={entry.maxContextLengthDraft ?? entry.maxContextLength ?? ''}
                                            aria-invalid={validationKey === 'ai_providers.model_context_invalid'}
                                            onChange={(event) => updateMaxContextLength(index, event.target.value)}
                                            disabled={disabled}
                                        />
                                    </label>
                                )}
                                <label className={styles.metadataField}>
                                    <span>{t('ai_providers.model_thinking_min_label')}</span>
                                    <input
                                        className={inputClassNames}
                                        type='text'
                                        inputMode='numeric'
                                        value={entry.thinkingMinDraft ?? entry.thinking?.min ?? ''}
                                        aria-invalid={validationKey === 'ai_providers.model_thinking_budget_invalid' ||
                                                      validationKey === 'ai_providers.model_thinking_budget_range'}
                                        onChange={(event) => updateThinkingInteger(index, 'min', event.target.value)}
                                        disabled={disabled}
                                    />
                                </label>
                                <label className={styles.metadataField}>
                                    <span>{t('ai_providers.model_thinking_max_label')}</span>
                                    <input
                                        className={inputClassNames}
                                        type='text'
                                        inputMode='numeric'
                                        value={entry.thinkingMaxDraft ?? entry.thinking?.max ?? ''}
                                        aria-invalid={validationKey === 'ai_providers.model_thinking_budget_invalid' ||
                                                      validationKey === 'ai_providers.model_thinking_budget_range'}
                                        onChange={(event) => updateThinkingInteger(index, 'max', event.target.value)}
                                        disabled={disabled}
                                    />
                                </label>
                                {validationKey && (
                                    <span className={styles.metadataError} role='alert'>{t(validationKey)}</span>
                                )}
                                {THINKING_BOOLEAN_FIELDS.map(({ field, label }) => {
                                    const value = entry.thinking?.[field]
                                    return (
                                        <label className={styles.metadataField} key={field}>
                                            <span>{t(label)}</span>
                                            <select
                                                className={inputClassNames}
                                                value={value === undefined ? '' : String(value)}
                                                onChange={(event) => updateThinking(
                                                    index,
                                                    field,
                                                    event.target.value === '' ?
                                                    undefined :
                                                    event.target.value === 'true',
                                                )}
                                                disabled={disabled}
                                            >
                                                <option value=''>{t('common.not_set')}</option>
                                                <option value='true'>{t('common.yes')}</option>
                                                <option value='false'>{t('common.no')}</option>
                                            </select>
                                        </label>
                                    )
                                })}
                                <label className={styles.metadataField}>
                                    <span>{t('ai_providers.model_thinking_levels_label')}</span>
                                    <input
                                        className={inputClassNames}
                                        value={entry.thinking?.levels?.join(', ') ?? ''}
                                        placeholder={t('ai_providers.model_thinking_levels_placeholder')}
                                        onChange={(event) => updateThinking(
                                            index,
                                            'levels',
                                            parseThinkingLevelsInput(event.target.value),
                                        )}
                                        disabled={disabled}
                                    />
                                </label>
                                <details className={styles.advancedOptions}>
                                    <summary>{t('ai_providers.model_advanced_options_label')}</summary>
                                    <div className={styles.metadataFields}>
                                        <label className={styles.metadataField}>
                                            <span>{t('ai_providers.model_display_name_label')}</span>
                                            <input
                                                className={inputClassNames}
                                                value={entry.displayName ?? ''}
                                                onChange={(event) => updateMetadata(index, {
                                                    displayName: event.target.value,
                                                })}
                                                disabled={disabled}
                                            />
                                        </label>
                                        {advancedFlags.map(({field, label}) => (
                                            <label className={styles.metadataField} key={field}>
                                                <span>{t(label)}</span>
                                                <select
                                                    className={inputClassNames}
                                                    value={entry[field] === undefined ? '' : String(entry[field])}
                                                    onChange={(event) => updateMetadata(index, {
                                                        [field]: event.target.value === '' ? undefined :
                                                                 event.target.value === 'true',
                                                    })}
                                                    disabled={disabled}
                                                >
                                                    <option value=''>{t('common.not_set')}</option>
                                                    <option value='true'>{t('common.yes')}</option>
                                                    <option value='false'>{t('common.no')}</option>
                                                </select>
                                            </label>
                                        ))}
                                        {provider === 'openai' && ([
                                            {field: 'inputModalities', label: 'ai_providers.model_input_modalities_label'},
                                            {field: 'outputModalities', label: 'ai_providers.model_output_modalities_label'},
                                        ] as const).map(({field, label}) => (
                                                <label className={styles.metadataField} key={field}>
                                                    <span>{t(label)}</span>
                                                    <input
                                                        className={inputClassNames}
                                                        value={entry[field]?.join(', ') ?? ''}
                                                        onChange={(event) => updateMetadata(index, {
                                                            [field]: event.target.value.split(',')
                                                                .map((value) => value.trim()).filter(Boolean),
                                                        })}
                                                        disabled={disabled}
                                                    />
                                                </label>
                                            ))}
                                    </div>
                                </details>
                            </div>
                        )}
                    </div>
                </Fragment>
                )
            })}
            {!hideAddButton && addLabel && (
                <Button variant='secondary' size='sm' onClick={addEntry} disabled={disabled} className='align-start'>
                    {addLabel}
                </Button>
            )}
        </div>
    )
}
