import {useCallback, useEffect, useRef, useState} from 'react'

export interface DropdownPos {
    top: number;
    left: number;
    width: number;
    up: boolean;
}

const INITIAL_POS: DropdownPos = { top: 0, left: 0, width: 0, up: false }

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
        const spaceBelow     = window.innerHeight - rect.bottom
        const dropdownHeight = Math.min(optionCount * 40 + 12, maxHeight)
        const up             = spaceBelow < dropdownHeight + 8 && rect.top > spaceBelow
        setPos({
                   top: up ? rect.top - 6 : rect.bottom + 6,
                   left: rect.left,
                   width: Math.max(rect.width, 180),
                   up,
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

    return { isOpen, pos, wrapRef, dropdownRef, toggle, close }
}
