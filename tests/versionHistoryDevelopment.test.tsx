import {describe, expect, mock, test} from 'bun:test'
import {readFileSync} from 'node:fs'
import type {ReactElement, ReactNode} from 'react'
import {Children, createElement, Fragment} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {sourceCallback, sourceInitializer} from './sourceCallbacks'

const file = 'components/system/VersionHistoryModal.tsx'
const helpers: Record<string, unknown> = {}
for (const name of [
    'OFFICIAL_REPOSITORIES', 'BREAKING_PATTERN', 'COMPATIBILITY_PATTERN', 'FEATURE_SECTION_PATTERN',
    'FIX_SECTION_PATTERN', 'PAGE_SIZE', 'UPDATE_POLL_INTERVAL', 'UPDATE_POLL_FAILURE_LIMIT',
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
}: {
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
    const body = target === 'panel' ? 'Required server: CLIProxyAPI 8.0.23-aug.1' : ''
    const releases = [{tag_name: targetVersion, body, published_at: '2026-10-20T05:44:38Z', draft: false}]
    const states: unknown[] = [releases, false, null, 0, null, null, checkingVersion ? targetVersion : null, false, true]
    const compatibility = mock(async () => {
        if (compatibilityError) {
            throw new Error('compatibility unavailable')
        }
        return {
            compatible, requires_restart: true, current_version: currentVersion,
            min_panel_version: '1.15.3-aug.1', warnings: [],
        }
    })
    const trigger = mock(async () => undefined)
    const panelUpdate = mock(async () => undefined)
    const showNotification = mock(() => undefined)
    const auth = {serverVersion, refreshServerVersion: async () => undefined}
    const useAuthStore = Object.assign((select: (value: typeof auth) => unknown) => select(auth), {
        getState: () => auth,
    })
    const component = sourceCallback<(props: Record<string, unknown>) => ReactElement>(file, 'VersionHistoryModal', {
        ...helpers,
        React: {createElement, Fragment},
        useState: () => [states.shift(), () => undefined],
        useMemo: (callback: () => unknown) => callback(),
        useCallback: (callback: unknown) => callback,
        useEffect: () => undefined,
        useTranslation: () => ({t, i18n: {language: locale}}),
        useNotificationStore: () => ({showNotification, showConfirmation: (value: Confirmation) => confirmations.push(value)}),
        useAuthStore,
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
    const markup = renderToStaticMarkup(component({open: true, onClose: () => undefined, currentVersion, target}))
    const action = (label: string) => buttons.find((button) => Children.toArray(button.children).includes(label))
    return {markup, action, confirmations, compatibility, trigger, panelUpdate, showNotification, targetVersion}
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
        expect(view.trigger).toHaveBeenCalledWith(view.targetVersion)
        expect(view.panelUpdate).not.toHaveBeenCalled()
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
})
