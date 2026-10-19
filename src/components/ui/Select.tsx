import {type AriaAttributes, type KeyboardEvent, useRef} from 'react'
import {DropdownPanel} from './DropdownPanel'
import {IconChevronDown} from './icons'
import styles from './Select.module.scss'
import {useDropdown} from './useDropdown'

interface SelectOption {
    value: string
    label: string
}

interface SelectProps {
    value: string
    options: ReadonlyArray<SelectOption>
    onChange: (value: string) => void
    placeholder?: string
    className?: string
    disabled?: boolean
    id?: string
    ariaLabel?: string
    ariaLabelledBy?: string
    ariaDescribedBy?: string
    ariaInvalid?: AriaAttributes['aria-invalid']
    fullWidth?: boolean
}

export function Select({
                           value,
                           options,
                           onChange,
                           placeholder,
                           className,
                           disabled = false,
                           id,
                           ariaLabel,
                           ariaLabelledBy,
                           ariaDescribedBy,
                           ariaInvalid,
                           fullWidth = true,
                       }: SelectProps) {
    const { isOpen, pos, wrapRef, dropdownRef, toggle, close } = useDropdown(options.length, 240, disabled)
    const triggerRef = useRef<HTMLButtonElement | null>(null)

    const closeOnEscape = (event: KeyboardEvent<HTMLButtonElement>) => {
        if (isOpen && event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            close()
            triggerRef.current?.focus({ preventScroll: true })
        }
    }

    const selected      = options.find((o) => o.value === value)
    const displayText   = selected?.label ?? placeholder ?? ''
    const isPlaceholder = !selected && placeholder

    return (
        <div className={`${styles.wrap} ${fullWidth ? styles.wrapFullWidth : ''} ${className ?? ''}`} ref={wrapRef}>
            <button
                ref={triggerRef}
                type='button'
                className={styles.trigger}
                onClick={toggle}
                onKeyDown={closeOnEscape}
                id={id}
                aria-haspopup='listbox'
                aria-expanded={isOpen}
                aria-label={ariaLabel}
                aria-labelledby={ariaLabelledBy}
                aria-describedby={ariaDescribedBy}
                aria-invalid={ariaInvalid}
                disabled={disabled}
            >
                <span className={`${styles.triggerText} ${isPlaceholder ? styles.placeholder : ''}`}>
                    {displayText}
                </span>
                <span className={styles.triggerIcon} aria-hidden='true'>
                    <IconChevronDown size={14} />
                </span>
            </button>
            {isOpen && (
                <DropdownPanel
                    dropdownRef={dropdownRef}
                    pos={pos}
                    className={styles.dropdown}
                    upClassName={styles.dropdownUp}
                    ariaLabel={ariaLabel}
                >
                    {options.map((opt) => {
                        const active = opt.value === value
                        return (
                            <button
                                key={opt.value}
                                type='button'
                                role='option'
                                aria-selected={active}
                                className={`${styles.option} ${active ? styles.optionActive : ''}`}
                                onKeyDown={closeOnEscape}
                                onClick={() => {
                                    onChange(opt.value)
                                    close()
                                    triggerRef.current?.focus({ preventScroll: true })
                                }}
                            >
                                {opt.label}
                            </button>
                        )
                    })}
                </DropdownPanel>
            )}
        </div>
    )
}
