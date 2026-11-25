import {Sheet, type SheetColumn} from '@/components/common/Sheet'
import {OAuthLoginAction} from '@/components/credentials/OAuthLoginAction'
import {Button} from '@/components/ui/Button'
import {Card} from '@/components/ui/Card'
import {IconSlidersHorizontal} from '@/components/ui/icons'
import {Input} from '@/components/ui/Input'
import {Modal} from '@/components/ui/Modal'
import {Select} from '@/components/ui/Select'
import {ToggleSwitch} from '@/components/ui/ToggleSwitch'
import {useHeaderRefresh} from '@/hooks/useHeaderRefresh'
import {apiClient} from '@/services/api/client'
import {encodePluginConfigPatch, pluginConfigFieldMatches, type PluginConfigJSON} from '@/services/api/pluginConfigJSON'
import {
    type PluginConfigField,
    type PluginEntry,
    pluginsApi,
    pluginStoreApi,
    type PluginStoreEntry,
} from '@/services/api/plugins'
import {useAuthStore, useNotificationStore} from '@/stores'
import type {ApiError, ManagementMutationReceipt} from '@/types/api'
import {getErrorMessage} from '@/utils/helpers'
import {safeExternalUrl} from '@/utils/validation'
import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {Link, useNavigate} from 'react-router'
import styles from './PluginManagementPage.module.scss'
import {waitForPluginRuntimeState} from './pluginPolling'
import {buildPluginResourceRoute, getPluginLogo, resolvePluginAssetURL} from './pluginResources'

type PluginPageStatus = 'loading' | 'ready' | 'empty' | 'error'

type PluginBadgeTone = 'success' | 'warning' | 'muted' | 'error'
type PluginList = Awaited<ReturnType<typeof pluginsApi.list>>
type EditablePlugin = Omit<PluginEntry, 'config'> & { config: PluginConfigJSON }

const EMPTY_PLUGIN_STORE_ENTRIES: PluginStoreEntry[] = []

function configInput(value: string | undefined, fieldType: string): string {
    if (fieldType === 'array' || fieldType === 'object') {
        return value ?? (fieldType === 'array' ? '[]' : '{}')
    }
    if (value === undefined || value === 'null' || value.startsWith('[') || value.startsWith('{')) {
        return ''
    }
    return value.startsWith('"') ? JSON.parse(value) as string : value
}

function normalizeNumberInput(value: string, integer: boolean): string | undefined {
    if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value) || !Number.isFinite(Number(value))) {
        return undefined
    }
    if (integer && (!/^-?\d+$/.test(value) || !Number.isSafeInteger(Number(value)))) {
        return undefined
    }
    return value
}

function hasSavedPluginConfig(receipt?: ManagementMutationReceipt): boolean {
    return receipt?.result?.effects.some(({ kind }) => kind === 'configuration.persisted') ?? false
}

function pluginTitle(plugin: PluginEntry): string {
    return plugin.metadata?.name?.trim() || plugin.id
}

function statusTone(plugin: PluginEntry, pluginsEnabled: boolean): PluginBadgeTone {
    if (!pluginsEnabled) {
        return 'warning'
    }
    if (!plugin.enabled) {
        return 'muted'
    }
    if (!plugin.registered) {
        return 'error'
    }
    return plugin.effective_enabled ? 'success' : 'warning'
}

function pluginStatusKey(plugin: PluginEntry, pluginsEnabled: boolean): string {
    if (!pluginsEnabled) {
        return 'plugin_management.status_global_disabled'
    }
    if (!plugin.enabled) {
        return 'plugin_management.status_disabled'
    }
    if (!plugin.registered) {
        return 'plugin_management.status_not_registered'
    }
    return plugin.effective_enabled ?
           'plugin_management.status_effective_enabled' :
           'plugin_management.status_not_effective'
}

function Badge({ tone, children }: { tone: PluginBadgeTone; children: string }) {
    return <span className={`${styles.badge} ${styles[`badge_${tone}`]}`}>{children}</span>
}

function PluginLogo({ src }: { src: string }) {
    const [failed, setFailed] = useState(false)
    return src && !failed ?
           <img src={src} alt='' onError={() => setFailed(true)} /> :
           <IconSlidersHorizontal size={18} />
}

export function PluginManagementPage() {
    const { t }                               = useTranslation()
    const navigate                            = useNavigate()
    const apiBase                             = useAuthStore((state) => state.apiBase)
    const connectionStatus                    = useAuthStore((state) => state.connectionStatus)
    const authGeneration                      = useAuthStore(() => apiClient.getAuthGeneration())
    const { showNotification }                = useNotificationStore()
    const mountedRef                          = useRef(true)
    const [pageGeneration, setPageGeneration] = useState(authGeneration)
    const isCurrentConnection                 = useCallback(
        () => mountedRef.current && authGeneration === apiClient.getAuthGeneration(),
        [authGeneration],
    )

    const [data, setData]                             = useState<(Awaited<ReturnType<typeof pluginsApi.list>> & {
        authGeneration: number
    }) | null>(null)
    const requestSequence                             = useRef(0)
    const [oauthSelection, setOAuthSelection]         = useState<{ id: string; authGeneration: number } | null>(null)
    const [status, setStatus]                         = useState<PluginPageStatus>('loading')
    const [error, setError]                           = useState<string | null>(null)
    const [refreshing, setRefreshing]                 = useState(false)
    const [savingPluginID, setSavingPluginID]         = useState<string | null>(null)
    const [deletingPluginID, setDeletingPluginID]     = useState<string | null>(null)
    const [deletePluginTarget, setDeletePluginTarget] = useState<PluginEntry | null>(null)
    const [expandedPluginID, setExpandedPluginID]     = useState<string | null>(null)
    const [editingPlugin, setEditingPlugin]           = useState<EditablePlugin | null>(null)
    const [configDraft, setConfigDraft]               = useState<Record<string, string>>({})
    const configRequestSequence                       = useRef(0)
    const [configReadState, setConfigReadState]       = useState<'loading' | 'ready' | 'error'>('loading')
    const [configError, setConfigError]               = useState<string | null>(null)
    const [savingConfig, setSavingConfig]             = useState(false)
    const [storeLogos, setStoreLogos]                 = useState<{
                                                                     apiBase: string
                                                                     authGeneration: number
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
        ++configRequestSequence.current
        setConfigReadState('loading')
        setEditingPlugin(null)
        setConfigDraft({})
        setConfigError(null)
        setSavingConfig(false)
        setOAuthSelection(null)
        setStoreLogos(null)
    }

    const currentData       = status !== 'error' && data?.authGeneration === apiClient.getAuthGeneration() ? data : null
    const plugins           = currentData?.plugins ?? []
    const pluginsEnabled    = currentData?.plugins_enabled ?? false
    const pluginsDir        = currentData?.plugins_dir || 'plugins'
    const oauthPlugin       = pluginsEnabled && oauthSelection?.authGeneration === currentData?.authGeneration
                              ?
                              plugins.find((plugin) => plugin.id ===
                                                       oauthSelection?.id &&
                                                       plugin.effective_enabled &&
                                                       plugin.supports_oauth &&
                                                       plugin.oauth_provider)
                              :
                              undefined
    const needsStoreLogos   = plugins.some((plugin) => !plugin.logo?.trim() && !plugin.metadata?.logo?.trim())
    const currentStoreLogos = storeLogos?.apiBase === apiBase && storeLogos.authGeneration === authGeneration
                              ? storeLogos : null
    const logoEntries       = currentStoreLogos?.entries ?? EMPTY_PLUGIN_STORE_ENTRIES

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
        const sequence  = ++requestSequence.current
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
            setData({ ...next, authGeneration })
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
        const timer    = window.setTimeout(() => {
            void fetchPlugins()
        }, 0)
        return () => {
            window.clearTimeout(timer)
            ++requests.current
        }
    }, [fetchPlugins, apiBase, authGeneration])

    useEffect(() => {
        if (connectionStatus !== 'connected' || !currentData?.plugins.some(
            (plugin) => !plugin.logo?.trim() && !plugin.metadata?.logo?.trim(),
        )) {
            return
        }
        const controller = new AbortController()
        void pluginStoreApi.list({ signal: controller.signal, timeout: 15_000 })
                           .then((response) => {
                               if (!Array.isArray(response.plugins)) {
                                   throw new Error('Invalid plugin store response')
                               }
                               if (!controller.signal.aborted && isCurrentConnection()) {
                                   setStoreLogos({ apiBase, authGeneration, entries: response.plugins, error: '' })
                               }
                           })
                           .catch((err: unknown) => {
                               if (!controller.signal.aborted && isCurrentConnection()) {
                                   setStoreLogos({ apiBase, authGeneration, entries: [], error: getErrorMessage(err) })
                               }
                           })
        return () => controller.abort()
    }, [apiBase, connectionStatus, currentData, isCurrentConnection, authGeneration])

    useHeaderRefresh(fetchPlugins)

    const openConfig = useCallback(async (plugin: PluginEntry) => {
        if (!isCurrentConnection()) {
            return
        }
        const request = ++configRequestSequence.current
        setEditingPlugin({ ...plugin, config: {} })
        setConfigDraft({})
        setConfigError(null)
        setConfigReadState('loading')
        try {
            const nextConfig = await pluginsApi.getConfig(plugin.id)
            if (!isCurrentConnection() || request !== configRequestSequence.current) {
                return
            }
            setEditingPlugin({ ...plugin, config: nextConfig })
            setConfigReadState('ready')
        } catch (error: unknown) {
            if (!isCurrentConnection() || request !== configRequestSequence.current) {
                return
            }
            setConfigError(getErrorMessage(error))
            setConfigReadState('error')
        }
    }, [isCurrentConnection])

    const closeConfig = useCallback(() => {
        if (savingConfig || !isCurrentConnection()) {
            return
        }
        ++configRequestSequence.current
        setConfigReadState('loading')
        setEditingPlugin(null)
        setConfigDraft({})
        setConfigError(null)
    }, [isCurrentConnection, savingConfig])

    const publishPluginList = useCallback((response: PluginList) => {
        if (isCurrentConnection()) {
            ++requestSequence.current
            setData({ ...response, authGeneration })
            setStatus(response.plugins.length > 0 ? 'ready' : 'empty')
            setRefreshing(false)
            setError(null)
        }
    }, [authGeneration, isCurrentConnection])

    const confirmPluginRuntime = useCallback(async (id: string, enabled: boolean, initial?: PluginList) => {
        const matches = (plugin: PluginEntry, response: PluginList) => {
            const shouldRun = enabled && response.plugins_enabled
            return plugin.enabled === enabled && plugin.effective_enabled === shouldRun &&
                   (!shouldRun || plugin.registered)
        }
        if (initial?.plugins.some((plugin) => plugin.id === id && matches(plugin, initial))) {
            return initial
        }
        const result = await waitForPluginRuntimeState(id, matches, isCurrentConnection)
        publishPluginList(result.response)
        if (result.timedOut) {
            throw new Error(t('plugin_management.runtime_timeout'))
        }
        return result.response
    }, [isCurrentConnection, publishPluginList, t])

    const notifyConfigSaved = useCallback((enabled: boolean, response: PluginList) => {
        if (isCurrentConnection()) {
            const waiting = enabled && !response.plugins_enabled
            showNotification(
                t(waiting ? 'plugin_management.save_waiting_global' : 'plugin_management.save_success'),
                waiting ? 'info' : 'success',
            )
        }
    }, [isCurrentConnection, showNotification, t])

    const handleTogglePlugin = useCallback(
        async (plugin: PluginEntry, enabled: boolean) => {
            if (!isCurrentConnection()) {
                return
            }
            setSavingPluginID(plugin.id)
            let acknowledged = false
            let initial: PluginList | undefined
            try {
                await pluginsApi.setEnabled(plugin.id, enabled, (response) => {
                    initial = response
                    publishPluginList(response)
                })
                acknowledged = true
                if (isCurrentConnection()) {
                    notifyConfigSaved(enabled, await confirmPluginRuntime(plugin.id, enabled, initial))
                }
            } catch (err: unknown) {
                if (!isCurrentConnection()) {
                    return
                }
                const failure = err as ApiError
                const message = getErrorMessage(err)
                if (acknowledged || hasSavedPluginConfig(failure.mutation)) {
                    showNotification(t('plugin_management.runtime_check_failed', { message }), 'warning')
                } else {
                    showNotification(message || t('plugin_management.save_failed'), failure.mutation?.metadata_present ?
                                                                                    'warning' : 'error')
                }
            } finally {
                if (isCurrentConnection()) {
                    setSavingPluginID((current) => current === plugin.id ? null : current)
                }
            }
        },
        [confirmPluginRuntime, isCurrentConnection, notifyConfigSaved, publishPluginList, showNotification, t],
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
        const { id } = deletePluginTarget
        setDeletingPluginID(id)
        let stillListed = true
        try {
            const result = await pluginsApi.deletePlugin(id, (response) => {
                stillListed = response.plugins.some((plugin) => plugin.id === id)
                publishPluginList(response)
            })
            if (!isCurrentConnection()) {
                return
            }
            if (result.restart_required) {
                showNotification(t('plugin_management.delete_restart_required'), 'warning')
            } else if (stillListed) {
                showNotification(t('common.mutation_uncertain'), 'warning')
            } else {
                showNotification(t('plugin_management.delete_success'), 'success')
            }
            setDeletePluginTarget(null)
        } catch (err: unknown) {
            if (!isCurrentConnection()) {
                return
            }
            const failure = err as ApiError
            const body    = failure.data as { error?: string; restart_required?: boolean } | undefined
            const deleted = failure.mutation?.result?.effects.some(({ kind }) => kind === 'plugin.deleted') ||
                            body?.error ===
                            'plugin_delete_requires_restart' ||
                            body?.error ===
                            'plugin_runtime_sync_failed'
            if (deleted) {
                showNotification(t(body?.restart_required ? 'plugin_management.delete_restart_required' :
                                   'plugin_management.delete_partial'), 'warning')
                setDeletePluginTarget(null)
            } else {
                showNotification(getErrorMessage(err) || t('plugin_management.delete_failed'), 'error')
                if (failure.mutation?.result?.outcome !== 'rejected') {
                    setDeletePluginTarget(null)
                }
            }
        } finally {
            if (isCurrentConnection()) {
                setDeletingPluginID((current) => current === deletePluginTarget.id ? null : current)
            }
        }
    }, [deletePluginTarget, isCurrentConnection, publishPluginList, showNotification, t])

    const handleConfigValueChange = useCallback((field: string, value: string) => {
        if (isCurrentConnection()) {
            setConfigDraft((prev) => ({ ...prev, [field]: value }))
        }
    }, [isCurrentConnection])

    const handleSaveConfig = useCallback(
        async () => {
            if (!editingPlugin || !isCurrentConnection() || configReadState !== 'ready') {
                return
            }
            setConfigError(null)
            const baseline                  = editingPlugin.config
            const payload: PluginConfigJSON = Object.create(null)
            for (const { name, type } of [
                { name: 'enabled', type: 'boolean' },
                { name: 'priority', type: 'integer' },
                ...editingPlugin.config_fields,
            ]) {
                if (!Object.prototype.hasOwnProperty.call(configDraft, name)) {
                    continue
                }
                const text     = configDraft[name]
                const previous = Object.prototype.hasOwnProperty.call(baseline, name) ? baseline[name] : undefined
                let raw        = text.trim() ? JSON.stringify(text) : 'null'
                if (type === 'boolean') {
                    raw = text
                } else if (type === 'enum') {
                    raw = JSON.stringify(text)
                } else if (text.trim() && (type === 'number' || type === 'integer')) {
                    const number = normalizeNumberInput(text.trim(), type === 'integer')
                    if (number === undefined) {
                        setConfigError(t('plugin_management.invalid_number', { field: name }))
                        return
                    }
                    raw = number
                } else if (text.trim() && (type === 'array' || type === 'object')) {
                    if (text === configInput(previous, type)) {
                        continue
                    }
                    try {
                        const value: unknown = JSON.parse(text)
                        if (type === 'array' && !Array.isArray(value)) {
                            setConfigError(t('plugin_management.expected_array'))
                            return
                        }
                        if (type === 'object' && (!value || typeof value !== 'object' || Array.isArray(value))) {
                            setConfigError(t('plugin_management.expected_object'))
                            return
                        }
                        raw = text.trim()
                    } catch {
                        setConfigError(t('plugin_management.invalid_json', { field: name }))
                        return
                    }
                }
                if (raw === 'null' ? previous !== undefined : !pluginConfigFieldMatches(raw, previous)) {
                    payload[name] = raw
                }
            }
            if (Object.keys(payload).length === 0) {
                closeConfig()
                return
            }

            setSavingConfig(true)
            let acknowledged = false
            let saved        = false
            let receipt: ManagementMutationReceipt | undefined
            let initial: PluginList | undefined
            try {
                await pluginsApi.patchConfig(
                    editingPlugin.id,
                    encodePluginConfigPatch(payload),
                    (response, current) => {
                        initial = response
                        receipt = current
                        publishPluginList(response)
                    },
                )
                acknowledged = true
                if (!isCurrentConnection()) {
                    return
                }
                const config = await pluginsApi.getConfig(editingPlugin.id)
                if (!isCurrentConnection()) {
                    return
                }
                const allowRedactions = receipt?.result?.audit_available === true && hasSavedPluginConfig(receipt)
                saved                 =
                    Object.entries(payload).every(([key, value]) => value === 'null' ?
                                                                    !Object.prototype.hasOwnProperty.call(config, key) :
                                                                    Object.prototype.hasOwnProperty.call(config, key) &&
                                                                    pluginConfigFieldMatches(
                                                                        value,
                                                                        config[key],
                                                                        allowRedactions,
                                                                    ),
                    )
                if (!saved) {
                    setConfigReadState('error')
                    setConfigError(t('plugin_management.config_check_failed'))
                    return
                }
                const enabled = config.enabled === 'true'
                notifyConfigSaved(enabled, await confirmPluginRuntime(editingPlugin.id, enabled, initial))
                if (isCurrentConnection()) {
                    closeConfig()
                }
            } catch (err: unknown) {
                if (!isCurrentConnection()) {
                    return
                }
                const failure = err as ApiError
                const message = getErrorMessage(err)
                if (saved || hasSavedPluginConfig(failure.mutation)) {
                    showNotification(t('plugin_management.runtime_check_failed', { message }), 'warning')
                    closeConfig()
                } else if (acknowledged) {
                    setConfigReadState('error')
                    setConfigError(t('plugin_management.config_check_failed'))
                } else {
                    setConfigError(message || t('plugin_management.save_failed'))
                    if (failure.mutation && failure.mutation.result?.outcome !== 'rejected') {
                        setConfigReadState('error')
                    }
                }
            } finally {
                if (isCurrentConnection()) {
                    setSavingConfig(false)
                }
            }
        },
        [
            closeConfig, configDraft, configReadState, confirmPluginRuntime, editingPlugin, isCurrentConnection,
            notifyConfigSaved, publishPluginList, showNotification, t,
        ],
    )

    const renderConfigInput = (field: PluginConfigField) => {
        const saved = editingPlugin?.config
        const value = Object.prototype.hasOwnProperty.call(configDraft, field.name) ? configDraft[field.name] :
                      configInput(saved && Object.prototype.hasOwnProperty.call(saved, field.name) ?
                                  saved[field.name] :
                                  undefined, field.type)
        if (field.type === 'boolean') {
            return (
                <ToggleSwitch
                    checked={value === 'true'}
                    onChange={(next) => handleConfigValueChange(field.name, String(next))}
                    ariaLabel={field.name}
                />
            )
        }
        if (field.type === 'enum') {
            return (
                <Select
                    value={value}
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
                    aria-label={field.name}
                    value={value}
                    onChange={(event) => handleConfigValueChange(field.name, event.target.value)}
                    spellCheck={false}
                />
            )
        }
        return (
            <Input
                aria-label={field.name}
                type={field.type === 'number' || field.type === 'integer' ? 'number' : 'text'}
                value={value}
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
                                disabled={!pluginsEnabled ||
                                          !plugin.effective_enabled ||
                                          connectionStatus !==
                                          'connected' ||
                                          savingPluginID ===
                                          plugin.id ||
                                          deletingPluginID ===
                                          plugin.id}
                                onClick={() => {
                                    if (currentData?.authGeneration === apiClient.getAuthGeneration()) {
                                        setOAuthSelection({ id: plugin.id, authGeneration: currentData.authGeneration })
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
                    <strong>{currentData ? t(pluginsEnabled ? 'common.yes' : 'common.no') : '-'}</strong>
                    <span>{t('plugin_management.global_enabled')}</span>
                </Card>
                <Card className={styles.statCard}>
                    <strong>{currentData ? pluginsDir : '-'}</strong>
                    <span>{t('plugin_management.plugins_dir')}</span>
                </Card>
                <Card className={styles.statCard}>
                    <strong>{currentData ? plugins.length : '-'}</strong>
                    <span>{t('plugin_management.total_plugins')}</span>
                </Card>
            </div>

            {currentData?.plugins_enabled === false && (
                <Card className={styles.noticeCard}>
                    <div className={styles.noticeTitle}>{t('plugin_management.global_disabled_title')}</div>
                    <p>{t('plugin_management.global_disabled_desc')}</p>
                    <Link to='/config?field=pluginsEnabled' className={styles.inlineLink}>
                        {t('plugin_management.open_plugin_settings')}
                    </Link>
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
                    searchable={status === 'ready'}
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
                        disableControls={connectionStatus !==
                                         'connected' ||
                                         savingPluginID ===
                                         oauthPlugin.id ||
                                         deletingPluginID ===
                                         oauthPlugin.id}
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
                        <Button type='button' onClick={() => void handleSaveConfig()} loading={savingConfig}
                                disabled={configReadState !== 'ready'}>
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
                                checked={configDraft.enabled !== undefined ? configDraft.enabled === 'true' :
                                         editingPlugin.config.enabled === 'true'}
                                onChange={(next) => handleConfigValueChange('enabled', String(next))}
                                ariaLabel={t('plugin_management.enabled')}
                            />
                        </div>
                        <Input
                            label={t('common.priority')}
                            type='number'
                            value={configDraft.priority ?? configInput(editingPlugin.config.priority, 'integer')}
                            onChange={(event) => handleConfigValueChange('priority', event.target.value)}
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
                        {configReadState === 'loading' && <div role='status'>{t('common.loading')}</div>}
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
