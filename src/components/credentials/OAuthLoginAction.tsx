import {Button} from '@/components/ui/Button'
import {IconCheck, IconCopy, IconExternalLink, IconX} from '@/components/ui/icons'
import {Input} from '@/components/ui/Input'
import {apiClient} from '@/services/api/client'
import {oauthApi, type OAuthProvider} from '@/services/api/oauth'
import {useAuthStore} from '@/stores/useAuthStore'
import {useNotificationStore} from '@/stores/useNotificationStore'
import {copyToClipboard} from '@/utils/clipboard'
import {safeExternalUrl} from '@/utils/validation'
import {type ChangeEvent, useCallback, useEffect, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {validateDevinCallback} from './devinOAuth'
import {createOAuthAttempts, shouldFinalizeOAuthAttempt, type OAuthAttempt} from './oauthAttempts'
import styles from './OAuthLoginAction.module.scss'

const POLL_INTERVAL                       = 3000
const CALLBACK_SUPPORTED: OAuthProvider[] = ['codex', 'anthropic', 'antigravity', 'gemini-cli', 'xai', 'devin']
const XAI_CALLBACK_URL                    = 'http://127.0.0.1:56121/callback'

function generateNonce(): string {
    const bytes = new Uint8Array(16)
    crypto.getRandomValues(bytes)
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

function isAbsoluteUrl(value: string): boolean {
    try {
        const url = new URL(value)
        return url.protocol === 'http:' || url.protocol === 'https:'
    } catch {
        return false
    }
}

function readQueryLikeCallbackInput(value: string): URLSearchParams | null {
    const trimmed    = value.trim()
    const queryStart = trimmed.indexOf('?')
    const hashStart  = trimmed.indexOf('#')
    const start = queryStart >= 0 ? queryStart + 1 : hashStart >= 0 ? hashStart + 1 : 0
    const params = new URLSearchParams(trimmed.slice(start))
    return params.has('code') || params.has('state') || params.has('error') ? params : null
}

function extractDisplayedXaiCode(value: string): string {
    const trimmed   = value.trim()
    const codeMatch = trimmed.match(/\bcode\s*[:=]\s*(?<code>[^\s&]+)/i)
    return (codeMatch?.groups?.code ?? trimmed).trim()
}

function buildXaiCallbackUrl(input: string, state?: string): string | null {
    const trimmed = input.trim()
    if (!trimmed) {
        return null
    }
    if (isAbsoluteUrl(trimmed)) {
        return trimmed
    }

    const params = readQueryLikeCallbackInput(trimmed)
    if (params) {
        const code             = params.get('code')?.trim()
        const error            = params.get('error')?.trim()
        const errorDescription = params.get('error_description')?.trim()
        const callbackState    = params.get('state')?.trim() || state?.trim()
        if (!callbackState) {
            return null
        }

        const callbackUrl = new URL(XAI_CALLBACK_URL)
        callbackUrl.searchParams.set('state', callbackState)
        if (code) {
            callbackUrl.searchParams.set('code', code)
        }
        if (error) {
            callbackUrl.searchParams.set('error', error)
        }
        if (errorDescription) {
            callbackUrl.searchParams.set('error_description', errorDescription)
        }
        return callbackUrl.toString()
    }

    const code          = extractDisplayedXaiCode(trimmed)
    const callbackState = state?.trim()
    if (!code || !callbackState) {
        return null
    }

    const callbackUrl = new URL(XAI_CALLBACK_URL)
    callbackUrl.searchParams.set('code', code)
    callbackUrl.searchParams.set('state', callbackState)
    return callbackUrl.toString()
}

function resolveCallbackUrl(provider: OAuthProvider, input: string, state?: string): string | null {
    if (provider !== 'xai') {
        return input.trim()
    }
    return buildXaiCallbackUrl(input, state)
}

interface OAuthLoginActionProps {
    provider: OAuthProvider
    plugin?: boolean
    disableControls: boolean
    onSuccess: () => void
    onCancel: () => void
}

export function OAuthLoginAction({ provider, plugin = false, disableControls, onSuccess, onCancel }: OAuthLoginActionProps) {
    const { t }                                       = useTranslation()
    const showNotification                           = useNotificationStore((state) => state.showNotification)
    const [url, setUrl]                               = useState('')
    const [userCode, setUserCode]                     = useState('')
    const [status, setStatus]                         = useState<'idle' | 'starting' | 'waiting' | 'success' | 'error'>(
        'idle')
    const [error, setError]                           = useState('')
    const [projectId, setProjectId]                   = useState('')
    const [callbackUrl, setCallbackUrl]               = useState('')
    const [callbackSubmitting, setCallbackSubmitting] = useState(false)
    const [callbackAccepted, setCallbackAccepted]     = useState(false)
    const [oauthState, setOauthState]                 = useState('')
    const [cancelSubmitting, setCancelSubmitting]     = useState(false)
    const nonceRef                                    = useRef('')
    const attemptsRef                                 = useRef(createOAuthAttempts({
        setTimeout: (callback, delay) => window.setTimeout(callback, delay),
        clearTimeout: (timer) => window.clearTimeout(timer),
        getGeneration: () => apiClient.getAuthGeneration(),
    }))

    const needsProjectId   = !plugin && provider === 'gemini-cli'
    const supportsCallback = plugin || CALLBACK_SUPPORTED.includes(provider)

    const handleCopy = useCallback(async (value: string) => {
        const generation = apiClient.getAuthGeneration()
        const copied = await copyToClipboard(value)
        if (generation === apiClient.getAuthGeneration()) {
            showNotification(t(copied ? 'common.copied' : 'auth_login.copy_failed'), copied ? 'success' : 'error')
        }
    }, [showNotification, t])

    useEffect(() => {
        const attempts     = attemptsRef.current
        let authGeneration = apiClient.getAuthGeneration()
        const unsubscribe  = useAuthStore.subscribe((current, previous) => {
            const nextGeneration = apiClient.getAuthGeneration()
            if (
                nextGeneration === authGeneration &&
                current.apiBase === previous.apiBase &&
                current.managementKey === previous.managementKey &&
                current.isAuthenticated === previous.isAuthenticated
            ) {
                return
            }
            authGeneration = nextGeneration
            attempts.invalidateAll()
            nonceRef.current = ''
            setUrl('')
            setUserCode('')
            setStatus('idle')
            setError('')
            setProjectId('')
            setCallbackUrl('')
            setCallbackSubmitting(false)
            setCallbackAccepted(false)
            setOauthState('')
            setCancelSubmitting(false)
        })
        return () => {
            unsubscribe()
            attempts.invalidateAll()
        }
    }, [])

    const startPolling = useCallback((stateValue: string, nonce: string, attempt: OAuthAttempt) => {
        attempt.poll(
            () => oauthApi.getAuthStatus(stateValue, nonce, attempt.signal),
            (result) => {
                if (result.status === 'ok') {
                    attempt.invalidate()
                    nonceRef.current = ''
                    setOauthState('')
                    setUserCode('')
                    setStatus('success')
                    onSuccess()
                    return false
                }
                if (result.status === 'error') {
                    if (shouldFinalizeOAuthAttempt(result)) {
                        attempt.invalidate()
                        nonceRef.current = ''
                        setOauthState('')
                    }
                    setStatus('error')
                    setError(result.error || t('credentials.oauth_error'))
                    return false
                }
                return true
            },
            (pollError) => {
                setStatus('error')
                setError(pollError instanceof Error ? pollError.message : t('credentials.oauth_error'))
            },
            POLL_INTERVAL,
        )
    }, [onSuccess, t])

    const startAuth = useCallback(async () => {
        const attempt  = attemptsRef.current.begin(provider)
        const nonce    = generateNonce()
        nonceRef.current = nonce
        setCallbackAccepted(false)
        setCancelSubmitting(false)
        setOauthState('')
        setUserCode('')
        setStatus('starting')
        setError('')
        try {
            const response = await oauthApi.startAuth(provider, {
                ...(plugin ? {plugin: true} : {}),
                ...(needsProjectId && projectId ? { projectId } : {}),
                nonce,
                signal: attempt.signal,
            })
            if (!attempt.isCurrent()) {
                return
            }
            const authUrl = safeExternalUrl(response.url)
            if (!authUrl) {
                attempt.invalidate()
                nonceRef.current = ''
                setError('Invalid OAuth URL received from server')
                setStatus('error')
                return
            }
            if (!response.state?.trim()) {
                attempt.invalidate()
                nonceRef.current = ''
                setError(t('auth_login.missing_state'))
                setStatus('error')
                return
            }

            const stateValue = response.state.trim()
            setUrl(response.url)
            setUserCode(response.user_code?.trim() ?? '')
            setOauthState(stateValue)
            setStatus('waiting')
            window.open(authUrl, '_blank', 'noopener,noreferrer')
            startPolling(stateValue, nonce, attempt)
        } catch (err) {
            if (!attempt.isCurrent()) {
                return
            }
            attempt.invalidate()
            nonceRef.current = ''
            setStatus('error')
            setError(err instanceof Error ? err.message : t('credentials.oauth_error'))
        }
    }, [provider, plugin, projectId, needsProjectId, startPolling, t])

    const submitCallback = useCallback(async () => {
        const attempt = attemptsRef.current.get(provider)
        if (!attempt?.isCurrent()) {
            return
        }
        if (!callbackUrl.trim()) {
            setError(t(!plugin && provider === 'xai' ? 'auth_login.xai_callback_required' : 'auth_login.oauth_callback_required'))
            return
        }
        if (!plugin && provider === 'devin') {
            const callbackError = validateDevinCallback(callbackUrl, oauthState)
            if (callbackError) {
                setError(t(`auth_login.devin_callback_${callbackError}`))
                return
            }
        }
        const redirectUrl = plugin ? callbackUrl.trim() : resolveCallbackUrl(provider, callbackUrl, oauthState)
        if (!redirectUrl) {
            setError(t(!plugin && provider === 'xai' ? 'auth_login.xai_callback_state_missing' : 'auth_login.missing_state'))
            return
        }
        setCallbackSubmitting(true)
        setError('')
        try {
            await oauthApi.submitCallback(provider, redirectUrl, attempt.signal, plugin)
            if (attempt.isCurrent()) {
                setCallbackAccepted(true)
                if (oauthState && nonceRef.current && !attempt.isPolling()) {
                    setStatus('waiting')
                    setError('')
                    startPolling(oauthState, nonceRef.current, attempt)
                }
            }
        } catch (err) {
            if (attempt.isCurrent()) {
                setError(err instanceof Error ? err.message : t('credentials.oauth_error'))
            }
        } finally {
            if (attempt.isCurrent()) {
                setCallbackSubmitting(false)
            }
        }
    }, [provider, plugin, callbackUrl, oauthState, startPolling, t])

    const resumePolling = useCallback(() => {
        const currentAttempt = attemptsRef.current.get(provider)
        if (!oauthState || !nonceRef.current || !currentAttempt?.isCurrent()) {
            currentAttempt?.invalidate()
            nonceRef.current = ''
            setOauthState('')
            setStatus('idle')
            return
        }
        const attempt = attemptsRef.current.begin(provider)
        setCallbackSubmitting(false)
        setStatus('waiting')
        setError('')
        startPolling(oauthState, nonceRef.current, attempt)
    }, [oauthState, provider, startPolling])

    const handleCancel = useCallback(async () => {
        const stateValue    = oauthState
        const nonce         = nonceRef.current
        const loginAttempt  = attemptsRef.current.get(provider)
        const ownsLoginFlow = loginAttempt?.isCurrent() ?? false
        loginAttempt?.invalidate()
        setCallbackSubmitting(false)

        if ((!plugin && provider !== 'devin') || !stateValue || !ownsLoginFlow) {
            nonceRef.current = ''
            setOauthState('')
            setUserCode('')
            onCancel()
            return
        }

        const cancelAttempt = attemptsRef.current.begin(provider)
        setCancelSubmitting(true)
        setError('')
        try {
            const result = await oauthApi.cancelSession(stateValue, nonce, cancelAttempt.signal)
            if (!cancelAttempt.isCurrent()) {
                return
            }
            if (result.cancelled) {
                setCancelSubmitting(false)
                cancelAttempt.invalidate()
                nonceRef.current = ''
                setOauthState('')
                setUserCode('')
                onCancel()
                return
            }
        } catch (err) {
            if (!cancelAttempt.isCurrent()) {
                return
            }
            setError(err instanceof Error ? err.message : t(plugin ? 'common.unknown_error' : 'auth_login.devin_oauth_cancel_error'))
        }
        if (!cancelAttempt.isCurrent()) {
            return
        }
        setCancelSubmitting(false)
        setStatus('waiting')
        startPolling(stateValue, nonce, cancelAttempt)
    }, [oauthState, onCancel, provider, plugin, startPolling, t])

    const canContinueAfterError = status === 'error' && Boolean(
        url && oauthState && nonceRef.current && attemptsRef.current.get(provider)?.isCurrent(),
    )

    if (status === 'success') {
        return (
            <div className={styles.flow}>
                <div className={styles.successArea}>
                    <div className={styles.successMessage}>
                        <IconCheck size={16} />
                        <span>{t('credentials.oauth_success')}</span>
                    </div>
                    <div className={styles.flowButtons}>
                        <Button
                            variant='secondary'
                            size='sm'
                            onClick={() => {
                                attemptsRef.current.invalidateAll()
                                nonceRef.current = ''
                                setStatus('idle')
                                setUrl('')
                                setUserCode('')
                                setError('')
                                setCallbackUrl('')
                                setCallbackAccepted(false)
                                setCancelSubmitting(false)
                                setOauthState('')
                            }}
                        >
                            {t('auth_login.login_another_account', { defaultValue: '登录另一个账号' })}
                        </Button>
                        <Button variant='secondary' size='sm' onClick={onCancel}>
                            {t('auth_login.view_auth_files', { defaultValue: '查看认证文件' })}
                        </Button>
                    </div>
                </div>
            </div>
        )
    }

    if (status === 'error' && !canContinueAfterError) {
        return (
            <div className={styles.flow}>
                <div className={styles.errorArea}>
                    <IconX size={16} />
                    <span>{error || t('credentials.oauth_error')}</span>
                    <div className={styles.flowButtons}>
                        <Button variant='secondary' size='sm' onClick={resumePolling}>
                            {t('common.refresh')}
                        </Button>
                        <Button
                            variant='secondary'
                            size='sm'
                            onClick={() => void handleCancel()}
                            loading={cancelSubmitting}
                        >
                            {t('common.cancel')}
                        </Button>
                    </div>
                </div>
            </div>
        )
    }

    if (status === 'waiting' || canContinueAfterError) {
        return (
            <div className={styles.flow}>
                <div className={styles.waitingArea}>
                    {canContinueAfterError ? (
                        <div className={styles.errorArea}>
                            <IconX size={16} />
                            <span>{error || t('credentials.oauth_error')}</span>
                            <Button variant='secondary' size='sm' onClick={resumePolling}>
                                {t('common.refresh')}
                            </Button>
                        </div>
                    ) : (
                        <div className={styles.statusLine}>
                            <span className='loading-spinner' aria-hidden='true' />
                            <span>
                                {t(callbackAccepted ?
                                   'credentials.oauth_callback_processing' :
                                   'credentials.oauth_waiting')}
                            </span>
                        </div>
                    )}

                    {url && (
                        <div className={styles.urlArea}>
                            <code className={styles.url}>{url}</code>
                            <div className={styles.urlActions}>
                                <Button
                                    variant='secondary'
                                    size='sm'
                                    onClick={() => handleCopy(url)}
                                    title={t('credentials.oauth_copy_url')}
                                >
                                    <IconCopy size={14} />
                                </Button>
                                <Button
                                    variant='secondary'
                                    size='sm'
                                    onClick={() => {
                                        const authUrl = safeExternalUrl(url)
                                        if (authUrl) {
                                            window.open(authUrl, '_blank', 'noopener,noreferrer')
                                        }
                                    }}
                                    title={t('credentials.oauth_open_url')}
                                >
                                    <IconExternalLink size={14} />
                                </Button>
                            </div>
                        </div>
                    )}
                    {userCode && (
                        <div className={styles.urlArea}>
                            <span>{t('auth_login.device_code_label')}</span>
                            <code className={styles.url}>{userCode}</code>
                            <Button
                                variant='secondary'
                                size='sm'
                                onClick={() => handleCopy(userCode)}
                                title={t('auth_login.device_code_copy')}
                            >
                                <IconCopy size={14} />
                            </Button>
                        </div>
                    )}

                    {supportsCallback && !callbackAccepted && (
                        <div className={styles.callbackArea}>
                            <div className={styles.callbackInputRow}>
                                <Input
                                    label={t(
                                        !plugin && provider === 'xai'
                                        ? 'auth_login.xai_callback_label'
                                        : 'credentials.oauth_callback_hint',
                                    )}
                                    placeholder={t(
                                        !plugin && provider === 'xai'
                                        ? 'auth_login.xai_callback_placeholder'
                                        : !plugin && provider === 'devin'
                                          ? 'auth_login.devin_callback_placeholder'
                                          : 'auth_login.oauth_callback_placeholder',
                                    )}
                                    value={callbackUrl}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) => setCallbackUrl(e.target.value)}
                                    disabled={callbackSubmitting || cancelSubmitting || (!plugin && provider === 'devin' && canContinueAfterError)}
                                />
                                <Button
                                    variant='primary'
                                    size='sm'
                                    onClick={submitCallback}
                                    loading={callbackSubmitting}
                                    disabled={!callbackUrl.trim() || (!plugin && provider === 'devin' && canContinueAfterError)}
                                >
                                    {t('credentials.oauth_callback_submit')}
                                </Button>
                            </div>
                            <div className={styles.callbackHint}>
                                {!plugin && provider === 'xai'
                                 ? t('auth_login.xai_callback_hint')
                                 : !plugin && provider === 'devin'
                                   ? t('auth_login.devin_callback_hint')
                                   : t('auth_login.oauth_callback_hint')}
                            </div>
                            {status === 'waiting' && error && <div className={styles.callbackError}>{error}</div>}
                        </div>
                    )}

                    <Button
                        variant='secondary'
                        size='sm'
                        onClick={() => void handleCancel()}
                        loading={cancelSubmitting}
                    >
                        {t('common.cancel')}
                    </Button>
                </div>
            </div>
        )
    }

    // idle or starting
    return (
        <div className={styles.flow}>
            <div className={styles.startArea}>
                {needsProjectId && (
                    <Input
                        label={t('credentials.project_id')}
                        placeholder='my-gcp-project'
                        value={projectId}
                        onChange={(e: ChangeEvent<HTMLInputElement>) => setProjectId(e.target.value)}
                        disabled={disableControls || status === 'starting'}
                    />
                )}
                <div className={styles.flowButtons}>
                    <Button
                        variant='primary'
                        size='sm'
                        onClick={startAuth}
                        loading={status === 'starting'}
                        disabled={disableControls}
                    >
                        {t('auth_login.login_button')}
                    </Button>
                    <Button variant='secondary' size='sm' onClick={() => void handleCancel()}>
                        {t('common.cancel')}
                    </Button>
                </div>
            </div>
        </div>
    )
}
