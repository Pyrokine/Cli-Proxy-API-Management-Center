import {describe, expect, spyOn, test} from 'bun:test'
import {readFileSync} from 'node:fs'
import {fileURLToPath, URL} from 'node:url'
import {apiClient} from '@/services/api/client'
import {configFileApi, normalizeConfigYamlSaveResult} from '@/services/api/configFile'

import {expectSourceToContain} from './sourceContractAssertions'
import {useConfigStore} from '@/stores/useConfigStore'

const configStoreSource = readFileSync(
    fileURLToPath(new URL('../src/stores/useConfigStore.ts', import.meta.url)),
    'utf8',
)
const configPageSource  = readFileSync(
    fileURLToPath(new URL('../src/pages/ConfigPage.tsx', import.meta.url)),
    'utf8',
)
const localePaths       = ['en', 'ru', 'zh-CN', 'zh-TW'].map((locale) =>
                                                                 fileURLToPath(new URL(
                                                                     `../src/i18n/locales/${locale}.json`,
                                                                     import.meta.url,
                                                                 )),
)

describe('config section descriptors', () => {
    test('normalizes cleanup warnings from successful config saves', async () => {
        expect(normalizeConfigYamlSaveResult({ cleanup_error: ' cleanup failed ' })).toEqual({
                                                                                                 cleanupError: 'cleanup failed',
                                                                                             })
        expect(normalizeConfigYamlSaveResult({ cleanup_error: '' })).toEqual({})

        const put = spyOn(apiClient, 'put').mockResolvedValue({ cleanup_error: 'remove failed' })
        try {
            // noinspection ES6RedundantAwait
            await expect(configFileApi.saveConfigYaml('debug: true\n', 'etag-value')).resolves.toEqual({
                                                                                                           cleanupError: 'remove failed',
                                                                                                       })
            expect(put).toHaveBeenCalledTimes(1)
        } finally {
            put.mockRestore()
        }
    })

    test('shows cleanup warnings after save success without submitting twice', () => {
        const saveStart = configPageSource.indexOf('const handleConfirmSave = async')
        const saveEnd   = configPageSource.indexOf('const handleSave = async', saveStart)
        const saveBody  = configPageSource.slice(saveStart, saveEnd)

        expect(saveBody.match(/saveConfigYaml\(/g)).toHaveLength(1)
        expect(saveBody.indexOf('showNotification(t(\'config_management.save_success\'), \'success\')'))
            .toBeLessThan(saveBody.indexOf('t(\'config_management.cleanup_warning\''))
        expectSourceToContain(
            saveBody,
            't(\'config_management.cleanup_warning\', { message: saveResult.cleanupError })',
        )
    })

    test('provides the cleanup warning in all four locales', () => {
        localePaths.forEach((path) => {
            const locale = JSON.parse(readFileSync(path, 'utf8')) as {
                config_management?: { cleanup_warning?: string }
            }
            expect(locale.config_management?.cleanup_warning).toContain('{{message}}')
        })
    })

    test('updates normalized and raw config values through one descriptor', () => {
        useConfigStore.setState({
                                    config: { debug: false, raw: { debug: false } },
                                    cache: new Map([
                                                       ['__full__', { data: { debug: false }, timestamp: Date.now() }],
                                                       ['debug', { data: false, timestamp: Date.now() }],
                                                   ]),
                                    loading: false,
                                    error: null,
                                })

        useConfigStore.getState().updateConfigValue('debug', true)

        const state = useConfigStore.getState()
        expect(state.config?.debug).toBe(true)
        expect(state.config?.raw?.debug).toBe(true)
        expect(state.cache.has('debug')).toBe(false)
        expect(state.cache.has('__full__')).toBe(false)
    })

    test('keeps list sections synchronized with the raw config', () => {
        const entries = [{ apiKey: 'masked-key', baseUrl: 'https://api.example.com' }]
        useConfigStore.setState({ config: { raw: {} }, cache: new Map(), loading: false, error: null })

        useConfigStore.getState().updateConfigValue('claude-api-key', entries)

        const config = useConfigStore.getState().config
        expect(config?.claudeApiKeys).toEqual(entries)
        expect(config?.raw?.['claude-api-key']).toEqual(entries)
    })

    test('clears loading when a section invalidates the active full request', () => {
        useConfigStore.setState({
                                    config: { debug: false, raw: { debug: false } },
                                    cache: new Map(),
                                    loading: true,
                                    error: null,
                                })

        useConfigStore.getState().clearCache('debug')

        expect(useConfigStore.getState().loading).toBe(false)
    })

    test('keeps the raw server YAML as the API key storage source across tab changes', () => {
        expect(configPageSource).toContain('revisionStateRef.current.sourceNeedsReload || visualParseError')
        expect(configPageSource).toContain('loadVisualValuesFromYaml(content, content)')
    })

    test('discards a dirty draft from the local server baseline without refetching', () => {
        const reloadStart = configPageSource.indexOf('const handleReload = useCallback')
        const reloadEnd   = configPageSource.indexOf('const shouldShowFloatingActions', reloadStart)
        const reloadBody  = configPageSource.slice(reloadStart, reloadEnd)

        expect(reloadBody).toContain('const baseline = serverYaml')
        expect(reloadBody).toContain('revisionStateRef.current.resetDraftToServer()')
        expect(reloadBody).toContain('loadVisualValuesFromYaml(baseline, serverYaml)')
        expect(reloadBody.match(/loadConfig\(\)/g)).toHaveLength(1)
    })

    test('guards config loads and saves with request and draft revisions', () => {
        const loadStart    = configPageSource.indexOf('const loadConfig = useCallback')
        const confirmStart = configPageSource.indexOf('const handleConfirmSave = async')
        const saveStart    = configPageSource.indexOf('const handleSave = async', confirmStart)
        const loadBody     = configPageSource.slice(loadStart, confirmStart)
        const confirmBody  = configPageSource.slice(confirmStart, saveStart)
        const saveEnd      = configPageSource.indexOf('const handleChange', saveStart)
        const saveBody     = configPageSource.slice(saveStart, saveEnd)

        expect(loadBody).toContain('revisionStateRef.current.beginLoad()')
        expect(loadBody).toContain('revisionStateRef.current.isCurrentRequest(request)')
        expect(confirmBody).toContain('revisionStateRef.current.matches(prepared.revision)')
        expect(confirmBody).toContain('revisionStateRef.current.beginSave()')
        expect(saveBody).toContain('revisionStateRef.current.beginSave()')
        expectSourceToContain(saveBody, 'preparedSaveRef.current = prepared')
    })

    test('keeps source drafts and raw conflict snapshots separate from the visual diff', () => {
        const confirmStart = configPageSource.indexOf('const handleConfirmSave = async')
        const saveStart    = configPageSource.indexOf('const handleSave = async', confirmStart)
        const confirmBody  = configPageSource.slice(confirmStart, saveStart)
        const saveEnd      = configPageSource.indexOf('const handleChange', saveStart)
        const saveBody     = configPageSource.slice(saveStart, saveEnd)

        expect(confirmBody).toContain('let nextMergedYaml = prepared.content')
        expect(confirmBody).toContain('if (prepared.origin !== \'source\')')
        expect(saveBody).toContain('revisionStateRef.current.buildSaveDraft(latestServerYaml, mode, applyVisualChangesToYaml)')
        expect(saveBody).toContain('serverYaml: latestServerYaml')
        expect(configPageSource).toContain('original={diffOriginalYaml}')
    })

    test('invalidates prepared saves on source and visual edits', () => {
        const changeStart = configPageSource.indexOf('const handleChange = useCallback')
        const tabStart    = configPageSource.indexOf('const handleTabChange = useCallback', changeStart)
        const changeBody  = configPageSource.slice(changeStart, tabStart)

        expect(configPageSource).toContain('onChange={handleVisualChange}')
        expect(configPageSource).toContain('revisionStateRef.current.markDraftChanged()')
        expect(changeBody).toContain('markDraftChanged()')
    })

    test('uses one exhaustive descriptor instead of separate read and write switches', () => {
        expect(configStoreSource).toContain(
            'const CONFIG_SECTION_DESCRIPTORS: Record<RawConfigSection, ConfigSectionDescriptor>',
        )
        expect(configStoreSource).not.toContain('switch (section)')
    })
})
