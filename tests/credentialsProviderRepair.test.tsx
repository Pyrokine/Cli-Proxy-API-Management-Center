import {
    apiKeyMatchesStatus,
    buildManualKeyCardItems,
    type ManualKeyCardItem,
} from '@/components/credentials/apiKeyStatus'
import {createOAuthAttempts} from '@/components/credentials/oauthAttempts'
import {entriesToModels} from '@/components/ui/modelInputListUtils'
import {
    getCachedAuthFileModels,
    invalidateAuthFileModelsCache,
    loadAuthFileModels,
} from '@/features/authFiles/authFileModelsCache'
import {authFileSelectionKey} from '@/features/authFiles/identity'
import {authFilesApi, oauthModelAliasEditorApi} from '@/services/api/authFiles'
import {apiClient} from '@/services/api/client'
import {oauthApi} from '@/services/api/oauth'
import {buildVertexConfigPatchRequest, providersApi} from '@/services/api/providers'
import {normalizeConfigResponse} from '@/services/api/transformers'
import type {ProviderKeyConfig} from '@/types'
import type {AuthFileItem} from '@/types/authFile'
import {getRequestScopedErrorsValidationKey} from '@/utils/credentialOverrides'
import {getCredentialWeightValidationKey} from '@/utils/credentialWeight'
import {expect, mock, spyOn, test} from 'bun:test'
import {readFileSync} from 'node:fs'
import React, {type ReactElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import ts from 'typescript'
import {sourceCallback, sourceExpression, sourceInitializer} from './sourceCallbacks'

const t                 = (key: string) => key
const Stub              = () => null
const vendorFile        = 'components/credentials/VendorSection.tsx'
const vendorActionsFile = 'components/credentials/hooks/useVendorActions.ts'
const oauthFile         = 'components/credentials/OAuthLoginAction.tsx'

for (const provider of ['Gemini', 'Interactions', 'Vertex']) {
    test(`${provider} form keeps its draft and sends no edit when the key is empty`, async () => {
        const validateBeforeSave = sourceCallback<(form: { apiKey: string }) => string | undefined>(
            `pages/AiProviders${provider}EditPage.tsx`, 'validateBeforeSave',
            { getCredentialWeightValidationKey, getRequestScopedErrorsValidationKey },
        )
        const form               = { apiKey: '   ' }
        const formToPayload      = mock()
        const updateConfig       = mock()
        const showNotification   = mock()
        const save               = sourceCallback<() => Promise<void>>('hooks/useProviderEditForm.ts', 'handleSave', {
            canSave: true, isCurrent: () => true, t, form,
            configs: [{ apiKey: 'configured-key' }], editIndex: 0,
            config: { validateBeforeSave, formToPayload, updateConfig }, showNotification,
        })
        await save()
        expect(showNotification).toHaveBeenCalledWith('ai_providers.api_key_required', 'error')
        expect(formToPayload).not.toHaveBeenCalled()
        expect(updateConfig).not.toHaveBeenCalled()
        expect(validateBeforeSave({ apiKey: 'configured-key' })).toBeUndefined()
    })
}

test('Vertex uses an explicit default-URL edit and sends name-only models without losing flags', () => {
    const original: ProviderKeyConfig = {
        apiKey: 'masked-key', authIndex: 'synthetic-index', baseUrl: 'https://gateway.example.invalid',
    }
    const next: ProviderKeyConfig     = {
        ...original, baseUrl: '', interactions: false, requestRetry: 0, disableCooling: false,
        models: entriesToModels([
                                    { name: 'name-only', alias: '' }, { name: 'same-name', alias: 'same-name' },
                                    { name: 'upstream', alias: 'mapped', forceMapping: true },
                                ]),
    }
    expect(buildVertexConfigPatchRequest(0, next, original)).toEqual({
                                                                         index: 0,
                                                                         'auth-index': 'synthetic-index',
                                                                         'keep-entry': true,
                                                                         value: {
                                                                             'clear-base-url': true,
                                                                             interactions: false,
                                                                             'disable-cooling': false,
                                                                             'request-retry': 0,
                                                                             models: [
                                                                                 { name: 'name-only' },
                                                                                 { name: 'same-name' },
                                                                                 {
                                                                                     name: 'upstream',
                                                                                     alias: 'mapped',
                                                                                     'force-mapping': true,
                                                                                 },
                                                                             ],
                                                                         },
                                                                     })
})

function renderManualCard(item: ManualKeyCardItem, status: string, deleteApiKey = mock()) {
    const render = sourceInitializer<(value: ManualKeyCardItem) => ReactElement<{
        disabled: boolean; runtimeState: { status: string }; onDelete: () => void;
    }>>(vendorFile, 'renderApiKeyCard', {
        React, item, t, vendor: { id: 'meta', label: 'Meta' }, resolveRuntimeState: () => ({ status }),
        resolveUsageError: Stub, providerEditTriggerId: Stub, aliasFor: Stub, maskApiKey: () => 'Masked',
        highlightMatch: (title: string) => title, onAliasChange: undefined, authIndexUsageStats: {},
        authIndexTimeSeries: {}, authIndexUsageWindow: undefined, manualStatusRequests: new Map(),
        authFileStatusRequestKey: Stub, apiClient, disableControls: false, CredentialCard: Stub,
        deleteApiKey, toggleApiKey: Stub,
    })
    return render(item).props
}

test('Meta deletion confirms the selected route, not the shared key, endpoint or runtime index', async () => {
    const first            = 'entry_' + '1'.repeat(32)
    const second           = 'entry_' + '2'.repeat(32)
    const baseUrl          = 'https://shared.example.invalid'
    const config           = normalizeConfigResponse({
                                                         'meta-api-key': [
                                                             {
                                                                 'api-key': 'same...tail',
                                                                 'base-url': baseUrl,
                                                                 prefix: 'first',
                                                                 'entry-ref': first,
                                                             },
                                                             {
                                                                 'api-key': 'same...tail',
                                                                 'base-url': baseUrl,
                                                                 prefix: 'second',
                                                                 'entry-ref': second,
                                                             },
                                                         ],
                                                         'auth-indexes': { meta: ['shared-runtime', 'shared-runtime'] },
                                                     })
    const selected         = buildManualKeyCardItems('meta', config.metaApiKeys ?? [])[1]!
    const deleteRequest    = spyOn(apiClient, 'delete').mockResolvedValue({ status: 'ok' })
    const showConfirmation = mock<(request: { onConfirm: () => Promise<void> }) => void>()
    const onRefresh        = mock(async () => {
    })
    const API_KEY_DELETERS = sourceInitializer(vendorActionsFile, 'API_KEY_DELETERS', { providersApi })
    const deleteApiKey     = sourceCallback<(id: string, baseUrl?: string, item?: ManualKeyCardItem) => void>(
        vendorActionsFile, 'deleteApiKey', {
            t, vendorId: 'meta', API_KEY_DELETERS, DELETE_CONFIRM_KEYS: {}, showConfirmation,
            apiClient, onRefresh, showNotification: mock(),
        },
    )
    try {
        renderManualCard(selected, 'normal', mock(deleteApiKey)).onDelete()
        expect(deleteRequest).not.toHaveBeenCalled()
        await showConfirmation.mock.calls[0]![0].onConfirm()
        expect(deleteRequest).toHaveBeenCalledWith('/meta-api-key', expect.objectContaining({
                                                                                                data: { 'entry-ref': second },
                                                                                            }))
        expect(onRefresh).toHaveBeenCalledTimes(1)
        await providersApi.deleteMetaConfig('same...tail', baseUrl)
        expect(deleteRequest).toHaveBeenLastCalledWith('/meta-api-key', expect.objectContaining({
                                                                                                    data: {
                                                                                                        'api-key': 'same...tail',
                                                                                                        'base-url': baseUrl,
                                                                                                    },
                                                                                                }))
    } finally {
        deleteRequest.mockRestore()
    }
})

test('the manual key switch and disabled filter use configuration even when inspection disagrees', () => {
    const readKey = (rules: string[]) => {
        const config = normalizeConfigResponse({ 'meta-api-key': [{ 'api-key': 'masked', 'excluded-models': rules }] })
        return buildManualKeyCardItems('meta', config.metaApiKeys ?? [])[0]!
    }
    const stopped = readKey(['*'])
    expect(apiKeyMatchesStatus(stopped, 'disabled')).toBeTrue()
    expect(renderManualCard(stopped, 'normal')).toMatchObject({ disabled: true, runtimeState: { status: 'normal' } })
    const active = readKey(['model-*'])
    expect(apiKeyMatchesStatus(active, 'disabled', { status: 'disabled' })).toBeFalse()
    expect(apiKeyMatchesStatus(active, 'available', { status: 'disabled' })).toBeTrue()
    expect(renderManualCard(active, 'disabled')).toMatchObject({
                                                                   disabled: false,
                                                                   runtimeState: {
                                                                       status: 'disabled',
                                                                       label: 'credentials.latest_inspection_status',
                                                                   },
                                                               })
})

test('same-name cards select and cache their own models; file invalidation discards both identities', async () => {
    const path      = 'features/authFiles/components/AuthFileModelsModal.tsx'
    const name      = 'shared.json'
    const authFiles = [{ name, authIndex: 0 }, { name, authIndex: 'right' }]
    const get       = spyOn(apiClient, 'get')
        .mockRejectedValue(new Error('Unexpected model request'))
        .mockResolvedValueOnce({ models: [{ id: '0-model' }] })
        .mockResolvedValueOnce({ models: [{ id: 'right-model' }] })
    invalidateAuthFileModelsCache()
    try {
        for (const selected of authFiles) {
            const modal = sourceExpression<ReactElement<{ file: AuthFileItem }>>(
                vendorFile,
                (node, tree) => ts.isJsxSelfClosingElement(node) &&
                                node.tagName.getText(tree) ===
                                'AuthFileModelsModal',
                {
                    React,
                    AuthFileModelsModal: Stub,
                    data: { authFiles },
                    modelsFileKey: authFileSelectionKey(selected),
                    authFileSelectionKey,
                },
            )
            expect(modal.props.file).toBe(selected)
            const settled    = Promise.withResolvers<unknown>()
            const file       = modal.props.file
            const generation = apiClient.getAuthGeneration()
            const cleanup    = sourceCallback<() => () => void>(path, 'useEffect', {
                file, generation, identity: `${generation}:${authFileSelectionKey(file)}`, apiClient, t,
                loadAuthFileModels, authFilesApi,
                setState: (state: { loading: boolean; models: unknown }) => {
                    if (!state.loading) {
                        settled.resolve(state.models)
                    }
                },
            })()
            expect(await settled.promise).toEqual([{ id: `${selected.authIndex}-model` }])
            cleanup()
        }
        expect(get.mock.calls.map(([url, options]) => [url, options?.params])).toEqual([
                                                                                           [
                                                                                               '/auth-files/models',
                                                                                               {
                                                                                                   name,
                                                                                                   auth_index: '0',
                                                                                               },
                                                                                           ],
                                                                                           [
                                                                                               '/auth-files/models',
                                                                                               {
                                                                                                   name,
                                                                                                   auth_index: 'right',
                                                                                               },
                                                                                           ],
                                                                                       ])
        expect(getCachedAuthFileModels(name, 0)).toEqual([{ id: '0-model' }])
        expect(getCachedAuthFileModels(name, 'right')).toEqual([{ id: 'right-model' }])
        expect(getCachedAuthFileModels(name)).toBeNull()
        invalidateAuthFileModelsCache([name])
        expect(getCachedAuthFileModels(name, 0)).toBeNull()
        expect(getCachedAuthFileModels(name, 'right')).toBeNull()
    } finally {
        get.mockRestore()
        invalidateAuthFileModelsCache()
    }
})

for (const provider of
    ['gemini-cli', 'anthropic', 'antigravity', 'codex', 'meta', 'devin', 'kimi', 'kimi-ai', 'qwen', 'xai']) {
    test(`${provider} cancels the current owned OAuth attempt at the server`, async () => {
        const cancel       = spyOn(oauthApi, 'cancelSession').mockResolvedValue({ status: 'ok', cancelled: true })
        const attempts     = createOAuthAttempts({ getGeneration: () => 1, setTimeout: () => 0, clearTimeout: Stub })
        const previous     = attempts.begin(provider)
        const onCancel     = mock()
        const startPolling = mock()
        const nonceRef     = { current: 'synthetic-nonce' }
        try {
            await sourceCallback<() => Promise<void>>(oauthFile, 'handleCancel', {
                oauthState: 'synthetic-state', nonceRef, provider, oauthApi, t, attemptsRef: { current: attempts },
                setCallbackSubmitting: Stub, setCancelSubmitting: Stub, setError: Stub,
                setOauthState: Stub, setUserCode: Stub, onCancel, startPolling,
            })()
            expect(cancel).toHaveBeenCalledWith('synthetic-state', 'synthetic-nonce', expect.any(AbortSignal))
            expect(previous.signal.aborted).toBeTrue()
            expect(onCancel).toHaveBeenCalledTimes(1)
            expect(startPolling).not.toHaveBeenCalled()
            expect(nonceRef.current).toBe('')
        } finally {
            cancel.mockRestore()
        }
    })
}

test('an already publishing session keeps polling toward its outcome instead of closing', async () => {
    const provider = 'qwen'
    const attempts = createOAuthAttempts({ getGeneration: () => 1, setTimeout: () => 0, clearTimeout: Stub })
    attempts.begin(provider)
    const onCancel     = mock()
    const startPolling = mock()
    await sourceCallback<() => Promise<void>>(oauthFile, 'handleCancel', {
        oauthState: 'synthetic-publishing', nonceRef: { current: 'synthetic-nonce' }, provider, t,
        oauthApi: { cancelSession: async () => ({ status: 'ok', cancelled: false }) },
        attemptsRef: { current: attempts }, setCallbackSubmitting: Stub, setCancelSubmitting: Stub,
        setError: Stub, setStatus: Stub, setOauthState: Stub, setUserCode: Stub, onCancel, startPolling,
    })()
    expect(onCancel).not.toHaveBeenCalled()
    expect(startPolling).toHaveBeenCalledWith('synthetic-publishing', 'synthetic-nonce', attempts.get(provider))
    attempts.invalidateAll()
})

test('Claude uses just the rule editor rendered by the shared connection fields', () => {
    const fields     = sourceCallback<React.ComponentType<Record<string, unknown>>>(
        'pages/ProviderFormFields.tsx', 'ProviderConnectionFields', {
            React, Input: Stub, PriorityField: Stub, WeightField: Stub, CredentialOverrideFields: Stub,
            PrefixField: Stub, HeadersField: Stub,
            RequestScopedErrorsField: () => React.createElement('section', { 'aria-label': 'Request error rules' }),
        },
    )
    const page       = 'pages/AiProvidersClaudeEditPage.tsx'
    const connection = sourceExpression<ReactElement>(page, (node, tree) =>
        ts.isJsxSelfClosingElement(node) && node.tagName.getText(tree) === 'ProviderConnectionFields', {
                                                          React,
                                                          ProviderConnectionFields: fields,
                                                          form: { apiKey: 'masked', headers: [] },
                                                          setForm: Stub,
                                                          controlsDisabled: false,
                                                          t,
                                                          updateApiKey: Stub,
                                                          updateHeaders: Stub,
                                                      })
    expect(renderToStaticMarkup(connection).match(/aria-label="Request error rules"/g)).toHaveLength(1)
    const source = readFileSync(new URL(`../src/${page}`, import.meta.url), 'utf8')
    expect(source).not.toContain('<RequestScopedErrorsField')
})

test('alias edits normalize channel keys before diffing and reject ambiguous channels before any PATCH', async () => {
    const baseline = 'oauth-model-alias:\n  codex:\n    - { name: first, alias: selected, fork: false }\n'
    const upper    = baseline.replace('  codex:', '  " CODEX ":')
    const patch    = spyOn(apiClient, 'patch').mockResolvedValue({ status: 'ok' })
    try {
        expect((await oauthModelAliasEditorApi.validateConfigYaml(upper)).valid).toBeTrue()
        expect(await oauthModelAliasEditorApi.saveConfigYaml(upper, 'revision', baseline)).toEqual({})
        expect(patch).not.toHaveBeenCalled()
        await oauthModelAliasEditorApi.saveConfigYaml(
            upper.replace('name: first', 'name: second'),
            'revision',
            baseline,
        )
        expect(patch).toHaveBeenCalledWith('/oauth-model-alias', {
            channels: { codex: [{ name: 'second', alias: 'selected', fork: false }] },
        }, expect.objectContaining({ headers: { 'If-Match': 'revision' } }))
        const duplicate  = `${baseline}  CODEX: []\n`
        const validation = await oauthModelAliasEditorApi.validateConfigYaml(duplicate)
        expect(validation).toMatchObject({ valid: false, errors: [{ field: 'oauth-model-alias' }] })
        await expect(oauthModelAliasEditorApi.saveConfigYaml(duplicate, 'revision', baseline)).rejects.toThrow()
        expect(patch).toHaveBeenCalledTimes(1)
    } finally {
        patch.mockRestore()
    }
})

test('the credentials deep link selects inspection and scrolls once its tab is rendered', () => {
    const file       = 'pages/CredentialsPage.tsx'
    const inspection = readFileSync(new URL(
        '../src/components/credentials/AccountInspectionPanel.tsx',
        import.meta.url,
    ), 'utf8')
    expect(inspection).toMatch(/id=['"]quota-refresh-settings['"]/)
    for (const selected of [true, false]) {
        const location       = new URL(`https://panel.example.invalid/credentials${selected ?
                                                                                   '?tab=inspection' :
                                                                                   ''}#quota-refresh-settings`)
        const activeTab      = sourceInitializer(file, 'activeTab', { location })
        const panel          = sourceExpression<ReactElement | false>(file, (node, tree) =>
            ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken &&
            ts.isJsxSelfClosingElement(node.right) && node.right.tagName.getText(tree) === 'AccountInspectionPanel', {
                                                                          activeTab,
                                                                          React,
                                                                          AccountInspectionPanel: Stub,
                                                                          handleCredentialsChanged: Stub,
                                                                      })
        const scrollIntoView = mock()
        const getElementById = mock(() => panel ? { scrollIntoView } : null)
        sourceCallback<() => void>(file, 'useEffect', {
            activeTab, location, QUOTA_REFRESH_SETTINGS_ID: 'quota-refresh-settings', document: { getElementById },
        }, 'scrollIntoView')()
        expect(activeTab).toBe(selected ? 'inspection' : 'credentials')
        const navigate = mock()
        sourceInitializer<(tab: string) => void>(file, 'handleTabChange', { location, activeTab, navigate })(
            selected ? 'credentials' : 'inspection',
        )
        expect(navigate).toHaveBeenCalledWith({ search: selected ? '' : 'tab=inspection' }, { replace: true })
        if (selected) {
            expect(getElementById).toHaveBeenCalledWith('quota-refresh-settings')
            expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' })
        } else {
            expect(getElementById).not.toHaveBeenCalled()
        }
    }
})
