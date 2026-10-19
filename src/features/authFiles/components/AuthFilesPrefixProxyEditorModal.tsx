import {Button} from '@/components/ui/Button'
import {CredentialOverrideFields} from '@/components/providers/CredentialOverrideFields'
import type {CredentialOverrides} from '@/types'
import {getCredentialRetryValidationKey} from '@/utils/credentialOverrides'
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
import {type MouseEvent, useCallback, useId, useState} from 'react'
import {Trans, useTranslation} from 'react-i18next'
import {Link, useNavigate} from 'react-router-dom'
import styles from './AuthFilesPrefixProxyEditorModal.module.scss'

type AuthFilesPrefixProxyEditorModalProps = {
    editor: PrefixProxyEditorState | null
    dirty: boolean
    disableControls: boolean
    onClose: () => void
    onChange: (field: PrefixProxyEditorField, value: PrefixProxyEditorFieldValue) => void
    onBooleanChange: (field: 'usingApi' | 'websockets', value: boolean) => void
    onOverridesChange: (overrides: CredentialOverrides) => void
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
                                                    disableControls,
                                                    onClose,
                                                    onChange,
                                                    onBooleanChange,
                                                    onOverridesChange,
                                                    onSave,
                                                }: AuthFilesPrefixProxyEditorModalProps) {
    const { t }              = useTranslation()
    const navigate           = useNavigate()
    const showConfirmation   = useNotificationStore((state) => state.showConfirmation)
    const readOnly           = editor?.readOnly ?? false
    const fieldsDisabled     = disableControls || readOnly || Boolean(editor?.loading || editor?.saving)
    const aliasesId          = useId()
    const rulesId            = useId()
    const hasValidationError = Boolean(
        editor?.weightError || (editor?.headersTouched && editor.headersError) ||
        (editor?.modelAliasesTouched && editor.modelAliasesError) ||
        (editor?.requestRulesTouched && editor.requestRulesError) ||
        (editor?.requestRetryTouched && getCredentialRetryValidationKey(editor.requestRetry)),
    )
    const canSave            = Boolean(
        editor?.json && dirty && !fieldsDisabled && !hasValidationError,
    )
    const requestClose = useCallback((afterClose?: () => void) => {
        if (editor?.saving) {
            return
        }
        const close = () => {
            onClose()
            afterClose?.()
        }
        if (!dirty || readOnly) {
            close()
            return
        }
        showConfirmation({
                             title: t('common.unsaved_changes_title'),
                             message: t('common.unsaved_changes_message'),
                             confirmText: t('common.leave'),
                             cancelText: t('common.stay'),
                             variant: 'danger',
                             onConfirm: close,
                         })
    }, [dirty, editor?.saving, onClose, readOnly, showConfirmation, t])
    const handleRoutingSettingsClick = useCallback((event: MouseEvent<HTMLAnchorElement>) => {
        event.preventDefault()
        requestClose(() => navigate('/config?field=routingStrategy'))
    }, [navigate, requestClose])

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
            onClose={() => requestClose()}
            width='min(980px, 92vw)'
            className={styles.modal}
            closeDisabled={editor?.saving}
            closeBehavior='immediate'
            closeLabel={t('common.close')}
            footer={
                <>
                    <Button variant='secondary' onClick={() => requestClose()} disabled={editor?.saving}>
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
                                                       disabled={fieldsDisabled}
                                                   />
                                                   <Input
                                                       label={t('auth_files.proxy_url_label')}
                                                       placeholder={t('auth_files.proxy_url_placeholder')}
                                                       value={editor.proxyUrl}
                                                       onChange={(event) => onChange('proxyUrl', event.target.value)}
                                                       readOnly={readOnly}
                                                       disabled={fieldsDisabled}
                                                   />
                                                   <Input
                                                       label={t('auth_files.priority_label')}
                                                       placeholder={t('auth_files.priority_placeholder')}
                                                       hint={t('auth_files.priority_hint')}
                                                       value={editor.priority}
                                                       onChange={(event) => onChange('priority', event.target.value)}
                                                       readOnly={readOnly}
                                                       disabled={fieldsDisabled}
                                                   />
                                                   <Input
                                                       label={t('auth_files.weight_label')}
                                                       type='number'
                                                       step={1}
                                                       max={MAX_CREDENTIAL_WEIGHT}
                                                       placeholder='1'
                                                       hint={
                                                           <Trans
                                                               i18nKey='auth_files.weight_hint'
                                                               components={{
                                                                   settingsLink: (
                                                                       <Link
                                                                           className={styles.settingsLink}
                                                                           to='/config?field=routingStrategy'
                                                                           onClick={handleRoutingSettingsClick}
                                                                           aria-disabled={editor.saving}
                                                                           tabIndex={editor.saving ? -1 : undefined}
                                                                       />
                                                                   ),
                                                               }}
                                                           />
                                                       }
                                                       error={editor.weightError ?? undefined}
                                                       value={editor.weight}
                                                       onChange={(event) => onChange('weight', event.target.value)}
                                                       readOnly={readOnly}
                                                       disabled={fieldsDisabled}
                                                   />
                                                   <Input
                                                       label={t('auth_files.note_label')}
                                                       placeholder={t('auth_files.note_placeholder')}
                                                       hint={t('auth_files.note_hint')}
                                                       value={editor.note}
                                                       onChange={(event) => onChange('note', event.target.value)}
                                                       readOnly={readOnly}
                                                       disabled={fieldsDisabled}
                                                   />
                                                   <CredentialOverrideFields
                                                       disableCooling={editor.disableCooling}
                                                       requestRetry={editor.requestRetry}
                                                       disabled={fieldsDisabled}
                                                       onChange={onOverridesChange}
                                                   />
                                               </div>
                                               {(editor.supportsWebsockets || editor.supportsUsingApi) && (
                                                   <div className={styles.switches}>
                                                       {editor.supportsWebsockets && (
                                                           <ToggleSwitch
                                                               checked={editor.websockets}
                                                               disabled={fieldsDisabled}
                                                               onChange={(value) => onBooleanChange('websockets', value)}
                                                               label={t('credentials.websockets')}
                                                           />
                                                       )}
                                                       {editor.supportsUsingApi && (
                                                           <ToggleSwitch
                                                               checked={editor.usingApi}
                                                               disabled={fieldsDisabled}
                                                               onChange={(value) => onBooleanChange('usingApi', value)}
                                                               label={t('auth_files.using_api_label', {
                                                                   defaultValue: 'Use official xAI API (using_api)',
                                                               })}
                                                           />
                                                       )}
                                                   </div>
                                               )}
                                               <AuthFileExcludedModelsField
                                                   fileName={editor.fileName}
                                                   value={editor.excludedModelsText}
                                                   disabled={fieldsDisabled}
                                                   onChange={(value) => onChange('excludedModelsText', value)}
                                               />
                                               {!readOnly && editor.supportsModelAliases && (
                                                   <div className='form-group'>
                                                       <label htmlFor={aliasesId}>{t('auth_files.model_aliases_label')}</label>
                                                       <textarea
                                                           id={aliasesId}
                                                           className={`input ${styles.headersTextarea}`}
                                                           placeholder='[{"name":"gpt-5","alias":"local-gpt","fork":true}]'
                                                           value={editor.modelAliasesText}
                                                           onChange={(event) => onChange('modelAliasesText', event.target.value)}
                                                           disabled={fieldsDisabled}
                                                           aria-invalid={Boolean(editor.modelAliasesError)}
                                                           spellCheck={false}
                                                       />
                                                       <div className='hint'>{t('auth_files.policy_array_hint')}</div>
                                                       {editor.modelAliasesTouched && editor.modelAliasesError && (
                                                           <div className='error-box' role='alert'>{editor.modelAliasesError}</div>
                                                       )}
                                                   </div>
                                               )}
                                               {!readOnly && (
                                                   <div className='form-group'>
                                                       <label htmlFor={rulesId}>{t('auth_files.request_rules_label')}</label>
                                                       <textarea
                                                           id={rulesId}
                                                           className={`input ${styles.headersTextarea}`}
                                                           placeholder='[{"status":429,"match":["quota"],"action":"stop"}]'
                                                           value={editor.requestRulesText}
                                                           onChange={(event) => onChange('requestRulesText', event.target.value)}
                                                           disabled={fieldsDisabled}
                                                           aria-invalid={Boolean(editor.requestRulesError)}
                                                           spellCheck={false}
                                                       />
                                                       <div className='hint'>{t('auth_files.policy_array_hint')}</div>
                                                       {editor.requestRulesTouched && editor.requestRulesError && (
                                                           <div className='error-box' role='alert'>{editor.requestRulesError}</div>
                                                       )}
                                                   </div>
                                               )}
                                               <div className='form-group'>
                                                   <label>{t('auth_files.headers_label')}</label>
                                                   <textarea
                                                       className={`input ${styles.headersTextarea}`}
                                                       placeholder={t('auth_files.headers_placeholder')}
                                                       value={editor.headersText}
                                                       onChange={(event) => onChange('headersText', event.target.value)}
                                                       readOnly={readOnly}
                                                       disabled={fieldsDisabled}
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
