import {describe, expect, mock, test} from 'bun:test'
import {readFileSync} from 'node:fs'
import type {ReactElement, ReactNode} from 'react'
import {Children, createElement, Fragment} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import type {UpdateStatus} from '../src/services/api/update'
import {sourceCallback, sourceInitializer} from './sourceCallbacks'

const file = 'components/system/VersionHistoryModal.tsx'
const helpers: Record<string, unknown> = {}
for (const name of [
    'OFFICIAL_REPOSITORIES', 'BREAKING_PATTERN', 'NON_BREAKING_PATTERN', 'COMPATIBILITY_PATTERN', 'FEATURE_SECTION_PATTERN',
    'FIX_SECTION_PATTERN', 'PAGE_SIZE', 'UPDATE_POLL_INTERVAL', 'UPDATE_POLL_RECONNECT_TIMEOUT',
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

const installLabels = {en: 'Install', 'zh-CN': '安装', 'zh-TW': '安裝', ru: 'Установить'}
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
    previousView = {open, target},
    authGeneration = 0,
    supportsClientAttemptID = true,
}: {
    supportsClientAttemptID?: boolean | null
    authGeneration?: number
    open?: boolean
    previousView?: {open: boolean; target: 'cpa' | 'panel'; authGeneration?: number}
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
    const dictionary = JSON.parse(readFileSync(new URL(`../src/i18n/locales/${locale}.json`, import.meta.url), 'utf8'))
    const t = (key: string, values: Record<string, unknown> = {}) => {
        const [group, entry] = key.split('.')
        const text = String(dictionary[group]?.[entry] ?? values.defaultValue ?? key)
        return text.replace(/\{\{(\w+)\}\}/g, (_match, field: string) => String(values[field] ?? ''))
    }
    const buttons: ButtonProps[] = []
    const confirmations: Confirmation[] = []
    const body = releaseBody ?? (target === 'panel' ? 'Required server: CLIProxyAPI 8.0.23-aug.1' : '')
    const releases = [{tag_name: targetVersion, body, published_at: '2026-10-20T05:44:38Z', draft: false}]
    let generation = authGeneration
    const states: unknown[] = [releases, false, null, 0, updateStatus, null, checkingVersion ? targetVersion : null, pollingReady, pollError, {authGeneration: 0, ...previousView}]
    let stateIndex = 0
    let refIndex = 0
    const refs: {current: unknown}[] = []
    let unmountCleanup: (() => void) | undefined
    const compatibility = mock(async () => {
        if (compatibilityError) {
            throw new Error('compatibility unavailable')
        }
        return {
            compatible, requires_restart: true, current_version: currentVersion,
            min_panel_version: '1.15.3-aug.1', warnings: [],
            ...(supportsClientAttemptID === null ? {} : {supports_client_attempt_id: supportsClientAttemptID}),
        }
    })
    const trigger = mock(async (version: string, attemptID: string) => ({attempt_id: attemptID, target_version: version}))
    const panelUpdate = mock(async () => undefined)
    const showNotification = mock(() => undefined)
    const auth = {serverVersion, refreshServerVersion: async () => undefined}
    const useAuthStore = Object.assign((select: (value: typeof auth) => unknown) => select(auth), {
        getState: () => auth,
    })
    const component = sourceCallback<(props: Record<string, unknown>) => ReactElement>(file, 'VersionHistoryModal', {
        ...helpers,
        React: {createElement, Fragment},
        useState: () => {
            const index = stateIndex++
            return [states[index], (next: unknown) => {
                states[index] = typeof next === 'function' ? next(states[index]) : next
            }]
        },
        useRef: (value: unknown) => refs[refIndex++] ?? (refs[refIndex - 1] = {current: value}),
        useMemo: (callback: () => unknown) => callback(),
        useCallback: (callback: unknown) => callback,
        useEffect: (callback: () => (() => void) | void, dependencies: unknown[]) => {
            if (dependencies.length === 0) {
                unmountCleanup = callback() ?? undefined
            }
        },
        useTranslation: () => ({t, i18n: {language: locale}}),
        useNotificationStore: () => ({showNotification, showConfirmation: (value: Confirmation) => confirmations.push(value)}),
        useAuthStore,
        apiClient: {getAuthGeneration: () => generation},
        updateApi: {compatibility, trigger, panelUpdate},
        releasesApi: {list: mock(async () => ({releases}))},
        formatDate: (value: string) => value,
        safeExternalUrl: () => null,
        styles: new Proxy({}, {get: (_object, key) => String(key)}),
        Modal: ({children}: {children: ReactNode}) => createElement('div', {role: 'dialog'}, children),
        Button: (props: ButtonProps) => {
            buttons.push(props)
            return createElement('button', {disabled: props.disabled, onClick: props.onClick}, props.children)
        },
        IconDownload: () => null,
        IconExternalLink: () => null,
        IconChevronLeft: () => null,
        __APP_VERSION__: 'v1.26.0-aug.2',
    })
    const props = {open, onClose: () => undefined, currentVersion, target}
    const render = (next: Partial<typeof props> = {}) => {
        Object.assign(props, next)
        buttons.length = 0
        stateIndex = 0
        refIndex = 0
        component(props)
        stateIndex = 0
        refIndex = 0
        return renderToStaticMarkup(component(props))
    }
    const markup = render()
    const action = (label: string) => buttons.find((button) => Children.toArray(button.children).includes(label))
    return {markup, action, confirmations, compatibility, trigger, panelUpdate, showNotification, targetVersion, states, render,
        changeConnection: () => { ++generation }, closeView: () => { render({open: false}) }, unmount: () => unmountCleanup?.()}
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
    test.each(Object.keys(installLabels) as Locale[])('renders the install action and development warning in %s', async (locale) => {
        const view = harness({locale})
        const confirmation = await openInstall(view, installLabels[locale])
        expect(confirmation.title).toBe(installLabels[locale])
        expect(confirmation.confirmText).toContain(view.targetVersion)
        expect(renderToStaticMarkup(createElement('div', null, confirmation.message))).toContain('dev')
        expect(view.trigger).not.toHaveBeenCalled()
        expect(view.panelUpdate).not.toHaveBeenCalled()
    })

    test.each(['dev', ' DEV '])('installs a release from %s only after compatibility and confirmation', async (currentVersion) => {
        const view = harness({currentVersion})
        const confirmation = await openInstall(view)
        expect(view.compatibility).toHaveBeenCalledTimes(1)
        expect(view.compatibility).toHaveBeenCalledWith(view.targetVersion)
        expect(confirmation.confirmDisabled).toBe(false)
        expect(view.trigger).not.toHaveBeenCalled()
        await confirmation.onConfirm()
        expect(view.trigger).toHaveBeenCalledTimes(1)
        expect(view.trigger).toHaveBeenCalledWith(view.targetVersion, expect.stringMatching(/^[a-f0-9]{32}$/))
        expect(view.panelUpdate).not.toHaveBeenCalled()
    })

    test.each(['cpa', 'panel'] as const)('does not submit an old %s confirmation after the connection changes', async (target) => {
        const view = harness({target})
        const confirmation = await openInstall(view)
        view.changeConnection()
        await confirmation.onConfirm()
        expect(view.trigger).not.toHaveBeenCalled()
        expect(view.panelUpdate).not.toHaveBeenCalled()
    })

    test('does not start polling from an installation response belonging to an old connection', async () => {
        const view = harness()
        const confirmation = await openInstall(view)
        let resolve!: (value: {attempt_id: string; target_version: string}) => void
        const pending = new Promise<{attempt_id: string; target_version: string}>((complete) => { resolve = complete })
        view.trigger.mockImplementationOnce(() => pending)
        const submission = confirmation.onConfirm()
        view.changeConnection()
        resolve({attempt_id: 'previous-connection', target_version: view.targetVersion})
        await submission
        expect(view.states[7]).toBe(false)
        expect(view.showNotification).not.toHaveBeenCalled()
    })

    test.each([new Error('Connection closed'), Object.assign(new Error('HTTP 502'), {status: 502})])(
        'queries an uncertain initial submission without resubmitting it: %s', async (error) => {
            const view = harness()
            const confirmation = await openInstall(view)
            view.trigger.mockRejectedValueOnce(error)
            await confirmation.onConfirm()
            expect(view.trigger).toHaveBeenCalledTimes(1)
            expect(view.states[4]).toMatchObject({status: 'downloading', attempt_id: expect.stringMatching(/^[a-f0-9]{32}$/)})
            expect(view.states[5]).toBe(view.targetVersion)
            expect(view.states[7]).toBe(true)
            expect(view.states[8]).toBe(error.message)
            expect(view.showNotification).not.toHaveBeenCalled()
        },
    )

    test.each([null, false])('binds a valid acknowledgement from an old server with capability %s', async (supportsClientAttemptID) => {
        const view = harness({supportsClientAttemptID})
        const confirmation = await openInstall(view)
        const serverAttempt = 'f'.repeat(32)
        view.trigger.mockResolvedValueOnce({attempt_id: serverAttempt, target_version: view.targetVersion})
        await confirmation.onConfirm()
        expect(view.states[4]).toMatchObject({attempt_id: serverAttempt, target_version: view.targetVersion})
        expect(view.states[7]).toBe(true)
        expect(view.states[8]).toBeNull()
        expect(view.trigger).toHaveBeenCalledTimes(1)
    })

    test.each(['', 'invalid', 'A'.repeat(32), undefined])('does not bind an invalid old-server attempt %s', async (attemptID) => {
        const view = harness({supportsClientAttemptID: null})
        const confirmation = await openInstall(view)
        view.trigger.mockResolvedValueOnce({attempt_id: attemptID as string, target_version: view.targetVersion})
        await confirmation.onConfirm()
        expect(view.states[4]).toMatchObject({attempt_id: expect.stringMatching(/^[a-f0-9]{32}$/)})
        expect((view.states[4] as UpdateStatus).attempt_id).not.toBe(attemptID)
        expect(view.states[8]).toBeTruthy()
        expect(view.trigger).toHaveBeenCalledTimes(1)
    })

    test('does not bind an old-server acknowledgement for another version', async () => {
        const view = harness({supportsClientAttemptID: null})
        const confirmation = await openInstall(view)
        view.trigger.mockResolvedValueOnce({attempt_id: 'f'.repeat(32), target_version: 'v8.0.23-aug.1'})
        await confirmation.onConfirm()
        expect((view.states[4] as UpdateStatus).attempt_id).not.toBe('f'.repeat(32))
        expect(view.states[8]).toBeTruthy()
    })

    test('keeps a mismatched acknowledgement unconfirmed and queries only its requested attempt', async () => {
        const view = harness()
        const confirmation = await openInstall(view)
        view.trigger.mockResolvedValueOnce({attempt_id: 'f'.repeat(32), target_version: view.targetVersion})
        await confirmation.onConfirm()
        expect(view.states[4]).toMatchObject({status: 'downloading', attempt_id: expect.stringMatching(/^[a-f0-9]{32}$/)})
        expect(view.states[7]).toBe(true)
        expect(view.states[8]).toBeTruthy()
        expect(view.showNotification).not.toHaveBeenCalled()
        expect(view.trigger).toHaveBeenCalledTimes(1)
    })

    test('reports an explicit rejection without querying or repeating the installation', async () => {
        const view = harness()
        const confirmation = await openInstall(view)
        view.trigger.mockRejectedValueOnce(Object.assign(new Error('Incompatible'), {status: 409}))
        await confirmation.onConfirm()
        expect(view.states[4]).toMatchObject({status: 'error', message: 'Incompatible'})
        expect(view.states[7]).toBe(false)
        expect(view.states[5]).toBeNull()
        expect(view.showNotification).toHaveBeenCalledWith('Incompatible', 'error')
        expect(view.trigger).toHaveBeenCalledTimes(1)
    })

    test('ignores a late installation rejection after its view has closed', async () => {
        const view = harness()
        const confirmation = await openInstall(view)
        let reject!: (error: Error) => void
        view.trigger.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail }))
        const submitting = confirmation.onConfirm()
        view.closeView()
        reject(Object.assign(new Error('Late rejection'), {status: 409}))
        await submitting
        expect(view.states[4]).toBeNull()
        expect(view.showNotification).not.toHaveBeenCalled()
        view.render({open: true})
        expect(view.states[4]).toMatchObject({status: 'error', message: 'Late rejection'})
        expect(view.trigger).toHaveBeenCalledTimes(1)
    })

    test.each([null, true])('keeps a lost acknowledgement associated across close and reopen with capability %s', async (supportsClientAttemptID) => {
        const view = harness({supportsClientAttemptID})
        const confirmation = await openInstall(view)
        view.trigger.mockRejectedValueOnce(new Error('Connection closed'))
        await confirmation.onConfirm()
        const pending = {...view.states[4] as UpdateStatus}
        view.closeView()
        view.render({open: true})
        expect(view.states[4]).toEqual(pending)
        expect(view.states[5]).toBe(view.targetVersion)
        expect(view.states[7]).toBe(true)
        expect(view.states[8]).toBe('Connection closed')
        expect(view.trigger).toHaveBeenCalledTimes(1)
    })

    test.each([false, true])('adopts a late old-server acknowledgement when reopened first: %s', async (reopenBeforeAck) => {
        const view = harness({supportsClientAttemptID: null})
        const confirmation = await openInstall(view)
        let resolve!: (value: {attempt_id: string; target_version: string}) => void
        view.trigger.mockImplementationOnce(() => new Promise((complete) => { resolve = complete }))
        const submitting = confirmation.onConfirm()
        view.closeView()
        if (reopenBeforeAck) {
            view.render({open: true})
        }
        resolve({attempt_id: 'f'.repeat(32), target_version: view.targetVersion})
        await submitting
        view.render({open: true})
        expect(view.states[4]).toMatchObject({attempt_id: 'f'.repeat(32), target_version: view.targetVersion})
        expect(view.states[7]).toBe(true)
        expect(view.states[8]).toBeNull()
        expect(view.showNotification).not.toHaveBeenCalled()
        expect(view.trigger).toHaveBeenCalledTimes(1)
    })

    test('retains the backend attempt while another version history is visible', async () => {
        const view = harness({supportsClientAttemptID: null})
        const confirmation = await openInstall(view)
        let resolve!: (value: {attempt_id: string; target_version: string}) => void
        view.trigger.mockImplementationOnce(() => new Promise((complete) => { resolve = complete }))
        const submitting = confirmation.onConfirm()
        view.render({target: 'panel'})
        resolve({attempt_id: 'f'.repeat(32), target_version: view.targetVersion})
        await submitting
        expect(view.states[4]).toBeNull()
        expect(view.states[7]).toBe(false)
        view.render({target: 'cpa'})
        expect(view.states[4]).toMatchObject({attempt_id: 'f'.repeat(32)})
        expect(view.states[7]).toBe(true)
    })

    test('ignores an installation rejection after the component unmounts', async () => {
        const view = harness()
        const confirmation = await openInstall(view)
        let reject!: (error: Error) => void
        view.trigger.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail }))
        const submitting = confirmation.onConfirm()
        view.unmount()
        reject(Object.assign(new Error('Late rejection'), {status: 409}))
        await submitting
        expect(view.states[4]).toMatchObject({status: 'downloading'})
        expect(view.showNotification).not.toHaveBeenCalled()
        expect(view.trigger).toHaveBeenCalledTimes(1)
    })

    test('clears retained attempt identity when the connection changes', async () => {
        const view = harness()
        const confirmation = await openInstall(view)
        await confirmation.onConfirm()
        view.closeView()
        view.changeConnection()
        view.render({open: true})
        expect(view.states[4]).toBeNull()
        expect(view.states[5]).toBeNull()
        expect(view.states[8]).toBeNull()
        expect(view.trigger).toHaveBeenCalledTimes(1)
    })

    test('submits at most one installation while its acknowledgement is pending', async () => {
        const view = harness()
        const confirmation = await openInstall(view)
        let resolve!: (value: {attempt_id: string; target_version: string}) => void
        view.trigger.mockImplementationOnce(() => new Promise((complete) => { resolve = complete }))
        const submitting = confirmation.onConfirm()
        await confirmation.onConfirm()
        expect(view.trigger).toHaveBeenCalledTimes(1)
        const [version, attemptID] = view.trigger.mock.calls[0]!
        resolve({attempt_id: attemptID, target_version: version})
        await submitting
    })

    test('keeps an incompatible backend installation disabled', async () => {
        const view = harness({compatible: false})
        const confirmation = await openInstall(view)
        expect(confirmation.confirmDisabled).toBe(true)
        expect(renderToStaticMarkup(createElement('div', null, confirmation.message))).toContain('不满足')
        expect(view.trigger).not.toHaveBeenCalled()
    })

    test('reports a failed compatibility check without starting an installation', async () => {
        const view = harness({compatibilityError: true})
        await view.action('安装')?.onClick?.()
        expect(view.compatibility).toHaveBeenCalledTimes(1)
        expect(view.compatibility).toHaveBeenCalledWith(view.targetVersion)
        expect(view.confirmations).toHaveLength(0)
        expect(view.trigger).not.toHaveBeenCalled()
        expect(view.showNotification).toHaveBeenCalledTimes(1)
        expect(view.showNotification).toHaveBeenCalledWith('compatibility unavailable', 'error')
    })

    test('updates a development panel through the existing panel endpoint', async () => {
        const view = harness({target: 'panel'})
        const confirmation = await openInstall(view)
        expect(view.compatibility).not.toHaveBeenCalled()
        expect(view.panelUpdate).not.toHaveBeenCalled()
        await confirmation.onConfirm()
        expect(view.panelUpdate).toHaveBeenCalledTimes(1)
        expect(view.panelUpdate).toHaveBeenCalledWith(view.targetVersion)
        expect(view.trigger).not.toHaveBeenCalled()
    })

    test('keeps a development panel installation blocked by its backend requirement', async () => {
        const view = harness({target: 'panel', serverVersion: 'v7.3.2-aug.1'})
        const confirmation = await openInstall(view)
        expect(confirmation.confirmDisabled).toBe(true)
        expect(view.panelUpdate).not.toHaveBeenCalled()
    })

    test('keeps installation unavailable while a compatibility check is in progress', async () => {
        const view = harness({checkingVersion: true})
        expect(view.action('安装')?.disabled).toBe(true)
        await view.action('安装')?.onClick?.()
        expect(view.compatibility).not.toHaveBeenCalled()
        expect(view.confirmations).toHaveLength(0)
        expect(view.trigger).not.toHaveBeenCalled()
    })

    test.each(['', 'unknown', 'invalid-version'])('keeps an unsupported current version %s unavailable', (currentVersion) => {
        expect(harness({currentVersion}).action('安装')).toBeUndefined()
    })

    test.each(['dev', 'v8.0.23-rc.1', 'invalid-version'])('rejects the unsupported installation target %s', (targetVersion) => {
        expect(harness({targetVersion}).action('安装')).toBeUndefined()
    })

    test.each([
        ['v8.0.22-aug.1', '升级', 'primary'],
        ['v8.0.24-aug.1', '降级', 'danger'],
    ])('retains semantic-version actions for %s', (currentVersion, label, variant) => {
        const view = harness({currentVersion})
        expect(view.action(label)?.variant).toBe(variant)
        expect(view.action('安装')).toBeUndefined()
    })

    test('keeps the current release without an installation action', () => {
        const view = harness({currentVersion: 'v8.0.23-aug.2'})
        expect(view.action('安装')).toBeUndefined()
        expect(view.action('升级')).toBeUndefined()
        expect(view.action('降级')).toBeUndefined()
    })

    test('retries an unconfirmed result by reading status without submitting an installation', async () => {
        const view = harness({pollError: 'HTTP 502'})
        expect(view.markup).toContain('更新结果待确认')
        expect(view.markup).not.toContain('更新失败')
        expect(view.action('安装')?.disabled).toBe(true)
        await view.action('重新查询')?.onClick?.()
        expect(view.states[7]).toBe(true)
        expect(view.trigger).not.toHaveBeenCalled()
        expect(view.panelUpdate).not.toHaveBeenCalled()
    })

    test('shows reconnection instead of an installation failure during a temporary outage', () => {
        const view = harness({pollError: 'HTTP 502', pollingReady: true})
        expect(view.markup).toContain('正在恢复连接')
        expect(view.markup).not.toContain('更新失败')
        expect(view.action('重新查询')).toBeUndefined()
        expect(view.action('安装')?.disabled).toBe(true)
    })

    test.each([
        {open: true, target: 'cpa', previousView: {open: true, target: 'cpa', authGeneration: 0}, authGeneration: 1, ready: true},
        {open: false, target: 'cpa', previousView: {open: true, target: 'cpa'}, ready: false},
        {open: true, target: 'cpa', previousView: {open: false, target: 'cpa'}, ready: true},
        {open: true, target: 'cpa', previousView: {open: true, target: 'panel'}, ready: true},
        {open: true, target: 'panel', previousView: {open: true, target: 'cpa'}, ready: false},
    ] as const)('resets the visible update state for %j', ({ready, ...options}) => {
        const view = harness({...options, pollError: 'HTTP 502', updateStatus: {
            status: 'replacing', message: 'Restarting', target_version: 'v8.0.23-aug.3',
            current_version: 'dev', percent: 80,
        }})
        expect(view.states[4]).toBeNull()
        expect(view.states[5]).toBeNull()
        expect(view.states[7]).toBe(ready)
        expect(view.states[8]).toBeNull()
        expect(view.trigger).not.toHaveBeenCalled()
    })
})

describe('release compatibility statements', () => {
    const extractBreakingHints = helpers.extractBreakingHints as (body: string) => string[]
    const collectBreakingBetween = helpers.collectBreakingBetween as (releases: unknown[], current: string, target: string) => string[]

    test.each([
        'Database schemas remain management 4 and usage 9; this patch adds no schema migration',
        'No migration required',
        'No breaking changes',
        'This release works without a migration',
        'This release works without database migration',
        'This patch does not require a schema migration',
        "This patch doesn't introduce a database migration",
        'Schema migration is not required',
        'Migration not needed',
        'Non-breaking fixes',
        'The API is not incompatible',
        'No incompatibilities',
    ])('does not mark a negated statement as breaking: %s', (body) => {
        expect(extractBreakingHints(body)).toEqual([])
        expect(harness({releaseBody: body}).markup).not.toContain('不兼容变更')
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
    ])('retains an affirmative warning: %s', (body) => {
        expect(extractBreakingHints(body)).toEqual([body])
        expect(harness({releaseBody: body}).markup).toContain('不兼容变更')
    })

    test('uses the same classification for downgrade warnings and preserves the original lines', () => {
        const body = 'No schema migration\nBreaking change: legacy API removed'
        const releases = [{tag_name: 'v8.0.23-aug.3', body}]
        expect(collectBreakingBetween(releases, 'v8.0.23-aug.3', 'v8.0.23-aug.2')).toEqual(['Breaking change: legacy API removed'])
        expect(collectBreakingBetween(releases, 'v8.0.23-aug.2', 'v8.0.23-aug.3')).toEqual([])
    })
})
