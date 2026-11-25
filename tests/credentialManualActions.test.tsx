import {buildManualKeyCardItems, type ManualKeyCardItem} from '@/components/credentials/apiKeyStatus'
import {createLatestCredentialsRequestTracker} from '@/components/credentials/credentialsDataLifecycle'
import {createVendorRegistry} from '@/components/credentials/hooks/useVendorRegistry'
import {createProviderEditModalState, resolveProviderEditModalState} from '@/hooks/useProviderEditPresentation'
import {apiKeyAliasApi} from '@/services/api/apiKeys'
import {apiClient} from '@/services/api/client'
import {normalizeConfigResponse} from '@/services/api/transformers'
import {maskApiKey} from '@/utils/format'
import {getErrorMessage} from '@/utils/helpers'
import type {AxiosInstance} from 'axios'
import {expect, mock, test} from 'bun:test'
import React, {type ReactElement} from 'react'
import ts from 'typescript'
import {sourceCallback, sourceExpression, sourceInitializer} from './sourceCallbacks'

const vendorFile = 'components/credentials/VendorSection.tsx'
const pageFile   = 'pages/CredentialsPage.tsx'
const t          = (key: string) => key
const Stub       = () => null

test('the Codex manual configuration button opens the edit route and closes back to the credential list', () => {
    const vendor               = createVendorRegistry({
                                                          Gemini: Stub,
                                                          Claude: Stub,
                                                          Codex: Stub,
                                                          Meta: Stub,
                                                          Vertex: Stub,
                                                          OpenAI: Stub,
                                                          Kimi: Stub,
                                                          Qwen: Stub,
                                                          IFlow: Stub,
                                                          Grok: Stub,
                                                          Devin: Stub,
                                                          Generic: Stub,
                                                      }).find((entry) => entry.id === 'codex')
    const location             = { pathname: '/credentials', key: 'credentials', search: '', hash: '', state: null }
    const createButtonId       = 'provider-edit-codex-new'
    const history: unknown[][] = []
    const navigate             = (...args: unknown[]) => history.push(args)
    const openProviderEditor   = sourceCallback<(route: string, focusId: string) => void>(
        vendorFile, 'openProviderEditor', { navigate, location, createProviderEditModalState },
    )
    const trigger              = sourceExpression<ReactElement<{ onClick: () => void }>>(
        vendorFile,
        (node, tree) => ts.isJsxElement(node) && node.openingElement.tagName.getText(tree) === 'Button' &&
                        node.getText(tree).includes('credentials.manual_config'),
        { React, t, vendor, createButtonId, openProviderEditor, disableControls: false, Button: Stub, IconPlus: Stub },
    )
    trigger.props.onClick()
    const [pathname, options] = history[0] as [string, { state: unknown }]
    const route               = sourceExpression<{ path: string; element: ReactElement }>(
        'router/MainRoutes.tsx',
        (node, tree) => ts.isObjectLiteralExpression(node) &&
                        node.getText(tree).includes('path: \'/credentials/codex/new\''),
        { React, AiProvidersCodexEditPage: Stub },
    )
    expect(pathname).toBe(route.path)
    expect(route.element.type).toBe(Stub)
    const presentation = resolveProviderEditModalState(options.state, pathname)
    expect(presentation).toMatchObject({ backgroundLocation: location, returnFocusId: createButtonId })

    const onBack = sourceCallback<() => void>('hooks/useEditPageNavigation.ts', 'handleBack', {
        navigate, location: { pathname, state: options.state }, fallbackPath: '/credentials',
    })
    const render = sourceCallback<(props: Record<string, unknown>) => ReactElement<{
        onClose: () => void; returnFocusId: string; open: boolean;
    }>>('pages/ProviderEditShell.tsx', 'ProviderPresentationShell', {
        React, useTranslation: () => ({ t }), Modal: Stub, Button: Stub, layoutStyles: {},
    })
    const modal  = render({ presentation, onBack, loading: true, renderPrimaryAction: Stub })
    expect(modal.props.open).toBeTrue()
    expect(modal.props.returnFocusId).toBe(createButtonId)
    modal.props.onClose()
    expect(history[1]).toEqual([-1])
})

test('alias save targets one of two equally masked keys and only publishes a confirmed readback', async () => {
    const [first, second] = ['alias_' + '1'.repeat(32), 'alias_' + '2'.repeat(32)]
    const masked          = 'same...tail'
    const config          = normalizeConfigResponse({
                                                        'openai-compatibility': [
                                                            {
                                                                name: 'Synthetic',
                                                                'base-url': 'https://provider.synthetic.invalid',
                                                                disabled: true,
                                                                'api-key-entries': [
                                                                    { 'api-key': masked, 'alias-ref': first },
                                                                    { 'api-key': masked, 'alias-ref': second },
                                                                ],
                                                            },
                                                        ],
                                                    })
    const items           = buildManualKeyCardItems('openai', config.openaiCompatibility ?? [])
    expect(items.map((item) => [item.apiKey, item.aliasRef, item.disabled, item.authIndex])).toEqual([
                                                                                                         [
                                                                                                             masked,
                                                                                                             first,
                                                                                                             true,
                                                                                                             undefined,
                                                                                                         ],
                                                                                                         [
                                                                                                             masked,
                                                                                                             second,
                                                                                                             true,
                                                                                                             undefined,
                                                                                                         ],
                                                                                                     ])

    type AliasState = { generation: number; values: Record<string, string> }
    let state: AliasState | null = null
    const instance               = (apiClient as unknown as { instance: AxiosInstance }).instance
    const originalAdapter        = instance.defaults.adapter
    apiClient.setConfig({ apiBase: 'https://management.synthetic.invalid', sessionToken: '' })
    const authGeneration                    = apiClient.getAuthGeneration()
    const persisted: Record<string, string> = { [second]: 'Sibling' }
    const writes: Record<string, string>[]  = []
    let rejectSave                          = false
    instance.defaults.adapter               = async (request) => {
        expect(request.url).toBe('/api-key-aliases')
        if (request.method === 'patch') {
            const payload = JSON.parse(String(request.data)) as Record<string, string>
            writes.push(payload)
            expect(payload['key-ref']).toBe(first)
            if (!rejectSave) {
                if (payload.alias) {
                    persisted[first] = payload.alias
                } else {
                    delete persisted[first]
                }
            }
            return { config: request, data: { status: 'ok' }, status: 200, statusText: 'OK', headers: {} }
        }
        expect(request.method).toBe('get')
        expect(request.params).toEqual({ by: 'credential-ref' })
        return {
            config: request, data: { 'aliases-by-ref': { ...persisted } }, status: 200, statusText: 'OK', headers: {},
        }
    }
    const showNotification                  = mock()
    const pageScope                         = {
        authGeneration, connectionStatus: 'connected', apiClient, apiKeyAliasApi, getErrorMessage, t, showNotification,
        aliasRequests: { current: createLatestCredentialsRequestTracker() }, pendingAliasSaves: { current: new Set() },
        setAliasState: (next: AliasState | ((previous: AliasState | null) => AliasState)) => {
            state = typeof next === 'function' ? next(state) : next
        },
    }
    const refreshAliases                    = sourceCallback<() => Promise<void>>(pageFile, 'refreshAliases', pageScope)
    const onAliasChange                     = sourceCallback<(ref: string, alias: string) => Promise<boolean>>(
        pageFile, 'handleAliasChange', pageScope,
    )
    const renderCard                        = (item: ManualKeyCardItem) => {
        const aliasFor = sourceCallback<(row: ManualKeyCardItem) => string | undefined>(vendorFile, 'aliasFor', {
            aliases: state?.values ?? {},
        })
        return sourceInitializer<(row: ManualKeyCardItem) => ReactElement<{
            title: string; alias?: string; onAliasChange: (alias: string) => Promise<boolean>;
        }>>(vendorFile, 'renderApiKeyCard', {
            React, vendor: { id: 'openai', label: 'OpenAI' }, t,
            resolveRuntimeState: () => ({ status: 'disabled' }), resolveUsageError: () => undefined,
            providerEditTriggerId: () => 'synthetic-trigger', highlightMatch: (text: string) => text,
            authIndexUsageStats: {}, authIndexTimeSeries: {}, authIndexUsageWindow: undefined,
            disableControls: false, deleteApiKey: Stub, CredentialCard: Stub,
            aliasFor, onAliasChange, maskApiKey,
        })(item).props
    }

    const saveAlias = async (item: ManualKeyCardItem, aliasInput: string) => {
        const cardFile                 = 'components/credentials/CredentialCard.tsx'
        const { alias, onAliasChange } = renderCard(item)
        const setAliasInput            = mock()
        const setEditingAlias          = mock()
        const setSavingAlias           = mock()
        sourceCallback<() => void>(cardFile, 'handleAliasEditStart', { alias, setAliasInput, setEditingAlias })()
        expect(setAliasInput).toHaveBeenCalledWith(alias ?? '')
        expect(setEditingAlias).toHaveBeenCalledWith(true)
        const scope                  = {
            alias,
            aliasInput,
            disableControls: false,
            savingAlias: false,
            setEditingAlias,
            setSavingAlias,
        }
        const handleAliasEditConfirm = sourceCallback<(event: { preventDefault: () => void }) => Promise<void>>(
            cardFile, 'handleAliasEditConfirm', { ...scope, onAliasChange },
        )
        const form                   = sourceExpression<ReactElement<{ onSubmit: typeof handleAliasEditConfirm }>>(
            cardFile,
            (node, tree) => ts.isJsxElement(node) && node.openingElement.tagName.getText(tree) === 'form' &&
                            node.getText(tree).includes('onSubmit={handleAliasEditConfirm}'),
            { ...scope, React, t, setAliasInput, handleAliasEditConfirm, styles: {}, Button: Stub },
        )
        const preventDefault         = mock()
        await form.props.onSubmit({ preventDefault })
        expect(preventDefault).toHaveBeenCalled()
        expect(setSavingAlias.mock.calls).toEqual([[true], [false]])
        return setEditingAlias.mock.calls.some(([editing]) => editing === false)
    }

    try {
        await refreshAliases()
        expect(renderCard(items[1]).title).toBe('Sibling')
        expect(await saveAlias(items[0], 'Primary')).toBeTrue()
        expect(writes).toEqual([{ 'key-ref': first, alias: 'Primary' }])
        expect(renderCard(items[0])).toMatchObject({ title: 'Primary', alias: 'Primary' })
        expect(renderCard(items[1]).title).toBe('Sibling')

        rejectSave = true
        expect(await saveAlias(items[0], 'Unconfirmed')).toBeFalse()
        expect(showNotification).toHaveBeenCalledWith(expect.stringContaining('credentials.alias_save_failed'), 'error')
        expect(renderCard(items[0]).title).toBe('Primary')

        state = null
        await refreshAliases()
        expect(renderCard(items[0]).title).toBe('Primary')
        expect(renderCard(items[1]).title).toBe('Sibling')
        rejectSave = false
        expect(await saveAlias(items[0], '')).toBeTrue()
        expect(renderCard(items[0]).title).toBe(maskApiKey(masked))
        expect(renderCard(items[1]).title).toBe('Sibling')
    } finally {
        instance.defaults.adapter = originalAdapter
        apiClient.setConfig({ apiBase: '', sessionToken: '' })
    }
})
