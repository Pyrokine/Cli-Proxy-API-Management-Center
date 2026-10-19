const SCROLL_LOCK_CLASS = 'modal-open'
let activeScrollLockCount = 0

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

export const lockScroll = () => {
    if (typeof document === 'undefined') {
        return
    }
    if (activeScrollLockCount === 0) {
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

        body.classList.add(SCROLL_LOCK_CLASS)
        html.classList.add(SCROLL_LOCK_CLASS)

        body.style.position = 'fixed'
        body.style.top      = `-${scrollLockSnapshot.scrollY}px`
        body.style.left     = '0'
        body.style.right    = '0'
        body.style.width    = '100%'
        body.style.overflow = 'hidden'
        html.style.overflow = 'hidden'
    }
    activeScrollLockCount += 1
}

export const unlockScroll = () => {
    if (typeof document === 'undefined') {
        return
    }
    activeScrollLockCount = Math.max(0, activeScrollLockCount - 1)
    if (activeScrollLockCount === 0) {
        const body             = document.body
        const html             = document.documentElement
        const scrollY          = scrollLockSnapshot.scrollY
        const contentScrollTop = scrollLockSnapshot.contentScrollTop
        const contentEl        = scrollLockSnapshot.contentEl

        body.classList.remove(SCROLL_LOCK_CLASS)
        html.classList.remove(SCROLL_LOCK_CLASS)

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
