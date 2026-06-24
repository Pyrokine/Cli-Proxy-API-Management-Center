import {INLINE_LOGO_JPEG} from '@/assets/logoInline'
import {NotificationCenter} from '@/components/common/NotificationCenter'
import {PageTransition} from '@/components/common/PageTransition'
import {VersionCompatBanner} from '@/components/common/VersionCompatBanner'
import {Button} from '@/components/ui/Button'
import {
    IconBot,
    IconSidebarAuthFiles,
    IconSidebarConfig,
    IconSidebarDashboard,
    IconSidebarLogs,
    IconSidebarOauth,
    IconSidebarProviders,
    IconSidebarQuota,
    IconSidebarSystem,
    IconSidebarUsage,
    IconSlidersHorizontal,
} from '@/components/ui/icons'
import {triggerHeaderRefresh} from '@/hooks/useHeaderRefresh'
import {MainRoutes} from '@/router/MainRoutes'
import {useAuthStore, useConfigStore, useLanguageStore, useNotificationStore, useThemeStore} from '@/stores'
import type {Theme} from '@/types'
import {LANGUAGE_LABEL_KEYS, LANGUAGE_ORDER} from '@/utils/constants'
import {isSupportedLanguage} from '@/utils/language'
import {ReactNode, SVGProps, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {NavLink, useLocation} from 'react-router-dom'

const sidebarIcons: Record<string, ReactNode> = {
    dashboard: <IconSidebarDashboard size={18} />,
    aiProviders: <IconSidebarProviders size={18} />,
    authFiles: <IconSidebarAuthFiles size={18} />,
    oauth: <IconSidebarOauth size={18} />,
    quota: <IconSidebarQuota size={18} />,
    models: <IconBot size={18} />,
    plugins: <IconSlidersHorizontal size={18} />,
    usage: <IconSidebarUsage size={18} />,
    config: <IconSidebarConfig size={18} />,
    logs: <IconSidebarLogs size={18} />,
    system: <IconSidebarSystem size={18} />,
}

// Header action icons - smaller size for header buttons
const headerIconProps: SVGProps<SVGSVGElement> = {
    width: 16,
    height: 16,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': 'true',
    focusable: 'false',
}

const headerIcons = {
    refresh: (
        <svg {...headerIconProps}>
            <path d='M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8' />
            <path d='M21 3v5h-5' />
        </svg>
    ),
    menu: (
        <svg {...headerIconProps}>
            <path d='M4 7h16' />
            <path d='M4 12h16' />
            <path d='M4 17h16' />
        </svg>
    ),
    close: (
        <svg {...headerIconProps}>
            <path d='M18 6 6 18' />
            <path d='m6 6 12 12' />
        </svg>
    ),
    chevronLeft: (
        <svg {...headerIconProps}>
            <path d='m14 18-6-6 6-6' />
        </svg>
    ),
    chevronRight: (
        <svg {...headerIconProps}>
            <path d='m10 6 6 6-6 6' />
        </svg>
    ),
    language: (
        <svg {...headerIconProps}>
            <circle cx='12' cy='12' r='10' />
            <path d='M2 12h20' />
            <path d='M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z' />
        </svg>
    ),
    sun: (
        <svg {...headerIconProps}>
            <circle cx='12' cy='12' r='4' />
            <path d='M12 2v2' />
            <path d='M12 20v2' />
            <path d='m4.93 4.93 1.41 1.41' />
            <path d='m17.66 17.66 1.41 1.41' />
            <path d='M2 12h2' />
            <path d='M20 12h2' />
            <path d='m6.34 17.66-1.41 1.41' />
            <path d='m19.07 4.93-1.41 1.41' />
        </svg>
    ),
    moon: (
        <svg {...headerIconProps}>
            <path d='M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z' />
        </svg>
    ),
    whiteTheme: (
        <svg {...headerIconProps}>
            <circle cx='12' cy='12' r='7' />
            <circle cx='12' cy='12' r='3' fill='currentColor' stroke='none' />
        </svg>
    ),
    autoTheme: (
        <svg {...headerIconProps}>
            <defs>
                <clipPath id='mainLayoutAutoThemeSunLeftHalf'>
                    <rect x='0' y='0' width='12' height='24' />
                </clipPath>
            </defs>
            <circle cx='12' cy='12' r='4' />
            <circle cx='12' cy='12' r='4' clipPath='url(#mainLayoutAutoThemeSunLeftHalf)' fill='currentColor' />
            <path d='M12 2v2' />
            <path d='M12 20v2' />
            <path d='M4.93 4.93l1.41 1.41' />
            <path d='M17.66 17.66l1.41 1.41' />
            <path d='M2 12h2' />
            <path d='M20 12h2' />
            <path d='M6.34 17.66l-1.41 1.41' />
            <path d='M19.07 4.93l-1.41 1.41' />
        </svg>
    ),
    logout: (
        <svg {...headerIconProps}>
            <path d='M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4' />
            <path d='m16 17 5-5-5-5' />
            <path d='M21 12H9' />
        </svg>
    ),
}

const THEME_CARDS: Array<{
    key: Theme
    labelKey: string
    colors: { bg: string; card: string; border: string; text: string; textMuted: string }
}> = [
    {
        key: 'auto',
        labelKey: 'theme.auto',
        colors: {
            bg: 'linear-gradient(135deg, #ffffff 0 50%, #111111 50% 100%)',
            card: 'linear-gradient(135deg, #ffffff 0 50%, #1a1a1a 50% 100%)',
            border: '#bdbdbd',
            text: '#2d2a26',
            textMuted: 'linear-gradient(135deg, #c9c9c9 0 50%, #5a5a5a 50% 100%)',
        },
    },
    {
        key: 'white',
        labelKey: 'theme.white',
        colors: {
            bg: '#ffffff',
            card: '#ffffff',
            border: '#e5e5e5',
            text: '#2d2a26',
            textMuted: '#a29c95',
        },
    },
    {
        key: 'light',
        labelKey: 'theme.light',
        colors: {
            bg: '#faf9f5',
            card: '#f0eee8',
            border: '#e3e1db',
            text: '#2d2a26',
            textMuted: '#a29c95',
        },
    },
    {
        key: 'dark',
        labelKey: 'theme.dark',
        colors: {
            bg: '#151412',
            card: '#1d1b18',
            border: '#3a3530',
            text: '#f6f4f1',
            textMuted: '#9c958d',
        },
    },
]

export function MainLayout() {
    const { t }                = useTranslation()
    const { showNotification } = useNotificationStore()
    const location             = useLocation()

    const apiBase          = useAuthStore((state) => state.apiBase)
    const connectionStatus = useAuthStore((state) => state.connectionStatus)
    const logout           = useAuthStore((state) => state.logout)

    const config      = useConfigStore((state) => state.config)
    const fetchConfig = useConfigStore((state) => state.fetchConfig)
    const clearCache  = useConfigStore((state) => state.clearCache)

    const theme       = useThemeStore((state) => state.theme)
    const setTheme    = useThemeStore((state) => state.setTheme)
    const language    = useLanguageStore((state) => state.language)
    const setLanguage = useLanguageStore((state) => state.setLanguage)

    const [sidebarOpen, setSidebarOpen]           = useState(false)
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
    const [languageMenuOpen, setLanguageMenuOpen] = useState(false)
    const [themeMenuOpen, setThemeMenuOpen]       = useState(false)
    const [brandExpanded, setBrandExpanded]       = useState(true)
    const contentRef                              = useRef<HTMLDivElement | null>(null)
    const languageMenuRef                         = useRef<HTMLDivElement | null>(null)
    const themeMenuRef                            = useRef<HTMLDivElement | null>(null)
    const brandCollapseTimer                      = useRef<ReturnType<typeof setTimeout> | null>(null)
    const headerRef                               = useRef<HTMLElement | null>(null)

    const fullBrandName            = 'CLI Proxy API Management Center'
    const abbrBrandName            = t('title.abbr')
    const isLogsPage               = location.pathname.startsWith('/logs')
    const mobileSidebarToggleLabel = sidebarOpen
                                     ? t('sidebar.toggle_collapse', { defaultValue: 'Close navigation' })
                                     : t('sidebar.toggle_expand', { defaultValue: 'Open navigation' })

    // 将顶栏高度写入 CSS 变量，确保侧栏/内容区计算一致，防止滚动时抖动
    useLayoutEffect(() => {
        const updateHeaderHeight = () => {
            const height = headerRef.current?.offsetHeight
            if (height) {
                document.documentElement.style.setProperty('--header-height', `${height}px`)
            }
        }

        updateHeaderHeight()

        const resizeObserver =
                  typeof ResizeObserver !== 'undefined' && headerRef.current ?
                  new ResizeObserver(updateHeaderHeight) :
                  null
        if (resizeObserver && headerRef.current) {
            resizeObserver.observe(headerRef.current)
        }

        window.addEventListener('resize', updateHeaderHeight)

        return () => {
            if (resizeObserver) {
                resizeObserver.disconnect()
            }
            window.removeEventListener('resize', updateHeaderHeight)
        }
    }, [])

    // 将主内容区的中心点写入 CSS 变量，供底部浮层（配置面板操作栏、提供商导航）对齐到内容区
    useLayoutEffect(() => {
        const updateContentCenter = () => {
            const el = contentRef.current
            if (!el) {
                return
            }
            const rect    = el.getBoundingClientRect()
            const centerX = rect.left + rect.width / 2
            document.documentElement.style.setProperty('--content-center-x', `${centerX}px`)
        }

        updateContentCenter()

        const resizeObserver =
                  typeof ResizeObserver !== 'undefined' && contentRef.current ?
                  new ResizeObserver(updateContentCenter) :
                  null

        if (resizeObserver && contentRef.current) {
            resizeObserver.observe(contentRef.current)
        }

        window.addEventListener('resize', updateContentCenter)

        return () => {
            if (resizeObserver) {
                resizeObserver.disconnect()
            }
            window.removeEventListener('resize', updateContentCenter)
            document.documentElement.style.removeProperty('--content-center-x')
        }
    }, [])

    // 5秒后自动收起品牌名称
    useEffect(() => {
        brandCollapseTimer.current = setTimeout(() => {
            setBrandExpanded(false)
        }, 5000)

        return () => {
            if (brandCollapseTimer.current) {
                clearTimeout(brandCollapseTimer.current)
            }
        }
    }, [])

    useEffect(() => {
        if (!languageMenuOpen) {
            return
        }

        const handlePointerDown = (event: MouseEvent) => {
            if (!languageMenuRef.current?.contains(event.target as Node)) {
                setLanguageMenuOpen(false)
            }
        }

        const handleEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setLanguageMenuOpen(false)
            }
        }

        document.addEventListener('mousedown', handlePointerDown)
        document.addEventListener('keydown', handleEscape)

        return () => {
            document.removeEventListener('mousedown', handlePointerDown)
            document.removeEventListener('keydown', handleEscape)
        }
    }, [languageMenuOpen])

    useEffect(() => {
        if (!themeMenuOpen) {
            return
        }

        const handlePointerDown = (event: MouseEvent) => {
            if (!themeMenuRef.current?.contains(event.target as Node)) {
                setThemeMenuOpen(false)
            }
        }

        const handleEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setThemeMenuOpen(false)
            }
        }

        document.addEventListener('mousedown', handlePointerDown)
        document.addEventListener('keydown', handleEscape)

        return () => {
            document.removeEventListener('mousedown', handlePointerDown)
            document.removeEventListener('keydown', handleEscape)
        }
    }, [themeMenuOpen])

    const handleBrandClick = useCallback(() => {
        if (!brandExpanded) {
            setBrandExpanded(true)
            // 点击展开后，5秒后再次收起
            if (brandCollapseTimer.current) {
                clearTimeout(brandCollapseTimer.current)
            }
            brandCollapseTimer.current = setTimeout(() => {
                setBrandExpanded(false)
            }, 5000)
        }
    }, [brandExpanded])

    const toggleLanguageMenu = useCallback(() => {
        setLanguageMenuOpen((prev) => !prev)
        setThemeMenuOpen(false)
    }, [])

    const toggleThemeMenu = useCallback(() => {
        setThemeMenuOpen((prev) => !prev)
        setLanguageMenuOpen(false)
    }, [])

    const handleThemeSelect = useCallback(
        (nextTheme: Theme) => {
            setTheme(nextTheme)
            setThemeMenuOpen(false)
        },
        [setTheme],
    )

    const handleLanguageSelect = useCallback(
        (nextLanguage: string) => {
            if (!isSupportedLanguage(nextLanguage)) {
                return
            }
            setLanguage(nextLanguage)
            setLanguageMenuOpen(false)
        },
        [setLanguage],
    )

    useEffect(() => {
        fetchConfig().catch(() => {
            // ignore initial failure; login flow会提示
        })
    }, [fetchConfig])

    // 连接状态变化时推送持久通知
    const addPersistentNotification = useNotificationStore((s) => s.addPersistentNotification)
    const prevConnectionRef         = useRef(connectionStatus)
    useEffect(() => {
        const prev                = prevConnectionRef.current
        prevConnectionRef.current = connectionStatus
        if (prev === connectionStatus) {
            return
        }
        if (connectionStatus === 'error' && prev === 'connected') {
            addPersistentNotification(t('notifications.connection_lost'), 'error', 'connection')
        } else if (connectionStatus === 'connected' && prev === 'error') {
            addPersistentNotification(t('notifications.connection_restored'), 'success', 'connection')
        }
    }, [connectionStatus, addPersistentNotification, t])

    // 页面版本检测——每 5 分钟检查服务器上的面板是否更新
    const versionNotifiedRef = useRef(false)
    useEffect(() => {
        const currentVersion = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : ''
        if (!currentVersion) {
            return
        }

        const checkVersion = async () => {
            try {
                const resp = await fetch('/management.html', { cache: 'no-cache' })
                if (!resp.ok) {
                    return
                }
                // 对比 Last-Modified 作为版本指纹
                const lastModified = resp.headers.get('last-modified') || ''
                const stored       = sessionStorage.getItem('cpa-panel-last-modified')
                if (!stored) {
                    sessionStorage.setItem('cpa-panel-last-modified', lastModified)
                    return
                }
                if (lastModified && lastModified !== stored && !versionNotifiedRef.current) {
                    versionNotifiedRef.current = true
                    addPersistentNotification(
                        t('notifications.panel_updated', {
                            defaultValue: 'A new panel version is available. Please refresh the page.',
                        }),
                        'info',
                        'version',
                    )
                }
            } catch {
                // ignore
            }
        }

        const id = setInterval(checkVersion, 5 * 60 * 1000) // 5 minutes
        return () => clearInterval(id)
    }, [addPersistentNotification, t])

    const statusClass =
              connectionStatus === 'connected'
              ? 'success'
              : connectionStatus === 'connecting'
                ? 'warning'
                : connectionStatus === 'error'
                  ? 'error'
                  : 'muted'

    const navItems      = useMemo(
        () => [
            { path: '/', label: t('nav.dashboard'), icon: sidebarIcons.dashboard },
            { path: '/config', label: t('nav.config_management'), icon: sidebarIcons.config },
            { path: '/credentials', label: t('nav.credentials'), icon: sidebarIcons.aiProviders },
            { path: '/models', label: t('nav.model_management'), icon: sidebarIcons.models },
            { path: '/plugins', label: t('nav.plugin_management'), icon: sidebarIcons.plugins },
            { path: '/usage', label: t('nav.usage_stats'), icon: sidebarIcons.usage },
            ...(config?.loggingToFile ? [{ path: '/logs', label: t('nav.logs'), icon: sidebarIcons.logs }] : []),
            { path: '/system', label: t('nav.system_info'), icon: sidebarIcons.system },
        ],
        [t, config?.loggingToFile],
    )
    const getRouteOrder = useCallback((pathname: string) => {
        const navOrder       = navItems.map((item) => item.path)
        const trimmedPath    = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname
        const normalizedPath = trimmedPath === '/dashboard' ? '/' : trimmedPath

        const credentialsIndex = navOrder.indexOf('/credentials')
        if (credentialsIndex !== -1) {
            if (normalizedPath === '/credentials') {
                return credentialsIndex
            }
            if (normalizedPath.startsWith('/credentials/')) {
                if (normalizedPath.startsWith('/credentials/gemini')) {
                    return credentialsIndex + 0.1
                }
                if (normalizedPath.startsWith('/credentials/codex')) {
                    return credentialsIndex + 0.2
                }
                if (normalizedPath.startsWith('/credentials/claude')) {
                    return credentialsIndex + 0.3
                }
                if (normalizedPath.startsWith('/credentials/vertex')) {
                    return credentialsIndex + 0.4
                }
                if (normalizedPath.startsWith('/credentials/ampcode')) {
                    return credentialsIndex + 0.5
                }
                if (normalizedPath.startsWith('/credentials/openai')) {
                    return credentialsIndex + 0.6
                }
                if (normalizedPath.startsWith('/credentials/oauth')) {
                    return credentialsIndex + 0.7
                }
                return credentialsIndex + 0.05
            }
        }

        const exactIndex = navOrder.indexOf(normalizedPath)
        if (exactIndex !== -1) {
            return exactIndex
        }
        const nestedIndex = navOrder.findIndex((path) => path !== '/' && normalizedPath.startsWith(`${path}/`))
        return nestedIndex === -1 ? null : nestedIndex
    }, [navItems])

    const getTransitionVariant = useCallback((fromPathname: string, toPathname: string) => {
        const normalize = (pathname: string) => {
            const trimmed = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname
            return trimmed === '/dashboard' ? '/' : trimmed
        }

        const from          = normalize(fromPathname)
        const to            = normalize(toPathname)
        const isCredentials = (pathname: string) => pathname === '/credentials' || pathname.startsWith('/credentials/')
        if (isCredentials(from) && isCredentials(to)) {
            return 'ios'
        }
        return 'vertical'
    }, [])

    const handleRefreshAll = async () => {
        clearCache()
        const results  = await Promise.allSettled([fetchConfig(undefined, true), triggerHeaderRefresh()])
        const rejected = results.find((result) => result.status === 'rejected')
        if (rejected && rejected.status === 'rejected') {
            const reason  = rejected.reason
            const message = typeof reason === 'string' ? reason : reason instanceof Error ? reason.message : ''
            showNotification(`${t('notification.refresh_failed')}${message ? `: ${message}` : ''}`, 'error')
            return
        }
        showNotification(t('notification.data_refreshed'), 'success')
    }

    return (
        <div className='app-shell'>
            <VersionCompatBanner />
            <header className='main-header' ref={headerRef}>
                <div className='left'>
                    <button
                        className='sidebar-toggle-header'
                        onClick={() => setSidebarCollapsed((prev) => !prev)}
                        title={
                            sidebarCollapsed
                            ? t('sidebar.expand', { defaultValue: '展开' })
                            : t('sidebar.collapse', { defaultValue: '收起' })
                        }
                    >
                        {sidebarCollapsed ? headerIcons.chevronRight : headerIcons.chevronLeft}
                    </button>
                    <Button
                        className='mobile-menu-btn'
                        variant='ghost'
                        size='sm'
                        onClick={() => setSidebarOpen((prev) => !prev)}
                        title={mobileSidebarToggleLabel}
                        aria-label={mobileSidebarToggleLabel}
                    >
                        {sidebarOpen ? headerIcons.close : headerIcons.menu}
                    </Button>
                    <img src={INLINE_LOGO_JPEG} alt='CPAMC logo' className='brand-logo' />
                    <div
                        className={`brand-header ${brandExpanded ? 'expanded' : 'collapsed'}`}
                        onClick={handleBrandClick}
                        title={brandExpanded ? undefined : fullBrandName}
                    >
                        <span className='brand-full'>{fullBrandName}</span>
                        <span className='brand-abbr'>{abbrBrandName}</span>
                    </div>
                </div>

                <div className='right'>
                    <div className='connection'>
                        <span className={`status-badge ${statusClass}`}>
                            {t(
                                connectionStatus === 'connected'
                                ? 'common.connected_status'
                                : connectionStatus === 'connecting'
                                  ? 'common.connecting_status'
                                  : 'common.disconnected_status',
                            )}
                        </span>
                        <span className='base'>{apiBase || '-'}</span>
                    </div>

                    <div className='header-actions'>
                        <Button variant='ghost' size='sm' onClick={handleRefreshAll} title={t('header.refresh_all')}>
                            {headerIcons.refresh}
                        </Button>
                        <NotificationCenter />
                        <div className={`language-menu ${languageMenuOpen ? 'open' : ''}`} ref={languageMenuRef}>
                            <Button
                                variant='ghost'
                                size='sm'
                                onClick={toggleLanguageMenu}
                                title={t('language.switch')}
                                aria-label={t('language.switch')}
                                aria-haspopup='menu'
                                aria-expanded={languageMenuOpen}
                            >
                                {headerIcons.language}
                            </Button>
                            {languageMenuOpen && (
                                <div
                                    className='notification entering language-menu-popover'
                                    role='menu'
                                    aria-label={t('language.switch')}
                                >
                                    {LANGUAGE_ORDER.map((lang) => (
                                        <button
                                            key={lang}
                                            type='button'
                                            className={`language-menu-option ${language === lang ? 'active' : ''}`}
                                            onClick={() => handleLanguageSelect(lang)}
                                            role='menuitemradio'
                                            aria-checked={language === lang}
                                        >
                                            <span>{t(LANGUAGE_LABEL_KEYS[lang])}</span>
                                            {language === lang ? <span className='language-menu-check'>✓</span> : null}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                        <div className={`theme-menu ${themeMenuOpen ? 'open' : ''}`} ref={themeMenuRef}>
                            <Button
                                variant='ghost'
                                size='sm'
                                onClick={toggleThemeMenu}
                                title={t('theme.switch')}
                                aria-label={t('theme.switch')}
                                aria-haspopup='menu'
                                aria-expanded={themeMenuOpen}
                            >
                                {theme === 'auto'
                                 ? headerIcons.autoTheme
                                 : theme === 'dark'
                                   ? headerIcons.moon
                                   : theme === 'white'
                                     ? headerIcons.whiteTheme
                                     : headerIcons.sun}
                            </Button>
                            {themeMenuOpen && (
                                <div
                                    className='notification entering theme-menu-popover'
                                    role='menu'
                                    aria-label={t('theme.switch')}
                                >
                                    {THEME_CARDS.map((tc) => (
                                        <button
                                            key={tc.key}
                                            type='button'
                                            className={`theme-card ${theme === tc.key ? 'active' : ''}`}
                                            onClick={() => handleThemeSelect(tc.key)}
                                            role='menuitemradio'
                                            aria-checked={theme === tc.key}
                                        >
                                            <div
                                                className='theme-card-preview'
                                                style={{
                                                    background: tc.colors.bg,
                                                    border: `1px solid ${tc.colors.border}`,
                                                }}
                                            >
                                                <div
                                                    className='theme-card-header'
                                                    style={{
                                                        background: tc.colors.card,
                                                        borderBottom: `1px solid ${tc.colors.border}`,
                                                    }}
                                                />
                                                <div className='theme-card-body'>
                                                    <div
                                                        className='theme-card-sidebar'
                                                        style={{
                                                            background: tc.colors.card,
                                                            borderRight: `1px solid ${tc.colors.border}`,
                                                        }}
                                                    />
                                                    <div
                                                        className='theme-card-content'
                                                        style={{ background: tc.colors.bg }}
                                                    >
                                                        <div
                                                            className='theme-card-line'
                                                            style={{ background: tc.colors.textMuted }}
                                                        />
                                                        <div
                                                            className='theme-card-line short'
                                                            style={{ background: tc.colors.textMuted }}
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                            <span className='theme-card-label'>{t(tc.labelKey)}</span>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                        <Button variant='ghost' size='sm' onClick={logout} title={t('header.logout')}>
                            {headerIcons.logout}
                        </Button>
                    </div>
                </div>
            </header>

            <div className='main-body'>
                <button
                    type='button'
                    className={`sidebar-backdrop ${sidebarOpen ? 'visible' : ''}`}
                    onClick={() => setSidebarOpen(false)}
                    aria-label={t('common.close')}
                    aria-hidden={!sidebarOpen}
                    tabIndex={sidebarOpen ? 0 : -1}
                />

                <aside className={`sidebar ${sidebarOpen ? 'open' : ''} ${sidebarCollapsed ? 'collapsed' : ''}`}>
                    <div className='nav-section'>
                        {navItems.map((item) => (
                            <NavLink
                                key={item.path}
                                to={item.path}
                                className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                                onClick={() => setSidebarOpen(false)}
                                title={sidebarCollapsed ? item.label : undefined}
                            >
                                <span className='nav-icon'>{item.icon}</span>
                                {!sidebarCollapsed && <span className='nav-label'>{item.label}</span>}
                            </NavLink>
                        ))}
                    </div>
                </aside>

                <div className={`content${isLogsPage ? ' content-logs' : ''}`} ref={contentRef}>
                    <main className={`main-content${isLogsPage ? ' main-content-logs' : ''}`}>
                        <PageTransition
                            render={(location) => <MainRoutes location={location} />}
                            getRouteOrder={getRouteOrder}
                            getTransitionVariant={getTransitionVariant}
                            scrollContainerRef={contentRef}
                        />
                    </main>
                </div>
            </div>
        </div>
    )
}
