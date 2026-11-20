import {type KeyboardEvent, useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react'

export interface DropdownPos {
    top: number
    left: number
    width: number
    up: boolean
    maxHeight: number
}

const INITIAL_POS: DropdownPos = { top: 0, left: 0, width: 0, up: false, maxHeight: 0 }

/**
 * Shared dropdown positioning and open/close logic for Select and MultiSelect.
 *
 * @param optionCount   Number of options (used to estimate dropdown height)
 * @param maxHeight     Maximum dropdown height in pixels
 * @param disabled      Whether the trigger is disabled
 */
export function useDropdown(optionCount: number, maxHeight: number, disabled: boolean) {
    const [open, setOpen] = useState(false)
    const [pos, setPos]   = useState<DropdownPos>(INITIAL_POS)
    const wrapRef         = useRef<HTMLDivElement | null>(null)
    const dropdownRef     = useRef<HTMLDivElement | null>(null)

    const calcPos = useCallback(() => {
        if (!wrapRef.current) {
            return
        }
        const rect           = wrapRef.current.getBoundingClientRect()
        const margin         = 8
        const bottomAnchor   = Math.max(margin, Math.min(rect.top - 6, window.innerHeight - margin))
        const topAnchor      = Math.max(margin, Math.min(rect.bottom + 6, window.innerHeight - margin))
        const spaceBelow     = Math.max(0, window.innerHeight - topAnchor - margin)
        const spaceAbove     = Math.max(0, bottomAnchor - margin)
        const dropdownHeight = Math.min(optionCount * 40 + 12, maxHeight)
        const up             = spaceBelow < dropdownHeight && spaceAbove > spaceBelow
        const width          = Math.min(Math.max(rect.width, 180), Math.max(0, window.innerWidth - margin * 2))
        const panelWidth     = dropdownRef.current?.getBoundingClientRect().width ?? width
        setPos({
                   top: up ? bottomAnchor : topAnchor,
                   left: Math.max(margin, Math.min(rect.left, window.innerWidth - panelWidth - margin)),
                   width,
                   up,
                   maxHeight: Math.min(maxHeight, up ? spaceAbove : spaceBelow),
               })
    }, [optionCount, maxHeight])

    // Close on click outside
    useEffect(() => {
        if (!open || disabled) {
            return
        }
        const handleClickOutside = (event: MouseEvent) => {
            const target = event.target as Node
            if (!wrapRef.current?.contains(target) && !dropdownRef.current?.contains(target)) {
                setOpen(false)
            }
        }
        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [disabled, open])

    // Recalculate on scroll/resize while open
    useEffect(() => {
        if (!open) {
            return
        }
        const handleReposition = () => calcPos()
        window.addEventListener('scroll', handleReposition, true)
        window.addEventListener('resize', handleReposition)
        return () => {
            window.removeEventListener('scroll', handleReposition, true)
            window.removeEventListener('resize', handleReposition)
        }
    }, [open, calcPos])

    const toggle = useCallback(() => {
        if (disabled) {
            return
        }
        setOpen((prev) => {
            if (!prev) {
                calcPos()
            }
            return !prev
        })
    }, [disabled, calcPos])

    const close = useCallback(() => setOpen(false), [])

    const isOpen = open && !disabled

    useLayoutEffect(() => {
        if (!isOpen || !dropdownRef.current) {
            return
        }
        calcPos()
        const observer = new ResizeObserver(calcPos)
        observer.observe(dropdownRef.current)
        return () => observer.disconnect()
    }, [isOpen, calcPos])

    const onKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
        if (disabled) {
            return
        }
        if (event.key === 'Escape' && isOpen) {
            event.preventDefault()
            event.stopPropagation()
            close()
            wrapRef.current?.querySelector('button')?.focus({ preventScroll: true })
            return
        }
        if (event.key === 'Tab') {
            close()
            return
        }
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
            return
        }
        if ((event.key === 'Home' || event.key === 'End') && (event.target as HTMLElement).tagName === 'INPUT') {
            return
        }
        event.preventDefault()
        if (!isOpen) {
            calcPos()
            setOpen(true)
        }
        const key = event.key
        requestAnimationFrame(() => {
            const options = Array.from(dropdownRef.current?.querySelectorAll<HTMLButtonElement>(
                '[role="option"]:not([disabled])') ?? [])
            if (!options.length) {
                return
            }
            const current  = options.indexOf(document.activeElement as HTMLButtonElement)
            const selected = options.findIndex((option) => option.getAttribute('aria-selected') === 'true')
            const index    = key === 'Home' ? 0 : key === 'End' ? options.length - 1 :
                                                  current < 0 ?
                                                  (selected >= 0 ?
                                                   selected :
                                                   key === 'ArrowUp' ? options.length - 1 : 0) :
                                                  (current + (key === 'ArrowUp' ? -1 : 1) + options.length) %
                                                  options.length
            options[index].focus({ preventScroll: true })
            options[index].scrollIntoView({ block: 'nearest' })
        })
    }, [disabled, isOpen, close, calcPos])

    return { isOpen, pos, wrapRef, dropdownRef, toggle, close, onKeyDown }
}
