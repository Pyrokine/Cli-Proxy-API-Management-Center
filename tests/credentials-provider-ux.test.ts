// cspell:ignore Vjcm Yjnbab
import {describe, expect, test} from 'bun:test'
import {readFileSync} from 'node:fs'

import {expectSourceToContain} from './sourceContractAssertions'
import {
    apiKeyMatchesStatus,
    buildManualKeyCardItems,
    filterApiKeysByStatus,
} from '@/components/credentials/apiKeyStatus'
import {createVendorRegistry} from '@/components/credentials/hooks/useVendorRegistry'
import {buildProviderConnectivityTestSignature} from '@/hooks/useProviderConnectivityTestState'
import {
    createProviderEditModalState,
    resolveProviderEditModalState,
    withProviderEditReturnFocus,
} from '@/hooks/useProviderEditPresentation'
import {CLAUDE_QUICK_FILL_PRESETS, resolveClaudeModelDiscovery} from '@/pages/providerQuickFill'
import {apiCallApi, getApiCallErrorMessage, isCredentialHeaderName, prepareApiCallAuth} from '@/services/api/apiCall'
import {apiClient} from '@/services/api/client'
import {modelsApi} from '@/services/api/models'
import {findProviderConfigIndexByAuthIndex} from '@/services/api/providers'
import {usageApi} from '@/services/api/usage'
import {useClaudeEditDraftStore} from '@/stores/useClaudeEditDraftStore'
import {
    buildClaudeCodeClientConfig,
    CPA_API_KEY_PLACEHOLDER,
    selectClaudeCodeClientModel,
    serializeClaudeCodeClientConfig,
} from '@/utils/claudeCodeConfig'
import {getChangedHeaderNames} from '@/utils/headers'
import {buildProviderAutoFetchSignature, canApplyDiscoveredModels} from '@/utils/providerModels'
import {calculateStatusBarDataFromSummaryPoints} from '@/utils/usage'

const icon          = () => null
const registryIcons = {
    Gemini: icon,
    Claude: icon,
    Codex: icon,
    Meta: icon,
    Vertex: icon,
    OpenAI: icon,
    Kimi: icon,
    Qwen: icon,
    IFlow: icon,
    Grok: icon,
    Devin: icon,
    Generic: icon,
}

const vertexEditSource             = readFileSync(
    new URL('../src/pages/AiProvidersVertexEditPage.tsx', import.meta.url),
    'utf8',
)
const xaiEditSource                = readFileSync(
    new URL('../src/pages/AiProvidersXAIEditPage.tsx', import.meta.url),
    'utf8',
)
const credentialsPageSource        = readFileSync(new URL('../src/pages/CredentialsPage.tsx', import.meta.url), 'utf8')
const oauthLoginActionSource       = readFileSync(
    new URL('../src/components/credentials/OAuthLoginAction.tsx', import.meta.url),
    'utf8',
)
const vendorSectionSource          = readFileSync(
    new URL('../src/components/credentials/VendorSection.tsx', import.meta.url),
    'utf8',
)
const credentialCardSource         = readFileSync(
    new URL('../src/components/credentials/CredentialCard.tsx', import.meta.url),
    'utf8',
)
const accountInspectionPanelSource = readFileSync(
    new URL('../src/components/credentials/AccountInspectionPanel.tsx', import.meta.url),
    'utf8',
)
const quotaApiSource               = readFileSync(new URL('../src/services/api/quota.ts', import.meta.url), 'utf8')
const authFilesApiSource           = readFileSync(new URL('../src/services/api/authFiles.ts', import.meta.url), 'utf8')
const accountInspectionApiSource   = readFileSync(
    new URL('../src/services/api/accountInspection.ts', import.meta.url),
    'utf8',
)
const backendQuotaHookSource       = readFileSync(
    new URL('../src/components/credentials/hooks/useBackendQuotaRegistration.ts', import.meta.url),
    'utf8',
)
const modalSource                  = readFileSync(new URL('../src/components/ui/Modal.tsx', import.meta.url), 'utf8')
const providerEditShellSource      = readFileSync(
    new URL('../src/pages/ProviderEditShell.tsx', import.meta.url),
    'utf8',
)
const providerFormFieldsSource     = readFileSync(
    new URL('../src/pages/ProviderFormFields.tsx', import.meta.url),
    'utf8',
)
const authFileEditorSource         = readFileSync(
    new URL('../src/features/authFiles/components/AuthFilesPrefixProxyEditorModal.tsx', import.meta.url),
    'utf8',
)
const modelDiscoveryHookSource     = readFileSync(
    new URL('../src/hooks/useModelDiscovery.ts', import.meta.url),
    'utf8',
)
const providerModelsPageSource     = readFileSync(
    new URL('../src/pages/ProviderModelsPage.tsx', import.meta.url),
    'utf8',
)
const claudeModelsPageSource       = readFileSync(
    new URL('../src/pages/AiProvidersClaudeModelsPage.tsx', import.meta.url),
    'utf8',
)
const openAIModelsPageSource       = readFileSync(
    new URL('../src/pages/AiProvidersOpenAIModelsPage.tsx', import.meta.url),
    'utf8',
)

const flattenKeys = (value: unknown, prefix = ''): string[] => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return [prefix]
    }
    return Object.entries(value).flatMap(([key, item]) => flattenKeys(item, prefix ? `${prefix}.${key}` : key))
}

describe('provider identity and status UX', () => {
    test('labels Claude and OpenAI entries as compatibility protocols', () => {
        const vendors = createVendorRegistry(registryIcons)
        expect(vendors.find((vendor) => vendor.id === 'claude')).toMatchObject({
                                                                                   label: 'Claude Compatible',
                                                                                   labelKey: 'credentials.vendor_claude_compatible',
                                                                               })
        expect(vendors.find((vendor) => vendor.id === 'openai')).toMatchObject({
                                                                                   label: 'OpenAI Compatible',
                                                                                   labelKey: 'credentials.vendor_openai_compatible',
                                                                               })
        expect(vendors.find((vendor) => vendor.id === 'xai')).toMatchObject({
                                                                                editRoute: '/credentials/xai',
                                                                                createRoute: '/credentials/xai/new',
                                                                            })
        expect(vendors.find((vendor) => vendor.id === 'meta')).toMatchObject({
                                                                                 oauthProviders: ['meta'],
                                                                                 authFileTypes: ['meta', 'muse'],
                                                                                 editRoute: '/credentials/meta',
                                                                                 createRoute: '/credentials/meta/new',
                                                                             })
        expect(vendors.find((vendor) => vendor.id === 'kimi')?.oauthProviders).toEqual(['kimi', 'kimi-ai'])
    })

    test('keeps active API keys in available and disabled providers in disabled', () => {
        const values = [{ name: 'active' }, { name: 'disabled', disabled: true }]
        expect(filterApiKeysByStatus(values, 'available')).toEqual([{ name: 'active' }])
        expect(filterApiKeysByStatus(values, 'disabled')).toEqual([{ name: 'disabled', disabled: true }])
        expect(filterApiKeysByStatus(values, 'error')).toEqual([])
        expect(filterApiKeysByStatus(values, 'exhausted')).toEqual([])
    })

    test('expands each OpenAI-compatible API key without losing its provider edit index', () => {
        const providers = [
            {
                name: 'multi-key',
                baseUrl: 'https://example.com/v1',
                apiKeyEntries: [
                    { apiKey: 'masked-a', authIndex: 'openai:a' },
                    { apiKey: 'masked-b', authIndex: 'openai:b' },
                ],
            },
            {
                name: 'empty-provider',
                baseUrl: 'https://empty.example.com/v1',
                apiKeyEntries: [],
                authIndex: 'openai:fallback',
                disabled: true,
            },
        ]

        expect(buildManualKeyCardItems('openai', providers)).toMatchObject([
                                                                               {
                                                                                   configIndex: 0,
                                                                                   entryIndex: 0,
                                                                                   apiKey: 'masked-a',
                                                                                   authIndex: 'openai:a',
                                                                                   disabled: false,
                                                                               },
                                                                               {
                                                                                   configIndex: 0,
                                                                                   entryIndex: 1,
                                                                                   apiKey: 'masked-b',
                                                                                   authIndex: 'openai:b',
                                                                                   disabled: false,
                                                                               },
                                                                               {
                                                                                   configIndex: 1,
                                                                                   apiKey: '',
                                                                                   authIndex: 'openai:fallback',
                                                                                   disabled: true,
                                                                               },
                                                                           ])
    })

    test('does not assign one provider identity to OpenAI entries missing their own identity', () => {
        const providers = [
            {
                name: 'legacy',
                baseUrl: 'https://example.com/v1',
                authIndex: 'openai:provider',
                apiKeyEntries: [{ apiKey: 'masked-a' }, { apiKey: 'masked-b' }],
            },
        ]
        expect(buildManualKeyCardItems('openai', providers).map((item) => item.authIndex)).toEqual([
                                                                                                       undefined,
                                                                                                       undefined,
                                                                                                   ])
    })

    test('applies runtime health to credential status filters', () => {
        expect(apiKeyMatchesStatus({}, 'exhausted', {
            status: 'unavailable',
            reason: 'quota_exceeded',
        })).toBe(true)
        expect(apiKeyMatchesStatus({}, 'error', {
            status: 'unavailable',
            reason: 'provider_error',
        })).toBe(true)
        expect(apiKeyMatchesStatus({}, 'available', {
            status: 'unavailable',
            reason: 'provider_error',
        })).toBe(false)
        expect(apiKeyMatchesStatus({ disabled: true }, 'disabled', { status: 'normal' })).toBe(true)
    })

    test('keeps the manual OAuth callback available when polling fails for a current attempt', () => {
        expect(oauthLoginActionSource).toContain('attemptsRef.current.get(provider)?.isCurrent()')
        expect(oauthLoginActionSource).toContain("if (status === 'error' && !canContinueAfterError)")
        expect(oauthLoginActionSource).toContain("if (status === 'waiting' || canContinueAfterError)")
        expect(oauthLoginActionSource).toContain('onClick={resumePolling}')
        expect(oauthLoginActionSource).toContain("disabled={!callbackUrl.trim() || (!plugin && provider === 'devin' && canContinueAfterError)}")
    })

    test('waits for the OAuth session terminal state after submitting a callback', () => {
        const submitStart = oauthLoginActionSource.indexOf('const submitCallback')
        const submitEnd   = oauthLoginActionSource.indexOf('const handleCancel', submitStart)
        const submitBody  = oauthLoginActionSource.slice(submitStart, submitEnd)

        expect(submitBody).toContain('await oauthApi.submitCallback(provider, redirectUrl, attempt.signal, plugin)')
        expect(submitBody).toContain('if (attempt.isCurrent())')
        expect(submitBody).toContain('setCallbackAccepted(true)')
        expect(submitBody).not.toContain('setStatus(\'success\')')
        expect(submitBody).not.toContain('onSuccess()')
        expect(oauthLoginActionSource).toContain('if (result.status === \'ok\')')
        expect(oauthLoginActionSource).toContain('attempt.invalidate()')
        expect(oauthLoginActionSource).toContain('\'credentials.oauth_callback_processing\'')
    })

    test('builds 24 fixed ten-minute status blocks from auth-index summary points', () => {
        const tenMinutes = 10 * 60 * 1000
        const start      = Date.parse('2026-08-30T08:00:00Z')
        const tokens     = {
            input: 10,
            output: 5,
            cached: 0,
            reasoning: 0,
            total: 15,
        }
        const status     = calculateStatusBarDataFromSummaryPoints(
            [
                {
                    time: '2026-08-30T08:00:00Z',
                    requests: 2,
                    success: 1,
                    failure: 1,
                    tokens,
                    cost: 0,
                    has_cost: false,
                },
                {
                    time: '2026-08-30T10:00:00Z',
                    requests: 3,
                    success: 3,
                    failure: 0,
                    tokens: { ...tokens, total: 45 },
                    cost: 0,
                    has_cost: false,
                },
            ],
            start,
            tenMinutes,
            24,
        )

        expect(status.blocks).toHaveLength(24)
        expect(status.blocks[0]).toBe('mixed')
        expect(status.blocks[12]).toBe('success')
        expect(status.blocks[23]).toBe('idle')
        expect(status.blockDetails[0]?.totalTokens).toBe(15)
        expect(status.blockDetails[12]?.totalTokens).toBe(45)
        expect(status.totalSuccess).toBe(4)
        expect(status.totalFailure).toBe(1)
        expect(status.successRate).toBe(80)
    })

    test('requests only auth-index groups at ten-minute granularity', async () => {
        const originalGet = apiClient.get
        let requestedUrl  = ''
        apiClient.get     = (async (url: string) => {
            requestedUrl = url
            return {}
        }) as typeof apiClient.get
        try {
            await usageApi.getSummary({
                                          from: '2026-08-30T08:00:00Z',
                                          to: '2026-08-30T12:00:00Z',
                                          granularity: 'hourly',
                                          groups: 'none',
                                          auth_index_groups: true,
                                          auth_index_granularity: '10m',
                                      })
        } finally {
            apiClient.get = originalGet
        }

        const query = new URLSearchParams(requestedUrl.split('?')[1] ?? '')
        expect(query.get('groups')).toBe('none')
        expect(query.get('auth_index_groups')).toBe('true')
        expect(query.get('auth_index_granularity')).toBe('10m')
    })

    test('refreshes credential cards and auth-index insights as one operation', () => {
        expect(credentialsPageSource).toContain('createLatestCredentialsRequestTracker()')
        expect(credentialsPageSource).toContain('await Promise.all([refresh(), refreshCredentialInsights()])')
        expectSourceToContain(credentialsPageSource, 'useAutoRefresh(\n        refreshAllCredentials,')
        expect(credentialsPageSource).toContain('useHeaderRefresh(handleRefresh)')
        expect(credentialsPageSource).not.toContain('useAutoRefresh(refresh, autoRefreshMs)')
        expect(credentialsPageSource).toContain(
            'const createCredentialUsageWindow = (nowMs = Date.now())',
        )
        expectSourceToContain(
            credentialsPageSource,
            'const usageEnd = Date.now()\n        const usageWindow = createCredentialUsageWindow(usageEnd)',
        )
        expectSourceToContain(credentialsPageSource, 'API_KEY_STATUS_BUCKET_MS = 10 * 60 * 1000')
        expectSourceToContain(credentialsPageSource, 'API_KEY_STATUS_BUCKET_COUNT = 24')
        expect(credentialsPageSource).toContain('groups: \'none\'')
        expect(credentialsPageSource).toContain('auth_index_granularity: \'10m\'')
        expect(credentialsPageSource).toContain(
            'usageStatisticsEnabled={config?.usageStatisticsEnabled}',
        )
        expect(vendorSectionSource).toContain('t(\'credentials.usage_collection_disabled\'')
        expect(vendorSectionSource).toContain(
            '((usageStatisticsEnabled && !authIndexUsageLoadFailed) || series !== undefined)',
        )
        expect(
            vendorSectionSource.match(/disabled=\{runtimeState\.status === 'disabled'}/g),
        ).toHaveLength(2)
    })

    test('keeps quota refresh and sign-in renewal separate from explicit quota reset', () => {
        expect(vendorSectionSource).toMatch(
            /await scheduler\.refreshNow\(quotaKey\)\s+if \(isCurrent\(\)\) \{\s+await onRefresh\(\)/,
        )
        expect(vendorSectionSource).not.toContain('authFilesApi.requestManualRefresh')
        expect(vendorSectionSource).toContain(
            'quotaResetState={isCodexProvider && !isPluginQuota ? quotaResetState : undefined}',
        )
        expect(vendorSectionSource).toContain('await authFilesApi.clearLocalCooldown(authIndex)')
        expect(vendorSectionSource).toContain('onClearCooldown={authIndex ? handleClearCooldown : undefined}')
        expect(credentialCardSource).toContain('onClear={disabled ? undefined : onClearCooldown}')
        expect(authFilesApiSource).toContain("'/routing/cooldown/reset'")
        expect(vendorSectionSource).toContain(
            'refreshState={isPluginQuota ? pluginRefreshState : isMetaProvider || isKimiAIProvider ? undefined : refreshState}',
        )
        expect(credentialCardSource).toContain('quotaResetState?: QuotaResetState')
        expect(credentialCardSource).toContain("t('auth_files.quota_refresh_hint'")
        expect(credentialCardSource).toContain("t('auth_files.quota_reset_codex_title'")
        expect(credentialCardSource).not.toContain('manualTokenRefreshState')
        expect(credentialCardSource).toContain('refreshState?.isRefreshing')
        expect(authFilesApiSource).toContain('{all: true}')
        expect(authFilesApiSource).toContain('}, AUTH_FILE_REFRESH_TIMEOUT_MS).then(normalizeAuthFileRefreshResult)')
        expect(authFilesApiSource).toContain('refreshAuthFileTokens({all: true}, AUTH_FILE_REFRESH_ALL_TIMEOUT_MS)')
        expect(accountInspectionPanelSource).toContain('authFilesApi.requestManualRefreshAll()')
        expect(accountInspectionPanelSource).toContain("busyAction === 'refresh-all-tokens'")
        expect(accountInspectionPanelSource).toContain('if (result.results.length === 0)')
        expect(accountInspectionPanelSource).toContain("t('credentials.manual_token_refresh_all_none'")
        expect(accountInspectionPanelSource).toContain("failed === 0 ? 'success' : succeeded === 0 ? 'error' : 'warning'")
        expect(quotaApiSource).toContain('apiClient.post<QuotaRefreshTask>(')
        expect(quotaApiSource).toContain('const quotaRefreshTaskPath')
        expect(quotaApiSource).toContain('quotaRefreshTaskPath(taskId)')
        for (const source of [authFilesApiSource, accountInspectionPanelSource]) {
            expect(source).not.toContain('/reset-quota')
        }
        for (const source of [authFilesApiSource, quotaApiSource, vendorSectionSource, accountInspectionPanelSource]) {
            expect(source).not.toContain('rate-limit-reset-credits/consume')
            expect(source).not.toContain('banked reset')
        }
        expect(quotaApiSource).toContain("('/reset-quota', {")
        expect(vendorSectionSource).toContain('await quotaApi.reset(authIndex)')
        expect(vendorSectionSource).toContain('await runCodexResetCreditAction(readAvailableCount, async () => {')
        expect(vendorSectionSource).toContain("message: t('auth_files.quota_reset_codex_confirm', {name})")
        expect(vendorSectionSource).not.toContain('reset-credits-applicable')
        expect(vendorSectionSource).toContain('manualResetCount: quotaManualResetCount')
        expect(vendorSectionSource).toContain('value: formatCodexResetCreditCount(quotaManualResetCount, t)')
        expect(vendorSectionSource).not.toContain('applicableManualResetCount:')
        expect(backendQuotaHookSource).toContain('waitForQuotaRefreshTask(initialTask')
        expect(backendQuotaHookSource).toContain('applyQuotaRefreshTaskToMeta')
        expectSourceToContain(backendQuotaHookSource, 'const { i18n: translation } = useTranslation()')
        expect(backendQuotaHookSource).toContain(
            '[authFiles, cacheGeneration, quotaLanguage, pollLatest]',
        )
        expect(backendQuotaHookSource).not.toContain('currentLastRefreshMs')
        expect(backendQuotaHookSource).not.toContain('RefreshBaseline')
        expect(accountInspectionPanelSource).toContain('value: \'quota\'')
        expect(accountInspectionPanelSource).toContain('quotaApi.pauseTask(latestQuotaTask.id)')
        expect(accountInspectionPanelSource).toContain('quotaApi.resumeTask(latestQuotaTask.id)')
        expect(accountInspectionPanelSource).toContain('quotaApi.cancelTask(latestQuotaTask.id)')
        expect(accountInspectionPanelSource).toContain('latestQuotaTask?.targets ?? []')
    })

    test('shows provider-safe probe outcomes with immutable credential binding', () => {
        expect(accountInspectionApiSource).toContain(
            'export type AccountProbeStatus = \'passed\' | \'failed\' | \'inconclusive\' | \'outdated\'',
        )
        expect(accountInspectionApiSource).toContain('auth_generation: number')
        expect(accountInspectionApiSource).toContain('credential_digest?: string')
        expect(accountInspectionApiSource).toContain('probe_revision: string')
        expect(accountInspectionPanelSource).toContain('row.probe_status')
        expect(accountInspectionPanelSource).toContain('row.auth_generation')
        expect(accountInspectionPanelSource).toContain('row.credential_digest')
        expect(accountInspectionPanelSource).toContain('row.probe_revision')
        const actionsStart   = accountInspectionPanelSource.indexOf('const renderRowActions')
        const outdatedGuard  = accountInspectionPanelSource.indexOf(
            'result.probe_status === \'outdated\'',
            actionsStart,
        )
        const disabledAction = accountInspectionPanelSource.indexOf(
            'result.status === \'disabled\'',
            actionsStart,
        )
        expect(outdatedGuard).toBeGreaterThan(actionsStart)
        expect(disabledAction).toBeGreaterThan(outdatedGuard)
    })

    test('uses ephemeral route state for list-originated provider modals', () => {
        const backgroundLocation = {
            pathname: '/credentials',
            search: '',
            hash: '',
            state: null,
            key: 'credentials-list',
        }
        const state              = createProviderEditModalState(backgroundLocation, 'edit-trigger')

        expect(resolveProviderEditModalState(state, '/credentials/openai/2')).toMatchObject({
                                                                                                presentation: 'modal',
                                                                                                returnFocusId: 'edit-trigger',
                                                                                                backgroundLocation,
                                                                                            })
        const childState = withProviderEditReturnFocus(state, 'model-discovery-trigger')
        expect(resolveProviderEditModalState(childState, '/credentials/openai/2/models')).toMatchObject({
                                                                                                            returnFocusId: 'edit-trigger',
                                                                                                            childReturnFocusId: 'model-discovery-trigger',
                                                                                                        })
        expect(resolveProviderEditModalState(state, '/credentials/xai/1')).not.toBeNull()
        expect(resolveProviderEditModalState(state, '/credentials')).toBeNull()
        expect(resolveProviderEditModalState({
                                                 ...state,
                                                 presentationToken: 'stale-after-refresh',
                                             }, '/credentials/openai/2')).toBeNull()
        expect(resolveProviderEditModalState(undefined, '/credentials/openai/2')).toBeNull()
    })

    test('preserves list focus across auth-index refreshes and model subroutes', () => {
        expect(vendorSectionSource).toContain(
            'const cardIdentity = [\n            item.configIndex,\n            item.entryIndex ?? \'root\',',
        )
        expect(vendorSectionSource).not.toContain('authIndex || \'config\'')
        expect(providerEditShellSource).toContain('initialFocusId={presentation?.childReturnFocusId}')
        expect(providerEditShellSource).toContain('returnFocusId={returnFocusId ?? presentation.returnFocusId}')
        expect(providerModelsPageSource).toContain('returnFocusId={presentation?.childReturnFocusId}')
        expectSourceToContain(providerModelsPageSource, 'navigate(\'..\', { replace: true })')
        expect(modalSource).toContain('dialog.contains(explicitTarget)')
        expectSourceToContain(modalSource, 'const returnFocusIdRef = useRef(returnFocusId)')
        expect(modalSource).toContain('const currentReturnFocusId = returnFocusIdRef.current')
        expect(modalSource).not.toContain(
            '    }, [returnFocusId])\n\n    useEffect(() => {\n        return () => {',
        )
    })

    test('exposes Vertex and xAI manual configuration through the shared editor shell', () => {
        expect(vertexEditSource).toContain('<ProviderConnectionFields')
        expect(xaiEditSource).toContain('configKey: \'xai-api-key\'')
        expect(xaiEditSource).toContain('<ProviderEditShell')
        expect(xaiEditSource).toContain('<ProviderConnectionFields')
        expect(providerFormFieldsSource).toContain('<PriorityField form={form}')
        expect(providerFormFieldsSource).toContain('<WeightField form={form}')
        expect(providerFormFieldsSource).toContain('<CredentialOverrideFields')
        expect(xaiEditSource).not.toContain('Boolean(form.disableCooling)')
        expect(credentialsPageSource).toContain('t(\'credentials.routing_order_hint\')')
    })

    test('presents runtime-only auth fields as read-only details', () => {
        expect(authFileEditorSource).toContain('editor.readOnly')
        expect(authFileEditorSource).toContain('t(\'auth_files.runtime_only_readonly_hint\')')
        expect(authFileEditorSource).toContain('t(readOnly ? \'common.close\' : \'common.cancel\')')
    })

    test('resolves edited provider entries by stable auth identity after reordering', () => {
        const configs = [
            { apiKey: 'masked-b', authIndex: 'claude:b' },
            { apiKey: 'masked-a', authIndex: 'claude:a' },
        ]
        expect(findProviderConfigIndexByAuthIndex(configs, 'claude:a')).toBe(1)
        expect(findProviderConfigIndexByAuthIndex(configs, 'claude:missing')).toBe(-1)
    })

    test('does not mark an unchanged credential header as edited when another row is removed', () => {
        const previous = [
            { key: 'X-Foo', value: 'one' },
            { key: 'Authorization', value: 'Bearer key...tail' },
        ]
        const next     = [{ key: 'Authorization', value: 'Bearer key...tail' }]
        expect(getChangedHeaderNames(previous, next)).toEqual(['x-foo'])
    })

    test('offers the verified DeepSeek Claude-compatible endpoint without inventing a model alias', () => {
        const preset = CLAUDE_QUICK_FILL_PRESETS.find((item) => item.id === 'deepseek-claude')
        expect(preset).toEqual({
                                   id: 'deepseek-claude',
                                   label: 'DeepSeek',
                                   baseUrl: 'https://api.deepseek.com/anthropic',
                                   discovery: {
                                       providerLabel: 'DeepSeek',
                                       endpoint: 'https://api.deepseek.com/models',
                                       authMode: 'bearer',
                                       addAnthropicVersion: false,
                                   },
                               })
        expect(resolveClaudeModelDiscovery('https://api.deepseek.com/anthropic/')).toEqual(preset?.discovery)
        expect(resolveClaudeModelDiscovery('https://api.deepseek.com/anthropic/v1')).toEqual(preset?.discovery)
        expect(resolveClaudeModelDiscovery('https://api.deepseek.com/anthropic/v1/messages')).toEqual(preset?.discovery)
        expect(resolveClaudeModelDiscovery('https://api.deepseek.com:443/anthropic')).toEqual(preset?.discovery)
        expect(resolveClaudeModelDiscovery('https://api.deepseek.com/anthropic/?source=manual#models')).toEqual(
            preset?.discovery,
        )
        expect(resolveClaudeModelDiscovery('https://api.deepseek.com/ANTHROPIC')).toBeUndefined()
        expect(resolveClaudeModelDiscovery('https://api.deepseek.com/anthropic/V1/MESSAGES')).toBeUndefined()
        expect(modelsApi.buildClaudeModelsEndpoint(preset?.baseUrl ?? '', preset?.discovery)).toBe(
            'https://api.deepseek.com/models',
        )
        expect(modelsApi.buildClaudeModelsEndpoint('https://api.example.com')).toBe(
            'https://api.example.com/v1/models',
        )
        expect(JSON.stringify(preset)).not.toContain('flash')
    })
})

describe('Claude Code client configuration', () => {
    test('prefers the canonical DeepSeek V4.1 Flash model', () => {
        expect(selectClaudeCodeClientModel(['deepseek-v4-pro', 'DeepSeek-Flash'], '')).toBe('DeepSeek-Flash')
    })

    test('keeps the current model when it remains available', () => {
        expect(selectClaudeCodeClientModel(['deepseek-flash', 'DeepSeek-V4-Pro'], 'deepseek-v4-pro')).toBe(
            'DeepSeek-V4-Pro',
        )
    })

    test('uses DeepSeek V4 Pro when the canonical Flash model is absent', () => {
        expect(selectClaudeCodeClientModel(['claude-sonnet', 'DeepSeek-V4-Pro'], '')).toBe('DeepSeek-V4-Pro')
    })

    test('falls back to the first model when neither current DeepSeek model is available', () => {
        expect(selectClaudeCodeClientModel(['claude-sonnet', 'claude-haiku'], '')).toBe('claude-sonnet')
    })

    test('uses the CPA endpoint and selected client model with a safe key placeholder', () => {
        const config = buildClaudeCodeClientConfig('https://cpa.example.com/', 'deepseek-flash')
        expect(config).toEqual({
                                   model: 'deepseek-flash',
                                   env: {
                                       ANTHROPIC_BASE_URL: 'https://cpa.example.com',
                                       ANTHROPIC_API_KEY: CPA_API_KEY_PLACEHOLDER,
                                       ANTHROPIC_DEFAULT_OPUS_MODEL: 'deepseek-flash',
                                       ANTHROPIC_DEFAULT_SONNET_MODEL: 'deepseek-flash',
                                       ANTHROPIC_DEFAULT_HAIKU_MODEL: 'deepseek-flash',
                                       CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
                                   },
                               })
        const serialized = serializeClaudeCodeClientConfig('https://cpa.example.com', 'deepseek-flash')
        expect(serialized).not.toContain('api.deepseek.com')
        expect(serialized).not.toContain('auth-index')
        expect(serialized).not.toContain('draftToken')
        expect(serialized).not.toContain('deepseek-v4-pro')
    })

    test('does not produce a copyable configuration without a base URL or model', () => {
        expect(buildClaudeCodeClientConfig('', 'deepseek-flash')).toBeNull()
        expect(buildClaudeCodeClientConfig('https://cpa.example.com', '')).toBeNull()
    })
})

describe('provider request and discovery contracts', () => {
    test('aborts superseded discovery requests and rejects stale generations', () => {
        expect(modelDiscoveryHookSource).toContain('requestControllerRef.current?.abort()')
        expectSourceToContain(modelDiscoveryHookSource, 'const requestId = (requestIdRef.current += 1)')
        expect(modelDiscoveryHookSource).toContain('controller.signal,')
        expectSourceToContain(modelDiscoveryHookSource,
            'if (authGeneration !== apiClient.getAuthGeneration() || requestIdRef.current !== requestId || controller.signal.aborted)',
        )
        expect(providerModelsPageSource).toContain('requestControllerRef.current?.abort()')
        expectSourceToContain(providerModelsPageSource, 'const generation = ++requestGenerationRef.current')
        expect(providerModelsPageSource).toContain('fetchModels(controller.signal)')
        expectSourceToContain(providerModelsPageSource,
            'if (authGeneration !== apiClient.getAuthGeneration() || requestGenerationRef.current !== generation || controller.signal.aborted)',
        )
        expect(claudeModelsPageSource).toContain('const fetchModels = useCallback(async (signal: AbortSignal)')
        expect(claudeModelsPageSource).toMatch(/maskedCredentialHeaderNames,\s+signal,\s+\)/)
    })

    test('keeps proxy and abort signal without reusing authentication on OpenAI discovery fallback', async () => {
        const proxyUrl = 'socks5://proxy.example.test:1080'
        const controller = new AbortController()
        const request = apiCallApi.request
        const calls: Array<{ payload: unknown; signal: AbortSignal | undefined }> = []
        apiCallApi.request = async (payload, config) => {
            calls.push({ payload, signal: config?.signal as AbortSignal | undefined })
            return { statusCode: 200, header: {}, bodyText: '{"data":[]}', body: { data: [] } }
        }
        try {
            await modelsApi.fetchV1ModelsViaApiCall(
                'https://api.example.test', undefined, undefined, proxyUrl, undefined, controller.signal,
            )
            await modelsApi.fetchModelsViaApiCall(
                'https://api.example.test', undefined, undefined, proxyUrl, undefined, controller.signal,
            )
            expect(calls).toEqual([
                {
                    payload: {
                        method: 'GET', url: 'https://api.example.test/v1/models',
                        header: undefined, proxyUrl, authIndex: undefined, draftToken: undefined,
                    },
                    signal: controller.signal,
                },
                {
                    payload: {
                        method: 'GET', url: 'https://api.example.test/models',
                        header: undefined, proxyUrl, authIndex: undefined, draftToken: undefined,
                    },
                    signal: controller.signal,
                },
            ])
        } finally {
            apiCallApi.request = request
        }

        const unauthenticatedCall = /modelsApi\.fetch(?:V1)?ModelsViaApiCall\(\s*trimmedBaseUrl,\s*undefined,\s*undefined,\s*keyEntry\?\.proxyUrl,\s*undefined,\s*signal,\s*\)/g
        expect([...openAIModelsPageSource.matchAll(unauthenticatedCall)]).toHaveLength(2)
        expect(openAIModelsPageSource.match(/if \(signal\.aborted \|\| authGeneration !== apiClient\.getAuthGeneration\(\)\) \{/g)).toHaveLength(3)
    })

    test('uses the DeepSeek root model endpoint with bearer authentication', async () => {
        const originalRequest                        = apiCallApi.request
        const controller                             = new AbortController()
        let captured: Record<string, unknown> | null = null
        let capturedSignal: AbortSignal | undefined
        apiCallApi.request                           = async (payload, config) => {
            captured       = payload as unknown as Record<string, unknown>
            capturedSignal = config?.signal as AbortSignal | undefined
            return {
                statusCode: 200,
                header: {},
                bodyText: '{"data":[{"id":"deepseek-flash"},{"id":"deepseek-v4-pro"}]}',
                body: { data: [{ id: 'deepseek-flash' }, { id: 'deepseek-v4-pro' }] },
            }
        }
        try {
            const baseUrl   = 'https://api.deepseek.com/anthropic'
            const discovery = resolveClaudeModelDiscovery(baseUrl)
            const models    = await modelsApi.fetchClaudeModelsViaApiCall(
                baseUrl,
                'deepseek-secret-key',
                { 'Anthropic-Version': '2023-06-01' },
                undefined,
                undefined,
                discovery,
                undefined,
                undefined,
                controller.signal,
            )
            expect(models.map((model) => model.name)).toEqual(['deepseek-flash', 'deepseek-v4-pro'])
            expect(captured).toMatchObject({
                                               method: 'GET',
                                               url: 'https://api.deepseek.com/models',
                                               header: { Authorization: 'Bearer $TOKEN$' },
                                               draftToken: 'deepseek-secret-key',
                                           })
            const capturedHeaders = (captured as unknown as Record<string, unknown>).header as Record<string, string>
            expect(Object.keys(capturedHeaders).some((key) => key.toLowerCase() === 'anthropic-version')).toBe(false)
            expect(capturedHeaders['x-api-key']).toBeUndefined()
            expect(capturedSignal).toBe(controller.signal)
        } finally {
            apiCallApi.request = originalRequest
        }
    })

    test('normalizes token placeholders for DeepSeek bearer authentication', async () => {
        const originalRequest                        = apiCallApi.request
        let captured: Record<string, unknown> | null = null
        apiCallApi.request                           = async (payload) => {
            captured = payload as unknown as Record<string, unknown>
            return {
                statusCode: 200,
                header: {},
                bodyText: '{"data":[]}',
                body: { data: [] },
            }
        }
        try {
            const baseUrl   = 'https://api.deepseek.com/anthropic'
            const discovery = resolveClaudeModelDiscovery(baseUrl)
            await modelsApi.fetchClaudeModelsViaApiCall(
                baseUrl,
                'deepseek-secret-key',
                { Authorization: '$TOKEN$' },
                undefined,
                undefined,
                discovery,
            )
            expect(captured).toMatchObject({
                                               header: { Authorization: 'Bearer $TOKEN$' },
                                               draftToken: 'deepseek-secret-key',
                                           })
        } finally {
            apiCallApi.request = originalRequest
        }
    })

    test('reduces DeepSeek discovery to one bearer credential header', async () => {
        const originalRequest                          = apiCallApi.request
        const captures: Array<Record<string, unknown>> = []
        apiCallApi.request                             = async (payload) => {
            captures.push(payload as unknown as Record<string, unknown>)
            return {
                statusCode: 200,
                header: {},
                bodyText: '{"data":[]}',
                body: { data: [] },
            }
        }
        try {
            const baseUrl   = 'https://api.deepseek.com/anthropic'
            const discovery = resolveClaudeModelDiscovery(baseUrl)
            await modelsApi.fetchClaudeModelsViaApiCall(
                baseUrl,
                'same-token',
                { Authorization: 'Bearer same-token', 'x-api-key': 'same-token' },
                undefined,
                undefined,
                discovery,
            )
            await modelsApi.fetchClaudeModelsViaApiCall(
                baseUrl,
                undefined,
                { Authorization: 'Basic custom-secret' },
                undefined,
                undefined,
                discovery,
            )
            await modelsApi.fetchClaudeModelsViaApiCall(
                baseUrl,
                'deepseek-secret-key',
                { 'X-Client-Key': 'client-prefix $TOKEN$' },
                undefined,
                undefined,
                discovery,
            )

            expect(captures).toHaveLength(3)
            for (const capture of captures) {
                expect(capture.header).toEqual({ Authorization: 'Bearer $TOKEN$' })
            }
            expect(captures[0]?.draftToken).toBe('same-token')
            expect(captures[1]?.draftToken).toBe('custom-secret')
            expect(captures[2]?.draftToken).toBe('deepseek-secret-key')
        } finally {
            apiCallApi.request = originalRequest
        }
    })

    test('converts generic Claude bearer headers to x-api-key authentication', async () => {
        const originalRequest                        = apiCallApi.request
        let captured: Record<string, unknown> | null = null
        apiCallApi.request                           = async (payload) => {
            captured = payload as unknown as Record<string, unknown>
            return {
                statusCode: 200,
                header: {},
                bodyText: '{"data":[]}',
                body: { data: [] },
            }
        }
        try {
            await modelsApi.fetchClaudeModelsViaApiCall(
                'https://api.anthropic.com',
                undefined,
                { Authorization: 'Bearer generic-secret' },
            )
            expect(captured).toMatchObject({
                                               url: 'https://api.anthropic.com/v1/models',
                                               header: {
                                                   'x-api-key': '$TOKEN$',
                                                   'anthropic-version': '2023-06-01',
                                               },
                                               draftToken: 'generic-secret',
                                           })
            expect(
                ((captured as unknown as Record<string, unknown>).header as Record<string, string>).Authorization,
            ).toBeUndefined()
        } finally {
            apiCallApi.request = originalRequest
        }
    })

    test('preserves masked credential identity when discovery renames auth headers', async () => {
        const originalRequest                          = apiCallApi.request
        const captured: Array<Record<string, unknown>> = []
        apiCallApi.request                             = async (payload) => {
            captured.push(payload as unknown as Record<string, unknown>)
            return {
                statusCode: 200,
                header: {},
                bodyText: '{"data":[]}',
                body: { data: [] },
            }
        }
        try {
            const baseUrl   = 'https://api.deepseek.com/anthropic'
            const discovery = resolveClaudeModelDiscovery(baseUrl)
            await modelsApi.fetchClaudeModelsViaApiCall(
                baseUrl,
                undefined,
                { 'x-api-key': 'key...tail' },
                undefined,
                'claude:stored',
                discovery,
                undefined,
                ['x-api-key'],
            )
            await modelsApi.fetchClaudeModelsViaApiCall(
                'https://api.anthropic.com',
                undefined,
                { Authorization: 'Bearer key...tail' },
                undefined,
                'claude:stored',
                undefined,
                undefined,
                ['authorization'],
            )
            expect(captured[0]).toMatchObject({
                                                  header: { Authorization: 'Bearer $TOKEN$' },
                                                  authIndex: 'claude:stored',
                                              })
            expect(captured[0]?.draftToken).toBeUndefined()
            expect(captured[1]).toMatchObject({
                                                  header: { 'x-api-key': '$TOKEN$' },
                                                  authIndex: 'claude:stored',
                                              })
            expect(captured[1]?.draftToken).toBeUndefined()
        } finally {
            apiCallApi.request = originalRequest
        }
    })

    test('rejects case-insensitive duplicate credential headers', async () => {
        const originalRequest = apiCallApi.request
        let requestCount      = 0
        apiCallApi.request    = async () => {
            requestCount += 1
            throw new Error('request should not be sent')
        }
        try {
            const baseUrl                                         = 'https://api.deepseek.com/anthropic'
            const discovery                                       = resolveClaudeModelDiscovery(baseUrl)
            const duplicateHeaders: Array<Record<string, string>> = [
                {
                    Authorization: 'Bearer first-secret',
                    authorization: 'Bearer second-secret',
                },
                {
                    'x-api-key': 'same-secret',
                    'X-API-KEY': 'same-secret',
                },
            ]
            for (const headers of duplicateHeaders) {
                // noinspection ES6RedundantAwait
                await expect(
                    modelsApi.fetchClaudeModelsViaApiCall(
                        baseUrl,
                        undefined,
                        headers,
                        undefined,
                        undefined,
                        discovery,
                    ),
                ).rejects.toThrow('Duplicate credential header')
            }
            expect(requestCount).toBe(0)
        } finally {
            apiCallApi.request = originalRequest
        }
    })

    test('distinguishes masked keys from draft keys containing ellipses', () => {
        const draft = prepareApiCallAuth({
                                             apiKey: 'key...tail',
                                             authIndex: 'claude:stored',
                                             apiKeyIsMasked: false,
                                             preferredHeader: 'Authorization',
                                             authorizationScheme: 'Bearer',
                                         })
        expect(draft).toEqual({
                                  headers: { Authorization: 'Bearer $TOKEN$' },
                                  draftToken: 'key...tail',
                              })

        const masked = prepareApiCallAuth({
                                              apiKey: 'sk-m...tail',
                                              authIndex: 'claude:stored',
                                              preferredHeader: 'Authorization',
                                              authorizationScheme: 'Bearer',
                                          })
        expect(masked).toEqual({
                                   headers: { Authorization: 'Bearer $TOKEN$' },
                                   draftToken: undefined,
                               })
    })

    test('uses explicit edit intent for masked custom credential headers', () => {
        const draft = prepareApiCallAuth({
                                             headers: { Authorization: 'Bearer key...tail' },
                                             authIndex: 'claude:stored',
                                             preferredHeader: 'x-api-key',
                                             headerNames: ['Authorization'],
                                             maskedHeaderNames: [],
                                         })
        expect(draft).toEqual({
                                  headers: { Authorization: 'Bearer $TOKEN$' },
                                  draftToken: 'key...tail',
                              })

        const masked = prepareApiCallAuth({
                                              headers: { Authorization: 'Bearer key...tail' },
                                              authIndex: 'claude:stored',
                                              preferredHeader: 'x-api-key',
                                              headerNames: ['Authorization'],
                                              maskedHeaderNames: ['authorization'],
                                          })
        expect(masked).toEqual({
                                   headers: { Authorization: 'Bearer $TOKEN$' },
                                   draftToken: undefined,
                               })
    })

    test('tracks credential edit intent across Claude editor route layers', () => {
        const key   = 'claude:test-credential-intent'
        const store = useClaudeEditDraftStore.getState()
        store.clearDraft(key)
        store.initDraft(key, {
            baselineSignature: '',
            form: {
                apiKey: 'key...tail',
                headers: [{ key: 'Authorization', value: 'Bearer key...tail' }],
                modelEntries: [{ name: '', alias: '' }],
                excludedText: '',
            },
            testModel: '',
            testStatus: 'idle',
            testMessage: '',
            apiKeyEdited: false,
            editedCredentialHeaderNames: [],
            originalAuthIndex: 'claude:stored',
            originalApiKey: 'key...tail',
            originalHeaders: { Authorization: 'Bearer key...tail' },
        })
        store.markDraftApiKeyEdited(key)
        store.markDraftCredentialHeadersEdited(key, ['Authorization', 'X-Client-Key'])
        const draft = useClaudeEditDraftStore.getState().drafts[key]
        expect(draft?.apiKeyEdited).toBe(true)
        expect(draft?.editedCredentialHeaderNames).toEqual(['authorization', 'x-client-key'])
        expect(draft?.originalAuthIndex).toBe('claude:stored')
        expect(draft?.originalHeaders).toEqual({ Authorization: 'Bearer key...tail' })
        useClaudeEditDraftStore.getState().clearDraft(key)
    })

    test('recognizes general key headers as credential material', () => {
        expect(isCredentialHeaderName('X-Client-Key')).toBe(true)
        expect(isCredentialHeaderName('X-Access-Key')).toBe(true)
        expect(isCredentialHeaderName('Monkey')).toBe(false)
    })

    test('adds Bearer to shared Authorization token placeholders', async () => {
        const originalRequest                        = apiCallApi.request
        let captured: Record<string, unknown> | null = null
        apiCallApi.request                           = async (payload) => {
            captured = payload as unknown as Record<string, unknown>
            return {
                statusCode: 200,
                header: {},
                bodyText: '{"data":[]}',
                body: { data: [] },
            }
        }
        try {
            await modelsApi.fetchModelsViaApiCall(
                'https://api.deepseek.com',
                'deepseek-secret-key',
                { Authorization: '$TOKEN$' },
            )
            expect(captured).toMatchObject({
                                               header: { Authorization: 'Bearer $TOKEN$' },
                                               draftToken: 'deepseek-secret-key',
                                           })
        } finally {
            apiCallApi.request = originalRequest
        }
    })

    test('does not deduplicate concurrent requests that use draft credentials', async () => {
        const originalRequest          = apiCallApi.request
        const capturedTokens: string[] = []
        apiCallApi.request             = async (payload) => {
            const draftToken = String(payload.draftToken ?? '')
            capturedTokens.push(draftToken)
            return {
                statusCode: 200,
                header: {},
                bodyText: JSON.stringify({ data: [{ id: draftToken }] }),
                body: { data: [{ id: draftToken }] },
            }
        }
        try {
            const baseUrl   = 'https://api.deepseek.com/anthropic'
            const discovery = resolveClaudeModelDiscovery(baseUrl)
            const keys      = [
                'sk-JEu1QYjnbabJXoTS',
                'sk-ushP34ck6W9vznF9',
                'draft...one',
                'draft...two',
            ]
            const results   = await Promise.all(
                keys.map((key) =>
                             modelsApi.fetchClaudeModelsViaApiCall(baseUrl, key, {}, undefined, undefined, discovery),
                ),
            )
            expect(capturedTokens).toEqual(keys)
            results.forEach((models, index) => expect(models.map((model) => model.name)).toEqual([keys[index]]))
        } finally {
            apiCallApi.request = originalRequest
        }
    })

    test('deduplicates DeepSeek requests after removing custom credential headers', async () => {
        const originalRequest                                            = apiCallApi.request
        const capturedHeaders: Array<Record<string, string> | undefined> = []
        apiCallApi.request                                               = async (payload) => {
            capturedHeaders.push(payload.header)
            return {
                statusCode: 200,
                header: {},
                bodyText: '{"data":[]}',
                body: { data: [] },
            }
        }
        try {
            const baseUrl   = 'https://api.deepseek.com/anthropic'
            const discovery = resolveClaudeModelDiscovery(baseUrl)
            await Promise.all([
                                  modelsApi.fetchClaudeModelsViaApiCall(
                                      baseUrl,
                                      undefined,
                                      { 'X-Client-Key': 'client-secret-a $TOKEN$' },
                                      undefined,
                                      'claude:stored',
                                      discovery,
                                  ),
                                  modelsApi.fetchClaudeModelsViaApiCall(
                                      baseUrl,
                                      undefined,
                                      { 'X-Client-Key': 'client-secret-b $TOKEN$' },
                                      undefined,
                                      'claude:stored',
                                      discovery,
                                  ),
                              ])
            expect(capturedHeaders).toEqual([{ Authorization: 'Bearer $TOKEN$' }])
        } finally {
            apiCallApi.request = originalRequest
        }
    })

    test('redacts complete sensitive header values from provider errors', () => {
        const message = getApiCallErrorMessage({
                                                   statusCode: 401,
                                                   header: {},
                                                   bodyText: [
                                                       'Authorization: "Basic cHJveHk6c2VjcmV0"',
                                                       'Proxy-Authorization: Basic cHJveHk6c2VjcmV0',
                                                       'Cookie: session="cookie-secret"; refresh=secret2',
                                                       '{"token":"plain-token-value"}',
                                                       ['{"token":"orange', 'violet"}'].join(String.fromCodePoint(39)),
                                                       String.raw`{"refresh_token":"escaped-prefix\"escaped-suffix"}`,
                                                       'key=plain-key-value',
                                                       '{"password":"hunter two"}',
                                                       'secret="alpha beta"',
                                                       'X-Client-Key: plain-client-key',
                                                       'https://example.test/path?api_key=query-secret&z=2#fragment',
                                                   ].join('\n'),
                                                   body: null,
                                               })
        expect(message).not.toContain('cHJveHk6c2VjcmV0')
        expect(message).not.toContain('cookie-secret')
        expect(message).not.toContain('refresh=secret2')
        expect(message).not.toContain('plain-token-value')
        expect(message).not.toContain('orange')
        expect(message).not.toContain('violet')
        expect(message).not.toContain('escaped-prefix')
        expect(message).not.toContain('escaped-suffix')
        expect(message).not.toContain('plain-key-value')
        expect(message).not.toContain('hunter two')
        expect(message).not.toContain('alpha beta')
        expect(message).not.toContain('plain-client-key')
        expect(message).not.toContain('query-secret')
        expect(message).toContain('Authorization: [REDACTED]')
        expect(message).toContain('?api_key=[REDACTED]&z=2#fragment')
    })

    test('builds collision-free auto-fetch signatures without credential material', () => {
        const first  = buildProviderAutoFetchSignature(
            'https://api.deepseek.com/models',
            7,
            'claude:stored',
        )
        const second = buildProviderAutoFetchSignature(
            'https://api.deepseek.com/models',
            8,
            'claude:stored',
        )
        expect(first).not.toBe(second)
        expect(first).not.toContain('provider-secret')
        expect(first).not.toContain('proxy-secret')
    })

    test('keeps connectivity signatures collision-free when header values contain delimiters', () => {
        const common = {
            apiKey: 'key',
            baseUrl: 'https://example.test',
            proxyUrl: '',
            testModel: 'model',
            modelEntries: [{ name: 'model', alias: '' }],
        }
        const single = buildProviderConnectivityTestSignature({
                                                                  ...common,
                                                                  headers: [{ key: 'a', value: 'b|c:d' }],
                                                              })
        const split  = buildProviderConnectivityTestSignature({
                                                                  ...common,
                                                                  headers: [
                                                                      { key: 'a', value: 'b' },
                                                                      { key: 'c', value: 'd' },
                                                                  ],
                                                              })

        expect(single).not.toBe(split)
    })

    test('requires a model selection before applying discovery results', () => {
        expect(canApplyDiscoveredModels(0, false, false, false)).toBe(false)
        expect(canApplyDiscoveredModels(1, false, false, false)).toBe(true)
        expect(canApplyDiscoveredModels(1, true, false, false)).toBe(false)
        expect(canApplyDiscoveredModels(1, false, true, false)).toBe(false)
        expect(canApplyDiscoveredModels(1, false, false, true)).toBe(false)
    })

    test('keeps connectivity tests tied to the current proxy and request lifetime', () => {
        const claudeSource       = readFileSync(
            new URL('../src/pages/AiProvidersClaudeEditPage.tsx', import.meta.url),
            'utf8',
        )
        const claudeLayoutSource = readFileSync(
            new URL('../src/pages/AiProvidersClaudeEditLayout.tsx', import.meta.url),
            'utf8',
        )
        const openaiSource       = readFileSync(
            new URL('../src/pages/AiProvidersOpenAIEditPage.tsx', import.meta.url),
            'utf8',
        )
        expect(claudeSource).toContain('proxyUrl: form.proxyUrl?.trim() || undefined')
        expect(claudeSource).toContain('form.authIndex?.trim() ?? \'\'')
        expect(claudeSource).toContain('onApiKeyChange={updateApiKey}')
        expect(providerFormFieldsSource).toContain('onApiKeyChange(event.target.value)')
        expect(claudeSource).toContain('maskedHeaderNames: maskedCredentialHeaderNames')
        expect(claudeLayoutSource).toContain('authIndex: existing.authIndex')
        expect(claudeLayoutSource).toContain('findProviderConfigIndexByAuthIndex(configs, form.authIndex')
        expect(claudeLayoutSource).toContain('originalAuthIndex: data.authIndex')
        expect(openaiSource).toContain('const controlsDisabled = saving || disableControls || isTesting')
        expect(openaiSource).toContain('signal: controller.signal')
        expect(openaiSource).toContain('errorCode === \'ERR_CANCELED\'')
    })
})

describe('provider locale contract', () => {
    test('keeps all locale key sets aligned', () => {
        const localeNames = ['en', 'ru', 'zh-CN', 'zh-TW']
        const keySets     = localeNames.map((name) => {
            const locale = JSON.parse(
                readFileSync(new URL(`../src/i18n/locales/${name}.json`, import.meta.url), 'utf8'),
            )
            return flattenKeys(locale).sort()
        })
        keySets.slice(1).forEach((keys) => expect(keys).toEqual(keySets[0]))
    })
})
