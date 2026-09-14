import {normalizeMaxContextLength, normalizeModelThinking} from '@/utils/modelMetadata'
import {Fragment} from 'react'
import {useTranslation} from 'react-i18next'
import {Button} from './Button'
import {IconX} from './icons'
import styles from './ModelInputList.module.scss'
import {type ModelEntry, parseThinkingLevelsInput} from './modelInputListUtils'

const THINKING_BOOLEAN_FIELDS = [
    { field: 'zeroAllowed', label: 'ai_providers.model_thinking_zero_allowed_label' },
    { field: 'dynamicAllowed', label: 'ai_providers.model_thinking_dynamic_allowed_label' },
] as const

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
                               }: ModelInputListProps) {
    const { t }              = useTranslation()
    const currentEntries     = entries.length ? entries : [{ name: '', alias: '' }]
    const containerClassName = ['header-input-list', className].filter(Boolean).join(' ')
    const inputClassNames    = ['input', inputClassName].filter(Boolean).join(' ')
    const rowClassNames      = ['header-input-row', rowClassName].filter(Boolean).join(' ')

    const updateEntry = (index: number, field: 'name' | 'alias', value: string) => {
        const next = currentEntries.map((entry, idx) => (idx === index ? { ...entry, [field]: value } : entry))
        onChange(next)
    }

    const updateMaxContextLength = (index: number, value: string) => {
        const maxContextLength = normalizeMaxContextLength(value)
        const next             = currentEntries.map((entry, idx) => {
            if (idx !== index) {
                return entry
            }
            const updated = { ...entry }
            if (maxContextLength === undefined) {
                delete updated.maxContextLength
            } else {
                updated.maxContextLength = maxContextLength
            }
            return updated
        })
        onChange(next)
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
        const trimmed = value.trim()
        const parsed  = trimmed === '' ? undefined : Number(value)
        updateThinking(index, field, parsed !== undefined && Number.isInteger(parsed) ? parsed : undefined)
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
            {currentEntries.map((entry, index) => (
                <Fragment key={index}>
                    <div className={rowClassNames}>
                        <input
                            className={inputClassNames}
                            placeholder={namePlaceholder}
                            value={entry.name}
                            onChange={(e) => updateEntry(index, 'name', e.target.value)}
                            disabled={disabled}
                        />
                        <span className='header-separator'>→</span>
                        <input
                            className={inputClassNames}
                            placeholder={aliasPlaceholder}
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
                                <label className={styles.metadataField}>
                                    <span>{t('ai_providers.model_max_context_length_label')}</span>
                                    <input
                                        className={inputClassNames}
                                        type='number'
                                        min={1}
                                        step={1}
                                        value={entry.maxContextLength ?? ''}
                                        onChange={(event) => updateMaxContextLength(index, event.target.value)}
                                        disabled={disabled}
                                    />
                                </label>
                                <label className={styles.metadataField}>
                                    <span>{t('ai_providers.model_thinking_min_label')}</span>
                                    <input
                                        className={inputClassNames}
                                        type='number'
                                        step={1}
                                        value={entry.thinking?.min ?? ''}
                                        onChange={(event) => updateThinkingInteger(index, 'min', event.target.value)}
                                        disabled={disabled}
                                    />
                                </label>
                                <label className={styles.metadataField}>
                                    <span>{t('ai_providers.model_thinking_max_label')}</span>
                                    <input
                                        className={inputClassNames}
                                        type='number'
                                        step={1}
                                        value={entry.thinking?.max ?? ''}
                                        onChange={(event) => updateThinkingInteger(index, 'max', event.target.value)}
                                        disabled={disabled}
                                    />
                                </label>
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
                            </div>
                        )}
                    </div>
                </Fragment>
            ))}
            {!hideAddButton && addLabel && (
                <Button variant='secondary' size='sm' onClick={addEntry} disabled={disabled} className='align-start'>
                    {addLabel}
                </Button>
            )}
        </div>
    )
}
