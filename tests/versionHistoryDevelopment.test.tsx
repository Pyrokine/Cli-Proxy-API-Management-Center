import {apiClient} from '@/services/api/client'
import type {releasesApi} from '@/services/api/releases'
import type {UpdateStatus} from '@/services/api/update'
import {updateApi} from '@/services/api/update'
import type {AxiosInstance} from 'axios'
import {afterEach, describe, expect, mock, test} from 'bun:test'
import {spawnSync} from 'node:child_process'
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import type {ReactElement, ReactNode} from 'react'
import {Children, createElement, Fragment} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {parse as parseYaml} from 'yaml'
import {sourceCallback, sourceInitializer} from './sourceCallbacks'

const file                             = 'components/system/VersionHistoryModal.tsx'
const helpers: Record<string, unknown> = {}
for (const name of [
    'OFFICIAL_REPOSITORIES',
    'BREAKING_PATTERN',
    'NON_BREAKING_PATTERN',
    'COMPATIBILITY_PATTERN',
    'FEATURE_SECTION_PATTERN',
    'FIX_SECTION_PATTERN',
    'PAGE_SIZE',
    'UPDATE_POLL_INTERVAL',
    'UPDATE_POLL_RECONNECT_TIMEOUT',
]) {
    helpers[name] = sourceInitializer(file, name, helpers)
}
for (const name of [
    'parseVersion', 'compareSemver', 'extractBreakingHints', 'classifyReleaseBody', 'collectBreakingBetween',
    'cleanReleaseLine', 'uniqueNonEmpty', 'extractCompatibilityHints', 'extractRequiredServerVersion',
    'compareVersionStrings',
]) {
    helpers[name] = sourceCallback(file, name, helpers)
}

const transport       = (apiClient as unknown as { instance: AxiosInstance }).instance
const originalAdapter = transport.defaults.adapter

afterEach(() => {
    transport.defaults.adapter = originalAdapter
    apiClient.setConfig({ apiBase: '', sessionToken: '' })
})

function publishedReleaseBody(tag: string): string {
    const workflow = parseYaml(readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8'))
    const step     = workflow.jobs['build-and-release'].steps.find((step: { name: string }) => step.name ===
                                                                                               'Generate release notes')
    const script   = step.run.match(/^python3 <<'PY'\n(?<script>[\s\S]*?)\nPY\s*$/)?.[1]
    if (!script) {
        throw new Error('Release notes generator is missing')
    }
    const directory = mkdtempSync(join(tmpdir(), 'panel-release-notes-'))
    try {
        writeFileSync(join(directory, 'CHANGELOG.md'), readFileSync(new URL('../CHANGELOG.md', import.meta.url)))
        const result = spawnSync('python3', ['-I', '-c', script], {
            cwd: directory, encoding: 'utf8', env: { PATH: process.env.PATH, GITHUB_REF_NAME: tag },
        })
        if (result.status !== 0) {
            throw new Error(result.error?.message ?? result.stderr)
        }
        return readFileSync(join(directory, 'release-notes.md'), 'utf8')
    } finally {
        rmSync(directory, { recursive: true, force: true })
    }
}

interface ButtonProps {
    children?: ReactNode
    disabled?: boolean
    variant?: string
    onClick?: () => Promise<void>
}

interface Confirmation {
    title: string
    message: ReactNode
    confirmText: string
    confirmDisabled: boolean
    onConfirm: () => Promise<void>
}

const installLabels = { en: 'Install', 'zh-CN': '安装', 'zh-TW': '安裝', ru: 'Установить' }
type Locale = keyof typeof installLabels

function harness({
                     currentVersion = 'dev',
                     target = 'cpa',
                     compatible = true,
                     compatibilityError = false,
                     targetVersion = target === 'cpa' ? 'v8.0.23-aug.2' : 'v1.26.0-aug.2',
                     serverVersion = 'v8.0.23-aug.2',
                     checkingVersion = false,
                     locale = 'zh-CN',
                     updateStatus = null,
                     pollError = null,
                     pollingReady = false,
                     releaseBody,
                     open = true,
                     previousView = { open, target },
                     authGeneration = 0,
                     supportsClientAttemptID = true,
                     releaseHistory,
                     historyList,
                     api,
                 }: {
    api?: typeof updateApi
    historyList?: typeof releasesApi.list
    releaseHistory?: Array<{ tag_name: string; body: string }>
    supportsClientAttemptID?: boolean | null
    authGeneration?: number
    open?: boolean
    previousView?: { open: boolean; target: 'cpa' | 'panel'; authGeneration?: number }
    updateStatus?: UpdateStatus | null
    pollError?: string | null
    pollingReady?: boolean
    releaseBody?: string
    currentVersion?: string
    target?: 'cpa' | 'panel'
    compatible?: boolean
    compatibilityError?: boolean
    targetVersion?: string
    serverVersion?: string
    checkingVersion?: boolean
    locale?: Locale
} = {}) {
    const dictionary                    = JSON.parse(readFileSync(new URL(
        `../src/i18n/locales/${locale}.json`,
        import.meta.url,
    ), 'utf8'))
    const t                             = (key: string, values: Record<string, unknown> = {}) => {
        const [group, entry] = key.split('.')
        const text           = String(dictionary[group]?.[entry] ?? values.defaultValue ?? key)
        return text.replace(/\{\{(?<field>\w+)}}/g, (_match, field: string) => String(values[field] ?? ''))
    }
    const buttons: ButtonProps[]        = []
    const confirmations: Confirmation[] = []
    const body                          = releaseBody ??
                                          (target === 'panel' ? 'Required server: CLIProxyAPI 8.0.23-aug.1' : '')
    const releases                      = (releaseHistory ?? [{ tag_name: targetVersion, body }]).map((release) => ({
        ...release, published_at: '2026-10-20T05:44:38Z', draft: false,
    }))
    let generation                      = authGeneration
    const states: unknown[]             = [
        releases,
        false,
        null,
        0,
        updateStatus,
        null,
        checkingVersion ? targetVersion : null,
        pollingReady,
        pollError,
        { authGeneration: 0, ...previousView },
        0,
    ]
    let stateIndex                      = 0
    let refIndex                        = 0
    const refs: { current: unknown }[]  = []
    let unmountCleanup: (() => void) | undefined
    let loadHistory: (() => (() => void) | void) | undefined
    const compatibility                 = mock(async () => {
        if (compatibilityError) {
            throw new Error('compatibility unavailable')
        }
        return {
            compatible, requires_restart: true, current_version: currentVersion,
            min_panel_version: '1.15.3-aug.1', warnings: [],
            ...(supportsClientAttemptID === null ? {} : { supports_client_attempt_id: supportsClientAttemptID }),
        }
    })
    const trigger                       = mock(async (version: string, attemptID: string) => ({
        attempt_id: attemptID,
        target_version: version,
    }))
    const panelUpdate                   = mock(async () => undefined)
    const showNotification              = mock(() => undefined)
    const addPersistentNotification     = mock(() => undefined)
    const auth                          = { serverVersion, refreshServerVersion: mock(async () => undefined) }
    const useAuthStore                  = Object.assign((select: (value: typeof auth) => unknown) => select(auth), {
        getState: () => auth,
    })
    const component                     = sourceCallback<(props: Record<string, unknown>) => ReactElement>(
        file,
        'VersionHistoryModal',
        {
            ...helpers,
            React: {
                createElement,
                Fragment,
            },
            useState: () => {
                const index = stateIndex++
                return [
                    states[index],
                    (next: unknown) => {
                        states[index] =
                            typeof next ===
                            'function' ?
                            next(states[index]) :
                            next
                    },
                ]
            },
            useRef: (value: unknown) => refs[refIndex++] ??
                                        (refs[refIndex -
                                              1] =
                                            { current: value }),
            useMemo: (callback: () => unknown) => callback(),
            useCallback: (callback: unknown) => callback,
            useEffect: (
                callback: () => (() => void) | void,
                dependencies: unknown[],
            ) => {
                if (dependencies.length ===
                    0) {
                    unmountCleanup = callback() ?? undefined
                } else if (historyList && callback.toString().includes('loadReleases')) {
                    loadHistory = callback
                }
            },
            useTranslation: () => ({
                t,
                i18n: { language: locale },
            }),
            useNotificationStore: () => ({
                showNotification,
                addPersistentNotification,
                showConfirmation: (value: Confirmation) => confirmations.push(value),
            }),
            useAuthStore,
            apiClient: { getAuthGeneration: () => generation },
            updateApi: api ??
                {
                    compatibility,
                    trigger,
                    panelUpdate,
                },
            releasesApi: {
                list: historyList ?? mock(async () => ({ releases })),
            },
            // noinspection JSUnusedGlobalSymbols
            'formatDate': (value: string) => value,
            safeExternalUrl: () => null,
            styles: new Proxy(
                {},
                {
                    get: (
                        _object,
                        key,
                    ) => String(key),
                },
            ),
            Modal: ({ children }: {
                children: ReactNode
            }) => createElement(
                'div',
                { role: 'dialog' },
                children,
            ),
            Button: (props: ButtonProps) => {
                buttons.push(props)
                return createElement(
                    'button',
                    {
                        disabled: props.disabled,
                        onClick: props.onClick,
                    },
                    props.children,
                )
            },
            IconDownload: () => null,
            IconExternalLink: () => null,
            __APP_VERSION__: 'v1.26.0-aug.2',
        },
    )
    const props                         = { open, onClose: () => undefined, currentVersion, target }
    const render                        = (next: Partial<typeof props> = {}) => {
        Object.assign(props, next)
        buttons.length = 0
        stateIndex     = 0
        refIndex       = 0
        component(props)
        stateIndex = 0
        refIndex   = 0
        return renderToStaticMarkup(component(props))
    }
    const markup                        = render()
    const action                        = (label: string) => buttons.find((button) => Children.toArray(button.children)
                                                                                              .includes(label))
    const confirmationView              = () => {
        const actions: ButtonProps[] = []
        const store                  = {
            confirmation: { isOpen: true, isLoading: false, options: confirmations[confirmations.length - 1] },
            hideConfirmation: mock(() => undefined),
            setConfirmationLoading: mock((_value: boolean) => undefined),
        }
        const confirmation           = sourceCallback<() => ReactElement>(
            'components/common/ConfirmationModal.tsx',
            'ConfirmationModal',
            {
                React: { createElement },
                useTranslation: () => ({ t }),
                useNotificationStore: (select: (state: typeof store) => unknown) => select(store),
                Modal: ({ children }: {
                    children: ReactNode
                }) => createElement(
                    'div',
                    { role: 'dialog' },
                    children,
                ),
                Button: (props: ButtonProps) => {
                    actions.push(props)
                    return createElement(
                        'button',
                        { disabled: props.disabled },
                        props.children,
                    )
                },
            },
        )
        const markup                 = renderToStaticMarkup(createElement(confirmation))
        return {
            markup,
            cancel: actions[0],
            confirm: actions[1],
            hide: store.hideConfirmation,
            loading: store.setConfirmationLoading,
        }
    }
    return {
        markup, action, confirmations, confirmationView, compatibility, trigger, panelUpdate, showNotification,
        addPersistentNotification, refreshServerVersion: auth.refreshServerVersion, targetVersion, states, render,
        loadHistory: () => loadHistory?.(),
        changeConnection: () => {
            ++generation
        }, closeView: () => {
            render({ open: false })
        }, unmount: () => unmountCleanup?.(),
    }
}

for (const previous of ['panel', 'cpa'] as const) {
    test(`failed history load after ${previous} never offers the previous target's release`, async () => {
        const target      = previous === 'panel' ? 'cpa' : 'panel'
        const oldTag      = 'v2.0.0-old'
        const newTag      = 'v3.0.0-current'
        const historyList = mock(async (page = 1, per_page = 100, requested = target) => {
            if (historyList.mock.calls.length === 1) {
                throw new Error('Synthetic release history unavailable')
            }
            return {
                page, per_page, target: requested, total: 1, releases: [
                    {
                        tag_name: newTag, name: '', body: '', draft: false, prerelease: false, published_at: '',
                        html_url: '', assets: [],
                    },
                ],
            }
        })
        const view        = harness({ target: previous, locale: 'en', targetVersion: oldTag, historyList })
        expect(view.markup).toContain(oldTag)
        view.closeView()
        expect(view.render({ open: true, target })).not.toContain(oldTag)
        view.loadHistory()
        await new Promise<void>((resolve) => setImmediate(resolve))
        const failed = view.render()
        expect(failed).toContain('Synthetic release history unavailable')
        expect(failed).not.toContain(oldTag)
        expect(view.action('Install')).toBeUndefined()
        const retry = view.action('Retry')
        expect(retry).toBeDefined()
        await retry?.onClick?.()
        view.render()
        view.loadHistory()
        await new Promise<void>((resolve) => setImmediate(resolve))
        expect(view.render()).toContain(newTag)
        expect(view.render()).not.toContain(oldTag)
        expect(historyList.mock.calls).toEqual([[1, 100, target], [1, 100, target]])
        expect(view.compatibility).not.toHaveBeenCalled()
        expect(view.panelUpdate).not.toHaveBeenCalled()
    })
}

async function openInstall(view: ReturnType<typeof harness>, label = '安装') {
    const button = view.action(label)
    expect(button).toBeDefined()
    expect(button?.disabled).toBe(false)
    await button?.onClick?.()
    expect(view.confirmations).toHaveLength(1)
    return view.confirmations[0]
}

describe('development build release installation', () => {
    test.each(Object.keys(installLabels) as Locale[])(
        'renders the install action and development warning in %s',
        async (locale) => {
            const view         = harness({ locale })
            const confirmation = await openInstall(view, installLabels[locale])
            expect(confirmation.title).toBe(installLabels[locale])
            expect(confirmation.confirmText).toContain(view.targetVersion)
            expect(renderToStaticMarkup(createElement('div', null, confirmation.message))).toContain('dev')
            expect(view.trigger).not.toHaveBeenCalled()
            expect(view.panelUpdate).not.toHaveBeenCalled()
        },
    )

    test.each(['dev', ' DEV '])(
        'installs a release from %s only after compatibility and confirmation',
        async (currentVersion) => {
            const view         = harness({ currentVersion })
            const confirmation = await openInstall(view)
            expect(view.compatibility).toHaveBeenCalledTimes(1)
            expect(view.compatibility).toHaveBeenCalledWith(view.targetVersion)
            expect(confirmation.confirmDisabled).toBe(false)
            expect(view.trigger).not.toHaveBeenCalled()
            await confirmation.onConfirm()
            expect(view.trigger).toHaveBeenCalledTimes(1)
            expect(view.trigger).toHaveBeenCalledWith(view.targetVersion, expect.stringMatching(/^[a-f0-9]{32}$/))
            expect(view.panelUpdate).not.toHaveBeenCalled()
        },
    )

    test.each(['cpa', 'panel'] as const)(
        'does not submit an old %s confirmation after the connection changes',
        async (target) => {
            const view         = harness({ target })
            const confirmation = await openInstall(view)
            view.changeConnection()
            await confirmation.onConfirm()
            expect(view.trigger).not.toHaveBeenCalled()
            expect(view.panelUpdate).not.toHaveBeenCalled()
        },
    )

    test('does not start polling from an installation response belonging to an old connection', async () => {
        const view         = harness()
        const confirmation = await openInstall(view)
        let resolve!: (value: { attempt_id: string; target_version: string }) => void
        const pending      = new Promise<{ attempt_id: string; target_version: string }>((complete) => {
            resolve = complete
        })
        view.trigger.mockImplementationOnce(() => pending)
        const submission = confirmation.onConfirm()
        view.changeConnection()
        resolve({ attempt_id: 'previous-connection', target_version: view.targetVersion })
        await submission
        expect(view.states[7]).toBe(false)
        expect(view.showNotification).not.toHaveBeenCalled()
    })

    test.each([new Error('Connection closed'), Object.assign(new Error('HTTP 502'), { status: 502 })])(
        'queries an uncertain initial submission without resubmitting it: %s', async (error) => {
            const view         = harness()
            const confirmation = await openInstall(view)
            view.trigger.mockRejectedValueOnce(error)
            await confirmation.onConfirm()
            expect(view.trigger).toHaveBeenCalledTimes(1)
            expect(view.states[4]).toMatchObject({
                                                     status: 'downloading',
                                                     attempt_id: expect.stringMatching(/^[a-f0-9]{32}$/),
                                                 })
            expect(view.states[5]).toBe(view.targetVersion)
            expect(view.states[7]).toBe(true)
            expect(view.states[8]).toBe(error.message)
            expect(view.showNotification).not.toHaveBeenCalled()
        },
    )

    test.each([null, false])(
        'binds a valid acknowledgement from an old server with capability %s',
        async (supportsClientAttemptID) => {
            const view          = harness({ supportsClientAttemptID })
            const confirmation  = await openInstall(view)
            const serverAttempt = 'f'.repeat(32)
            view.trigger.mockResolvedValueOnce({ attempt_id: serverAttempt, target_version: view.targetVersion })
            await confirmation.onConfirm()
            expect(view.states[4]).toMatchObject({ attempt_id: serverAttempt, target_version: view.targetVersion })
            expect(view.states[7]).toBe(true)
            expect(view.states[8]).toBeNull()
            expect(view.trigger).toHaveBeenCalledTimes(1)
        },
    )

    test.each(['', 'invalid', 'A'.repeat(32), undefined])(
        'does not bind an invalid old-server attempt %s',
        async (attemptID) => {
            const view         = harness({ supportsClientAttemptID: null })
            const confirmation = await openInstall(view)
            view.trigger.mockResolvedValueOnce({ attempt_id: attemptID as string, target_version: view.targetVersion })
            await confirmation.onConfirm()
            expect(view.states[4]).toMatchObject({ attempt_id: expect.stringMatching(/^[a-f0-9]{32}$/) })
            expect((view.states[4] as UpdateStatus).attempt_id).not.toBe(attemptID)
            expect(view.states[8]).toBeTruthy()
            expect(view.trigger).toHaveBeenCalledTimes(1)
        },
    )

    test('does not bind an old-server acknowledgement for another version', async () => {
        const view         = harness({ supportsClientAttemptID: null })
        const confirmation = await openInstall(view)
        view.trigger.mockResolvedValueOnce({ attempt_id: 'f'.repeat(32), target_version: 'v8.0.23-aug.1' })
        await confirmation.onConfirm()
        expect((view.states[4] as UpdateStatus).attempt_id).not.toBe('f'.repeat(32))
        expect(view.states[8]).toBeTruthy()
    })

    test('keeps a mismatched acknowledgement unconfirmed and queries only its requested attempt', async () => {
        const view         = harness()
        const confirmation = await openInstall(view)
        view.trigger.mockResolvedValueOnce({ attempt_id: 'f'.repeat(32), target_version: view.targetVersion })
        await confirmation.onConfirm()
        expect(view.states[4]).toMatchObject({
                                                 status: 'downloading',
                                                 attempt_id: expect.stringMatching(/^[a-f0-9]{32}$/),
                                             })
        expect(view.states[7]).toBe(true)
        expect(view.states[8]).toBeTruthy()
        expect(view.showNotification).not.toHaveBeenCalled()
        expect(view.trigger).toHaveBeenCalledTimes(1)
    })

    test('reports an explicit rejection without querying or repeating the installation', async () => {
        const view         = harness()
        const confirmation = await openInstall(view)
        view.trigger.mockRejectedValueOnce(Object.assign(new Error('Incompatible'), { status: 409 }))
        await confirmation.onConfirm()
        expect(view.states[4]).toMatchObject({ status: 'error', message: 'Incompatible' })
        expect(view.states[7]).toBe(false)
        expect(view.states[5]).toBeNull()
        expect(view.showNotification).toHaveBeenCalledWith('Incompatible', 'error')
        expect(view.trigger).toHaveBeenCalledTimes(1)
    })

    test('ignores a late installation rejection after its view has closed', async () => {
        const view         = harness()
        const confirmation = await openInstall(view)
        let reject!: (error: Error) => void
        view.trigger.mockImplementationOnce(() => new Promise((_resolve, fail) => {
            reject = fail
        }))
        const submitting = confirmation.onConfirm()
        view.closeView()
        reject(Object.assign(new Error('Late rejection'), { status: 409 }))
        await submitting
        expect(view.states[4]).toBeNull()
        expect(view.showNotification).not.toHaveBeenCalled()
        view.render({ open: true })
        expect(view.states[4]).toMatchObject({ status: 'error', message: 'Late rejection' })
        expect(view.trigger).toHaveBeenCalledTimes(1)
    })

    test.each([null, true])(
        'keeps a lost acknowledgement associated across close and reopen with capability %s',
        async (supportsClientAttemptID) => {
            const view         = harness({ supportsClientAttemptID })
            const confirmation = await openInstall(view)
            view.trigger.mockRejectedValueOnce(new Error('Connection closed'))
            await confirmation.onConfirm()
            const pending = { ...view.states[4] as UpdateStatus }
            view.closeView()
            view.render({ open: true })
            expect(view.states[4]).toEqual(pending)
            expect(view.states[5]).toBe(view.targetVersion)
            expect(view.states[7]).toBe(true)
            expect(view.states[8]).toBe('Connection closed')
            expect(view.trigger).toHaveBeenCalledTimes(1)
        },
    )

    test.each([false, true])(
        'adopts a late old-server acknowledgement when reopened first: %s',
        async (reopenBeforeAck) => {
            const view         = harness({ supportsClientAttemptID: null })
            const confirmation = await openInstall(view)
            let resolve!: (value: { attempt_id: string; target_version: string }) => void
            view.trigger.mockImplementationOnce(() => new Promise((complete) => {
                resolve = complete
            }))
            const submitting = confirmation.onConfirm()
            view.closeView()
            if (reopenBeforeAck) {
                view.render({ open: true })
            }
            resolve({ attempt_id: 'f'.repeat(32), target_version: view.targetVersion })
            await submitting
            view.render({ open: true })
            expect(view.states[4]).toMatchObject({ attempt_id: 'f'.repeat(32), target_version: view.targetVersion })
            expect(view.states[7]).toBe(true)
            expect(view.states[8]).toBeNull()
            expect(view.showNotification).not.toHaveBeenCalled()
            expect(view.trigger).toHaveBeenCalledTimes(1)
        },
    )

    test('retains the backend attempt while another version history is visible', async () => {
        const view         = harness({ supportsClientAttemptID: null })
        const confirmation = await openInstall(view)
        let resolve!: (value: { attempt_id: string; target_version: string }) => void
        view.trigger.mockImplementationOnce(() => new Promise((complete) => {
            resolve = complete
        }))
        const submitting = confirmation.onConfirm()
        view.render({ target: 'panel' })
        resolve({ attempt_id: 'f'.repeat(32), target_version: view.targetVersion })
        await submitting
        expect(view.states[4]).toBeNull()
        expect(view.states[7]).toBe(false)
        view.render({ target: 'cpa' })
        expect(view.states[4]).toMatchObject({ attempt_id: 'f'.repeat(32) })
        expect(view.states[7]).toBe(true)
    })

    test('ignores an installation rejection after the component unmounts', async () => {
        const view         = harness()
        const confirmation = await openInstall(view)
        let reject!: (error: Error) => void
        view.trigger.mockImplementationOnce(() => new Promise((_resolve, fail) => {
            reject = fail
        }))
        const submitting = confirmation.onConfirm()
        view.unmount()
        reject(Object.assign(new Error('Late rejection'), { status: 409 }))
        await submitting
        expect(view.states[4]).toMatchObject({ status: 'downloading' })
        expect(view.showNotification).not.toHaveBeenCalled()
        expect(view.trigger).toHaveBeenCalledTimes(1)
    })

    test('clears retained attempt identity when the connection changes', async () => {
        const view         = harness()
        const confirmation = await openInstall(view)
        await confirmation.onConfirm()
        view.closeView()
        view.changeConnection()
        view.render({ open: true })
        expect(view.states[4]).toBeNull()
        expect(view.states[5]).toBeNull()
        expect(view.states[8]).toBeNull()
        expect(view.trigger).toHaveBeenCalledTimes(1)
    })

    test('submits at most one installation while its acknowledgement is pending', async () => {
        const view         = harness()
        const confirmation = await openInstall(view)
        let resolve!: (value: { attempt_id: string; target_version: string }) => void
        view.trigger.mockImplementationOnce(() => new Promise((complete) => {
            resolve = complete
        }))
        const submitting = confirmation.onConfirm()
        await confirmation.onConfirm()
        expect(view.trigger).toHaveBeenCalledTimes(1)
        const [version, attemptID] = view.trigger.mock.calls[0]!
        resolve({ attempt_id: attemptID, target_version: version })
        await submitting
    })

    test('keeps an incompatible backend installation disabled', async () => {
        const view         = harness({ compatible: false })
        const confirmation = await openInstall(view)
        expect(confirmation.confirmDisabled).toBe(true)
        expect(renderToStaticMarkup(createElement('div', null, confirmation.message))).toContain('不满足')
        expect(view.trigger).not.toHaveBeenCalled()
    })

    test('reports a failed compatibility check without starting an installation', async () => {
        const view = harness({ compatibilityError: true })
        await view.action('安装')?.onClick?.()
        expect(view.compatibility).toHaveBeenCalledTimes(1)
        expect(view.compatibility).toHaveBeenCalledWith(view.targetVersion)
        expect(view.confirmations).toHaveLength(0)
        expect(view.trigger).not.toHaveBeenCalled()
        expect(view.showNotification).toHaveBeenCalledTimes(1)
        expect(view.showNotification).toHaveBeenCalledWith('compatibility unavailable', 'error')
    })

    test('updates a development panel through the existing panel endpoint', async () => {
        const view         = harness({ target: 'panel' })
        const confirmation = await openInstall(view)
        expect(view.compatibility).not.toHaveBeenCalled()
        expect(view.panelUpdate).not.toHaveBeenCalled()
        await confirmation.onConfirm()
        expect(view.panelUpdate).toHaveBeenCalledTimes(1)
        expect(view.panelUpdate).toHaveBeenCalledWith(view.targetVersion)
        expect(view.trigger).not.toHaveBeenCalled()
    })

    test('keeps a development panel installation blocked by its backend requirement', async () => {
        const view         = harness({ target: 'panel', serverVersion: 'v7.3.2-aug.1' })
        const confirmation = await openInstall(view)
        expect(confirmation.confirmDisabled).toBe(true)
        expect(view.panelUpdate).not.toHaveBeenCalled()
    })

    test('keeps installation unavailable while a compatibility check is in progress', async () => {
        const view = harness({ checkingVersion: true })
        expect(view.action('安装')?.disabled).toBe(true)
        await view.action('安装')?.onClick?.()
        expect(view.compatibility).not.toHaveBeenCalled()
        expect(view.confirmations).toHaveLength(0)
        expect(view.trigger).not.toHaveBeenCalled()
    })

    test.each(['', 'unknown', 'invalid-version'])(
        'keeps an unsupported current version %s unavailable',
        (currentVersion) => {
            expect(harness({ currentVersion }).action('安装')).toBeUndefined()
        },
    )

    test.each(['dev', 'v8.0.23-rc.1', 'invalid-version'])(
        'rejects the unsupported installation target %s',
        (targetVersion) => {
            expect(harness({ targetVersion }).action('安装')).toBeUndefined()
        },
    )

    test.each([
                  ['v8.0.22-aug.1', '升级', 'primary'],
                  ['v8.0.24-aug.1', '降级', 'danger'],
              ])('retains semantic-version actions for %s', (currentVersion, label, variant) => {
        const view = harness({ currentVersion })
        expect(view.action(label)?.variant).toBe(variant)
        expect(view.action('安装')).toBeUndefined()
    })

    test('keeps the current release without an installation action', () => {
        const view = harness({ currentVersion: 'v8.0.23-aug.2' })
        expect(view.action('安装')).toBeUndefined()
        expect(view.action('升级')).toBeUndefined()
        expect(view.action('降级')).toBeUndefined()
    })

    test('retries an unconfirmed result by reading status without submitting an installation', async () => {
        const view = harness({ pollError: 'HTTP 502' })
        expect(view.markup).toContain('更新结果待确认')
        expect(view.markup).not.toContain('更新失败')
        expect(view.action('安装')?.disabled).toBe(true)
        await view.action('重新查询')?.onClick?.()
        expect(view.states[7]).toBe(true)
        expect(view.trigger).not.toHaveBeenCalled()
        expect(view.panelUpdate).not.toHaveBeenCalled()
    })

    test('shows reconnection instead of an installation failure during a temporary outage', () => {
        const view = harness({ pollError: 'HTTP 502', pollingReady: true })
        expect(view.markup).toContain('正在恢复连接')
        expect(view.markup).not.toContain('更新失败')
        expect(view.action('重新查询')).toBeUndefined()
        expect(view.action('安装')?.disabled).toBe(true)
    })

    test.each([
                  {
                      open: true,
                      target: 'cpa',
                      previousView: { open: true, target: 'cpa', authGeneration: 0 },
                      authGeneration: 1,
                      ready: true,
                  },
                  { open: false, target: 'cpa', previousView: { open: true, target: 'cpa' }, ready: false },
                  { open: true, target: 'cpa', previousView: { open: false, target: 'cpa' }, ready: true },
                  { open: true, target: 'cpa', previousView: { open: true, target: 'panel' }, ready: true },
                  { open: true, target: 'panel', previousView: { open: true, target: 'cpa' }, ready: false },
              ] as const)('resets the visible update state for %j', ({ ready, ...options }) => {
        const view = harness({
                                 ...options, pollError: 'HTTP 502', updateStatus: {
                status: 'replacing', message: 'Restarting', target_version: 'v8.0.23-aug.3',
                current_version: 'dev', percent: 80,
            },
                             })
        expect(view.states[4]).toBeNull()
        expect(view.states[5]).toBeNull()
        expect(view.states[7]).toBe(ready)
        expect(view.states[8]).toBeNull()
        expect(view.trigger).not.toHaveBeenCalled()
    })
})

describe('release compatibility statements', () => {
    const extractBreakingHints   = helpers.extractBreakingHints as (body: string) => string[]
    const collectBreakingBetween = helpers.collectBreakingBetween as (
        releases: unknown[],
        current: string,
        target: string,
    ) => string[]

    test.each([
                  'Database schemas remain management 4 and usage 9; this patch adds no schema migration',
                  'No migration required',
                  'No breaking changes',
                  'This release works without a migration',
                  'This release works without database migration',
                  'This patch does not require a schema migration',
                  'This patch doesn\'t introduce a database migration',
                  'Schema migration is not required',
                  'Migration not needed',
                  'Non-breaking fixes',
                  'The API is not incompatible',
                  'No incompatibilities',
                  '无不兼容变更',
                  '沒有不相容變更',
                  '### No breaking changes\n- Keep current endpoints',
                  '### Breaking changes\n- This release works without a migration',
              ])('does not mark a negated statement as breaking: %s', (body) => {
        expect(extractBreakingHints(body)).toEqual([])
        expect(harness({ releaseBody: body }).markup).not.toContain('class="breakingBadge"')
    })

    test.each([
                  'Breaking change: the old API was removed',
                  'A schema migration is required',
                  'No migration path from the old database is available',
                  'No migration support is provided for the legacy format',
                  'Migrate the configuration before upgrading',
                  'This version is incompatible with the old client',
                  'No schema migration, but the API is incompatible',
                  'No breaking changes to storage; migrate the legacy configuration manually',
                  '⚠ Review the upgrade requirements',
                  '不兼容变更：移除了旧 API',
                  '不相容變更：移除了舊 API',
                  '### Breaking change: Removed legacy endpoint',
              ])('retains an affirmative warning: %s', (body) => {
        expect(extractBreakingHints(body)).toEqual([body])
        expect(harness({ releaseBody: body }).markup).toContain('不兼容变更')
    })

    test('keeps the parent breaking section active across nested headings', () => {
        const body = [
            '## Breaking changes',
            '- Parent change',
            '### Breaking changes',
            '- Nested change',
            '### Additional guidance',
            '- Continued parent change',
            '## Fixes',
            '- Regular fix',
        ].join('\n')
        expect(extractBreakingHints(body)).toEqual([
                                                       '- Parent change',
                                                       '- Nested change',
                                                       '- Continued parent change',
                                                   ])
    })

    test('uses the same classification for downgrade warnings and preserves the original lines', () => {
        const body     = 'No schema migration\nBreaking change: legacy API removed'
        const releases = [{ tag_name: 'v8.0.23-aug.3', body }]
        expect(collectBreakingBetween(releases, 'v8.0.23-aug.3', 'v8.0.23-aug.2'))
            .toEqual(['Breaking change: legacy API removed'])
        expect(collectBreakingBetween(releases, 'v8.0.23-aug.2', 'v8.0.23-aug.3')).toEqual([])
    })
})

describe('release confirmation contracts', () => {
    const targetVersion = 'v1.26.0-aug.5'
    const body          = publishedReleaseBody(targetVersion)

    test.each([
                  ['v8.0.22-aug.1', true],
                  ['v8.0.23-aug.1', false],
                  ['v8.0.23-aug.5', false],
              ] as const)(
        'uses the complete published chapter to gate panel installation on server %s',
        async (serverVersion, blocked) => {
            expect(body).toStartWith(`## ${targetVersion} - 2026-10-22`)
            expect(body).toContain('The minimum backend version for the management panel remains `8.0.23-aug.1`')
            expect(body).toContain('管理面板的最低后端版本保持 `8.0.23-aug.1`')
            expect(body).toContain('Codex reset eligibility checks require the paired CPA `v8.0.23-aug.5`')
            expect(body).toContain('Full changelog:')
            expect(body).not.toContain('## v1.26.0-aug.4 -')
            const calls: Array<{ method: string; url: string; body: unknown }> = []
            apiClient.setConfig({ apiBase: 'http://release.synthetic.invalid', sessionToken: 'synthetic-release-key' })
            transport.defaults.adapter = async (config) => {
                calls.push({
                               method: config.method ?? '',
                               url: transport.getUri(config),
                               body: JSON.parse(config.data),
                           })
                if (config.method !== 'post' || config.url !== '/panel-update') {
                    throw new Error('Unexpected installation request')
                }
                return {
                    config,
                    data: { status: 'ok', message: 'Synthetic panel update' },
                    headers: {},
                    status: 200,
                    statusText: 'OK',
                }
            }
            const view                 = harness({
                                                     target: 'panel',
                                                     targetVersion,
                                                     serverVersion,
                                                     releaseBody: body,
                                                     api: updateApi,
                                                 })
            const confirmation         = await openInstall(view)
            expect(view.refreshServerVersion).toHaveBeenCalledTimes(1)
            expect(confirmation.confirmDisabled).toBe(blocked)
            const popup = view.confirmationView()
            expect(popup.markup).toContain('v8.0.23-aug.1')
            expect(popup.markup).toContain(serverVersion)
            expect(popup.confirm?.disabled).toBe(blocked)
            expect(calls).toEqual([])
            await popup.confirm?.onClick?.()
            if (blocked) {
                expect(calls).toEqual([])
                expect(popup.hide).not.toHaveBeenCalled()
                expect(view.showNotification).not.toHaveBeenCalled()
                expect(view.addPersistentNotification).not.toHaveBeenCalled()
            } else {
                expect(calls).toEqual([
                                          {
                                              method: 'post',
                                              url: 'http://release.synthetic.invalid/v0/management/panel-update',
                                              body: { version: targetVersion },
                                          },
                                      ])
                expect(view.states[4]).toMatchObject({ status: 'done', target_version: targetVersion })
                expect(popup.hide).toHaveBeenCalledTimes(1)
                expect(popup.loading.mock.calls).toEqual([[true], [false]])
                expect(view.showNotification).toHaveBeenCalledWith(expect.stringContaining(targetVersion), 'success')
                expect(view.addPersistentNotification).toHaveBeenCalledWith(
                    expect.stringContaining(targetVersion),
                    'success',
                    'release',
                )
            }
        },
    )

    test.each([
                  ['v8.0.23-aug.6', true],
                  ['v8.0.23-aug.7', false],
              ] as const)('checks the aug.7 panel requirement against %s', async (serverVersion, blocked) => {
        const targetVersion = 'v1.26.0-aug.7'
        const body          = publishedReleaseBody(targetVersion)
        const extract       = helpers.extractRequiredServerVersion as (body: string) => string | null
        const lines         = body.split('\n')
        for (const prefix of ['- Required server:', '- 管理面板的最低后端版本为']) {
            expect(extract(lines.find((line) => line.startsWith(prefix)) ?? '')).toBe('v8.0.23-aug.7')
        }
        const view = harness({
            currentVersion: 'v1.26.0-aug.6', target: 'panel', targetVersion, serverVersion, releaseBody: body,
        })
        expect((await openInstall(view, '升级')).confirmDisabled).toBe(blocked)
        const { confirm } = view.confirmationView()
        expect(confirm?.disabled).toBe(blocked)
        await confirm?.onClick?.()
        expect(view.panelUpdate).toHaveBeenCalledTimes(blocked ? 0 : 1)
        if (!blocked) {
            expect(view.panelUpdate).toHaveBeenCalledWith(targetVersion)
        }
    })

    test('recognizes the original Chinese minimum-version statement and legacy Required server formats', () => {
        const extract             = helpers.extractRequiredServerVersion as (body: string) => string | null
        const originalChineseLine = body.split('\n').find((line) => line.startsWith('- 管理面板的最低后端版本保持'))
        expect(originalChineseLine).toBeDefined()
        expect(extract(originalChineseLine!)).toBe('v8.0.23-aug.1')
        for (const legacy of
            [
                'Required server: CLIProxyAPI 8.0.23-aug.1',
                'Required server: `CLIProxyAPI v8.0.23-aug.1`',
                'requires CLIProxyAPI v8.0.23-aug.1',
            ]) {
            expect(extract(legacy)).toBe('v8.0.23-aug.1')
        }
    })

    test('cancels a compatible published panel installation before its request and notifications', async () => {
        const view = harness({ target: 'panel', targetVersion, releaseBody: body })
        await openInstall(view)
        const popup = view.confirmationView()
        await popup.cancel?.onClick?.()
        expect(popup.hide).toHaveBeenCalledTimes(1)
        expect(view.panelUpdate).not.toHaveBeenCalled()
        expect(view.showNotification).not.toHaveBeenCalled()
        expect(view.addPersistentNotification).not.toHaveBeenCalled()
    })

    test.each(['Breaking changes', '不兼容变更', '不相容變更'])(
        'shows concrete %s items in the real downgrade confirmation before HTTP submission',
        async (heading) => {
            const currentVersion = 'v8.0.23-aug.4'
            const targetVersion  = 'v8.0.23-aug.2'
            const details        = ['Remove the legacy /v1/session endpoint', '旧配置字段需要手动转换']
            const breakingBody   = [
                '### Features', '- unrelated feature', `### ${heading}`, `- ${details[0]}`,
                '#### Configuration', `- ${details[1]}`, '- This patch does not require a schema migration',
                '### Fixes', '- unrelated fix',
            ].join('\n')
            const requests: Array<{
                method: string;
                path: string;
                params?: { attempt_id: string };
                body?: { version: string; attempt_id: string }
            }>                   = []
            apiClient.setConfig({ apiBase: 'http://release.synthetic.invalid', sessionToken: 'synthetic-release-key' })
            transport.defaults.adapter = async (config) => {
                const payload = config.data ? JSON.parse(config.data) : undefined
                requests.push({
                                  method: config.method ?? '', path: config.url ?? '', ...(payload ?
                        { body: payload } :
                        {}), ...(config.params ? { params: config.params } : {}),
                              })
                if (config.method === 'get' && config.url === `/update-compatibility?version=${targetVersion}`) {
                    return {
                        config,
                        data: {
                            compatible: true,
                            requires_restart: true,
                            min_panel_version: 'v1.26.0-aug.1',
                            supports_client_attempt_id: true,
                        },
                        headers: {},
                        status: 200,
                        statusText: 'OK',
                    }
                }
                if (config.method === 'post' && config.url === '/update') {
                    return {
                        config,
                        data: { status: 'ok', target_version: payload.version, attempt_id: payload.attempt_id },
                        headers: {},
                        status: 202,
                        statusText: 'Accepted',
                    }
                }
                if (config.method === 'get' && config.url === '/update-status') {
                    return {
                        config,
                        data: {
                            status: 'downloading',
                            target_version: targetVersion,
                            attempt_id: config.params.attempt_id,
                        },
                        headers: {},
                        status: 200,
                        statusText: 'OK',
                    }
                }
                throw new Error('Unexpected installation request')
            }
            const view                 = harness({
                                                     currentVersion, targetVersion, api: updateApi, releaseHistory: [
                    { tag_name: currentVersion, body: breakingBody },
                    { tag_name: targetVersion, body: 'No breaking changes' },
                    { tag_name: 'v8.0.23-aug.1', body: 'Breaking change: excluded legacy release' },
                    { tag_name: 'v8.0.23-aug.5', body: 'Breaking change: excluded future release' },
                ],
                                                 })
            await view.action('降级')?.onClick?.()
            expect(view.confirmations).toHaveLength(1)
            expect(view.confirmations[0].confirmDisabled).toBe(false)
            const popup = view.confirmationView()
            expect(popup.confirm?.variant).toBe('danger')
            for (const detail of details) {
                expect(popup.markup).toContain(detail)
            }
            for (const excluded of
                [
                    'unrelated feature',
                    'unrelated fix',
                    'does not require a schema migration',
                    'excluded legacy release',
                    'excluded future release',
                ]) {
                expect(popup.markup).not.toContain(excluded)
            }
            expect(requests).toEqual([{ method: 'get', path: `/update-compatibility?version=${targetVersion}` }])
            await popup.confirm?.onClick?.()
            expect(requests).toEqual([
                                         { method: 'get', path: `/update-compatibility?version=${targetVersion}` },
                                         {
                                             method: 'post',
                                             path: '/update',
                                             body: {
                                                 version: targetVersion,
                                                 attempt_id: expect.stringMatching(/^[a-f0-9]{32}$/),
                                             },
                                         },
                                         {
                                             method: 'get',
                                             path: '/update-status',
                                             params: { attempt_id: requests[1].body!.attempt_id },
                                         },
                                     ])
            expect(view.states[4]).toMatchObject({
                                                     status: 'downloading',
                                                     target_version: targetVersion,
                                                     attempt_id: requests[1].body?.attempt_id,
                                                 })
            expect(view.states[7]).toBe(true)
            expect(view.showNotification).not.toHaveBeenCalled()
            expect(view.addPersistentNotification).not.toHaveBeenCalled()
        },
    )
})
