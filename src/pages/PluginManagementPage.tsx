import {Sheet, type SheetColumn} from '@/components/common/Sheet'
import {OAuthLoginAction} from '@/components/credentials/OAuthLoginAction'
import {Button} from '@/components/ui/Button'
import {Card} from '@/components/ui/Card'
import {Input} from '@/components/ui/Input'
import {Modal} from '@/components/ui/Modal'
import {Select} from '@/components/ui/Select'
import {ToggleSwitch} from '@/components/ui/ToggleSwitch'
import {IconSlidersHorizontal} from '@/components/ui/icons'
import {
    type PluginConfigField,
    type PluginConfigObject,
    type PluginConfigValue,
    type PluginEntry,
    type PluginStoreEntry,
    pluginsApi,
    pluginStoreApi,
} from '@/services/api/plugins'
import {apiClient} from '@/services/api/client'
import {useAuthStore, useNotificationStore} from '@/stores'
import {getErrorMessage} from '@/utils/helpers'
import {safeExternalUrl} from '@/utils/validation'
import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {Link, useNavigate} from 'react-router-dom'
import styles from './PluginManagementPage.module.scss'
import {buildPluginResourceRoute, getPluginLogo, resolvePluginAssetURL} from './pluginResources'

type PluginPageStatus = 'loading' | 'ready' | 'empty' | 'error'

type PluginBadgeTone = 'success' | 'warning' | 'muted' | 'error'

const EMPTY_PLUGIN_STORE_ENTRIES: PluginStoreEntry[] = []

function isJsonConfigValue(value: PluginConfigValue): value is PluginConfigValue[] | {
    [key: string]: PluginConfigValue
} {
    return Array.isArray(value) || (value !== null && typeof value === 'object')
}

function stringifyConfigValue(value: PluginConfigValue | undefined, fieldType: string): string {
    if (value === undefined || value === null) {
        return fieldType === 'array' ? '[]' : fieldType === 'object' ? '{}' : ''
    }
    if (isJsonConfigValue(value)) {
        return JSON.stringify(value, null, 2)
    }
    return String(value)
}

function normalizeNumberInput(value: string, integer: boolean): PluginConfigValue {
    const trimmed = value.trim()
    if (!trimmed) {
        return null
    }
    const parsed = integer ? Number.parseInt(trimmed, 10) : Number(trimmed)
    return Number.isFinite(parsed) ? parsed : trimmed
}

function pluginTitle(plugin: PluginEntry): string {
    return plugin.metadata?.name?.trim() || plugin.id
}

function statusTone(plugin: PluginEntry, pluginsEnabled: boolean): PluginBadgeTone {
    if (!pluginsEnabled) {
        return 'warning'
    }
    if (!plugin.registered) {
        return 'error'
    }
    if (!plugin.enabled) {
        return 'muted'
    }
    return plugin.effective_enabled ? 'success' : 'warning'
}

function pluginStatusKey(plugin: PluginEntry, pluginsEnabled: boolean): string {
    if (!pluginsEnabled) {
        return 'plugin_management.status_global_disabled'
    }
    if (!plugin.registered) {
        return 'plugin_management.status_not_registered'
    }
    if (!plugin.enabled) {
        return 'plugin_management.status_disabled'
    }
    return plugin.effective_enabled ?
           'plugin_management.status_effective_enabled' :
           'plugin_management.status_not_effective'
}

function Badge({ tone, children }: { tone: PluginBadgeTone; children: string }) {
    return <span className={`${styles.badge} ${styles[`badge_${tone}`]}`}>{children}</span>
}

function PluginLogo({src}: {src: string}) {
    const [failed, setFailed] = useState(false)
    return src && !failed ?
           <img src={src} alt='' onError={() => setFailed(true)} /> :
           <IconSlidersHorizontal size={18} />
}

export function PluginManagementPage() {
    const { t }                = useTranslation()
    const navigate             = useNavigate()
    const apiBase              = useAuthStore((state) => state.apiBase)
    const managementKey        = useAuthStore((state) => state.managementKey)
    const connectionStatus     = useAuthStore((state) => state.connectionStatus)
    const authGeneration       = useAuthStore(() => apiClient.getAuthGeneration())
    const { showNotification } = useNotificationStore()
    const mountedRef           = useRef(true)
    const [pageGeneration, setPageGeneration] = useState(authGeneration)
    const isCurrentConnection = useCallback(
        () => mountedRef.current && authGeneration === apiClient.getAuthGeneration(),
        [authGeneration],
    )

    const [data, setData]                             = useState<(Awaited<ReturnType<typeof pluginsApi.list>> & {authGeneration: number}) | null>(null)
    const requestSequence                            = useRef(0)
    const [oauthSelection, setOAuthSelection]         = useState<{id: string; authGeneration: number} | null>(null)
    const [status, setStatus]                         = useState<PluginPageStatus>('loading')
    const [error, setError]                           = useState<string | null>(null)
    const [refreshing, setRefreshing]                 = useState(false)
    const [savingPluginID, setSavingPluginID]         = useState<string | null>(null)
    const [deletingPluginID, setDeletingPluginID]     = useState<string | null>(null)
    const [deletePluginTarget, setDeletePluginTarget] = useState<PluginEntry | null>(null)
    const [expandedPluginID, setExpandedPluginID]     = useState<string | null>(null)
    const [editingPlugin, setEditingPlugin]           = useState<PluginEntry | null>(null)
    const [configDraft, setConfigDraft]               = useState<PluginConfigObject>({})
    const [jsonDraft, setJsonDraft]                   = useState<Record<string, string>>({})
    const [configError, setConfigError]               = useState<string | null>(null)
    const [savingConfig, setSavingConfig]             = useState(false)
    const [storeLogos, setStoreLogos]                 = useState<{
        apiBase: string
        managementKey: string
        entries: PluginStoreEntry[]
        error: string
    } | null>(null)

    if (pageGeneration !== authGeneration) {
        setPageGeneration(authGeneration)
        setData(null)
        setStatus('loading')
        setError(null)
        setRefreshing(false)
        setSavingPluginID(null)
        setDeletingPluginID(null)
        setDeletePluginTarget(null)
        setExpandedPluginID(null)
        setEditingPlugin(null)
        setConfigDraft({})
        setJsonDraft({})
        setConfigError(null)
        setSavingConfig(false)
        setOAuthSelection(null)
        setStoreLogos(null)
    }

    const currentData      = data?.authGeneration === apiClient.getAuthGeneration() ? data : null
    const plugins          = currentData?.plugins ?? []
    const pluginsEnabled   = currentData?.plugins_enabled ?? false
    const pluginsDir       = currentData?.plugins_dir || 'plugins'
    const oauthPlugin      = pluginsEnabled && oauthSelection?.authGeneration === currentData?.authGeneration
        ? plugins.find((plugin) => plugin.id === oauthSelection?.id && plugin.effective_enabled && plugin.supports_oauth && plugin.oauth_provider)
        : undefined
    const needsStoreLogos  = plugins.some((plugin) => !plugin.logo?.trim() && !plugin.metadata?.logo?.trim())
    const currentStoreLogos = storeLogos?.apiBase === apiBase && storeLogos.managementKey === managementKey
                              ? storeLogos : null
    const logoEntries      = currentStoreLogos?.entries ?? EMPTY_PLUGIN_STORE_ENTRIES

    useEffect(() => {
        mountedRef.current = true
        return () => {
            mountedRef.current = false
        }
    }, [authGeneration])

    const fetchPlugins = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
        if (!isCurrentConnection()) {
            return
        }
        const sequence = ++requestSequence.current
        const isCurrent = () => sequence === requestSequence.current && isCurrentConnection()
        if (!silent) {
            setStatus('loading')
        } else {
            setRefreshing(true)
        }
        setError(null)
        try {
            const next = await pluginsApi.list()
            if (!isCurrent()) {
                return
            }
            setData({...next, authGeneration})
            setStatus(next.plugins.length > 0 ? 'ready' : 'empty')
        } catch (err: unknown) {
            if (!isCurrent()) {
                return
            }
            const message = err instanceof Error ? err.message : String(err ?? '')
            setError(message || t('common.unknown_error'))
            setStatus('error')
        } finally {
            if (isCurrent()) {
                setRefreshing(false)
            }
        }
    }, [authGeneration, isCurrentConnection, t])

    useEffect(() => {
        const requests = requestSequence
        const timer = window.setTimeout(() => {
            void fetchPlugins()
        }, 0)
        return () => {
            window.clearTimeout(timer)
            ++requests.current
        }
    }, [fetchPlugins, apiBase, managementKey])

    useEffect(() => {
        if (connectionStatus !== 'connected' || !currentData?.plugins.some(
            (plugin) => !plugin.logo?.trim() && !plugin.metadata?.logo?.trim(),
        )) {
            return
        }
        const controller = new AbortController()
        void pluginStoreApi.list({signal: controller.signal, timeout: 15_000})
            .then((response) => {
                if (!Array.isArray(response.plugins)) {
                    throw new Error('Invalid plugin store response')
                }
                if (!controller.signal.aborted && isCurrentConnection()) {
                    setStoreLogos({apiBase, managementKey, entries: response.plugins, error: ''})
                }
            })
            .catch((err: unknown) => {
                if (!controller.signal.aborted && isCurrentConnection()) {
                    setStoreLogos({apiBase, managementKey, entries: [], error: getErrorMessage(err)})
                }
            })
        return () => controller.abort()
    }, [apiBase, connectionStatus, currentData, isCurrentConnection, managementKey])

    const openConfig = useCallback((plugin: PluginEntry) => {
        if (!isCurrentConnection()) {
            return
        }
        const nextConfig                       = { ...(plugin.config ?? {}) }
        const nextJson: Record<string, string> = {}
        for (const field of plugin.config_fields) {
            if (field.type === 'array' || field.type === 'object') {
                nextJson[field.name] = stringifyConfigValue(nextConfig[field.name], field.type)
            }
        }
        setEditingPlugin(plugin)
        setConfigDraft(nextConfig)
        setJsonDraft(nextJson)
        setConfigError(null)
    }, [isCurrentConnection])

    const closeConfig = useCallback(() => {
        if (savingConfig || !isCurrentConnection()) {
            return
        }
        setEditingPlugin(null)
        setConfigDraft({})
        setJsonDraft({})
        setConfigError(null)
    }, [isCurrentConnection, savingConfig])

    const handleTogglePlugin = useCallback(
        async (plugin: PluginEntry, enabled: boolean) => {
            if (!isCurrentConnection()) {
                return
            }
            setSavingPluginID(plugin.id)
            try {
                await pluginsApi.setEnabled(plugin.id, enabled)
                if (!isCurrentConnection()) {
                    return
                }
                showNotification(t('plugin_management.save_success'), 'success')
                await fetchPlugins({ silent: true })
            } catch (err: unknown) {
                if (!isCurrentConnection()) {
                    return
                }
                const message = err instanceof Error ? err.message : String(err ?? '')
                showNotification(`${t('plugin_management.save_failed')}${message ? `: ${message}` : ''}`, 'error')
            } finally {
                if (isCurrentConnection()) {
                    setSavingPluginID((current) => current === plugin.id ? null : current)
                }
            }
        },
        [fetchPlugins, isCurrentConnection, showNotification, t],
    )

    const closeDelete = useCallback(() => {
        if (deletingPluginID || !isCurrentConnection()) {
            return
        }
        setDeletePluginTarget(null)
    }, [deletingPluginID, isCurrentConnection])

    const handleDeletePlugin = useCallback(async () => {
        if (!deletePluginTarget || !isCurrentConnection()) {
            return
        }
        setDeletingPluginID(deletePluginTarget.id)
        try {
            const result = await pluginsApi.deletePlugin(deletePluginTarget.id)
            if (!isCurrentConnection()) {
                return
            }
            showNotification(t('plugin_management.delete_success'), 'success')
            if (result.restart_required) {
                showNotification(t('plugin_management.delete_restart_required'), 'warning')
            }
            setDeletePluginTarget(null)
            await fetchPlugins({ silent: true })
        } catch (err: unknown) {
            if (!isCurrentConnection()) {
                return
            }
            const message = err instanceof Error ? err.message : String(err ?? '')
            showNotification(`${t('plugin_management.delete_failed')}${message ? `: ${message}` : ''}`, 'error')
        } finally {
            if (isCurrentConnection()) {
                setDeletingPluginID((current) => current === deletePluginTarget.id ? null : current)
            }
        }
    }, [deletePluginTarget, fetchPlugins, isCurrentConnection, showNotification, t])

    const handleConfigValueChange = useCallback((field: string, value: PluginConfigValue) => {
        if (isCurrentConnection()) {
            setConfigDraft((prev) => ({ ...prev, [field]: value }))
        }
    }, [isCurrentConnection])

    const handleSaveConfig = useCallback(async () => {
        if (!editingPlugin || !isCurrentConnection()) {
            return
        }
        setConfigError(null)
        const payload: PluginConfigObject = { ...configDraft }
        for (const field of editingPlugin.config_fields) {
            if (field.type !== 'array' && field.type !== 'object') {
                continue
            }
            const text = jsonDraft[field.name]?.trim() ?? ''
            if (!text) {
                payload[field.name] = null
                continue
            }
            try {
                payload[field.name] = JSON.parse(text) as PluginConfigValue
            } catch {
                setConfigError(t('plugin_management.invalid_json', { field: field.name }))
                return
            }
        }

        setSavingConfig(true)
        try {
            await pluginsApi.patchConfig(editingPlugin.id, payload)
            if (!isCurrentConnection()) {
                return
            }
            showNotification(t('plugin_management.save_success'), 'success')
            setEditingPlugin(null)
            setConfigDraft({})
            setJsonDraft({})
            await fetchPlugins({ silent: true })
        } catch (err: unknown) {
            if (!isCurrentConnection()) {
                return
            }
            const message = err instanceof Error ? err.message : String(err ?? '')
            setConfigError(message || t('plugin_management.save_failed'))
        } finally {
            if (isCurrentConnection()) {
                setSavingConfig(false)
            }
        }
    }, [configDraft, editingPlugin, fetchPlugins, isCurrentConnection, jsonDraft, showNotification, t])

    const renderConfigInput = (field: PluginConfigField) => {
        const value = configDraft[field.name]
        if (field.type === 'boolean') {
            return (
                <ToggleSwitch
                    checked={Boolean(value)}
                    onChange={(next) => handleConfigValueChange(field.name, next)}
                    ariaLabel={field.name}
                />
            )
        }
        if (field.type === 'enum') {
            return (
                <Select
                    value={typeof value === 'string' ? value : ''}
                    options={field.enum_values.map((item) => ({ value: item, label: item }))}
                    onChange={(next) => handleConfigValueChange(field.name, next)}
                    placeholder={t('plugin_management.select_placeholder')}
                />
            )
        }
        if (field.type === 'array' || field.type === 'object') {
            return (
                <textarea
                    className={styles.textarea}
                    value={jsonDraft[field.name] ?? stringifyConfigValue(value, field.type)}
                    onChange={(event) => {
                        if (isCurrentConnection()) {
                            setJsonDraft((prev) => ({ ...prev, [field.name]: event.target.value }))
                        }
                    }}
                    spellCheck={false}
                />
            )
        }
        if (field.type === 'number' || field.type === 'integer') {
            return (
                <Input
                    type='number'
                    value={value === undefined || value === null ? '' : String(value)}
                    onChange={(event) =>
                        handleConfigValueChange(
                            field.name,
                            normalizeNumberInput(event.target.value, field.type === 'integer'),
                        )
                    }
                />
            )
        }
        return (
            <Input
                value={value === undefined || value === null || isJsonConfigValue(value) ? '' : String(value)}
                onChange={(event) => handleConfigValueChange(field.name, event.target.value)}
            />
        )
    }

    const columns = useMemo<Array<SheetColumn<PluginEntry>>>(
        () => [
            {
                key: 'plugin',
                header: t('plugin_management.plugin'),
                sortable: true,
                sortValue: (plugin) => pluginTitle(plugin),
                cell: (plugin) => {
                    const logo = resolvePluginAssetURL(getPluginLogo(plugin, logoEntries), apiBase)
                    return (
                        <div className={styles.pluginCell}>
                            <span className={styles.pluginLogo} aria-hidden='true'>
                                <PluginLogo key={logo} src={logo} />
                            </span>
                            <div className={styles.pluginIdentity}>
                                <div className={styles.pluginName}>{pluginTitle(plugin)}</div>
                                <div className={styles.pluginID}>{plugin.id}</div>
                                {plugin.path && <div className={styles.pluginPath}>{plugin.path}</div>}
                            </div>
                        </div>
                    )
                },
            },
            {
                key: 'status',
                header: t('common.status'),
                sortable: true,
                sortValue: (plugin) => plugin.effective_enabled ? 1 : 0,
                cell: (plugin) => (
                    <div className={styles.statusCell}>
                        <Badge tone={statusTone(plugin, pluginsEnabled)}>
                            {t(pluginStatusKey(plugin, pluginsEnabled))}
                        </Badge>
                        {plugin.supports_oauth && <Badge tone='muted'>{t('plugin_management.supports_oauth')}</Badge>}
                    </div>
                ),
            },
            {
                key: 'config',
                header: t('plugin_management.config'),
                sortable: true,
                sortValue: (plugin) => plugin.config_fields.length,
                cell: (plugin) => (
                    <div className={styles.metaStack}>
                        <span>{t(
                            'plugin_management.config_fields_count',
                            { count: plugin.config_fields.length },
                        )}</span>
                        <span>{plugin.configured ?
                               t('plugin_management.configured') :
                               t('plugin_management.not_configured')}</span>
                    </div>
                ),
            },
            {
                key: 'menus',
                header: t('plugin_management.menus'),
                sortable: true,
                sortValue: (plugin) => plugin.menus.length,
                cell: (plugin) => (
                    <div className={styles.menuList}>
                        {plugin.menus.length === 0 ? (
                            <span className={styles.muted}>{t('plugin_management.no_menus')}</span>
                        ) : plugin.menus.map((menu) => (
                            <button
                                key={`${plugin.id}-${menu.path}`}
                                type='button'
                                className={styles.menuLink}
                                title={menu.description || menu.path}
                                onClick={() => navigate(buildPluginResourceRoute(plugin.id, menu.path))}
                            >
                                {menu.menu || menu.path}
                            </button>
                        ))}
                    </div>
                ),
            },
            {
                key: 'actions',
                header: t('common.action'),
                cell: (plugin) => (
                    <div className={styles.actionCell}>
                        <ToggleSwitch
                            checked={plugin.enabled}
                            disabled={savingPluginID === plugin.id}
                            onChange={(next) => void handleTogglePlugin(plugin, next)}
                            ariaLabel={t('plugin_management.toggle_plugin', { id: plugin.id })}
                        />
                        <Button type='button' variant='secondary' size='sm' onClick={() => openConfig(plugin)}>
                            {t('common.edit')}
                        </Button>
                        {plugin.supports_oauth && plugin.oauth_provider && (
                            <Button
                                type='button'
                                variant='secondary'
                                size='sm'
                                disabled={!pluginsEnabled || !plugin.effective_enabled || connectionStatus !== 'connected' || savingPluginID === plugin.id || deletingPluginID === plugin.id}
                                onClick={() => {
                                    if (currentData?.authGeneration === apiClient.getAuthGeneration()) {
                                        setOAuthSelection({id: plugin.id, authGeneration: currentData.authGeneration})
                                    }
                                }}
                            >
                                {t('auth_login.login_button')}
                            </Button>
                        )}
                        <Button
                            type='button'
                            variant='ghost'
                            size='sm'
                            onClick={() => setExpandedPluginID((prev) => prev === plugin.id ? null : plugin.id)}
                        >
                            {expandedPluginID === plugin.id ? t('common.collapse') : t('common.expand')}
                        </Button>
                        <Button
                            type='button'
                            variant='danger'
                            size='sm'
                            onClick={() => {
                                if (isCurrentConnection()) {
                                    setDeletePluginTarget(plugin)
                                }
                            }}
                            loading={deletingPluginID === plugin.id}
                            disabled={Boolean(deletingPluginID && deletingPluginID !== plugin.id)}
                        >
                            {t('common.delete')}
                        </Button>
                    </div>
                ),
            },
        ],
        [
            apiBase,
            connectionStatus,
            currentData,
            deletingPluginID,
            expandedPluginID,
            handleTogglePlugin,
            isCurrentConnection,
            logoEntries,
            navigate,
            openConfig,
            pluginsEnabled,
            savingPluginID,
            t,
        ],
    )

    const renderExpandedRow = (plugin: PluginEntry) => {
        const repository     = plugin.metadata?.github_repository
        const repositoryURL  = safeExternalUrl(repository)
        const repositoryLink = repositoryURL ? (
            <a href={repositoryURL} target='_blank' rel='noopener noreferrer'>
                {repository}
            </a>
        ) : repository ? <span>{repository}</span> : null

        return (
            <>
                <tr className={styles.mainRow}>
                    {columns.map((column) => (
                        <td key={column.key} className={column.className}>{column.cell(plugin)}</td>
                    ))}
                </tr>
                {expandedPluginID === plugin.id && (
                    <tr className={styles.detailRow}>
                        <td colSpan={columns.length}>
                            <div className={styles.detailGrid}>
                                <div>
                                    <div className={styles.detailLabel}>{t('plugin_management.metadata')}</div>
                                    <div className={styles.detailText}>
                                        {plugin.metadata?.version &&
                                         <span>{t('plugin_management.version')}: {plugin.metadata.version}</span>}
                                        {plugin.metadata?.author &&
                                         <span>{t('plugin_management.author')}: {plugin.metadata.author}</span>}
                                        {repositoryLink}
                                    </div>
                                </div>
                                <div>
                                    <div className={styles.detailLabel}>{t('plugin_management.config_fields')}</div>
                                    <div className={styles.fieldPills}>
                                        {plugin.config_fields.length === 0 ? (
                                            <span className={styles.muted}>
                                                {t('plugin_management.no_config_fields')}
                                            </span>
                                        ) : plugin.config_fields.map((field) => (
                                            <span key={field.name} className={styles.fieldPill}
                                                  title={field.description}>
                                                {field.name}<span>{field.type}</span>
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </td>
                    </tr>
                )}
            </>
        )
    }

    return (
        <div className={styles.page}>
            <div className={styles.header}>
                <div>
                    <h1>{t('plugin_management.title')}</h1>
                    <p>{t('plugin_management.description')}</p>
                </div>
                <Button type='button' variant='secondary' onClick={() => void fetchPlugins({ silent: true })}
                        loading={refreshing}>
                    {t('common.refresh')}
                </Button>
            </div>

            <div className={styles.statsGrid}>
                <Card className={styles.statCard}>
                    <strong>{pluginsEnabled ? t('common.yes') : t('common.no')}</strong>
                    <span>{t('plugin_management.global_enabled')}</span>
                </Card>
                <Card className={styles.statCard}>
                    <strong>{pluginsDir}</strong>
                    <span>{t('plugin_management.plugins_dir')}</span>
                </Card>
                <Card className={styles.statCard}>
                    <strong>{plugins.length}</strong>
                    <span>{t('plugin_management.total_plugins')}</span>
                </Card>
            </div>

            {!pluginsEnabled && (
                <Card className={styles.noticeCard}>
                    <div className={styles.noticeTitle}>{t('plugin_management.global_disabled_title')}</div>
                    <p>{t('plugin_management.global_disabled_desc')}</p>
                    <Link to='/config' className={styles.inlineLink}>{t('plugin_management.open_config_source')}</Link>
                </Card>
            )}

            <Card title={t('plugin_management.list_title')}>
                {needsStoreLogos && currentStoreLogos?.error && (
                    <p role='alert' className={styles.storeLogoError}>
                        {t('plugin_store.load_failed')}: {currentStoreLogos.error}
                    </p>
                )}
                <Sheet
                    rows={plugins}
                    columns={columns}
                    rowKey={(plugin) => plugin.id}
                    status={status}
                    errorMessage={error ?? undefined}
                    onRetry={() => void fetchPlugins()}
                    emptyText={t('plugin_management.empty_title')}
                    emptyHint={t('plugin_management.empty_desc')}
                    searchable
                    searchPlaceholder={t('plugin_management.search_placeholder')}
                    searchPredicate={(plugin, keyword) =>
                        [plugin.id, plugin.path, plugin.metadata?.name, plugin.metadata?.author]
                            .filter(Boolean)
                            .some((value) => String(value).toLowerCase().includes(keyword))
                    }
                    pagination
                    defaultPageSize={20}
                    defaultSortKey='plugin'
                    defaultSortDir='asc'
                    refreshing={refreshing && status !== 'loading'}
                    renderRow={renderExpandedRow}
                    tableClassName={styles.pluginTable}
                />
            </Card>

            <Modal
                open={Boolean(oauthPlugin)}
                onClose={() => setOAuthSelection(null)}
                closeDisabled
                title={oauthPlugin ? `${pluginTitle(oauthPlugin)} OAuth` : undefined}
            >
                {oauthPlugin?.oauth_provider && (
                    <OAuthLoginAction
                        key={`${oauthPlugin.id}:${oauthPlugin.oauth_provider}:${oauthSelection?.authGeneration}`}
                        provider={oauthPlugin.oauth_provider}
                        plugin
                        disableControls={connectionStatus !== 'connected' || savingPluginID === oauthPlugin.id || deletingPluginID === oauthPlugin.id}
                        onSuccess={() => {
                            setOAuthSelection(null)
                            showNotification(t('credentials.oauth_success'), 'success')
                            navigate('/credentials')
                        }}
                        onCancel={() => setOAuthSelection(null)}
                    />
                )}
            </Modal>

            <Modal
                open={editingPlugin !== null}
                onClose={closeConfig}
                closeDisabled={savingConfig}
                width={720}
                title={editingPlugin ? t('plugin_management.edit_title', { id: editingPlugin.id }) : undefined}
                footer={(
                    <div className={styles.modalActions}>
                        <Button type='button' variant='ghost' onClick={closeConfig} disabled={savingConfig}>
                            {t('common.cancel')}
                        </Button>
                        <Button type='button' onClick={() => void handleSaveConfig()} loading={savingConfig}>
                            {t('common.save')}
                        </Button>
                    </div>
                )}
            >
                {editingPlugin && (
                    <div className={styles.configForm}>
                        <div className={styles.configRow}>
                            <label>{t('plugin_management.enabled')}</label>
                            <ToggleSwitch
                                checked={Boolean(configDraft.enabled ?? editingPlugin.enabled)}
                                onChange={(next) => handleConfigValueChange('enabled', next)}
                                ariaLabel={t('plugin_management.enabled')}
                            />
                        </div>
                        <Input
                            label={t('common.priority')}
                            type='number'
                            value={configDraft.priority === undefined || configDraft.priority === null ?
                                   '' :
                                   String(configDraft.priority)}
                            onChange={(event) => handleConfigValueChange(
                                'priority',
                                normalizeNumberInput(event.target.value, true),
                            )}
                        />
                        {editingPlugin.config_fields.length === 0 ? (
                            <div className={styles.emptyConfig}>{t('plugin_management.no_config_fields')}</div>
                        ) : editingPlugin.config_fields.map((field) => (
                            <div key={field.name} className={styles.configField}>
                                <div className={styles.fieldHeader}>
                                    <label>{field.name}</label>
                                    <span>{field.type}</span>
                                </div>
                                {renderConfigInput(field)}
                                {field.description && <p>{field.description}</p>}
                            </div>
                        ))}
                        {configError && <div className='error-box'>{configError}</div>}
                    </div>
                )}
            </Modal>

            <Modal
                open={deletePluginTarget !== null}
                onClose={closeDelete}
                closeDisabled={Boolean(deletingPluginID)}
                title={deletePluginTarget ?
                       t('plugin_management.delete_title', { id: deletePluginTarget.id }) :
                       undefined}
                footer={(
                    <div className={styles.modalActions}>
                        <Button type='button' variant='ghost' onClick={closeDelete}
                                disabled={Boolean(deletingPluginID)}>
                            {t('common.cancel')}
                        </Button>
                        <Button type='button' variant='danger' onClick={() => void handleDeletePlugin()}
                                loading={Boolean(deletingPluginID)}>
                            {t('common.delete')}
                        </Button>
                    </div>
                )}
            >
                {deletePluginTarget && (
                    <div className={styles.configForm}>
                        <p>{t('plugin_management.delete_confirm', { name: pluginTitle(deletePluginTarget) })}</p>
                        {deletePluginTarget.path && <div className={styles.pluginPath}>{deletePluginTarget.path}</div>}
                    </div>
                )}
            </Modal>
        </div>
    )
}
