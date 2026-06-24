import {INLINE_LOGO_JPEG} from '@/assets/logoInline'
import {Button} from '@/components/ui/Button'
import {IconEye, IconEyeOff} from '@/components/ui/icons'
import {Input} from '@/components/ui/Input'
import {Select} from '@/components/ui/Select'
import {SelectionCheckbox} from '@/components/ui/SelectionCheckbox'
import {isSecureStorageProtected, secureStorage} from '@/services/storage/secureStorage'
import {useAuthStore, useLanguageStore, useNotificationStore} from '@/stores'
import type {ApiError} from '@/types'
import {detectApiBaseFromLocation, normalizeApiBase, resolveApiBase} from '@/utils/connection'
import {LANGUAGE_LABEL_KEYS, LANGUAGE_ORDER} from '@/utils/constants'
import {isEncodedStorageValue} from '@/utils/encryption'
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

function getLocalizedErrorMessage(error: unknown, t: (key: string) => string): string {
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
    const { t }                  = useTranslation()
    const navigate               = useNavigate()
    const location               = useLocation()
    const { showNotification }   = useNotificationStore()
    const language               = useLanguageStore((state) => state.language)
    const setLanguage            = useLanguageStore((state) => state.setLanguage)
    const isAuthenticated        = useAuthStore((state) => state.isAuthenticated)
    const login                  = useAuthStore((state) => state.login)
    const restoreSession         = useAuthStore((state) => state.restoreSession)
    const storedBase             = useAuthStore((state) => state.apiBase)
    const storedKey              = useAuthStore((state) => state.managementKey)
    const storedRememberPassword = useAuthStore((state) => state.rememberPassword)

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
        const init = async () => {
            let autoLoggedIn = false
            try {
                autoLoggedIn        = await restoreSession()
                const restoredState = useAuthStore.getState()
                if (autoLoggedIn) {
                    if (restoredState.storageRestoreFailed) {
                        showNotification(t('login.storage_restore_failed'), 'warning')
                        useAuthStore.setState({ storageRestoreFailed: false })
                    }
                    setAutoLoginSuccess(true)
                    // 延迟跳转，让用户看到成功动画
                    setTimeout(() => {
                        const redirect = (location.state as RedirectState | null)?.from?.pathname || '/'
                        navigate(redirect, { replace: true })
                    }, 1500)
                    return
                }

                const restoredBase = resolveApiBase(restoredState.apiBase, storedBase, detectedBase)
                const restoredKey  = [restoredState.managementKey, storedKey].find(
                    (key) => key && !isEncodedStorageValue(key),
                ) || ''
                setApiBase(restoredBase || detectedBase)
                setManagementKey(restoredKey)
                setRememberPassword(restoredState.rememberPassword || storedRememberPassword || Boolean(restoredKey))
                let invalidStoredAuth = false
                const authRaw         = await secureStorage.getItem<string>('cli-proxy-auth', {
                    encrypt: true,
                    persistent: false,
                    onInvalidEncryptedValue: () => {
                        invalidStoredAuth = true
                    },
                })
                if (invalidStoredAuth || restoredState.storageRestoreFailed) {
                    setStorageWarning(t('login.storage_restore_failed'))
                } else if (authRaw && insecureStorage) {
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

    const handleSubmit = useCallback(async () => {
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
                            rememberPassword,
                        })
            setStorageWarning(insecureStorage ? t('login.storage_warning') : '')
            showNotification(t('common.connected_status'), 'success')
            navigate('/', { replace: true })
        } catch (err: unknown) {
            const message = getLocalizedErrorMessage(err, t)
            setError(message)
            showNotification(`${t('notification.login_failed')}: ${message}`, 'error')
        } finally {
            setLoading(false)
        }
    }, [apiBase, detectedBase, insecureStorage, login, managementKey, navigate, rememberPassword, showNotification, t])

    const handleSubmitKeyDown = useCallback(
        (event: React.KeyboardEvent) => {
            if (event.key === 'Enter' && !loading) {
                event.preventDefault()
                void handleSubmit()
            }
        },
        [loading, handleSubmit],
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
                                     checked={rememberPassword}
                                     onChange={setRememberPassword}
                                     ariaLabel={t('login.remember_password_label')}
                                     label={t('login.remember_password_label')}
                                     labelClassName={styles.toggleLabel}
                                 />
                             </div>

                             {storageWarning && <div className={styles.warningBox}>{storageWarning}</div>}

                             <Button fullWidth onClick={handleSubmit} loading={loading}>
                                 {loading ? t('login.submitting') : t('login.submit_button')}
                             </Button>

                             {error && <div className={styles.errorBox}>{error}</div>}
                         </div>
                     </div>
                 )}
            </div>
        </div>
    )
}
