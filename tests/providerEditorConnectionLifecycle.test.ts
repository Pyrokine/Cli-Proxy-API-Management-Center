import {describe, expect, mock, test} from 'bun:test'
import {sourceCallback} from './sourceCallbacks'

const formFile = 'hooks/useProviderEditForm.ts'
const layoutFile = 'hooks/useProviderEditLayout.ts'
const vendorFile = 'components/credentials/VendorSection.tsx'
const t = (key: string) => key
const flush = async () => {
    for (let index = 0; index < 8; index += 1) {
        await Promise.resolve()
    }
}

describe('provider editor connection lifecycle', () => {
    for (const file of [formFile, layoutFile]) {
        for (const outcome of ['success', 'failure'] as const) {
            test(`${file} ignores an old load ${outcome} before effect cleanup`, async () => {
                let generation = 1
                const apiClient = {getAuthGeneration: () => generation}
                const isCurrent = sourceCallback<() => boolean>(file, 'isCurrent', {apiClient, authGeneration: 1})
                const pending = Promise.withResolvers<unknown[]>()
                const loadConfigs = mock(() => pending.promise)
                const setConfigs = mock()
                const setLoading = mock()
                const setSaving = mock()
                const setError = mock()
                const setConfigGeneration = mock()
                const showNotification = mock()
                const scope = {
                    isCurrent, authGeneration: 1, t, loadConfigs, setConfigs, setLoading, setSaving,
                    setError, setConfigGeneration, showNotification,
                    setStoredForm: mock(), setBaselineSignature: mock(), configHelpers: {},
                    getErrorMessage: (error: unknown) => error instanceof Error ? error.message : '',
                    config: {loadConfigs, buildEmptyForm: () => ({}), buildSignature: () => 'empty'},
                }
                const effect = sourceCallback<() => () => void>(file, 'useEffect', scope, file === formFile ? 0 : 1)
                const cleanup = effect()
                await flush()
                expect(loadConfigs).toHaveBeenCalledTimes(1)
                expect(setSaving).not.toHaveBeenCalled()
                for (const fn of [setConfigs, setLoading, setSaving, setError, setConfigGeneration]) {
                    fn.mockClear()
                }
                generation = 2
                if (outcome === 'success') {
                    pending.resolve([{authIndex: 'old-source'}])
                } else {
                    pending.reject(new Error('old source failure'))
                }
                await flush()
                expect(setConfigs).not.toHaveBeenCalled()
                expect(setLoading).not.toHaveBeenCalled()
                expect(setSaving).not.toHaveBeenCalled()
                expect(setError).not.toHaveBeenCalled()
                expect(setConfigGeneration).not.toHaveBeenCalled()
                expect(showNotification).not.toHaveBeenCalled()
                cleanup()
            })
        }
    }

    test('generic load helpers reject stale fetches and cache mutations', async () => {
        let generation = 1
        const pending = Promise.withResolvers<unknown>()
        const fetchConfig = mock(() => pending.promise)
        const updateConfigValue = mock()
        const clearCache = mock()
        const isCurrent = () => generation === 1
        const helpers = sourceCallback<() => {
            fetchConfig: (key: string) => Promise<unknown>
            updateConfigValue: (key: string, value: unknown) => void
            clearCache: (key: string) => void
        }>(formFile, 'configHelpers', {isCurrent, t, fetchConfig, updateConfigValue, clearCache})()
        const work = helpers.fetchConfig('codex-api-key')
        generation = 2
        pending.resolve([{authIndex: 'old-source'}])
        await expect(work).rejects.toThrow('common.connection_changed')
        expect(() => helpers.updateConfigValue('codex-api-key', [])).toThrow('common.connection_changed')
        expect(() => helpers.clearCache('codex-api-key')).toThrow('common.connection_changed')
        await expect(helpers.fetchConfig('codex-api-key')).rejects.toThrow('common.connection_changed')
        expect(fetchConfig).toHaveBeenCalledTimes(1)
        expect(updateConfigValue).not.toHaveBeenCalled()
        expect(clearCache).not.toHaveBeenCalled()
    })

    for (const index of [null, 0, 'invalid']) {
        test(`draft ${index} belongs to its connection generation`, () => {
            const key = (authGeneration: number) => sourceCallback<() => string>(layoutFile, 'draftKey', {
                authGeneration, draftKeyPrefix: 'claude', invalidIndexParam: index === 'invalid',
                editIndex: typeof index === 'number' ? index : null, params: {index: String(index)},
            })()
            expect(key(1)).not.toBe(key(2))
            expect(key(1)).toStartWith('claude:1:')
            expect(key(2)).toStartWith('claude:2:')
        })
    }

    for (const [name, setter] of [
        ['setConfigs', 'setStoredConfigs'], ['setSaving', 'setSavingGeneration'], ['setForm', 'setDraftForm'],
        ['setTestModel', 'setDraftTestModel'], ['setTestStatus', 'setDraftTestStatus'],
        ['setTestMessage', 'setDraftTestMessage'], ['updateBaselineSignature', 'setDraftBaselineSignature'],
    ]) {
        test(`old layout ${name} cannot publish into or recreate a draft`, () => {
            let current = true
            const write = mock()
            const callback = sourceCallback<(value: unknown) => void>(layoutFile, name, {
                isCurrent: () => current, authGeneration: 1, draftKey: 'claude:1:0', [setter]: write,
            })
            callback('fixture')
            expect(write).toHaveBeenCalledTimes(1)
            write.mockClear()
            current = false
            callback('old result')
            expect(write).not.toHaveBeenCalled()
        })
    }

    for (const file of [formFile, layoutFile]) {
        test(`${file} owns saving state without resetting a current request during reload`, () => {
            let generation = 1
            let savingGeneration: number | null = null
            const capture = (authGeneration: number) => sourceCallback<(value: boolean) => void>(file, 'setSaving', {
                authGeneration,
                isCurrent: () => generation === authGeneration,
                setSavingGeneration: (action: number | null | ((previous: number | null) => number | null)) => {
                    savingGeneration = typeof action === 'function' ? action(savingGeneration) : action
                },
            })
            const oldSave = capture(1)
            oldSave(true)
            expect<number | null>(savingGeneration).toBe(1)
            generation = 2
            const currentSave = capture(2)
            currentSave(true)
            oldSave(false)
            expect<number | null>(savingGeneration).toBe(2)
            currentSave(false)
            expect<number | null>(savingGeneration).toBeNull()
        })
    }

    for (const [name, setter, args] of [
        ['handleSetDraftKeyTestStatus', 'rawSetDraftKeyTestStatus', [0, 'success']],
        ['handleSetDraftKeyTestStatuses', 'rawSetDraftKeyTestStatuses', [['success']]],
        ['handleResetDraftKeyTestStatuses', 'rawResetDraftKeyTestStatuses', [1]],
    ] as const) {
        test(`old OpenAI ${name} cannot recreate its released draft`, () => {
            let current = true
            const write = mock()
            const callback = sourceCallback<(...values: unknown[]) => void>('pages/AiProvidersOpenAIEditLayout.tsx', name, {
                isCurrent: () => current, draftKey: 'openai:1:0', [setter]: write,
            })
            callback(...args)
            expect(write).toHaveBeenCalledTimes(1)
            current = false
            callback(...args)
            expect(write).toHaveBeenCalledTimes(1)
        })
    }

    test('layout save passes the captured generation guard to its consumer', async () => {
        let current = true
        const onSave = mock(async (context: {isCurrent: () => boolean}) => {
            expect(context.isCurrent()).toBe(true)
        })
        const scope = {
            disableControls: false, saving: false, resolvedLoading: false, invalidIndexParam: false,
            invalidIndex: false, isCurrent: () => current, onSave, form: {}, testModel: '', editIndex: 0,
            configs: [], setConfigs: mock(), setSaving: mock(), allowNextNavigation: mock(),
            updateBaselineSignature: mock(), handleBack: mock(),
        }
        const handle = sourceCallback<() => Promise<void>>(layoutFile, 'handleSave', scope)
        await handle()
        expect(onSave).toHaveBeenCalledTimes(1)
        const context = onSave.mock.calls[0]?.[0] as unknown as {isCurrent: () => boolean}
        expect(context.isCurrent()).toBe(true)
        current = false
        expect(context.isCurrent()).toBe(false)
        await handle()
        expect(onSave).toHaveBeenCalledTimes(1)
    })

    for (const provider of ['generic', 'claude', 'openai'] as const) {
        for (const edit of [false, true]) {
            for (const phase of ['write', 'reload'] as const) {
                for (const outcome of ['success', 'failure'] as const) {
                    test(`${provider} ${edit ? 'edit' : 'create'} ignores stale ${phase} ${outcome}`, async () => {
                        let current = true
                        const pending = Promise.withResolvers<unknown>()
                        const reloadStarted = Promise.withResolvers<void>()
                        const write = mock(async () => phase === 'write' ? pending.promise : undefined)
                        const reload = mock(async () => {
                            reloadStarted.resolve()
                            return phase === 'reload' ? pending.promise : []
                        })
                        const showNotification = mock()
                        const setConfigs = mock()
                        const setSaving = mock()
                        const setError = mock()
                        const updateConfigValue = mock()
                        const allowNextNavigation = mock()
                        const updateBaselineSignature = mock()
                        const handleBack = mock()
                        const form = {
                            apiKey: 'fixture-key', authIndex: 'fixture-auth', name: 'fixture-provider',
                            baseUrl: 'https://example.test', modelEntries: [], apiKeyEntries: [],
                            headers: [], excludedText: '', fingerprintProfile: '',
                        }
                        const configs = [{...form, requestScopedErrors: []}]
                        const context = {
                            isCurrent: () => current, form, testModel: '', editIndex: edit ? 0 : null,
                            configs, setConfigs, setSaving, allowNextNavigation, updateBaselineSignature, handleBack,
                        }
                        const scope = {
                            showNotification, t, updateConfigValue, setConfigs, setSaving, setError,
                            allowNextNavigation, handleBack, setBaselineSignature: updateBaselineSignature,
                            form, configs, editIndex: context.editIndex, isCurrent: context.isCurrent, canSave: true,
                            getCredentialWeightValidationKey: () => undefined,
                            getCredentialRetryValidationKey: () => undefined,
                            getModelEntriesValidationKey: () => undefined,
                            getRequestScopedErrorsValidationKey: () => undefined,
                            normalizeClaudeFingerprintProfile: () => '',
                            findProviderConfigIndexByAuthIndex: () => 0,
                            buildHeaderObject: () => ({}), entriesToModels: () => [], parseTextList: () => [],
                            buildClaudeSignature: () => 'signature', buildOpenAISignature: () => 'signature',
                            getErrorMessage: (error: unknown) => error instanceof Error ? error.message : '',
                            configHelpers: {updateConfigValue},
                            config: {
                                configKey: 'codex-api-key', formToPayload: () => form, buildSignature: () => 'signature',
                                createConfig: write, updateConfig: write, loadConfigs: reload,
                                i18n: {saveSuccessEdit: 'updated', saveSuccessAdd: 'created'},
                            },
                            providersApi: {
                                createClaudeConfig: write, patchClaudeConfig: write, getClaudeConfigs: reload,
                                createOpenAIProvider: write, patchOpenAIProvider: write, getOpenAIProviders: reload,
                            },
                        }
                        const file = provider === 'generic' ? formFile : provider === 'claude'
                            ? 'pages/AiProvidersClaudeEditLayout.tsx' : 'pages/AiProvidersOpenAIEditLayout.tsx'
                        const save = sourceCallback<(ctx?: typeof context) => Promise<void>>(file, provider === 'generic' ? 'handleSave' : 'onSave', scope)
                        const work = save(context)
                        if (phase === 'reload') {
                            await reloadStarted.promise
                        }
                        showNotification.mockClear()
                        current = false
                        if (outcome === 'success') {
                            pending.resolve([{authIndex: 'old-result'}])
                        } else {
                            pending.reject(new Error('old source failure'))
                        }
                        await work
                        expect(write).toHaveBeenCalledTimes(1)
                        expect(reload).toHaveBeenCalledTimes(phase === 'reload' ? 1 : 0)
                        expect(setConfigs).not.toHaveBeenCalled()
                        expect(updateConfigValue).not.toHaveBeenCalled()
                        expect(allowNextNavigation).not.toHaveBeenCalled()
                        expect(updateBaselineSignature).not.toHaveBeenCalled()
                        expect(handleBack).not.toHaveBeenCalled()
                        expect(showNotification).not.toHaveBeenCalled()
                        expect(setSaving.mock.calls).toEqual([[true]])
                        expect(setError.mock.calls).toEqual(provider === 'generic' ? [['']] : [])
                    })
                }
            }
        }
    }
})

describe('credential quota and cooldown connection lifecycle', () => {
    for (const outcome of ['success', 'failure'] as const) {
        test(`quota refresh ignores an old ${outcome}`, async () => {
            let generation = 1
            const pending = Promise.withResolvers<void>()
            const onRefresh = mock(async () => {})
            const showNotification = mock()
            const refreshNow = mock(() => pending.promise)
            const handle = sourceCallback<() => Promise<void>>(vendorFile, 'handleQuotaRefresh', {
                apiClient: {getAuthGeneration: () => generation}, authGeneration: 1,
                scheduler: {refreshNow}, quotaKey: 'fixture-quota', onRefresh, showNotification, t,
            })
            const work = handle()
            generation = 2
            if (outcome === 'success') {
                pending.resolve()
            } else {
                pending.reject(new Error('old quota failure'))
            }
            await work
            expect(refreshNow).toHaveBeenCalledTimes(1)
            expect(onRefresh).not.toHaveBeenCalled()
            expect(showNotification).not.toHaveBeenCalled()
            await handle()
            expect(refreshNow).toHaveBeenCalledTimes(1)
        })
    }

    for (const phase of ['before confirmation', 'request', 'refresh'] as const) {
        test(`cooldown confirmation cannot cross sources during ${phase}`, async () => {
            let generation = 1
            const pending = Promise.withResolvers<void>()
            const refreshStarted = Promise.withResolvers<void>()
            const clearLocalCooldown = mock(async () => phase === 'request' ? pending.promise : undefined)
            const onRefresh = mock(async () => {
                refreshStarted.resolve()
                return phase === 'refresh' ? pending.promise : undefined
            })
            const showNotification = mock()
            let confirm: (() => Promise<void>) | undefined
            const handle = sourceCallback<() => void>(vendorFile, 'handleClearCooldown', {
                apiClient: {getAuthGeneration: () => generation}, authGeneration: 1, authIndex: 'fixture-auth',
                file: {name: 'fixture.json'}, formatAuthFileDisplayName: (name: string) => name,
                showConfirmation: (options: {onConfirm: () => Promise<void>}) => { confirm = options.onConfirm },
                authFilesApi: {clearLocalCooldown}, onRefresh, showNotification, t,
            })
            handle()
            if (!confirm) {
                throw new Error('Missing confirmation callback')
            }
            if (phase === 'before confirmation') {
                generation = 2
            }
            const work = confirm()
            if (phase === 'refresh') {
                await refreshStarted.promise
            }
            generation = 2
            pending.resolve()
            await expect(work).rejects.toThrow('common.connection_changed')
            expect(clearLocalCooldown).toHaveBeenCalledTimes(phase === 'before confirmation' ? 0 : 1)
            expect(onRefresh).toHaveBeenCalledTimes(phase === 'refresh' ? 1 : 0)
            expect(showNotification).not.toHaveBeenCalled()
        })
    }
})
