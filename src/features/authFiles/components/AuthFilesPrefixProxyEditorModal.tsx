import {Button} from '@/components/ui/Button'
import {Input} from '@/components/ui/Input'
import {Modal} from '@/components/ui/Modal'
import type {
    PrefixProxyEditorField,
    PrefixProxyEditorFieldValue,
    PrefixProxyEditorState,
} from '@/features/authFiles/hooks/useAuthFilesPrefixProxyEditor'
import {useState} from 'react'
import {useTranslation} from 'react-i18next'
import styles from './AuthFilesPrefixProxyEditorModal.module.scss'

type AuthFilesPrefixProxyEditorModalProps = {
    editor: PrefixProxyEditorState | null
    updatedText: string
    dirty: boolean
    onClose: () => void
    onChange: (field: PrefixProxyEditorField, value: PrefixProxyEditorFieldValue) => void
    onSave: () => void | Promise<void>
}

function ReadonlyJsonBlock({ label, value }: { label: string; value: string }) {
    const { t }               = useTranslation()
    const [copied, setCopied] = useState(false)

    const handleCopy = async () => {
        if (!value) {
            return
        }
        await navigator.clipboard.writeText(value)
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1200)
    }

    return (
        <div className={styles.previewBlock}>
            <div className={styles.previewHeader}>
                <span>{label}</span>
                <Button variant='secondary' size='xs' onClick={() => void handleCopy()} disabled={!value}>
                    {copied ? t('common.copied', { defaultValue: 'Copied' }) : t('common.copy')}
                </Button>
            </div>
            <textarea className={`input ${styles.previewTextarea}`} value={value} readOnly spellCheck={false} />
        </div>
    )
}

export function AuthFilesPrefixProxyEditorModal({
                                                    editor,
                                                    updatedText,
                                                    dirty,
                                                    onClose,
                                                    onChange,
                                                    onSave,
                                                }: AuthFilesPrefixProxyEditorModalProps) {
    const { t }           = useTranslation()
    const hasHeadersError = Boolean(editor?.headersTouched && editor.headersError)
    const canSave         = Boolean(editor?.json && dirty && !editor.saving && !editor.loading && !hasHeadersError)

    return (
        <Modal
            open={Boolean(editor)}
            title={editor ? t('auth_files.auth_field_editor_title', { name: editor.fileName }) : ''}
            onClose={onClose}
            width='min(980px, 92vw)'
            className={styles.modal}
            closeDisabled={editor?.saving}
            footer={
                <>
                    <Button variant='secondary' onClick={onClose} disabled={editor?.saving}>
                        {t('common.cancel')}
                    </Button>
                    <Button onClick={() => void onSave()} loading={editor?.saving} disabled={!canSave}>
                        {t('common.save')}
                    </Button>
                </>
            }
        >
            {!editor ? null : editor.loading ? (
                <div className={styles.loading}>{t('auth_files.prefix_proxy_loading')}</div>
            ) : (
                                  <div className={styles.content}>
                                      <ReadonlyJsonBlock label={t('auth_files.prefix_proxy_info_label')}
                                                         value={editor.fileInfoText} />
                                      {editor.error ? (
                                          <>
                                              <div className='error-box'>{editor.error}</div>
                                              {editor.invalidContentPreview && (
                                                  <ReadonlyJsonBlock
                                                      label={t('auth_files.prefix_proxy_invalid_content_label')}
                                                      value={editor.invalidContentPreview}
                                                  />
                                              )}
                                          </>
                                      ) : (
                                           <>
                                               <div className={styles.fieldGrid}>
                                                   <Input
                                                       label={t('auth_files.prefix_label')}
                                                       placeholder={t('auth_files.prefix_placeholder')}
                                                       value={editor.prefix}
                                                       onChange={(event) => onChange('prefix', event.target.value)}
                                                   />
                                                   <Input
                                                       label={t('auth_files.proxy_url_label')}
                                                       placeholder={t('auth_files.proxy_url_placeholder')}
                                                       value={editor.proxyUrl}
                                                       onChange={(event) => onChange('proxyUrl', event.target.value)}
                                                   />
                                                   <Input
                                                       label={t('auth_files.priority_label')}
                                                       placeholder={t('auth_files.priority_placeholder')}
                                                       hint={t('auth_files.priority_hint')}
                                                       value={editor.priority}
                                                       onChange={(event) => onChange('priority', event.target.value)}
                                                   />
                                                   <Input
                                                       label={t('auth_files.note_label')}
                                                       placeholder={t('auth_files.note_placeholder')}
                                                       hint={t('auth_files.note_hint')}
                                                       value={editor.note}
                                                       onChange={(event) => onChange('note', event.target.value)}
                                                   />
                                               </div>
                                               <div className='form-group'>
                                                   <label>{t('auth_files.headers_label')}</label>
                                                   <textarea
                                                       className={`input ${styles.headersTextarea}`}
                                                       placeholder={t('auth_files.headers_placeholder')}
                                                       value={editor.headersText}
                                                       onChange={(event) => onChange('headersText', event.target.value)}
                                                       spellCheck={false}
                                                   />
                                                   <div className='hint'>{t('auth_files.headers_hint')}</div>
                                                   {editor.headersTouched && editor.headersError && (
                                                       <div className='error-box'>{editor.headersError}</div>
                                                   )}
                                               </div>
                                               <ReadonlyJsonBlock label={t('auth_files.prefix_proxy_source_label')}
                                                                  value={updatedText} />
                                           </>
                                       )}
                                  </div>
                              )}
        </Modal>
    )
}
