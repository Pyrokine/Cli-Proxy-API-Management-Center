import {describe, expect, test} from 'bun:test'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'

const source = readFileSync(new URL('../src/components/layout/MainLayout.tsx', import.meta.url), 'utf8')

class ElementStub {
    constructor(readonly tagName: string, readonly isContentEditable = false, readonly textRole = false) {}
    closest(selector: string) {
        return this.textRole && selector.includes('textbox') ? this : null
    }
}

function createHarness(visible = true) {
    const marker = source.indexOf('const handleSidebarShortcut =')
    if (marker < 0) {
        throw new Error('MainLayout sidebar shortcut handler not found')
    }
    const start = source.lastIndexOf('    useEffect(() => {', marker)
    const end = source.indexOf('    }, [])', marker) + '    }, [])'.length
    const code = new Bun.Transpiler({loader: 'tsx'}).transformSync(source.slice(start, end))
    const listeners = new Map<string, (event: Partial<KeyboardEvent>) => void>()
    let cleanup: (() => void) | undefined
    let toggles = 0
    let collapsed = false
    const doc = {designMode: 'off'}
    const context = {
        HTMLElement: ElementStub,
        document: doc,
        headerRef: {current: {querySelector: (selector: string) => {
            expect(selector).toBe('.sidebar-toggle-header')
            return {
                getClientRects: () => visible ? [{}] : [],
                click: () => { ++toggles; collapsed = !collapsed },
            }
        }}},
        useEffect: (effect: () => () => void) => { cleanup = effect() },
        window: {
            addEventListener: (name: string, handler: (event: Partial<KeyboardEvent>) => void) => { listeners.set(name, handler) },
            removeEventListener: (name: string, handler: (event: Partial<KeyboardEvent>) => void) => {
                expect(listeners.get(name)).toBe(handler)
                listeners.delete(name)
            },
        },
    }
    runInNewContext(code, context)
    const dispatch = (overrides: Record<string, unknown> = {}) => {
        let prevented = false
        const target = new ElementStub('BUTTON')
        const event = {
            key: 'b', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false,
            repeat: false, isComposing: false, defaultPrevented: false, target,
            composedPath: () => [target], preventDefault: () => { prevented = true }, ...overrides,
        }
        listeners.get('keydown')?.(event as unknown as KeyboardEvent)
        return prevented
    }
    return {dispatch, doc, listeners, cleanup: () => cleanup?.(), toggles: () => toggles, collapsed: () => collapsed}
}

describe('sidebar keyboard shortcut', () => {
    test('Ctrl+B and Cmd+B invoke the existing toggle button', () => {
        const harness = createHarness()
        expect(harness.listeners.size).toBe(1)
        expect(harness.dispatch()).toBe(true)
        expect(harness.collapsed()).toBe(true)
        expect(harness.dispatch({key: 'B', ctrlKey: false, metaKey: true})).toBe(true)
        expect(harness.collapsed()).toBe(false)
        expect(harness.toggles()).toBe(2)
    })

    test('ignores unrelated combinations, repeated keys, composition and consumed events', () => {
        const harness = createHarness()
        for (const event of [
            {key: 'a'}, {ctrlKey: false}, {metaKey: true}, {shiftKey: true}, {altKey: true},
            {repeat: true}, {isComposing: true}, {defaultPrevented: true},
        ]) {
            expect(harness.dispatch(event)).toBe(false)
        }
        expect(harness.toggles()).toBe(0)
    })

    test('does not capture input, textarea, select or inherited contentEditable events', () => {
        const harness = createHarness()
        for (const target of [new ElementStub('INPUT'), new ElementStub('TEXTAREA'), new ElementStub('SELECT'), new ElementStub('SPAN', true), new ElementStub('SPAN', false, true)]) {
            expect(harness.dispatch({target, composedPath: () => [target]})).toBe(false)
        }
        expect(harness.toggles()).toBe(0)
    })

    test('checks shadow event paths and document editing mode', () => {
        const harness = createHarness()
        const host = new ElementStub('CUSTOM-EDITOR')
        expect(harness.dispatch({target: host, composedPath: () => [new ElementStub('INPUT'), host]})).toBe(false)
        harness.doc.designMode = 'on'
        expect(harness.dispatch()).toBe(false)
        expect(harness.toggles()).toBe(0)
    })

    test('does not modify the mobile menu when the desktop toggle is hidden', () => {
        const harness = createHarness(false)
        expect(harness.dispatch()).toBe(false)
        expect(harness.toggles()).toBe(0)
    })

    test('removes the same listener on unmount and does not toggle after cleanup', () => {
        const harness = createHarness()
        harness.cleanup()
        expect(harness.listeners.size).toBe(0)
        expect(harness.dispatch()).toBe(false)
        expect(harness.toggles()).toBe(0)
    })

    test('advertises the shortcut and expanded state on the existing desktop button', () => {
        const start = source.indexOf("className='sidebar-toggle-header'")
        const end = source.indexOf('</button>', start)
        const button = source.slice(start, end)
        expect(button).toContain('sidebarShortcutLabel')
        expect(button).toContain('aria-label={sidebarToggleLabel}')
        expect(button).toContain('aria-expanded={!sidebarCollapsed}')
        expect(button).toContain("aria-keyshortcuts='Control+B Meta+B'")
        expect(source).toContain("'⌘B'")
        expect(source).toContain("'Ctrl+B'")
        expect(source).toContain('onClick={() => setSidebarOpen((prev) => !prev)}')
    })
})
