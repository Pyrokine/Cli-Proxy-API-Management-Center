import { Sheet, type SheetColumn } from '@/components/common/Sheet'
import { AutocompleteInput } from '@/components/ui/AutocompleteInput'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import defaultPricesJson from '@/data/defaultModelPrices.json'
import { useDataStatus } from '@/hooks/useDataStatus'
import styles from '@/pages/UsagePage.module.scss'
import { useNotificationStore } from '@/stores'
import type { ModelPrice } from '@/utils/usage'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { PriceSaveFeedback } from './hooks/useUsageData'

interface PriceSettingsCardProps {
    modelNames: string[]
    modelPrices: Record<string, ModelPrice>
    priceSaveFeedback: PriceSaveFeedback | null
    onPricesChange: (prices: Record<string, ModelPrice>) => Promise<void>
}

interface PriceRow {
    model: string
    prompt: number
    completion: number
    cache: number
}

export function PriceSettingsCard({
    modelNames,
    modelPrices,
    priceSaveFeedback,
    onPricesChange,
}: PriceSettingsCardProps) {
    const { t } = useTranslation()
    const { showConfirmation } = useNotificationStore()

    // Add form state
    const [selectedModel, setSelectedModel] = useState('')
    const [promptPrice, setPromptPrice] = useState('')
    const [completionPrice, setCompletionPrice] = useState('')
    const [cachePrice, setCachePrice] = useState('')

    // Edit modal state
    const [editModel, setEditModel] = useState<string | null>(null)
    const [editPrompt, setEditPrompt] = useState('')
    const [editCompletion, setEditCompletion] = useState('')
    const [editCache, setEditCache] = useState('')

    // R-468:模型多到 39+ 时一屏看不全;加搜索框过滤 + 按字典序排序,让用户
    // 不用滚动找到目标 model。沿用 Input 组件保持视觉一致,不引入额外依赖。
    const [saving, setSaving] = useState(false)
    const rows = useMemo<PriceRow[]>(
        () =>
            Object.entries(modelPrices)
                .map(([model, price]) => ({ model, ...price }))
                .sort((left, right) => left.model.localeCompare(right.model)),
        [modelPrices]
    )

    const handleSavePrice = async () => {
        if (!selectedModel || saving) {
            return
        }
        const prompt = parseFloat(promptPrice) || 0
        const completion = parseFloat(completionPrice) || 0
        const cache = cachePrice.trim() === '' ? prompt : parseFloat(cachePrice) || 0
        const newPrices = { ...modelPrices, [selectedModel]: { prompt, completion, cache } }
        setSaving(true)
        try {
            await onPricesChange(newPrices)
            setSelectedModel('')
            setPromptPrice('')
            setCompletionPrice('')
            setCachePrice('')
        } finally {
            setSaving(false)
        }
    }

    const handleDeletePrice = useCallback(
        (model: string) => {
            showConfirmation({
                title: t('usage_stats.delete_price_confirm_title'),
                message: t('usage_stats.delete_price_confirm_message', { model }),
                variant: 'danger',
                confirmText: t('common.delete'),
                cancelText: t('common.cancel'),
                onConfirm: async () => {
                    const newPrices = { ...modelPrices }
                    delete newPrices[model]
                    setSaving(true)
                    try {
                        await onPricesChange(newPrices)
                    } finally {
                        setSaving(false)
                    }
                },
            })
        },
        [modelPrices, onPricesChange, showConfirmation, t]
    )

    const handleOpenEdit = useCallback(
        (model: string) => {
            const price = modelPrices[model]
            setEditModel(model)
            setEditPrompt(price?.prompt?.toString() || '')
            setEditCompletion(price?.completion?.toString() || '')
            setEditCache(price?.cache?.toString() || '')
        },
        [modelPrices]
    )

    const handleSaveEdit = async () => {
        if (!editModel || saving) {
            return
        }
        const prompt = parseFloat(editPrompt) || 0
        const completion = parseFloat(editCompletion) || 0
        const cache = editCache.trim() === '' ? prompt : parseFloat(editCache) || 0
        const newPrices = { ...modelPrices, [editModel]: { prompt, completion, cache } }
        setSaving(true)
        try {
            await onPricesChange(newPrices)
            setEditModel(null)
        } finally {
            setSaving(false)
        }
    }

    const handleModelSelect = (value: string) => {
        setSelectedModel(value.trim())
        setPromptPrice('')
        setCompletionPrice('')
        setCachePrice('')
    }

    const suggestions = useMemo(() => modelNames.filter((name) => !(name in modelPrices)), [modelNames, modelPrices])
    const defaultPrices = useMemo(() => {
        const prices: Record<string, ModelPrice> = {}
        for (const [model, price] of Object.entries(defaultPricesJson)) {
            prices[model] = price as ModelPrice
        }
        return prices
    }, [])

    const handleApplyDefaultPrices = () => {
        if (saving) {
            return
        }
        showConfirmation({
            title: t('usage_stats.model_price_apply_defaults'),
            message: t('usage_stats.model_price_apply_defaults_confirm'),
            variant: 'primary',
            confirmText: t('common.confirm'),
            cancelText: t('common.cancel'),
            onConfirm: async () => {
                setSaving(true)
                try {
                    await onPricesChange(defaultPrices)
                } finally {
                    setSaving(false)
                }
            },
        })
    }

    const { status } = useDataStatus({
        loading: false,
        data: rows,
        isEmpty: (data) => data.length === 0,
    })

    const columns = useMemo<SheetColumn<PriceRow>[]>(() => {
        const openEdit = (model: string) => {
            handleOpenEdit(model)
        }
        const deletePrice = (model: string) => {
            handleDeletePrice(model)
        }
        return [
            {
                key: 'model',
                header: t('usage_stats.model_name'),
                sortable: true,
                sortValue: (row) => row.model,
                cell: (row) => <span className={styles.modelCell}>{row.model}</span>,
            },
            {
                key: 'prompt',
                header: `${t('usage_stats.model_price_prompt')} ($/1M)`,
                sortable: true,
                sortValue: (row) => row.prompt,
                cell: (row) => `$${row.prompt.toFixed(4)}`,
            },
            {
                key: 'completion',
                header: `${t('usage_stats.model_price_completion')} ($/1M)`,
                sortable: true,
                sortValue: (row) => row.completion,
                cell: (row) => `$${row.completion.toFixed(4)}`,
            },
            {
                key: 'cache',
                header: `${t('usage_stats.model_price_cache')} ($/1M)`,
                sortable: true,
                sortValue: (row) => row.cache,
                cell: (row) => `$${row.cache.toFixed(4)}`,
            },
            {
                key: 'actions',
                header: t('common.actions', { defaultValue: '操作' }),
                cell: (row) => (
                    <div className={styles.priceActions}>
                        <Button variant="secondary" size="sm" onClick={() => openEdit(row.model)} disabled={saving}>
                            {t('common.edit')}
                        </Button>
                        <Button variant="danger" size="sm" onClick={() => deletePrice(row.model)} disabled={saving}>
                            {t('common.delete')}
                        </Button>
                    </div>
                ),
            },
        ]
    }, [handleDeletePrice, handleOpenEdit, saving, t])

    return (
        <Card title={t('usage_stats.model_price_settings')} className={styles.detailsFixedCard}>
            <div className={styles.pricingSection}>
                <div className={styles.pricingActionsBar}>
                    <Button variant="secondary" size="sm" onClick={handleApplyDefaultPrices} loading={saving}>
                        {t('usage_stats.model_price_apply_defaults')}
                    </Button>
                </div>

                {priceSaveFeedback && (
                    <div
                        className={`${styles.priceSaveFeedback} ${styles[`priceSaveFeedback${priceSaveFeedback.type[0].toUpperCase()}${priceSaveFeedback.type.slice(1)}`]}`}
                    >
                        {priceSaveFeedback.message}
                    </div>
                )}

                {/* Price Form */}
                <div className={styles.priceForm}>
                    <div className={styles.formRow}>
                        <div className={styles.formField}>
                            <label>{t('usage_stats.model_name')}</label>
                            <AutocompleteInput
                                value={selectedModel}
                                onChange={handleModelSelect}
                                options={suggestions}
                                placeholder={t('usage_stats.model_price_select_placeholder')}
                                wrapperStyle={{ marginBottom: 0 }}
                            />
                        </div>
                        <div className={styles.formField}>
                            <label>{t('usage_stats.model_price_prompt')} ($/1M)</label>
                            <Input
                                type="number"
                                value={promptPrice}
                                onChange={(e) => setPromptPrice(e.target.value)}
                                placeholder="0.00"
                                step="0.0001"
                            />
                        </div>
                        <div className={styles.formField}>
                            <label>{t('usage_stats.model_price_completion')} ($/1M)</label>
                            <Input
                                type="number"
                                value={completionPrice}
                                onChange={(e) => setCompletionPrice(e.target.value)}
                                placeholder="0.00"
                                step="0.0001"
                            />
                        </div>
                        <div className={styles.formField}>
                            <label>{t('usage_stats.model_price_cache')} ($/1M)</label>
                            <Input
                                type="number"
                                value={cachePrice}
                                onChange={(e) => setCachePrice(e.target.value)}
                                placeholder="0.00"
                                step="0.0001"
                            />
                        </div>
                        <Button
                            variant="primary"
                            onClick={() => void handleSavePrice()}
                            disabled={!selectedModel}
                            loading={saving}
                        >
                            {t('common.save')}
                        </Button>
                    </div>
                    <div className={styles.priceFormFooter}>
                        <span className={styles.formHint}>{t('usage_stats.unknown_model_hint')}</span>
                    </div>
                </div>

                {/* Saved Prices List */}
                <div className={styles.pricesList}>
                    <Sheet
                        rows={rows}
                        columns={columns}
                        rowKey={(row) => row.model}
                        status={status}
                        emptyText={t('usage_stats.model_price_empty')}
                        searchable={rows.length >= 8}
                        searchPlaceholder={t('usage_stats.model_price_search', { defaultValue: '搜索模型...' })}
                        searchPredicate={(row, keyword) => row.model.toLowerCase().includes(keyword)}
                        defaultSortKey="model"
                        defaultSortDir="asc"
                        pagination={rows.length > 10}
                        defaultPageSize={10}
                        summaryContent={
                            <h4 className={styles.pricesTitle}>
                                {t('usage_stats.saved_prices')}{' '}
                                <span className={styles.pricesCount}>({rows.length})</span>
                            </h4>
                        }
                        refreshing={saving && rows.length > 0}
                        refreshingText={t('common.loading')}
                    />
                </div>
            </div>

            {/* Edit Modal */}
            <Modal
                open={editModel !== null}
                title={editModel ?? ''}
                onClose={() => setEditModel(null)}
                footer={
                    <div className={styles.priceActions}>
                        <Button variant="secondary" onClick={() => setEditModel(null)} disabled={saving}>
                            {t('common.cancel')}
                        </Button>
                        <Button variant="primary" onClick={() => void handleSaveEdit()} loading={saving}>
                            {t('common.save')}
                        </Button>
                    </div>
                }
                width={420}
            >
                <div className={styles.editModalBody}>
                    <div className={styles.formField}>
                        <label>{t('usage_stats.model_price_prompt')} ($/1M)</label>
                        <Input
                            type="number"
                            value={editPrompt}
                            onChange={(e) => setEditPrompt(e.target.value)}
                            placeholder="0.00"
                            step="0.0001"
                        />
                    </div>
                    <div className={styles.formField}>
                        <label>{t('usage_stats.model_price_completion')} ($/1M)</label>
                        <Input
                            type="number"
                            value={editCompletion}
                            onChange={(e) => setEditCompletion(e.target.value)}
                            placeholder="0.00"
                            step="0.0001"
                        />
                    </div>
                    <div className={styles.formField}>
                        <label>{t('usage_stats.model_price_cache')} ($/1M)</label>
                        <Input
                            type="number"
                            value={editCache}
                            onChange={(e) => setEditCache(e.target.value)}
                            placeholder="0.00"
                            step="0.0001"
                        />
                    </div>
                </div>
            </Modal>
        </Card>
    )
}
