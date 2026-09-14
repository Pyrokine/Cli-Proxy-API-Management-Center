import {INLINE_LOGO_JPEG} from '@/assets/logoInline'
import {Button} from '@/components/ui/Button'
import {IconEye, IconEyeOff} from '@/components/ui/icons'
import {Input} from '@/components/ui/Input'
import {Select} from '@/components/ui/Select'
import {SelectionCheckbox} from '@/components/ui/SelectionCheckbox'
import {rateLimitsApi} from '@/services/api/rateLimits'
import {isSecureStorageProtected} from '@/services/storage/secureStorage'
import {useAuthStore, useLanguageStore, useNotificationStore} from '@/stores'
import type {ApiError} from '@/types'
import {detectApiBaseFromLocation, normalizeApiBase, resolveApiBase} from '@/utils/connection'
import {LANGUAGE_LABEL_KEYS, LANGUAGE_ORDER} from '@/utils/constants'
import {isSupportedLanguage} from '@/utils/language'
import React, {useCallback, useEffect, useMemo, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {Navigate, useLocation, useNavigate} from 'react-router-dom'
import styles from './LoginPage.module.scss'

/**
 * 将 API 错误转换为本地化的用户友好消息
 */
type RedirectState = { from?: { pathname?: string } }

const isErrorRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value)

const firstTextValue = (...values: unknown[]) => {
    for (const value of values) {
        if (typeof value === 'string' || typeof value === 'number') {
            const text = String(value).trim()
            if (text) {
                return text
            }
        }
    }
    return ''
}

const readBackendErrorDetail = (value: unknown): string => {
    const direct = firstTextValue(value)
    if (direct) {
        return direct
    }
    if (!isErrorRecord(value)) {
        return ''
    }

    const errorValue = value.error
    if (isErrorRecord(errorValue)) {
        const nested = firstTextValue(errorValue.message, errorValue.details, errorValue.detail, errorValue.reason)
        if (nested) {
            return nested
        }
    }

    return firstTextValue(errorValue, value.message, value.details, value.detail, value.reason)
}

const appendBackendDetail = (baseMessage: string, detail: string) => {
    if (!detail || baseMessage.includes(detail)) {
        return baseMessage
    }
    return `${baseMessage}: ${detail}`
}

type Translate = (key: string, options?: Record<string, unknown>) => string

const rateLimitDeadlineFromError = (error: unknown): number | null => {
    const apiError = error as Partial<ApiError>
    if (apiError.status !== 429) {
        return null
    }
    const explicitDeadline = typeof apiError.rateLimitUntil === 'string' ?
                             Date.parse(apiError.rateLimitUntil) :
                             Number.NaN
    if (Number.isFinite(explicitDeadline) && explicitDeadline > Date.now()) {
        return explicitDeadline
    }
    if (typeof apiError.retryAfterSeconds === 'number' && apiError.retryAfterSeconds > 0) {
        return Date.now() + apiError.retryAfterSeconds * 1000
    }
    return null
}

function getLocalizedErrorMessage(error: unknown, t: Translate): string {
    const apiError      = error as Partial<ApiError>
    const status        = typeof apiError.status === 'number' ? apiError.status : undefined
    const code          = typeof apiError.code === 'string' ? apiError.code : undefined
    const message       =
              error instanceof Error
              ? error.message
              : typeof apiError.message === 'string'
                ? apiError.message
                : typeof error === 'string'
                  ? error
                  : ''
    const backendDetail = readBackendErrorDetail(apiError.details) || readBackendErrorDetail(apiError.data) || message

    if (status === 429) {
        return t('login.error_rate_limited')
    }
    if (status === 401) {
        return appendBackendDetail(t('login.error_unauthorized'), backendDetail)
    }
    if (status === 403) {
        return appendBackendDetail(t('login.error_forbidden'), backendDetail)
    }
    if (status === 404) {
        return appendBackendDetail(t('login.error_not_found'), backendDetail)
    }
    if (status && status >= 500) {
        return appendBackendDetail(t('login.error_server'), backendDetail)
    }

    if (code === 'ECONNABORTED' || message.toLowerCase().includes('timeout')) {
        return appendBackendDetail(t('login.error_timeout'), backendDetail)
    }
    if (code === 'ERR_NETWORK' || message.toLowerCase().includes('network error')) {
        return appendBackendDetail(t('login.error_network'), backendDetail)
    }
    if (code === 'ERR_CERT_AUTHORITY_INVALID' || message.toLowerCase().includes('certificate')) {
        return appendBackendDetail(t('login.error_ssl'), backendDetail)
    }

    if (message.toLowerCase().includes('cors') || message.toLowerCase().includes('cross-origin')) {
        return appendBackendDetail(t('login.error_cors'), backendDetail)
    }

    return appendBackendDetail(t('login.error_invalid'), backendDetail)
}

export function LoginPage() {
    const { t }                                           = useTranslation()
    const navigate                                        = useNavigate()
    const location                                        = useLocation()
    const { showNotification, addPersistentNotification } = useNotificationStore()
    const language                                        = useLanguageStore((state) => state.language)
    const setLanguage                                     = useLanguageStore((state) => state.setLanguage)
    const isAuthenticated                                 = useAuthStore((state) => state.isAuthenticated)
    const login                                           = useAuthStore((state) => state.login)
    const restoreSession                                  = useAuthStore((state) => state.restoreSession)
    const storedBase                                      = useAuthStore((state) => state.apiBase)
    const storedKey                                       = useAuthStore((state) => state.managementKey)
    const storedRememberPassword                          = useAuthStore((state) => state.rememberPassword)

    const [apiBase, setApiBase]                   = useState('')
    const [managementKey, setManagementKey]       = useState('')
    const [showCustomBase, setShowCustomBase]     = useState(false)
    const [showKey, setShowKey]                   = useState(false)
    const [rememberPassword, setRememberPassword] = useState(false)
    const [loading, setLoading]                   = useState(false)
    const [autoLoading, setAutoLoading]           = useState(true)
    const [autoLoginSuccess, setAutoLoginSuccess] = useState(false)
    const [error, setError]                       = useState('')
    const [storageWarning, setStorageWarning]     = useState('')
    const [rateLimitUntil, setRateLimitUntil]     = useState<number | null>(null)
    const [clock, setClock]                       = useState(() => Date.now())

    const rateLimitRemaining = rateLimitUntil === null ? 0 : Math.max(0, Math.ceil((rateLimitUntil - clock) / 1000))
    const displayedError     = rateLimitRemaining > 0
                               ? t('login.error_rate_limited_countdown', { count: rateLimitRemaining })
                               : error
    const applyLoginError    = useCallback(
        (nextError: unknown) => {
            const deadline = rateLimitDeadlineFromError(nextError)
            setRateLimitUntil(deadline)
            setClock(Date.now())
            setError(getLocalizedErrorMessage(nextError, t))
            return deadline
        },
        [t],
    )

    const detectedBase         = useMemo(() => detectApiBaseFromLocation(), [])
    const insecureStorage      = useMemo(() => !isSecureStorageProtected(), [])
    const languageOptions      = useMemo(
        () =>
            LANGUAGE_ORDER.map((lang) => ({
                value: lang,
                label: t(LANGUAGE_LABEL_KEYS[lang]),
            })),
        [t],
    )
    const handleLanguageChange = useCallback(
        (selectedLanguage: string) => {
            if (!isSupportedLanguage(selectedLanguage)) {
                return
            }
            setLanguage(selectedLanguage)
        },
        [setLanguage],
    )

    useEffect(() => {
        if (rateLimitUntil === null) {
            return
        }
        const tick = () => {
            const now = Date.now()
            setClock(now)
            if (now >= rateLimitUntil) {
                setRateLimitUntil(null)
                setError('')
            }
        }
        tick()
        const intervalID = window.setInterval(tick, 1000)
        return () => window.clearInterval(intervalID)
    }, [rateLimitUntil])

    useEffect(() => {
        const init = async () => {
            let autoLoggedIn = false
            try {
                autoLoggedIn        = await restoreSession()
                const restoredState = useAuthStore.getState()
                if (autoLoggedIn) {
                    if (restoredState.storageClearFailed) {
                        showNotification(t('login.storage_clear_failed'), 'warning')
                    } else if (restoredState.storageRestoreFailed) {
                        showNotification(t('login.storage_restore_failed'), 'warning')
                        useAuthStore.setState({ storageRestoreFailed: false })
                    } else if (restoredState.storagePersistenceFailed) {
                        showNotification(t('login.storage_warning'), 'warning')
                    }
                    setAutoLoginSuccess(true)
                    // 延迟跳转，让用户看到成功动画
                    setTimeout(() => {
                        const redirect = (location.state as RedirectState | null)?.from?.pathname || '/'
                        navigate(redirect, { replace: true })
                    }, 1500)
                    return
                }

                if (restoredState.sessionRestoreError) {
                    applyLoginError(restoredState.sessionRestoreError)
                }
                const restoredBase = resolveApiBase(restoredState.apiBase, storedBase, detectedBase)
                const restoredKey  = restoredState.managementKey || storedKey || ''
                setApiBase(restoredBase || detectedBase)
                setManagementKey(restoredKey)
                setRememberPassword(
                    !insecureStorage &&
                    (restoredState.rememberPassword || storedRememberPassword),
                )
                if (restoredState.storageClearFailed) {
                    setStorageWarning(t('login.storage_clear_failed'))
                } else if (restoredState.storageRestoreFailed) {
                    setStorageWarning(t('login.storage_restore_failed'))
                } else if (insecureStorage || restoredState.storagePersistenceFailed) {
                    setStorageWarning(t('login.storage_warning'))
                }
            } finally {
                if (!autoLoggedIn) {
                    setAutoLoading(false)
                }
            }
        }

        void init()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const handleSubmit = useCallback(
        async () => {
            if (rateLimitRemaining > 0) {
                return
            }
            if (!managementKey.trim()) {
                setError(t('login.error_required'))
                return
            }

            const baseToUse = normalizeApiBase(apiBase) || detectedBase
            setLoading(true)
            setError('')
            try {
                await login({
                                apiBase: baseToUse,
                                managementKey: managementKey.trim(),
                                rememberPassword: rememberPassword && !insecureStorage,
                            })
                const authState                = useAuthStore.getState()
                const storagePersistenceFailed = authState.storagePersistenceFailed
                const storageClearFailed       = authState.storageClearFailed
                const storageUnavailable       = insecureStorage || storagePersistenceFailed
                const storageMessage           = storageClearFailed ?
                                                 t('login.storage_clear_failed') :
                                                 storageUnavailable ? t('login.storage_warning') : ''
                setRememberPassword(rememberPassword && !storageUnavailable)
                setStorageWarning(storageMessage)
                const rateLimitStatus    = await rateLimitsApi.getStatus({ consumeFailedLoginNotices: true })
                                                              .catch((error: unknown) => {
                                                                  if ((error as Partial<ApiError>).status === 401) {
                                                                      throw error
                                                                  }
                                                                  return null
                                                              })
                const failedLoginNotices = rateLimitStatus?.failed_login_notices ?? []
                const failedLoginCount   = failedLoginNotices.reduce(
                    (sum, item) => sum + Math.max(0, item.count || 0),
                    0,
                )
                if (failedLoginCount > 0) {
                    const latestFailure = failedLoginNotices
                        .map((item) => Date.parse(item.last_failure_at || ''))
                        .filter((time) => Number.isFinite(time))
                        .sort((a, b) => b - a)[0]
                    addPersistentNotification(
                        t('notifications.security_failed_login_notice', {
                            count: failedLoginCount,
                            sources: failedLoginNotices.length,
                            latest: latestFailure ? new Date(latestFailure).toLocaleString() : '-',
                        }),
                        'warning',
                        'security',
                        { dedupeKey: `security:failed-login:${failedLoginCount}:${latestFailure || 0}` },
                    )
                }
                showNotification(t('common.connected_status'), 'success')
                if (storageMessage) {
                    showNotification(storageMessage, 'warning')
                }
                navigate('/', { replace: true })
            } catch (err: unknown) {
                const deadline = applyLoginError(err)
                const message  = getLocalizedErrorMessage(err, t)
                const apiError = err as Partial<ApiError>
                if (useAuthStore.getState().storageClearFailed) {
                    const storageMessage = t('login.storage_clear_failed')
                    setStorageWarning(storageMessage)
                    showNotification(storageMessage, 'warning')
                }
                showNotification(`${t('notification.login_failed')}: ${message}`, 'error')
                addPersistentNotification(
                    apiError.status === 429
                    ? t('notifications.security_login_rate_limited', {
                        count: apiError.retryAfterSeconds ?? 0,
                    })
                    : t('notifications.security_login_failed', {
                        defaultValue: '登录失败，请检查管理密钥',
                    }),
                    'error',
                    'security',
                    {
                        dedupeKey: apiError.status === 429
                                   ? `security:login-rate-limited:${deadline ?? 0}`
                                   : 'security:login-failed:current',
                    },
                )
            } finally {
                setLoading(false)
            }
        },
        [
            addPersistentNotification,
            apiBase,
            applyLoginError,
            detectedBase,
            insecureStorage,
            login,
            managementKey,
            navigate,
            rateLimitRemaining,
            rememberPassword,
            showNotification,
            t,
        ],
    )

    const handleSubmitKeyDown = useCallback(
        (event: React.KeyboardEvent) => {
            if (event.key === 'Enter' && !loading && rateLimitRemaining === 0) {
                event.preventDefault()
                void handleSubmit()
            }
        },
        [loading, rateLimitRemaining, handleSubmit],
    )

    if (isAuthenticated && !autoLoading && !autoLoginSuccess) {
        const redirect = (location.state as RedirectState | null)?.from?.pathname || '/'
        return <Navigate to={redirect} replace />
    }

    // 显示启动动画（自动登录中或自动登录成功）
    const showSplash = autoLoading || autoLoginSuccess

    return (
        <div className={styles.container}>
            {/* 左侧品牌展示区 */}
            <div className={styles.brandPanel}>
                <div className={styles.brandContent}>
                    <span className={styles.brandWord}>CLI</span>
                    <span className={styles.brandWord}>PROXY</span>
                    <span className={styles.brandWord}>API</span>
                </div>
            </div>

            {/* 右侧功能交互区 */}
            <div className={styles.formPanel}>
                {showSplash ? (
                    /* 启动动画 */
                    <div className={styles.splashContent}>
                        <img src={INLINE_LOGO_JPEG} alt='CPAMC' className={styles.splashLogo} />
                        <h1 className={styles.splashTitle}>{t('splash.title')}</h1>
                        <p className={styles.splashSubtitle}>{t('splash.subtitle')}</p>
                        <div className={styles.splashLoader}>
                            <div className={styles.splashLoaderBar} />
                        </div>
                    </div>
                ) : (
                     /* 登录表单 */
                     <div className={styles.formContent}>
                         {/* Logo */}
                         <img src={INLINE_LOGO_JPEG} alt='Logo' className={styles.logo} />

                         {/* 登录表单卡片 */}
                         <div className={styles.loginCard}>
                             <div className={styles.loginHeader}>
                                 <div className={styles.titleRow}>
                                     <div className={styles.title}>{t('title.login')}</div>
                                     <Select
                                         className={styles.languageSelect}
                                         value={language}
                                         options={languageOptions}
                                         onChange={handleLanguageChange}
                                         fullWidth={false}
                                         ariaLabel={t('language.switch')}
                                     />
                                 </div>
                                 <div className={styles.subtitle}>{t('login.subtitle')}</div>
                             </div>

                             <div className={styles.connectionBox}>
                                 <div className={styles.label}>{t('login.connection_current')}</div>
                                 <div className={styles.value}>{apiBase || detectedBase}</div>
                                 <div className={styles.hint}>{t('login.connection_auto_hint')}</div>
                             </div>

                             <div className={styles.toggleAdvanced}>
                                 <SelectionCheckbox
                                     checked={showCustomBase}
                                     onChange={setShowCustomBase}
                                     ariaLabel={t('login.custom_connection_label')}
                                     label={t('login.custom_connection_label')}
                                     labelClassName={styles.toggleLabel}
                                 />
                             </div>

                             {showCustomBase && (
                                 <Input
                                     label={t('login.custom_connection_label')}
                                     placeholder={t('login.custom_connection_placeholder')}
                                     value={apiBase}
                                     onChange={(e) => setApiBase(e.target.value)}
                                     hint={t('login.custom_connection_hint')}
                                 />
                             )}

                             <Input
                                 autoFocus
                                 label={t('login.management_key_label')}
                                 placeholder={t('login.management_key_placeholder')}
                                 type={showKey ? 'text' : 'password'}
                                 value={managementKey}
                                 onChange={(e) => setManagementKey(e.target.value)}
                                 onKeyDown={handleSubmitKeyDown}
                                 rightElement={
                                     <button
                                         type='button'
                                         className='btn btn-ghost btn-sm'
                                         onClick={() => setShowKey((prev) => !prev)}
                                         aria-label={
                                             showKey
                                             ? t('login.hide_key', { defaultValue: '隐藏密钥' })
                                             : t('login.show_key', { defaultValue: '显示密钥' })
                                         }
                                         title={
                                             showKey
                                             ? t('login.hide_key', { defaultValue: '隐藏密钥' })
                                             : t('login.show_key', { defaultValue: '显示密钥' })
                                         }
                                     >
                                         {showKey ? <IconEyeOff size={16} /> : <IconEye size={16} />}
                                     </button>
                                 }
                             />

                             <div className={styles.toggleAdvanced}>
                                 <SelectionCheckbox
                                     checked={!insecureStorage && rememberPassword}
                                     onChange={setRememberPassword}
                                     ariaLabel={t('login.remember_password_label')}
                                     label={t('login.remember_password_label')}
                                     labelClassName={styles.toggleLabel}
                                     disabled={insecureStorage}
                                 />
                             </div>

                             {storageWarning && <div className={styles.warningBox}>{storageWarning}</div>}

                             <Button
                                 fullWidth
                                 onClick={handleSubmit}
                                 loading={loading}
                                 disabled={rateLimitRemaining > 0}
                             >
                                 {loading ? t('login.submitting') : t('login.submit_button')}
                             </Button>

                             {displayedError && (
                                 <div className={styles.errorBox} aria-live='polite'>
                                     {displayedError}
                                 </div>
                             )}
                         </div>
                     </div>
                 )}
            </div>
        </div>
    )
}
