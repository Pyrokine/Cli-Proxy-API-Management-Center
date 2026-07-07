import iconClaude from '@/assets/icons/claude.svg'
import iconCodexDark from '@/assets/icons/codex_dark.svg'
import iconCodexLight from '@/assets/icons/codex_light.svg'

import iconGemini from '@/assets/icons/gemini.svg'
import iconGrokDark from '@/assets/icons/grok-dark.svg'
import iconGrok from '@/assets/icons/grok.svg'
import iconIflow from '@/assets/icons/iflow.svg'
import iconKimiDark from '@/assets/icons/kimi-dark.svg'
import iconKimiLight from '@/assets/icons/kimi-light.svg'
import iconOpenaiDark from '@/assets/icons/openai-dark.svg'
import iconOpenaiLight from '@/assets/icons/openai-light.svg'
import iconQwen from '@/assets/icons/qwen.svg'
import iconVertex from '@/assets/icons/vertex.svg'
import type {VendorDefinition} from '@/components/credentials'
import {
    AccountInspectionPanel,
    createVendorRegistry,
    GlobalSettings,
    useCredentialsData,
    VendorSection,
} from '@/components/credentials'
import {useBackendQuotaRegistration} from '@/components/credentials/hooks/useBackendQuotaRegistration'
import {Button} from '@/components/ui/Button'
import {IconSearch} from '@/components/ui/icons'
import {Input} from '@/components/ui/Input'
import {MultiSelect} from '@/components/ui/MultiSelect'
import {Tabs} from '@/components/ui/Tabs'
import {useAutoRefresh} from '@/hooks/useAutoRefresh'
import {apiKeyAliasApi} from '@/services/api/apiKeys'
import {authFilesApi} from '@/services/api/authFiles'
import {type SummaryApiKeyStats, usageApi} from '@/services/api/usage'
import {useConfigStore, useThemeStore} from '@/stores'
import {useNotificationStore} from '@/stores/useNotificationStore'
import {resolveAutoRefreshMs} from '@/utils/autoRefresh'
import {formatDateTime} from '@/utils/format'
import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'

import styles from './CredentialsPage.module.scss'

/** Create a React component that renders a vendor icon as <img> */
function makeIconComponent(src: string, alt: string) {
    return function VendorIcon({ size = 20 }: { size?: number }) {
        return <img src={src} alt={alt} width={size} height={size} />
    }
}

/** Create a theme-aware icon component with light/dark variants */
function makeThemedIconComponent(lightSrc: string, darkSrc: string, alt: string) {
    return function ThemedVendorIcon({ size = 20 }: { size?: number }) {
        const resolvedTheme = useThemeStore((s) => s.resolvedTheme)
        const src           = resolvedTheme === 'dark' ? darkSrc : lightSrc
        return <img src={src} alt={alt} width={size} height={size} />
    }
}

/** Format a Date to HH:MM:SS */
function formatTime(date: Date): string {
    const full = formatDateTime(date)
    return full ? (full.split(' ')[1] ?? full) : ''
}

function loadStoredArray(key: string): string[] {
    try {
        const raw = localStorage.getItem(key)
        if (!raw) {
            return []
        }
        const parsed = JSON.parse(raw)
        return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
    } catch {
        return []
    }
}

const CREDENTIALS_UI_STATE_KEY     = 'cpa-credentials-ui-state'
const CREDENTIALS_VENDOR_ORDER_KEY = 'cpa-vendor-order'

type CredentialsStatusFilter = 'all' | 'available' | 'exhausted' | 'error' | 'disabled'
type CredentialsTypeFilter = 'all' | 'api-key' | 'auth-file'
type CredentialsTab = 'credentials' | 'inspection'

type CredentialsUIState = {
    searchQuery?: string
    statusFilter?: CredentialsStatusFilter
    typeFilter?: CredentialsTypeFilter
    selectedVendors?: string[]
}

function loadCredentialsUIState(): CredentialsUIState {
    try {
        const raw = localStorage.getItem(CREDENTIALS_UI_STATE_KEY)
        if (!raw) {
            return {}
        }
        const parsed = JSON.parse(raw)
        if (!parsed || typeof parsed !== 'object') {
            return {}
        }
        const state = parsed as CredentialsUIState
        return {
            searchQuery: typeof state.searchQuery === 'string' ? state.searchQuery : undefined,
            statusFilter: state.statusFilter,
            typeFilter: state.typeFilter,
            selectedVendors: Array.isArray(state.selectedVendors)
                             ? state.selectedVendors.filter((item): item is string => typeof item === 'string')
                             : undefined,
        }
    } catch {
        return {}
    }
}

export default function CredentialsPage() {
    const { t }                                 = useTranslation()
    const config                                = useConfigStore((s) => s.config)
    const showNotification                      = useNotificationStore((s) => s.showNotification)
    const showConfirmation                      = useNotificationStore((s) => s.showConfirmation)
    const [initialUIState]                      = useState(loadCredentialsUIState)
    const [searchQuery, setSearchQuery]         = useState(initialUIState.searchQuery ?? '')
    const [statusFilter, setStatusFilter]       = useState<CredentialsStatusFilter>(initialUIState.statusFilter ??
                                                                                    'all')
    const [typeFilter, setTypeFilter]           = useState<CredentialsTypeFilter>(initialUIState.typeFilter ?? 'all')
    const [selectedVendors, setSelectedVendors] = useState<string[]>(initialUIState.selectedVendors ?? [])
    const [activeTab, setActiveTab]             = useState<CredentialsTab>('credentials')

    // Batch operations
    const [selectedItems, setSelectedItems]                       = useState<Set<string>>(new Set())
    const [batchBusy, setBatchBusy]                               = useState(false)
    const [visibleAuthFilesByVendor, setVisibleAuthFilesByVendor] = useState<Record<string, string[]>>({})

    // Vendor drag-to-reorder
    const dragVendorRef                 = useRef<string | null>(null)
    const [vendorOrder, setVendorOrder] = useState<string[]>(() => loadStoredArray(CREDENTIALS_VENDOR_ORDER_KEY))

    const autoRefreshMs = useMemo(
        () => resolveAutoRefreshMs(config?.autoRefreshInterval),
        [config?.autoRefreshInterval],
    )

    const vendors: VendorDefinition[] = useMemo(
        () =>
            createVendorRegistry({
                                     Gemini: makeIconComponent(iconGemini, 'Gemini'),
                                     Claude: makeIconComponent(iconClaude, 'Claude'),
                                     Codex: makeThemedIconComponent(iconCodexLight, iconCodexDark, 'Codex'),
                                     Vertex: makeIconComponent(iconVertex, 'Vertex'),
                                     OpenAI: makeThemedIconComponent(iconOpenaiLight, iconOpenaiDark, 'OpenAI'),
                                     Kimi: makeThemedIconComponent(iconKimiLight, iconKimiDark, 'Kimi'),
                                     Qwen: makeIconComponent(iconQwen, 'Qwen'),
                                     IFlow: makeIconComponent(iconIflow, 'iFlow'),
                                     Grok: makeThemedIconComponent(iconGrok, iconGrokDark, 'Grok'),
                                 }).sort((a, b) => {
                const idxA = vendorOrder.indexOf(a.id)
                const idxB = vendorOrder.indexOf(b.id)
                if (idxA !== -1 && idxB !== -1) {
                    return idxA - idxB
                }
                if (idxA !== -1) {
                    return -1
                }
                if (idxB !== -1) {
                    return 1
                }
                return a.label.localeCompare(b.label)
            }),
        [vendorOrder],
    )

    const { vendorData, authFiles, loading, error, refresh } = useCredentialsData(vendors)
    const { lastRefreshedAt, isRefreshing, markRefreshed }   = useAutoRefresh(refresh, autoRefreshMs)
    const [aliases, setAliases]                              = useState<Record<string, string>>({})
    const [apiKeyUsageStats, setApiKeyUsageStats]            = useState<Record<string, SummaryApiKeyStats>>({})
    const quotaScheduler                                     = useBackendQuotaRegistration(authFiles)
    const quotaStatusMap                                     = quotaScheduler.statusMap
    const authFileByName                                     = useMemo(
        () => new Map(authFiles.map((file) => [file.name, file])),
        [authFiles],
    )

    const vendorOptions = useMemo(() => vendors.map((v) => ({ value: v.id, label: v.label })), [vendors])

    const visibleVendors = useMemo(() => {
        if (selectedVendors.length === 0) {
            return vendors
        }
        const set = new Set(selectedVendors)
        return vendors.filter((v) => set.has(v.id))
    }, [vendors, selectedVendors])

    useEffect(() => {
        localStorage.setItem(
            CREDENTIALS_UI_STATE_KEY,
            JSON.stringify({ searchQuery, statusFilter, typeFilter, selectedVendors }),
        )
    }, [searchQuery, statusFilter, typeFilter, selectedVendors])

    // Load API key aliases
    useEffect(() => {
        apiKeyAliasApi
            .list()
            .then(setAliases)
            .catch((err) => console.warn('Failed to load aliases:', err))
    }, [vendorData])

    // Mark initial load as refreshed
    useEffect(() => {
        if (!loading && !lastRefreshedAt) {
            markRefreshed()
        }
    }, [loading, lastRefreshedAt, markRefreshed])

    const refreshApiKeyUsageStats = useCallback(async () => {
        try {
            const summary = await usageApi.getSummary({ groups: 'all' })
            setApiKeyUsageStats(summary.by_api_key ?? {})
        } catch (err) {
            setApiKeyUsageStats({})
            console.warn('Failed to load API key usage stats:', err)
        }
    }, [])

    useEffect(() => {
        queueMicrotask(() => {
            void refreshApiKeyUsageStats()
        })
    }, [refreshApiKeyUsageStats])

    const handleRefresh = useCallback(async () => {
        await Promise.all([refresh(), refreshApiKeyUsageStats()])
        markRefreshed()
    }, [refresh, refreshApiKeyUsageStats, markRefreshed])

    const handleAliasChange = useCallback(
        async (apiKey: string, alias: string) => {
            try {
                if (alias) {
                    await apiKeyAliasApi.set(apiKey, alias)
                } else {
                    await apiKeyAliasApi.remove(apiKey)
                }
                const updated = await apiKeyAliasApi.list()
                setAliases(updated)
            } catch (err) {
                showNotification(t('credentials.alias_save_failed', { defaultValue: 'Failed to save alias' }), 'error')
                console.warn('Alias operation failed:', err)
            }
        },
        [showNotification, t],
    )

    // Batch operations
    const visibleAuthFileNames = useMemo(() => {
        if (typeFilter === 'api-key') {
            return []
        }
        const vendorSet       = selectedVendors.length > 0 ? new Set(selectedVendors) : null
        const names: string[] = []
        for (const [vendorId, fileNames] of Object.entries(visibleAuthFilesByVendor)) {
            if (vendorSet && !vendorSet.has(vendorId)) {
                continue
            }
            names.push(...fileNames)
        }
        return names
    }, [visibleAuthFilesByVendor, typeFilter, selectedVendors])

    const selectedVisibleItems = useMemo(() => {
        const visible = new Set(visibleAuthFileNames)
        return Array.from(selectedItems).filter((name) => visible.has(name))
    }, [selectedItems, visibleAuthFileNames])

    const selectedVisibleCount = selectedVisibleItems.length

    const handleToggleSelect = useCallback((id: string) => {
        setSelectedItems((prev) => {
            const next = new Set(prev)
            if (next.has(id)) {
                next.delete(id)
            } else {
                next.add(id)
            }
            return next
        })
    }, [])

    const handleSelectAll = useCallback(() => {
        setSelectedItems(new Set(visibleAuthFileNames))
    }, [visibleAuthFileNames])

    const handleDeselectAll = useCallback(() => {
        setSelectedItems(new Set())
    }, [])

    const handleSelectVendorFiles = useCallback((fileNames: string[], selected: boolean) => {
        setSelectedItems((prev) => {
            const next = new Set(prev)
            for (const name of fileNames) {
                if (selected) {
                    next.add(name)
                } else {
                    next.delete(name)
                }
            }
            return next
        })
    }, [])

    const handleVisibleAuthFilesChange = useCallback((vendorId: string, fileNames: string[]) => {
        setVisibleAuthFilesByVendor((prev) => {
            const previous = prev[vendorId] ?? []
            if (previous.length === fileNames.length && previous.every((name, index) => name === fileNames[index])) {
                return prev
            }
            return { ...prev, [vendorId]: fileNames }
        })
    }, [])

    const handleBatchDelete = useCallback(() => {
        if (selectedVisibleItems.length === 0) {
            return
        }
        const names = selectedVisibleItems
        showConfirmation({
                             title: t('credentials.batch_delete_title'),
                             message: t('credentials.batch_delete_confirm', { count: names.length }),
                             confirmText: t('common.delete'),
                             onConfirm: async () => {
                                 setBatchBusy(true)
                                 try {
                                     const result = await authFilesApi.deleteFiles(names)
                                     if (result.files.length > 0) {
                                         setSelectedItems(new Set())
                                         await refresh()
                                         markRefreshed()
                                     }
                                     if (result.failed.length === 0) {
                                         showNotification(t('auth_files.delete_success'), 'success')
                                     } else {
                                         const details = result.failed.map((item) => `${item.name}: ${item.error}`)
                                                               .join('; ')
                                         showNotification(
                                             `${t('auth_files.delete_filtered_partial', {
                                                 type: t('credentials.auth_files'),
                                                 success: result.deleted,
                                                 failed: result.failed.length,
                                             })}: ${details}`,
                                             'warning',
                                         )
                                     }
                                 } finally {
                                     setBatchBusy(false)
                                 }
                             },
                         })
    }, [selectedVisibleItems, showConfirmation, showNotification, t, refresh, markRefreshed])

    const handleBatchRefresh = useCallback(async () => {
        if (selectedVisibleItems.length === 0) {
            return
        }
        const refreshableItems = selectedVisibleItems.filter((name) => authFileByName.get(name)?.disabled !== true)
        const skippedDisabled  = selectedVisibleItems.length - refreshableItems.length
        if (refreshableItems.length === 0) {
            showNotification(
                t('credentials.batch_refresh_disabled_only', {
                    defaultValue: 'Selected credentials are disabled. Enable them or use the card refresh button to verify one account manually.',
                }),
                'warning',
            )
            return
        }
        setBatchBusy(true)
        try {
            await quotaScheduler.refreshMany(refreshableItems)
            await refresh()
            markRefreshed()
            if (skippedDisabled > 0) {
                showNotification(
                    t('credentials.batch_refresh_skipped_disabled', {
                        count: skippedDisabled,
                        defaultValue: 'Skipped {{count}} disabled credential(s). Use the card refresh button to verify one disabled account manually.',
                    }),
                    'warning',
                )
            }
        } finally {
            setBatchBusy(false)
        }
    }, [selectedVisibleItems, authFileByName, quotaScheduler, refresh, markRefreshed, showNotification, t])

    const handleBatchSetDisabled = useCallback(
        async (disabled: boolean) => {
            if (selectedVisibleItems.length === 0) {
                return
            }
            const names = selectedVisibleItems
            setBatchBusy(true)
            try {
                const result = disabled ? await authFilesApi.bulkDisable(names) : await authFilesApi.bulkEnable(names)
                await refresh()
                markRefreshed()
                const failed = result.failed ? Object.entries(result.failed) : []
                if (failed.length === 0) {
                    showNotification(t('common.success'), 'success')
                } else {
                    const details = failed.map(([name, message]) => `${name}: ${message}`).join('; ')
                    showNotification(
                        `${t('common.success')} (${result.updated.length}/${names.length}): ${details}`,
                        'warning',
                    )
                }
            } finally {
                setBatchBusy(false)
            }
        },
        [selectedVisibleItems, refresh, markRefreshed, showNotification, t],
    )

    return (
        <div className={styles.page}>
            <div className={styles.header}>
                <h1 className={styles.title}>{t('credentials.page_title')}</h1>
                <div className={styles.headerRight}>
                    {lastRefreshedAt && (
                        <span className={styles.lastUpdated}>
                            {t('credentials.last_updated')} {formatTime(lastRefreshedAt)}
                        </span>
                    )}
                    {(loading || isRefreshing) && <span className='loading-spinner' aria-hidden='true' />}
                </div>
            </div>

            <Tabs
                items={[
                    { value: 'credentials', label: t('credentials.tab_credentials', { defaultValue: '凭证列表' }) },
                    { value: 'inspection', label: t('credentials.tab_inspection', { defaultValue: '账号巡检' }) },
                ]}
                activeValue={activeTab}
                onChange={setActiveTab}
                ariaLabel={t('credentials.page_title')}
            />

            {activeTab === 'credentials' && (
                <div className={styles.toolbar}>
                    <Input
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder={t('auth_files.search_placeholder')}
                        className={styles.searchInput}
                        leftElement={<IconSearch size={14} />}
                    />
                    <MultiSelect
                        values={selectedVendors}
                        options={vendorOptions}
                        onChange={setSelectedVendors}
                        placeholder={t('credentials.vendor_filter_all')}
                        allLabel={t('credentials.vendor_filter_all')}
                        fullWidth={false}
                    />
                    <div className={styles.filterGroup}>
                        {(['all', 'available', 'exhausted', 'error', 'disabled'] as const).map((status) => (
                            <Button
                                key={status}
                                variant={statusFilter === status ? 'primary' : 'ghost'}
                                size='sm'
                                onClick={() => setStatusFilter(status)}
                            >
                                {t(`credentials.filter_${status}`)}
                            </Button>
                        ))}
                    </div>
                    <div className={styles.filterGroup}>
                        {(['all', 'api-key', 'auth-file'] as const).map((type) => (
                            <Button
                                key={type}
                                variant={typeFilter === type ? 'primary' : 'ghost'}
                                size='sm'
                                onClick={() => setTypeFilter(type)}
                            >
                                {t(`credentials.filter_type_${type.replace('-', '_')}`)}
                            </Button>
                        ))}
                    </div>
                </div>
            )}

            {activeTab === 'credentials' && <div className={styles.batchBar}>
                <div className={styles.batchSummary} aria-live='polite'>
                    <span className={styles.batchMode}>{t('credentials.batch_mode')}</span>
                    <span className={styles.batchCount}>
                        {t('credentials.batch_selected', {
                            selected: selectedVisibleCount,
                            total: visibleAuthFileNames.length,
                        })}
                    </span>
                </div>
                <div className={styles.batchActionPanel}>
                    <div
                        className={`${styles.batchGroup} ${styles.batchSelectionControls}`}
                        role='group'
                        aria-label={t('credentials.batch_selection_controls', { defaultValue: 'Selection controls' })}
                    >
                        <span className={styles.batchGroupLabel}>{t(
                            'credentials.batch_selection_label',
                            { defaultValue: '选择' },
                        )}</span>
                        <div className={styles.batchButtonRow}>
                            <Button variant='ghost' size='sm' onClick={handleSelectAll}>
                                {t('credentials.batch_select_all')}
                            </Button>
                            <Button variant='ghost' size='sm' onClick={handleDeselectAll}
                                    disabled={selectedItems.size === 0}>
                                {t('credentials.batch_deselect_all')}
                            </Button>
                        </div>
                    </div>
                    <div
                        className={`${styles.batchGroup} ${styles.batchRegularActions} ${selectedVisibleCount === 0 ?
                                                                                         styles.batchGroupDisabled :
                                                                                         ''}`}
                        role='group'
                        aria-label={t('credentials.batch_regular_actions', { defaultValue: 'Regular actions' })}
                    >
                        <span className={styles.batchGroupLabel}>{t(
                            'credentials.batch_actions_label',
                            { defaultValue: '批量操作' },
                        )}</span>
                        <div className={styles.batchButtonRow}>
                            <Button
                                variant='ghost'
                                size='sm'
                                onClick={() => void handleBatchRefresh()}
                                disabled={selectedVisibleCount === 0 || batchBusy}
                            >
                                {t('credentials.batch_refresh', { defaultValue: 'Refresh Selected' })}
                            </Button>
                            <Button
                                variant='ghost'
                                size='sm'
                                onClick={() => void handleBatchSetDisabled(false)}
                                disabled={selectedVisibleCount === 0 || batchBusy}
                            >
                                {t('credentials.batch_enable_selected', { defaultValue: 'Enable Selected' })}
                            </Button>
                            <Button
                                variant='ghost'
                                size='sm'
                                onClick={() => void handleBatchSetDisabled(true)}
                                disabled={selectedVisibleCount === 0 || batchBusy}
                            >
                                {t('credentials.batch_disable_selected', { defaultValue: 'Disable Selected' })}
                            </Button>
                        </div>
                    </div>
                </div>
                <div
                    className={`${styles.batchGroup} ${styles.batchDangerAction} ${selectedVisibleCount === 0 ?
                                                                                   styles.batchGroupDisabled :
                                                                                   ''}`}
                    role='group'
                    aria-label={t('credentials.batch_danger_actions', { defaultValue: 'Danger actions' })}
                >
                    <span className={styles.batchGroupLabel}>{t('credentials.batch_danger_label')}</span>
                    <Button
                        variant='danger'
                        size='sm'
                        fullWidth
                        onClick={handleBatchDelete}
                        disabled={selectedVisibleCount === 0 || batchBusy}
                        loading={batchBusy}
                    >
                        {t('credentials.batch_delete')}
                    </Button>
                </div>
            </div>}

            {error && <div className={styles.error}>{error}</div>}

            {activeTab === 'inspection' && <AccountInspectionPanel onCredentialsChanged={handleRefresh} />}

            {activeTab ===
             'credentials' &&
             <div className={styles.vendorList} aria-busy={loading && authFiles.length === 0}>
                 {visibleVendors.map((vendor) => (
                     <div
                         key={vendor.id}
                         draggable
                         onDragStart={() => {
                             dragVendorRef.current = vendor.id
                         }}
                         onDragOver={(e) => {
                             e.preventDefault()
                         }}
                         onDrop={() => {
                             const from = dragVendorRef.current
                             if (!from || from === vendor.id) {
                                 return
                             }
                             const order   = vendors.map((v) => v.id)
                             const fromIdx = order.indexOf(from)
                             const toIdx   = order.indexOf(vendor.id)
                             if (fromIdx === -1 || toIdx === -1) {
                                 return
                             }
                             order.splice(fromIdx, 1)
                             order.splice(toIdx, 0, from)
                             localStorage.setItem(CREDENTIALS_VENDOR_ORDER_KEY, JSON.stringify(order))
                             setVendorOrder(order)
                         }}
                     >
                         <VendorSection
                             vendor={vendor}
                             data={vendorData.get(vendor.id) ?? { apiKeys: [], authFiles: [] }}
                             aliases={aliases}
                             onAliasChange={handleAliasChange}
                             disableControls={loading || batchBusy}
                             onRefresh={handleRefresh}
                             searchQuery={searchQuery}
                             statusFilter={statusFilter}
                             typeFilter={typeFilter}
                             selectedItems={selectedItems}
                             onToggleSelect={handleToggleSelect}
                             onSelectVendorFiles={handleSelectVendorFiles}
                             onVisibleAuthFilesChange={handleVisibleAuthFilesChange}
                             quotaStatusMap={quotaStatusMap}
                             apiKeyUsageStats={apiKeyUsageStats}
                             scheduler={quotaScheduler}
                         />
                     </div>
                 ))}
                 {visibleVendors.length === 0 && !loading && (
                     <div className={styles.error}>{t('credentials.no_filter_results')}</div>
                 )}
             </div>}

            {activeTab === 'credentials' && <GlobalSettings config={config} disableControls={loading} />}
        </div>
    )
}
