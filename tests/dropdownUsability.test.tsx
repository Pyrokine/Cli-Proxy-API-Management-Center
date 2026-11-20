import type {DropdownPos} from '@/components/ui/useDropdown'
import {describe, expect, test} from 'bun:test'
import React from 'react'
import {compile} from 'sass'
import {sourceCallback} from './sourceCallbacks'

describe('dropdown readable options', () => {
    test('positions the content-width panel within either viewport edge', () => {
        for (const [viewport, triggerLeft, panelWidth] of [[1854, 1600, 576], [360, 270, 344], [360, 0, 344]]) {
            let actual: DropdownPos | undefined
            const position = sourceCallback<() => void>('components/ui/useDropdown.ts', 'calcPos', {
                wrapRef: {
                    current: {
                        getBoundingClientRect: () => ({
                            top: 50,
                            bottom: 86,
                            width: 120,
                            left: triggerLeft,
                        }),
                    },
                },
                dropdownRef: { current: { getBoundingClientRect: () => ({ width: panelWidth }) } },
                window: { innerWidth: viewport, innerHeight: 900 },
                optionCount: 20,
                maxHeight: 280,
                setPos: (value: DropdownPos) => {
                    actual = value
                },
            })
            position()
            expect(actual?.left).toBeGreaterThanOrEqual(8)
            expect((actual?.left ?? 0) + panelWidth).toBeLessThanOrEqual(viewport - 8)
            expect(actual?.width).toBe(180)
        }
    })

    test('repositions an open menu when equal-count labels grow and disconnects on close', () => {
        let width                    = 200
        let position: DropdownPos | undefined
        let notifyResize: () => void = () => undefined
        let disconnected             = false
        const panel                  = { getBoundingClientRect: () => ({ width }) }
        const dropdownRef            = { current: panel }
        const calcPos                = sourceCallback<() => void>('components/ui/useDropdown.ts', 'calcPos', {
            wrapRef: { current: { getBoundingClientRect: () => ({ top: 50, bottom: 86, width: 120, left: 850 }) } },
            dropdownRef,
            window: { innerWidth: 1000, innerHeight: 900 },
            optionCount: 2,
            maxHeight: 280,
            setPos: (value: DropdownPos) => {
                position = value
            },
        })
        const effect                 = sourceCallback<() => () => void>(
            'components/ui/useDropdown.ts',
            'useLayoutEffect',
            {
                isOpen: true, dropdownRef, calcPos,
                ResizeObserver: class {
                    constructor(callback: () => undefined) {
                        notifyResize = callback
                    }

                    observe(value: unknown) {
                        expect(value).toBe(panel)
                    }

                    disconnect() {
                        disconnected = true
                    }
                },
            },
        )
        const cleanup                = effect()
        expect(position?.left).toBe(792)
        width = 360
        notifyResize()
        expect(position?.left).toBe(632)
        expect((position?.left ?? 0) + width).toBeLessThanOrEqual(992)
        cleanup()
        expect(disconnected).toBe(true)
    })

    test('portaled menus stay above the modal that contains their trigger', () => {
        const modalStyles = compile(new URL('../src/styles/components.scss', import.meta.url).pathname).css
        const modalLayer  = Number(modalStyles.match(/\.modal-overlay\s*\{[^}]*z-index:\s*(\d+)/)?.[1])
        expect(modalLayer).toBeGreaterThan(0)
        for (const component of ['Select', 'MultiSelect']) {
            const css       = compile(new URL(
                `../src/components/ui/${component}.module.scss`,
                import.meta.url,
            ).pathname).css
            const menuLayer = Number(css.match(/\.dropdown\s*\{[^}]*z-index:\s*(\d+)/)?.[1])
            expect(menuLayer).toBeGreaterThan(modalLayer)
        }
    })

    test('panel uses the label width with a viewport bound instead of trigger width', () => {
        const Panel  = sourceCallback<(props: Record<string, unknown>) => React.ReactElement>(
            'components/ui/DropdownPanel.tsx', 'DropdownPanel', {
                React,
                createPortal: (element: React.ReactElement) => element,
                document: { body: {} },
                window: { innerHeight: 900 },
            })
        const result = Panel({
                                 dropdownRef: { current: null },
                                 pos: { top: 100, left: 8, width: 180, maxHeight: 280, up: false },
                                 className: 'panel', upClassName: 'above',
                                 children: <button role='option'>[Codex]
                                                                 example-long-credential-name@example.invalid</button>,
                             }) as React.ReactElement<{
            style: React.CSSProperties;
            children: React.ReactElement<{ children: string }>
        }>
        expect(result.props.style).toMatchObject({
                                                     width: 'max-content',
                                                     minWidth: 180,
                                                     maxWidth: 'min(36rem, calc(100vw - 16px))',
                                                 })
        expect(result.props.children.props.children).toBe('[Codex] example-long-credential-name@example.invalid')
    })
})
