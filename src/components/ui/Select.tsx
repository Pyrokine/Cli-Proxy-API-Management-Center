import {DropdownPanel} from './DropdownPanel'
import {IconChevronDown} from './icons'
import styles from './Select.module.scss'
import {useDropdown} from './useDropdown'

interface SelectOption {
    value: string;
    label: string;
}

interface SelectProps {
    value: string;
    options: ReadonlyArray<SelectOption>;
    onChange: (value: string) => void;
    placeholder?: string;
    className?: string;
    disabled?: boolean;
    ariaLabel?: string;
    fullWidth?: boolean;
}

export function Select({
                           value,
                           options,
                           onChange,
                           placeholder,
                           className,
                           disabled = false,
                           ariaLabel,
                           fullWidth = true,
                       }: SelectProps) {
    const { isOpen, pos, wrapRef, dropdownRef, toggle, close } = useDropdown(options.length, 240, disabled)

    const selected      = options.find((o) => o.value === value)
    const displayText   = selected?.label ?? placeholder ?? ''
    const isPlaceholder = !selected && placeholder

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
                    className={`${styles.triggerText} ${isPlaceholder ? styles.placeholder : ''}`}>{displayText}</span>
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
                                onClick={() => {
                                    onChange(opt.value)
                                    close()
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
