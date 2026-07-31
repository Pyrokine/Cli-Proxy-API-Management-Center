import {Button} from '@/components/ui/Button'
import {Card} from '@/components/ui/Card'
import {EmptyState} from '@/components/ui/EmptyState'
import {
    IconDownload,
    IconExternalLink,
    IconGithub,
    IconRefreshCw,
    IconSearch,
    IconSettings,
    IconShield,
    IconSlidersHorizontal,
} from '@/components/ui/icons'
import {Input} from '@/components/ui/Input'
import {Modal} from '@/components/ui/Modal'
import {Select} from '@/components/ui/Select'
import {pluginStoreApi, type PluginStoreEntry, type PluginStoreResponse} from '@/services/api/plugins'
import {useAuthStore, useConfigStore, useNotificationStore} from '@/stores'
import {getErrorMessage} from '@/utils/helpers'
import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {useNavigate} from 'react-router-dom'
import {waitForPluginStoreState} from './pluginPolling'
import {
    buildGitHubReleasesPageURL,
    fetchPluginReleaseVersions,
    getGitHubRepositorySlug,
    isValidManualReleaseTag,
    supportsPluginVersionSelection,
    type PluginReleaseVersion,
} from './pluginReleaseVersions'
import {
    buildRepositoryURL,
    getPluginConfirmToken,
    isDefaultPluginStoreSource,
    isOfficialPlugin,
    notifyPluginResourcesChanged,
    resolvePluginAssetURL,
} from './pluginResources'
import styles from './PluginStorePage.module.scss'

type StoreStatusFilter = 'all' | 'installed' | 'notInstalled' | 'updates'

const normalizePluginVersion = (version: string) => version.trim().replace(/^v/i, '')
const pluginVersionMatches   = (left: string, right: string) => normalizePluginVersion(left) ===
                                                                normalizePluginVersion(right)
const formatPluginVersion    = (version: string) => {
    const normalized = normalizePluginVersion(version)
    return normalized ? `v${normalized}` : ''
}
const storeEntryTitle        = (entry: PluginStoreEntry) => entry.name?.trim() || entry.id
const storeEntryKey          = (entry: PluginStoreEntry) => entry.store_id || `${entry.source_id}/${entry.id}`

function StoreLogo({ src }: { src?: string }) {
    const [failed, setFailed] = useState(false)
    if (src && !failed) {
        return <img src={src} alt='' onError={() => setFailed(true)} />
    }
    return <IconSlidersHorizontal size={18} />
}

const isAbortError = (err: unknown) => {
    if (err instanceof DOMException && err.name === 'AbortError') {
        return true
    }
    if (!err || typeof err !== 'object') {
        return false
    }
    const error = err as { code?: unknown; name?: unknown }
    return error.code === 'ERR_CANCELED' || error.name === 'CanceledError'
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value)

const pluginStoreErrorRestartRequired = (err: unknown) => {
    if (!isRecord(err)) {
        return false
    }
    const details = isRecord(err.details) ? err.details : isRecord(err.data) ? err.data : null
    return details?.restart_required === true
}

export function PluginStorePage() {
    const { t }                = useTranslation()
    const navigate             = useNavigate()
    const apiBase              = useAuthStore((state) => state.apiBase)
    const clearConfigCache     = useConfigStore((state) => state.clearCache)
    const { showNotification } = useNotificationStore()
    const mountedRef           = useRef(true)
    const loadAbortRef         = useRef<AbortController | null>(null)
    const installAbortRef      = useRef<AbortController | null>(null)
    const releaseAbortRef      = useRef<AbortController | null>(null)

    const [data, setData]                                 = useState<PluginStoreResponse | null>(null)
    const [loading, setLoading]                           = useState(true)
    const [error, setError]                               = useState('')
    const [filter, setFilter]                             = useState('')
    const [statusFilter, setStatusFilter]                 = useState<StoreStatusFilter>('all')
    const [installingKey, setInstallingKey]               = useState('')
    const [installEntry, setInstallEntry]                 = useState<PluginStoreEntry | null>(null)
    const [installVersion, setInstallVersion]             = useState('')
    const [releaseVersions, setReleaseVersions]           = useState<PluginReleaseVersion[]>([])
    const [releaseVersionsLoading, setReleaseVersionsLoading] = useState(false)
    const [releaseVersionsError, setReleaseVersionsError] = useState('')
    const [gateEntry, setGateEntry]                       = useState<PluginStoreEntry | null>(null)
    const [gateIsUpdate, setGateIsUpdate]                 = useState(false)
    const [gateRequestedVersion, setGateRequestedVersion] = useState('')
    const [gateStep, setGateStep]                         = useState(1)
    const [gateTyped, setGateTyped]                       = useState('')
    const [restartRequiredKeys, setRestartRequiredKeys]   = useState<string[]>([])

    const loadStore = useCallback(async (options?: { skipLeadingState?: boolean }) => {
        loadAbortRef.current?.abort()
        const controller     = new AbortController()
        loadAbortRef.current = controller
        if (!options?.skipLeadingState) {
            setLoading(true)
            setError('')
        }
        try {
            const response = await pluginStoreApi.list({ signal: controller.signal })
            if (!controller.signal.aborted && mountedRef.current) {
                setData(response)
            }
        } catch (err: unknown) {
            if (!isAbortError(err) && mountedRef.current) {
                setError(getErrorMessage(err) || t('plugin_store.load_failed', { defaultValue: '加载插件商店失败' }))
            }
        } finally {
            if (loadAbortRef.current === controller) {
                loadAbortRef.current = null
            }
            if (!controller.signal.aborted && mountedRef.current) {
                setLoading(false)
            }
        }
    }, [t])

    useEffect(() => {
        const id = window.setTimeout(() => {
            void loadStore({ skipLeadingState: true })
        }, 0)
        return () => window.clearTimeout(id)
    }, [loadStore])

    useEffect(() => {
        mountedRef.current = true
        return () => {
            mountedRef.current = false
            loadAbortRef.current?.abort()
            installAbortRef.current?.abort()
            releaseAbortRef.current?.abort()
        }
    }, [])

    const stats = useMemo(() => {
        const plugins   = data?.plugins ?? []
        const installed = plugins.filter((plugin) => plugin.installed).length
        const updates   = plugins.filter((plugin) => plugin.installed && plugin.update_available).length
        return { total: plugins.length, installed, notInstalled: plugins.length - installed, updates }
    }, [data?.plugins])

    const visiblePlugins = useMemo(() => {
        const plugins  = data?.plugins ?? []
        const byStatus = plugins.filter((plugin) => {
            if (statusFilter === 'installed') {
                return plugin.installed
            }
            if (statusFilter === 'notInstalled') {
                return !plugin.installed
            }
            if (statusFilter === 'updates') {
                return plugin.installed && plugin.update_available
            }
            return true
        })
        const query    = filter.trim().toLowerCase()
        if (!query) {
            return byStatus
        }
        return byStatus.filter((plugin) => [
            plugin.id,
            plugin.name,
            plugin.description,
            plugin.author,
            plugin.repository,
            plugin.source_name,
            plugin.source_url,
            plugin.license,
            ...(plugin.tags ?? []),
        ].filter(Boolean).join(' ').toLowerCase().includes(query))
    }, [data?.plugins, filter, statusFilter])

    const statusFilters: Array<{ key: StoreStatusFilter; label: string; count: number }> = [
        { key: 'all', label: t('plugin_store.filter_all', { defaultValue: '全部' }), count: stats.total },
        {
            key: 'installed',
            label: t('plugin_store.filter_installed', { defaultValue: '已安装' }),
            count: stats.installed,
        },
        {
            key: 'notInstalled',
            label: t('plugin_store.filter_not_installed', { defaultValue: '未安装' }),
            count: stats.notInstalled,
        },
        { key: 'updates', label: t('plugin_store.filter_updates', { defaultValue: '可更新' }), count: stats.updates },
    ]

    const loadReleaseVersions = useCallback(async (entry: PluginStoreEntry) => {
        releaseAbortRef.current?.abort()
        setReleaseVersions([])
        setReleaseVersionsError('')
        if (!supportsPluginVersionSelection(entry.install_type) || !getGitHubRepositorySlug(entry.repository)) {
            setReleaseVersionsLoading(false)
            return
        }

        const controller         = new AbortController()
        releaseAbortRef.current = controller
        setReleaseVersionsLoading(true)
        try {
            const versions = await fetchPluginReleaseVersions(entry.id, entry.source_id, { signal: controller.signal })
            if (!controller.signal.aborted && mountedRef.current) {
                setReleaseVersions(versions)
            }
        } catch (err: unknown) {
            if (!isAbortError(err) && mountedRef.current) {
                setReleaseVersionsError(getErrorMessage(err) || t(
                    'plugin_store.release_versions_failed',
                    { defaultValue: '获取 GitHub Releases 失败' },
                ))
            }
        } finally {
            if (releaseAbortRef.current === controller) {
                releaseAbortRef.current = null
            }
            if (!controller.signal.aborted && mountedRef.current) {
                setReleaseVersionsLoading(false)
            }
        }
    }, [t])

    const releaseVersionOptions = useMemo(
        () => releaseVersions.map((release) => ({
            value: release.tagName,
            label: `${release.tagName}${release.name && release.name !== release.tagName ? ` · ${release.name}` : ''}${release.prerelease ? ` · ${t('plugin_store.prerelease')}` : ''}`,
        })),
        [releaseVersions, t],
    )

    const runInstall = useCallback(async (entry: PluginStoreEntry, isUpdate: boolean, requestedVersion = '') => {
        installAbortRef.current?.abort()
        const controller        = new AbortController()
        installAbortRef.current = controller
        const isActive          = () => mountedRef.current && !controller.signal.aborted
        const entryKey          = storeEntryKey(entry)
        const version           = supportsPluginVersionSelection(entry.install_type) ? requestedVersion.trim() : ''
        setInstallingKey(entryKey)
        try {
            const result = await pluginStoreApi.install(entry.id, {
                sourceId: entry.source_id || undefined,
                version: version || undefined,
            }, { signal: controller.signal })
            if (!isActive()) {
                return
            }
            clearConfigCache()
            const installedState = await waitForPluginStoreState(
                entry.id,
                result.source_id || entry.source_id,
                (plugin) => plugin.installed &&
                            plugin.configured &&
                            (!version || pluginVersionMatches(plugin.installed_version, version)),
                undefined,
                undefined,
                controller.signal,
            )
            if (!isActive()) {
                return
            }
            setData(installedState.response)
            if (installedState.timedOut || !installedState.plugin?.installed || !installedState.plugin.configured) {
                showNotification(
                    t('plugin_store.status_pending', { defaultValue: '插件文件已写入，运行状态仍在刷新' }),
                    'warning',
                )
                return
            }
            if (result.restart_required) {
                setRestartRequiredKeys((current) => current.includes(entryKey) ? current : [...current, entryKey])
                showNotification(t(
                    isUpdate ? 'plugin_store.update_success' : 'plugin_store.install_success',
                    { defaultValue: isUpdate ? '插件已更新' : '插件已安装' },
                ), 'success')
                showNotification(t(
                    'plugin_store.restart_required_notice',
                    { defaultValue: '当前插件需要重启服务后生效' },
                ), 'warning')
                return
            }
            if (!installedState.response.plugins_enabled) {
                showNotification(t(
                    isUpdate ? 'plugin_store.update_success' : 'plugin_store.install_success',
                    { defaultValue: isUpdate ? '插件已更新' : '插件已安装' },
                ), 'success')
                showNotification(t(
                    'plugin_store.global_disabled_hint',
                    { defaultValue: '全局插件开关未启用，插件不会生效' },
                ), 'warning')
                return
            }
            if (installedState.plugin.enabled) {
                const registeredState = await waitForPluginStoreState(
                    entry.id,
                    result.source_id || entry.source_id,
                    (plugin) => plugin.registered && plugin.effective_enabled,
                    undefined,
                    undefined,
                    controller.signal,
                )
                if (!isActive()) {
                    return
                }
                setData(registeredState.response)
                if (registeredState.timedOut ||
                    !registeredState.plugin?.registered ||
                    !registeredState.plugin.effective_enabled) {
                    showNotification(t(
                        'plugin_store.registration_pending',
                        { defaultValue: '插件已安装，注册状态仍在刷新' },
                    ), 'warning')
                    return
                }
                notifyPluginResourcesChanged()
            }
            showNotification(t(
                isUpdate ? 'plugin_store.update_success' : 'plugin_store.install_success',
                { defaultValue: isUpdate ? '插件已更新' : '插件已安装' },
            ), 'success')
        } catch (err: unknown) {
            if (isAbortError(err) || !mountedRef.current) {
                return
            }
            if (pluginStoreErrorRestartRequired(err)) {
                setRestartRequiredKeys((current) => current.includes(entryKey) ? current : [...current, entryKey])
                showNotification(t(
                    'plugin_store.restart_required_notice',
                    { defaultValue: '当前插件需要重启服务后生效' },
                ), 'warning')
                return
            }
            showNotification(getErrorMessage(err) ||
                             t(
                                 isUpdate ? 'plugin_store.update_failed' : 'plugin_store.install_failed',
                                 { defaultValue: isUpdate ? '插件更新失败' : '插件安装失败' },
                             ), 'error')
            throw err
        } finally {
            if (installAbortRef.current === controller) {
                installAbortRef.current = null
            }
            if (isActive()) {
                setInstallingKey('')
            }
        }
    }, [clearConfigCache, showNotification, t])

    const openInstallOptions = (entry: PluginStoreEntry) => {
        setInstallEntry(entry)
        setInstallVersion('')
        if (supportsPluginVersionSelection(entry.install_type)) {
            void loadReleaseVersions(entry)
        }
    }

    const closeInstallOptions = () => {
        if (installingKey) {
            return
        }
        releaseAbortRef.current?.abort()
        setInstallEntry(null)
        setInstallVersion('')
        setReleaseVersions([])
        setReleaseVersionsError('')
        setReleaseVersionsLoading(false)
    }

    const confirmInstallOptions = async () => {
        if (!installEntry) {
            return
        }
        const isUpdate = installEntry.installed && installEntry.update_available
        const version  = supportsPluginVersionSelection(installEntry.install_type) ? installVersion.trim() : ''
        if (!isValidManualReleaseTag(version)) {
            showNotification(t(
                'plugin_store.install_version_invalid',
                { defaultValue: '版本号必须以数字或 v 加数字开头，且只能包含字母、数字、点号、加号和连字符' },
            ), 'error')
            return
        }
        if (!isOfficialPlugin(installEntry)) {
            setGateEntry(installEntry)
            setGateIsUpdate(isUpdate)
            setGateRequestedVersion(version)
            setGateStep(1)
            setGateTyped('')
            setInstallEntry(null)
            setInstallVersion('')
            setReleaseVersions([])
            setReleaseVersionsError('')
            return
        }
        try {
            await runInstall(installEntry, isUpdate, version)
            setInstallEntry(null)
            setInstallVersion('')
            setReleaseVersions([])
            setReleaseVersionsError('')
        } catch {
            // runInstall 已提示错误
        }
    }

    const closeGate = () => {
        if (installingKey) {
            return
        }
        setGateEntry(null)
        setGateRequestedVersion('')
        setGateStep(1)
        setGateTyped('')
    }

    const confirmGate = async () => {
        if (!gateEntry) {
            return
        }
        try {
            await runInstall(gateEntry, gateIsUpdate, gateRequestedVersion)
            closeGate()
        } catch {
            // runInstall 已提示错误
        }
    }

    const renderCard = (entry: PluginStoreEntry) => {
        const entryKey       = storeEntryKey(entry)
        const logo           = resolvePluginAssetURL(entry.logo, apiBase)
        const repositoryURL  = buildRepositoryURL(entry.repository)
        const homepageURL    = /^https?:\/\//i.test(entry.homepage ?? '') ? entry.homepage ?? '' : ''
        const isUpdate       = entry.installed && entry.update_available
        const isOfficial     = isOfficialPlugin(entry)
        const isInstalling   = installingKey === entryKey
        const missingAuth    = entry.auth_required && !entry.auth_configured
        const sourceName     = isDefaultPluginStoreSource(entry) ?
                               t('plugin_store.official_source', { defaultValue: '官方源' }) :
                               entry.source_name
        const versionText    = isUpdate && entry.installed_version && entry.version
                               ?
                               `${formatPluginVersion(entry.installed_version)} → ${formatPluginVersion(entry.version)}`
                               :
                               formatPluginVersion(entry.installed_version || entry.version)
        const platformText   = (entry.platforms ?? []).map((item) => `${item.goos}/${item.goarch}`).join(', ')
        const actionDisabled = missingAuth || Boolean(installingKey && !isInstalling)

        return (
            <Card key={entryKey} className={styles.storeCard}>
                <div className={styles.cardTop}>
                    <div className={styles.logoBox}><StoreLogo src={logo} /></div>
                    <div className={styles.cardTitleBlock}>
                        <h2>{storeEntryTitle(entry)}</h2>
                        <span>{entry.id}</span>
                    </div>
                    <div className={styles.badges}>
                        {!isOfficial &&
                         <span className={styles.badgeWarning}>{t(
                             'plugin_store.third_party',
                             { defaultValue: '第三方' },
                         )}</span>}
                        {isUpdate ?
                         <span className={styles.badgeWarning}>{t(
                             'plugin_store.update_available',
                             { defaultValue: '可更新' },
                         )}</span> :
                         null}
                        {entry.installed ?
                         <span className={styles.badgeSuccess}>{t(
                             'plugin_store.installed',
                             { defaultValue: '已安装' },
                         )}</span> :
                         null}
                    </div>
                </div>
                {entry.description && <p className={styles.description}>{entry.description}</p>}
                <div className={styles.metaRow}>
                    {versionText && <span>{versionText}</span>}
                    {sourceName && <span>{sourceName}</span>}
                    {entry.author && <span>{entry.author}</span>}
                    {entry.install_type && <span>{entry.install_type}</span>}
                    {platformText && <span>{platformText}</span>}
                </div>
                {(entry.tags ?? []).length > 0 && (
                    <div className={styles.tagRow}>
                        {(entry.tags ?? []).map((tag) => <span key={`${entryKey}-${tag}`}>{tag}</span>)}
                    </div>
                )}
                <div className={styles.cardFooter}>
                    <div className={styles.cardActions}>
                        {!entry.installed || isUpdate ? (
                            <Button
                                type='button'
                                size='sm'
                                onClick={() => openInstallOptions(entry)}
                                loading={isInstalling}
                                disabled={actionDisabled}
                                title={missingAuth ?
                                       t('plugin_store.auth_required_hint', { defaultValue: '需要先配置插件源认证' }) :
                                       undefined}
                            >
                                {isUpdate ? <IconRefreshCw size={14} /> : <IconDownload size={14} />}
                                {isUpdate ?
                                 t('plugin_store.update', { defaultValue: '更新' }) :
                                 t('plugin_store.install', { defaultValue: '安装' })}
                            </Button>
                        ) : (
                             <Button type='button' variant='secondary' size='sm' onClick={() => navigate('/plugins')}>
                                 <IconSettings size={14} />
                                 {t('plugin_store.manage', { defaultValue: '管理' })}
                             </Button>
                         )}
                    </div>
                    <div className={styles.links}>
                        {repositoryURL &&
                         <a href={repositoryURL} target='_blank' rel='noreferrer'
                            title={t('plugin_store.open_repository', { defaultValue: '打开仓库' })}><IconGithub
                             size={14} /></a>}
                        {homepageURL &&
                         <a href={homepageURL} target='_blank' rel='noreferrer'
                            title={t('plugin_store.open_homepage', { defaultValue: '打开主页' })}><IconExternalLink
                             size={14} /></a>}
                    </div>
                </div>
            </Card>
        )
    }

    const gateToken                    = gateEntry ? getPluginConfirmToken(gateEntry) : ''
    const installIsUpdate              = Boolean(installEntry?.installed && installEntry.update_available)
    const installSupportsVersion       = Boolean(installEntry &&
                                                  supportsPluginVersionSelection(installEntry.install_type))
    const installReleasesURL           = installSupportsVersion ?
                                         buildGitHubReleasesPageURL(installEntry?.repository) :
                                         ''
    const selectedReleaseVersion       = releaseVersionOptions.some((option) => option.value === installVersion.trim()) ?
                                         installVersion.trim() :
                                         ''
    const installVersionError          = installSupportsVersion &&
                                         installVersion.trim() &&
                                         !isValidManualReleaseTag(installVersion) ?
                                         t(
                                             'plugin_store.install_version_invalid',
                                             { defaultValue: '版本号必须以数字或 v 加数字开头，且只能包含字母、数字、点号、加号和连字符' },
                                         ) :
                                         ''

    return (
        <div className={styles.page}>
            <div className={styles.header}>
                <div>
                    <h1>{t('plugin_store.title', { defaultValue: '插件商店' })}</h1>
                    <p>{t('plugin_store.description', { defaultValue: '从插件源安装、更新和管理 CPA 动态插件' })}</p>
                </div>
                <Button type='button' variant='secondary' onClick={() => void loadStore()} loading={loading}>
                    <IconRefreshCw size={16} />
                    {t('common.refresh')}
                </Button>
            </div>

            <div className={styles.securityBanner}>
                <IconShield size={20} />
                <div>
                    <strong>{t(
                        'plugin_store.security_banner_title',
                        { defaultValue: '插件会在 CPA 进程内执行代码' },
                    )}</strong>
                    <p>{t(
                        'plugin_store.security_banner_text',
                        { defaultValue: '只安装可信来源插件；第三方插件需要额外确认来源和仓库' },
                    )}</p>
                </div>
            </div>

            {error && <div className='error-box'>{error}</div>}
            {(data?.source_errors ?? []).length > 0 && (
                <div className={styles.warningBox}>
                    <strong>{t('plugin_store.source_errors_title', { defaultValue: '部分插件源拉取失败' })}</strong>
                    {(data?.source_errors ?? []).map((sourceError, index) => (
                        <div key={`${sourceError.source_id}-${index}`}>{sourceError.source_name ||
                                                                        sourceError.source_url}: {sourceError.message}</div>
                    ))}
                </div>
            )}
            {restartRequiredKeys.length > 0 && (
                <div className={styles.warningBox}>{t(
                    'plugin_store.restart_required_notice',
                    { defaultValue: '部分插件需要重启服务后生效' },
                )}</div>
            )}

            <div className={styles.statsGrid}>
                <Card className={styles.statCard}><strong>{stats.total}</strong><span>{t(
                    'plugin_store.stat_available',
                    { defaultValue: '可用插件' },
                )}</span></Card>
                <Card className={styles.statCard}><strong>{stats.installed}</strong><span>{t(
                    'plugin_store.filter_installed',
                    { defaultValue: '已安装' },
                )}</span></Card>
                <Card className={styles.statCard}><strong>{stats.updates}</strong><span>{t(
                    'plugin_store.filter_updates',
                    { defaultValue: '可更新' },
                )}</span></Card>
                <Card className={styles.statCard}><strong>{data?.plugins_dir || 'plugins'}</strong><span>{t(
                    'plugin_store.plugins_dir',
                    { defaultValue: '插件目录' },
                )}</span></Card>
            </div>

            <div className={styles.toolbar}>
                <Input
                    type='search'
                    value={filter}
                    onChange={(event) => setFilter(event.target.value)}
                    placeholder={t(
                        'plugin_store.search_placeholder',
                        { defaultValue: '搜索插件名称、ID、作者、标签或来源' },
                    )}
                    rightElement={<IconSearch size={16} />}
                />
                <div className={styles.filterChips}>
                    {statusFilters.map((item) => (
                        <button
                            key={item.key}
                            type='button'
                            className={`${styles.filterChip} ${statusFilter === item.key ?
                                                               styles.filterChipActive :
                                                               ''}`}
                            onClick={() => setStatusFilter(item.key)}
                        >
                            {item.label}<span>{item.count}</span>
                        </button>
                    ))}
                </div>
            </div>

            {loading ? (
                <Card>
                    <div className={styles.loadingState}>{t('common.loading')}</div>
                </Card>
            ) : visiblePlugins.length === 0 ? (
                <EmptyState
                    title={t('plugin_store.no_plugins', { defaultValue: '没有匹配的插件' })}
                    description={t('plugin_store.no_plugins_desc', { defaultValue: '调整筛选条件，或检查插件源配置' })}
                    action={<Button type='button' variant='secondary' size='sm' onClick={() => void loadStore()}>{t(
                        'common.refresh')}</Button>}
                />
            ) : (
                    <div className={styles.cardGrid}>{visiblePlugins.map(renderCard)}</div>
                )}

            <Modal
                open={installEntry !== null}
                onClose={closeInstallOptions}
                closeDisabled={Boolean(installingKey)}
                title={installEntry ?
                       t(
                           installIsUpdate ? 'plugin_store.update_confirm_title' : 'plugin_store.install_confirm_title',
                           { defaultValue: installIsUpdate ? '更新插件' : '安装插件' },
                       ) :
                       undefined}
                footer={(
                    <div className={styles.modalActions}>
                        <Button type='button' variant='ghost' onClick={closeInstallOptions}
                                disabled={Boolean(installingKey)}>{t('common.cancel')}</Button>
                        <Button type='button' onClick={() => void confirmInstallOptions()}
                                loading={Boolean(installingKey)} disabled={Boolean(installVersionError)}>
                            {installIsUpdate ?
                             t('plugin_store.update', { defaultValue: '更新' }) :
                             t('plugin_store.install', { defaultValue: '安装' })}
                        </Button>
                    </div>
                )}
            >
                {installEntry && (
                    <div className={styles.installForm}>
                        <p>{t(
                            'plugin_store.install_confirm_message',
                            { defaultValue: '确认安装或更新此插件' },
                        )}: {storeEntryTitle(installEntry)}</p>
                        {installSupportsVersion && (
                            <>
                                {installReleasesURL && (
                                    <div className={styles.releasePicker}>
                                        <div className={styles.releasePickerHeader}>
                                            <span>{t(
                                                'plugin_store.release_versions_label',
                                                { defaultValue: 'GitHub Release 版本' },
                                            )}</span>
                                            <button
                                                type='button'
                                                className={styles.linkButton}
                                                onClick={() => void loadReleaseVersions(installEntry)}
                                                disabled={releaseVersionsLoading || Boolean(installingKey)}
                                            >
                                                {releaseVersionsLoading ?
                                                 t('common.loading') :
                                                 t('plugin_store.release_versions_reload', { defaultValue: '重新获取' })}
                                            </button>
                                        </div>
                                        {releaseVersionOptions.length > 0 ? (
                                            <Select
                                                value={selectedReleaseVersion}
                                                options={releaseVersionOptions}
                                                onChange={setInstallVersion}
                                                placeholder={t(
                                                    'plugin_store.release_versions_placeholder',
                                                    { defaultValue: '选择 GitHub Release tag' },
                                                )}
                                                disabled={releaseVersionsLoading || Boolean(installingKey)}
                                            />
                                        ) : (
                                              <p>{releaseVersionsLoading ?
                                                 t(
                                                     'plugin_store.release_versions_loading',
                                                     { defaultValue: '正在获取 GitHub Releases...' },
                                                 ) :
                                                 t(
                                                     'plugin_store.release_versions_empty',
                                                     { defaultValue: '未获取到 GitHub Release，可手动输入版本' },
                                                 )}</p>
                                          )}
                                        {releaseVersionsError && <div className='error-box'>{releaseVersionsError}</div>}
                                        <a href={installReleasesURL} target='_blank' rel='noreferrer'>
                                            {t('plugin_store.open_releases', { defaultValue: '打开 GitHub Releases' })}
                                        </a>
                                    </div>
                                )}
                                <Input
                                    label={t('plugin_store.install_version_label', { defaultValue: '指定版本' })}
                                    value={installVersion}
                                    onChange={(event) => setInstallVersion(event.target.value)}
                                    placeholder={installEntry.version ?
                                                 formatPluginVersion(installEntry.version) :
                                                 t('plugin_store.install_version_latest', { defaultValue: '最新版本' })}
                                    hint={t(
                                        'plugin_store.install_version_hint',
                                        { defaultValue: '留空安装插件源提供的默认版本；也可以手动输入 GitHub release tag' },
                                    )}
                                    error={installVersionError}
                                    spellCheck={false}
                                />
                            </>
                        )}
                    </div>
                )}
            </Modal>

            <Modal
                open={gateEntry !== null}
                onClose={closeGate}
                closeDisabled={Boolean(installingKey)}
                title={gateEntry ? t('plugin_store.gate_title', { defaultValue: '第三方插件确认' }) : undefined}
                footer={(
                    <div className={styles.modalActions}>
                        <Button type='button' variant='ghost' onClick={closeGate} disabled={Boolean(installingKey)}>{t(
                            'common.cancel')}</Button>
                        {gateStep < 3 ? (
                            <Button type='button' variant='secondary'
                                    onClick={() => setGateStep((step) => step + 1)}>{t(
                                'common.next',
                                { defaultValue: '下一步' },
                            )}</Button>
                        ) : (
                             <Button type='button' variant='danger' onClick={() => void confirmGate()}
                                     disabled={gateTyped.trim() !== gateToken} loading={Boolean(installingKey)}>
                                 {gateIsUpdate ?
                                  t('plugin_store.update', { defaultValue: '更新' }) :
                                  t('plugin_store.install', { defaultValue: '安装' })}
                             </Button>
                         )}
                    </div>
                )}
            >
                {gateEntry && (
                    <div className={styles.gateBody}>
                        <strong>{storeEntryTitle(gateEntry)}</strong>
                        {gateStep ===
                         1 &&
                         <p>{t(
                             'plugin_store.gate_step1_text',
                             { defaultValue: '这是第三方插件，插件代码不属于官方来源' },
                         )}</p>}
                        {gateStep ===
                         2 &&
                         <p>{t(
                             'plugin_store.gate_step2_text',
                             { defaultValue: '安装后插件会在 CPA 进程内加载，具备访问请求和配置的能力' },
                         )}</p>}
                        {gateStep === 3 && (
                            <Input
                                label={t(
                                    'plugin_store.gate_step3_prompt',
                                    { token: gateToken, defaultValue: `输入 ${gateToken} 确认安装` },
                                )}
                                value={gateTyped}
                                onChange={(event) => setGateTyped(event.target.value)}
                                spellCheck={false}
                            />
                        )}
                    </div>
                )}
            </Modal>
        </div>
    )
}
