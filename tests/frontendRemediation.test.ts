import {createProviderEditModalState, resolveProviderEditModalState} from '@/hooks/useProviderEditPresentation'
import {parseLogLine} from '@/pages/hooks/logParsing'
import {parseLogTimestamp, toLocalDateTimeSecondsString} from '@/utils/format'
import {parseIndexParam} from '@/utils/helpers'
import {afterEach, describe, expect, setSystemTime, test} from 'bun:test'
import {createInstance} from 'i18next'
import {readFileSync} from 'node:fs'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {sourceCallback, sourceInitializer} from './sourceCallbacks'

const React = { createElement }
afterEach(() => setSystemTime())

describe('frontend remediation shared contracts', () => {
    test('keeps Meta editor modal presentation tied to a live credentials navigation', () => {
        const state = createProviderEditModalState({
                                                       pathname: '/credentials',
                                                       search: '',
                                                       hash: '',
                                                       state: null,
                                                       key: 'origin',
                                                   })
        for (const pathname of ['/credentials/meta/new', '/credentials/meta/0']) {
            expect(resolveProviderEditModalState(state, pathname)?.presentation).toBe('modal')
            expect(resolveProviderEditModalState(undefined, pathname)).toBeNull()
        }
    })

    test('rejects partial, signed, fractional and unsafe provider indices', () => {
        for (const value of ['1junk', '1.5', '1e2', '-1', '+1', ' 1', '9007199254740993']) {
            expect(parseIndexParam(value)).toBeNull()
        }
        expect(parseIndexParam('0')).toBe(0)
        expect(parseIndexParam('12')).toBe(12)
    })

    test('recognizes Traditional Chinese script tags and regional tags', () => {
        for (const language of ['zh-Hant', 'zh-Hant-HK', 'zh-TW', 'zh-HK', 'zh-MO']) {
            const resolve = sourceInitializer<() => string>('utils/language.ts', 'getBrowserLanguage', {
                navigator: { languages: [language] },
            })
            expect(resolve()).toBe('zh-TW')
        }
    })

    test('clamps a filtered or deleted final page before slicing its items', () => {
        let call                = 0
        const updates: number[] = []
        const paginate          = sourceCallback<(items: number[]) => { currentPage: number; currentItems: number[] }>(
            'hooks/usePagination.ts',
            'usePagination',
            {
                useState: () => [call++ === 0 ? 3 : 20, (value: number) => updates.push(value)],
                useMemo: (fn: () => unknown) => fn(),
            },
        )
        expect(paginate([1, 2])).toMatchObject({ currentPage: 1, currentItems: [1, 2] })
        expect(updates).toEqual([1])
    })

    test('fits the actual dropdown box inside a narrow short viewport', () => {
        let position: { left: number; width: number; top: number; up: boolean; maxHeight: number } | undefined
        const calculate = sourceCallback<() => void>('components/ui/useDropdown.ts', 'calcPos', {
            wrapRef: { current: { getBoundingClientRect: () => ({ top: 98, bottom: 132, left: 190, width: 180 }) } },
            dropdownRef: { current: null },
            window: { innerWidth: 240, innerHeight: 150 }, optionCount: 20, maxHeight: 240,
            // noinspection JSUnusedGlobalSymbols
            'setPos': (value: typeof position) => {
                position = value
            },
        })
        calculate()
        expect(position).toMatchObject({ up: true, maxHeight: 84 })
        expect(position!.left).toBeGreaterThanOrEqual(8)
        expect(position!.left + position!.width).toBeLessThanOrEqual(232)
        expect(position!.top - position!.maxHeight).toBeGreaterThanOrEqual(8)
    })

    test('opens with ArrowDown, moves option focus, and restores the trigger on Escape', () => {
        const focus: number[]   = []
        const options           = [0, 1, 2].map((index) => ({
            focus: () => focus.push(index), scrollIntoView: () => {
            },
            getAttribute: () => index === 1 ? 'true' : 'false',
        }))
        const opened: boolean[] = []
        let closed              = 0
        const document          = { activeElement: null as unknown }
        const scope             = {
            disabled: false, isOpen: false, close: () => {
                closed++
            }, calcPos: () => {
            },
            setOpen: (value: boolean) => opened.push(value),
            wrapRef: { current: { querySelector: () => ({ focus: () => focus.push(-1) }) } },
            dropdownRef: {
                current: {
                    // noinspection JSUnusedGlobalSymbols
                    'querySelectorAll': () => options,
                },
            },
            document, requestAnimationFrame: (fn: () => void) => fn(),
        }
        const event             = (key: string) => ({
            key, target: { tagName: 'BUTTON' }, preventDefault() {
            }, stopPropagation() {
            },
        })
        const keydown           = sourceCallback<(value: ReturnType<typeof event>) => void>(
            'components/ui/useDropdown.ts',
            'onKeyDown',
            scope,
        )
        keydown(event('ArrowDown'))
        expect(opened).toEqual([true])
        expect(focus).toEqual([1])
        document.activeElement = options[1]
        const active           = sourceCallback<typeof keydown>(
            'components/ui/useDropdown.ts',
            'onKeyDown',
            { ...scope, isOpen: true },
        )
        active(event('ArrowDown'))
        active(event('Home'))
        active(event('End'))
        active(event('Escape'))
        expect(focus).toEqual([1, 2, 0, 2, -1])
        expect(closed).toBe(1)
    })

    test('resolves default date presets at click time and preserves explicit custom presets', () => {
        setSystemTime(new Date('2026-10-23T09:12:00Z'))
        const build              = sourceCallback<(t: (key: string) => string) => Array<{
            key: string;
            from: Date;
            to: Date
        }>>(
            'components/ui/DateRangePicker.tsx',
            'buildDefaultPresets',
            {},
        )
        const preset             = build((key) => key)[0]
        const calls: unknown[][] = []
        const scope              = {
            presets: undefined, t: (key: string) => key,
            buildDefaultPresets: build, onChange: (...args: unknown[]) => calls.push(args),
        }
        setSystemTime(new Date('2026-10-23T09:23:42.125Z'))
        const select = sourceCallback<(value: typeof preset) => void>(
            'components/ui/DateRangePicker.tsx',
            'handlePreset',
            scope,
        )
        select(preset)
        expect(calls[0]).toEqual(['2026-10-22T09:23:42.125Z', '2026-10-23T09:23:42.125Z', '24h'])
        sourceCallback<typeof select>(
            'components/ui/DateRangePicker.tsx', 'handlePreset', { ...scope, presets: [preset] },
        )(preset)
        expect(calls[1]).toEqual([preset.from.toISOString(), preset.to.toISOString(), '24h'])
        select({ ...preset, key: 'all' })
        expect(calls[2]).toEqual(['', '2026-10-23T09:23:42.125Z', 'all'])
    })

    test('renders selected date preset titles from the committed query range', () => {
        setSystemTime(new Date('2026-10-23T09:30:00Z'))
        const build     = sourceCallback('components/ui/DateRangePicker.tsx', 'buildDefaultPresets', {})
        const Picker    = sourceCallback<(props: object) => ReturnType<typeof createElement>>(
            'components/ui/DateRangePicker.tsx',
            'DateRangePicker',
            {
                React, useTranslation: () => ({ t: (key: string) => key }), useMemo: (fn: () => unknown) => fn(),
                useCallback: (fn: unknown) => fn, buildDefaultPresets: build, toLocalDateTimeSecondsString,
                asDateTimeInputValue: sourceCallback('components/ui/DateRangePicker.tsx', 'asDateTimeInputValue', {
                    toLocalDateTimeSecondsString,
                }),
                styles: {
                    container: 'range',
                    dateInputs: 'inputs',
                    dateInput: 'input',
                    separator: 'separator',
                    presets: 'presets',
                    presetActive: 'active',
                    preset: 'preset',
                },
            },
        )
        const to        = '2026-10-23T09:23:42.125Z'
        const displayTo = toLocalDateTimeSecondsString(new Date(to))
        for (const [activePreset, from] of [
            ['24h', '2026-10-22T09:23:42.125Z'], ['7d', '2026-10-16T09:23:42.125Z'],
            ['30d', '2026-09-23T09:23:42.125Z'], ['all', '2024-04-03T08:21:37.000Z'],
        ]) {
            const html        = renderToStaticMarkup(Picker({
                                                                from, to, activePreset, onChange() {
                },
                                                            }))
            const displayFrom = toLocalDateTimeSecondsString(new Date(from))
            expect(html).toContain(`class="active" title="${displayFrom} ~ ${displayTo}"`)
            expect(html).toContain(`value="${displayFrom}"`)
            expect(html).toContain(`value="${displayTo}"`)
        }
        const pending = renderToStaticMarkup(Picker({
                                                        from: '', to, activePreset: 'all', onChange() {
            },
                                                    }))
        expect(pending).toContain('class="active" title="usage_stats.range_all"')
        expect(pending).toContain('value=""')
    })

    test('interprets timezone-less backend log timestamps as UTC and retains explicit offsets', () => {
        expect(parseLogTimestamp('2026-10-23 10:00:00')).toBe(Date.parse('2026-10-23T10:00:00Z'))
        expect(parseLogTimestamp('2026-10-23T10:00:00.123456789Z')).toBe(Date.parse('2026-10-23T10:00:00.123Z'))
        expect(parseLogTimestamp('2026-10-23T10:00:00+09:00')).toBe(Date.parse('2026-10-23T01:00:00Z'))
        expect(Number.isNaN(parseLogTimestamp('not a timestamp'))).toBe(true)
    })

    test('parses 32-character request IDs without hiding the status or source fields', () => {
        const id   = '0123456789abcdef0123456789abcdef'
        const line = parseLogLine(`[2026-10-23 10:00:00] [${id
        }] [info] [request.go:42] 200 | 10ms | POST /v1/responses`)
        expect(line.requestId).toBe(id)
        expect(line.statusCode).toBe(200)
        expect(line.level).toBe('info')
    })

    test('applies consecutive storage updater callbacks to the latest value and switches key ownership', () => {
        const values     = new Map([['first', '1'], ['second', '10']])
        let state: unknown
        let ref: { current: unknown } | undefined
        let memoized: { callback: unknown, dependencies: unknown[] } | undefined
        const hook       = sourceCallback<(
            key: string,
            initial: number,
        ) => [number, (value: number | ((previous: number) => number)) => void]>(
            'hooks/useLocalStorage.ts',
            'useLocalStorage',
            {
                useState: (initial: () => unknown) => [
                    state ??=
                        initial(),
                    (value: unknown) => {
                        state =
                            value
                    },
                ],
                useRef: (value: unknown) => ref ??=
                    { current: value },
                useCallback: (
                    callback: unknown,
                    dependencies: unknown[],
                ) => {
                    const previous = memoized
                    if (previous &&
                        dependencies.length ===
                        previous.dependencies.length &&
                        dependencies.every((
                                               value,
                                               index,
                                           ) => Object.is(
                            value,
                            previous.dependencies[index],
                        ))) {
                        return previous.callback
                    }
                    memoized =
                        { callback, dependencies }
                    return callback
                },
                window: {
                    localStorage: {
                        getItem: (key: string) => values.get(key),
                        setItem: (
                            key: string,
                            value: string,
                        ) => values.set(key, value),
                    },
                },
            },
        )
        const [, update] = hook('first', 0)
        expect(hook('first', 0)[1]).toBe(update)
        update((value) => value + 1)
        update((value) => value + 1)
        const [updated, updateAgain] = hook('first', 0)
        expect(updated).toBe(3)
        expect(updateAgain).toBe(update)
        expect(values.get('first')).toBe('3')
        const [next, updateNext] = hook('second', 0)
        expect(next).toBe(10)
        updateNext((value) => value + 1)
        expect(values.get('second')).toBe('11')
        expect(hook('second', 0)[1]).toBe(updateNext)
        update((value) => value + 1)
        expect(values.get('second')).toBe('12')
        expect(values.get('first')).toBe('3')
    })

    test('renders shared secret controls with translated accessible names in every language', async () => {
        for (const language of ['en', 'ru', 'zh-CN', 'zh-TW']) {
            const translation = createInstance()
            await translation.init({
                                       lng: language,
                                       resources: {
                                           [language]: {
                                               translation: JSON.parse(readFileSync(new URL(
                                                   `../src/i18n/locales/${language}.json`,
                                                   import.meta.url,
                                               ), 'utf8')),
                                           },
                                       },
                                   })
            const Input = sourceCallback<(props: object) => ReturnType<typeof createElement>>(
                'components/ui/Input.tsx',
                'Input',
                {
                    React,
                    useTranslation: () => ({
                        t: translation.t.bind(translation),
                    }),
                    useId: () => 'secret',
                    useState: () => [
                        false,
                        () => {
                        },
                    ],
                    IconEye: () => null,
                    IconEyeOff: () => null,
                },
            )
            const html  = renderToStaticMarkup(Input({ secret: true, label: 'Credential' }))
            expect(html).toContain(`aria-label="${translation.t('common.show_value')}"`)
            expect(html).toContain('for="secret"')
        }
    })
})

describe('frontend asynchronous presentation remediation', () => {
    test('completes both page transition variants without spatial animation when reduced motion is requested', () => {
        for (const variant of ['vertical', 'ios']) {
            let animating = true
            let completed = false
            const run     = sourceCallback<() => unknown>('components/common/PageTransition.tsx', 'useLayoutEffect', {
                isAnimating: true,
                currentLayerRef: { current: { style: {} } },
                exitingLayerRef: { current: { style: {} } },
                transitionVariantRef: { current: variant },
                // noinspection JSUnusedGlobalSymbols
                'clearLayerStyles': () => {
                },
                // noinspection JSUnusedGlobalSymbols
                'resolveScrollContainer': () => null,
                exitScrollOffsetRef: { current: 0 },
                enterScrollOffsetRef: { current: 0 },
                transitionDirectionRef: { current: 'forward' },
                VERTICAL_TRAVEL_DISTANCE: 60,
                nextLayersRef: { current: [] },
                // noinspection JSUnusedGlobalSymbols
                'setLayers': () => {
                    completed = true
                },
                // noinspection JSUnusedGlobalSymbols
                'setIsAnimating': (value: boolean) => {
                    animating = value
                },
                window: { matchMedia: () => ({ matches: true }) },
                // noinspection JSUnusedGlobalSymbols
                'animate': () => {
                    throw new Error('Unexpected spatial animation')
                },
            }, 'const activeAnimations')
            run()
            expect({ completed, animating }).toEqual({ completed: true, animating: false })
        }
    })

    test('cancels the pending loading frame when auth files resolve before the next paint', async () => {
        const frames             = new Map<number, () => void>()
        const loading: boolean[] = []
        const effect             = sourceCallback<() => () => void>(
            'components/usage/hooks/useAuthFileMap.ts',
            'useEffect',
            {
                enabled: true,
                requestAnimationFrame: (fn: () => void) => {
                    frames.set(1, fn);
                    return 1
                },
                cancelAnimationFrame: (id: number) => frames.delete(id),
                authFilesApi: { list: async () => ({ files: [] }) },
                // noinspection JSUnusedGlobalSymbols
                'setAuthFileMap': () => {
                },
                // noinspection JSUnusedGlobalSymbols
                'setAuthFileMapLoading': (value: boolean) => loading.push(value),
            },
        )
        const cleanup            = effect()
        for (let i = 0; i < 5; i++) {
            await Promise.resolve()
        }
        for (const frame of frames.values()) {
            frame()
        }
        expect(frames.size).toBe(0)
        expect(loading).toEqual([false])
        cleanup()
    })
})

test('establishes the loaded panel baseline before polling and notifies once for a later document change', async () => {
    let fingerprint                  = 'build-B'
    let poll: (() => Promise<void>) | undefined
    const notifications: unknown[][] = []
    const effect                     = sourceCallback<() => () => void>(
        'components/layout/MainLayout.tsx',
        'useEffect',
        {
            __APP_VERSION__: '1.26.0',
            versionNotifiedRef: { current: false },
            versionBaselineRef: { current: null },
            fetch: async () => ({
                ok: true,
                headers: { get: () => fingerprint },
            }),
            setInterval: (fn: () => Promise<void>) => {
                poll = fn;
                return 1
            },
            clearInterval: () => {
            },
            addPersistentNotification: (...args: unknown[]) => notifications.push(args),
            t: (key: string) => key,
            sessionStorage: { getItem: () => 'build-A' },
        },
        'const checkVersion = async',
    )
    const cleanup                    = effect()
    await Promise.resolve()
    await Promise.resolve()
    await poll!()
    expect(notifications).toHaveLength(0)
    fingerprint = 'build-C'
    await poll!()
    await poll!()
    expect(notifications).toEqual([['notifications.panel_updated', 'info', 'version']])
    cleanup()
})
