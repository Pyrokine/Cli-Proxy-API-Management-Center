import {yaml} from '@codemirror/lang-yaml'
import {search, searchKeymap} from '@codemirror/search'
import {EditorState} from '@codemirror/state'
import {keymap} from '@codemirror/view'
import {describe, expect, mock, test} from 'bun:test'
import {readFileSync} from 'node:fs'
import {type BlockerFunction, createHashRouter, createMemoryRouter} from 'react-router'
import {sourceCallback} from './sourceCallbacks'

const guardFile = 'hooks/useUnsavedChangesGuard.ts'

describe('upgraded data router', () => {
    test('keeps hash paths and query parameters in the single HTML location', async () => {
        const location     = new URL('http://localhost/management.html#/config?mode=source')
        let state: unknown = { idx: 0 }
        const update       = (next: unknown, _title: string, href?: string | URL | null) => {
            state = next
            if (href) {
                location.href = new URL(href, location).href
            }
        }
        const browser      = Object.assign(new EventTarget(), {
            location,
            document: { createElement: () => ({}), querySelector: () => null },
            history: {
                get state() {
                    return state
                }, replaceState: update, pushState: update,
            },
        })
        const router       = createHashRouter([{ path: '*', element: null }], {
            window: browser as unknown as Window,
            hydrationData: {},
        })
        try {
            expect(router.state.location).toMatchObject({ pathname: '/config', search: '?mode=source' })
            await router.navigate('/credentials?provider=codex')
            expect(location.pathname).toBe('/management.html')
            expect(location.hash).toBe('#/credentials?provider=codex')
        } finally {
            router.dispose()
        }
    })

    test('cancels, confirms and releases only the saved navigation before protecting the next edit', async () => {
        const allowNextNavigationUntilRef = { current: 0 }
        const allowNextNavigationKeyRef   = { current: '' }
        const scope                       = {
            allowNextNavigationUntilRef,
            allowNextNavigationKeyRef,
            shouldBlock: true,
        }
        const shouldBlock                 = sourceCallback<BlockerFunction>(guardFile, 'shouldBlockFunction', scope)
        const allowNextNavigation         = sourceCallback<() => void>(guardFile, 'allowNextNavigation', scope)
        const resetAllowance              = sourceCallback<() => void>(
            guardFile,
            'useEffect',
            scope,
            'allowNextNavigationUntilRef.current === 0',
        )
        const router                      = createMemoryRouter(
            [{ path: '*', element: null }],
            { initialEntries: ['/config'] },
        )
        router.getBlocker('draft', shouldBlock)
        try {
            for (const action of ['cancel', 'confirm'] as const) {
                await router.navigate('/credentials')
                const blocker = router.getBlocker('draft', shouldBlock)
                expect(blocker.state).toBe('blocked')
                let confirmation: { onConfirm: () => void; onCancel: () => void } | undefined
                const present = sourceCallback<() => void>(guardFile, 'useEffect', {
                    blocker,
                    blockedKey: '/credentials',
                    lastBlockedRef: { current: '' },
                    activeGuard: {
                        dialog: {
                            title: 'Discard edits',
                            message: 'Unsaved draft',
                            confirmText: 'Discard',
                            cancelText: 'Keep editing',
                        },
                    },
                    showConfirmation: (value: typeof confirmation) => {
                        confirmation = value
                    },
                }, 'blocker.state')
                present()
                expect(confirmation).toBeDefined()
                if (action === 'cancel') {
                    confirmation!.onCancel()
                    expect(router.state.location.pathname).toBe('/config')
                } else {
                    confirmation!.onConfirm()
                    expect(router.state.location.pathname).toBe('/credentials')
                }
                expect(router.getBlocker('draft', shouldBlock).state).toBe('unblocked')
            }
            allowNextNavigation()
            await router.navigate('/config?saved=1')
            expect(router.state.location).toMatchObject({ pathname: '/config', search: '?saved=1' })
            expect(router.getBlocker('draft', shouldBlock).state).toBe('unblocked')
            resetAllowance()
            await router.navigate('/system')
            expect(router.getBlocker('draft', shouldBlock).state).toBe('blocked')
            expect(router.state.location.pathname).toBe('/config')
        } finally {
            router.dispose()
        }
    })

    test('protects document exit only while the current draft guard is active', () => {
        const browser = new EventTarget()
        for (const guardEnabled of [true, false]) {
            const register = sourceCallback<() => (() => void) | undefined>(guardFile, 'useEffect', {
                guardEnabled, window: browser,
            }, 'handleBeforeUnload')
            const cleanup  = register()
            const exit     = new Event('beforeunload', { cancelable: true })
            browser.dispatchEvent(exit)
            expect(exit.defaultPrevented).toBe(guardEnabled)
            cleanup?.()
            const after = new Event('beforeunload', { cancelable: true })
            browser.dispatchEvent(after)
            expect(after.defaultPrevented).toBe(false)
        }
    })

    test('uses the DOM provider and keeps React transitions explicitly disabled', () => {
        const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
        expect(app).toContain('import {RouterProvider} from \'react-router/dom\'')
        expect(app).toContain('<RouterProvider router={router} useTransitions={false} />')
        expect(app).toContain('path: \'/login\'')
        expect(app).toContain('<ProtectedRoute>')
    })
})

test('shares CodeMirror state across the YAML, search and view extensions', () => {
    const state   = EditorState.create({
                                           doc: 'debug: false\n',
                                           extensions: [yaml(), search(), keymap.of(searchKeymap)],
                                       })
    const updated = state.update({ changes: { from: 7, to: 12, insert: 'true' } }).state
    expect(updated).toBeInstanceOf(EditorState)
    expect(updated.doc.toString()).toBe('debug: true\n')
})

for (const variant of ['vertical', 'ios']) {
    test(`finishes and cancels ${variant} transitions through the Motion controls`, async () => {
        for (const completion of ['finished', 'visible', 'timeout', 'unmount'] as const) {
            const controls: Array<{ finished: Promise<void>; finish: () => void; stop: ReturnType<typeof mock> }> = []

            const listeners   = new Map<string, () => void>()
            let timeout: (() => void) | undefined
            let animating     = true
            let layers        = [
                { status: 'exiting' },
                { status: 'current' },
            ]
            const nextLayers  = [{ status: 'current' }]
            const clearStyles = mock(
                () => undefined)
            const effect      = sourceCallback<() => () => void>(
                'components/common/PageTransition.tsx',
                'useLayoutEffect',
                {
                    isAnimating: true,
                    currentLayerRef: { current: { style: {} } },
                    exitingLayerRef: { current: { style: {} } },
                    transitionVariantRef: { current: variant },
                    clearLayerStyles: clearStyles,
                    resolveScrollContainer: () => null,
                    exitScrollOffsetRef: { current: 0 },
                    enterScrollOffsetRef: { current: 0 },
                    transitionDirectionRef: { current: 'forward' },
                    VERTICAL_TRAVEL_DISTANCE: 60,
                    VERTICAL_TRANSITION_DURATION: 0.35,
                    IOS_TRANSITION_DURATION: 0.42,
                    IOS_EXIT_TO_X_PERCENT_FORWARD: -30,
                    IOS_EXIT_TO_X_PERCENT_BACKWARD: 100,
                    IOS_ENTER_FROM_X_PERCENT: 100,
                    IOS_ENTER_FROM_X_PERCENT_BACKWARD: -30,
                    IOS_EXIT_DIM_OPACITY: 0.72,
                    IOS_SHADOW_VALUE: 'shadow',
                    buildIosTransform: (x: number, y: number) => `${x},${y}`,
                    buildVerticalTransform: (y: number) => String(y),
                    easePower2Out: (value: number) => value,
                    easeCircOut: (value: number) => value,
                    nextLayersRef: { current: nextLayers },
                    setLayers: (update: (previous: typeof layers) => typeof layers) => {
                        layers = update(layers)
                    },
                    setIsAnimating: (value: boolean) => {
                        animating = value
                    },
                    clearTimeout: mock(() => undefined),
                    window: {
                        matchMedia: () => ({ matches: false }),
                        setTimeout: (callback: () => void) => {
                            timeout = callback;
                            return 1
                        },
                    },
                    document: {
                        visibilityState: 'visible',
                        addEventListener: (name: string, callback: () => void) => listeners.set(name, callback),
                        removeEventListener: (name: string) => listeners.delete(name),
                    },
                    animate: () => {
                        let finish!: () => void
                        const finished = new Promise<void>((resolve) => {
                            finish = resolve
                        })
                        const control  = { finished, finish, stop: mock(() => finish()) }
                        controls.push(control)
                        return control
                    },
                },
                'const activeAnimations',
            )
            const cleanup     = effect()
            expect(controls).toHaveLength(2)
            if (completion === 'finished') {
                controls.forEach((control) => control.finish())
            } else if (completion === 'visible') {
                listeners.get('visibilitychange')!()
            } else if (completion === 'timeout') {
                timeout!()
            } else {
                cleanup()
            }
            await Promise.all(controls.map((control) => control.finished))
            await Promise.resolve()
            if (completion === 'unmount') {
                expect(animating).toBe(true)
                expect(layers).toHaveLength(2)
            } else {
                expect(animating).toBe(false)
                expect(layers).toEqual(nextLayers)
                expect(clearStyles).toHaveBeenCalledTimes(4)
                cleanup()
            }
            expect(listeners.size).toBe(0)
            controls.forEach((control) => expect(control.stop).toHaveBeenCalled())
        }
    })
}
