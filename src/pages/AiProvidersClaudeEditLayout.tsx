import type {ProviderFormState} from '@/components/providers/types'
import {excludedModelsToText, parseTextList} from '@/components/providers/utils'
import {modelsToEntries} from '@/components/ui/modelInputListUtils'
import {useProviderEditLayout} from '@/hooks/useProviderEditLayout'
import {providersApi} from '@/services/api'
import {useClaudeEditDraftStore, useConfigStore, useNotificationStore} from '@/stores'
import type {ProviderKeyConfig} from '@/types'
import {buildHeaderObject, headersToEntries, normalizeHeaderEntries} from '@/utils/headers'
import {getErrorMessage} from '@/utils/helpers'
import type {ModelInfo} from '@/utils/models'
import type {Dispatch, SetStateAction} from 'react'
import {useCallback} from 'react'
import {useTranslation} from 'react-i18next'
import {Outlet} from 'react-router-dom'

type TestStatus = 'idle' | 'loading' | 'success' | 'error'

export type ClaudeEditOutletContext = {
    hasIndexParam: boolean
    editIndex: number | null
    invalidIndexParam: boolean
    invalidIndex: boolean
    disableControls: boolean
    loading: boolean
    saving: boolean
    form: ProviderFormState
    setForm: Dispatch<SetStateAction<ProviderFormState>>
    testModel: string
    setTestModel: Dispatch<SetStateAction<string>>
    testStatus: TestStatus
    setTestStatus: Dispatch<SetStateAction<TestStatus>>
    testMessage: string
    setTestMessage: Dispatch<SetStateAction<string>>
    availableModels: string[]
    handleBack: () => void
    handleSave: () => Promise<void>
    mergeDiscoveredModels: (selectedModels: ModelInfo[]) => void
}

/* ------------------------------------------------------------------ */
/*  Signature helpers                                                  */
/* ------------------------------------------------------------------ */

const normalizeClaudeModelEntries = (entries: Array<{ name: string; alias: string }>) =>
    (entries ?? []).reduce<Array<{ name: string; alias: string }>>((acc, entry) => {
        const name = String(entry?.name ?? '').trim()
        let alias  = String(entry?.alias ?? '').trim()
        if (name) {
            alias = alias || name
        }
        if (!name && !alias) {
            return acc
        }
        acc.push({ name, alias })
        return acc
    }, [])

const normalizeCloakConfig = (cloak: ProviderFormState['cloak']) => {
    if (!cloak) {
        return null
    }
    const mode           =
              String(cloak.mode ?? '')
                  .trim()
                  .toLowerCase() || 'auto'
    const strictMode     = Boolean(cloak.strictMode)
    const sensitiveWords = Array.isArray(cloak.sensitiveWords)
                           ? cloak.sensitiveWords.map((word) => String(word ?? '').trim()).filter(Boolean)
                           : []
    return {
        mode,
        strictMode,
        sensitiveWords: sensitiveWords.length ? sensitiveWords : null,
    }
}

const buildClaudeSignature = (form: ProviderFormState, _testModel: string) =>
    JSON.stringify({
                       apiKey: String(form.apiKey ?? '').trim(),
                       priority: form.priority !== undefined && Number.isFinite(form.priority) ?
                                 Math.trunc(form.priority) :
                                 null,
                       prefix: String(form.prefix ?? '').trim(),
                       baseUrl: String(form.baseUrl ?? '').trim(),
                       proxyUrl: String(form.proxyUrl ?? '').trim(),
                       headers: normalizeHeaderEntries(form.headers),
                       models: normalizeClaudeModelEntries(form.modelEntries),
                       excludedModels: parseTextList(form.excludedText ?? ''),
                       cloak: normalizeCloakConfig(form.cloak),
                   })

const buildEmptyForm = (): ProviderFormState => ({
    apiKey: '',
    priority: undefined,
    prefix: '',
    baseUrl: '',
    proxyUrl: '',
    headers: [],
    models: [],
    excludedModels: [],
    modelEntries: [{ name: '', alias: '' }],
    excludedText: '',
})

/* ------------------------------------------------------------------ */
/*  Component                                                          */

/* ------------------------------------------------------------------ */

export function AiProvidersClaudeEditLayout() {
    const { t }                = useTranslation()
    const { showNotification } = useNotificationStore()
    const updateConfigValue    = useConfigStore((state) => state.updateConfigValue)
    const clearCache           = useConfigStore((state) => state.clearCache)

    const buildEmptyDraftInit = useCallback(
        () => ({
            form: buildEmptyForm(),
            testModel: '',
            testStatus: 'idle' as const,
            testMessage: '',
        }),
        [],
    )

    const seedDraftInit = useCallback((data: ProviderKeyConfig) => {
        const seededForm: ProviderFormState = {
            ...data,
            headers: headersToEntries(data.headers),
            modelEntries: modelsToEntries(data.models),
            excludedText: excludedModelsToText(data.excludedModels),
        }
        const available                     = seededForm.modelEntries.map((e) => e.name.trim()).filter(Boolean)
        return {
            form: seededForm,
            testModel: available[0] || '',
            testStatus: 'idle' as const,
            testMessage: '',
        }
    }, [])

    const onSave = useCallback(
        async (ctx: {
            form: ProviderFormState
            editIndex: number | null
            configs: ProviderKeyConfig[]
            setConfigs: Dispatch<SetStateAction<ProviderKeyConfig[]>>
            setSaving: Dispatch<SetStateAction<boolean>>
            allowNextNavigation: () => void
            updateBaselineSignature: (signature: string) => void
            handleBack: () => void
        }) => {
            const { form, editIndex, configs, setConfigs, setSaving, handleBack } = ctx

            setSaving(true)
            try {
                const payload: ProviderKeyConfig = {
                    apiKey: form.apiKey.trim(),
                    priority: form.priority !== undefined ? Math.trunc(form.priority) : undefined,
                    prefix: form.prefix?.trim() || undefined,
                    baseUrl: (form.baseUrl ?? '').trim() || undefined,
                    proxyUrl: form.proxyUrl?.trim() || undefined,
                    headers: buildHeaderObject(form.headers),
                    models: form.modelEntries
                                .map((entry) => {
                                    const name = entry.name.trim()
                                    if (!name) {
                                        return null
                                    }
                                    const alias = entry.alias.trim()
                                    return { name, alias: alias || name }
                                })
                                .filter(Boolean) as ProviderKeyConfig['models'],
                    excludedModels: parseTextList(form.excludedText),
                    cloak: form.cloak,
                }

                const nextList =
                          editIndex !== null
                          ? configs.map((item, idx) => (idx === editIndex ? payload : item))
                          : [...configs, payload]

                await providersApi.saveClaudeConfigs(nextList)
                setConfigs(nextList)
                updateConfigValue('claude-api-key', nextList)
                clearCache('claude-api-key')
                showNotification(
                    editIndex !== null
                    ? t('notification.claude_config_updated')
                    : t('notification.claude_config_added'),
                    'success',
                )
                ctx.allowNextNavigation()
                ctx.updateBaselineSignature(buildClaudeSignature(form, ''))
                handleBack()
            } catch (err: unknown) {
                showNotification(`${t('notification.update_failed')}: ${getErrorMessage(err)}`, 'error')
            } finally {
                setSaving(false)
            }
        },
        [clearCache, showNotification, t, updateConfigValue],
    )

    const layout = useProviderEditLayout({
                                             configKey: 'claude-api-key',
                                             draftKeyPrefix: 'claude',
                                             routePrefix: '/credentials/claude',
                                             useDraftStore: useClaudeEditDraftStore,
                                             extractConfigs: (config) => config?.claudeApiKeys ?? [],
                                             buildEmptyDraftInit,
                                             buildSignature: buildClaudeSignature,
                                             seedDraftInit,
                                             mergeNotificationKey: 'ai_providers.claude_models_fetch_added',
                                             onSave,
                                         })

    return (
        <Outlet
            context={
                {
                    hasIndexParam: layout.hasIndexParam,
                    editIndex: layout.editIndex,
                    invalidIndexParam: layout.invalidIndexParam,
                    invalidIndex: layout.invalidIndex,
                    disableControls: layout.disableControls,
                    loading: layout.loading,
                    saving: layout.saving,
                    form: layout.form,
                    setForm: layout.setForm,
                    testModel: layout.testModel,
                    setTestModel: layout.setTestModel,
                    testStatus: layout.testStatus,
                    setTestStatus: layout.setTestStatus,
                    testMessage: layout.testMessage,
                    setTestMessage: layout.setTestMessage,
                    availableModels: layout.availableModels,
                    handleBack: layout.handleBack,
                    handleSave: layout.handleSave,
                    mergeDiscoveredModels: layout.mergeDiscoveredModels,
                } satisfies ClaudeEditOutletContext
            }
        />
    )
}
