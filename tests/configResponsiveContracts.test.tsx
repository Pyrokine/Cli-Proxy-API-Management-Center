import {IconCheck, IconRefreshCw, IconX} from '@/components/ui/icons'
import {Modal} from '@/components/ui/Modal'
import {expect, test} from 'bun:test'
import React, {type ReactElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {compile} from 'sass'
import i18n from '../src/i18n'
import {sourceCallback, sourceInitializer} from './sourceCallbacks'

const componentCss = compile(new URL('../src/styles/components.scss', import.meta.url).pathname).css
const configCss    = compile(new URL('../src/pages/ConfigPage.module.scss', import.meta.url).pathname).css
const styles       = new Proxy<Record<string, string>>({}, { get: (_target, key) => String(key) })

function rules(css: string, selector: string): string[] {
    return [...css.matchAll(/(?<selectors>[^{}]+)\{(?<body>[^{}]*)}/g)]
        .filter((match) => match[1].split(',').some((value) => value.trim() === selector))
        .map((match) => match[2])
}

test('shared modal constrains wide content and uses dynamic mobile viewport bounds with stacked actions', () => {
    const html = renderToStaticMarkup(React.createElement(Modal, {
        open: true, width: 4096, title: 'Fixture', onClose: () => {
        },
        footer: React.createElement('button', { className: 'btn' }, 'Confirm'),
    }, 'Long content'))
    expect(html).toContain('role="dialog"')
    expect(html).toContain('width:4096px')
    expect(rules(componentCss, '.modal').some((body) => /max-width:\s*100%/.test(body))).toBe(true)
    expect(componentCss).toContain('@media (max-width: 768px)')
    expect(componentCss).toContain('@supports (height: 100dvh)')
    expect(rules(componentCss, '.modal').some((body) => /max-height:[^;]*100dvh/.test(body))).toBe(true)
    expect(rules(componentCss, '.modal-body').some((body) =>
                                                       /max-height:[^;]*100dvh[^;]*180px/.test(body))).toBe(true)
    expect(rules(componentCss, '.modal-body').some((body) => /overflow:\s*auto/.test(body))).toBe(true)
    expect(rules(componentCss, '.modal-footer').some((body) =>
                                                         /flex-direction:\s*column-reverse/.test(body))).toBe(true)
    expect(rules(componentCss, '.modal-footer .btn').some((body) => /width:\s*100%/.test(body))).toBe(true)
})

const defaultState = {
    disableControls: false, loading: false, saveNeedsReload: false, error: '',
    hasVisualModeError: false, hasVisualValidationErrors: false, saving: false, isDirty: false,
}
const states       = [
    [{ disableControls: true, isDirty: true }, 'status_disconnected_short'],
    [{ loading: true }, 'status_loading_short'],
    [{ saveNeedsReload: true }, 'status_load_failed_short'],
    [{ error: 'fixture error' }, 'status_load_failed_short'],
    [{ hasVisualModeError: true }, 'visual_mode_unavailable_short'],
    [{ hasVisualValidationErrors: true }, 'validation_blocked_short'],
    [{ saving: true, isDirty: true }, 'status_saving_short'],
    [{ isDirty: true }, 'status_dirty_short'],
] as const

for (const language of ['en', 'zh-CN', 'zh-TW', 'ru']) {
    test(`floating configuration actions retain concise current status in ${language}`, () => {
        const t = i18n.getFixedT(language)
        for (const [state, key] of states) {
            const scope                     = { ...defaultState, ...state, t, styles }
            const getStatusText             = sourceInitializer<(compact?: boolean) => string>(
                'pages/ConfigPage.tsx', 'getStatusText', scope,
            )
            const shouldShowFloatingActions = sourceInitializer<boolean>(
                'pages/ConfigPage.tsx', 'shouldShowFloatingActions', scope,
            )
            expect(shouldShowFloatingActions).toBe(true)
            const getStatusClass = sourceInitializer<() => string>('pages/ConfigPage.tsx', 'getStatusClass', scope)
            const actions        = sourceInitializer<ReactElement | null>('pages/ConfigPage.tsx', 'floatingActions', {
                ...scope, React,
                // noinspection JSUnusedGlobalSymbols
                'IconCheck': IconCheck, IconRefreshCw, IconX, getStatusText, getStatusClass,
                shouldShowFloatingActions, floatingActionsRef: { current: null }, diffModalOpen: false,
                handleDiscard: () => {
                }, handleReload: () => {
                }, handleSave: () => {
                },
            })
            const html           = renderToStaticMarkup(actions)
            expect(html).toContain('role="status"')
            expect(html).toContain(t(`config_management.${key}`))
            expect(html).toContain('floatingStatus')
        }
        const getStatusText = sourceInitializer<(compact?: boolean) => string>(
            'pages/ConfigPage.tsx', 'getStatusText', { ...defaultState, t },
        )
        expect(getStatusText()).toBe(t('config_management.status_loaded'))
        expect(getStatusText(true)).toBe(t('config_management.status_loaded_short'))
    })
}

test('stale visual parse errors do not disable an edited source draft', () => {
    const t = i18n.getFixedT('en')
    for (const activeTab of ['source', 'visual']) {
        const actions = sourceInitializer<ReactElement>('pages/ConfigPage.tsx', 'floatingActions', {
            ...defaultState, React, t, styles, activeTab, isDirty: true, hasVisualModeError: true,
            IconCheck, IconRefreshCw, IconX, shouldShowFloatingActions: true, floatingActionsRef: { current: null },
            getStatusText: () => '', getStatusClass: () => '', diffModalOpen: false,
            handleDiscard: () => {
            }, handleReload: () => {
            }, handleSave: () => {
            },
        })
        const markup  = renderToStaticMarkup(actions)
        const save    = markup.match(/<button\b[^>]*aria-label="Save"[^>]*>/)?.[0] ?? ''
        expect(save).toContain('aria-label="Save"')
        expect(save.includes('disabled=""')).toBe(activeTab === 'visual')
    }
})

test('shared modal focuses expanded payload text and returns focus to the invoking input', () => {
    class Element {
        // noinspection JSUnusedGlobalSymbols
        isConnected                                = true
        focused: Array<{ preventScroll: boolean }> = []

        focus(options: { preventScroll: boolean }) {
            this.focused.push(options)
        }
    }

    const input            = new Element()
    const editor           = new Element()
    const document         = {
        activeElement: input,
        // noinspection JSUnusedGlobalSymbols
        'getElementById': (id: string) => id === 'payload-expanded' ? editor : id === 'payload-input' ? input : null,
    }
    let cancelled          = 0
    const window           = {
        requestAnimationFrame: (callback: () => void) => {
            callback();
            return 1
        },
        cancelAnimationFrame: (frame: number) => {
            cancelled = frame
        },
    }
    const focusCapturedRef = { current: false }
    const previousFocusRef = { current: null as Element | null }
    const cleanup          = sourceCallback<() => () => void>('components/ui/Modal.tsx', 'useEffect', {
        open: true, isVisible: true, focusCapturedRef, previousFocusRef, document, window, HTMLElement: Element,
        initialFocusId: 'payload-expanded', modalId: 'payload-modal', activeModalStack: ['payload-modal'],
        dialogRef: { current: { contains: (target: Element) => target === editor } },
        // noinspection JSUnusedGlobalSymbols
        'focusableElements': () => [editor],
    }, 'const explicitTarget')()
    expect(editor.focused).toEqual([{ preventScroll: true }])
    expect(previousFocusRef.current).toBe(input)
    sourceCallback<() => void>('components/ui/Modal.tsx', 'restoreFocus', {
        focusCapturedRef, previousFocusRef, document, window, returnFocusIdRef: { current: 'payload-input' },
    })()
    expect(input.focused).toEqual([{ preventScroll: true }])
    expect(focusCapturedRef.current).toBe(false)
    cleanup()
    expect(cancelled).toBe(1)
})

test('selection checkboxes honor reduced motion while retaining the keyboard focus indicator', () => {
    const css = compile(new URL('../src/components/ui/SelectionCheckbox.module.scss', import.meta.url).pathname).css
    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
    expect(rules(css, '.box').some((body) => /transition:\s*none/.test(body))).toBe(true)
    expect(rules(css, '.root:active .box').some((body) => /transform:\s*none/.test(body))).toBe(true)
    expect(rules(css, '.input:focus-visible + .box').some((body) => /box-shadow:/.test(body))).toBe(true)
})

test('shared labels and collapsible descriptions use supported theme tokens and retain focus styling', () => {
    const collapsible = compile(new URL(
        '../src/components/ui/Collapsible/Collapsible.module.scss', import.meta.url,
    ).pathname).css
    const themes      = compile(new URL('../src/styles/themes.scss', import.meta.url).pathname).css
    expect(rules(componentCss, '.form-group label').some((body) => /font-weight:\s*500/.test(body))).toBe(true)
    for (const selector of ['.summaryHint', '.chevron']) {
        expect(rules(collapsible, selector).some((body) =>
                                                     /color:\s*var\(--text-secondary\)/.test(body))).toBe(true)
    }
    expect(collapsible).not.toContain('--muted-foreground')
    expect(rules(collapsible, '.summary:focus-visible').some((body) => /outline:/.test(body))).toBe(true)
    expect(themes).toMatch(/:root\s*\{[^}]*--text-secondary:/)
    expect(themes).toMatch(/\[data-theme=["']?dark["']?]\s*\{[^}]*--text-secondary:/)
    expect(themes).toMatch(/\[data-theme=["']?white["']?]/)
    expect(componentCss).toContain('@media (prefers-reduced-motion: reduce)')
    expect(rules(componentCss, '.modal').some((body) => /animation:\s*none/.test(body))).toBe(true)
})

test('narrow configuration actions keep readable status beside the three existing actions', () => {
    const declarations = rules(configCss, '.floatingStatus')
    expect(declarations.some((body) => /display:\s*none/.test(body))).toBe(false)
    expect(declarations.some((body) => /max-width:[^;]*40vw/.test(body))).toBe(true)
    expect(declarations.some((body) => /min-width:\s*0/.test(body))).toBe(true)
})
