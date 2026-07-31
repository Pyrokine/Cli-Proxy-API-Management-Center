import {usePageTransitionLayer} from '@/components/common/PageTransitionLayer'
import {IconBot, IconKey, IconSatellite} from '@/components/ui/icons'
import {useApiKeysResolver} from '@/hooks/useApiKeysResolver'
import {apiKeysApi, authFilesApi, providersApi} from '@/services/api'
import {useAuthStore, useConfigStore, useModelsStore} from '@/stores'
import {formatDateTime} from '@/utils/format'
import {type ReactNode, useCallback, useEffect, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {Link} from 'react-router-dom'
import styles from './DashboardPage.module.scss'

interface QuickStat {
    label: string
    value: number | string
    icon: ReactNode
    path: string
    loading?: boolean
    sublabel?: string
}

interface ProviderStats {
    gemini: number | null
    codex: number | null
    claude: number | null
    openai: number | null
}

type TimeOfDay = 'morning' | 'afternoon' | 'evening' | 'night'

function getTimeOfDay(): TimeOfDay {
    const hour = new Date().getHours()
    if (hour >= 5 && hour < 12) {
        return 'morning'
    }
    if (hour >= 12 && hour < 17) {
        return 'afternoon'
    }
    if (hour >= 17 && hour < 21) {
        return 'evening'
    }
    return 'night'
}

export function DashboardPage() {
    const { t, i18n }      = useTranslation()
    const transitionLayer  = usePageTransitionLayer()
    const pageLayerStatus  = transitionLayer?.status ?? 'current'
    const connectionStatus = useAuthStore((state) => state.connectionStatus)
    const serverVersion    = useAuthStore((state) => state.serverVersion)
    const serverBuildDate  = useAuthStore((state) => state.serverBuildDate)
    const apiBase          = useAuthStore((state) => state.apiBase)
    const config           = useConfigStore((state) => state.config)

    const models               = useModelsStore((state) => state.models)
    const modelsLoading        = useModelsStore((state) => state.loading)
    const modelsError          = useModelsStore((state) => state.error)
    const fetchModelsFromStore = useModelsStore((state) => state.fetchModels)

    const [stats, setStats] = useState<{
        apiKeys: number | null
        authFiles: number | null
    }>({
           apiKeys: null,
           authFiles: null,
       })

    const [providerStats, setProviderStats] = useState<ProviderStats>({
                                                                          gemini: null,
                                                                          codex: null,
                                                                          claude: null,
                                                                          openai: null,
                                                                      })

    const [loading, setLoading]                           = useState(true)
    const [modelsRequestLoading, setModelsRequestLoading] = useState(false)
    const [timeOfDay, setTimeOfDay]                       = useState<TimeOfDay>(getTimeOfDay)
    const [currentTime, setCurrentTime] = useState(() => new Date())

    const { resolve: resolveApiKeys, clearCache: clearApiKeysCache } = useApiKeysResolver()
    const modelsRequestGeneration                                  = useRef(0)
    const invalidateModelsRequest                                  = useCallback(() => {
        ++modelsRequestGeneration.current
    }, [])

    useEffect(() => {
        clearApiKeysCache()
    }, [apiBase, config?.apiKeys, clearApiKeysCache])

    useEffect(() => {
        const id = window.setInterval(() => {
            setTimeOfDay(getTimeOfDay())
            setCurrentTime(new Date())
        }, 60_000)
        return () => window.clearInterval(id)
    }, [])

    const fetchModels = useCallback(async () => {
        const requestGeneration = ++modelsRequestGeneration.current
        if (pageLayerStatus !== 'current') {
            return
        }
        if (connectionStatus !== 'connected' || !apiBase) {
            setModelsRequestLoading(false)
            return
        }

        setModelsRequestLoading(true)
        try {
            const apiKeys = await resolveApiKeys()
            if (requestGeneration !== modelsRequestGeneration.current) {
                return
            }
            const primaryKey = apiKeys[0]
            await fetchModelsFromStore(apiBase, primaryKey)
        } catch {
            // Ignore model fetch errors on dashboard
        } finally {
            if (requestGeneration === modelsRequestGeneration.current) {
                setModelsRequestLoading(false)
            }
        }
    }, [pageLayerStatus, connectionStatus, apiBase, resolveApiKeys, fetchModelsFromStore])

    useEffect(() => {
        let cancelled = false
        const fetchStats = async () => {
            setLoading(true)
            try {
                const results = await Promise.allSettled([
                                                             apiKeysApi.list(),
                                                             authFilesApi.list(),
                                                             providersApi.getGeminiKeys(),
                                                             providersApi.getCodexConfigs(),
                                                             providersApi.getClaudeConfigs(),
                                                             providersApi.getOpenAIProviders(),
                                                         ])

                const [keysRes, filesRes, geminiRes, codexRes, claudeRes, openaiRes] = results

                setStats({
                             apiKeys: keysRes.status === 'fulfilled' ? keysRes.value.length : null,
                             authFiles: filesRes.status === 'fulfilled' ? filesRes.value.files.length : null,
                         })

                setProviderStats({
                                     gemini: geminiRes.status === 'fulfilled' ? geminiRes.value.length : null,
                                     codex: codexRes.status === 'fulfilled' ? codexRes.value.length : null,
                                     claude: claudeRes.status === 'fulfilled' ? claudeRes.value.length : null,
                                     openai: openaiRes.status === 'fulfilled' ? openaiRes.value.length : null,
                                 })
            } finally {
                setLoading(false)
            }
        }

        queueMicrotask(() => {
            if (cancelled || pageLayerStatus !== 'current') {
                return
            }
            if (connectionStatus === 'connected') {
                void fetchStats()
                void fetchModels()
            } else {
                setLoading(false)
            }
        })
        return () => {
            cancelled = true
            invalidateModelsRequest()
        }
    }, [connectionStatus, fetchModels, invalidateModelsRequest, pageLayerStatus])

    const providerStatsReady =
              providerStats.gemini !== null &&
              providerStats.codex !== null &&
              providerStats.claude !== null &&
              providerStats.openai !== null
    const hasProviderStats   =
              providerStats.gemini !== null ||
              providerStats.codex !== null ||
              providerStats.claude !== null ||
              providerStats.openai !== null
    const totalProviderKeys  = providerStatsReady
                               ? (providerStats.gemini ?? 0) +
                                 (providerStats.codex ?? 0) +
                                 (providerStats.claude ?? 0) +
                                 (providerStats.openai ?? 0)
                               : 0
    const totalCredentials   = totalProviderKeys + (stats.authFiles ?? 0)

    const quickStats: QuickStat[] = [
        {
            label: t('dashboard.management_keys'),
            value: stats.apiKeys ?? '-',
            icon: <IconKey size={24} />,
            path: '/config',
            loading: loading && stats.apiKeys === null,
            sublabel: t('nav.config_management'),
        },
        {
            label: t('dashboard.total_credentials'),
            value: loading ? '-' : totalCredentials,
            icon: <IconBot size={24} />,
            path: '/credentials',
            loading: loading,
            sublabel:
                hasProviderStats || stats.authFiles !== null
                ? t('dashboard.credentials_detail', {
                    apiKeys: totalProviderKeys,
                    authFiles: stats.authFiles ?? 0,
                })
                : undefined,
        },
        {
            label: t('dashboard.available_models'),
            value: modelsRequestLoading || modelsLoading || modelsError ? '-' : models.length,
            icon: <IconSatellite size={24} />,
            path: '/system',
            loading: modelsRequestLoading || modelsLoading,
            sublabel: t('dashboard.available_models_desc'),
        },
    ]

    const routingStrategyRaw        = config?.routingStrategy?.trim() || ''
    const routingStrategyDisplay    = !routingStrategyRaw
                                      ? '-'
                                      : routingStrategyRaw === 'round-robin'
                                        ? t('basic_settings.routing_strategy_round_robin')
                                        : routingStrategyRaw === 'fill-first'
                                          ? t('basic_settings.routing_strategy_fill_first')
                                          : routingStrategyRaw
    const routingStrategyBadgeClass = !routingStrategyRaw
                                      ? styles.configBadgeUnknown
                                      : routingStrategyRaw === 'round-robin'
                                        ? styles.configBadgeRoundRobin
                                        : routingStrategyRaw === 'fill-first'
                                          ? styles.configBadgeFillFirst
                                          : styles.configBadgeUnknown
    const greetingKey               = `dashboard.greeting_${timeOfDay}`
    const caringKey                 = `dashboard.caring_${timeOfDay}`
    const formattedDate             = currentTime.toLocaleDateString(i18n.language, {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    })
    const formattedTime             = currentTime.toLocaleTimeString(i18n.language, {
        hour: '2-digit',
        minute: '2-digit',
    })

    return (
        <div className={styles.dashboard}>
            <div className={styles.header}>
                <div>
                    <span className={styles.heroGreeting}>{t(greetingKey)}</span>
                    <h1 className={styles.title}>{t('dashboard.welcome_back')}</h1>
                    <p className={styles.subtitle}>{t(caringKey)}</p>
                </div>
                <div className={styles.dateTimeBlock}>
                    <span className={styles.time}>{formattedTime}</span>
                    <span className={styles.date}>{formattedDate}</span>
                </div>
            </div>

            <div className={styles.connectionCard}>
                <div className={styles.connectionStatus}>
                    <span
                        className={`${styles.statusDot} ${
                            connectionStatus === 'connected'
                            ? styles.connected
                            : connectionStatus === 'connecting'
                              ? styles.connecting
                              : styles.disconnected
                        }`}
                    />
                    <span className={styles.statusText}>
                        {t(
                            connectionStatus === 'connected'
                            ? 'common.connected'
                            : connectionStatus === 'connecting'
                              ? 'common.connecting'
                              : 'common.disconnected',
                        )}
                    </span>
                </div>
                <div className={styles.connectionInfo}>
                    <span className={styles.serverUrl}>{apiBase || '-'}</span>
                    {serverVersion && (
                        <span className={styles.serverVersion}>v{serverVersion.trim().replace(/^[vV]+/, '')}</span>
                    )}
                    {serverBuildDate && (
                        <span className={styles.buildDate}>{formatDateTime(serverBuildDate, i18n.language)}</span>
                    )}
                </div>
            </div>

            <div className={styles.statsGrid}>
                {quickStats.map((stat) => (
                    <Link key={stat.label} to={stat.path} className={styles.statCard}>
                        <div className={styles.statIcon}>{stat.icon}</div>
                        <div className={styles.statContent}>
                            <span className={styles.statValue}>{stat.loading ? '...' : stat.value}</span>
                            <span className={styles.statLabel}>{stat.label}</span>
                            {stat.sublabel && !stat.loading && (
                                <span className={styles.statSublabel}>{stat.sublabel}</span>
                            )}
                        </div>
                    </Link>
                ))}
            </div>

            {config && (
                <div className={styles.section}>
                    <h2 className={styles.sectionTitle}>{t('dashboard.current_config')}</h2>
                    <div className={styles.configGrid}>
                        <div className={styles.configItem}>
                            <span className={styles.configLabel}>{t('basic_settings.debug_enable')}</span>
                            <span
                                className={`${styles.configValue} ${config.debug ? styles.enabled : styles.disabled}`}
                            >
                                {config.debug ? t('common.yes') : t('common.no')}
                            </span>
                        </div>
                        <div className={styles.configItem}>
                            <span className={styles.configLabel}>{t('basic_settings.usage_statistics_enable')}</span>
                            <span
                                className={`${styles.configValue} ${
                                    config.usageStatisticsEnabled ? styles.enabled : styles.disabled
                                }`}
                            >
                                {config.usageStatisticsEnabled ? t('common.yes') : t('common.no')}
                            </span>
                        </div>
                        <div className={styles.configItem}>
                            <span className={styles.configLabel}>{t('basic_settings.logging_to_file_enable')}</span>
                            <span
                                className={`${styles.configValue} ${
                                    config.loggingToFile ? styles.enabled : styles.disabled
                                }`}
                            >
                                {config.loggingToFile ? t('common.yes') : t('common.no')}
                            </span>
                        </div>
                        <div className={styles.configItem}>
                            <span className={styles.configLabel}>{t('basic_settings.retry_count_label')}</span>
                            <span className={styles.configValue}>{config.requestRetry ?? 0}</span>
                        </div>
                        <div className={styles.configItem}>
                            <span className={styles.configLabel}>{t('basic_settings.ws_auth_enable')}</span>
                            <span
                                className={`${styles.configValue} ${config.wsAuth ? styles.enabled : styles.disabled}`}
                            >
                                {config.wsAuth ? t('common.yes') : t('common.no')}
                            </span>
                        </div>
                        <div className={styles.configItem}>
                            <span className={styles.configLabel}>{t('dashboard.routing_strategy')}</span>
                            <span className={`${styles.configBadge} ${routingStrategyBadgeClass}`}>
                                {routingStrategyDisplay}
                            </span>
                        </div>
                        {config.proxyUrl && (
                            <div className={`${styles.configItem} ${styles.configItemFull}`}>
                                <span className={styles.configLabel}>{t('basic_settings.proxy_url_label')}</span>
                                <span className={styles.configValueMono}>{config.proxyUrl}</span>
                            </div>
                        )}
                    </div>
                    <Link to='/config' className={styles.viewMoreLink}>
                        {t('dashboard.edit_settings')} →
                    </Link>
                </div>
            )}
        </div>
    )
}
