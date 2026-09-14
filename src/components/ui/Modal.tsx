import {
    type MouseEvent as ReactMouseEvent,
    type PropsWithChildren,
    type ReactNode,
    useCallback,
    useEffect,
    useId,
    useRef,
    useState,
} from 'react'
import {createPortal} from 'react-dom'
import {IconX} from './icons'

interface ModalProps {
    open: boolean
    title?: ReactNode
    onClose: () => void
    footer?: ReactNode
    width?: number | string
    className?: string
    overlayClassName?: string
    closeDisabled?: boolean
    closeBehavior?: 'after-animation' | 'immediate'
    closeOnOverlay?: boolean
    closeOnEscape?: boolean
    closeLabel?: string
    initialFocusId?: string
    returnFocusId?: string
}

const CLOSE_ANIMATION_DURATION   = 350
const MODAL_LOCK_CLASS           = 'modal-open'
const FOCUSABLE_SELECTOR         = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
].join(',')
let activeModalCount             = 0
const activeModalStack: string[] = []

const scrollLockSnapshot = {
    scrollY: 0,
    contentScrollTop: 0,
    contentEl: null as HTMLElement | null,
    bodyPosition: '',
    bodyTop: '',
    bodyLeft: '',
    bodyRight: '',
    bodyWidth: '',
    bodyOverflow: '',
    htmlOverflow: '',
}

const resolveContentScrollContainer = () => {
    if (typeof document === 'undefined') {
        return null
    }
    const contentEl = document.querySelector('.content')
    return contentEl instanceof HTMLElement ? contentEl : null
}

const lockScroll = () => {
    if (typeof document === 'undefined') {
        return
    }
    if (activeModalCount === 0) {
        const body      = document.body
        const html      = document.documentElement
        const contentEl = resolveContentScrollContainer()

        scrollLockSnapshot.scrollY          = window.scrollY || window.pageYOffset || html.scrollTop || 0
        scrollLockSnapshot.contentEl        = contentEl
        scrollLockSnapshot.contentScrollTop = contentEl?.scrollTop ?? 0
        scrollLockSnapshot.bodyPosition     = body.style.position
        scrollLockSnapshot.bodyTop          = body.style.top
        scrollLockSnapshot.bodyLeft         = body.style.left
        scrollLockSnapshot.bodyRight        = body.style.right
        scrollLockSnapshot.bodyWidth        = body.style.width
        scrollLockSnapshot.bodyOverflow     = body.style.overflow
        scrollLockSnapshot.htmlOverflow     = html.style.overflow

        body.classList.add(MODAL_LOCK_CLASS)
        html.classList.add(MODAL_LOCK_CLASS)

        body.style.position = 'fixed'
        body.style.top      = `-${scrollLockSnapshot.scrollY}px`
        body.style.left     = '0'
        body.style.right    = '0'
        body.style.width    = '100%'
        body.style.overflow = 'hidden'
        html.style.overflow = 'hidden'
    }
    activeModalCount += 1
}

const unlockScroll = () => {
    if (typeof document === 'undefined') {
        return
    }
    activeModalCount = Math.max(0, activeModalCount - 1)
    if (activeModalCount === 0) {
        const body             = document.body
        const html             = document.documentElement
        const scrollY          = scrollLockSnapshot.scrollY
        const contentScrollTop = scrollLockSnapshot.contentScrollTop
        const contentEl        = scrollLockSnapshot.contentEl

        body.classList.remove(MODAL_LOCK_CLASS)
        html.classList.remove(MODAL_LOCK_CLASS)

        body.style.position = scrollLockSnapshot.bodyPosition
        body.style.top      = scrollLockSnapshot.bodyTop
        body.style.left     = scrollLockSnapshot.bodyLeft
        body.style.right    = scrollLockSnapshot.bodyRight
        body.style.width    = scrollLockSnapshot.bodyWidth
        body.style.overflow = scrollLockSnapshot.bodyOverflow
        html.style.overflow = scrollLockSnapshot.htmlOverflow

        if (contentEl) {
            contentEl.scrollTo({ top: contentScrollTop, left: 0, behavior: 'auto' })
        }
        window.scrollTo({ top: scrollY, left: 0, behavior: 'auto' })

        scrollLockSnapshot.scrollY          = 0
        scrollLockSnapshot.contentScrollTop = 0
        scrollLockSnapshot.contentEl        = null
    }
}

const removeActiveModal = (modalId: string) => {
    const index = activeModalStack.lastIndexOf(modalId)
    if (index >= 0) {
        activeModalStack.splice(index, 1)
    }
}

const focusableElements = (root: HTMLElement): HTMLElement[] =>
    Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((element) => {
        if (element.getAttribute('aria-hidden') === 'true' || element.closest('[aria-hidden="true"], [inert]')) {
            return false
        }
        const style = window.getComputedStyle(element)
        return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0
    })

export function Modal({
                          open,
                          title,
                          onClose,
                          footer,
                          width = 520,
                          className,
                          overlayClassName,
                          closeDisabled = false,
                          closeBehavior = 'after-animation',
                          closeOnOverlay = true,
                          closeOnEscape = true,
                          closeLabel = 'Close',
                          initialFocusId,
                          returnFocusId,
                          children,
                      }: PropsWithChildren<ModalProps>) {
    const [isVisible, setIsVisible] = useState(false)
    const [isClosing, setIsClosing] = useState(false)
    const closeTimerRef             = useRef<number | null>(null)
    const dialogRef                 = useRef<HTMLDivElement | null>(null)
    const previousFocusRef          = useRef<HTMLElement | null>(null)
    const focusCapturedRef          = useRef(false)
    const returnFocusIdRef          = useRef(returnFocusId)
    const modalId                   = useId()
    const titleId                   = useId()

    useEffect(() => {
        returnFocusIdRef.current = returnFocusId
    }, [returnFocusId])

    const startClose = useCallback(
        (notifyParent: boolean) => {
            if (closeTimerRef.current !== null) {
                return
            }
            setIsClosing(true)
            closeTimerRef.current = window.setTimeout(() => {
                setIsVisible(false)
                setIsClosing(false)
                closeTimerRef.current = null
                if (notifyParent) {
                    onClose()
                }
            }, CLOSE_ANIMATION_DURATION)
        },
        [onClose],
    )

    useEffect(() => {
        let cancelled = false

        if (open) {
            if (closeTimerRef.current !== null) {
                window.clearTimeout(closeTimerRef.current)
                closeTimerRef.current = null
            }
            queueMicrotask(() => {
                if (cancelled) {
                    return
                }
                setIsVisible(true)
                setIsClosing(false)
            })
        } else if (isVisible) {
            queueMicrotask(() => {
                if (cancelled) {
                    return
                }
                startClose(false)
            })
        }

        return () => {
            cancelled = true
        }
    }, [open, isVisible, startClose])

    const handleClose = useCallback(() => {
        if (closeDisabled) {
            return
        }
        if (closeBehavior === 'immediate') {
            onClose()
            return
        }
        startClose(true)
    }, [closeBehavior, closeDisabled, onClose, startClose])

    const restoreFocus = useCallback(() => {
        if (!focusCapturedRef.current || typeof document === 'undefined') {
            return
        }
        focusCapturedRef.current = false
        const previousFocus      = previousFocusRef.current
        previousFocusRef.current = null
        const restore            = () => {
            const currentReturnFocusId = returnFocusIdRef.current
            const explicitTarget       = currentReturnFocusId ? document.getElementById(currentReturnFocusId) : null
            const target               = explicitTarget ?? (previousFocus?.isConnected ? previousFocus : null)
            target?.focus({ preventScroll: true })
        }
        if (typeof window.requestAnimationFrame === 'function') {
            window.requestAnimationFrame(restore)
        } else {
            restore()
        }
    }, [])

    useEffect(() => {
        return () => {
            if (closeTimerRef.current !== null) {
                window.clearTimeout(closeTimerRef.current)
            }
            restoreFocus()
        }
    }, [restoreFocus])

    const shouldLockScroll = open || isVisible

    useEffect(() => {
        if (!shouldLockScroll) {
            return
        }
        activeModalStack.push(modalId)
        lockScroll()
        return () => {
            removeActiveModal(modalId)
            unlockScroll()
        }
    }, [modalId, shouldLockScroll])

    useEffect(() => {
        if (!open || !isVisible || focusCapturedRef.current || typeof document === 'undefined') {
            return
        }
        const active             = document.activeElement
        previousFocusRef.current = active instanceof HTMLElement ? active : null
        focusCapturedRef.current = true
        const frame              = window.requestAnimationFrame(() => {
            const dialog = dialogRef.current
            if (!dialog || activeModalStack[activeModalStack.length - 1] !== modalId) {
                return
            }
            const explicitTarget = initialFocusId ? document.getElementById(initialFocusId) : null
            if (explicitTarget && dialog.contains(explicitTarget)) {
                explicitTarget.focus({ preventScroll: true })
                return
            }
            const current = document.activeElement
            if (current instanceof HTMLElement && dialog.contains(current)) {
                return
            }
            const first = focusableElements(dialog)[0]
            ;(first ?? dialog).focus({ preventScroll: true })
        })
        return () => window.cancelAnimationFrame(frame)
    }, [initialFocusId, isVisible, modalId, open])

    useEffect(() => {
        if (!open && !isVisible) {
            restoreFocus()
        }
    }, [isVisible, open, restoreFocus])

    useEffect(() => {
        if (!shouldLockScroll || typeof document === 'undefined') {
            return
        }
        const handleKeyDown = (event: KeyboardEvent) => {
            if (activeModalStack[activeModalStack.length - 1] !== modalId) {
                return
            }
            if (event.key === 'Escape' && closeOnEscape) {
                event.preventDefault()
                event.stopPropagation()
                handleClose()
                return
            }
            if (event.key !== 'Tab') {
                return
            }
            const dialog = dialogRef.current
            if (!dialog) {
                return
            }
            const elements = focusableElements(dialog)
            if (elements.length === 0) {
                event.preventDefault()
                dialog.focus({ preventScroll: true })
                return
            }
            const active = document.activeElement
            const first  = elements[0]
            const last   = elements[elements.length - 1]
            if (event.shiftKey && (active === first || !dialog.contains(active))) {
                event.preventDefault()
                last.focus({ preventScroll: true })
            } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
                event.preventDefault()
                first.focus({ preventScroll: true })
            }
        }
        document.addEventListener('keydown', handleKeyDown, true)
        return () => document.removeEventListener('keydown', handleKeyDown, true)
    }, [closeOnEscape, handleClose, modalId, shouldLockScroll])

    if (!open && !isVisible) {
        return null
    }

    const overlayClass = [
        'modal-overlay',
        isClosing ? 'modal-overlay-closing' : 'modal-overlay-entering',
        overlayClassName,
    ]
        .filter(Boolean)
        .join(' ')
    const modalClass   = [
        'modal',
        isClosing ? 'modal-closing' : 'modal-entering',
        className,
    ]
        .filter(Boolean)
        .join(' ')

    const handleOverlayMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
        if (closeOnOverlay && event.target === event.currentTarget) {
            handleClose()
        }
    }

    const modalContent = (
        <div className={overlayClass} onMouseDown={handleOverlayMouseDown}>
            <div
                ref={dialogRef}
                className={modalClass}
                style={{ width }}
                role='dialog'
                aria-modal='true'
                aria-labelledby={title ? titleId : undefined}
                aria-label={title ? undefined : closeLabel}
                tabIndex={-1}
            >
                <button
                    type='button'
                    className='modal-close-floating'
                    onClick={handleClose}
                    aria-label={closeLabel}
                    disabled={closeDisabled}
                >
                    <IconX size={20} />
                </button>
                <div className='modal-header'>
                    <div className='modal-title' id={titleId}>{title}</div>
                </div>
                <div className='modal-body'>{children}</div>
                {footer && <div className='modal-footer'>{footer}</div>}
            </div>
        </div>
    )

    if (typeof document === 'undefined') {
        return modalContent
    }

    return createPortal(modalContent, document.body)
}
