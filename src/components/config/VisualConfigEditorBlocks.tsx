import {Button} from '@/components/ui/Button'
import {IconChevronLeft, IconChevronRight, IconEye, IconEyeOff} from '@/components/ui/icons'
import {Input} from '@/components/ui/Input'
import {Modal} from '@/components/ui/Modal'
import {Pagination} from '@/components/ui/Pagination'
import {Select} from '@/components/ui/Select'
import {usePagination} from '@/hooks/usePagination'
import {
    getPayloadParamValidationError,
    VISUAL_CONFIG_PAYLOAD_VALUE_TYPE_OPTIONS,
    VISUAL_CONFIG_PROTOCOL_OPTIONS,
} from '@/hooks/useVisualConfig'
import {apiKeyAliasApi} from '@/services/api/apiKeys'
import {type ModelCatalogRow, modelsApi} from '@/services/api/models'
import {useAuthStore, useConfigStore, useNotificationStore} from '@/stores'
import type {
    ApiKeyModelRule,
    PayloadFilterRule,
    PayloadModelEntry,
    PayloadParamEntry,
    PayloadParamValidationErrorCode,
    PayloadParamValueType,
    PayloadRule,
} from '@/types/visualConfig'
import {makeClientId} from '@/types/visualConfig'
import {copyToClipboard} from '@/utils/clipboard'
import {maskApiKey} from '@/utils/format'
import {
    buildModelTree,
    countModelLeaves,
    getGloballyExcludedModelKeys,
    isModelGloballyExcluded,
    modelLeaves,
    type ModelTreeNode,
    selectionState,
} from '@/utils/modelTree'
import {isValidApiKey} from '@/utils/validation'
import {Fragment, memo, type ReactNode, useCallback, useEffect, useId, useMemo, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'
import styles from './VisualConfigEditor.module.scss'

type ModelLimitCatalogEntry = {
    model: string
    provider?: string
    group?: string
}

function modelKey(model: string): string {
    return model.trim().toLowerCase()
}

function uniqueSorted(models: Iterable<string>): string[] {
    const seen          = new Set<string>()
    const out: string[] = []
    for (const model of models) {
        const trimmed = model.trim()
        const key     = modelKey(trimmed)
        if (!trimmed || seen.has(key)) {
            continue
        }
        seen.add(key)
        out.push(trimmed)
    }
    return out.sort((a, b) => a.localeCompare(b))
}

function modelLimitKeyCandidates(model: string): string[] {
    const key = modelKey(model)
    if (!key) {
        return []
    }
    const withoutModels = key.startsWith('models/') ? key.slice('models/'.length) : key
    return Array.from(new Set([key, withoutModels, `models/${withoutModels}`]))
}

function modelLimitKeySet(models: Iterable<string>): Set<string> {
    const keys = new Set<string>()
    for (const model of models) {
        modelLimitKeyCandidates(model).forEach((key) => keys.add(key))
    }
    return keys
}

function modelLimitMatches(keys: Set<string>, model: string): boolean {
    return modelLimitKeyCandidates(model).some((key) => keys.has(key))
}

function removeModelLimitMatches(models: Set<string>, model: string): void {
    const removeKeys = new Set(modelLimitKeyCandidates(model))
    for (const existing of Array.from(models)) {
        if (modelLimitKeyCandidates(existing).some((key) => removeKeys.has(key))) {
            models.delete(existing)
        }
    }
}

function catalogModelEntries(rows: ModelCatalogRow[]): ModelLimitCatalogEntry[] {
    const seen                              = new Set<string>()
    const entries: ModelLimitCatalogEntry[] = []
    for (const row of rows) {
        const model = row.name.trim()
        const key   = modelKey(model)
        if (!model || seen.has(key)) {
            continue
        }
        seen.add(key)
        entries.push({
                         model,
                         provider: row.provider.trim() || undefined,
                         group: row.group.trim() || undefined,
                     })
    }
    return entries.sort((a, b) => a.model.localeCompare(b.model))
}

function buildCatalogAliasLabelsByModel(rows: ModelCatalogRow[]): Map<string, string[]> {
    const labelsByModel = new Map<string, string[]>()
    for (const row of rows) {
        const name = row.name.trim()
        if (!name) {
            continue
        }
        const labelPrefix = row.channel.trim() ? channelLabel(row.channel.trim().toLowerCase()) : row.provider.trim()
        const labels      = uniqueSorted((row.aliases ?? []).map((alias) => {
            const trimmed = alias.trim()
            return trimmed && labelPrefix ? `${labelPrefix}: ${trimmed}` : trimmed
        }))
        if (labels.length > 0) {
            labelsByModel.set(modelKey(name), labels)
        }
    }
    return labelsByModel
}

function getModelLimitUnavailableSummary(
    t: ReturnType<typeof useTranslation>['t'],
    models: string[],
): string {
    const preview = models.slice(0, 6).join('、')
    const suffix  = models.length > 6 ? ` 等 ${models.length} 个` : `${models.length} 个`
    return t('config_management.visual.api_keys.model_limit_global_disabled_summary', {
        count: models.length,
        models: preview,
        defaultValue: `全局禁用 ${suffix}模型，已从 API Key 可用列表移除：${preview}`,
    })
}

function getValidationMessage(t: ReturnType<typeof useTranslation>['t'], errorCode?: PayloadParamValidationErrorCode) {
    if (!errorCode) {
        return undefined
    }
    return t(`config_management.visual.validation.${errorCode}`)
}

function channelLabel(channel: string): string {
    const labels: Record<string, string> = {
        'aistudio': 'AI Studio',
        'antigravity': 'Antigravity',
        'claude': 'Claude',
        'codex': 'Codex',
        'gemini-cli': 'Gemini CLI',
        'iflow': 'iFlow',
        'openai': 'OpenAI',
        'vertex': 'Vertex',
    }
    return labels[channel] ?? channel
}

function filterModelTreeWithAliases(
    nodes: ModelTreeNode[],
    query: string,
    aliasLabelsByModel: Map<string, string[]>,
): ModelTreeNode[] {
    const q = query.trim().toLowerCase()
    if (!q) {
        return nodes
    }
    const filtered: ModelTreeNode[] = []
    for (const node of nodes) {
        const aliasLabels = node.kind === 'model' ? aliasLabelsByModel.get(modelKey(node.id)) ?? [] : []
        const selfMatches =
                  node.label.toLowerCase().includes(q) ||
                  node.provider.toLowerCase().includes(q) ||
                  aliasLabels.some((label) => label.toLowerCase().includes(q))
        if (selfMatches) {
            filtered.push(node)
            continue
        }
        const children = node.children ? filterModelTreeWithAliases(node.children, query, aliasLabelsByModel) : []
        if (children.length > 0) {
            filtered.push({ ...node, children })
        }
    }
    return filtered
}

function buildProtocolOptions(
    t: ReturnType<typeof useTranslation>['t'],
    rules: Array<{ models: PayloadModelEntry[] }>,
) {
    const options: Array<{ value: string; label: string }> = VISUAL_CONFIG_PROTOCOL_OPTIONS.map((option) => ({
        value: option.value,
        label: t(option.labelKey, { defaultValue: option.defaultLabel }),
    }))
    const seen                                             = new Set<string>(options.map((option) => option.value))

    for (const rule of rules) {
        for (const model of rule.models) {
            const protocol = model.protocol
            if (!protocol || !protocol.trim() || seen.has(protocol)) {
                continue
            }
            seen.add(protocol)
            options.push({ value: protocol, label: protocol })
        }
    }

    return options
}

function generateTokenHex(byteLength: number): string {
    const bytes = new Uint8Array(byteLength)
    crypto.getRandomValues(bytes)
    return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')
}

function highlightText(text: string, query: string): ReactNode {
    const trimmedQuery = query.trim()
    if (!trimmedQuery) {
        return text
    }

    const lowerText          = text.toLowerCase()
    const lowerQuery         = trimmedQuery.toLowerCase()
    const nodes: ReactNode[] = []
    let cursor               = 0

    while (cursor < text.length) {
        const matchIndex = lowerText.indexOf(lowerQuery, cursor)
        if (matchIndex === -1) {
            nodes.push(<Fragment key={`text-${cursor}`}>{text.slice(cursor)}</Fragment>)
            break
        }
        if (matchIndex > cursor) {
            nodes.push(<Fragment key={`text-${cursor}`}>{text.slice(cursor, matchIndex)}</Fragment>)
        }
        const matchEnd = matchIndex + trimmedQuery.length
        nodes.push(
            <mark key={`match-${matchIndex}`} className={styles.searchHighlight}>
                {text.slice(matchIndex, matchEnd)}
            </mark>,
        )
        cursor = matchEnd
    }

    return nodes.length > 0 ? nodes : text
}

type ModelTreePanelProps = {
    title: string
    nodes: ModelTreeNode[]
    selected: Set<string>
    onToggle: (node: ModelTreeNode) => void
    onMoveModel: (model: string) => void
    emptyText: string
    emptyVariant?: 'neutral' | 'warning'
    expandMatches?: boolean
    showEmptyState?: boolean
    aliasLabelsByModel?: Map<string, string[]>
}

function collapsedModelTreeNodes(nodes: ModelTreeNode[]): Set<string> {
    const collapsed = new Set<string>()
    const collect   = (node: ModelTreeNode) => {
        if (node.children?.length) {
            collapsed.add(node.id)
            for (const child of node.children) {
                collect(child)
            }
        }
    }
    nodes.forEach(collect)
    return collapsed
}

function ModelTreePanel({
                            title,
                            nodes,
                            selected,
                            onToggle,
                            onMoveModel,
                            emptyText,
                            emptyVariant,
                            expandMatches,
                            showEmptyState = true,
                            aliasLabelsByModel,
                        }: ModelTreePanelProps) {
    const [collapsed, setCollapsed] = useState<Set<string>>(() => collapsedModelTreeNodes(nodes))
    const knownCollapsedNodes       = useRef<Set<string>>(collapsedModelTreeNodes(nodes))
    const visibleCollapsed          = expandMatches ? new Set<string>() : collapsed

    useEffect(() => {
        const nextCollapsedNodes = collapsedModelTreeNodes(nodes)
        setCollapsed((prev) => {
            const next = new Set(prev)
            nextCollapsedNodes.forEach((nodeId) => {
                if (!knownCollapsedNodes.current.has(nodeId)) {
                    next.add(nodeId)
                }
            })
            knownCollapsedNodes.current = nextCollapsedNodes
            return next
        })
    }, [nodes])

    const renderNode = (node: ModelTreeNode, depth: number): ReactNode => {
        const state       = selectionState(node, selected)
        const expandable  = Boolean(node.children?.length)
        const isExpanded  = !visibleCollapsed.has(node.id)
        const leaves      = modelLeaves(node)
        const aliasLabels = node.kind === 'model' ? aliasLabelsByModel?.get(modelKey(node.id)) ?? [] : []
        return (
            <div key={node.id} className={styles.modelTreeNodeBlock}>
                <div className={styles.modelTreeNode} style={{ paddingLeft: depth * 14 }}>
                    <button
                        type='button'
                        className={styles.modelTreeExpand}
                        onClick={() => {
                            if (!expandable) {
                                return
                            }
                            setCollapsed((prev) => {
                                const next = new Set(prev)
                                if (next.has(node.id)) {
                                    next.delete(node.id)
                                } else {
                                    next.add(node.id)
                                }
                                return next
                            })
                        }}
                        disabled={!expandable}
                    >
                        {expandable ? (isExpanded ? '▾' : '▸') : ''}
                    </button>
                    <button
                        type='button'
                        className={`${styles.modelTreeCheck} ${state === 'all' ? styles.modelTreeCheckActive : ''}`}
                        aria-pressed={state !== 'none'}
                        onClick={() => onToggle(node)}
                    >
                        {state === 'all' ? '✓' : state === 'partial' ? '−' : ''}
                    </button>
                    <button
                        type='button'
                        className={styles.modelTreeLabel}
                        onDoubleClick={() => {
                            if (node.kind === 'model') {
                                onMoveModel(node.id)
                            }
                        }}
                    >
                        <span className={styles.modelTreeName}>{node.label}</span>
                        {aliasLabels.length > 0 ? (
                            <span className={styles.modelTreeAlias} title={aliasLabels.join('\n')}>
                                {aliasLabels[0]}{aliasLabels.length > 1 ? ` +${aliasLabels.length - 1}` : ''}
                            </span>
                        ) : null}
                        {node.kind === 'model' ? <span className={styles.providerTag}>{node.provider}</span> : null}
                        {node.kind !== 'model' ? <span className={styles.modelTreeCount}>{leaves.length}</span> : null}
                    </button>
                </div>
                {expandable && isExpanded ? node.children?.map((child) => renderNode(child, depth + 1)) : null}
            </div>
        )
    }

    return (
        <section className={styles.modelLimitPanel}>
            <div className={styles.modelLimitPanelHeader}>
                <span>{title}</span>
                <span className={styles.modelTreeCount}>{countModelLeaves(nodes)}</span>
            </div>
            {nodes.length > 0 ? (
                <div className={styles.modelTree}>{nodes.map((node) => renderNode(node, 0))}</div>
            ) : showEmptyState ? (
                <div
                    className={`${styles.modelLimitEmpty} ${emptyVariant === 'warning' ?
                                                            styles.modelLimitEmptyWarning :
                                                            ''}`}
                >
                    {emptyText}
                </div>
            ) : (
                    <div className={styles.modelLimitEmptyPlaceholder} />
                )}
        </section>
    )
}

export const ApiKeysCardEditor = memo(function ApiKeysCardEditor({
                                                                     value,
                                                                     modelRules,
                                                                     disabled,
                                                                     onChange,
                                                                     onModelRulesChange,
                                                                 }: {
    value: string
    modelRules: Record<string, ApiKeyModelRule>
    disabled?: boolean
    onChange: (nextValue: string) => void
    onModelRulesChange: (nextValue: Record<string, ApiKeyModelRule>) => void
}) {
    const { t }                     = useTranslation()
    const showNotification          = useNotificationStore((state) => state.showNotification)
    const apiBase                   = useAuthStore((state) => state.apiBase)
    const connectionStatus          = useAuthStore((state) => state.connectionStatus)
    const oauthExcludedModels       = useConfigStore((state) => state.config?.oauthExcludedModels)
    const apiKeys                   = useMemo(
        () =>
            value
                .split('\n')
                .map((key) => key.trim())
                .filter(Boolean),
        [value],
    )
    const [apiKeyIds, setApiKeyIds] = useState(() => apiKeys.map(() => makeClientId()))
    const renderApiKeyIds           = useMemo(() => {
        if (apiKeyIds.length === apiKeys.length) {
            return apiKeyIds
        }
        if (apiKeyIds.length > apiKeys.length) {
            return apiKeyIds.slice(0, apiKeys.length)
        }
        return [...apiKeyIds, ...Array.from({ length: apiKeys.length - apiKeyIds.length }, () => makeClientId())]
    }, [apiKeyIds, apiKeys.length])

    const apiKeyInputId                                 = useId()
    const aliasInputId                                  = useId()
    const apiKeyHintId                                  = `${apiKeyInputId}-hint`
    const apiKeyErrorId                                 = `${apiKeyInputId}-error`
    const aliasHintId                                   = `${aliasInputId}-hint`
    const aliasErrorId                                  = `${aliasInputId}-error`
    const [modalOpen, setModalOpen]                     = useState(false)
    const [editingApiKeyId, setEditingApiKeyId]         = useState<string | null>(null)
    const [inputValue, setInputValue]                   = useState('')
    const [apiKeyVisible, setApiKeyVisible]             = useState(false)
    const [formError, setFormError]                     = useState('')
    const [aliasValue, setAliasValue]                   = useState('')
    const [aliasError, setAliasError]                   = useState('')
    const [aliases, setAliases]                         = useState<Record<string, string>>({})
    const [modelCatalogRows, setModelCatalogRows]       = useState<ModelCatalogRow[]>([])
    const [modelCatalogLoaded, setModelCatalogLoaded]   = useState(false)
    const [modelCatalogLoading, setModelCatalogLoading] = useState(false)
    const [modelCatalogError, setModelCatalogError]     = useState('')
    const [modelLimitKey, setModelLimitKey]             = useState<string | null>(null)
    const [modelLimitQuery, setModelLimitQuery]         = useState('')
    const [draftBlockedModels, setDraftBlockedModels]   = useState<Set<string>>(() => new Set())
    const [selectedAllowed, setSelectedAllowed]         = useState<Set<string>>(() => new Set())
    const [selectedBlocked, setSelectedBlocked]         = useState<Set<string>>(() => new Set())

    useEffect(() => {
        apiKeyAliasApi
            .list()
            .then(setAliases)
            .catch((err) => console.warn('Failed to load aliases:', err))
    }, [])

    const [searchQuery, setSearchQuery] = useState('')
    const showSearch                    = apiKeys.length >= 6

    const filteredKeys = useMemo(() => {
        const q = searchQuery.trim().toLowerCase()
        if (!q) {
            return apiKeys.map((key, i) => ({ key, index: i }))
        }
        return apiKeys
            .map((key, i) => ({ key, index: i }))
            .filter(({ key }) => {
                const alias = aliases[key]
                return key.toLowerCase().includes(q) || (alias?.toLowerCase().includes(q) ?? false)
            })
    }, [apiKeys, searchQuery, aliases])

    useEffect(() => {
        let cancelled = false

        const loadModelCatalog = async () => {
            if (modelLimitKey === null) {
                return
            }
            if (connectionStatus !== 'connected' || !apiBase) {
                if (!cancelled) {
                    setModelCatalogLoaded(false)
                    setModelCatalogLoading(false)
                    setModelCatalogError(t('config_management.visual.api_keys.model_catalog_disconnected', {
                        defaultValue: '管理端未连接，无法加载模型目录',
                    }))
                }
                return
            }
            setModelCatalogLoading(true)
            setModelCatalogError('')
            try {
                const catalog = await modelsApi.fetchModelCatalog()
                if (cancelled) {
                    return
                }
                setModelCatalogRows(catalog.models ?? [])
                setModelCatalogLoaded(true)
            } catch (err) {
                if (cancelled) {
                    return
                }
                console.warn('Failed to load model catalog:', err)
                setModelCatalogRows([])
                setModelCatalogLoaded(false)
                setModelCatalogError(err instanceof Error ? err.message : String(err || t('common.unknown_error')))
            } finally {
                if (!cancelled) {
                    setModelCatalogLoading(false)
                }
            }
        }

        void loadModelCatalog()
        return () => {
            cancelled = true
        }
    }, [apiBase, connectionStatus, modelLimitKey, t])

    const aliasLabelsByModel                                   = useMemo(
        () => buildCatalogAliasLabelsByModel(modelCatalogRows),
        [modelCatalogRows],
    )
    const globallyExcludedModelKeys                            = useMemo(
        () => getGloballyExcludedModelKeys(oauthExcludedModels),
        [oauthExcludedModels],
    )
    const catalogEntries                                       = useMemo(
        () => catalogModelEntries(modelCatalogRows),
        [modelCatalogRows],
    )
    const catalogModelNames                                    = useMemo(
        () => catalogEntries.map((entry) => entry.model),
        [catalogEntries],
    )
    const draftBlockedModelKeys                                = useMemo(
        () => modelLimitKeySet(draftBlockedModels),
        [draftBlockedModels],
    )
    const unavailableModelNames                                = useMemo(
        () => catalogModelNames
            .filter((model) => isModelGloballyExcluded(model, globallyExcludedModelKeys)),
        [catalogModelNames, globallyExcludedModelKeys],
    )
    const availableModelEntries                                = useMemo(
        () => catalogEntries
            .filter((entry) => !isModelGloballyExcluded(entry.model, globallyExcludedModelKeys)),
        [catalogEntries, globallyExcludedModelKeys],
    )
    const availableModelNames                                  = useMemo(
        () => availableModelEntries.map((entry) => entry.model),
        [availableModelEntries],
    )
    const modelLimitCatalogReady                               = modelCatalogLoaded &&
                                                                 !modelCatalogLoading &&
                                                                 !modelCatalogError
    const availableModelsAllBlocked                            = availableModelNames.length >
                                                                 0 &&
                                                                 availableModelNames.every((model) => modelLimitMatches(
                                                                     draftBlockedModelKeys,
                                                                     model,
                                                                 ))
    const hasVisibleBlockedModels                              = availableModelNames.some((model) => modelLimitMatches(
        draftBlockedModelKeys,
        model,
    ))
    const allowedModelTree                                     = useMemo(
        () => buildModelTree(availableModelEntries.filter((entry) => !modelLimitMatches(
            draftBlockedModelKeys,
            entry.model,
        ))),
        [availableModelEntries, draftBlockedModelKeys],
    )
    const blockedModelTree                                     = useMemo(
        () => buildModelTree(availableModelEntries.filter((entry) => modelLimitMatches(
            draftBlockedModelKeys,
            entry.model,
        ))),
        [availableModelEntries, draftBlockedModelKeys],
    )
    const filteredAllowedTree                                  = useMemo(
        () => filterModelTreeWithAliases(allowedModelTree, modelLimitQuery, aliasLabelsByModel),
        [aliasLabelsByModel, allowedModelTree, modelLimitQuery],
    )
    const filteredBlockedTree                                  = useMemo(
        () => filterModelTreeWithAliases(blockedModelTree, modelLimitQuery, aliasLabelsByModel),
        [aliasLabelsByModel, blockedModelTree, modelLimitQuery],
    )
    const hasModelLimitQuery                                   = modelLimitQuery.trim().length > 0
    const expandModelMatches                                   = hasModelLimitQuery
    const modelLimitBothPanelsEmpty                            = filteredAllowedTree.length ===
                                                                 0 &&
                                                                 filteredBlockedTree.length ===
                                                                 0
    const currentModelLimitTitle                               = modelLimitKey
                                                                 ? aliases[modelLimitKey]
                                                                   ?
                                                                   `${aliases[modelLimitKey]} · ${maskApiKey(
                                                                       modelLimitKey)}`
                                                                   :
                                                                   maskApiKey(modelLimitKey)
                                                                 : ''
    const modelLimitAllowedEmptyText                           = hasModelLimitQuery
                                                                 ?
                                                                 t(
                                                                     'config_management.visual.api_keys.model_limit_search_empty_allowed',
                                                                     {
                                                                         defaultValue: '允许列表中没有匹配模型',
                                                                     },
                                                                 )
                                                                 :
                                                                 modelCatalogLoading
                                                                 ?
                                                                 t(
                                                                     'config_management.visual.api_keys.model_limit_loading',
                                                                     {
                                                                         defaultValue: '模型列表加载中',
                                                                     },
                                                                 )
                                                                 :
                                                                 catalogModelNames.length === 0
                                                                 ?
                                                                 t(
                                                                     'config_management.visual.api_keys.model_limit_registry_empty',
                                                                     {
                                                                         defaultValue: '模型列表未加载，请刷新后再配置模型限制',
                                                                     },
                                                                 )
                                                                 :
                                                                 availableModelNames.length === 0
                                                                 ?
                                                                 t(
                                                                     'config_management.visual.api_keys.model_limit_global_empty',
                                                                     {
                                                                         defaultValue: '全局可用模型为空，请先检查模型管理中的全局禁用配置',
                                                                     },
                                                                 )
                                                                 :
                                                                 t(
                                                                     'config_management.visual.api_keys.model_limit_allowed_empty',
                                                                     {
                                                                         defaultValue: '当前密钥已限制所有模型，将无法发起任何 API 请求',
                                                                     },
                                                                 )
    const modelLimitAllowedEmptyVariant: 'neutral' | 'warning' = !hasModelLimitQuery &&
                                                                 !modelCatalogLoading &&
                                                                 catalogModelNames.length >
                                                                 0 &&
                                                                 availableModelNames.length >
                                                                 0
                                                                 ? 'warning'
                                                                 : 'neutral'
    const modelLimitPrimaryEmptyText                           = modelLimitBothPanelsEmpty && hasModelLimitQuery
                                                                 ?
                                                                 t(
                                                                     'config_management.visual.api_keys.model_limit_search_empty',
                                                                     {
                                                                         defaultValue: '没有匹配模型',
                                                                     },
                                                                 )
                                                                 :
                                                                 modelLimitAllowedEmptyText

    const {
              currentItems: pagedKeys,
              currentPage,
              pageSize,
              totalPages,
              goToPage,
              setPageSize,
          } = usePagination(filteredKeys, 20)

    const validateAlias = useCallback(
        (alias: string): string | null => {
            if (!alias) {
                return null
            }
            if (alias.length > 20) {
                return t('config_management.visual.api_keys.alias_error_length')
            }
            if (!/^[a-zA-Z0-9_-]+$/.test(alias)) {
                return t('config_management.visual.api_keys.alias_error_format')
            }
            return null
        },
        [t],
    )

    function generateSecureApiKey(alias?: string): string {
        const random = generateTokenHex(32)
        return alias ? `sk-${alias}-${random}` : `sk-${random}`
    }

    const openAddModal = () => {
        setEditingApiKeyId(null)
        setInputValue('')
        setFormError('')
        setApiKeyVisible(false)
        setAliasValue('')
        setAliasError('')
        setModalOpen(true)
    }

    const openEditModal = (apiKeyId: string) => {
        const editingIndex = renderApiKeyIds.findIndex((id) => id === apiKeyId)
        const key          = apiKeys[editingIndex] ?? ''
        setEditingApiKeyId(apiKeyId)
        setInputValue(key)
        setFormError('')
        setApiKeyVisible(false)
        setAliasValue(aliases[key] ?? '')
        setAliasError('')
        setModalOpen(true)
    }

    const openModelLimitModal = (apiKey: string) => {
        const blockedModels = (modelRules[apiKey]?.blockedModels ?? [])
            .map((model) => model.trim())
            .filter(Boolean)
        setModelCatalogRows([])
        setModelCatalogLoaded(false)
        setModelCatalogError('')
        setModelLimitKey(apiKey)
        setDraftBlockedModels(new Set(blockedModels))
        setSelectedAllowed(new Set())
        setSelectedBlocked(new Set())
        setModelLimitQuery('')
    }

    const closeModelLimitModal = () => {
        setModelLimitKey(null)
        setDraftBlockedModels(new Set())
        setSelectedAllowed(new Set())
        setSelectedBlocked(new Set())
        setModelLimitQuery('')
    }

    const saveModelLimitRules = () => {
        if (!modelLimitKey || !modelLimitCatalogReady) {
            return
        }
        const blockedModels = uniqueSorted(draftBlockedModels)
        const nextRules     = { ...modelRules }
        if (blockedModels.length > 0) {
            nextRules[modelLimitKey] = { blockedModels }
        } else {
            delete nextRules[modelLimitKey]
        }
        onModelRulesChange(nextRules)
        closeModelLimitModal()
    }

    const closeModal = () => {
        setModalOpen(false)
        setInputValue('')
        setEditingApiKeyId(null)
        setFormError('')
        setApiKeyVisible(false)
        setAliasValue('')
        setAliasError('')
        setSearchQuery('')
    }

    const updateApiKeys = (nextKeys: string[]) => {
        onChange(nextKeys.join('\n'))
    }

    const toggleTreeSelection = (
        node: ModelTreeNode,
        selected: Set<string>,
        setSelected: (next: Set<string>) => void,
    ) => {
        const leaves      = modelLeaves(node)
        const allSelected = leaves.length > 0 && leaves.every((model) => selected.has(model))
        const next        = new Set(selected)
        for (const model of leaves) {
            if (allSelected) {
                next.delete(model)
            } else {
                next.add(model)
            }
        }
        setSelected(next)
    }

    const moveAllowedToBlocked = (models: Iterable<string>) => {
        const next = new Set(draftBlockedModels)
        for (const model of models) {
            removeModelLimitMatches(next, model)
            next.add(model)
        }
        setDraftBlockedModels(next)
        setSelectedAllowed(new Set())
    }

    const moveAllAllowedToBlocked = () => {
        setDraftBlockedModels(new Set([...draftBlockedModels, ...availableModelNames]))
        setSelectedAllowed(new Set())
        setSelectedBlocked(new Set())
    }

    const moveBlockedToAllowed = (models: Iterable<string>) => {
        const next = new Set(draftBlockedModels)
        for (const model of models) {
            removeModelLimitMatches(next, model)
        }
        setDraftBlockedModels(next)
        setSelectedBlocked(new Set())
    }

    const handleDelete = (apiKeyId: string) => {
        const index = renderApiKeyIds.findIndex((id) => id === apiKeyId)
        if (index < 0) {
            return
        }
        const deletedKey = apiKeys[index]
        setApiKeyIds(renderApiKeyIds.filter((id) => id !== apiKeyId))
        updateApiKeys(apiKeys.filter((_, i) => i !== index))
        if (deletedKey && modelRules[deletedKey]) {
            const nextRules = { ...modelRules }
            delete nextRules[deletedKey]
            onModelRulesChange(nextRules)
        }

        // 清除该 key 的别名
        if (deletedKey && aliases[deletedKey]) {
            apiKeyAliasApi.remove(deletedKey).catch((err) => console.warn('Failed to remove alias:', err))
            setAliases((prev) => {
                const next = { ...prev }
                delete next[deletedKey]
                return next
            })
        }
    }

    const handleSave = async () => {
        const trimmed      = inputValue.trim()
        const trimmedAlias = aliasValue.trim()

        if (!trimmed) {
            setFormError(t('config_management.visual.api_keys.error_empty'))
            return
        }
        if (!isValidApiKey(trimmed)) {
            setFormError(
                trimmed.length < 8
                ? t('config_management.visual.api_keys.error_too_short')
                : t('config_management.visual.api_keys.error_invalid'),
            )
            return
        }

        // 验证别名格式
        const aliasFormatError = validateAlias(trimmedAlias)
        if (aliasFormatError) {
            setAliasError(aliasFormatError)
            return
        }

        // 检查别名是否与其他 key 重复
        if (trimmedAlias) {
            const editingIndex = editingApiKeyId ? renderApiKeyIds.findIndex((id) => id === editingApiKeyId) : -1
            const currentKey   = editingIndex >= 0 ? apiKeys[editingIndex] : undefined
            const duplicate    = Object.entries(aliases).some(
                ([key, alias]) => alias === trimmedAlias && key !== currentKey && key !== trimmed,
            )
            if (duplicate) {
                setAliasError(t('config_management.visual.api_keys.alias_error_duplicate'))
                return
            }
        }

        const editingIndex = editingApiKeyId ? renderApiKeyIds.findIndex((id) => id === editingApiKeyId) : -1
        const oldKey       = editingIndex >= 0 ? apiKeys[editingIndex] : undefined
        const nextKeys     =
                  editingApiKeyId === null
                  ? [...apiKeys, trimmed]
                  : apiKeys.map((key, idx) => (idx === editingIndex ? trimmed : key))
        if (editingApiKeyId === null) {
            setApiKeyIds([...renderApiKeyIds, makeClientId()])
        }
        updateApiKeys(nextKeys)
        if (oldKey && oldKey !== trimmed && modelRules[oldKey]) {
            const nextRules = { ...modelRules, [trimmed]: modelRules[oldKey] }
            delete nextRules[oldKey]
            onModelRulesChange(nextRules)
        }

        // 处理别名的增删改
        try {
            // key 被改名时，移除旧 key 的别名
            if (oldKey && oldKey !== trimmed && aliases[oldKey]) {
                await apiKeyAliasApi.remove(oldKey)
                setAliases((prev) => {
                    const next = { ...prev }
                    delete next[oldKey]
                    return next
                })
            }

            if (trimmedAlias) {
                await apiKeyAliasApi.set(trimmed, trimmedAlias)
                setAliases((prev) => ({ ...prev, [trimmed]: trimmedAlias }))
            } else {
                // 别名被清空，移除
                const keyToRemove = oldKey && oldKey !== trimmed ? trimmed : (oldKey ?? trimmed)
                if (aliases[keyToRemove]) {
                    await apiKeyAliasApi.remove(keyToRemove)
                    setAliases((prev) => {
                        const next = { ...prev }
                        delete next[keyToRemove]
                        return next
                    })
                }
            }
        } catch (err) {
            console.warn('Alias save failed:', err)
        }

        closeModal()
    }

    const handleCopy = async (apiKey: string) => {
        const copied = await copyToClipboard(apiKey)
        showNotification(
            t(copied ? 'notification.link_copied' : 'notification.copy_failed'),
            copied ? 'success' : 'error',
        )
    }

    const handleGenerate = () => {
        const trimmedAlias = aliasValue.trim()
        setInputValue(generateSecureApiKey(trimmedAlias || undefined))
        setFormError('')
    }

    return (
        <div className='form-group' style={{ marginBottom: 0 }}>
            <div className={styles.blockHeaderRow}>
                <label style={{ margin: 0 }}>{t('config_management.visual.api_keys.label')}</label>
                <Button size='sm' onClick={openAddModal} disabled={disabled}>
                    {t('config_management.visual.api_keys.add')}
                </Button>
            </div>

            {showSearch && (
                <Input
                    placeholder={t('config_management.visual.api_keys.search_placeholder')}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                />
            )}

            {apiKeys.length === 0 ? (
                <div className={styles.emptyState}>{t('config_management.visual.api_keys.empty')}</div>
            ) : (
                 <div className='item-list' style={{ marginTop: 4 }}>
                     {pagedKeys.map((item) => (
                         <div key={renderApiKeyIds[item.index] ?? `${item.key}-${item.index}`} className='item-row'>
                             <div className='item-meta'>
                                 <div className='pill'>#{item.index + 1}</div>
                                 <div className='item-title'>
                                     {highlightText(
                                         aliases[item.key] || t('config_management.visual.api_keys.input_label'),
                                         searchQuery,
                                     )}
                                 </div>
                                 <div className='item-subtitle'>
                                     {highlightText(maskApiKey(String(item.key || '')), searchQuery)}
                                 </div>
                                 <div className={styles.apiKeyModelLimitSummary}>
                                     {modelRules[item.key]?.blockedModels?.length
                                      ? t('config_management.visual.api_keys.model_limit_blocked_summary', {
                                             count: modelRules[item.key]?.blockedModels.length,
                                             defaultValue: '模型访问：已禁止 {{count}} 个模型',
                                         })
                                      : t('config_management.visual.api_keys.model_limit_all_allowed', {
                                             defaultValue: '模型访问：全部允许',
                                         })}
                                 </div>
                             </div>
                             <div className='item-actions'>
                                 <Button
                                     variant='secondary'
                                     size='sm'
                                     onClick={() => handleCopy(item.key)}
                                     disabled={disabled}
                                 >
                                     {t('common.copy')}
                                 </Button>
                                 <Button
                                     variant='secondary'
                                     size='sm'
                                     onClick={() => openEditModal(renderApiKeyIds[item.index] ?? '')}
                                     disabled={disabled}
                                 >
                                     {t('config_management.visual.common.edit')}
                                 </Button>
                                 <Button
                                     variant='secondary'
                                     size='sm'
                                     onClick={() => openModelLimitModal(item.key)}
                                     disabled={disabled}
                                 >
                                     {t('config_management.visual.api_keys.model_limit_button', {
                                         defaultValue: '模型限制',
                                     })}
                                 </Button>
                                 <Button
                                     variant='danger'
                                     size='sm'
                                     onClick={() => {
                                         const id      = renderApiKeyIds[item.index] ?? ''
                                         const alias   = aliases[item.key]
                                         const display = alias
                                                         ? `${alias} (${maskApiKey(item.key)})`
                                                         : maskApiKey(item.key)
                                         useNotificationStore.getState().showConfirmation({
                                                                                              title: t(
                                                                                                  'config_management.visual.api_keys.delete_title',
                                                                                                  {
                                                                                                      defaultValue: 'Delete API key',
                                                                                                  },
                                                                                              ),
                                                                                              message: t(
                                                                                                  'config_management.visual.api_keys.delete_confirm',
                                                                                                  {
                                                                                                      key: display,
                                                                                                      defaultValue: `Delete API key "${display}"?`,
                                                                                                  },
                                                                                              ),
                                                                                              variant: 'danger',
                                                                                              confirmText: t(
                                                                                                  'config_management.visual.common.delete'),
                                                                                              onConfirm: () => handleDelete(
                                                                                                  id),
                                                                                          })
                                     }}
                                     disabled={disabled}
                                 >
                                     {t('config_management.visual.common.delete')}
                                 </Button>
                             </div>
                         </div>
                     ))}
                 </div>
             )}

            {totalPages > 1 && (
                <Pagination
                    total={filteredKeys.length}
                    page={currentPage}
                    pageSize={pageSize}
                    onPageChange={goToPage}
                    onPageSizeChange={setPageSize}
                />
            )}

            <div className='hint'>{t('config_management.visual.api_keys.hint')}</div>

            <Modal
                open={modalOpen}
                onClose={closeModal}
                title={
                    editingApiKeyId !== null
                    ? t('config_management.visual.api_keys.edit_title')
                    : t('config_management.visual.api_keys.add_title')
                }
                footer={
                    <>
                        <Button variant='secondary' onClick={closeModal} disabled={disabled}>
                            {t('config_management.visual.common.cancel')}
                        </Button>
                        <Button onClick={handleSave} disabled={disabled}>
                            {editingApiKeyId !== null
                             ? t('config_management.visual.common.update')
                             : t('config_management.visual.common.add')}
                        </Button>
                    </>
                }
            >
                <div className='form-group'>
                    <label htmlFor={aliasInputId}>{t('config_management.visual.api_keys.alias_label')}</label>
                    <input
                        id={aliasInputId}
                        className='input'
                        placeholder={t('config_management.visual.api_keys.alias_placeholder')}
                        value={aliasValue}
                        onChange={(e) => {
                            setAliasValue(e.target.value)
                            setAliasError('')
                        }}
                        disabled={disabled}
                        aria-describedby={aliasError ? `${aliasErrorId} ${aliasHintId}` : aliasHintId}
                        aria-invalid={Boolean(aliasError)}
                    />
                    <div id={aliasHintId} className='hint'>
                        {t('config_management.visual.api_keys.alias_hint')}
                    </div>
                    {aliasError && (
                        <div id={aliasErrorId} className='error-box'>
                            {aliasError}
                        </div>
                    )}
                </div>

                <div className='form-group'>
                    <label htmlFor={apiKeyInputId}>{t('config_management.visual.api_keys.input_label')}</label>
                    <div className={styles.apiKeyModalInputRow}>
                        <div className={styles.apiKeyModalSecretInput}>
                            <input
                                id={apiKeyInputId}
                                className='input'
                                type={apiKeyVisible ? 'text' : 'password'}
                                placeholder={t('config_management.visual.api_keys.input_placeholder')}
                                value={inputValue}
                                onChange={(e) => setInputValue(e.target.value)}
                                disabled={disabled}
                                aria-describedby={formError ? `${apiKeyErrorId} ${apiKeyHintId}` : apiKeyHintId}
                                aria-invalid={Boolean(formError)}
                                autoComplete='new-password'
                                spellCheck={false}
                                autoCapitalize='none'
                                autoCorrect='off'
                            />
                            <button
                                type='button'
                                className={styles.apiKeyModalVisibilityButton}
                                onClick={() => setApiKeyVisible((value) => !value)}
                                disabled={disabled}
                                aria-label={
                                    apiKeyVisible
                                    ? t('login.hide_key', { defaultValue: 'Hide key' })
                                    : t('login.show_key', { defaultValue: 'Show key' })
                                }
                            >
                                {apiKeyVisible ? <IconEyeOff size={16} /> : <IconEye size={16} />}
                            </button>
                        </div>
                        <Button
                            type='button'
                            variant='secondary'
                            size='sm'
                            onClick={handleGenerate}
                            disabled={disabled}
                        >
                            {t('config_management.visual.api_keys.generate')}
                        </Button>
                    </div>
                    <div id={apiKeyHintId} className='hint'>
                        {t('config_management.visual.api_keys.input_hint')}
                    </div>
                    {formError && (
                        <div id={apiKeyErrorId} className='error-box'>
                            {formError}
                        </div>
                    )}
                </div>
            </Modal>

            <Modal
                open={modelLimitKey !== null}
                onClose={closeModelLimitModal}
                width='min(1180px, calc(100vw - 48px))'
                title={t('config_management.visual.api_keys.model_limit_title', {
                    defaultValue: '模型访问限制',
                })}
                footer={
                    <>
                        <Button variant='secondary' onClick={closeModelLimitModal} disabled={disabled}>
                            {t('config_management.visual.common.cancel')}
                        </Button>
                        <Button onClick={saveModelLimitRules} disabled={disabled || !modelLimitCatalogReady}>
                            {t('config_management.visual.common.update')}
                        </Button>
                    </>
                }
            >
                <div className={styles.modelLimitModal}>
                    <div className={styles.modelLimitTarget}>{currentModelLimitTitle}</div>
                    <div className={styles.modelLimitHint}>
                        {t('config_management.visual.api_keys.model_limit_hint', {
                            defaultValue: '默认允许全部模型，系统新增模型也会默认允许；移入右侧后该 key 将无法访问',
                        })}
                    </div>
                    {unavailableModelNames.length > 0 ? (
                        <div className={styles.modelLimitUnavailable}>
                            {getModelLimitUnavailableSummary(t, unavailableModelNames)}
                        </div>
                    ) : null}
                    {modelCatalogError ? (
                        <div className='error-box'>
                            {t('config_management.visual.api_keys.model_catalog_load_failed', {
                                error: modelCatalogError,
                                defaultValue: `模型目录加载失败：${modelCatalogError}`,
                            })}
                        </div>
                    ) : null}
                    <Input
                        placeholder={t('config_management.visual.api_keys.model_limit_search', {
                            defaultValue: '搜索模型或供应商',
                        })}
                        value={modelLimitQuery}
                        onChange={(event) => setModelLimitQuery(event.target.value)}
                    />
                    <div className={styles.modelLimitTransfer}>
                        <ModelTreePanel
                            title={t('config_management.visual.api_keys.model_limit_allowed', {
                                defaultValue: '允许访问（默认）',
                            })}
                            nodes={filteredAllowedTree}
                            selected={selectedAllowed}
                            onToggle={(node) => toggleTreeSelection(node, selectedAllowed, setSelectedAllowed)}
                            onMoveModel={(model) => moveAllowedToBlocked([model])}
                            emptyText={modelLimitPrimaryEmptyText}
                            emptyVariant={modelLimitAllowedEmptyVariant}
                            expandMatches={expandModelMatches}
                            aliasLabelsByModel={aliasLabelsByModel}
                        />
                        <div className={styles.modelLimitActions}>
                            <Button
                                type='button'
                                variant='secondary'
                                size='sm'
                                onClick={() => moveAllowedToBlocked(selectedAllowed)}
                                disabled={selectedAllowed.size === 0 || disabled}
                            >
                                <span className={styles.modelLimitActionContent}>
                                    {t('config_management.visual.api_keys.model_limit_move_blocked', {
                                        defaultValue: '移到禁止',
                                    })}
                                    <IconChevronRight size={14} />
                                </span>
                            </Button>
                            <Button
                                type='button'
                                variant='secondary'
                                size='sm'
                                onClick={() => moveBlockedToAllowed(selectedBlocked)}
                                disabled={selectedBlocked.size === 0 || disabled}
                            >
                                <span className={styles.modelLimitActionContent}>
                                    <IconChevronLeft size={14} />
                                    {t('config_management.visual.api_keys.model_limit_move_allowed', {
                                        defaultValue: '恢复允许',
                                    })}
                                </span>
                            </Button>
                            <Button
                                type='button'
                                variant='ghost'
                                size='sm'
                                onClick={moveAllAllowedToBlocked}
                                disabled={availableModelNames.length === 0 || availableModelsAllBlocked || disabled}
                            >
                                <span className={styles.modelLimitActionContent}>
                                    {t('config_management.visual.api_keys.model_limit_block_all', {
                                        defaultValue: '全部禁止',
                                    })}
                                    <IconChevronRight size={14} />
                                </span>
                            </Button>
                            <Button
                                type='button'
                                variant='ghost'
                                size='sm'
                                onClick={() => {
                                    const next = new Set(draftBlockedModels)
                                    for (const model of availableModelNames) {
                                        removeModelLimitMatches(next, model)
                                    }
                                    setDraftBlockedModels(next)
                                    setSelectedAllowed(new Set())
                                    setSelectedBlocked(new Set())
                                }}
                                disabled={!hasVisibleBlockedModels || disabled}
                            >
                                <span className={styles.modelLimitActionContent}>
                                    <IconChevronLeft size={14} />
                                    {t('config_management.visual.api_keys.model_limit_allow_all', {
                                        defaultValue: '全部允许',
                                    })}
                                </span>
                            </Button>
                        </div>
                        <ModelTreePanel
                            title={t('config_management.visual.api_keys.model_limit_blocked', {
                                defaultValue: '禁止访问（黑名单）',
                            })}
                            nodes={filteredBlockedTree}
                            selected={selectedBlocked}
                            onToggle={(node) => toggleTreeSelection(node, selectedBlocked, setSelectedBlocked)}
                            onMoveModel={(model) => moveBlockedToAllowed([model])}
                            emptyText={
                                hasModelLimitQuery
                                ? t('config_management.visual.api_keys.model_limit_search_empty_blocked', {
                                    defaultValue: '黑名单中没有匹配模型',
                                })
                                : t('config_management.visual.api_keys.model_limit_blocked_empty', {
                                    defaultValue: '未限制任何模型，从左侧移入后禁止访问',
                                })
                            }
                            expandMatches={expandModelMatches}
                            showEmptyState={!modelLimitBothPanelsEmpty}
                            aliasLabelsByModel={aliasLabelsByModel}
                        />
                    </div>
                </div>
            </Modal>
        </div>
    )
})

const StringListEditor = memo(function StringListEditor({
                                                            value,
                                                            disabled,
                                                            placeholder,
                                                            inputAriaLabel,
                                                            onChange,
                                                        }: {
    value: string[]
    disabled?: boolean
    placeholder?: string
    inputAriaLabel?: string
    onChange: (next: string[]) => void
}) {
    const { t }                 = useTranslation()
    const items                 = value.length ? value : []
    const [itemIds, setItemIds] = useState(() => items.map(() => makeClientId()))
    const renderItemIds         = useMemo(() => {
        if (itemIds.length === items.length) {
            return itemIds
        }
        if (itemIds.length > items.length) {
            return itemIds.slice(0, items.length)
        }
        return [...itemIds, ...Array.from({ length: items.length - itemIds.length }, () => makeClientId())]
    }, [itemIds, items.length])

    const updateItem = (index: number, nextValue: string) =>
        onChange(items.map((item, i) => (i === index ? nextValue : item)))
    const addItem    = () => {
        setItemIds([...renderItemIds, makeClientId()])
        onChange([...items, ''])
    }
    const removeItem = (index: number) => {
        setItemIds(renderItemIds.filter((_, i) => i !== index))
        onChange(items.filter((_, i) => i !== index))
    }

    return (
        <div className={styles.stringList}>
            {items.map((item, index) => (
                <div key={renderItemIds[index] ?? `item-${index}`} className={styles.stringListRow}>
                    <input
                        className='input'
                        placeholder={placeholder}
                        aria-label={inputAriaLabel ?? placeholder}
                        value={item}
                        onChange={(e) => updateItem(index, e.target.value)}
                        disabled={disabled}
                        style={{ flex: 1 }}
                    />
                    <Button variant='ghost' size='sm' onClick={() => removeItem(index)} disabled={disabled}>
                        {t('config_management.visual.common.delete')}
                    </Button>
                </div>
            ))}
            <div className={styles.actionRow}>
                <Button variant='secondary' size='sm' onClick={addItem} disabled={disabled}>
                    {t('config_management.visual.common.add')}
                </Button>
            </div>
        </div>
    )
})

export const PayloadRulesEditor = memo(function PayloadRulesEditor({
                                                                       value,
                                                                       disabled,
                                                                       protocolFirst = false,
                                                                       rawJsonValues = false,
                                                                       onChange,
                                                                   }: {
    value: PayloadRule[]
    disabled?: boolean
    protocolFirst?: boolean
    rawJsonValues?: boolean
    onChange: (next: PayloadRule[]) => void
}) {
    const { t }                   = useTranslation()
    const rules                   = value
    const protocolOptions         = useMemo(() => buildProtocolOptions(t, rules), [rules, t])
    const payloadValueTypeOptions = useMemo(
        () =>
            VISUAL_CONFIG_PAYLOAD_VALUE_TYPE_OPTIONS.map((option) => ({
                value: option.value,
                label: t(option.labelKey, { defaultValue: option.defaultLabel }),
            })),
        [t],
    )
    const booleanValueOptions     = useMemo(
        () => [
            { value: 'true', label: t('config_management.visual.payload_rules.boolean_true') },
            { value: 'false', label: t('config_management.visual.payload_rules.boolean_false') },
        ],
        [t],
    )

    const addRule    = () => onChange([...rules, { id: makeClientId(), models: [], params: [] }])
    const removeRule = (ruleIndex: number) => onChange(rules.filter((_, i) => i !== ruleIndex))

    const updateRule = (ruleIndex: number, patch: Partial<PayloadRule>) =>
        onChange(rules.map((rule, i) => (i === ruleIndex ? { ...rule, ...patch } : rule)))

    const addModel = (ruleIndex: number) => {
        const rule                         = rules[ruleIndex]
        const nextModel: PayloadModelEntry = { id: makeClientId(), name: '', protocol: undefined }
        updateRule(ruleIndex, { models: [...rule.models, nextModel] })
    }

    const removeModel = (ruleIndex: number, modelIndex: number) => {
        const rule = rules[ruleIndex]
        updateRule(ruleIndex, { models: rule.models.filter((_, i) => i !== modelIndex) })
    }

    const updateModel = (ruleIndex: number, modelIndex: number, patch: Partial<PayloadModelEntry>) => {
        const rule = rules[ruleIndex]
        updateRule(ruleIndex, {
            models: rule.models.map((m, i) => (i === modelIndex ? { ...m, ...patch } : m)),
        })
    }

    const addParam = (ruleIndex: number) => {
        const rule                         = rules[ruleIndex]
        const nextParam: PayloadParamEntry = {
            id: makeClientId(),
            path: '',
            valueType: rawJsonValues ? 'json' : 'string',
            value: '',
        }
        updateRule(ruleIndex, { params: [...rule.params, nextParam] })
    }

    const removeParam = (ruleIndex: number, paramIndex: number) => {
        const rule = rules[ruleIndex]
        updateRule(ruleIndex, { params: rule.params.filter((_, i) => i !== paramIndex) })
    }

    const updateParam = (ruleIndex: number, paramIndex: number, patch: Partial<PayloadParamEntry>) => {
        const rule = rules[ruleIndex]
        updateRule(ruleIndex, {
            params: rule.params.map((p, i) => (i === paramIndex ? { ...p, ...patch } : p)),
        })
    }

    const getValuePlaceholder = (valueType: PayloadParamValueType) => {
        switch (valueType) {
            case 'string':
                return t('config_management.visual.payload_rules.value_string')
            case 'number':
                return t('config_management.visual.payload_rules.value_number')
            case 'boolean':
                return t('config_management.visual.payload_rules.value_boolean')
            case 'json':
                return t('config_management.visual.payload_rules.value_json')
            default:
                return t('config_management.visual.payload_rules.value_default')
        }
    }

    const getParamErrorMessage = (param: PayloadParamEntry) => {
        const errorCode = getPayloadParamValidationError(rawJsonValues ? { ...param, valueType: 'json' } : param)
        return getValidationMessage(t, errorCode)
    }

    const renderParamValueEditor = (ruleIndex: number, paramIndex: number, param: PayloadParamEntry) => {
        if (rawJsonValues) {
            return (
                <textarea
                    className={`input ${styles.payloadJsonInput}`}
                    placeholder={t('config_management.visual.payload_rules.value_raw_json')}
                    aria-label={t('config_management.visual.payload_rules.param_value')}
                    value={param.value}
                    onChange={(e) => updateParam(ruleIndex, paramIndex, { value: e.target.value, valueType: 'json' })}
                    disabled={disabled}
                />
            )
        }

        if (param.valueType === 'boolean') {
            return (
                <Select
                    value={
                        param.value.toLowerCase() === 'true' || param.value.toLowerCase() === 'false'
                        ? param.value.toLowerCase()
                        : ''
                    }
                    options={booleanValueOptions}
                    placeholder={t('config_management.visual.payload_rules.value_boolean')}
                    disabled={disabled}
                    ariaLabel={t('config_management.visual.payload_rules.param_value')}
                    onChange={(nextValue) => updateParam(ruleIndex, paramIndex, { value: nextValue })}
                />
            )
        }

        if (param.valueType === 'json') {
            return (
                <textarea
                    className={`input ${styles.payloadJsonInput}`}
                    placeholder={getValuePlaceholder(param.valueType)}
                    aria-label={t('config_management.visual.payload_rules.param_value')}
                    value={param.value}
                    onChange={(e) => updateParam(ruleIndex, paramIndex, { value: e.target.value })}
                    disabled={disabled}
                />
            )
        }

        return (
            <input
                className='input'
                placeholder={getValuePlaceholder(param.valueType)}
                aria-label={t('config_management.visual.payload_rules.param_value')}
                value={param.value}
                onChange={(e) => updateParam(ruleIndex, paramIndex, { value: e.target.value })}
                disabled={disabled}
            />
        )
    }

    return (
        <div className={styles.blockStack}>
            {rules.map((rule, ruleIndex) => (
                <div key={rule.id} className={styles.ruleCard}>
                    <div className={styles.ruleCardHeader}>
                        <div className={styles.ruleCardTitle}>
                            {t('config_management.visual.payload_rules.rule')} {ruleIndex + 1}
                        </div>
                        <Button variant='ghost' size='sm' onClick={() => removeRule(ruleIndex)} disabled={disabled}>
                            {t('config_management.visual.common.delete')}
                        </Button>
                    </div>

                    <div className={styles.blockStack}>
                        <div className={styles.blockLabel}>{t('config_management.visual.payload_rules.models')}</div>
                        {(rule.models.length ? rule.models : []).map((model, modelIndex) => (
                            <div
                                key={model.id}
                                className={[
                                    styles.payloadRuleModelRow,
                                    protocolFirst ? styles.payloadRuleModelRowProtocolFirst : '',
                                ]
                                    .filter(Boolean)
                                    .join(' ')}
                            >
                                {protocolFirst ? (
                                    <>
                                        <Select
                                            value={model.protocol ?? ''}
                                            options={protocolOptions}
                                            disabled={disabled}
                                            ariaLabel={t('config_management.visual.payload_rules.provider_type')}
                                            onChange={(nextValue) =>
                                                updateModel(ruleIndex, modelIndex, {
                                                    protocol: (nextValue || undefined) as PayloadModelEntry['protocol'],
                                                })
                                            }
                                        />
                                        <input
                                            className='input'
                                            placeholder={t('config_management.visual.payload_rules.model_name')}
                                            aria-label={t('config_management.visual.payload_rules.model_name')}
                                            value={model.name}
                                            onChange={(e) =>
                                                updateModel(ruleIndex, modelIndex, { name: e.target.value })
                                            }
                                            disabled={disabled}
                                        />
                                    </>
                                ) : (
                                     <>
                                         <input
                                             className='input'
                                             placeholder={t('config_management.visual.payload_rules.model_name')}
                                             aria-label={t('config_management.visual.payload_rules.model_name')}
                                             value={model.name}
                                             onChange={(e) =>
                                                 updateModel(ruleIndex, modelIndex, { name: e.target.value })
                                             }
                                             disabled={disabled}
                                         />
                                         <Select
                                             value={model.protocol ?? ''}
                                             options={protocolOptions}
                                             disabled={disabled}
                                             ariaLabel={t('config_management.visual.payload_rules.provider_type')}
                                             onChange={(nextValue) =>
                                                 updateModel(ruleIndex, modelIndex, {
                                                     protocol: (nextValue ||
                                                                undefined) as PayloadModelEntry['protocol'],
                                                 })
                                             }
                                         />
                                     </>
                                 )}
                                <Button
                                    variant='ghost'
                                    size='sm'
                                    className={styles.payloadRowActionButton}
                                    onClick={() => removeModel(ruleIndex, modelIndex)}
                                    disabled={disabled}
                                >
                                    {t('config_management.visual.common.delete')}
                                </Button>
                            </div>
                        ))}
                        <div className={styles.actionRow}>
                            <Button
                                variant='secondary'
                                size='sm'
                                onClick={() => addModel(ruleIndex)}
                                disabled={disabled}
                            >
                                {t('config_management.visual.payload_rules.add_model')}
                            </Button>
                        </div>
                    </div>

                    <div className={styles.blockStack}>
                        <div className={styles.blockLabel}>{t('config_management.visual.payload_rules.params')}</div>
                        {(rule.params.length ? rule.params : []).map((param, paramIndex) => {
                            const paramError = getParamErrorMessage(param)

                            return (
                                <div key={param.id} className={styles.payloadRuleParamGroup}>
                                    <div className={styles.payloadRuleParamRow}>
                                        <input
                                            className='input'
                                            placeholder={t('config_management.visual.payload_rules.json_path')}
                                            aria-label={t('config_management.visual.payload_rules.json_path')}
                                            value={param.path}
                                            onChange={(e) =>
                                                updateParam(ruleIndex, paramIndex, { path: e.target.value })
                                            }
                                            disabled={disabled}
                                        />
                                        {rawJsonValues ? null : (
                                            <Select
                                                value={param.valueType}
                                                options={payloadValueTypeOptions}
                                                disabled={disabled}
                                                ariaLabel={t('config_management.visual.payload_rules.param_type')}
                                                onChange={(nextValue) =>
                                                    updateParam(ruleIndex, paramIndex, {
                                                        valueType: nextValue as PayloadParamValueType,
                                                        value:
                                                            nextValue === 'boolean'
                                                            ? 'true'
                                                            : nextValue === 'json' && param.value.trim() === ''
                                                              ? '{}'
                                                              : param.value,
                                                    })
                                                }
                                            />
                                        )}
                                        {renderParamValueEditor(ruleIndex, paramIndex, param)}
                                        <Button
                                            variant='ghost'
                                            size='sm'
                                            className={styles.payloadRowActionButton}
                                            onClick={() => removeParam(ruleIndex, paramIndex)}
                                            disabled={disabled}
                                        >
                                            {t('config_management.visual.common.delete')}
                                        </Button>
                                    </div>
                                    {paramError && (
                                        <div className={`error-box ${styles.payloadParamError}`}>{paramError}</div>
                                    )}
                                </div>
                            )
                        })}
                        <div className={styles.actionRow}>
                            <Button
                                variant='secondary'
                                size='sm'
                                onClick={() => addParam(ruleIndex)}
                                disabled={disabled}
                            >
                                {t('config_management.visual.payload_rules.add_param')}
                            </Button>
                        </div>
                    </div>
                </div>
            ))}

            {rules.length === 0 && (
                <div className={styles.emptyState}>{t('config_management.visual.payload_rules.no_rules')}</div>
            )}

            <div className={styles.actionRow}>
                <Button variant='secondary' size='sm' onClick={addRule} disabled={disabled}>
                    {t('config_management.visual.payload_rules.add_rule')}
                </Button>
            </div>
        </div>
    )
})

export const PayloadFilterRulesEditor = memo(function PayloadFilterRulesEditor({
                                                                                   value,
                                                                                   disabled,
                                                                                   onChange,
                                                                               }: {
    value: PayloadFilterRule[]
    disabled?: boolean
    onChange: (next: PayloadFilterRule[]) => void
}) {
    const { t }           = useTranslation()
    const rules           = value
    const protocolOptions = useMemo(() => buildProtocolOptions(t, rules), [rules, t])

    const addRule    = () => onChange([...rules, { id: makeClientId(), models: [], params: [] }])
    const removeRule = (ruleIndex: number) => onChange(rules.filter((_, i) => i !== ruleIndex))

    const updateRule = (ruleIndex: number, patch: Partial<PayloadFilterRule>) =>
        onChange(rules.map((rule, i) => (i === ruleIndex ? { ...rule, ...patch } : rule)))

    const addModel = (ruleIndex: number) => {
        const rule                         = rules[ruleIndex]
        const nextModel: PayloadModelEntry = { id: makeClientId(), name: '', protocol: undefined }
        updateRule(ruleIndex, { models: [...rule.models, nextModel] })
    }

    const removeModel = (ruleIndex: number, modelIndex: number) => {
        const rule = rules[ruleIndex]
        updateRule(ruleIndex, { models: rule.models.filter((_, i) => i !== modelIndex) })
    }

    const updateModel = (ruleIndex: number, modelIndex: number, patch: Partial<PayloadModelEntry>) => {
        const rule = rules[ruleIndex]
        updateRule(ruleIndex, {
            models: rule.models.map((m, i) => (i === modelIndex ? { ...m, ...patch } : m)),
        })
    }

    return (
        <div className={styles.blockStack}>
            {rules.map((rule, ruleIndex) => (
                <div key={rule.id} className={styles.ruleCard}>
                    <div className={styles.ruleCardHeader}>
                        <div className={styles.ruleCardTitle}>
                            {t('config_management.visual.payload_rules.rule')} {ruleIndex + 1}
                        </div>
                        <Button variant='ghost' size='sm' onClick={() => removeRule(ruleIndex)} disabled={disabled}>
                            {t('config_management.visual.common.delete')}
                        </Button>
                    </div>

                    <div className={styles.blockStack}>
                        <div className={styles.blockLabel}>{t('config_management.visual.payload_rules.models')}</div>
                        {rule.models.map((model, modelIndex) => (
                            <div key={model.id} className={styles.payloadFilterModelRow}>
                                <input
                                    className='input'
                                    placeholder={t('config_management.visual.payload_rules.model_name')}
                                    aria-label={t('config_management.visual.payload_rules.model_name')}
                                    value={model.name}
                                    onChange={(e) => updateModel(ruleIndex, modelIndex, { name: e.target.value })}
                                    disabled={disabled}
                                />
                                <Select
                                    value={model.protocol ?? ''}
                                    options={protocolOptions}
                                    disabled={disabled}
                                    ariaLabel={t('config_management.visual.payload_rules.provider_type')}
                                    onChange={(nextValue) =>
                                        updateModel(ruleIndex, modelIndex, {
                                            protocol: (nextValue || undefined) as PayloadModelEntry['protocol'],
                                        })
                                    }
                                />
                                <Button
                                    variant='ghost'
                                    size='sm'
                                    className={styles.payloadRowActionButton}
                                    onClick={() => removeModel(ruleIndex, modelIndex)}
                                    disabled={disabled}
                                >
                                    {t('config_management.visual.common.delete')}
                                </Button>
                            </div>
                        ))}
                        <div className={styles.actionRow}>
                            <Button
                                variant='secondary'
                                size='sm'
                                onClick={() => addModel(ruleIndex)}
                                disabled={disabled}
                            >
                                {t('config_management.visual.payload_rules.add_model')}
                            </Button>
                        </div>
                    </div>

                    <div className={styles.blockStack}>
                        <div className={styles.blockLabel}>
                            {t('config_management.visual.payload_rules.remove_params')}
                        </div>
                        <StringListEditor
                            value={rule.params}
                            disabled={disabled}
                            placeholder={t('config_management.visual.payload_rules.json_path_filter')}
                            inputAriaLabel={t('config_management.visual.payload_rules.json_path_filter')}
                            onChange={(params) => updateRule(ruleIndex, { params })}
                        />
                    </div>
                </div>
            ))}

            {rules.length === 0 && (
                <div className={styles.emptyState}>{t('config_management.visual.payload_rules.no_rules')}</div>
            )}

            <div className={styles.actionRow}>
                <Button variant='secondary' size='sm' onClick={addRule} disabled={disabled}>
                    {t('config_management.visual.payload_rules.add_rule')}
                </Button>
            </div>
        </div>
    )
})
