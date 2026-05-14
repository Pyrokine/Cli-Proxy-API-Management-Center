import {
    type ChangeEvent,
    type CSSProperties,
    type KeyboardEvent,
    type ReactNode,
    useCallback,
    useEffect,
    useRef,
    useState,
} from 'react'
import { createPortal } from 'react-dom'
import styles from './AutocompleteInput.module.scss'
import { IconChevronDown } from './icons'

interface AutocompleteInputProps {
    label?: string
    value: string
    onChange: (value: string) => void
    options: string[] | { value: string; label?: string }[]
    placeholder?: string
    disabled?: boolean
    hint?: string
    error?: string
    className?: string
    wrapperClassName?: string
    wrapperStyle?: CSSProperties
    id?: string
    rightElement?: ReactNode
}

export function AutocompleteInput({
    label,
    value,
    onChange,
    options,
    placeholder,
    disabled,
    hint,
    error,
    className = '',
    wrapperClassName = '',
    wrapperStyle,
    id,
    rightElement,
}: AutocompleteInputProps) {
    const [isOpen, setIsOpen] = useState(false)
    const [highlightedIndex, setHighlightedIndex] = useState(-1)
    const containerRef = useRef<HTMLDivElement>(null)
    const dropdownRef = useRef<HTMLDivElement>(null)
    const inputWrapRef = useRef<HTMLDivElement>(null)

    const normalizedOptions = options.map((opt) =>
        typeof opt === 'string' ? { value: opt, label: opt } : { value: opt.value, label: opt.label || opt.value }
    )

    const filteredOptions = normalizedOptions.filter((opt) => {
        const v = value.toLowerCase()
        return opt.value.toLowerCase().includes(v) || (opt.label && opt.label.toLowerCase().includes(v))
    })

    // Click outside: close if target is neither the container nor the portal dropdown
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            const target = event.target as Node
            if (containerRef.current?.contains(target) || dropdownRef.current?.contains(target)) {
                return
            }
            setIsOpen(false)
        }
        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [])

    // Calculate dropdown position relative to the viewport
    const calcDropdownStyle = useCallback((): CSSProperties => {
        if (!inputWrapRef.current) {
            return {}
        }
        const rect = inputWrapRef.current.getBoundingClientRect()
        const maxHeight = 200
        const gap = 4
        const spaceBelow = window.innerHeight - rect.bottom
        const openUp = spaceBelow < maxHeight + gap && rect.top > spaceBelow

        return {
            position: 'fixed',
            left: rect.left,
            width: rect.width,
            maxHeight,
            overflowY: 'auto',
            zIndex: 9999,
            backgroundColor: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-md)',
            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
            ...(openUp ? { bottom: window.innerHeight - rect.top + gap } : { top: rect.bottom + gap }),
        }
    }, [])

    const [dropdownStyle, setDropdownStyle] = useState<CSSProperties>({})

    // Recalculate position on scroll/resize while open
    useEffect(() => {
        if (!isOpen) {
            return
        }

        const reposition = () => setDropdownStyle(calcDropdownStyle())
        // Initial positioning is handled via requestAnimationFrame to avoid
        // synchronous setState inside the effect body (react-hooks/set-state-in-effect).
        const raf = requestAnimationFrame(reposition)
        window.addEventListener('scroll', reposition, true)
        window.addEventListener('resize', reposition)
        return () => {
            cancelAnimationFrame(raf)
            window.removeEventListener('scroll', reposition, true)
            window.removeEventListener('resize', reposition)
        }
    }, [isOpen, calcDropdownStyle])

    const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
        onChange(e.target.value)
        setIsOpen(true)
        setHighlightedIndex(-1)
    }

    const handleSelect = (selectedValue: string) => {
        onChange(selectedValue)
        setIsOpen(false)
    }

    const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        if (disabled) {
            return
        }

        if (e.key === 'ArrowDown') {
            e.preventDefault()
            if (!isOpen) {
                setIsOpen(true)
                return
            }
            setHighlightedIndex((prev) => (prev < filteredOptions.length - 1 ? prev + 1 : prev))
        } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : 0))
        } else if (e.key === 'Enter') {
            if (isOpen && highlightedIndex >= 0 && highlightedIndex < filteredOptions.length) {
                e.preventDefault()
                handleSelect(filteredOptions[highlightedIndex].value)
            } else if (isOpen) {
                e.preventDefault()
                setIsOpen(false)
            }
        } else if (e.key === 'Escape') {
            setIsOpen(false)
        } else if (e.key === 'Tab') {
            setIsOpen(false)
        }
    }

    const showDropdown = isOpen && filteredOptions.length > 0 && !disabled

    return (
        <div className={`form-group ${wrapperClassName}`} ref={containerRef} style={wrapperStyle}>
            {label && <label htmlFor={id}>{label}</label>}
            <div className={styles.inputWrap} ref={inputWrapRef}>
                <input
                    id={id}
                    className={`input ${className}`.trim()}
                    value={value}
                    onChange={handleInputChange}
                    onFocus={() => setIsOpen(true)}
                    onKeyDown={handleKeyDown}
                    placeholder={placeholder}
                    disabled={disabled}
                    autoComplete="off"
                    style={{ paddingRight: 32 }}
                />
                <div
                    className={`${styles.chevron} ${disabled ? styles.disabled : ''}`}
                    onClick={() => !disabled && setIsOpen(!isOpen)}
                >
                    {rightElement}
                    <IconChevronDown size={16} style={{ opacity: 0.5, marginLeft: 4 }} />
                </div>
            </div>

            {/* Portal-based dropdown to avoid parent overflow:hidden clipping */}
            {showDropdown &&
                createPortal(
                    <div ref={dropdownRef} className="autocomplete-dropdown" style={dropdownStyle}>
                        {filteredOptions.map((opt, index) => (
                            <div
                                key={`${opt.value}-${index}`}
                                onClick={() => handleSelect(opt.value)}
                                className={`${styles.option} ${index === highlightedIndex ? styles.highlighted : ''}`}
                                onMouseEnter={() => setHighlightedIndex(index)}
                            >
                                <span className={styles.optionValue}>{opt.value}</span>
                                {opt.label && opt.label !== opt.value && (
                                    <span className={styles.optionLabel}>{opt.label}</span>
                                )}
                            </div>
                        ))}
                    </div>,
                    document.body
                )}

            {hint && <div className="hint">{hint}</div>}
            {error && <div className="error-box">{error}</div>}
        </div>
    )
}
