import type {ReactNode, RefObject} from 'react'
import {createPortal} from 'react-dom'
import type {DropdownPos} from './useDropdown'

interface DropdownPanelProps {
    dropdownRef: RefObject<HTMLDivElement | null>
    pos: DropdownPos
    className: string
    upClassName: string
    ariaLabel?: string
    multiselectable?: boolean
    children: ReactNode
}

export function DropdownPanel({
                                  dropdownRef,
                                  pos,
                                  className,
                                  upClassName,
                                  ariaLabel,
                                  multiselectable,
                                  children,
                              }: DropdownPanelProps) {
    return createPortal(
        <div
            ref={dropdownRef}
            className={`${className} ${pos.up ? upClassName : ''}`}
            role='listbox'
            aria-label={ariaLabel}
            aria-multiselectable={multiselectable ? 'true' : undefined}
            style={{
                position: 'fixed',
                top: pos.up ? undefined : pos.top,
                bottom: pos.up ? window.innerHeight - pos.top : undefined,
                left: pos.left,
                width: 'max-content',
                minWidth: pos.width,
                maxWidth: 'min(36rem, calc(100vw - 16px))',
                maxHeight: pos.maxHeight,
            }}
        >
            {children}
        </div>,
        document.body,
    )
}
