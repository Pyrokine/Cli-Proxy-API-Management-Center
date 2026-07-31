import {type DataStatusValue} from '@/components/common/DataStatusCard'
import {Sheet, type SheetColumn} from '@/components/common/Sheet'
import {Button} from '@/components/ui/Button'
import {Card} from '@/components/ui/Card'
import {Input} from '@/components/ui/Input'
import {Modal} from '@/components/ui/Modal'
import {ToggleSwitch} from '@/components/ui/ToggleSwitch'
import {modelPricesApi} from '@/services/api/modelPrices'
import {
    type ModelCatalogApplyDecision,
    type ModelCatalogDefaultUpdateChange,
    type ModelCatalogPatchRequest,
    type ModelCatalogPrice,
    type ModelCatalogRow,
    modelsApi,
} from '@/services/api/models'
import {useNotificationStore} from '@/stores'
import {buildModelTree, getModelMetadata, modelLeaves, type ModelTreeNode} from '@/utils/modelTree'
import {formatUsd} from '@/utils/usage'
import {useCallback, useEffect, useMemo, useState} from 'react'
import {useTranslation} from 'react-i18next'
import styles from './ModelManagementPage.module.scss'

type ModelRow = {
    id: string
    model: string
    displayName: string
    provider: string
    channel: string
    generation: string
    family: string
    enabled: boolean
    requestable: boolean
    notRequestableReason: string
    aliases: string[]
    price: ModelCatalogPrice | null
    userCreated: boolean
    runtimeAvailable: boolean
    catalogGroup: string
}

type ModelTreeTableRow = {
    id: string
    key: string
    kind: ModelTreeNode['kind']
    label: string
    provider: string
    depth: number
    leafCount: number
    row?: ModelRow
    children?: ModelTreeTableRow[]
}

type EditDraft = {
    originalModel: string
    model: string
    displayName: string
    provider: string
    channel: string
    group: string
    aliasesText: string
    prompt: string
    completion: string
    cache: string
    enabled: boolean
    originalEnabled: boolean
    userCreated: boolean
    runtimeAvailable: boolean
}

type AddDraft = {
    model: string
    displayName: string
    provider: string
    channel: string
    group: string
    aliasesText: string
    prompt: string
    completion: string
    cache: string
}

type OptionalPriceParseResult =
    | { ok: true; price: ModelCatalogPrice | null }
    | { ok: false }

const BUILTIN_GROUP_OPTIONS = [
    'GPT-5.1',
    'GPT-5.2',
    'GPT-5.3',
    'GPT-5.4',
    'GPT-5.5',
    'GPT Image',
    'Claude 4.7',
    'Claude 4.6',
    'Claude 4.5',
    'Gemini 3',
    'Gemini 2.5',
    'Qwen Other',
    'Other',
]

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
    return out.sort((left, right) => left.localeCompare(right))
}

function parseOptionalPrice(prompt: string, completion: string, cache: string): OptionalPriceParseResult {
    const promptText     = prompt.trim()
    const completionText = completion.trim()
    const cacheText      = cache.trim()
    if (!promptText && !completionText && !cacheText) {
        return { ok: true, price: null }
    }
    const promptValue     = Number(promptText || 0)
    const completionValue = Number(completionText || 0)
    const cacheValue      = Number(cacheText || promptText || 0)
    if (![promptValue, completionValue, cacheValue].every((value) => Number.isFinite(value) && value >= 0)) {
        return { ok: false }
    }
    return { ok: true, price: { prompt: promptValue, completion: completionValue, cache: cacheValue } }
}

function priceToInputs(price: ModelCatalogPrice | null) {
    return {
        prompt: price ? String(price.prompt) : '',
        completion: price ? String(price.completion) : '',
        cache: price ? String(price.cache) : '',
    }
}

function parseAliases(value: string): string[] {
    return uniqueSorted(value.split(/[\n,]/g))
}

function aliasesToText(aliases: string[]): string {
    return aliases.join('\n')
}

function catalogGroupLabel(row: ModelCatalogRow): string {
    return String(row.group || '').trim()
}

function buildTreeTableRows(
    nodes: ModelTreeNode[],
    rowsByModel: Map<string, ModelRow>,
    depth = 0,
): ModelTreeTableRow[] {
    return nodes.map((node) => {
        const children = node.children ? buildTreeTableRows(node.children, rowsByModel, depth + 1) : undefined
        const row      = node.kind === 'model' ? rowsByModel.get(node.id) : undefined
        return {
            id: node.id,
            key: `${node.kind}:${node.id}`,
            kind: node.kind,
            label: node.label,
            provider: node.provider,
            depth,
            leafCount: node.kind === 'model' ? 1 : modelLeaves(node).length,
            row,
            children,
        }
    })
}

function flattenTreeTableRows(rows: ModelTreeTableRow[], collapsed: Set<string>): ModelTreeTableRow[] {
    return rows.flatMap((row) => {
        if (!row.children?.length || collapsed.has(row.key)) {
            return [row]
        }
        return [row, ...flattenTreeTableRows(row.children, collapsed)]
    })
}

function filterTreeTableRows(rows: ModelTreeTableRow[], keyword: string): ModelTreeTableRow[] {
    const query = keyword.trim().toLowerCase()
    if (!query) {
        return rows
    }
    const matchesRow = (row: ModelTreeTableRow) => [
        row.label,
        row.provider,
        row.row?.model ?? '',
        row.row?.displayName ?? '',
        row.row?.generation ?? '',
        row.row?.family ?? '',
        row.row?.aliases.join(' ') ?? '',
    ].some((value) => value.toLowerCase().includes(query))

    const visit = (row: ModelTreeTableRow): ModelTreeTableRow | null => {
        const children = row.children?.map(visit).filter((child): child is ModelTreeTableRow => child !== null)
        if (matchesRow(row) || (children && children.length > 0)) {
            return { ...row, children }
        }
        return null
    }

    return rows.map(visit).filter((row): row is ModelTreeTableRow => row !== null)
}

function collectDefaultCollapsedRows(rows: ModelTreeTableRow[]): Set<string> {
    const keys  = new Set<string>()
    const visit = (row: ModelTreeTableRow) => {
        if (row.children?.length && row.depth >= 1) {
            keys.add(row.key)
        }
        row.children?.forEach(visit)
    }
    rows.forEach(visit)
    return keys
}

function mergeCollapsedRows(
    defaultCollapsed: Set<string>,
    manualCollapsed: Set<string>,
    manualExpanded: Set<string>,
): Set<string> {
    const keys = new Set([...defaultCollapsed, ...manualCollapsed])
    manualExpanded.forEach((key) => keys.delete(key))
    return keys
}

function modelSubtitle(row: ModelRow): string {
    const family = row.family.toLowerCase() !== row.generation.toLowerCase() ? row.family : ''
    const labels = [row.displayName !== row.model ? row.displayName : '', family]
        .map((label) => label.trim())
        .filter(Boolean)
    return uniqueSorted(labels).join(' · ')
}

function notRequestableFallback(reason: string, t: (key: string) => string): string {
    const labels: Record<string, string> = {
        disabled: t('model_management.not_requestable_disabled'),
        not_runtime: t('model_management.not_requestable_not_runtime'),
    }
    return labels[reason] ?? reason
}

function fieldFallback(field: string, t: (key: string) => string): string {
    const labels: Record<string, string> = {
        provider: t('model_management.field_provider'),
        channel: t('model_management.field_channel'),
        group: t('model_management.field_group'),
        display_name: t('model_management.field_display_name'),
        aliases: t('model_management.field_aliases'),
        price: t('model_management.field_price'),
    }
    return labels[field] ?? field
}

function stringifyValue(value: unknown): string {
    if (value === null || value === undefined || value === '') {
        return '—'
    }
    if (Array.isArray(value)) {
        return value.length > 0 ? value.join(', ') : '—'
    }
    if (typeof value === 'object') {
        return JSON.stringify(value, null, 2)
    }
    return String(value)
}

function primaryActionForChange(change: ModelCatalogDefaultUpdateChange): ModelCatalogApplyDecision['action'] {
    if (change.type === 'restore_removed_default') {
        return 'restore'
    }
    if (change.type === 'default_removed_upstream') {
        return 'remove_default'
    }
    if (change.type === 'changed_default') {
        return 'use_default'
    }
    return 'adopt'
}

function secondaryActionForChange(change: ModelCatalogDefaultUpdateChange): ModelCatalogApplyDecision['action'] {
    return change.type === 'changed_default' || change.type === 'default_removed_upstream' ? 'keep_current' : 'skip'
}

export function ModelManagementPage() {
    const { t }                                  = useTranslation()
    const { showNotification, showConfirmation } = useNotificationStore()

    const [catalogRows, setCatalogRows]         = useState<ModelCatalogRow[]>([])
    const [loading, setLoading]                 = useState(true)
    const [error, setError]                     = useState('')
    const [savingModel, setSavingModel]         = useState<string | null>(null)
    const [expandedRows, setExpandedRows]       = useState<Set<string>>(() => new Set())
    const [collapsedRows, setCollapsedRows]     = useState<Set<string>>(() => new Set())
    const [searchValue, setSearchValue]         = useState('')
    const [editDraft, setEditDraft]             = useState<EditDraft | null>(null)
    const [addDraft, setAddDraft]               = useState<AddDraft | null>(null)
    const [updateChanges, setUpdateChanges]     = useState<ModelCatalogDefaultUpdateChange[]>([])
    const [updateModalOpen, setUpdateModalOpen] = useState(false)
    const [updateLoading, setUpdateLoading]     = useState(false)
    const [updateApplying, setUpdateApplying]   = useState(false)
    const [updatePage, setUpdatePage]           = useState(0)

    const loadAll = useCallback(async () => {
        setLoading(true)
        setError('')
        try {
            const catalog = await modelsApi.fetchModelCatalog()
            setCatalogRows(catalog.models ?? [])
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : String(err ?? ''))
        } finally {
            setLoading(false)
        }
    }, [])

    const loadDefaultUpdatePreview = useCallback(async () => {
        setUpdateLoading(true)
        try {
            const preview = await modelsApi.fetchDefaultUpdatePreview()
            setUpdateChanges(preview.changes ?? [])
            setUpdatePage((page) => Math.min(page, Math.max((preview.changes?.length ?? 1) - 1, 0)))
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : ''
            showNotification(`${t('notification.refresh_failed')}${message ? `: ${message}` : ''}`, 'error')
        } finally {
            setUpdateLoading(false)
        }
    }, [showNotification, t])

    const observePriceRecalculation = useCallback(() => {
        showNotification(t('usage_stats.recalculate_started'), 'success')
        void modelPricesApi.waitForRecalculation().then((status) => {
            if (!status) {
                showNotification(t('usage_stats.recalculate_timeout'), 'warning')
                return
            }
            if (status.status === 'error') {
                showNotification(
                    `${t('usage_stats.recalculate_failed')}${status.error ? `: ${status.error}` : ''}`,
                    'error',
                )
                return
            }
            if (status.status === 'ok') {
                showNotification(
                    t('usage_stats.recalculate_success', {
                        days: status.recalculated_days ?? 0,
                        cost: formatUsd(status.total_cost ?? 0),
                    }),
                    'success',
                )
            }
        }).catch((err: unknown) => {
            const message = err instanceof Error ? err.message : ''
            showNotification(
                `${t('usage_stats.recalculate_failed')}${message ? `: ${message}` : ''}`,
                'error',
            )
        })
    }, [showNotification, t])

    useEffect(() => {
        let cancelled = false
        queueMicrotask(() => {
            if (!cancelled) {
                void loadAll()
            }
        })
        return () => {
            cancelled = true
        }
    }, [loadAll])

    const allModelNames = useMemo(
        () => uniqueSorted(catalogRows.map((row) => row.name)),
        [catalogRows],
    )

    const modelRows = useMemo<ModelRow[]>(() => catalogRows.map((catalogRow) => {
        const model                = catalogRow.name.trim()
        const metadata             = getModelMetadata(model)
        const configuredProvider   = String(catalogRow.provider || '').trim()
        const provider             = metadata.provider === 'Other' ?
                                     (configuredProvider || metadata.provider) :
                                     metadata.provider
        const channel              = String(catalogRow.channel || '').trim()
        const catalogGroup         = catalogGroupLabel(catalogRow)
        const requestable          = Boolean(catalogRow.requestable)
        const notRequestableReason = catalogRow.not_requestable_reason ||
                                     (!catalogRow.enabled ?
                                      'disabled' :
                                      !catalogRow.runtime_available ? 'not_runtime' : '')
        return {
            id: catalogRow.id || `model:${modelKey(model)}`,
            model,
            displayName: catalogRow.display_name?.trim() || model,
            provider,
            channel,
            generation: metadata.generation,
            family: metadata.family,
            enabled: catalogRow.enabled,
            requestable,
            notRequestableReason,
            aliases: uniqueSorted(catalogRow.aliases ?? []),
            price: catalogRow.price ?? null,
            userCreated: catalogRow.user_created,
            runtimeAvailable: catalogRow.runtime_available,
            catalogGroup,
        }
    }).filter((row) => row.model), [catalogRows])

    const modelTree              = useMemo(
        () => buildModelTree(modelRows.map((row) => ({ model: row.model, provider: row.provider }))),
        [modelRows],
    )
    const treeTableRows          = useMemo(() => {
        const rowsByModel = new Map(modelRows.map((row) => [row.model, row]))
        return buildTreeTableRows(modelTree, rowsByModel)
    }, [modelRows, modelTree])
    const defaultCollapsedRows   = useMemo(() => collectDefaultCollapsedRows(treeTableRows), [treeTableRows])
    const effectiveCollapsedRows = useMemo(
        () => mergeCollapsedRows(defaultCollapsedRows, collapsedRows, expandedRows),
        [collapsedRows, defaultCollapsedRows, expandedRows],
    )
    const isTreeSearchActive     = searchValue.trim().length > 0
    const filteredTreeTableRows  = useMemo(
        () => filterTreeTableRows(treeTableRows, searchValue),
        [searchValue, treeTableRows],
    )
    const visibleTreeTableRows   = useMemo(
        () => flattenTreeTableRows(filteredTreeTableRows, isTreeSearchActive ? new Set() : effectiveCollapsedRows),
        [effectiveCollapsedRows, filteredTreeTableRows, isTreeSearchActive],
    )

    const requestableRows  = modelRows.filter((row) => row.requestable)
    const enabledCount     = modelRows.filter((row) => row.enabled).length
    const disabledCount    = modelRows.length - enabledCount
    const userCreatedCount = modelRows.filter((row) => row.userCreated).length
    const groupOptions     = useMemo(() => uniqueSorted([
                                                            ...BUILTIN_GROUP_OPTIONS,
                                                            ...modelRows.flatMap((row) => [
                                                                row.catalogGroup,
                                                                row.generation,
                                                                row.family,
                                                            ]),
                                                        ]), [modelRows])

    const handleSetModelEnabled = useCallback(
        async (row: ModelRow, enabled: boolean) => {
            setSavingModel(row.model)
            try {
                const catalog = await modelsApi.patchModelCatalogModel({ name: row.model, enabled })
                setCatalogRows(catalog.models ?? [])
                showNotification(
                    enabled
                    ? t('model_management.enable_success', { defaultValue: '模型已启用' })
                    : t('model_management.disable_success', { defaultValue: '模型已禁用' }),
                    'success',
                )
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : ''
                showNotification(`${t('notification.update_failed')}${message ? `: ${message}` : ''}`, 'error')
            } finally {
                setSavingModel(null)
            }
        },
        [showNotification, t],
    )

    const openEditModal = useCallback((row: ModelRow) => {
        const priceInputs = priceToInputs(row.price)
        setEditDraft({
                         originalModel: row.model,
                         model: row.model,
                         displayName: row.displayName !== row.model ? row.displayName : '',
                         provider: row.provider,
                         channel: row.channel,
                         group: row.catalogGroup,
                         aliasesText: aliasesToText(row.aliases),
                         ...priceInputs,
                         enabled: row.enabled,
                         originalEnabled: row.enabled,
                         userCreated: row.userCreated,
                         runtimeAvailable: row.runtimeAvailable,
                     })
    }, [])

    const saveEdit = useCallback(async () => {
        if (!editDraft) {
            return
        }
        const parsedPrice = parseOptionalPrice(editDraft.prompt, editDraft.completion, editDraft.cache)
        if (!parsedPrice.ok) {
            showNotification(
                t('model_management.price_invalid', { defaultValue: '价格必须是大于等于 0 的数字' }),
                'error',
            )
            return
        }
        setSavingModel(editDraft.originalModel)
        try {
            const request: ModelCatalogPatchRequest = {
                name: editDraft.originalModel,
                provider: editDraft.provider.trim(),
                channel: editDraft.channel.trim().toLowerCase(),
                group: editDraft.group.trim(),
                display_name: editDraft.displayName.trim(),
                aliases: parseAliases(editDraft.aliasesText),
                ...(parsedPrice.price ? { price: parsedPrice.price } : { clear_price: true }),
            }
            if (editDraft.enabled !== editDraft.originalEnabled) {
                request.enabled = editDraft.enabled
            }
            const catalog = await modelsApi.patchModelCatalogModel(request)
            setCatalogRows(catalog.models ?? [])
            setEditDraft(null)
            showNotification(t('model_management.save_success', { defaultValue: '模型配置已保存' }), 'success')
            if (catalog.recalculation_pending) {
                observePriceRecalculation()
            }
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : ''
            showNotification(`${t('notification.update_failed')}${message ? `: ${message}` : ''}`, 'error')
        } finally {
            setSavingModel(null)
        }
    }, [editDraft, observePriceRecalculation, showNotification, t])

    const handleAddModel = useCallback(async () => {
        if (!addDraft) {
            return
        }
        const model = addDraft.model.trim()
        if (!model) {
            showNotification(t('model_management.model_name_required', { defaultValue: '模型名不能为空' }), 'error')
            return
        }
        if (allModelNames.some((item) => modelKey(item) === modelKey(model))) {
            showNotification(t('model_management.model_exists', { defaultValue: '模型已存在' }), 'error')
            return
        }
        const parsedPrice = parseOptionalPrice(addDraft.prompt, addDraft.completion, addDraft.cache)
        if (!parsedPrice.ok) {
            showNotification(
                t('model_management.price_invalid', { defaultValue: '价格必须是大于等于 0 的数字' }),
                'error',
            )
            return
        }
        setSavingModel(model)
        try {
            const catalog = await modelsApi.patchModelCatalogModel({
                                                                       name: model,
                                                                       provider: addDraft.provider.trim(),
                                                                       channel: addDraft.channel.trim().toLowerCase(),
                                                                       group: addDraft.group.trim(),
                                                                       display_name: addDraft.displayName.trim(),
                                                                       enabled: false,
                                                                       aliases: parseAliases(addDraft.aliasesText),
                                                                       ...(parsedPrice.price ?
                                                                           { price: parsedPrice.price } :
                                                                           {}),
                                                                   })
            setCatalogRows(catalog.models ?? [])
            setAddDraft(null)
            showNotification(t('model_management.add_success', { defaultValue: '模型已添加' }), 'success')
            if (catalog.recalculation_pending) {
                observePriceRecalculation()
            }
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : ''
            showNotification(`${t('notification.update_failed')}${message ? `: ${message}` : ''}`, 'error')
        } finally {
            setSavingModel(null)
        }
    }, [addDraft, allModelNames, observePriceRecalculation, showNotification, t])

    const deleteModel = useCallback(
        (row: ModelRow) => {
            showConfirmation({
                                 title: row.userCreated
                                        ? t('model_management.delete_title', { defaultValue: '删除用户添加模型' })
                                        : t('model_management.delete_default_title', { defaultValue: '删除默认模型' }),
                                 message: row.userCreated
                                          ? t('model_management.delete_message', {
                                         defaultValue: '删除后会同时移除该模型的价格和别名',
                                         model: row.model,
                                     })
                                          : t('model_management.delete_default_message', {
                                         defaultValue: '删除后会从 models.json 移除该默认模型，并记录为已删除默认项；后续可在默认更新弹窗中恢复',
                                         model: row.model,
                                     }),
                                 variant: 'danger',
                                 confirmText: t('common.delete'),
                                 cancelText: t('common.cancel'),
                                 onConfirm: async () => {
                                     setSavingModel(row.model)
                                     try {
                                         const catalog = await modelsApi.deleteModelCatalogModel(row.model)
                                         setCatalogRows(catalog.models ?? [])
                                         showNotification(t(
                                             'model_management.delete_success',
                                             { defaultValue: '模型已删除' },
                                         ), 'success')
                                     } catch (err: unknown) {
                                         const message = err instanceof Error ? err.message : ''
                                         showNotification(`${t('notification.update_failed')}${message ?
                                                                                               `: ${message}` :
                                                                                               ''}`, 'error')
                                     } finally {
                                         setSavingModel(null)
                                     }
                                 },
                             })
        },
        [showConfirmation, showNotification, t],
    )

    const openDefaultUpdateModal = useCallback(() => {
        setUpdateModalOpen(true)
        setUpdatePage(0)
        void loadDefaultUpdatePreview()
    }, [loadDefaultUpdatePreview])

    const applyDefaultUpdate = useCallback(async (
        change: ModelCatalogDefaultUpdateChange,
        action: ModelCatalogApplyDecision['action'],
    ) => {
        setUpdateApplying(true)
        try {
            const response = await modelsApi.applyDefaultUpdate([{ name: change.name, action }])
            setCatalogRows(response.catalog.models ?? [])
            await loadDefaultUpdatePreview()
            showNotification(
                t('model_management.default_update_applied', { defaultValue: '默认模型更新已处理' }),
                'success',
            )
            if (response.catalog.recalculation_pending) {
                observePriceRecalculation()
            }
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : ''
            showNotification(`${t('notification.update_failed')}${message ? `: ${message}` : ''}`, 'error')
        } finally {
            setUpdateApplying(false)
        }
    }, [loadDefaultUpdatePreview, observePriceRecalculation, showNotification, t])

    const initialLoading              = loading && modelRows.length === 0
    const refreshing                  = Boolean(savingModel) || (loading && modelRows.length > 0)
    const status: DataStatusValue     = error && modelRows.length === 0 ?
                                        'error' :
                                        initialLoading ? 'loading' : modelRows.length === 0 ? 'empty' : 'ready'
    const treeStatus: DataStatusValue = status === 'ready' && visibleTreeTableRows.length === 0 ? 'empty' : status
    const treeEmptyText               = isTreeSearchActive && modelRows.length > 0
                                        ? t('model_management.search_empty', { defaultValue: '没有匹配的模型' })
                                        : t('model_management.empty')
    const treeEmptyHint               = isTreeSearchActive && modelRows.length > 0
                                        ?
                                        t(
                                            'model_management.search_empty_hint',
                                            { defaultValue: '当前筛选没有命中，清空搜索可查看全部模型' },
                                        )
                                        :
                                        undefined

    const toggleTreeRow = useCallback((item: ModelTreeTableRow) => {
        const currentlyCollapsed = effectiveCollapsedRows.has(item.key)
        setCollapsedRows((prev) => {
            const next = new Set(prev)
            if (currentlyCollapsed) {
                next.delete(item.key)
            } else {
                next.add(item.key)
            }
            return next
        })
        setExpandedRows((prev) => {
            const next = new Set(prev)
            if (currentlyCollapsed) {
                next.add(item.key)
            } else {
                next.delete(item.key)
            }
            return next
        })
    }, [effectiveCollapsedRows])

    const modelColumns = useMemo<SheetColumn<ModelTreeTableRow>[]>(() => [
        {
            key: 'model',
            header: t('model_management.model_tree', { defaultValue: '模型树' }),
            cell: () => null,
        },
        {
            key: 'enabled',
            header: t('model_management.enable_toggle', { defaultValue: '启用开关' }),
            headerClassName: styles.centerCell,
            cell: () => null,
        },
        {
            key: 'requestable',
            header: t('model_management.requestable', { defaultValue: '可请求' }),
            headerClassName: styles.centerCell,
            cell: () => null,
        },
        {
            key: 'alias',
            header: t('model_management.alias', { defaultValue: '别名' }),
            headerClassName: styles.centerCell,
            cell: () => null,
        },
        {
            key: 'price',
            header: t('model_management.price', { defaultValue: '价格' }),
            headerClassName: styles.centerCell,
            cell: () => null,
        },
        {
            key: 'actions',
            header: t('common.action', { defaultValue: '操作' }),
            headerClassName: styles.centerCell,
            cell: () => null,
        },
    ], [t])

    const renderModelTreeRow = useCallback(
        (item: ModelTreeTableRow) => {
            const row          = item.row
            const expandable   = Boolean(item.children?.length)
            const expanded     = isTreeSearchActive || !effectiveCollapsedRows.has(item.key)
            const rowClassName = row
                                 ? styles.modelRow
                                 : `${styles.groupRow} ${item.depth === 0 ? styles.providerRow : styles.groupLevelRow}`
            if (!row) {
                return (
                    <tr
                        className={rowClassName}
                        onClick={expandable ? () => toggleTreeRow(item) : undefined}
                    >
                        <td colSpan={modelColumns.length}>
                            <div className={styles.groupRowInner} style={{ paddingLeft: item.depth * 14 }}>
                                <button
                                    type='button'
                                    className={styles.matrixExpand}
                                    disabled={!expandable}
                                    onClick={(event) => {
                                        event.stopPropagation()
                                        toggleTreeRow(item)
                                    }}
                                >
                                    {expandable ? (expanded ? '▾' : '▸') : ''}
                                </button>
                                <div className={styles.groupTitleCell}>
                                    <span className={styles.groupName}>{item.label}</span>
                                    <span className={styles.groupMeta}>{item.kind === 'provider'
                                                                        ?
                                                                        t(
                                                                            'model_management.provider_group_hint',
                                                                            { defaultValue: '供应商' },
                                                                        )
                                                                        :
                                                                        t(
                                                                            'model_management.model_group_hint',
                                                                            { defaultValue: '模型分组' },
                                                                        )}</span>
                                </div>
                                <span className={styles.countBadge}>{t(
                                    'model_management.group_models_count',
                                    {
                                        defaultValue: '{{count}} 个模型',
                                        count: item.leafCount,
                                    },
                                )}</span>
                            </div>
                        </td>
                    </tr>
                )
            }
            const firstAlias          = row.aliases[0]
            const notRequestableLabel = row.notRequestableReason
                                        ?
                                        t(
                                            `model_management.not_requestable_${row.notRequestableReason}`,
                                            { defaultValue: notRequestableFallback(row.notRequestableReason, t) },
                                        )
                                        :
                                        ''
            return (
                <tr className={rowClassName}>
                    <td>
                        <div className={styles.treeCell} style={{ paddingLeft: item.depth * 14 }}>
                            <span className={styles.matrixExpandSpacer} />
                            <div className={styles.modelCell}>
                            <span className={styles.modelNameRow}>
                                <span className={styles.modelName}>{row.model}</span>
                                {row.userCreated ?
                                 <span className={styles.userCreatedPill}>{t(
                                     'model_management.status_user_created',
                                     { defaultValue: '用户新增' },
                                 )}</span> :
                                 null}
                            </span>
                                <span className={styles.modelMeta}>{modelSubtitle(row)}</span>
                            </div>
                        </div>
                    </td>
                    <td className={styles.centerCell}>
                        <div className={styles.centerContent}>
                            <div className={styles.switchCell}>
                                <ToggleSwitch
                                    checked={row.enabled}
                                    disabled={savingModel === row.model}
                                    ariaLabel={t('model_management.enable_toggle', { defaultValue: '启用开关' })}
                                    onChange={(value) => void handleSetModelEnabled(row, value)}
                                />
                            </div>
                        </div>
                    </td>
                    <td className={styles.centerCell}>
                        <div className={styles.centerContent}>
                            <div className={styles.requestableCell} title={notRequestableLabel || undefined}>
                            <span className={`${styles.requestableBadge} ${row.requestable ?
                                                                           styles.requestableYes :
                                                                           styles.requestableNo}`}>
                                {row.requestable ? t('common.yes') : t('common.no')}
                            </span>
                                {notRequestableLabel ?
                                 <span className={styles.requestableReason}>{notRequestableLabel}</span> :
                                 null}
                            </div>
                        </div>
                    </td>
                    <td className={styles.centerCell}>
                        <div className={styles.centerContent}>
                            {firstAlias ? (
                                <div className={styles.aliasCell} title={row.aliases.join('\n')}>
                                    <span>{firstAlias}</span>
                                    {row.aliases.length > 1 ?
                                     <span className={styles.aliasMore}>+{row.aliases.length - 1}</span> :
                                     null}
                                </div>
                            ) : <span className={styles.muted}>{t('common.not_set')}</span>}
                        </div>
                    </td>
                    <td className={styles.centerCell}>
                        <div className={styles.centerContent}>
                            {row.price ?
                             (
                                 <div
                                     className={styles.priceCell}
                                     title={`${t(
                                         'model_management.prompt_price',
                                         { defaultValue: '输入' },
                                     )}: $${row.price.prompt.toFixed(4)} · ${t(
                                         'model_management.completion_price',
                                         { defaultValue: '输出' },
                                     )}: $${row.price.completion.toFixed(4)} · ${t(
                                         'model_management.cache_price',
                                         { defaultValue: '缓存' },
                                     )}: $${row.price.cache.toFixed(4)}`}
                                 >
                                <span className={styles.priceItem}>
                                    <span>{t('model_management.prompt_price_short', { defaultValue: '输入' })}</span>
                                    <strong>${row.price.prompt.toFixed(4)}</strong>
                                </span>
                                     <span className={styles.priceItem}>
                                    <span>{t(
                                        'model_management.completion_price_short',
                                        { defaultValue: '输出' },
                                    )}</span>
                                    <strong>${row.price.completion.toFixed(4)}</strong>
                                </span>
                                     <span className={styles.priceItem}>
                                    <span>{t('model_management.cache_price_short', { defaultValue: '缓存' })}</span>
                                    <strong>${row.price.cache.toFixed(4)}</strong>
                                </span>
                                 </div>
                             ) :
                             <span className={styles.unconfigured}>{t(
                                 'model_management.price_unconfigured',
                                 { defaultValue: '未配置价格' },
                             )}</span>}
                        </div>
                    </td>
                    <td className={styles.centerCell}>
                        <div className={styles.centerContent}>
                            <div className={styles.rowActions}>
                                <Button variant='secondary' size='xs' onClick={() => openEditModal(row)}
                                        disabled={savingModel === row.model}>
                                    {t('common.edit')}
                                </Button>
                                <Button variant='danger' size='xs' onClick={() => deleteModel(row)}
                                        disabled={savingModel === row.model}>
                                    {t('common.delete')}
                                </Button>
                            </div>
                        </div>
                    </td>
                </tr>
            )
        },
        [
            deleteModel,
            effectiveCollapsedRows,
            handleSetModelEnabled,
            isTreeSearchActive,
            modelColumns.length,
            openEditModal,
            savingModel,
            t,
            toggleTreeRow,
        ],
    )

    const currentUpdateChange = updateChanges[updatePage] ?? null

    return (
        <div className={styles.page}>
            <div className={styles.header}>
                <div>
                    <h1>{t('model_management.title')}</h1>
                    <p>{t('model_management.subtitle')}</p>
                </div>
                <div className={styles.headerActions}>
                    <Button variant='secondary' onClick={() => void loadAll()} loading={loading}>
                        {t('common.refresh')}
                    </Button>
                    <Button variant='secondary' onClick={openDefaultUpdateModal} loading={updateLoading}>
                        {t('model_management.default_update_button', { defaultValue: '检查默认更新' })}
                    </Button>
                    <Button variant='primary' onClick={() => setAddDraft({
                                                                             model: '',
                                                                             displayName: '',
                                                                             provider: '',
                                                                             channel: '',
                                                                             group: '',
                                                                             aliasesText: '',
                                                                             prompt: '',
                                                                             completion: '',
                                                                             cache: '',
                                                                         })}>
                        {t('model_management.add_model')}
                    </Button>
                </div>
            </div>

            <div className={styles.statsGrid}>
                <Card className={styles.statCard}
                      title={t('model_management.provider_count', { defaultValue: '供应商' })}>
                    <strong>{modelTree.length}</strong>
                    <span>{t('model_management.provider_count_hint', { defaultValue: '按模型所属供应商分组' })}</span>
                </Card>
                <Card className={styles.statCard}
                      title={t('model_management.requestable_models', { defaultValue: '可请求模型' })}>
                    <strong>{requestableRows.length}</strong>
                    <span>{t(
                        'model_management.requestable_summary',
                        { defaultValue: '已启用、当前服务支持且未被访问规则限制的模型数量' },
                    )}</span>
                    <span>{t(
                        'model_management.enabled_summary',
                        {
                            defaultValue: '{{enabled}} 个启用，{{disabled}} 个停用',
                            enabled: enabledCount,
                            disabled: disabledCount,
                        },
                    )}</span>
                </Card>
                <Card className={styles.statCard}
                      title={t('model_management.total_models', { defaultValue: '模型总数' })}>
                    <strong>{modelRows.length}</strong>
                    <span>{t(
                        'model_management.total_models_hint',
                        { defaultValue: '来自后端 models.json 的完整模型表' },
                    )}</span>
                    <span>{t(
                        'model_management.user_created_summary',
                        { defaultValue: '{{count}} 个用户新增', count: userCreatedCount },
                    )}</span>
                </Card>
            </div>

            <details className={styles.callGuideDisclosure}>
                <summary>
                    <span>{t('model_management.image_call_title')}</span>
                    <code>POST /v1/images/generations</code>
                    <code>POST /v1/images/edits</code>
                </summary>
                <div className={styles.callGuideContent}>
                    <div>
                        <span className={styles.callGuideLabel}>{t('model_management.image_call_endpoint_label')}</span>
                        <span className={styles.callGuideText}>{t('model_management.image_call_endpoint_desc')}</span>
                    </div>
                    <div>
                        <span className={styles.callGuideLabel}>{t('model_management.image_call_token_label')}</span>
                        <span className={styles.callGuideText}>{t('model_management.image_call_token_desc')}</span>
                    </div>
                    <div>
                        <span className={styles.callGuideLabel}>{t('model_management.image_call_config_label')}</span>
                        <span className={styles.callGuideText}>{t('model_management.image_call_config_desc')}</span>
                    </div>
                </div>
            </details>

            <Card className={styles.modelMatrixCard}
                  title={t('model_management.model_table_title', { defaultValue: '模型与价格记录' })}>
                <Sheet
                    rows={visibleTreeTableRows}
                    columns={modelColumns}
                    rowKey={(item) => item.key}
                    status={treeStatus}
                    errorMessage={error}
                    onRetry={() => void loadAll()}
                    emptyText={treeEmptyText}
                    emptyHint={treeEmptyHint}
                    skeletonRowCount={8}
                    summaryContent={(
                        <div className={styles.treeSummary}>
                            <span className={styles.treeMeta}>
                                {t('model_management.matrix_summary', {
                                    defaultValue: '{{providers}} 个供应商 · {{total}} 个模型 · {{requestable}} 个可请求 · {{enabled}} 个启用',
                                    providers: modelTree.length,
                                    total: modelRows.length,
                                    requestable: requestableRows.length,
                                    enabled: enabledCount,
                                })}
                            </span>
                            <span className={styles.sourceHelp}>
                                {t('model_management.source_help', {
                                    defaultValue: '模型清单、价格、别名和启用状态都来自后端 models.json；可请求由启用状态、当前服务支持情况和 API key / 凭证访问规则共同决定',
                                })}
                            </span>
                        </div>
                    )}
                    toolbarContent={(
                        <div className={styles.matrixSearch}>
                            <Input
                                value={searchValue}
                                onChange={(event) => setSearchValue(event.target.value)}
                                placeholder={t('model_management.search_placeholder')}
                            />
                        </div>
                    )}
                    tableWrapClassName={styles.modelMatrixWrap}
                    tableClassName={styles.modelMatrix}
                    refreshing={refreshing}
                    refreshingText={t('common.loading')}
                    colGroup={(
                        <colgroup>
                            <col className={styles.modelTreeCol} />
                            <col className={styles.enabledCol} />
                            <col className={styles.requestableCol} />
                            <col className={styles.aliasCol} />
                            <col className={styles.priceCol} />
                            <col className={styles.actionsCol} />
                        </colgroup>
                    )}
                    renderRow={renderModelTreeRow}
                />
            </Card>

            <Modal
                open={editDraft !== null}
                title={editDraft?.originalModel ?? ''}
                onClose={() => setEditDraft(null)}
                width={720}
                footer={
                    <div className={styles.modalActions}>
                        <Button variant='secondary' onClick={() => setEditDraft(null)} disabled={Boolean(savingModel)}>
                            {t('common.cancel')}
                        </Button>
                        <Button variant='primary' onClick={() => void saveEdit()} loading={Boolean(savingModel)}>
                            {t('common.save')}
                        </Button>
                    </div>
                }
            >
                {editDraft ? (
                    <div className={styles.modalBody}>
                        <Input
                            label={t('model_management.model')}
                            value={editDraft.model}
                            disabled
                            onChange={() => {
                            }}
                        />
                        <div className={styles.formGrid}>
                            <Input
                                label={t('model_management.display_name', { defaultValue: '页面显示名' })}
                                value={editDraft.displayName}
                                placeholder={editDraft.model}
                                onChange={(event) => setEditDraft((prev) => prev ?
                                    { ...prev, displayName: event.target.value } :
                                                                            prev)}
                            />
                            <Input
                                label={t('model_management.provider', { defaultValue: '供应商' })}
                                value={editDraft.provider}
                                onChange={(event) => setEditDraft((prev) => prev ?
                                    { ...prev, provider: event.target.value } :
                                                                            prev)}
                            />
                            <Input
                                label={t('model_management.channel', { defaultValue: '接入类型' })}
                                value={editDraft.channel}
                                onChange={(event) => setEditDraft((prev) => prev ?
                                    { ...prev, channel: event.target.value } :
                                                                            prev)}
                            />
                            <Input
                                label={t('model_management.model_group', { defaultValue: '模型分组' })}
                                value={editDraft.group}
                                list='model-management-group-options'
                                onChange={(event) => setEditDraft((prev) => prev ?
                                    { ...prev, group: event.target.value } :
                                                                            prev)}
                            />
                        </div>
                        <div className={styles.formGrid}>
                            <Input
                                label={`${t('model_management.prompt_price')} ($/1M)`}
                                value={editDraft.prompt}
                                type='number'
                                step='0.0001'
                                placeholder={t('model_management.price_empty_placeholder')}
                                onChange={(event) => setEditDraft((prev) => prev ?
                                    { ...prev, prompt: event.target.value } :
                                                                            prev)}
                            />
                            <Input
                                label={`${t('model_management.completion_price')} ($/1M)`}
                                value={editDraft.completion}
                                type='number'
                                step='0.0001'
                                placeholder={t('model_management.price_empty_placeholder')}
                                onChange={(event) => setEditDraft((prev) => prev ?
                                    { ...prev, completion: event.target.value } :
                                                                            prev)}
                            />
                            <Input
                                label={`${t('model_management.cache_price')} ($/1M)`}
                                value={editDraft.cache}
                                type='number'
                                step='0.0001'
                                placeholder={t('model_management.price_empty_placeholder')}
                                onChange={(event) => setEditDraft((prev) => prev ?
                                    { ...prev, cache: event.target.value } :
                                                                            prev)}
                            />
                        </div>
                        <label className={styles.textareaField}>
                            <span>{t('model_management.alias', { defaultValue: '别名' })}</span>
                            <textarea
                                value={editDraft.aliasesText}
                                placeholder={t(
                                    'model_management.alias_textarea_placeholder',
                                    { defaultValue: '每行一个别名，也可以用逗号分隔' },
                                )}
                                onChange={(event) => setEditDraft((prev) => prev ?
                                    { ...prev, aliasesText: event.target.value } :
                                                                            prev)}
                            />
                        </label>
                        <div className={styles.inlineHint}>
                            <strong>{editDraft.userCreated ?
                                     t('model_management.status_user_created', { defaultValue: '用户新增' }) :
                                     t('model_management.status_default_model', { defaultValue: '默认模型' })}</strong>
                            <span>{editDraft.runtimeAvailable
                                   ?
                                   t(
                                       'model_management.enable_runtime_hint',
                                       { defaultValue: '启用状态已保存；当前服务支持请求该模型时才会变为可请求' },
                                   )
                                   :
                                   t(
                                       'model_management.enable_not_runtime_hint',
                                       { defaultValue: '当前服务暂不可请求；仍可先保存启用状态' },
                                   )}</span>
                            <ToggleSwitch
                                checked={editDraft.enabled}
                                label={t('model_management.enable_toggle', { defaultValue: '启用开关' })}
                                onChange={(value) => setEditDraft((prev) => prev ? { ...prev, enabled: value } : prev)}
                            />
                        </div>
                    </div>
                ) : null}
            </Modal>

            <Modal
                open={addDraft !== null}
                title={t('model_management.add_model')}
                onClose={() => setAddDraft(null)}
                width={620}
                footer={
                    <div className={styles.modalActions}>
                        <Button variant='secondary' onClick={() => setAddDraft(null)} disabled={Boolean(savingModel)}>
                            {t('common.cancel')}
                        </Button>
                        <Button variant='primary' onClick={() => void handleAddModel()} loading={Boolean(savingModel)}>
                            {t('common.save')}
                        </Button>
                    </div>
                }
            >
                {addDraft ? (
                    <div className={styles.modalBody}>
                        <Input
                            label={t('model_management.model')}
                            value={addDraft.model}
                            placeholder={t(
                                'model_management.model_placeholder',
                                { defaultValue: '例如 gpt-5.5-mini 或 vendor-model-name' },
                            )}
                            onChange={(event) => setAddDraft((prev) => prev ?
                                { ...prev, model: event.target.value } :
                                                                       prev)}
                        />
                        <div className={styles.formGrid}>
                            <Input
                                label={t('model_management.display_name', { defaultValue: '页面显示名' })}
                                value={addDraft.displayName}
                                onChange={(event) => setAddDraft((prev) => prev ?
                                    { ...prev, displayName: event.target.value } :
                                                                           prev)}
                            />
                            <Input
                                label={t('model_management.provider', { defaultValue: '供应商' })}
                                value={addDraft.provider}
                                onChange={(event) => setAddDraft((prev) => prev ?
                                    { ...prev, provider: event.target.value } :
                                                                           prev)}
                            />
                            <Input
                                label={t('model_management.channel', { defaultValue: '接入类型' })}
                                value={addDraft.channel}
                                onChange={(event) => setAddDraft((prev) => prev ?
                                    { ...prev, channel: event.target.value } :
                                                                           prev)}
                            />
                            <Input
                                label={t('model_management.model_group', { defaultValue: '模型分组' })}
                                value={addDraft.group}
                                list='model-management-group-options'
                                placeholder={t(
                                    'model_management.model_group_auto_placeholder',
                                    { defaultValue: '留空按规则自动分组，例如 Gemini Other' },
                                )}
                                onChange={(event) => setAddDraft((prev) => prev ?
                                    { ...prev, group: event.target.value } :
                                                                           prev)}
                            />
                        </div>
                        <div className={styles.formGrid}>
                            <Input
                                label={`${t('model_management.prompt_price')} ($/1M)`}
                                value={addDraft.prompt}
                                type='number'
                                step='0.0001'
                                placeholder={t('model_management.price_empty_placeholder')}
                                onChange={(event) => setAddDraft((prev) => prev ?
                                    { ...prev, prompt: event.target.value } :
                                                                           prev)}
                            />
                            <Input
                                label={`${t('model_management.completion_price')} ($/1M)`}
                                value={addDraft.completion}
                                type='number'
                                step='0.0001'
                                placeholder={t('model_management.price_empty_placeholder')}
                                onChange={(event) => setAddDraft((prev) => prev ?
                                    { ...prev, completion: event.target.value } :
                                                                           prev)}
                            />
                            <Input
                                label={`${t('model_management.cache_price')} ($/1M)`}
                                value={addDraft.cache}
                                type='number'
                                step='0.0001'
                                placeholder={t('model_management.price_empty_placeholder')}
                                onChange={(event) => setAddDraft((prev) => prev ?
                                    { ...prev, cache: event.target.value } :
                                                                           prev)}
                            />
                        </div>
                        <label className={styles.textareaField}>
                            <span>{t('model_management.alias', { defaultValue: '别名' })}</span>
                            <textarea
                                value={addDraft.aliasesText}
                                placeholder={t(
                                    'model_management.alias_textarea_placeholder',
                                    { defaultValue: '每行一个别名，也可以用逗号分隔' },
                                )}
                                onChange={(event) => setAddDraft((prev) => prev ?
                                    { ...prev, aliasesText: event.target.value } :
                                                                           prev)}
                            />
                        </label>
                        <div className={styles.inlineHint}>
                            <strong>{t(
                                'model_management.add_model_disabled_hint_title',
                                { defaultValue: '新增模型默认停用' },
                            )}</strong>
                            <span>{t(
                                'model_management.add_model_disabled_hint',
                                { defaultValue: '新增后会保存到 models.json；启用后若当前服务支持且未被访问规则限制，才会变为可请求' },
                            )}</span>
                        </div>
                    </div>
                ) : null}
            </Modal>

            <Modal
                open={updateModalOpen}
                title={t('model_management.default_update_title', { defaultValue: '默认模型更新' })}
                onClose={() => setUpdateModalOpen(false)}
                width={780}
                footer={
                    <div className={styles.updateFooter}>
                        <Button variant='secondary' onClick={() => setUpdateModalOpen(false)} disabled={updateApplying}>
                            {t('common.close')}
                        </Button>
                        {currentUpdateChange ? (
                            <div className={styles.updatePager}>
                                <Button
                                    variant='secondary'
                                    size='sm'
                                    disabled={updatePage <= 0 || updateApplying}
                                    onClick={() => setUpdatePage((page) => Math.max(0, page - 1))}
                                >
                                    {t('common.back')}
                                </Button>
                                <Button
                                    variant='secondary'
                                    size='sm'
                                    disabled={updatePage >= updateChanges.length - 1 || updateApplying}
                                    onClick={() => setUpdatePage((page) => Math.min(
                                        updateChanges.length - 1,
                                        page + 1,
                                    ))}
                                >
                                    {t('model_management.default_update_next', { defaultValue: '下一项' })}
                                </Button>
                            </div>
                        ) : null}
                    </div>
                }
            >
                <div className={styles.modalBody}>
                    {updateLoading ? (
                        <div className={styles.inlineHint}>{t('common.loading')}</div>
                    ) : currentUpdateChange ? (
                        <div className={styles.updateCard}>
                            <div className={styles.updateHeader}>
                                <h3>{currentUpdateChange.name}</h3>
                                <span className={styles.countBadge}>
                                    {t(
                                        'model_management.default_update_page',
                                        {
                                            defaultValue: '{{current}} / {{total}}',
                                            current: updatePage + 1,
                                            total: updateChanges.length,
                                        },
                                    )}
                                </span>
                            </div>
                            {currentUpdateChange.fields && Object.keys(currentUpdateChange.fields).length > 0 ? (
                                <div className={styles.fieldChanges}>
                                    <div className={styles.fieldChangeHeader}>
                                        <span>{t('model_management.field_property', { defaultValue: '配置项' })}</span>
                                        <span>{t('model_management.current_value', { defaultValue: '当前' })}</span>
                                        <span>{t('model_management.default_value', { defaultValue: '默认' })}</span>
                                    </div>
                                    {Object.entries(currentUpdateChange.fields).map(([field, change]) => (
                                        <div className={styles.fieldChange} key={field}>
                                            <span className={styles.fieldName}>{t(
                                                `model_management.field_${field}`,
                                                { defaultValue: fieldFallback(field, t) },
                                            )}</span>
                                            <pre>{stringifyValue(change.current)}</pre>
                                            <pre>{stringifyValue(change.default)}</pre>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                 <div className={styles.fieldChanges}>
                                     <div className={styles.fieldChangeHeader}>
                                         <span>{t('model_management.field_property', { defaultValue: '配置项' })}</span>
                                         <span>{t('model_management.current_value', { defaultValue: '当前' })}</span>
                                         <span>{t('model_management.default_value', { defaultValue: '默认' })}</span>
                                     </div>
                                     <div className={styles.fieldChange}>
                                         <span className={styles.fieldName}>{t(
                                             'model_management.model',
                                             { defaultValue: '模型' },
                                         )}</span>
                                         <pre>{stringifyValue(currentUpdateChange.current ?? null)}</pre>
                                         <pre>{stringifyValue(currentUpdateChange.default ?? null)}</pre>
                                     </div>
                                 </div>
                             )}
                            <div className={styles.updateDecisionBar}>
                                <Button
                                    variant='secondary'
                                    onClick={() => void applyDefaultUpdate(
                                        currentUpdateChange,
                                        secondaryActionForChange(currentUpdateChange),
                                    )}
                                    loading={updateApplying}
                                >
                                    {t('model_management.default_update_keep', { defaultValue: '保持当前' })}
                                </Button>
                                <Button
                                    variant='primary'
                                    className={styles.updatePrimaryAction}
                                    onClick={() => void applyDefaultUpdate(
                                        currentUpdateChange,
                                        primaryActionForChange(currentUpdateChange),
                                    )}
                                    loading={updateApplying}
                                >
                                    {currentUpdateChange.type === 'default_removed_upstream'
                                     ? t('model_management.default_update_remove', { defaultValue: '移除默认项' })
                                     : t('model_management.default_update_use_default', { defaultValue: '采用默认' })}
                                </Button>
                            </div>
                        </div>
                    ) : (
                            <div className={styles.inlineHint}>
                                <strong>{t(
                                    'model_management.default_update_empty',
                                    { defaultValue: '没有默认模型更新' },
                                )}</strong>
                                <span>{t(
                                    'model_management.default_update_empty_hint',
                                    { defaultValue: '当前 models.json 已经覆盖最新默认基线' },
                                )}</span>
                            </div>
                        )}
                </div>
            </Modal>

            <datalist id='model-management-group-options'>
                {groupOptions.map((option) => <option value={option} key={option} />)}
            </datalist>
        </div>
    )
}
