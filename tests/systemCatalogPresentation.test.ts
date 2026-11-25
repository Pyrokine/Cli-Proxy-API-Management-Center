import {Button} from '@/components/ui/Button'
import type {ModelCatalogRefreshMeta} from '@/services/api/modelCatalog'
import {getErrorMessage} from '@/utils/helpers'
import {compareLooseSemver, parseLooseSemver} from '@/utils/looseSemver'
import {redactSensitiveText} from '@/utils/redaction'
import {describe, expect, mock, test} from 'bun:test'
import {createInstance} from 'i18next'
import {readFileSync} from 'node:fs'
import React, {type ReactElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {compile} from 'sass'
import ts from 'typescript'
import {sourceCallback, sourceExpression, sourceInitializer} from './sourceCallbacks'

const file                          = 'pages/SystemPage.tsx'
const noop                          = () => {
}
const styles                        = new Proxy<Record<string, string>>({}, { get: (_target, key) => String(key) })
const diagnostic                    =
          'catalog request failed: GET https://catalog.invalid/models.json?api_key=fixture-secret <timeout>'
const meta: ModelCatalogRefreshMeta = {
    source: 'embed', sources: ['https://catalog.invalid/models.json'], interval_hours: 3,
    last_refresh_at: '', next_refresh_at: '', last_error: diagnostic,
}
const languages                     = [
    ['en', 'Panel Version', 'Server Version', 'Unable to load catalog refresh status', 'Upstream refresh failed'],
    [
        'ru',
        'Версия панели',
        'Версия сервера',
        'Не удалось загрузить состояние обновления каталога',
        'Не удалось обновить каталог с источника',
    ],
    ['zh-CN', '面板版本', '服务端版本', '无法读取目录刷新状态', '上游刷新失败'],
    ['zh-TW', '面板版本', '伺服器端版本', '無法讀取目錄重新整理狀態', '上游重新整理失敗'],
] as const

function errorMarkup(left: string, scope: Record<string, unknown>) {
    return renderToStaticMarkup(sourceExpression<ReactElement | null>(file, (node, tree) =>
        ts.isBinaryExpression(node) && node.left.getText(tree) === left, {
                                                                          React, styles, redactSensitiveText, ...scope,
                                                                      }))
}

function expectLocalizedError(html: string, message: string) {
    expect(html).toContain(`<summary>${message}</summary>`)
    expect(html).toContain('<details class="catalogErrorDetails">')
    expect(html).not.toContain(' open')
    expect(html).toContain('[REDACTED]')
    expect(html).toContain('&lt;timeout&gt;')
    expect(html).not.toContain('fixture-secret')
    expect(html.replace(/<pre>[\s\S]*?<\/pre>/g, '')).not.toContain('catalog request failed')
}

for (const [language, panelLabel, serverLabel, metaFailed, refreshFailed] of languages) {
    describe(`system catalog presentation (${language})`, () => {
        const instance = createInstance()
        const ready    = instance.init({
                                           lng: language, fallbackLng: false,
                                           resources: {
                                               [language]: {
                                                   translation: JSON.parse(readFileSync(new URL(
                                                       `../src/i18n/locales/${language}.json`,
                                                       import.meta.url,
                                                   ), 'utf8')),
                                               },
                                           },
                                       })
        const t        = instance.t.bind(instance)

        test('R-162 labels each version with its actual source', async () => {
            await ready
            const auth       = { serverVersion: 'v8.0.23-aug.5' }
            const appVersion = sourceInitializer<string>(file, 'appVersion', { __APP_VERSION__: 'v1.26.0-aug.5', t })
            const apiVersion = sourceInitializer<string>(file, 'apiVersion', { auth, t })
            for (const [key, label, value, otherValue] of [
                ['footer.version', panelLabel, appVersion, apiVersion],
                ['footer.api_version', serverLabel, apiVersion, appVersion],
            ]) {
                const tile = sourceExpression<ReactElement>(file, (node, tree) =>
                    ts.isJsxElement(node) &&
                    node.openingElement.getText(tree) ===
                    '<div className={styles.infoTile}>' &&
                    node.getText(tree).includes(`t('${key}')`), {
                                                                React,
                                                                styles,
                                                                t,
                                                                Button,
                                                                appVersion,
                                                                apiVersion,
                                                                handleVersionCheck: noop,
                                                                setVersionHistoryTarget: noop,
                                                                checkingVersion: {}, authGeneration: 1,
                                                                auth: { connectionStatus: 'connected' },
                                                                panelBuildTime: '-', serverBuildTime: '-',
                                                                panelCheck: undefined, cpaCheck: undefined,
                                                                releaseStatus: () => '-', requiredPanelVersion: '-',
                                                                formatDateTime: () => '-', i18n: { language },
                                                            })
                const html = renderToStaticMarkup(tile)
                expect(html).toContain(`<div class="tileLabel">${label}</div>`)
                expect(html).toContain(`<div class="tileValue">${value}</div>`)
                expect(html).not.toContain(otherValue)
            }
            expect(sourceInitializer<string>(file, 'appVersion', { __APP_VERSION__: '', t })).toBe(t(
                'system_info.version_unknown'))
            expect(sourceInitializer<string>(file, 'apiVersion', { auth: {}, t }))
                .toBe(t('system_info.version_unknown'))
        })

        test('R-523 localizes metadata failures, upstream errors and recovery', async () => {
            await ready
            let failure: string | null                      = null
            let currentMeta: ModelCatalogRefreshMeta | null = null
            let fail                                        = true
            const fetch                                     = sourceCallback<() => Promise<void>>(
                file,
                'fetchCatalogMeta',
                {
                    modelCatalogApi: {
                        getMeta: async () => {
                            if (fail) {
                                throw new Error(diagnostic)
                            }

                            return meta
                        },
                    },
                    setCatalogMeta: (value: ModelCatalogRefreshMeta) => {
                        currentMeta =
                            value
                    },
                    setCatalogMetaError: (value: string | null) => {
                        failure =
                            value
                    },
                },
            )
            await fetch()
            expect<string | null>(failure).toBe(diagnostic)
            const failed = errorMarkup('catalogMetaError', { catalogMetaError: failure, t })
            expectLocalizedError(failed, metaFailed)
            expect(failed).toContain('role="alert"')
            fail = false
            await fetch()
            expect<string | null>(failure).toBeNull()
            expect<ModelCatalogRefreshMeta | null>(currentMeta).toBe(meta)
            expectLocalizedError(errorMarkup('catalogMeta.last_error', { catalogMeta: currentMeta, t }), refreshFailed)
            expect(errorMarkup('catalogMetaError', { catalogMetaError: failure, t })).toBe('')
            expect(errorMarkup('catalogMeta.last_error', { catalogMeta: { ...meta, last_error: '' }, t })).toBe('')
        })

        test('R-523 manual refresh notifications use only the selected language', async () => {
            await ready
            for (const fail of [true, false]) {
                let failure: string | null     = null
                const notices: unknown[][]     = []
                const persistent: unknown[][]  = []
                const loading: boolean[]       = []
                const diagnostics: unknown[][] = []
                let readbacks                  = 0
                const setCatalogMetaError      = (value: string | null) => {
                    failure = value
                }
                const fetchCatalogMeta         = sourceCallback<() => Promise<void>>(file, 'fetchCatalogMeta', {
                    modelCatalogApi: {
                        getMeta: async () => {
                            readbacks++;
                            return { ...meta, last_error: '' }
                        },
                    },
                    setCatalogMeta: noop, setCatalogMetaError,
                })
                const refresh                  = sourceCallback<() => Promise<void>>(file, 'handleCatalogRefresh', {
                    modelCatalogApi: {
                        refresh: async () => {
                            if (fail) {
                                throw new Error(diagnostic)
                            }

                            return { ...meta, last_error: '' }
                        },
                    },
                    setCatalogRefreshing: (value: boolean) => loading.push(value),
                    setCatalogMeta: noop,
                    setCatalogMetaError,
                    console: { warn: (...args: unknown[]) => diagnostics.push(args) },
                    redactSensitiveText,
                    showNotification: (...args: unknown[]) => notices.push(args),
                    addPersistentNotification: (...args: unknown[]) => persistent.push(args),
                    fetchCatalogMeta,
                    t,
                })
                await refresh()
                const expected = fail ? refreshFailed : t('system_info.catalog_refresh_success')
                expect(notices).toEqual([[expected, fail ? 'error' : 'success']])
                expect(persistent).toEqual([[expected, fail ? 'error' : 'success', 'model-update']])
                expect(loading).toEqual([true, false])
                expect(readbacks).toBe(fail ? 1 : 0)
                expect<string | null>(failure).toBeNull()
                expect(diagnostics).toEqual(fail ?
                                                [['Model catalog refresh failed:', redactSensitiveText(diagnostic)]] :
                                                [])
                expect(JSON.stringify(diagnostics)).not.toContain('fixture-secret')
            }
        })
    })
}

for (const failingTarget of ['cpa', 'panel'] as const) {
    test(
        `manual version check only reads its target and silent ${failingTarget} failure stays on that card`,
        async () => {
            type Target = 'cpa' | 'panel'
            type Checks = Partial<Record<Target, { version?: string; publishedAt?: string; error?: string }>>
            let checks: Checks = {}
            const published    = '2026-11-23T12:00:00Z'
            const failure      = new Error('synthetic release read failed')
            const cpa          = mock(async () => {
                if (failingTarget === 'cpa') {
                    throw failure
                }
                return { 'latest-version': 'v8.0.0', 'published-at': published }
            })
            const panel        = mock(async (..._args: unknown[]) => {
                if (failingTarget === 'panel') {
                    throw failure
                }
                return { target: 'panel', releases: [{ tag_name: 'v2.0.0', published_at: published, draft: false }] }
            })
            const notify       = mock()
            const check        = sourceCallback<(options: { target: Target; silent?: boolean }) => Promise<void>>(
                file, 'handleVersionCheck', {
                    authGeneration: 1,
                    apiClient: { getAuthGeneration: () => 1 },
                    versionCheckInFlight: { current: {} },
                    setCheckingVersion: noop,
                    versionApi: { checkLatest: cpa },
                    releasesApi: { list: panel },
                    appVersion: 'v1.0.0',
                    useAuthStore: { getState: () => ({ serverVersion: 'v7.0.0' }) },
                    setVersionChecks: (update: (previous: Checks) => Checks) => {
                        checks = update(checks)
                    },
                    compareVersions: sourceInitializer(
                        file,
                        'compareVersions',
                        { parseLooseSemver, compareLooseSemver },
                    ),
                    showNotification: notify,
                    addPersistentNotification: noop,
                    getErrorMessage,
                    t: (key: string) => key,
                },
            )
            const success      = failingTarget === 'cpa' ? 'panel' : 'cpa'
            await check({ target: success })
            expect(failingTarget === 'cpa' ? cpa : panel).not.toHaveBeenCalled()
            if (success === 'panel') {
                expect(panel).toHaveBeenCalledWith(1, 1, 'panel', true)
            }
            expect(notify).toHaveBeenCalledWith('system_info.version_update_available', 'warning')
            await Promise.all([check({ target: 'cpa', silent: true }), check({ target: 'panel', silent: true })])
            expect(panel).toHaveBeenCalledWith(1, 1, 'panel', false)
            expect(checks[success]).toMatchObject({
                                                      version: success === 'cpa' ? 'v8.0.0' : 'v2.0.0',
                                                      publishedAt: published,
                                                  })
            expect(checks[failingTarget]).toHaveProperty(
                'error',
                'system_info.version_check_error: synthetic release read failed',
            )
            expect(notify).toHaveBeenCalledTimes(1)
        },
    )
}

test('R-523 an existing error follows a language change without refetching', async () => {
    const instance  = createInstance()
    const resources = Object.fromEntries(languages.map(([language]) => [
        language, {
            translation: JSON.parse(readFileSync(
                new URL(`../src/i18n/locales/${language}.json`, import.meta.url),
                'utf8',
            )),
        },
    ]))
    await instance.init({ lng: 'en', fallbackLng: false, resources })
    for (const [language, , , metaFailed, refreshFailed] of languages) {
        await instance.changeLanguage(language)
        const t = instance.t.bind(instance)
        expectLocalizedError(errorMarkup('catalogMetaError', { catalogMetaError: diagnostic, t }), metaFailed)
        expectLocalizedError(errorMarkup('catalogMeta.last_error', { catalogMeta: meta, t }), refreshFailed)
    }
})

test('R-621 subgroup names retain priority over counts in the actual row and compiled styles', () => {
    const render = sourceCallback<(item: object) => ReactElement>(
        'pages/ModelManagementPage.tsx',
        'renderModelTreeRow',
        {
            React,
            styles,
            isTreeSearchActive: false,
            effectiveCollapsedRows: new Set(),
            modelColumns: Array(6),
            toggleTreeRow: noop,
            t: (
                _key: string,
                options: {
                    count?: number;
                    defaultValue: string
                },
            ) =>
                options.count === undefined ?
                options.defaultValue :
                `${options.count} models`,
        },
    )
    const html   = renderToStaticMarkup(render({
                                                   key: 'fixture-group',
                                                   depth: 1,
                                                   kind: 'group',
                                                   label: 'Subgroup name',
                                                   leafCount: 12,
                                                   children: [{}],
                                               }))
    expect(html).toContain('groupLevelRow')
    expect(html).toContain('<span class="groupName">Subgroup name</span>')
    expect(html).toContain('<span class="countBadge">12 models</span>')
    const css          = compile(new URL('../src/pages/ModelManagementPage.module.scss', import.meta.url).pathname).css
    const declarations = (selector: string) => {
        const result: Record<string, string> = {}
        for (const [, selectors, body] of css.matchAll(/(?<selectors>[^{}]+)\{(?<body>[^{}]*)}/g)) {
            if (selectors.split(',').some((value) => value.trim() === selector)) {
                for (const [, property, value] of body.matchAll(/(?<property>[\w-]+):\s*(?<value>[^;]+);/g)) {
                    result[property] = value.trim()
                }
            }
        }
        return result
    }
    const name         = declarations('.groupName')
    const count        = declarations('.countBadge')
    expect(name['font-size']).toBe('14px')
    expect(name['font-weight']).toBe('500')
    expect(count['font-size']).toBe('12px')
    expect(count['font-weight']).toBe('500')
    expect(Number.parseFloat(name['font-size'])).toBeGreaterThanOrEqual(Number.parseFloat(count['font-size']))
    expect(Number(name['font-weight'])).toBeGreaterThanOrEqual(Number(count['font-weight']))
    for (const selector of
        ['.providerRow .groupName', '.modelName', '.requestableBadge', '.aliasMore', '.priceStatus']) {
        expect(declarations(selector)['font-weight']).toBe('600')
    }
})
