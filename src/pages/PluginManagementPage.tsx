import {Sheet, type SheetColumn} from '@/components/common/Sheet'
import {Button} from '@/components/ui/Button'
import {Card} from '@/components/ui/Card'
import {Input} from '@/components/ui/Input'
import {Modal} from '@/components/ui/Modal'
import {Select} from '@/components/ui/Select'
import {ToggleSwitch} from '@/components/ui/ToggleSwitch'
import {
    type PluginConfigField,
    type PluginConfigObject,
    type PluginConfigValue,
    type PluginEntry,
    type PluginMenu,
    pluginsApi,
} from '@/services/api/plugins'
import {useAuthStore, useNotificationStore} from '@/stores'
import {normalizeApiBase} from '@/utils/connection'
import {useCallback, useEffect, useMemo, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {Link} from 'react-router-dom'
import styles from './PluginManagementPage.module.scss'

type PluginPageStatus = 'loading' | 'ready' | 'empty' | 'error'

type PluginBadgeTone = 'success' | 'warning' | 'muted' | 'error'

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

export function PluginManagementPage() {
    const { t }                = useTranslation()
    const auth                 = useAuthStore()
    const { showNotification } = useNotificationStore()

    const [data, setData]                         = useState<Awaited<ReturnType<typeof pluginsApi.list>> | null>(null)
    const [status, setStatus]                     = useState<PluginPageStatus>('loading')
    const [error, setError]                       = useState<string | null>(null)
    const [refreshing, setRefreshing]             = useState(false)
    const [savingPluginID, setSavingPluginID]     = useState<string | null>(null)
    const [openingMenuPath, setOpeningMenuPath]   = useState<string | null>(null)
    const [expandedPluginID, setExpandedPluginID] = useState<string | null>(null)
    const [editingPlugin, setEditingPlugin]       = useState<PluginEntry | null>(null)
    const [configDraft, setConfigDraft]           = useState<PluginConfigObject>({})
    const [jsonDraft, setJsonDraft]               = useState<Record<string, string>>({})
    const [configError, setConfigError]           = useState<string | null>(null)
    const [savingConfig, setSavingConfig]         = useState(false)

    const plugins        = data?.plugins ?? []
    const pluginsEnabled = data?.plugins_enabled ?? false
    const pluginsDir     = data?.plugins_dir || 'plugins'

    const fetchPlugins = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
        if (!silent) {
            setStatus('loading')
        } else {
            setRefreshing(true)
        }
        setError(null)
        try {
            const next = await pluginsApi.list()
            setData(next)
            setStatus(next.plugins.length > 0 ? 'ready' : 'empty')
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err ?? '')
            setError(message || t('common.unknown_error'))
            setStatus('error')
        } finally {
            setRefreshing(false)
        }
    }, [t])

    useEffect(() => {
        const timer = window.setTimeout(() => {
            void fetchPlugins()
        }, 0)
        return () => window.clearTimeout(timer)
    }, [fetchPlugins])

    const openPluginMenu = useCallback(async (menu: PluginMenu) => {
        const base        = normalizeApiBase(auth.apiBase) || window.location.origin
        const resourceURL = new URL(menu.path, base)
        if (resourceURL.origin !== new URL(base).origin || !resourceURL.pathname.startsWith('/v0/resource/plugins/')) {
            window.open(resourceURL.toString(), '_blank', 'noopener,noreferrer')
            return
        }

        const headers = auth.managementKey ? { Authorization: `Bearer ${auth.managementKey}` } : undefined
        const opened  = window.open('about:blank', '_blank')
        if (!opened) {
            showNotification(t('plugin_management.open_menu_blocked'), 'error')
            return
        }
        opened.opener = null
        setOpeningMenuPath(menu.path)
        try {
            const response = await fetch(resourceURL.toString(), { credentials: 'include', headers })
            if (!response.ok) {
                throw new Error(`${response.status} ${response.statusText}`.trim())
            }
            opened.location.href = resourceURL.toString()
        } catch (err: unknown) {
            opened.close()
            const message = err instanceof Error ? err.message : String(err ?? '')
            showNotification(`${t('plugin_management.open_menu_failed')}${message ? `: ${message}` : ''}`, 'error')
        } finally {
            setOpeningMenuPath(null)
        }
    }, [auth.apiBase, auth.managementKey, showNotification, t])

    const openConfig = useCallback((plugin: PluginEntry) => {
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
    }, [])

    const closeConfig = useCallback(() => {
        if (savingConfig) {
            return
        }
        setEditingPlugin(null)
        setConfigDraft({})
        setJsonDraft({})
        setConfigError(null)
    }, [savingConfig])

    const handleTogglePlugin = useCallback(
        async (plugin: PluginEntry, enabled: boolean) => {
            setSavingPluginID(plugin.id)
            try {
                await pluginsApi.setEnabled(plugin.id, enabled)
                showNotification(t('plugin_management.save_success'), 'success')
                await fetchPlugins({ silent: true })
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : String(err ?? '')
                showNotification(`${t('plugin_management.save_failed')}${message ? `: ${message}` : ''}`, 'error')
            } finally {
                setSavingPluginID(null)
            }
        },
        [fetchPlugins, showNotification, t],
    )

    const handleConfigValueChange = useCallback((field: string, value: PluginConfigValue) => {
        setConfigDraft((prev) => ({ ...prev, [field]: value }))
    }, [])

    const handleSaveConfig = useCallback(async () => {
        if (!editingPlugin) {
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
            showNotification(t('plugin_management.save_success'), 'success')
            setEditingPlugin(null)
            setConfigDraft({})
            setJsonDraft({})
            await fetchPlugins({ silent: true })
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err ?? '')
            setConfigError(message || t('plugin_management.save_failed'))
        } finally {
            setSavingConfig(false)
        }
    }, [configDraft, editingPlugin, fetchPlugins, jsonDraft, showNotification, t])

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
                    onChange={(event) => setJsonDraft((prev) => ({ ...prev, [field.name]: event.target.value }))}
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
                cell: (plugin) => (
                    <div className={styles.pluginCell}>
                        <div className={styles.pluginName}>{pluginTitle(plugin)}</div>
                        <div className={styles.pluginID}>{plugin.id}</div>
                        {plugin.path && <div className={styles.pluginPath}>{plugin.path}</div>}
                    </div>
                ),
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
                                disabled={openingMenuPath === menu.path}
                                onClick={() => void openPluginMenu(menu)}
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
                        <Button
                            type='button'
                            variant='ghost'
                            size='sm'
                            onClick={() => setExpandedPluginID((prev) => prev === plugin.id ? null : plugin.id)}
                        >
                            {expandedPluginID === plugin.id ? t('common.collapse') : t('common.expand')}
                        </Button>
                    </div>
                ),
            },
        ],
        [
            expandedPluginID,
            handleTogglePlugin,
            openConfig,
            openingMenuPath,
            openPluginMenu,
            pluginsEnabled,
            savingPluginID,
            t,
        ],
    )

    const renderExpandedRow = (plugin: PluginEntry) => (
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
                                    {plugin.metadata?.github_repository && (
                                        <a href={plugin.metadata.github_repository} target='_blank'
                                           rel='noopener noreferrer'>
                                            {plugin.metadata.github_repository}
                                        </a>
                                    )}
                                </div>
                            </div>
                            <div>
                                <div className={styles.detailLabel}>{t('plugin_management.config_fields')}</div>
                                <div className={styles.fieldPills}>
                                    {plugin.config_fields.length === 0 ? (
                                        <span className={styles.muted}>{t('plugin_management.no_config_fields')}</span>
                                    ) : plugin.config_fields.map((field) => (
                                        <span key={field.name} className={styles.fieldPill} title={field.description}>
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
        </div>
    )
}
