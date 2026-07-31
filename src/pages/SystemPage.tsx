import iconClaude from '@/assets/icons/claude.svg'
import iconDeepseek from '@/assets/icons/deepseek.svg'
import iconGemini from '@/assets/icons/gemini.svg'
import iconGlm from '@/assets/icons/glm.svg'
import iconGrokDark from '@/assets/icons/grok-dark.svg'
import iconGrok from '@/assets/icons/grok.svg'
import iconKimiDark from '@/assets/icons/kimi-dark.svg'
import iconKimiLight from '@/assets/icons/kimi-light.svg'
import iconMinimax from '@/assets/icons/minimax.svg'
import iconOpenaiDark from '@/assets/icons/openai-dark.svg'
import iconOpenaiLight from '@/assets/icons/openai-light.svg'
import iconQwen from '@/assets/icons/qwen.svg'
import {INLINE_LOGO_JPEG} from '@/assets/logoInline'
import {usePageTransitionLayer} from '@/components/common/PageTransitionLayer'
import {VersionHistoryModal} from '@/components/system/VersionHistoryModal'
import {Button} from '@/components/ui/Button'
import {Card} from '@/components/ui/Card'
import {IconBookOpen, IconCode, IconExternalLink, IconGithub} from '@/components/ui/icons'
import {Select} from '@/components/ui/Select'
import {useApiKeysResolver} from '@/hooks/useApiKeysResolver'
import {versionApi} from '@/services/api'
import {modelCatalogApi, type ModelCatalogMeta} from '@/services/api/modelCatalog'
import {type BannedIPEntry, rateLimitsApi, type RateLimitUnbanHistoryEntry} from '@/services/api/rateLimits'
import {type Release, releasesApi} from '@/services/api/releases'
import {useAuthStore, useConfigStore, useModelsStore, useNotificationStore, useThemeStore} from '@/stores'
import {STORAGE_KEY_AUTH} from '@/utils/constants'
import {formatDateTime} from '@/utils/format'
import {classifyModels, getLocalizedOtherLabel} from '@/utils/models'
import {safeExternalUrl} from '@/utils/validation'
import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {Link} from 'react-router-dom'
import styles from './SystemPage.module.scss'

const MODEL_CATEGORY_ICONS: Record<string, string | { light: string; dark: string }> = {
    gpt: { light: iconOpenaiLight, dark: iconOpenaiDark },
    claude: iconClaude,
    gemini: iconGemini,
    qwen: iconQwen,
    kimi: { light: iconKimiLight, dark: iconKimiDark },
    glm: iconGlm,
    grok: { light: iconGrok, dark: iconGrokDark },
    deepseek: iconDeepseek,
    minimax: iconMinimax,
}

const DEFAULT_UPDATE_CHECK_INTERVAL_MINUTES = 180
const MIN_UPDATE_CHECK_INTERVAL_MINUTES     = 30

type VersionCheckTarget = 'panel' | 'cpa'

const parseVersionSegments = (version?: string | null) => {
    if (!version) {
        return null
    }
    const cleaned = version.trim().replace(/^v/i, '')
    if (!cleaned) {
        return null
    }
    const parts = cleaned
        .split(/[^0-9]+/)
        .filter(Boolean)
        .map((segment) => Number.parseInt(segment, 10))
        .filter(Number.isFinite)
    return parts.length ? parts : null
}

const compareVersions = (latest?: string | null, current?: string | null) => {
    const latestParts  = parseVersionSegments(latest)
    const currentParts = parseVersionSegments(current)
    if (!latestParts || !currentParts) {
        return null
    }
    const length = Math.max(latestParts.length, currentParts.length)
    for (let i = 0; i < length; i++) {
        const l = latestParts[i] || 0
        const c = currentParts[i] || 0
        if (l > c) {
            return 1
        }
        if (l < c) {
            return -1
        }
    }
    return 0
}

export function SystemPage() {
    const { t, i18n }                            = useTranslation()
    const { showNotification, showConfirmation } = useNotificationStore()
    const addPersistentNotification              = useNotificationStore((s) => s.addPersistentNotification)
    const resolvedTheme                          = useThemeStore((state) => state.resolvedTheme)
    const transitionLayer                        = usePageTransitionLayer()
    const pageLayerStatus                        = transitionLayer?.status ?? 'current'
    const auth                                   = useAuthStore()
    const config                                 = useConfigStore((state) => state.config)
    const fetchConfig                            = useConfigStore((state) => state.fetchConfig)

    const models               = useModelsStore((state) => state.models)
    const modelsLoading        = useModelsStore((state) => state.loading)
    const modelsError          = useModelsStore((state) => state.error)
    const fetchModelsFromStore = useModelsStore((state) => state.fetchModels)
    const modelsCache          = useModelsStore((state) => state.cache)
    const { resolve: resolveApiKeysForModels, clearCache: clearApiKeysCache } = useApiKeysResolver()

    const [modelStatus, setModelStatus]                   = useState<{
        type: 'success' | 'warning' | 'error' | 'muted'
        message: string
    }>()
    const [modelRequestLoading, setModelRequestLoading]   = useState(false)
    const [checkingVersion, setCheckingVersion]           = useState(false)
    const [versionHistoryTarget, setVersionHistoryTarget] = useState<'panel' | 'cpa' | null>(null)
    const [latestPanelVersion, setLatestPanelVersion]     = useState<string | null>(null)
    const [latestPanelBuildTime, setLatestPanelBuildTime] = useState<string | null>(null)
    const [latestCpaVersion, setLatestCpaVersion]         = useState<string | null>(null)
    const [latestCpaBuildTime, setLatestCpaBuildTime]     = useState<string | null>(null)
    const [lastCheckTime, setLastCheckTime]               = useState<number | null>(null)
    const [catalogMeta, setCatalogMeta]                   = useState<ModelCatalogMeta | null>(null)
    const [catalogMetaError, setCatalogMetaError]         = useState<string | null>(null)
    const [catalogRefreshing, setCatalogRefreshing]       = useState(false)
    const [bannedIPs, setBannedIPs]                       = useState<BannedIPEntry[]>([])
    const [unbanHistory, setUnbanHistory]                 = useState<RateLimitUnbanHistoryEntry[]>([])
    const [rateLimitLoading, setRateLimitLoading]         = useState(false)
    const [unbanning, setUnbanning]                       = useState<string | null>(null)

    const modelsRequestGeneration    = useRef(0)
    const versionCheckInFlight       = useRef<Promise<void> | null>(null)
    const notifiedRateLimitEventKeys = useRef<Set<string>>(new Set())
    const invalidateModelsRequest    = useCallback(() => {
        ++modelsRequestGeneration.current
    }, [])

    const otherLabel     = useMemo(() => getLocalizedOtherLabel(t), [t])
    const groupedModels  = useMemo(() => classifyModels(models, { otherLabel, t }), [models, otherLabel, t])
    const catalogSources = useMemo(() => {
        if (!catalogMeta || catalogMeta.source === 'embed') {
            return []
        }
        return Array.from(new Set([catalogMeta.source, ...catalogMeta.sources].filter((source) => source.trim())))
    }, [catalogMeta])

    const renderCatalogSources = (sources: string[]) => {
        if (sources.length === 0) {
            return '-'
        }
        return sources.map((source, index) => {
            const sourceURL = safeExternalUrl(source)
            return (
                <span key={source}>
                    {index > 0 && ', '}
                    {sourceURL ? (
                        <a href={sourceURL} target='_blank' rel='noopener noreferrer'
                           className={styles.inlineSourceLink}>
                            {source}
                        </a>
                    ) : source}
                </span>
            )
        })
    }

    const appVersion           = __APP_VERSION__ || t('system_info.version_unknown')
    const apiVersion           = auth.serverVersion || t('system_info.version_unknown')
    const requiredPanelVersion = auth.serverMinPanelVersion || '-'
    const panelBuildTime       =
              typeof __BUILD_TIME__ === 'string' && __BUILD_TIME__ ? formatDateTime(__BUILD_TIME__, i18n.language) : '-'
    const serverBuildTime      = auth.serverBuildDate ? formatDateTime(auth.serverBuildDate, i18n.language) : '-'
    const panelReleaseStatus   =
              compareVersions(latestPanelVersion, appVersion) === 0
              ? t('system_info.latest_remote_current', { defaultValue: '已是线上最新' })
              : (latestPanelVersion ?? '-')
    const cpaReleaseStatus     =
              compareVersions(latestCpaVersion, apiVersion) === 0
              ? t('system_info.latest_remote_current', { defaultValue: '已是线上最新' })
              : (latestCpaVersion ?? '-')

    const remoteManagement         = config?.remoteManagement
    const remoteManagementLoaded   = config !== null
    const panelRepository          =
              remoteManagement?.panelGithubRepository || 'https://github.com/Pyrokine/Cli-Proxy-API-Management-Center'
    const cpaRepository            = remoteManagement?.cpaGithubRepository || 'https://github.com/Pyrokine/CLIProxyAPI'
    const autoCheckUpdateEnabled   = !remoteManagementLoaded ? null : (remoteManagement?.autoCheckUpdate ?? false)
    const autoUpdatePanelEnabled   = !remoteManagementLoaded ? null : (remoteManagement?.autoUpdatePanel ?? true)
    const autoUpdateCPAEnabled     = !remoteManagementLoaded ? null : (remoteManagement?.autoUpdateCPA ?? false)
    const autoCheckIntervalMinutes = !remoteManagementLoaded
                                     ? null
                                     : typeof remoteManagement?.checkInterval === 'number' &&
                                       remoteManagement.checkInterval >= MIN_UPDATE_CHECK_INTERVAL_MINUTES
                                       ? remoteManagement.checkInterval
                                       : DEFAULT_UPDATE_CHECK_INTERVAL_MINUTES
    const autoCheckIntervalLabel   =
              autoCheckIntervalMinutes === null
              ? t('common.not_set')
              : t('system_info.check_interval_minutes', { count: autoCheckIntervalMinutes })
    const getIconForCategory       = (categoryId: string): string | null => {
        const iconEntry = MODEL_CATEGORY_ICONS[categoryId]
        if (!iconEntry) {
            return null
        }
        if (typeof iconEntry === 'string') {
            return iconEntry
        }
        return resolvedTheme === 'dark' ? iconEntry.dark : iconEntry.light
    }

    const fetchModels = async ({ forceRefresh = false }: { forceRefresh?: boolean } = {}) => {
        const requestGeneration = ++modelsRequestGeneration.current
        if (pageLayerStatus !== 'current') {
            return
        }
        if (auth.connectionStatus !== 'connected') {
            setModelRequestLoading(false)
            setModelStatus({
                               type: 'warning',
                               message: t('notification.connection_required'),
                           })
            return
        }

        if (!auth.apiBase) {
            setModelRequestLoading(false)
            showNotification(t('notification.connection_required'), 'warning')
            return
        }

        if (forceRefresh) {
            clearApiKeysCache()
        }

        setModelRequestLoading(true)
        setModelStatus({ type: 'muted', message: t('system_info.models_loading') })
        try {
            const apiKeys = await resolveApiKeysForModels()
            if (requestGeneration !== modelsRequestGeneration.current) {
                return
            }
            const primaryKey = apiKeys[0]
            const list       = await fetchModelsFromStore(auth.apiBase, primaryKey, forceRefresh)
            if (requestGeneration !== modelsRequestGeneration.current) {
                return
            }
            const hasModels = list.length > 0
            setModelStatus({
                               type: hasModels ? 'success' : 'warning',
                               message: hasModels
                                        ? t('system_info.models_count', { count: list.length })
                                        : t('system_info.models_empty'),
                           })
            if (forceRefresh && hasModels) {
                addPersistentNotification(
                    t('system_info.models_count', { count: list.length }),
                    'success',
                    'model-update',
                )
            }
        } catch (err: unknown) {
            if (requestGeneration !== modelsRequestGeneration.current) {
                return
            }
            const message = err instanceof Error ? err.message : typeof err === 'string' ? err : ''
            const suffix  = message ? `: ${message}` : ''
            const text    = `${t('system_info.models_error')}${suffix}`
            setModelStatus({ type: 'error', message: text })
            if (forceRefresh) {
                addPersistentNotification(text, 'error', 'model-update')
            }
        } finally {
            if (requestGeneration === modelsRequestGeneration.current) {
                setModelRequestLoading(false)
            }
        }
    }

    const fetchRateLimitStatus = useCallback(async () => {
        setRateLimitLoading(true)
        try {
            const data         = await rateLimitsApi.getStatus()
            const nextBanned   = data.banned_ips ?? []
            const nextUnbanned = data.unban_history ?? []
            nextBanned
                .map((entry) => ({ entry, key: `security:ip-banned:${entry.ip}:${entry.banned_until}` }))
                .filter(({ key }) => !notifiedRateLimitEventKeys.current.has(key))
                .slice(0, 5)
                .forEach(({ entry, key }) => {
                    notifiedRateLimitEventKeys.current.add(key)
                    addPersistentNotification(
                        t('notifications.security_ip_banned_notice', {
                            ip: entry.ip,
                            count: entry.ban_count,
                            defaultValue: '管理登录来源 {{ip}} 已被临时限制，累计 {{count}} 次触发限制',
                        }),
                        'warning',
                        'security',
                        { dedupeKey: key },
                    )
                })
            nextUnbanned
                .map((entry) => ({ entry, key: `security:ip-unbanned:${entry.ip}:${entry.unbanned_at}` }))
                .filter(({ key }) => !notifiedRateLimitEventKeys.current.has(key))
                .slice(0, 5)
                .forEach(({ entry, key }) => {
                    notifiedRateLimitEventKeys.current.add(key)
                    addPersistentNotification(
                        t('notifications.security_ip_unbanned_notice', {
                            ip: entry.ip,
                            defaultValue: '管理登录来源 {{ip}} 已解除限制',
                        }),
                        'info',
                        'security',
                        { dedupeKey: key },
                    )
                })
            setBannedIPs(nextBanned)
            setUnbanHistory(nextUnbanned)
        } catch {
            showNotification(t('system_info.rate_limit_refresh_failed'), 'error')
        } finally {
            setRateLimitLoading(false)
        }
    }, [addPersistentNotification, showNotification, t])

    const handleUnban = useCallback(
        (ip: string) => {
            showConfirmation({
                                 title: t('system_info.rate_limit_unban'),
                                 message: t('system_info.rate_limit_unban_confirm'),
                                 confirmText: t('common.confirm'),
                                 onConfirm: async () => {
                                     setUnbanning(ip)
                                     try {
                                         await rateLimitsApi.unban(ip)
                                         showNotification(t('system_info.rate_limit_unban_success', { ip }), 'success')
                                         void fetchRateLimitStatus()
                                     } catch {
                                         showNotification(t('system_info.rate_limit_unban_failed'), 'error')
                                     } finally {
                                         setUnbanning(null)
                                     }
                                 },
                             })
        },
        [showConfirmation, showNotification, fetchRateLimitStatus, t],
    )

    const handleClearLoginStorage = () => {
        showConfirmation({
                             title: t('system_info.clear_login_title', { defaultValue: 'Clear Login Storage' }),
                             message: t('system_info.clear_login_confirm'),
                             variant: 'danger',
                             confirmText: t('common.confirm'),
                             onConfirm: () => {
                                 auth.logout()
                                 if (typeof localStorage === 'undefined') {
                                     return
                                 }
                                 const keysToRemove = [
                                     STORAGE_KEY_AUTH,
                                     'isLoggedIn',
                                     'apiBase',
                                     'apiUrl',
                                     'managementKey',
                                 ]
                                 keysToRemove.forEach((key) => localStorage.removeItem(key))
                                 showNotification(t('notification.login_storage_cleared'), 'success')
                             },
                         })
    }

    const handleVersionCheck = useCallback(
        ({ silent = false, target = 'cpa' }: { silent?: boolean; target?: VersionCheckTarget } = {}) => {
            if (versionCheckInFlight.current) {
                return versionCheckInFlight.current
            }

            const request = (async () => {
                setCheckingVersion(true)
                try {
                    const [cpaLatest, panelReleases] = await Promise.all([
                                                                             versionApi.checkLatest(),
                                                                             releasesApi.list(1, 1, 'panel', true),
                                                                         ])

                    const latestCpaRaw          =
                              cpaLatest?.['latest-version'] ?? cpaLatest?.latest_version ?? cpaLatest?.latest ?? ''
                    const latestCpa             = typeof latestCpaRaw === 'string' ?
                                                  latestCpaRaw :
                                                  String(latestCpaRaw ?? '')
                    const latestCpaPublishedRaw = cpaLatest?.['published-at'] ?? cpaLatest?.published_at ?? ''
                    const latestCpaPublished    = typeof latestCpaPublishedRaw === 'string' ? latestCpaPublishedRaw : ''
                    const latestPanelRelease    =
                              (panelReleases.releases ?? []).find((release: Release) => !release.draft) ?? null
                    const latestPanel           = latestPanelRelease?.tag_name || ''

                    setLastCheckTime(Date.now())
                    setLatestCpaVersion(latestCpa || null)
                    setLatestCpaBuildTime(latestCpaPublished || null)
                    setLatestPanelVersion(latestPanel || null)
                    setLatestPanelBuildTime(latestPanelRelease?.published_at || null)

                    if (silent) {
                        return
                    }

                    const latestVersion  = target === 'panel' ? latestPanel : latestCpa
                    const currentVersion = target === 'panel' ? appVersion : auth.serverVersion
                    if (!latestVersion) {
                        showNotification(t('system_info.version_check_error'), 'error')
                        return
                    }

                    const comparison = compareVersions(latestVersion, currentVersion)
                    if (comparison === null) {
                        showNotification(t('system_info.version_current_missing'), 'warning')
                        return
                    }

                    if (comparison > 0) {
                        const message = t('system_info.version_update_available', { version: latestVersion })
                        showNotification(message, 'warning')
                        addPersistentNotification(message, 'warning', 'version')
                    } else {
                        showNotification(t('system_info.version_is_latest'), 'success')
                    }
                } catch (error: unknown) {
                    setLastCheckTime(Date.now())
                    const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
                    const suffix  = message ? `: ${message}` : ''
                    if (!silent) {
                        showNotification(`${t('system_info.version_check_error')}${suffix}`, 'error')
                    }
                } finally {
                    setCheckingVersion(false)
                    versionCheckInFlight.current = null
                }
            })()

            versionCheckInFlight.current = request
            return request
        },
        [appVersion, auth.serverVersion, showNotification, addPersistentNotification, t],
    )

    const fetchCatalogMeta = useCallback(async () => {
        try {
            const meta = await modelCatalogApi.getMeta()
            setCatalogMeta(meta)
            setCatalogMetaError(null)
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error ?? '')
            setCatalogMetaError(message || 'failed')
        }
    }, [])

    const handleCatalogRefresh = useCallback(async () => {
        setCatalogRefreshing(true)
        try {
            const meta = await modelCatalogApi.refresh()
            setCatalogMeta(meta)
            setCatalogMetaError(null)
            showNotification(t('system_info.catalog_refresh_success'), 'success')
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error ?? '')
            const suffix  = message ? `: ${message}` : ''
            setCatalogMetaError(message || 'failed')
            showNotification(`${t('system_info.catalog_refresh_failed')}${suffix}`, 'error')
            await fetchCatalogMeta()
        } finally {
            setCatalogRefreshing(false)
        }
    }, [fetchCatalogMeta, showNotification, t])

    useEffect(() => {
        if (pageLayerStatus !== 'current') {
            invalidateModelsRequest()
        }
        return invalidateModelsRequest
    }, [invalidateModelsRequest, pageLayerStatus])

    useEffect(() => {
        fetchConfig().catch(() => {
            // ignore
        })
    }, [fetchConfig])

    useEffect(() => {
        let cancelled = false
        queueMicrotask(() => {
            if (!cancelled && pageLayerStatus === 'current') {
                void fetchModels()
            }
        })
        return () => {
            cancelled = true
            invalidateModelsRequest()
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [auth.connectionStatus, auth.apiBase, config?.apiKeys, pageLayerStatus])

    useEffect(() => {
        if (auth.connectionStatus !== 'connected') {
            return
        }
        queueMicrotask(() => {
            void fetchCatalogMeta()
        })
    }, [auth.connectionStatus, fetchCatalogMeta])

    useEffect(() => {
        if (auth.connectionStatus !== 'connected') {
            return
        }
        queueMicrotask(() => {
            void fetchRateLimitStatus()
        })
    }, [auth.connectionStatus, fetchRateLimitStatus])

    useEffect(() => {
        void handleVersionCheck({ silent: true })
    }, [handleVersionCheck])

    return (
        <div className={styles.container}>
            <h1 className={styles.pageTitle}>{t('system_info.title')}</h1>
            <div className={styles.content}>
                <Card className={styles.aboutCard}>
                    <div className={styles.aboutHeader}>
                        <img src={INLINE_LOGO_JPEG} alt='CPAMC' className={styles.aboutLogo} />
                        <div className={styles.aboutTitle}>{t('system_info.about_title')}</div>
                    </div>

                    <div className={styles.aboutInfoGrid}>
                        <div className={styles.infoTile}>
                            <div className={styles.tileHeader}>
                                <div className={styles.tileLabel}>{t('footer.version')}</div>
                                <div className={styles.tileActions}>
                                    <Button
                                        type='button'
                                        variant='secondary'
                                        size='sm'
                                        className={styles.tileAction}
                                        onClick={() => void handleVersionCheck({ target: 'panel' })}
                                        loading={checkingVersion}
                                        title={t('system_info.version_check_button')}
                                        aria-label={t('system_info.version_check_button')}
                                    >
                                        {t('system_info.version_check_button')}
                                    </Button>
                                    <Button
                                        type='button'
                                        variant='secondary'
                                        size='sm'
                                        className={styles.tileAction}
                                        onClick={() => setVersionHistoryTarget('panel')}
                                        title={t('system_info.version_history_button', {
                                            defaultValue: 'Version History',
                                        })}
                                        aria-label={t('system_info.version_history_button', {
                                            defaultValue: 'Version History',
                                        })}
                                    >
                                        {t('system_info.version_history_button', { defaultValue: 'Version History' })}
                                    </Button>
                                </div>
                            </div>
                            <div className={styles.tileValue}>{appVersion}</div>
                            <div className={styles.versionMeta}>
                                <div className={styles.metaRow}>
                                    <span className={styles.metaLabel}>{t('system_info.build_time')}</span>
                                    <span className={styles.metaValue}>{panelBuildTime}</span>
                                </div>
                                <div className={styles.metaRow}>
                                    <span className={styles.metaLabel}>{t('system_info.latest_remote')}</span>
                                    <span className={styles.metaValue}>{panelReleaseStatus}</span>
                                </div>
                                <div className={styles.metaRow}>
                                    <span className={styles.metaLabel}>{t('system_info.latest_remote_build')}</span>
                                    <span className={styles.metaValue}>
                                        {latestPanelBuildTime
                                         ? formatDateTime(new Date(latestPanelBuildTime), i18n.language)
                                         : '-'}
                                    </span>
                                </div>
                                <div className={styles.metaRow}>
                                    <span className={styles.metaLabel}>{t('system_info.last_checked')}</span>
                                    <span className={styles.metaValue}>
                                        {lastCheckTime ? formatDateTime(new Date(lastCheckTime), i18n.language) : '-'}
                                    </span>
                                </div>
                            </div>
                        </div>

                        <div className={styles.infoTile}>
                            <div className={styles.tileHeader}>
                                <div className={styles.tileLabel}>{t('footer.api_version')}</div>
                                <div className={styles.tileActions}>
                                    <Button
                                        type='button'
                                        variant='secondary'
                                        size='sm'
                                        className={styles.tileAction}
                                        onClick={() => void handleVersionCheck({ target: 'cpa' })}
                                        loading={checkingVersion}
                                        title={t('system_info.version_check_button')}
                                        aria-label={t('system_info.version_check_button')}
                                    >
                                        {t('system_info.version_check_button')}
                                    </Button>
                                    <Button
                                        type='button'
                                        variant='secondary'
                                        size='sm'
                                        className={styles.tileAction}
                                        onClick={() => setVersionHistoryTarget('cpa')}
                                        title={t('system_info.version_history_button', {
                                            defaultValue: 'Version History',
                                        })}
                                        aria-label={t('system_info.version_history_button', {
                                            defaultValue: 'Version History',
                                        })}
                                    >
                                        {t('system_info.version_history_button', { defaultValue: 'Version History' })}
                                    </Button>
                                </div>
                            </div>
                            <div className={styles.tileValue}>{apiVersion}</div>
                            <div className={styles.versionMeta}>
                                <div className={styles.metaRow}>
                                    <span className={styles.metaLabel}>{t('system_info.build_time')}</span>
                                    <span className={styles.metaValue}>{serverBuildTime}</span>
                                </div>
                                <div className={styles.metaRow}>
                                    <span className={styles.metaLabel}>{t('system_info.latest_remote')}</span>
                                    <span className={styles.metaValue}>{cpaReleaseStatus}</span>
                                </div>
                                <div className={styles.metaRow}>
                                    <span className={styles.metaLabel}>{t('system_info.latest_remote_build')}</span>
                                    <span className={styles.metaValue}>
                                        {latestCpaBuildTime
                                         ? formatDateTime(new Date(latestCpaBuildTime), i18n.language)
                                         : '-'}
                                    </span>
                                </div>
                                <div className={styles.metaRow}>
                                    <span className={styles.metaLabel}>{t('system_info.last_checked')}</span>
                                    <span className={styles.metaValue}>
                                        {lastCheckTime ? formatDateTime(new Date(lastCheckTime), i18n.language) : '-'}
                                    </span>
                                </div>
                            </div>
                            <div className={styles.versionMetaFooter}>
                                <div className={styles.metaRow}>
                                    <span className={styles.metaLabel}>{t('system_info.required_panel_version')}</span>
                                    <span className={styles.metaValue}>{requiredPanelVersion}</span>
                                </div>
                            </div>
                        </div>

                        <div className={styles.infoTile}>
                            <div className={styles.tileLabel}>{t('connection.status')}</div>
                            <div className={styles.tileValue}>{t(`common.${auth.connectionStatus}_status`)}</div>
                            <div className={styles.tileSub}>{auth.apiBase || '-'}</div>
                        </div>
                    </div>

                    <div className={styles.autoUpdateSection}>
                        <div className={styles.autoUpdateHeader}>
                            <div>
                                <div className={styles.autoUpdateTitle}>{t('system_info.auto_update_title')}</div>
                                <p className={styles.autoUpdateHint}>
                                    {t('system_info.auto_check_hint')} {t('system_info.auto_install_hint')}
                                </p>
                            </div>
                            <Link to='/config' className={styles.autoUpdateConfigLink}>
                                {t('system_info.auto_update_config_link')}
                            </Link>
                        </div>
                        <div className={styles.autoUpdateSummaryRow}>
                            <div className={styles.autoUpdateField}>
                                <span className={styles.autoUpdateSummaryLabel}>
                                    {t('system_info.auto_update_check')}
                                </span>
                                <span className={styles.autoUpdateSummaryValue}>
                                    {autoCheckUpdateEnabled === null
                                     ? t('common.not_set')
                                     : autoCheckUpdateEnabled
                                       ? t('common.yes')
                                       : t('common.no')}
                                </span>
                            </div>
                            <div className={styles.autoUpdateField}>
                                <span className={styles.autoUpdateSummaryLabel}>
                                    {t('system_info.auto_update_panel')}
                                </span>
                                <span className={styles.autoUpdateSummaryValue}>
                                    {autoUpdatePanelEnabled === null
                                     ? t('system_info.auto_update_unknown')
                                     : autoUpdatePanelEnabled
                                       ? t('common.yes')
                                       : t('common.no')}
                                </span>
                            </div>
                            <div className={styles.autoUpdateField}>
                                <span className={styles.autoUpdateSummaryLabel}>
                                    {t('system_info.auto_install_updates')}
                                </span>
                                <span className={styles.autoUpdateSummaryValue}>
                                    {autoUpdateCPAEnabled === null
                                     ? t('system_info.auto_update_unknown')
                                     : autoUpdateCPAEnabled
                                       ? t('common.yes')
                                       : t('common.no')}
                                </span>
                            </div>
                            <div className={styles.autoUpdateField}>
                                <span className={styles.autoUpdateSummaryLabel}>{t('system_info.check_interval')}</span>
                                <span className={styles.autoUpdateSummaryValue}>{autoCheckIntervalLabel}</span>
                            </div>
                        </div>
                    </div>
                </Card>

                <Card
                    className={styles.modelsCard}
                    title={t('system_info.models_title')}
                    extra={
                        <div className={styles.modelsToolbar}>
                            <div className={styles.modelsCacheControls}>
                                <span className={styles.modelsCacheLabel}>
                                    {t('system_info.models_cache_label', { defaultValue: '页面缓存' })}
                                </span>
                                <Select
                                    value={localStorage.getItem('cpa-models-cache-expiry') || '30000'}
                                    onChange={(val) => {
                                        localStorage.setItem('cpa-models-cache-expiry', val)
                                        window.location.reload()
                                    }}
                                    options={[
                                        {
                                            value: '0',
                                            label: t('system_info.models_cache_off', { defaultValue: 'No cache' }),
                                        },
                                        { value: '30000', label: '30s' },
                                        { value: '60000', label: '1min' },
                                        { value: '300000', label: '5min' },
                                        { value: '600000', label: '10min' },
                                    ]}
                                    fullWidth={false}
                                    ariaLabel={t('system_info.models_cache_label', { defaultValue: 'Models cache' })}
                                />
                            </div>
                            <div className={styles.modelsToolbarActions}>
                                <Button
                                    variant='secondary'
                                    size='sm'
                                    onClick={() => fetchModels({ forceRefresh: true })}
                                    loading={modelRequestLoading || modelsLoading}
                                >
                                    {t('common.refresh')}
                                </Button>
                                <Button
                                    variant='secondary'
                                    size='sm'
                                    onClick={() => void handleCatalogRefresh()}
                                    loading={catalogRefreshing}
                                >
                                    {t('system_info.catalog_refresh_button')}
                                </Button>
                            </div>
                        </div>
                    }
                >
                    <p className={styles.sectionDescription}>{t('system_info.models_desc')}</p>
                    {modelsCache?.timestamp && (
                        <div className={styles.modelsRuntimeMeta}>
                            <p className={`${styles.sectionDescription} ${styles.cacheRefreshHint}`}>
                                {t('system_info.models_last_refresh', {
                                    defaultValue: 'Last refreshed: {{time}}',
                                    time: formatDateTime(new Date(modelsCache.timestamp), i18n.language),
                                })}
                            </p>
                            <p className={`${styles.sectionDescription} ${styles.cacheRefreshHint}`}>
                                {t('system_info.models_cache_expiry', {
                                    defaultValue: 'Page cache expires in {{time}}',
                                    time: (() => {
                                        const expiryMs = Number(
                                            localStorage.getItem('cpa-models-cache-expiry') || '30000',
                                        )
                                        if (expiryMs <= 0) {
                                            return t('system_info.models_cache_off', { defaultValue: 'No cache' })
                                        }
                                        return `${Math.round(expiryMs / 1000)}s`
                                    })(),
                                })}
                            </p>
                            <p className={`${styles.sectionDescription} ${styles.cacheRefreshHint}`}>
                                {t('system_info.models_source_label', { defaultValue: 'Source' })}{' '}
                                {catalogMeta?.source === 'embed'
                                 ? t('system_info.catalog_source_embed')
                                 : renderCatalogSources(catalogSources)}
                            </p>
                        </div>
                    )}
                    <div className={styles.modelsHintBlock}>
                        <p className={styles.sectionDescription}>{t('system_info.models_refresh_hint')}</p>
                        <p className={`${styles.sectionDescription} ${styles.cacheRefreshHint}`}>
                            {t('system_info.models_refresh_interval_hint', {
                                defaultValue:
                                    'Backend fetches the upstream model list every {{hours}}h; click Refresh to trigger it now.',
                                hours: catalogMeta?.interval_hours ?? 3,
                            })}
                        </p>
                    </div>
                    {modelStatus && <div className={`status-badge ${modelStatus.type}`}>{modelStatus.message}</div>}
                    {!modelRequestLoading && !modelsLoading && modelsError && <div className='error-box'>{modelsError}</div>}
                    {modelRequestLoading || modelsLoading ? (
                        <div className='hint'>{t('common.loading')}</div>
                    ) : models.length === 0 ? (
                        <div className={styles.emptyStatePanel}>
                            <div className={styles.emptyStateTitle}>{t('system_info.models_empty')}</div>
                            <p className={styles.emptyStateText}>{t('system_info.models_empty_reason')}</p>
                            <Link to='/models' className={styles.inlineActionLink}>
                                {t('credentials.model_management_manage', { defaultValue: '前往模型管理' })}
                            </Link>
                        </div>
                    ) : (
                            <div className='item-list'>
                                {groupedModels.map((group) => {
                                    const iconSrc = getIconForCategory(group.id)
                                    return (
                                        <div key={group.id} className='item-row'>
                                            <div className='item-meta'>
                                                <div className={styles.groupTitle}>
                                                    {iconSrc &&
                                                     <img src={iconSrc} alt='' className={styles.groupIcon} />}
                                                    <span className='item-title'>{group.label}</span>
                                                </div>
                                                <div className='item-subtitle'>
                                                    {t('system_info.models_count', { count: group.items.length })}
                                                </div>
                                            </div>
                                            <div className={styles.modelTags}>
                                                {group.items.map((model) => (
                                                    <span
                                                        key={model.name}
                                                        className={styles.modelTag}
                                                        title={model.description || ''}
                                                    >
                                                    <span className={styles.modelName}>{model.name}</span>
                                                </span>
                                                ))}
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        )}
                    {/* Catalog refresh metadata folded in here (previously a separate
                     card) so operators see the backend sync state alongside the
                     model list it feeds. */}
                    {catalogMetaError && (
                        <div className='error-box' style={{ marginTop: 12 }}>
                            {catalogMetaError}
                        </div>
                    )}
                    {catalogMeta && (
                        <div
                            className={`${styles.versionMeta} ${styles.catalogMetaFooter ?? ''}`}
                            style={{ marginTop: 16 }}
                        >
                            <div className={styles.metaRow}>
                                <span className={styles.metaLabel}>{t('system_info.catalog_last_refresh')}</span>
                                <span className={styles.metaValue}>
                                    {catalogMeta.last_refresh_at && !catalogMeta.last_refresh_at.startsWith('0001')
                                     ? formatDateTime(new Date(catalogMeta.last_refresh_at), i18n.language)
                                     : '-'}
                                </span>
                            </div>
                            <div className={styles.metaRow}>
                                <span className={styles.metaLabel}>{t('system_info.catalog_next_refresh')}</span>
                                <span className={styles.metaValue}>
                                    {catalogMeta.next_refresh_at && !catalogMeta.next_refresh_at.startsWith('0001')
                                     ? formatDateTime(new Date(catalogMeta.next_refresh_at), i18n.language)
                                     : '-'}
                                </span>
                            </div>
                            <div className={styles.metaRow}>
                                <span className={styles.metaLabel}>{t('system_info.catalog_refresh_interval')}</span>
                                <span className={styles.metaValue}>
                                    {catalogMeta.interval_hours > 0
                                     ? t('system_info.catalog_refresh_interval_value', {
                                            hours: catalogMeta.interval_hours,
                                        })
                                     : t('system_info.catalog_refresh_interval_disabled')}
                                </span>
                            </div>
                            <div className={styles.metaRow}>
                                <span className={styles.metaLabel}>{t('system_info.catalog_source_label')}</span>
                                <span className={styles.metaValue}>
                                    {catalogMeta.source === 'embed'
                                     ? t('system_info.catalog_source_embed')
                                     : renderCatalogSources(catalogMeta.source ? [catalogMeta.source] : [])}
                                </span>
                            </div>
                            {catalogMeta.sources.length > 0 && (
                                <div className={styles.metaRow}>
                                    <span className={styles.metaLabel}>{t('system_info.catalog_sources_label')}</span>
                                    <span className={styles.metaValue}>{renderCatalogSources(catalogSources)}</span>
                                </div>
                            )}
                            {catalogMeta.last_error && (
                                <div className={styles.metaRow}>
                                    <span className={styles.metaLabel}>{t('system_info.catalog_last_error')}</span>
                                    <span className={styles.metaValue}>{catalogMeta.last_error}</span>
                                </div>
                            )}
                        </div>
                    )}
                </Card>

                <Card title={t('system_info.quick_links_title')}>
                    <p className={styles.sectionDescription}>{t('system_info.quick_links_desc')}</p>
                    <div className={styles.quickLinks}>
                        <a
                            href='https://github.com/Pyrokine/CLIProxyAPI'
                            target='_blank'
                            rel='noopener noreferrer'
                            className={styles.linkCard}
                        >
                            <div className={`${styles.linkIcon} ${styles.github}`}>
                                <IconGithub size={22} />
                            </div>
                            <div className={styles.linkContent}>
                                <div className={styles.linkTitle}>
                                    {t('system_info.link_main_repo')}
                                    <IconExternalLink size={14} />
                                </div>
                                <div className={styles.linkDesc}>{t('system_info.link_main_repo_desc')}</div>
                                <span className={styles.linkUrl}>github.com/Pyrokine/CLIProxyAPI</span>
                            </div>
                        </a>

                        <a
                            href='https://github.com/Pyrokine/Cli-Proxy-API-Management-Center'
                            target='_blank'
                            rel='noopener noreferrer'
                            className={styles.linkCard}
                        >
                            <div className={`${styles.linkIcon} ${styles.github}`}>
                                <IconCode size={22} />
                            </div>
                            <div className={styles.linkContent}>
                                <div className={styles.linkTitle}>
                                    {t('system_info.link_webui_repo')}
                                    <IconExternalLink size={14} />
                                </div>
                                <div className={styles.linkDesc}>{t('system_info.link_webui_repo_desc')}</div>
                                <span className={styles.linkUrl}>
                                    github.com/Pyrokine/Cli-Proxy-API-Management-Center
                                </span>
                            </div>
                        </a>

                        <a
                            href='https://help.router-for.me/'
                            target='_blank'
                            rel='noopener noreferrer'
                            className={styles.linkCard}
                        >
                            <div className={`${styles.linkIcon} ${styles.docs}`}>
                                <IconBookOpen size={22} />
                            </div>
                            <div className={styles.linkContent}>
                                <div className={styles.linkTitle}>
                                    {t('system_info.link_docs')}
                                    <IconExternalLink size={14} />
                                </div>
                                <div className={styles.linkDesc}>{t('system_info.link_docs_desc')}</div>
                                <span className={styles.linkUrl}>help.router-for.me</span>
                            </div>
                        </a>
                    </div>
                </Card>

                <Card title={t('system_info.clear_login_title')}>
                    <p className={styles.sectionDescription}>{t('system_info.clear_login_desc')}</p>
                    <div className={styles.clearLoginActions}>
                        <Button variant='danger' onClick={handleClearLoginStorage}>
                            {t('system_info.clear_login_button')}
                        </Button>
                    </div>
                </Card>

                <Card
                    title={t('system_info.rate_limit_title')}
                    extra={
                        <Button variant='ghost' size='sm' onClick={() => void fetchRateLimitStatus()}
                                disabled={rateLimitLoading}>
                            {t('system_info.rate_limit_refresh')}
                        </Button>
                    }
                >
                    <p className={styles.sectionDescription}>{t('system_info.rate_limit_desc')}</p>
                    {rateLimitLoading ? null : bannedIPs.length === 0 ? (
                        <div className={styles.emptyStatePanel}>
                            <div className={styles.emptyStateTitle}>{t('system_info.rate_limit_no_banned')}</div>
                        </div>
                    ) : (
                                                   <table className={styles.rateLimitTable}>
                                                       <tbody>
                                                       {bannedIPs.map((entry) => (
                                                           <tr key={entry.ip} className={styles.rateLimitRow}>
                                                               <td className={styles.rateLimitIP}>{entry.ip}</td>
                                                               <td className={styles.rateLimitExpiry}>
                                                                   <div>
                                                                       {t('system_info.rate_limit_ban_expires')}: {formatDateTime(
                                                                       entry.banned_until)}
                                                                   </div>
                                                                   <div>
                                                                       {t(
                                                                           'system_info.rate_limit_ban_count',
                                                                           { count: entry.ban_count ?? 0 },
                                                                       )}
                                                                   </div>
                                                               </td>
                                                               <td>
                                                                   <Button
                                                                       variant='danger'
                                                                       size='sm'
                                                                       onClick={() => handleUnban(entry.ip)}
                                                                       disabled={unbanning === entry.ip}
                                                                   >
                                                                       {t('system_info.rate_limit_unban')}
                                                                   </Button>
                                                               </td>
                                                           </tr>
                                                       ))}
                                                       </tbody>
                                                   </table>
                                               )}
                    <div className={styles.rateLimitHistory}>
                        <div className={styles.rateLimitHistoryTitle}>
                            {t('system_info.rate_limit_unban_history')}
                        </div>
                        {unbanHistory.length === 0 ? (
                            <p className={styles.emptyStateText}>{t('system_info.rate_limit_no_unban_history')}</p>
                        ) : (
                             <table className={styles.rateLimitTable}>
                                 <tbody>
                                 {unbanHistory.map((entry) => (
                                     <tr
                                         key={`${entry.ip}-${entry.unbanned_at}`}
                                         className={styles.rateLimitRow}
                                     >
                                         <td className={styles.rateLimitIP}>{entry.ip}</td>
                                         <td className={styles.rateLimitExpiry}>
                                             <div>
                                                 {t('system_info.rate_limit_unbanned_at')}: {formatDateTime(
                                                 entry.unbanned_at)}
                                             </div>
                                             <div>
                                                 {t(
                                                     'system_info.rate_limit_ban_count',
                                                     { count: entry.ban_count ?? 0 },
                                                 )}
                                             </div>
                                         </td>
                                     </tr>
                                 ))}
                                 </tbody>
                             </table>
                         )}
                    </div>
                </Card>
            </div>

            <VersionHistoryModal
                open={versionHistoryTarget !== null}
                onClose={() => setVersionHistoryTarget(null)}
                currentVersion={versionHistoryTarget === 'panel' ? appVersion : auth.serverVersion || ''}
                target={versionHistoryTarget ?? 'cpa'}
                repository={versionHistoryTarget === 'panel' ? panelRepository : cpaRepository}
            />
        </div>
    )
}
