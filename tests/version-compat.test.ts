import {compareLooseSemver, parseLooseSemver} from '@/utils/looseSemver'
import {describe, expect, test} from 'bun:test'
import {readFileSync} from 'node:fs'
import {fileURLToPath, URL} from 'node:url'
import type {ReactElement} from 'react'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {sourceCallback} from './sourceCallbacks'

const viteConfigPath   = fileURLToPath(new URL('../vite.config.ts', import.meta.url))
const viteConfig       = readFileSync(viteConfigPath, 'utf8')
const minServerVersion = viteConfig.match(/__COMPAT_MIN_SERVER__:\s*JSON\.stringify\('(?<version>[^']+)'\)/)?.[1] ?? ''

interface Mismatch {
    reason: 'server_too_old' | 'panel_too_old'
    panelVersion: string
    serverVersion: string
    minServerVersion: string
    minPanelVersion: string
}

function bannerHarness({
                           panelVersion = 'v1.26.0-aug.5',
                           serverVersion = 'v8.0.23-aug.1',
                           minPanelVersion = 'v1.26.0-aug.1',
                           locale = 'en',
                           dismissed = false,
                       } = {}) {
    const file           = 'components/common/VersionCompatBanner.tsx'
    const detectMismatch = sourceCallback<(panel: string, server: string, minPanel: string) => Mismatch | null>(
        file,
        'detectMismatch',
        {
            parseLooseSemver,
            compareLooseSemver,
            __COMPAT_MIN_SERVER__: minServerVersion,
        },
    )
    const dictionary     = JSON.parse(readFileSync(
        new URL(`../src/i18n/locales/${locale}.json`, import.meta.url),
        'utf8',
    ))
    const t              = (key: string, values: Record<string, unknown> = {}) => {
        const [group, entry] = key.split('.')
        return String(dictionary[group]?.[entry] ?? values.defaultValue ?? key)
            .replace(/\{\{(?<field>\w+)}}/g, (_match, field: string) => String(values[field] ?? ''))
    }
    const component      = sourceCallback<() => ReactElement | null>(file, 'VersionCompatBanner', {
        React: { createElement },
        useTranslation: () => ({ t }),
        useAuthStore: () => ({ serverVersion, serverMinPanelVersion: minPanelVersion }),
        useState: () => [dismissed, () => undefined],
        detectMismatch,
        __APP_VERSION__: panelVersion,
        styles: new Proxy({}, { get: (_object, key) => String(key) }),
    })
    return {
        markup: renderToStaticMarkup(createElement(component)),
        mismatch: detectMismatch(panelVersion, serverVersion, minPanelVersion),
        t,
    }
}

describe('version compatibility', () => {
    test('compares augmented versions after their semantic base version', () => {
        expect(parseLooseSemver('v7.2.67-aug.1')).toEqual([7, 2, 67, 1])
        expect(parseLooseSemver('v7.2.67-augmented.2')).toEqual([7, 2, 67, 2])
        expect(compareLooseSemver([7, 2, 67, 0], [7, 2, 67, 1])).toBeLessThan(0)
        expect(compareLooseSemver([7, 2, 67, 2], [7, 2, 67, 1])).toBeGreaterThan(0)
        expect(compareLooseSemver([7, 2, 68, 0], [7, 2, 67, 9])).toBeGreaterThan(0)
    })

    test('treats development and unknown versions as unavailable', () => {
        expect(parseLooseSemver('dev')).toBeNull()
        expect(parseLooseSemver('unknown')).toBeNull()
        expect(parseLooseSemver('-')).toBeNull()
    })

    test('requires the backend release that provides Meta management routes', () => {
        expect(viteConfig).toContain('__COMPAT_MIN_SERVER__: JSON.stringify(\'8.0.23-aug.1\')')
        expect(viteConfig).not.toContain('__COMPAT_MIN_SERVER__: JSON.stringify(\'7.3.2-aug.1\')')
        expect(compareLooseSemver([7, 3, 2, 1], [8, 0, 23, 1])).toBeLessThan(0)
        expect(parseLooseSemver('v8.0.23-aug.1-candidate')).toEqual([8, 0, 23, 1])
        expect(minServerVersion).toBe('8.0.23-aug.1')
    })

    test.each(['en', 'zh-CN', 'zh-TW', 'ru'])(
        'renders the backend-upgrade warning from the actual component in %s',
        (locale) => {
            const view = bannerHarness({ serverVersion: 'v8.0.22-aug.1', locale })
            expect(view.mismatch).toEqual({
                                              reason: 'server_too_old',
                                              panelVersion: '1.26.0-aug.5',
                                              serverVersion: '8.0.22-aug.1',
                                              minServerVersion: '8.0.23-aug.1',
                                              minPanelVersion: '1.26.0-aug.1',
                                          })
            expect(view.markup).toContain('role="alert"')
            const message = view.t(
                'compat.server_too_old',
                { panel: '1.26.0-aug.5', server: '8.0.22-aug.1', min: '8.0.23-aug.1' },
            )
            expect(view.markup).toContain(renderToStaticMarkup(createElement(
                'span',
                { className: 'message' },
                message,
            )))
        },
    )

    test.each(['en', 'zh-CN', 'zh-TW', 'ru'])(
        'renders the panel-upgrade warning from the actual component in %s',
        (locale) => {
            const view = bannerHarness({ panelVersion: 'v1.26.0', minPanelVersion: 'v1.26.0-aug.1', locale })
            expect(view.mismatch).toEqual({
                                              reason: 'panel_too_old',
                                              panelVersion: '1.26.0',
                                              serverVersion: '8.0.23-aug.1',
                                              minServerVersion: '8.0.23-aug.1',
                                              minPanelVersion: '1.26.0-aug.1',
                                          })
            expect(view.markup).toContain('role="alert"')
            const message = view.t(
                'compat.panel_too_old',
                { panel: '1.26.0', server: '8.0.23-aug.1', min: '1.26.0-aug.1' },
            )
            expect(view.markup).toContain(renderToStaticMarkup(createElement(
                'span',
                { className: 'message' },
                message,
            )))
        },
    )

    test.each([
                  {},
                  { panelVersion: 'v1.26.0-aug.1' },
                  { serverVersion: 'v8.0.23-aug.5' },
                  { panelVersion: 'dev', serverVersion: 'unknown', minPanelVersion: '' },
              ])('keeps compatible or unavailable version data without an alert: %j', (options) => {
        const view = bannerHarness(options)
        expect(view.mismatch).toBeNull()
        expect(view.markup).toBe('')
    })

    test('keeps a dismissed mismatch hidden', () => {
        const view = bannerHarness({ serverVersion: 'v8.0.22-aug.1', dismissed: true })
        expect(view.mismatch?.reason).toBe('server_too_old')
        expect(view.markup).toBe('')
    })
})
