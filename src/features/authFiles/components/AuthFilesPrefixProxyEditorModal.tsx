import {Button} from '@/components/ui/Button'
import {Input} from '@/components/ui/Input'
import {Modal} from '@/components/ui/Modal'
import {ToggleSwitch} from '@/components/ui/ToggleSwitch'
import {AuthFileExcludedModelsField} from '@/features/authFiles/components/AuthFileExcludedModelsField'
import type {
    PrefixProxyEditorField,
    PrefixProxyEditorFieldValue,
    PrefixProxyEditorState,
} from '@/features/authFiles/hooks/useAuthFilesPrefixProxyEditor'
import {useNotificationStore} from '@/stores'
import {MAX_CREDENTIAL_WEIGHT} from '@/utils/credentialWeight'
import {useCallback, useState} from 'react'
import {useTranslation} from 'react-i18next'
import styles from './AuthFilesPrefixProxyEditorModal.module.scss'

type AuthFilesPrefixProxyEditorModalProps = {
    editor: PrefixProxyEditorState | null
    dirty: boolean
    onClose: () => void
    onChange: (field: PrefixProxyEditorField, value: PrefixProxyEditorFieldValue) => void
    onBooleanChange: (field: 'disableCooling' | 'usingApi', value: boolean) => void
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
                                                    dirty,
                                                    onClose,
                                                    onChange,
                                                    onBooleanChange,
                                                    onSave,
                                                }: AuthFilesPrefixProxyEditorModalProps) {
    const { t }              = useTranslation()
    const showConfirmation   = useNotificationStore((state) => state.showConfirmation)
    const readOnly           = editor?.readOnly ?? false
    const hasValidationError = Boolean(
        editor?.weightError || (editor?.headersTouched && editor.headersError),
    )
    const canSave            = Boolean(
        editor?.json && dirty && !readOnly && !editor.saving && !editor.loading && !hasValidationError,
    )
    const requestClose       = useCallback(() => {
        if (!dirty || readOnly) {
            onClose()
            return
        }
        showConfirmation({
                             title: t('common.unsaved_changes_title'),
                             message: t('common.unsaved_changes_message'),
                             confirmText: t('common.leave'),
                             cancelText: t('common.stay'),
                             variant: 'danger',
                             onConfirm: onClose,
                         })
    }, [dirty, onClose, readOnly, showConfirmation, t])

    return (
        <Modal
            open={Boolean(editor)}
            title={
                editor
                ? t(
                    editor.readOnly
                    ? 'auth_files.auth_field_viewer_title'
                    : 'auth_files.auth_field_editor_title',
                    { name: editor.fileName },
                )
                : ''
            }
            onClose={requestClose}
            width='min(980px, 92vw)'
            className={styles.modal}
            closeDisabled={editor?.saving}
            closeBehavior='immediate'
            closeLabel={t('common.close')}
            footer={
                <>
                    <Button variant='secondary' onClick={requestClose} disabled={editor?.saving}>
                        {t(readOnly ? 'common.close' : 'common.cancel')}
                    </Button>
                    {!readOnly && (
                        <Button onClick={() => void onSave()} loading={editor?.saving} disabled={!canSave}>
                            {t('common.save')}
                        </Button>
                    )}
                </>
            }
        >
            {!editor ? null : editor.loading ? (
                <div className={styles.loading}>{t('auth_files.prefix_proxy_loading')}</div>
            ) : (
                                  <div className={styles.content}>
                                      <ReadonlyJsonBlock label={t('auth_files.prefix_proxy_info_label')}
                                                         value={editor.fileInfoText} />
                                      {readOnly && (
                                          <div className={styles.readOnlyNotice} role='status'>
                                              {t('auth_files.runtime_only_readonly_hint')}
                                          </div>
                                      )}
                                      {editor.error ? (
                                          <div className='error-box'>{editor.error}</div>
                                      ) : (
                                           <>
                                               <div className={styles.fieldGrid}>
                                                   <Input
                                                       label={t('auth_files.prefix_label')}
                                                       placeholder={t('auth_files.prefix_placeholder')}
                                                       value={editor.prefix}
                                                       onChange={(event) => onChange('prefix', event.target.value)}
                                                       readOnly={readOnly}
                                                   />
                                                   <Input
                                                       label={t('auth_files.proxy_url_label')}
                                                       placeholder={t('auth_files.proxy_url_placeholder')}
                                                       value={editor.proxyUrl}
                                                       onChange={(event) => onChange('proxyUrl', event.target.value)}
                                                       readOnly={readOnly}
                                                   />
                                                   <Input
                                                       label={t('auth_files.priority_label')}
                                                       placeholder={t('auth_files.priority_placeholder')}
                                                       hint={t('auth_files.priority_hint')}
                                                       value={editor.priority}
                                                       onChange={(event) => onChange('priority', event.target.value)}
                                                       readOnly={readOnly}
                                                   />
                                                   <Input
                                                       label={t('auth_files.weight_label')}
                                                       type='number'
                                                       step={1}
                                                       max={MAX_CREDENTIAL_WEIGHT}
                                                       placeholder='1'
                                                       hint={t('auth_files.weight_hint')}
                                                       error={editor.weightError ?? undefined}
                                                       value={editor.weight}
                                                       onChange={(event) => onChange('weight', event.target.value)}
                                                       readOnly={readOnly}
                                                   />
                                                   <Input
                                                       label={t('auth_files.note_label')}
                                                       placeholder={t('auth_files.note_placeholder')}
                                                       hint={t('auth_files.note_hint')}
                                                       value={editor.note}
                                                       onChange={(event) => onChange('note', event.target.value)}
                                                       readOnly={readOnly}
                                                   />
                                               </div>
                                               <div className={styles.switches}>
                                                   <ToggleSwitch
                                                       checked={editor.disableCooling}
                                                       disabled={editor.saving || readOnly}
                                                       onChange={(value) => onBooleanChange('disableCooling', value)}
                                                       label={t('auth_files.disable_cooling_label')}
                                                   />
                                                   {editor.supportsUsingApi && (
                                                       <ToggleSwitch
                                                           checked={editor.usingApi}
                                                           disabled={editor.saving || readOnly}
                                                           onChange={(value) => onBooleanChange('usingApi', value)}
                                                           label={t('auth_files.using_api_label', {
                                                               defaultValue: 'Use official xAI API (using_api)',
                                                           })}
                                                       />
                                                   )}
                                               </div>
                                               <AuthFileExcludedModelsField
                                                   fileName={editor.fileName}
                                                   value={editor.excludedModelsText}
                                                   disabled={editor.saving || readOnly}
                                                   onChange={(value) => onChange('excludedModelsText', value)}
                                               />
                                               <div className='form-group'>
                                                   <label>{t('auth_files.headers_label')}</label>
                                                   <textarea
                                                       className={`input ${styles.headersTextarea}`}
                                                       placeholder={t('auth_files.headers_placeholder')}
                                                       value={editor.headersText}
                                                       onChange={(event) => onChange('headersText', event.target.value)}
                                                       readOnly={readOnly}
                                                       spellCheck={false}
                                                   />
                                                   <div className='hint'>{t('auth_files.headers_hint')}</div>
                                                   {editor.headersTouched && editor.headersError && (
                                                       <div className='error-box'>{editor.headersError}</div>
                                                   )}
                                               </div>
                                           </>
                                       )}
                                  </div>
                              )}
        </Modal>
    )
}
