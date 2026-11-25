import {normalizeModelThinking} from '@/utils/modelMetadata'
import {Fragment, useEffect, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {Button} from './Button'
import {IconX} from './icons'
import {Input} from './Input'
import styles from './ModelInputList.module.scss'
import {
    getModelEntriesValidationKey,
    type ModelEntry,
    parseThinkingLevelsInput,
    updateModelNumericField,
} from './modelInputListUtils'
import {Pagination} from './Pagination'
import {Select} from './Select'

const MODEL_PAGE_SIZE = 20

const THINKING_BOOLEAN_FIELDS = [
    { field: 'zeroAllowed', label: 'ai_providers.model_thinking_zero_allowed_label' },
    { field: 'dynamicAllowed', label: 'ai_providers.model_thinking_dynamic_allowed_label' },
] as const

const ADVANCED_BOOLEAN_FIELDS = [
    { field: 'isCompat', label: 'ai_providers.model_is_compat_label' },
    { field: 'forceMapping', label: 'ai_providers.model_force_mapping_label' },
    { field: 'supportConfigurationUpdate', label: 'ai_providers.model_configuration_update_label' },
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
    const { t }                             = useTranslation()
    const tokenLimitFieldLabel              = t('ai_providers.model_token_limit_field_label')
    const [search, setSearch]               = useState('')
    const [page, setPage]                   = useState(1)
    const [focusedIndex, setFocusedIndex]   = useState<number | null>(null)
    const [previousCount, setPreviousCount] = useState(entries.length)
    const listRef                           = useRef<HTMLDivElement>(null)
    const lastEntryRef                      = useRef<HTMLInputElement>(null)
    const previousLengthRef                 = useRef(entries.length)
    const currentEntries                    = entries.length ? entries : [{ name: '', alias: '' }]
    const filter                            = search.trim().toLowerCase()
    const filteredEntries                   = currentEntries
        .map((entry, index) => ({ entry, index }))
        .filter(({ entry, index }) => !filter || index === focusedIndex ||
                                      [entry.name, entry.alias, entry.displayName, entry.description].some(
                                          (value) => typeof value === 'string' && value.toLowerCase().includes(filter),
                                      ))
    const currentPage                       = Math.min(
        page,
        Math.max(1, Math.ceil(filteredEntries.length / MODEL_PAGE_SIZE)),
    )
    const visibleEntries                    = filteredEntries.slice(
        (currentPage - 1) * MODEL_PAGE_SIZE, currentPage * MODEL_PAGE_SIZE,
    )
    const containerClassName                = ['header-input-list', className].filter(Boolean).join(' ')
    const inputClassNames                   = ['input', inputClassName].filter(Boolean).join(' ')
    const rowClassNames                     = ['header-input-row', styles.row, rowClassName].filter(Boolean).join(' ')

    if (entries.length !== previousCount) {
        setPreviousCount(entries.length)
        if (entries.length > previousCount && entries[entries.length - 1]?.name === '') {
            setSearch('')
            setPage(Math.ceil(entries.length / MODEL_PAGE_SIZE))
        }
    } else if (currentPage !== page) {
        setPage(currentPage)
    }

    useEffect(() => {
        if (listRef.current) {
            listRef.current.scrollTop = 0
        }
    }, [currentPage, search])

    useEffect(() => {
        const added               = entries.length > previousLengthRef.current
        previousLengthRef.current = entries.length
        if (added && entries[entries.length - 1]?.name === '') {
            lastEntryRef.current?.focus()
        }
    }, [entries])
    const advancedFlags = ADVANCED_BOOLEAN_FIELDS.filter(({ field }) =>
                                                             (field === 'isCompat' && provider !== 'vertex') ||
                                                             field === 'forceMapping' ||
                                                             (field ===
                                                              'supportConfigurationUpdate' &&
                                                              provider ===
                                                              'codex') ||
                                                             (field === 'image' && provider === 'openai'),
    )

    const updateMetadata = (index: number, patch: Partial<ModelEntry>) => {
        onChange(currentEntries.map((entry, idx) => idx === index ? { ...entry, ...patch } : entry))
    }

    const updateEntry = (index: number, field: 'name' | 'alias', value: string) => {
        const next = currentEntries.map((entry, idx) => (idx === index ? { ...entry, [field]: value } : entry))
        onChange(next)
    }

    const updateMaxContextLength = (index: number, value: string) => {
        onChange(currentEntries.map((entry, idx) =>
                                        idx === index ?
                                        updateModelNumericField(entry, 'maxContextLength', value) :
                                        entry))
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

    const updateThinkingMode = (index: number, mode: string) => {
        onChange(currentEntries.map((entry, position) => {
            if (position !== index) {
                return entry
            }
            const next = { ...entry }
            delete next.thinkingMinDraft
            delete next.thinkingMaxDraft
            delete next.preserveImportedThinkingRange
            if (mode === 'inherit') {
                delete next.thinking
            } else {
                next.thinking =
                    mode === 'empty' ?
                        {} :
                    entry.thinking && Object.keys(entry.thinking).length ? { ...entry.thinking } : { min: 0, max: 0 }
            }
            return next
        }))
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
        setFocusedIndex(null)
        const next = currentEntries.filter((_, idx) => idx !== index)
        onChange(next.length ? next : [{ name: '', alias: '' }])
    }

    return (
        <div className={containerClassName}>
            <div className={styles.toolbar}>
                <Input
                    label={t('ai_providers.configured_models_search_label')}
                    placeholder={t('ai_providers.configured_models_search_placeholder')}
                    value={search}
                    onChange={(event) => {
                        setSearch(event.target.value)
                        setFocusedIndex(null)
                        setPage(1)
                    }}
                />
                <span className={styles.count} role='status'>
                    {t('ai_providers.models_match_count', {
                        matching: filteredEntries.filter(({ entry }) => entry.name.trim()).length,
                        total: currentEntries.filter((entry) => entry.name.trim()).length,
                    })}
                </span>
            </div>
            <div className={styles.entryList} ref={listRef}>
                {filteredEntries.length === 0 && (
                    <div className={styles.empty}>{t('ai_providers.configured_models_search_empty')}</div>
                )}
                {visibleEntries.map(({ entry, index }) => {
                    const validationKey = getModelEntriesValidationKey([entry])
                    return (
                        <Fragment key={index}>
                            <div className={rowClassNames}
                                 onFocusCapture={() => setFocusedIndex(index)}
                                 onBlurCapture={(event) => {
                                     if (!event.currentTarget.contains(event.relatedTarget)) {
                                         setFocusedIndex(null)
                                     }
                                 }}>
                                <input
                                    ref={index === currentEntries.length - 1 ? lastEntryRef : undefined}
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
                                    disabled={disabled}
                                    className={removeButtonClassName}
                                    title={removeButtonTitle}
                                    aria-label={removeButtonAriaLabel}
                                >
                                    <IconX size={14} />
                                </Button>
                                {metadataEditing && provider === 'openai' && (
                                    <div className={styles.metadataFields}>
                                        <label className={styles.metadataField}>
                                            <span>{tokenLimitFieldLabel}</span>
                                            <Select
                                                ariaLabel={entry.name ? `${tokenLimitFieldLabel}: ${entry.name}` :
                                                           tokenLimitFieldLabel}
                                                options={[
                                                    { value: 'max_tokens', label: 'max_tokens' },
                                                    { value: 'max_completion_tokens', label: 'max_completion_tokens' },
                                                ]}
                                                value={entry.useMaxCompletionTokens ?
                                                       'max_completion_tokens' :
                                                       'max_tokens'}
                                                onChange={(value) => updateMetadata(index, {
                                                    useMaxCompletionTokens: value === 'max_completion_tokens',
                                                })}
                                                disabled={disabled}
                                            />
                                        </label>
                                    </div>
                                )}
                                {metadataEditing && (
                                    <details className={styles.entryDetails} open={validationKey ? true : undefined}>
                                        <summary>{t('ai_providers.model_details_label')}</summary>
                                        <div className={styles.metadataFields}>
                                            {provider !== 'vertex' && (
                                                <label className={styles.metadataField}>
                                                    <span>{t('ai_providers.model_max_context_length_label')}</span>
                                                    <input
                                                        className={inputClassNames}
                                                        type='text'
                                                        inputMode='numeric'
                                                        value={entry.maxContextLengthDraft ??
                                                               entry.maxContextLength ??
                                                               ''}
                                                        aria-invalid={validationKey ===
                                                                      'ai_providers.model_context_invalid'}
                                                        onChange={(event) => updateMaxContextLength(
                                                            index,
                                                            event.target.value,
                                                        )}
                                                        disabled={disabled}
                                                    />
                                                </label>
                                            )}
                                            <label className={styles.metadataField}>
                                                <span>{t('ai_providers.model_thinking_mode')}</span>
                                                <Select
                                                    value={entry.thinking === undefined ?
                                                           'inherit' :
                                                           Object.keys(entry.thinking).length === 0 ?
                                                           'empty' :
                                                           'override'}
                                                    options={[
                                                        {
                                                            value: 'inherit',
                                                            label: t('ai_providers.model_thinking_inherit'),
                                                        },
                                                        {
                                                            value: 'empty',
                                                            label: t('ai_providers.model_thinking_empty'),
                                                        },
                                                        {
                                                            value: 'override',
                                                            label: t('ai_providers.model_thinking_override'),
                                                        },
                                                    ]}
                                                    ariaLabel={t('ai_providers.model_thinking_mode')}
                                                    disabled={disabled}
                                                    onChange={(value) => updateThinkingMode(index, value)}
                                                />
                                            </label>
                                            <label className={styles.metadataField}>
                                                <span>{t('ai_providers.model_thinking_min_label')}</span>
                                                <input
                                                    className={inputClassNames}
                                                    type='text'
                                                    inputMode='numeric'
                                                    value={entry.thinkingMinDraft ?? entry.thinking?.min ?? ''}
                                                    aria-invalid={validationKey ===
                                                                  'ai_providers.model_thinking_budget_invalid' ||
                                                                  validationKey ===
                                                                  'ai_providers.model_thinking_budget_range'}
                                                    onChange={(event) => updateThinkingInteger(
                                                        index,
                                                        'min',
                                                        event.target.value,
                                                    )}
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
                                                    aria-invalid={validationKey ===
                                                                  'ai_providers.model_thinking_budget_invalid' ||
                                                                  validationKey ===
                                                                  'ai_providers.model_thinking_budget_range'}
                                                    onChange={(event) => updateThinkingInteger(
                                                        index,
                                                        'max',
                                                        event.target.value,
                                                    )}
                                                    disabled={disabled}
                                                />
                                            </label>
                                            {validationKey && (
                                                <span className={styles.metadataError}
                                                      role='alert'>{t(validationKey)}</span>
                                            )}
                                            {THINKING_BOOLEAN_FIELDS.map(({ field, label }) => {
                                                const value = entry.thinking?.[field]
                                                return (
                                                    <label className={styles.metadataField} key={field}>
                                                        <span>{t(label)}</span>
                                                        <Select
                                                            ariaLabel={t(label)}
                                                            options={[
                                                                { value: '', label: t('common.not_set') },
                                                                { value: 'true', label: t('common.yes') },
                                                                { value: 'false', label: t('common.no') },
                                                            ]}
                                                            value={value === undefined ? '' : String(value)}
                                                            onChange={(value) => updateThinking(
                                                                index,
                                                                field,
                                                                value === '' ? undefined : value === 'true',
                                                            )}
                                                            disabled={disabled}
                                                        />
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
                                                    {advancedFlags.map(({ field, label }) => (
                                                        <label className={styles.metadataField} key={field}>
                                                            <span>{t(label)}</span>
                                                            <Select
                                                                ariaLabel={t(label)}
                                                                options={[
                                                                    { value: '', label: t('common.not_set') },
                                                                    { value: 'true', label: t('common.yes') },
                                                                    { value: 'false', label: t('common.no') },
                                                                ]}
                                                                value={entry[field] === undefined ?
                                                                       '' :
                                                                       String(entry[field])}
                                                                onChange={(value) => updateMetadata(index, {
                                                                    [field]: value === '' ?
                                                                             undefined :
                                                                             value === 'true',
                                                                })}
                                                                disabled={disabled}
                                                            />
                                                        </label>
                                                    ))}
                                                    {provider === 'openai' && ([
                                                        {
                                                            field: 'inputModalities',
                                                            label: 'ai_providers.model_input_modalities_label',
                                                        },
                                                        {
                                                            field: 'outputModalities',
                                                            label: 'ai_providers.model_output_modalities_label',
                                                        },
                                                    ] as const).map(({ field, label }) => (
                                                        <label className={styles.metadataField} key={field}>
                                                            <span>{t(label)}</span>
                                                            <input
                                                                className={inputClassNames}
                                                                value={entry[field]?.join(', ') ?? ''}
                                                                onChange={(event) => updateMetadata(index, {
                                                                    [field]: event.target.value.split(',')
                                                                                  .map((value) => value.trim()).filter(
                                                                            Boolean),
                                                                })}
                                                                disabled={disabled}
                                                            />
                                                        </label>
                                                    ))}
                                                </div>
                                            </details>
                                        </div>
                                    </details>
                                )}
                            </div>
                        </Fragment>
                    )
                })}
            </div>
            {filteredEntries.length > MODEL_PAGE_SIZE && (
                <Pagination total={filteredEntries.length} page={currentPage} pageSize={MODEL_PAGE_SIZE}
                            onPageChange={setPage} />
            )}
            {!hideAddButton && addLabel && (
                <Button variant='secondary' size='sm' onClick={addEntry} disabled={disabled} className='align-start'>
                    {addLabel}
                </Button>
            )}
        </div>
    )
}
