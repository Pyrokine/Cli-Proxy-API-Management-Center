import iconClaude from '@/assets/icons/claude.svg'
import iconDeepseek from '@/assets/icons/deepseek.svg'
import iconGemini from '@/assets/icons/gemini.svg'
import iconGlm from '@/assets/icons/glm.svg'
import iconGrok from '@/assets/icons/grok.svg'
import iconKimiDark from '@/assets/icons/kimi-dark.svg'
import iconKimiLight from '@/assets/icons/kimi-light.svg'
import iconMinimax from '@/assets/icons/minimax.svg'
import iconOpenaiDark from '@/assets/icons/openai-dark.svg'
import iconOpenaiLight from '@/assets/icons/openai-light.svg'
import iconQwen from '@/assets/icons/qwen.svg'
import { INLINE_LOGO_JPEG } from '@/assets/logoInline'
import { VersionHistoryModal } from '@/components/system/VersionHistoryModal'
import { VersionSwitcher } from '@/components/system/VersionSwitcher'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { IconBookOpen, IconCode, IconExternalLink, IconGithub } from '@/components/ui/icons'
import { versionApi } from '@/services/api'
import { apiKeysApi } from '@/services/api/apiKeys'
import { modelCatalogApi, type ModelCatalogMeta } from '@/services/api/modelCatalog'
import { type Release, releasesApi } from '@/services/api/releases'
import { useAuthStore, useConfigStore, useModelsStore, useNotificationStore, useThemeStore } from '@/stores'
import { STORAGE_KEY_AUTH } from '@/utils/constants'
import { formatDateTime, normalizeApiKeyList } from '@/utils/format'
import { classifyModels, getLocalizedOtherLabel } from '@/utils/models'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import styles from './SystemPage.module.scss'

const MODEL_CATEGORY_ICONS: Record<string, string | { light: string; dark: string }> = {
    gpt: { light: iconOpenaiLight, dark: iconOpenaiDark },
    claude: iconClaude,
    gemini: iconGemini,
    qwen: iconQwen,
    kimi: { light: iconKimiLight, dark: iconKimiDark },
    glm: iconGlm,
    grok: iconGrok,
    deepseek: iconDeepseek,
    minimax: iconMinimax,
}

const DEFAULT_UPDATE_CHECK_INTERVAL_MINUTES = 180
const MIN_UPDATE_CHECK_INTERVAL_MINUTES = 30

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
    const latestParts = parseVersionSegments(latest)
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
    const { t, i18n } = useTranslation()
    const { showNotification, showConfirmation } = useNotificationStore()
    const addPersistentNotification = useNotificationStore((s) => s.addPersistentNotification)
    const resolvedTheme = useThemeStore((state) => state.resolvedTheme)
    const auth = useAuthStore()
    const config = useConfigStore((state) => state.config)
    const fetchConfig = useConfigStore((state) => state.fetchConfig)

    const models = useModelsStore((state) => state.models)
    const modelsLoading = useModelsStore((state) => state.loading)
    const modelsError = useModelsStore((state) => state.error)
    const fetchModelsFromStore = useModelsStore((state) => state.fetchModels)
    const modelsCache = useModelsStore((state) => state.cache)

    const [modelStatus, setModelStatus] = useState<{
        type: 'success' | 'warning' | 'error' | 'muted'
        message: string
    }>()
    const [checkingVersion, setCheckingVersion] = useState(false)
    const [versionHistoryTarget, setVersionHistoryTarget] = useState<'panel' | 'cpa' | null>(null)
    const [latestPanelVersion, setLatestPanelVersion] = useState<string | null>(null)
    const [latestPanelBuildTime, setLatestPanelBuildTime] = useState<string | null>(null)
    const [latestCpaVersion, setLatestCpaVersion] = useState<string | null>(null)
    const [latestCpaBuildTime, setLatestCpaBuildTime] = useState<string | null>(null)
    const [lastCheckTime, setLastCheckTime] = useState<number | null>(null)
    const [catalogMeta, setCatalogMeta] = useState<ModelCatalogMeta | null>(null)
    const [catalogMetaError, setCatalogMetaError] = useState<string | null>(null)
    const [catalogRefreshing, setCatalogRefreshing] = useState(false)

    const apiKeysCache = useRef<string[]>([])
    const versionCheckInFlight = useRef<Promise<void> | null>(null)

    const otherLabel = useMemo(() => getLocalizedOtherLabel(t), [t])
    const groupedModels = useMemo(() => classifyModels(models, { otherLabel, t }), [models, otherLabel, t])
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
        return sources.map((source, index) => (
            <span key={source}>
                {index > 0 && ', '}
                <a href={source} target="_blank" rel="noopener noreferrer" className={styles.inlineSourceLink}>
                    {source}
                </a>
            </span>
        ))
    }

    const appVersion = __APP_VERSION__ || t('system_info.version_unknown')
    const apiVersion = auth.serverVersion || t('system_info.version_unknown')
    const requiredPanelVersion = auth.serverMinPanelVersion || '-'
    const panelBuildTime =
        typeof __BUILD_TIME__ === 'string' && __BUILD_TIME__ ? formatDateTime(__BUILD_TIME__, i18n.language) : '-'
    const serverBuildTime = auth.serverBuildDate ? formatDateTime(auth.serverBuildDate, i18n.language) : '-'
    const panelReleaseStatus =
        compareVersions(latestPanelVersion, appVersion) === 0
            ? t('system_info.latest_remote_current', { defaultValue: '已是线上最新' })
            : (latestPanelVersion ?? '-')
    const cpaReleaseStatus =
        compareVersions(latestCpaVersion, apiVersion) === 0
            ? t('system_info.latest_remote_current', { defaultValue: '已是线上最新' })
            : (latestCpaVersion ?? '-')

    const remoteManagement = config?.remoteManagement
    const remoteManagementLoaded = config !== null
    const panelRepository =
        remoteManagement?.panelGithubRepository || 'https://github.com/Pyrokine/Cli-Proxy-API-Management-Center'
    const cpaRepository = remoteManagement?.cpaGithubRepository || 'https://github.com/Pyrokine/CLIProxyAPI'
    const autoCheckUpdateEnabled = !remoteManagementLoaded ? null : (remoteManagement?.autoCheckUpdate ?? false)
    const autoUpdatePanelEnabled = !remoteManagementLoaded ? null : (remoteManagement?.autoUpdatePanel ?? true)
    const autoUpdateCPAEnabled = !remoteManagementLoaded ? null : (remoteManagement?.autoUpdateCPA ?? false)
    const autoCheckIntervalMinutes = !remoteManagementLoaded
        ? null
        : typeof remoteManagement?.checkInterval === 'number' &&
            remoteManagement.checkInterval >= MIN_UPDATE_CHECK_INTERVAL_MINUTES
          ? remoteManagement.checkInterval
          : DEFAULT_UPDATE_CHECK_INTERVAL_MINUTES
    const autoCheckIntervalLabel =
        autoCheckIntervalMinutes === null
            ? t('common.not_set')
            : t('system_info.check_interval_minutes', { count: autoCheckIntervalMinutes })
    const getIconForCategory = (categoryId: string): string | null => {
        const iconEntry = MODEL_CATEGORY_ICONS[categoryId]
        if (!iconEntry) {
            return null
        }
        if (typeof iconEntry === 'string') {
            return iconEntry
        }
        return resolvedTheme === 'dark' ? iconEntry.dark : iconEntry.light
    }

    const resolveApiKeysForModels = useCallback(async () => {
        if (apiKeysCache.current.length) {
            return apiKeysCache.current
        }

        const configKeys = normalizeApiKeyList(config?.apiKeys)
        if (configKeys.length) {
            apiKeysCache.current = configKeys
            return configKeys
        }

        try {
            const list = await apiKeysApi.list()
            const normalized = normalizeApiKeyList(list)
            if (normalized.length) {
                apiKeysCache.current = normalized
            }
            return normalized
        } catch (err) {
            console.warn('Auto loading API keys for models failed:', err)
            return []
        }
    }, [config?.apiKeys])

    const fetchModels = async ({ forceRefresh = false }: { forceRefresh?: boolean } = {}) => {
        if (auth.connectionStatus !== 'connected') {
            setModelStatus({
                type: 'warning',
                message: t('notification.connection_required'),
            })
            return
        }

        if (!auth.apiBase) {
            showNotification(t('notification.connection_required'), 'warning')
            return
        }

        if (forceRefresh) {
            apiKeysCache.current = []
        }

        setModelStatus({ type: 'muted', message: t('system_info.models_loading') })
        try {
            const apiKeys = await resolveApiKeysForModels()
            const primaryKey = apiKeys[0]
            const list = await fetchModelsFromStore(auth.apiBase, primaryKey, forceRefresh)
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
                    'model-update'
                )
            }
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : typeof err === 'string' ? err : ''
            const suffix = message ? `: ${message}` : ''
            const text = `${t('system_info.models_error')}${suffix}`
            setModelStatus({ type: 'error', message: text })
            if (forceRefresh) {
                addPersistentNotification(text, 'error', 'model-update')
            }
        }
    }

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
                const keysToRemove = [STORAGE_KEY_AUTH, 'isLoggedIn', 'apiBase', 'apiUrl', 'managementKey']
                keysToRemove.forEach((key) => localStorage.removeItem(key))
                showNotification(t('notification.login_storage_cleared'), 'success')
            },
        })
    }

    const handleVersionCheck = useCallback(
        ({ silent = false }: { silent?: boolean } = {}) => {
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

                    const latestCpaRaw =
                        cpaLatest?.['latest-version'] ?? cpaLatest?.latest_version ?? cpaLatest?.latest ?? ''
                    const latestCpa = typeof latestCpaRaw === 'string' ? latestCpaRaw : String(latestCpaRaw ?? '')
                    const latestCpaPublishedRaw = cpaLatest?.['published-at'] ?? cpaLatest?.published_at ?? ''
                    const latestCpaPublished = typeof latestCpaPublishedRaw === 'string' ? latestCpaPublishedRaw : ''
                    const latestPanelRelease =
                        (panelReleases.releases ?? []).find((release: Release) => !release.draft) ?? null
                    const latestPanel = latestPanelRelease?.tag_name || ''

                    setLastCheckTime(Date.now())
                    setLatestCpaVersion(latestCpa || null)
                    setLatestCpaBuildTime(latestCpaPublished || null)
                    setLatestPanelVersion(latestPanel || null)
                    setLatestPanelBuildTime(latestPanelRelease?.published_at || null)

                    if (!latestCpa) {
                        if (!silent) {
                            showNotification(t('system_info.version_check_error'), 'error')
                        }
                        return
                    }

                    const comparison = compareVersions(latestCpa, auth.serverVersion)
                    if (comparison === null) {
                        if (!silent) {
                            showNotification(t('system_info.version_current_missing'), 'warning')
                        }
                        return
                    }

                    if (comparison > 0) {
                        if (!silent) {
                            showNotification(
                                t('system_info.version_update_available', { version: latestCpa }),
                                'warning'
                            )
                            addPersistentNotification(
                                t('system_info.version_update_available', { version: latestCpa }),
                                'warning',
                                'version'
                            )
                        }
                    } else if (!silent) {
                        showNotification(t('system_info.version_is_latest'), 'success')
                    }
                } catch (error: unknown) {
                    setLastCheckTime(Date.now())
                    const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
                    const suffix = message ? `: ${message}` : ''
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
        [auth, showNotification, addPersistentNotification, t]
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
            const suffix = message ? `: ${message}` : ''
            setCatalogMetaError(message || 'failed')
            showNotification(`${t('system_info.catalog_refresh_failed')}${suffix}`, 'error')
            await fetchCatalogMeta()
        } finally {
            setCatalogRefreshing(false)
        }
    }, [fetchCatalogMeta, showNotification, t])

    useEffect(() => {
        fetchConfig().catch(() => {
            // ignore
        })
    }, [fetchConfig])

    useEffect(() => {
        queueMicrotask(() => {
            void fetchModels()
        })
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [auth.connectionStatus, auth.apiBase])

    useEffect(() => {
        if (auth.connectionStatus !== 'connected') {
            return
        }
        queueMicrotask(() => {
            void fetchCatalogMeta()
        })
    }, [auth.connectionStatus, fetchCatalogMeta])

    useEffect(() => {
        void handleVersionCheck({ silent: true })
    }, [handleVersionCheck])

    return (
        <div className={styles.container}>
            <h1 className={styles.pageTitle}>{t('system_info.title')}</h1>
            <div className={styles.content}>
                <Card className={styles.aboutCard}>
                    <div className={styles.aboutHeader}>
                        <img src={INLINE_LOGO_JPEG} alt="CPAMC" className={styles.aboutLogo} />
                        <div className={styles.aboutTitle}>{t('system_info.about_title')}</div>
                    </div>

                    <div className={styles.aboutInfoGrid}>
                        <div className={styles.infoTile}>
                            <div className={styles.tileHeader}>
                                <div className={styles.tileLabel}>{t('footer.version')}</div>
                                <div className={styles.tileActions}>
                                    <Button
                                        type="button"
                                        variant="secondary"
                                        size="sm"
                                        className={styles.tileAction}
                                        onClick={() => void handleVersionCheck()}
                                        loading={checkingVersion}
                                        title={t('system_info.version_check_button')}
                                        aria-label={t('system_info.version_check_button')}
                                    >
                                        {t('system_info.version_check_button')}
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="secondary"
                                        size="sm"
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
                            <VersionSwitcher
                                target="panel"
                                currentVersion={appVersion}
                                onAfterSwitch={() => void handleVersionCheck()}
                            />
                        </div>

                        <div className={styles.infoTile}>
                            <div className={styles.tileHeader}>
                                <div className={styles.tileLabel}>{t('footer.api_version')}</div>
                                <div className={styles.tileActions}>
                                    <Button
                                        type="button"
                                        variant="secondary"
                                        size="sm"
                                        className={styles.tileAction}
                                        onClick={() => void handleVersionCheck()}
                                        loading={checkingVersion}
                                        title={t('system_info.version_check_button')}
                                        aria-label={t('system_info.version_check_button')}
                                    >
                                        {t('system_info.version_check_button')}
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="secondary"
                                        size="sm"
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
                            <VersionSwitcher
                                target="cpa"
                                currentVersion={apiVersion}
                                onAfterSwitch={() => void handleVersionCheck()}
                            />
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
                            <Link to="/config" className={styles.autoUpdateConfigLink}>
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
                                <select
                                    value={localStorage.getItem('cpa-models-cache-expiry') || '30000'}
                                    onChange={(event) => {
                                        localStorage.setItem('cpa-models-cache-expiry', event.target.value)
                                        window.location.reload()
                                    }}
                                    className={styles.cacheSelect}
                                    aria-label={t('system_info.models_cache_off', { defaultValue: 'Models cache' })}
                                >
                                    <option value="0">
                                        {t('system_info.models_cache_off', { defaultValue: 'No cache' })}
                                    </option>
                                    <option value="30000">30s</option>
                                    <option value="60000">1min</option>
                                    <option value="300000">5min</option>
                                    <option value="600000">10min</option>
                                </select>
                            </div>
                            <div className={styles.modelsToolbarActions}>
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={() => fetchModels({ forceRefresh: true })}
                                    loading={modelsLoading}
                                >
                                    {t('common.refresh')}
                                </Button>
                                <Button
                                    variant="secondary"
                                    size="sm"
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
                                            localStorage.getItem('cpa-models-cache-expiry') || '30000'
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
                    {modelsError && <div className="error-box">{modelsError}</div>}
                    {modelsLoading ? (
                        <div className="hint">{t('common.loading')}</div>
                    ) : models.length === 0 ? (
                        <div className="hint">{t('system_info.models_empty')}</div>
                    ) : (
                        <div className="item-list">
                            {groupedModels.map((group) => {
                                const iconSrc = getIconForCategory(group.id)
                                return (
                                    <div key={group.id} className="item-row">
                                        <div className="item-meta">
                                            <div className={styles.groupTitle}>
                                                {iconSrc && <img src={iconSrc} alt="" className={styles.groupIcon} />}
                                                <span className="item-title">{group.label}</span>
                                            </div>
                                            <div className="item-subtitle">
                                                {t('system_info.models_count', { count: group.items.length })}
                                            </div>
                                        </div>
                                        <div className={styles.modelTags}>
                                            {group.items.map((model) => (
                                                <span
                                                    key={`${model.name}-${model.alias ?? 'default'}`}
                                                    className={styles.modelTag}
                                                    title={model.description || ''}
                                                >
                                                    <span className={styles.modelName}>{model.name}</span>
                                                    {model.alias && (
                                                        <span className={styles.modelAlias}>{model.alias}</span>
                                                    )}
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
                        <div className="error-box" style={{ marginTop: 12 }}>
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
                            href="https://github.com/Pyrokine/CLIProxyAPI"
                            target="_blank"
                            rel="noopener noreferrer"
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
                            href="https://github.com/Pyrokine/Cli-Proxy-API-Management-Center"
                            target="_blank"
                            rel="noopener noreferrer"
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
                            href="https://help.router-for.me/"
                            target="_blank"
                            rel="noopener noreferrer"
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
                        <Button variant="danger" onClick={handleClearLoginStorage}>
                            {t('system_info.clear_login_button')}
                        </Button>
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
