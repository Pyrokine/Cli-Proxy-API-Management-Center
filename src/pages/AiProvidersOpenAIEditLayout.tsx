import type {ModelEntry, OpenAIFormState} from '@/components/providers/types'
import {buildApiKeyEntry} from '@/components/providers/utils'
import {entriesToModels, modelsToEntries} from '@/components/ui/modelInputListUtils'
import {useProviderEditLayout} from '@/hooks/useProviderEditLayout'
import {providersApi} from '@/services/api'
import {useConfigStore, useNotificationStore, useOpenAIEditDraftStore} from '@/stores'
import type {KeyTestStatus} from '@/stores/useOpenAIEditDraftStore'
import type {ApiKeyEntry, OpenAIProviderConfig} from '@/types'
import {buildHeaderObject, headersToEntries, normalizeHeaderEntries} from '@/utils/headers'
import {getErrorMessage} from '@/utils/helpers'
import type {ModelInfo} from '@/utils/models'
import type {Dispatch, SetStateAction} from 'react'
import {useCallback} from 'react'
import {useTranslation} from 'react-i18next'
import {Outlet} from 'react-router-dom'

export type OpenAIEditOutletContext = {
    hasIndexParam: boolean;
    editIndex: number | null;
    invalidIndexParam: boolean;
    invalidIndex: boolean;
    disableControls: boolean;
    loading: boolean;
    saving: boolean;
    form: OpenAIFormState;
    setForm: Dispatch<SetStateAction<OpenAIFormState>>;
    testModel: string;
    setTestModel: Dispatch<SetStateAction<string>>;
    testStatus: 'idle' | 'loading' | 'success' | 'error';
    setTestStatus: Dispatch<SetStateAction<'idle' | 'loading' | 'success' | 'error'>>;
    testMessage: string;
    setTestMessage: Dispatch<SetStateAction<string>>;
    keyTestStatuses: KeyTestStatus[];
    setDraftKeyTestStatus: (keyIndex: number, status: KeyTestStatus) => void;
    resetDraftKeyTestStatuses: (count: number) => void;
    availableModels: string[];
    handleBack: () => void;
    handleSave: () => Promise<void>;
    mergeDiscoveredModels: (selectedModels: ModelInfo[]) => void;
};

/* ------------------------------------------------------------------ */
/*  Signature helpers                                                  */
/* ------------------------------------------------------------------ */

const normalizeModelEntries = (entries: ModelEntry[]) =>
    (entries ?? []).reduce<Array<{ name: string; alias: string }>>((acc, entry) => {
        const name = String(entry?.name ?? '').trim()
        let alias  = String(entry?.alias ?? '').trim()
        if (name && (alias === '' || alias === name)) {
            alias = ''
        }
        if (!name && !alias) {
            return acc
        }
        acc.push({ name, alias })
        return acc
    }, [])

const normalizeKeyHeaders = (headers: ApiKeyEntry['headers']) => {
    if (!headers || typeof headers !== 'object') {
        return []
    }
    return Object.entries(headers)
                 .map(([key, value]) => ({ key: String(key ?? '').trim(), value: String(value ?? '').trim() }))
                 .filter((entry) => entry.key || entry.value)
                 .sort((a, b) => {
                     const byKey = a.key.toLowerCase().localeCompare(b.key.toLowerCase())
                     if (byKey !== 0) {
                         return byKey
                     }
                     return a.value.localeCompare(b.value)
                 })
}

const normalizeApiKeyEntries = (entries: ApiKeyEntry[]) =>
    (entries ?? []).reduce<
        Array<{
            apiKey: string;
            proxyUrl: string;
            headers: Array<{ key: string; value: string }>;
        }>
    >((acc, entry) => {
        const apiKey   = String(entry?.apiKey ?? '').trim()
        const proxyUrl = String(entry?.proxyUrl ?? '').trim()
        const headers  = normalizeKeyHeaders(entry?.headers)
        if (!apiKey && !proxyUrl && headers.length === 0) {
            return acc
        }
        acc.push({ apiKey, proxyUrl, headers })
        return acc
    }, [])

const buildOpenAISignature = (form: OpenAIFormState, testModel: string) =>
    JSON.stringify({
                       name: String(form.name ?? '').trim(),
                       priority: form.priority !== undefined && Number.isFinite(form.priority) ?
                                 Math.trunc(form.priority) :
                                 null,
                       prefix: String(form.prefix ?? '').trim(),
                       baseUrl: String(form.baseUrl ?? '').trim(),
                       headers: normalizeHeaderEntries(form.headers),
                       apiKeyEntries: normalizeApiKeyEntries(form.apiKeyEntries),
                       models: normalizeModelEntries(form.modelEntries),
                       testModel: String(testModel ?? '').trim(),
                   })

const buildEmptyForm = (): OpenAIFormState => ({
    name: '',
    priority: undefined,
    prefix: '',
    baseUrl: '',
    headers: [],
    apiKeyEntries: [buildApiKeyEntry()],
    modelEntries: [{ name: '', alias: '' }],
    testModel: undefined,
})

/* ------------------------------------------------------------------ */
/*  Component                                                          */

/* ------------------------------------------------------------------ */

export function AiProvidersOpenAIEditLayout() {
    const { t }                = useTranslation()
    const { showNotification } = useNotificationStore()
    const fetchConfig          = useConfigStore((state) => state.fetchConfig)

    /* ---- OpenAI-specific draft store selectors (keyTestStatuses) ---- */
    const draftStore                   = useOpenAIEditDraftStore
    const rawDrafts                    = draftStore((state) => state.drafts)
    const rawSetDraftKeyTestStatus     = draftStore((state) => state.setDraftKeyTestStatus)
    const rawResetDraftKeyTestStatuses = draftStore((state) => state.resetDraftKeyTestStatuses)

    const buildEmptyDraftInit = useCallback(
        () => ({
            form: buildEmptyForm(),
            testModel: '',
            testStatus: 'idle' as const,
            testMessage: '',
            keyTestStatuses: [] as KeyTestStatus[],
        }),
        [],
    )

    const seedDraftInit = useCallback((data: OpenAIProviderConfig) => {
        const modelEntries                = modelsToEntries(data.models)
        const seededForm: OpenAIFormState = {
            name: data.name,
            priority: data.priority,
            prefix: data.prefix ?? '',
            baseUrl: data.baseUrl,
            headers: headersToEntries(data.headers),
            testModel: data.testModel,
            modelEntries,
            apiKeyEntries: data.apiKeyEntries?.length ? data.apiKeyEntries : [buildApiKeyEntry()],
        }

        const available        = modelEntries.map((entry) => entry.name.trim()).filter(Boolean)
        const initialTestModel = data.testModel && available.includes(data.testModel) ?
                                 data.testModel :
                                 available[0] || ''

        return {
            form: seededForm,
            testModel: initialTestModel,
            testStatus: 'idle' as const,
            testMessage: '',
            keyTestStatuses: [] as KeyTestStatus[],
        }
    }, [])

    const onSave = useCallback(
        async (ctx: {
            form: OpenAIFormState;
            testModel: string;
            editIndex: number | null;
            configs: OpenAIProviderConfig[];
            setConfigs: Dispatch<SetStateAction<OpenAIProviderConfig[]>>;
            setSaving: Dispatch<SetStateAction<boolean>>;
            allowNextNavigation: () => void;
            updateBaselineSignature: (signature: string) => void;
            handleBack: () => void;
        }) => {
            const { form, testModel, editIndex, configs, setConfigs, setSaving, handleBack } = ctx
            const name                                                                       = form.name.trim()
            const baseUrl                                                                    = form.baseUrl.trim()

            if (!name || !baseUrl) {
                showNotification(t('notification.openai_provider_required'), 'error')
                return
            }

            setSaving(true)
            try {
                const payload: OpenAIProviderConfig = {
                    name,
                    prefix: form.prefix?.trim() || undefined,
                    baseUrl,
                    headers: buildHeaderObject(form.headers),
                    apiKeyEntries: form.apiKeyEntries.map((entry: ApiKeyEntry) => ({
                        apiKey: entry.apiKey.trim(),
                        proxyUrl: entry.proxyUrl?.trim() || undefined,
                        headers: entry.headers,
                    })),
                }
                if (form.priority !== undefined && Number.isFinite(form.priority)) {
                    payload.priority = Math.trunc(form.priority)
                }
                const resolvedTestModel = testModel.trim()
                if (resolvedTestModel) {
                    payload.testModel = resolvedTestModel
                }
                const models = entriesToModels(form.modelEntries)
                if (models.length) {
                    payload.models = models
                }

                const nextList =
                          editIndex !== null ?
                          configs.map((item, idx) => (idx === editIndex ? payload : item)) :
                              [...configs, payload]

                await providersApi.saveOpenAIProviders(nextList)

                let syncedProviders = nextList
                try {
                    const latest = await fetchConfig('openai-compatibility', true)
                    if (Array.isArray(latest)) {
                        syncedProviders = latest as OpenAIProviderConfig[]
                    }
                } catch {
                    // 保存成功后刷新失败时，回退到本地计算结果，避免页面数据为空或回退
                }

                setConfigs(syncedProviders)
                showNotification(
                    editIndex !== null ?
                    t('notification.openai_provider_updated') :
                    t('notification.openai_provider_added'),
                    'success',
                )
                ctx.allowNextNavigation()
                ctx.updateBaselineSignature(buildOpenAISignature(form, testModel))
                handleBack()
            } catch (err: unknown) {
                showNotification(`${t('notification.update_failed')}: ${getErrorMessage(err)}`, 'error')
            } finally {
                setSaving(false)
            }
        },
        [fetchConfig, showNotification, t],
    )

    const layout = useProviderEditLayout({
                                             configKey: 'openai-compatibility',
                                             draftKeyPrefix: 'openai',
                                             routePrefix: '/ai-providers/openai',
                                             useDraftStore: draftStore,
                                             extractConfigs: (config) => config?.openaiCompatibility ?? [],
                                             buildEmptyDraftInit,
                                             buildSignature: buildOpenAISignature,
                                             seedDraftInit,
                                             mergeNotificationKey: 'ai_providers.openai_models_fetch_added',
                                             onSave,
                                         })

    /* ---- OpenAI-specific: keyTestStatuses bound to current draftKey ---- */
    const { draftKey }    = layout
    const keyTestStatuses = rawDrafts[draftKey]?.keyTestStatuses ?? []

    const handleSetDraftKeyTestStatus = useCallback(
        (keyIndex: number, status: KeyTestStatus) => {
            rawSetDraftKeyTestStatus(draftKey, keyIndex, status)
        },
        [draftKey, rawSetDraftKeyTestStatus],
    )

    const handleResetDraftKeyTestStatuses = useCallback(
        (count: number) => {
            rawResetDraftKeyTestStatuses(draftKey, count)
        },
        [draftKey, rawResetDraftKeyTestStatuses],
    )

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
                    keyTestStatuses,
                    setDraftKeyTestStatus: handleSetDraftKeyTestStatus,
                    resetDraftKeyTestStatuses: handleResetDraftKeyTestStatuses,
                    availableModels: layout.availableModels,
                    handleBack: layout.handleBack,
                    handleSave: layout.handleSave,
                    mergeDiscoveredModels: layout.mergeDiscoveredModels,
                } satisfies OpenAIEditOutletContext
            }
        />
    )
}
