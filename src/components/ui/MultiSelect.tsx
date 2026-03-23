import {type MouseEvent, useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {DropdownPanel} from './DropdownPanel'
import {IconCheck, IconChevronDown, IconX} from './icons'
import styles from './MultiSelect.module.scss'
import {useDropdown} from './useDropdown'

interface MultiSelectOption {
    value: string;
    label: string;
}

interface MultiSelectProps {
    values: string[];
    options: ReadonlyArray<MultiSelectOption>;
    onChange: (values: string[]) => void;
    placeholder?: string;
    className?: string;
    disabled?: boolean;
    ariaLabel?: string;
    fullWidth?: boolean;
    allLabel?: string;
}

export function MultiSelect({
                                values,
                                options,
                                onChange,
                                placeholder,
                                className,
                                disabled = false,
                                ariaLabel,
                                fullWidth = true,
                                allLabel,
                            }: MultiSelectProps) {
    const { isOpen, pos, wrapRef, dropdownRef, toggle } = useDropdown(options.length, 280, disabled)

    const [search, setSearch] = useState('')
    const searchRef           = useRef<HTMLInputElement | null>(null)
    const { t }               = useTranslation()

    // Clear search when dropdown closes
    useEffect(() => {
        if (!isOpen) {
            setSearch('')
        }
    }, [isOpen])

    useEffect(() => {
        if (isOpen && searchRef.current) {
            searchRef.current.focus()
        }
    }, [isOpen])

    const selectedSet   = useMemo(() => new Set(values), [values])
    const isAllSelected = values.length === 0

    const filteredOptions = useMemo(() => {
        if (!search.trim()) {
            return options
        }
        const query = search.trim().toLowerCase()
        return options.filter((opt) => opt.label.toLowerCase().includes(query))
    }, [options, search])

    const showSearch = options.length > 8

    const handleOptionClick = useCallback(
        (value: string) => {
            if (selectedSet.has(value)) {
                onChange(values.filter((v) => v !== value))
            } else {
                onChange([...values, value])
            }
        },
        [selectedSet, values, onChange],
    )

    const handleSelectAll = () => {
        onChange([])
    }

    const displayText = useMemo(() => {
        if (isAllSelected) {
            return allLabel ?? placeholder ?? ''
        }
        if (values.length === 1) {
            const matched = options.find((o) => o.value === values[0])
            return matched?.label ?? values[0]
        }
        return `${values.length} selected`
    }, [values, options, isAllSelected, allLabel, placeholder])

    const handleClear = (e: MouseEvent) => {
        e.stopPropagation()
        onChange([])
    }

    return (
        <div className={`${styles.wrap} ${fullWidth ? styles.wrapFullWidth : ''} ${className ?? ''}`} ref={wrapRef}>
            <button
                type='button'
                className={styles.trigger}
                onClick={toggle}
                aria-haspopup='listbox'
                aria-expanded={isOpen}
                aria-label={ariaLabel}
                disabled={disabled}
            >
                <span
                    className={`${styles.triggerText} ${isAllSelected ? styles.placeholder : ''}`}>{displayText}</span>
                <span className={styles.triggerActions}>
          {!isAllSelected && (
              <span
                  className={styles.clearButton}
                  role='button'
                  tabIndex={-1}
                  onClick={handleClear}
                  aria-label='Clear selection'
              >
              <IconX size={12} />
            </span>
          )}
                    <span className={styles.triggerIcon} aria-hidden='true'>
            <IconChevronDown size={14} />
          </span>
        </span>
            </button>
            {isOpen && (
                <DropdownPanel
                    dropdownRef={dropdownRef}
                    pos={pos}
                    className={styles.dropdown}
                    upClassName={styles.dropdownUp}
                    ariaLabel={ariaLabel}
                    multiselectable
                >
                    {showSearch && (
                        <input
                            ref={searchRef}
                            type='text'
                            className={styles.searchInput}
                            placeholder={t('multi_select.search_placeholder')}
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                            autoComplete='off'
                        />
                    )}
                    {!search.trim() && (
                        <button
                            type='button'
                            role='option'
                            aria-selected={isAllSelected}
                            className={`${styles.option} ${isAllSelected ? styles.optionActive : ''}`}
                            onClick={handleSelectAll}
                        >
                            <span className={styles.optionCheck}>{isAllSelected && <IconCheck size={14} />}</span>
                            <span>{allLabel ?? placeholder ?? 'All'}</span>
                        </button>
                    )}
                    {filteredOptions.length === 0 ? (
                        <div className={styles.emptyResult}>{t('multi_select.no_match')}</div>
                    ) : (
                         filteredOptions.map((opt) => {
                             const active = selectedSet.has(opt.value)
                             return (
                                 <button
                                     key={opt.value}
                                     type='button'
                                     role='option'
                                     aria-selected={active}
                                     className={`${styles.option} ${active ? styles.optionActive : ''}`}
                                     onClick={() => handleOptionClick(opt.value)}
                                 >
                                     <span className={styles.optionCheck}>{active && <IconCheck size={14} />}</span>
                                     <span className={styles.optionLabel}>{opt.label}</span>
                                 </button>
                             )
                         })
                     )}
                </DropdownPanel>
            )}
        </div>
    )
}
