import {describe, expect, mock, test} from 'bun:test'
import {readFileSync} from 'node:fs'
import {compile} from 'sass'
import {lockScroll, unlockScroll} from '@/components/ui/scrollLock'
import {shouldExitLogFullscreen} from '@/pages/hooks/logFullscreen'
import {sourceCallback, sourceInitializer} from './sourceCallbacks'

const page = 'pages/LogsPage.tsx'

function environment() {
    const original = new Map(['window', 'document', 'HTMLElement'].map((name) =>
        [name, Object.getOwnPropertyDescriptor(globalThis, name)]))
    const bodyStyles = {position: 'relative', top: '1px', left: '2px', right: '3px', width: '90%', overflow: 'auto'}
    const classes = () => {
        const values = new Set<string>()
        return {add: (name: string) => values.add(name), remove: (name: string) => values.delete(name), values}
    }
    class Element {
        scrollTop = 188
        scrollTo = mock()
    }
    const content = new Element()
    const body = {style: {...bodyStyles}, classList: classes()}
    const html = {style: {overflow: 'scroll'}, classList: classes(), scrollTop: 81}
    let overlay: object | null = null
    const document = {body, documentElement: html,
                      querySelector: (selector: string) => selector === '.content' ? content : overlay}
    const listeners = new Map<string, (event: KeyboardEvent) => void>()
    const window = {scrollY: 81, pageYOffset: 81, scrollTo: mock(),
                    addEventListener: (name: string, callback: (event: KeyboardEvent) => void) => listeners.set(name, callback),
                    removeEventListener: (name: string) => listeners.delete(name)}
    for (const [name, value] of Object.entries({document, window, HTMLElement: Element})) {
        Object.defineProperty(globalThis, name, {configurable: true, writable: true, value})
    }
    const setLogPanelFullscreen = mock()
    const fullscreen = (activeTab = 'logs', logPanelFullscreen = true, pageLayerStatus = 'current') => sourceCallback<() => (() => void) | undefined>(
        page, 'useEffect', {activeTab, logPanelFullscreen, pageLayerStatus, shouldExitLogFullscreen, setLogPanelFullscreen,
                            document, window, lockScroll, unlockScroll}, 'const handleKeyDown',
    )()
    const activeModalStack: string[] = []
    const removeActiveModal = sourceInitializer<(id: string) => void>('components/ui/Modal.tsx', 'removeActiveModal', {activeModalStack})
    const modal = () => sourceCallback<() => () => void>('components/ui/Modal.tsx', 'useEffect', {
        shouldLockScroll: true, modalId: 'fixture-modal', activeModalStack, removeActiveModal, lockScroll, unlockScroll,
    }, 'activeModalStack.push')()
    const restore = () => {
        for (const [name, descriptor] of original) {
            if (descriptor) {
                Object.defineProperty(globalThis, name, descriptor)
            } else {
                Reflect.deleteProperty(globalThis, name)
            }
        }
    }
    return {bodyStyles, body, html, content, window, listeners, fullscreen, modal, restore, setLogPanelFullscreen,
            showOverlay: () => {overlay = {}}}
}

describe('log fullscreen Escape handling', () => {
    test('exits only for an unhandled Escape without an open modal', () => {
        expect(shouldExitLogFullscreen({key: 'Escape', defaultPrevented: false}, false)).toBe(true)
        expect(shouldExitLogFullscreen({key: 'Escape', defaultPrevented: true}, false)).toBe(false)
        expect(shouldExitLogFullscreen({key: 'Escape', defaultPrevented: false}, true)).toBe(false)
        expect(shouldExitLogFullscreen({key: 'Enter', defaultPrevented: false}, false)).toBe(false)
    })

    for (const fullscreenFirst of [true, false]) {
        for (const closeFirst of [0, 1]) {
            test(`shared scrolling restores once for fullscreenFirst=${fullscreenFirst}, closeFirst=${closeFirst}`, () => {
                const env = environment()
                const cleanups: Array<() => void> = []
                try {
                    const opens = fullscreenFirst ? [env.fullscreen, env.modal] : [env.modal, env.fullscreen]
                    for (const open of opens) {
                        cleanups.push(open()!)
                    }
                    expect(env.body.style).toMatchObject({position: 'fixed', top: '-81px', overflow: 'hidden'})
                    expect(env.html.style.overflow).toBe('hidden')
                    cleanups.splice(closeFirst, 1)[0]!()
                    expect(env.body.style.overflow).toBe('hidden')
                    expect(env.body.classList.values.has('modal-open')).toBe(true)
                    expect(env.window.scrollTo).not.toHaveBeenCalled()
                    cleanups.pop()!()
                    expect(env.body.style).toEqual(env.bodyStyles)
                    expect(env.html.style.overflow).toBe('scroll')
                    expect(env.body.classList.values.has('modal-open')).toBe(false)
                    expect(env.content.scrollTo).toHaveBeenCalledWith({top: 188, left: 0, behavior: 'auto'})
                    expect(env.window.scrollTo).toHaveBeenCalledTimes(1)
                    expect(env.window.scrollTo).toHaveBeenCalledWith({top: 81, left: 0, behavior: 'auto'})
                    expect(env.listeners.size).toBe(0)
                } finally {
                    for (const cleanup of cleanups.reverse()) {
                        cleanup()
                    }
                    env.restore()
                }
            })
        }
    }

    test('switching tabs exits fullscreen and an inactive tab cannot acquire a scrolling lock', () => {
        const env = environment()
        try {
            const setActiveTab = mock()
            sourceInitializer<(tab: string) => void>(page, 'handleTabChange', {
                setActiveTab, setLogPanelFullscreen: env.setLogPanelFullscreen,
            })('errors')
            expect(setActiveTab).toHaveBeenCalledWith('errors')
            expect(env.setLogPanelFullscreen).toHaveBeenCalledWith(false)
            expect(env.fullscreen('errors')).toBeUndefined()
            expect(env.fullscreen('logs', false)).toBeUndefined()
            expect(env.fullscreen('logs', true, 'exiting')).toBeUndefined()
            expect(env.fullscreen('logs', true, 'stacked')).toBeUndefined()
            expect(env.body.style).toEqual(env.bodyStyles)
            expect(env.listeners.size).toBe(0)
        } finally {
            env.restore()
        }
    })

    test('the registered fullscreen listener gives modal Escape handling precedence', () => {
        const env = environment()
        const cleanup = env.fullscreen()!
        try {
            const listener = env.listeners.get('keydown')!
            listener({key: 'Escape', defaultPrevented: false} as KeyboardEvent)
            expect(env.setLogPanelFullscreen).toHaveBeenCalledTimes(1)
            env.showOverlay()
            listener({key: 'Escape', defaultPrevented: false} as KeyboardEvent)
            expect(env.setLogPanelFullscreen).toHaveBeenCalledTimes(1)
        } finally {
            cleanup()
            env.restore()
        }
    })

    test('compiled fullscreen rules enclose controls and override the ordinary panel height constraints', () => {
        const source = readFileSync(new URL('../src/pages/LogsPage.tsx', import.meta.url), 'utf8')
        const css = compile(new URL('../src/pages/LogsPage.module.scss', import.meta.url).pathname).css
        expect(source).toContain("<Card className={`${styles.logCard} ${logPanelFullscreen ? styles.logCardFullscreen : ''}`}>")
        expect(source).toContain('onChange={handleTabChange}')
        expect(css).toMatch(/\.logCard\.logCardFullscreen\s*\{[^}]*position: fixed;/)
        expect(css).toMatch(/\.logPanel\.logPanelFullscreen\s*\{[^}]*min-height: 0;[^}]*max-height: none;/)
        expect(css).toMatch(/\.logCard\.logCardFullscreen \.filters\s*\{[^}]*max-height: 40vh;/)
    })
})
