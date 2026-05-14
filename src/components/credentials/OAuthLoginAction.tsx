import { Button } from '@/components/ui/Button'
import { IconCheck, IconCopy, IconExternalLink, IconX } from '@/components/ui/icons'
import { Input } from '@/components/ui/Input'
import { oauthApi, type OAuthProvider } from '@/services/api/oauth'
import { copyToClipboard } from '@/utils/clipboard'
import { type ChangeEvent, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styles from './OAuthLoginAction.module.scss'

const POLL_INTERVAL = 3000
const CALLBACK_SUPPORTED: OAuthProvider[] = ['codex', 'anthropic', 'antigravity', 'gemini-cli']

function generateNonce(): string {
    const bytes = new Uint8Array(16)
    crypto.getRandomValues(bytes)
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

interface OAuthLoginActionProps {
    provider: OAuthProvider
    disableControls: boolean
    onSuccess: () => void
    onCancel: () => void
}

export function OAuthLoginAction({ provider, disableControls, onSuccess, onCancel }: OAuthLoginActionProps) {
    const { t } = useTranslation()
    const [url, setUrl] = useState('')
    const [status, setStatus] = useState<'idle' | 'starting' | 'waiting' | 'success' | 'error'>('idle')
    const [error, setError] = useState('')
    const [projectId, setProjectId] = useState('')
    const [callbackUrl, setCallbackUrl] = useState('')
    const [callbackSubmitting, setCallbackSubmitting] = useState(false)
    const pollRef = useRef<number | null>(null)

    const needsProjectId = provider === 'gemini-cli'
    const supportsCallback = CALLBACK_SUPPORTED.includes(provider)

    const stopPolling = useCallback(() => {
        if (pollRef.current) {
            clearInterval(pollRef.current)
            pollRef.current = null
        }
    }, [])

    useEffect(() => stopPolling, [stopPolling])

    const startAuth = useCallback(async () => {
        setStatus('starting')
        setError('')
        try {
            // Generate a per-flow nonce bound to the polling loop so a third party who only
            // learns the state (e.g. via referrer leak) cannot read the result.
            const nonce = generateNonce()
            const options = {
                ...(needsProjectId && projectId ? { projectId } : {}),
                nonce,
            }
            const response = await oauthApi.startAuth(provider, options)
            setUrl(response.url)
            setStatus('waiting')

            // Validate URL scheme to prevent javascript: URI injection (XSS-VULN-01)
            try {
                const parsed = new URL(response.url)
                if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
                    throw new Error('Invalid URL scheme')
                }
                window.open(response.url, '_blank', 'noopener,noreferrer')
            } catch {
                setError('Invalid OAuth URL received from server')
                setStatus('error')
                return
            }

            if (response.state) {
                const stateValue = response.state
                pollRef.current = window.setInterval(async () => {
                    try {
                        const result = await oauthApi.getAuthStatus(stateValue, nonce)
                        if (result.status === 'ok') {
                            stopPolling()
                            setStatus('success')
                            onSuccess()
                        } else if (result.status === 'error') {
                            stopPolling()
                            setStatus('error')
                            setError(result.error || t('credentials.oauth_error'))
                        }
                    } catch {
                        // Continue polling on network errors
                    }
                }, POLL_INTERVAL)
            }
        } catch (err) {
            setStatus('error')
            setError(err instanceof Error ? err.message : t('credentials.oauth_error'))
        }
    }, [provider, projectId, needsProjectId, stopPolling, onSuccess, t])

    const submitCallback = useCallback(async () => {
        if (!callbackUrl.trim()) {
            return
        }
        setCallbackSubmitting(true)
        try {
            await oauthApi.submitCallback(provider, callbackUrl.trim())
            stopPolling()
            setStatus('success')
            onSuccess()
        } catch (err) {
            setError(err instanceof Error ? err.message : t('credentials.oauth_error'))
        } finally {
            setCallbackSubmitting(false)
        }
    }, [provider, callbackUrl, stopPolling, onSuccess, t])

    const handleCancel = useCallback(() => {
        stopPolling()
        onCancel()
    }, [stopPolling, onCancel])

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
                            variant="secondary"
                            size="sm"
                            onClick={() => {
                                stopPolling()
                                setStatus('idle')
                                setUrl('')
                                setError('')
                                setCallbackUrl('')
                            }}
                        >
                            {t('auth_login.login_another_account', { defaultValue: '登录另一个账号' })}
                        </Button>
                        <Button variant="secondary" size="sm" onClick={onCancel}>
                            {t('auth_login.view_auth_files', { defaultValue: '查看认证文件' })}
                        </Button>
                    </div>
                </div>
            </div>
        )
    }

    if (status === 'error') {
        return (
            <div className={styles.flow}>
                <div className={styles.errorArea}>
                    <IconX size={16} />
                    <span>{error || t('credentials.oauth_error')}</span>
                    <div className={styles.flowButtons}>
                        <Button variant="secondary" size="sm" onClick={() => setStatus('idle')}>
                            {t('common.refresh')}
                        </Button>
                        <Button variant="secondary" size="sm" onClick={handleCancel}>
                            {t('common.cancel')}
                        </Button>
                    </div>
                </div>
            </div>
        )
    }

    if (status === 'waiting') {
        return (
            <div className={styles.flow}>
                <div className={styles.waitingArea}>
                    <div className={styles.statusLine}>
                        <span className="loading-spinner" aria-hidden="true" />
                        <span>{t('credentials.oauth_waiting')}</span>
                    </div>

                    {url && (
                        <div className={styles.urlArea}>
                            <code className={styles.url}>{url}</code>
                            <div className={styles.urlActions}>
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={() => copyToClipboard(url)}
                                    title={t('credentials.oauth_copy_url')}
                                >
                                    <IconCopy size={14} />
                                </Button>
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={() => {
                                        try {
                                            const parsed = new URL(url)
                                            if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
                                                window.open(url, '_blank', 'noopener,noreferrer')
                                            }
                                        } catch {
                                            /* invalid URL, ignore */
                                        }
                                    }}
                                    title={t('credentials.oauth_open_url')}
                                >
                                    <IconExternalLink size={14} />
                                </Button>
                            </div>
                        </div>
                    )}

                    {supportsCallback && (
                        <div className={styles.callbackArea}>
                            <Input
                                label={t('credentials.oauth_callback_hint')}
                                placeholder="https://..."
                                value={callbackUrl}
                                onChange={(e: ChangeEvent<HTMLInputElement>) => setCallbackUrl(e.target.value)}
                                disabled={callbackSubmitting}
                            />
                            <Button
                                variant="primary"
                                size="sm"
                                onClick={submitCallback}
                                loading={callbackSubmitting}
                                disabled={!callbackUrl.trim()}
                            >
                                {t('credentials.oauth_callback_submit')}
                            </Button>
                        </div>
                    )}

                    <Button variant="secondary" size="sm" onClick={handleCancel}>
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
                        placeholder="my-gcp-project"
                        value={projectId}
                        onChange={(e: ChangeEvent<HTMLInputElement>) => setProjectId(e.target.value)}
                        disabled={disableControls || status === 'starting'}
                    />
                )}
                <div className={styles.flowButtons}>
                    <Button
                        variant="primary"
                        size="sm"
                        onClick={startAuth}
                        loading={status === 'starting'}
                        disabled={disableControls}
                    >
                        {t('auth_login.login_button')}
                    </Button>
                    <Button variant="secondary" size="sm" onClick={onCancel}>
                        {t('common.cancel')}
                    </Button>
                </div>
            </div>
        </div>
    )
}
