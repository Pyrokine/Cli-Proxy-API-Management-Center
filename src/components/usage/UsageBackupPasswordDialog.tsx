import {Button} from '@/components/ui/Button'
import {Input} from '@/components/ui/Input'
import {Modal} from '@/components/ui/Modal'
import {apiClient} from '@/services/api/client'
import {type FormEvent, useId, useState} from 'react'
import {useTranslation} from 'react-i18next'

export interface BackupPasswordAction {
    mode?: 'export' | 'import'
    title: string
    confirmText: string
    message?: string
    onConfirm: (password: string) => Promise<void>
}

export function UsageBackupPasswordDialog({ action, onClose }: {
    action: BackupPasswordAction & { generation: number }
    onClose: () => void
}) {
    const { t }                       = useTranslation()
    const passwordId                  = useId()
    const [submitting, setSubmitting] = useState(false)
    const [error, setError]           = useState('')
    const exporting                   = action.mode !== 'import'

    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        if (submitting) {
            return
        }
        const form     = event.currentTarget
        const data     = new FormData(form)
        const password = String(data.get('backup-password') ?? '').trim()
        setError('')
        if (action.generation !== apiClient.getAuthGeneration()) {
            form.reset()
            setError(t('common.connection_changed'))
            return
        }
        if (!password) {
            setError(t('usage_stats.backup_password_required'))
            return
        }
        if (exporting && password !== String(data.get('backup-password-repeat') ?? '').trim()) {
            setError(t('usage_stats.backup_password_mismatch'))
            return
        }
        form.reset()
        setSubmitting(true)
        try {
            await action.onConfirm(password)
            onClose()
        } catch (cause: unknown) {
            setError(action.generation === apiClient.getAuthGeneration()
                     ? (cause instanceof Error ? cause.message : String(cause))
                     : t('common.connection_changed'))
        } finally {
            setSubmitting(false)
        }
    }

    return (
        <Modal
            open
            title={action.title}
            onClose={onClose}
            closeDisabled={submitting}
            closeBehavior='immediate'
            initialFocusId={passwordId}
        >
            <form onSubmit={submit}>
                {action.message && <p className='confirmation-message'>{action.message}</p>}
                <Input
                    id={passwordId}
                    name='backup-password'
                    label={t('usage_stats.backup_password')}
                    hint={t(exporting ?
                            'usage_stats.backup_password_export_hint' :
                            'usage_stats.backup_password_import_hint')}
                    secret
                    disabled={submitting}
                />
                {exporting && (
                    <Input
                        name='backup-password-repeat'
                        label={t('usage_stats.backup_password_repeat')}
                        secret
                        disabled={submitting}
                    />
                )}
                {error && <div className='error-box' role='alert'>{error}</div>}
                <div className='confirmation-actions'>
                    <Button type='button' variant='ghost' disabled={submitting} onClick={onClose}>
                        {t('common.cancel')}
                    </Button>
                    <Button type='submit' loading={submitting}>{action.confirmText}</Button>
                </div>
            </form>
        </Modal>
    )
}
