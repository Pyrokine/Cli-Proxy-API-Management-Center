import {RequestScopedErrorsField} from '@/components/providers/CredentialOverrideFields'
import {Button} from '@/components/ui/Button'
import {Input} from '@/components/ui/Input'
import {Modal} from '@/components/ui/Modal'
import {patchKnownYamlFields} from '@/hooks/visualConfigCodec'
import {useNotificationStore} from '@/stores'
import type {RequestScopedErrorRule} from '@/types'
import {readRequestScopedErrorRule} from '@/utils/credentialOverrides'
import {getOAuthModelAliasError} from '@/utils/oauthModelAlias'
import {type ReactNode, useEffect, useId, useMemo, useRef, useState} from 'react'
import {Trans, useTranslation} from 'react-i18next'
import {type Alias, isMap, isSeq, type Node, parseDocument, visit} from 'yaml'

interface OAuthConfigFieldsProps {
    kind: 'settings' | 'errors' | 'aliases'
    value: string
    disabled: boolean
    error?: string
    onChange: (value: string) => void
}

export function OAuthConfigFields({ kind, value, disabled, error, onChange }: OAuthConfigFieldsProps) {
    const { t }                                  = useTranslation()
    const { showConfirmation, showNotification } = useNotificationStore()
    const [channel, setChannel]                  = useState('')
    const [renameDraft, setRenameDraft]          = useState<{
                                                                alias: string;
                                                                value: string;
                                                                error: string;
                                                                source: string
                                                            } | null>(null)
    const inputId                                = useId()
    const returnFocusId                          = useRef('')
    const current                                = useRef({ value, disabled, kind, onChange })
    useEffect(() => {
        current.current = { value, disabled, kind, onChange }
        return () => {
            current.current.disabled = true
        }
    }, [value, disabled, kind, onChange])
    const parsed            = useMemo(() => {
        try {
            const document = parseDocument(value.trim() || '{}', { intAsBigInt: true })
            if (document.errors.length) {
                return { error: document.errors[0].message }
            }
            const data: unknown = document.toJS()
            if (data === null) {
                return { document, data: {} as Record<string, Record<string, unknown>[]> }
            }
            if (!data ||
                typeof data !==
                'object' ||
                Array.isArray(data) ||
                Object.values(data).some((rules) => !Array.isArray(rules) ||
                rules.some((rule) => !rule || typeof rule !== 'object' || Array.isArray(rule)))) {
                return { error: t('config_management.visual.validation.oauth_rules_shape') }
            }
            return { document, data: data as Record<string, Record<string, unknown>[]> }
        } catch (cause: unknown) {
            return { error: cause instanceof Error ? cause.message : String(cause) }
        }
    }, [t, value])
    const data              = parsed.data
    const channels          = Object.keys(data ?? {})
    const normalizedChannel = channel.trim().toLowerCase()
    const duplicateChannel  = channels.some((current) => current.trim().toLowerCase() === normalizedChannel)
    const aliases           = useMemo(() => {
        const names = new Map<string, string>()
        if (kind === 'aliases') {
            for (const rows of Object.values(data ?? {})) {
                for (const row of rows) {
                    if (typeof row.alias !== 'string' || !row.alias.trim()) {
                        continue
                    }
                    const alias = row.alias.trim()
                    if (!names.has(alias.toLowerCase())) {
                        names.set(alias.toLowerCase(), alias)
                    }
                }
            }
        }
        return [...names.values()]
    }, [data, kind])
    const cloneForEdit      = () => {
        if (!parsed.document) {
            return
        }
        const document     = parsed.document.clone()
        const replacements = new Map<Alias, Node>()
        visit(document, {
            Alias: (_key, node) => {
                replacements.set(node, Object.assign(document.createNode(node.toJS(document)), {
                    comment: node.comment, commentBefore: node.commentBefore, spaceBefore: node.spaceBefore,
                }))
            },
        })
        visit(document, { Alias: (_key, node) => replacements.get(node) })
        return document
    }
    const applyAliasChange  = (alias: string, next?: string) => {
        if (current.current.disabled || current.current.kind !== kind || current.current.value !== value) {
            throw new Error(t('config_management.confirmation_changed'))
        }
        const document = cloneForEdit()
        if (!document) {
            return
        }
        const key = alias.trim().toLowerCase()
        for (const [provider, rows] of Object.entries(data ?? {})) {
            let removed = 0
            for (let index = rows.length - 1; index >= 0; --index) {
                const name = rows[index].alias
                if (typeof name !== 'string' || name.trim().toLowerCase() !== key) {
                    continue
                }
                if (next === undefined) {
                    document.deleteIn([provider, index]);
                    ++removed
                } else {
                    document.setIn([provider, index, 'alias'], next)
                }
            }
            if (removed > 0 && removed === rows.length) {
                document.deleteIn([provider])
            }
        }
        const text            = document.toString()
        const validationError = getOAuthModelAliasError(text)
        if (validationError) {
            throw new Error(t(`config_management.visual.validation.${validationError}`))
        }
        current.current.onChange(text)
    }
    const renameAlias       = () => {
        if (!renameDraft || disabled) {
            return
        }
        const next  = renameDraft.value.trim()
        let message = ''
        if (renameDraft.source !== value) {
            message = t('config_management.confirmation_changed')
        } else if (!next) {
            message = t('oauth_model_alias.diagram_please_enter_alias')
        } else if (next === renameDraft.alias) {
            setRenameDraft(null);
            return
        } else if (aliases.some((alias) => alias.toLowerCase() !== renameDraft.alias.toLowerCase() &&
                                           alias.toLowerCase() === next.toLowerCase())) {
            message = t('oauth_model_alias.diagram_alias_exists')
        }
        if (message) {
            setRenameDraft({ ...renameDraft, error: message });
            return
        }
        try {
            applyAliasChange(renameDraft.alias, next)
            returnFocusId.current = `${inputId}-rename-${encodeURIComponent(next.toLowerCase())}`
            setRenameDraft(null)
        } catch (cause: unknown) {
            setRenameDraft({ ...renameDraft, error: cause instanceof Error ? cause.message : String(cause) })
        }
    }
    const confirmRemoval    = (title: string, message: ReactNode, remove: () => void) => {
        if (disabled) {
            return
        }
        showConfirmation({
                             title, message, variant: 'danger',
                             onConfirm: () => {
                                 try {
                                     if (current.current.disabled ||
                                         current.current.kind !==
                                         kind ||
                                         current.current.value !==
                                         value) {
                                         // noinspection ExceptionCaughtLocallyJS
                                         throw new Error(t('config_management.confirmation_changed'))
                                     }
                                     remove()
                                 } catch (cause: unknown) {
                                     showNotification(cause instanceof Error ? cause.message : String(cause), 'error')
                                     throw cause
                                 }
                             },
                         })
    }
    const deleteAlias       = (alias: string) => confirmRemoval(
        t('oauth_model_alias.delete_alias_title'),
        <Trans i18nKey='oauth_model_alias.delete_alias_confirm' values={{ alias }} components={{ code: <code /> }} />,
        () => applyAliasChange(alias),
    )
    const commit            = (path: Array<string | number>, next: unknown) => {
        const document = cloneForEdit()
        if (!document) {
            return
        }
        if (next === undefined) {
            document.deleteIn(path)
        } else {
            document.setIn(path, next)
        }
        onChange(document.toString())
    }
    const removeRule        = (provider: string, index: number, rule: Record<string, unknown>) => {
        const remove = () => commit([provider, index], undefined)
        if (kind !== 'aliases') {
            remove();
            return
        }
        confirmRemoval(
            t('oauth_model_alias.delete_link_title'),
            <Trans i18nKey='oauth_model_alias.delete_link_confirm' values={{
                provider,
                sourceModel: String(rule.name ?? '').trim(), alias: String(rule.alias ?? '').trim(),
            }}
                   components={{ code: <code /> }} />, remove,
        )
    }
    const removeProvider    = (provider: string) => {
        const remove = () => commit([provider], undefined)
        if (kind !== 'aliases') {
            remove();
            return
        }
        confirmRemoval(t('oauth_model_alias.delete'), t('oauth_model_alias.delete_confirm', { provider }), remove)
    }
    const addChannel        = () => {
        if (!normalizedChannel || duplicateChannel) {
            return
        }
        commit([normalizedChannel], [])
        setChannel('')
    }
    const updateErrorRules  = (
        provider: string, previous: RequestScopedErrorRule[], next: RequestScopedErrorRule[],
    ) => {
        const document = cloneForEdit()
        const sequence = document?.getIn([provider], true)
        if (!document || !isSeq(sequence)) {
            return
        }
        const toYaml   = (rule: RequestScopedErrorRule) => ({
            status: rule.status, match: rule.match, 'match-regexr': rule.matchRegex, action: rule.action,
        })
        const items    = [...sequence.items]
        sequence.items = next.map((rule, index) => {
            const original = previous.indexOf(rule)
            if (original >= 0) {
                return items[original]
            }
            // The rule editor replaces a single row on field edits and otherwise preserves row identities.
            const item = items[index]
            if (previous.length === next.length && isMap(item)) {
                patchKnownYamlFields(document, item, toYaml(previous[index]!), toYaml(rule))
                return item
            }
            return document.createNode(toYaml(rule))
        })
        onChange(document.toString())
    }

    if (!data) {
        return <div className='form-group'>
            <div role='alert' className='error-box'>{parsed.error}</div>
            <textarea className='input' value={value} disabled={disabled}
                      aria-label={t('config_management.visual.sections.advanced.oauth_rules_source')}
                      onChange={(event) => onChange(event.target.value)} />
        </div>
    }

    return <div className='form-group'>
        {error && <div role='alert' className='error-box'>{error}</div>}
        {aliases.length > 0 && <fieldset className='form-group' disabled={disabled}>
            <legend>{t('oauth_model_alias.diagram_aliases')}</legend>
            {aliases.map((alias) => <div key={alias}
                                         style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                <code>{alias}</code>
                <Button type='button' variant='secondary' size='sm' disabled={disabled}
                        id={`${inputId}-rename-${encodeURIComponent(alias.toLowerCase())}`}
                        aria-label={`${t('oauth_model_alias.diagram_rename_alias_title')}: ${alias}`}
                        onClick={() => {
                            returnFocusId.current = `${inputId}-rename-${encodeURIComponent(alias.toLowerCase())}`
                            setRenameDraft({ alias, value: alias, error: '', source: value })
                        }}>{t('oauth_model_alias.diagram_rename')}</Button>
                <Button type='button' variant='danger' size='sm' disabled={disabled}
                        aria-label={`${t('oauth_model_alias.diagram_delete_alias')}: ${alias}`}
                        onClick={() => deleteAlias(alias)}>{t('oauth_model_alias.diagram_delete_alias')}</Button>
            </div>)}
        </fieldset>}
        {kind === 'aliases' && <Modal open={renameDraft !== null}
                                      title={t('oauth_model_alias.diagram_rename_alias_title')}
                                      onClose={() => setRenameDraft(null)} initialFocusId={inputId}
                                      returnFocusId={returnFocusId.current}
                                      footer={<>
                                          <Button type='button' variant='secondary'
                                                  onClick={() => setRenameDraft(null)}>
                                              {t('common.cancel')}
                                          </Button>
                                          <Button type='button' disabled={disabled} onClick={renameAlias}>
                                              {t('oauth_model_alias.diagram_rename_btn')}
                                          </Button>
                                      </>}>
            <Input id={inputId} autoFocus label={t('oauth_model_alias.diagram_rename_alias_label')}
                   placeholder={t('oauth_model_alias.diagram_rename_placeholder')} disabled={disabled}
                   value={renameDraft?.value ?? ''} error={renameDraft?.error || undefined}
                   onChange={(event) => {
                       if (renameDraft) {
                           setRenameDraft({ ...renameDraft, value: event.target.value, error: '' })
                       }
                   }} onKeyDown={(event) => {
                if (event.key === 'Enter') {
                    renameAlias()
                }
            }} />
        </Modal>}
        {channels.map((provider) => {
            const errorRules = kind === 'errors' ? data[provider].map((rule) => readRequestScopedErrorRule({
                                                                                                               status: typeof rule.status ===
                                                                                                                       'bigint' ||
                                                                                                                       typeof rule.status ===
                                                                                                                       'number' ?
                                                                                                                       Number(
                                                                                                                           rule.status) :
                                                                                                                       NaN,
                                                                                                               match: Array.isArray(
                                                                                                                   rule.match) ?
                                                                                                                      rule.match.map(
                                                                                                                          String) :
                                                                                                                      undefined,
                                                                                                               matchRegex: Array.isArray(
                                                                                                                   rule['match-regexr']) ?
                                                                                                                           rule['match-regexr'].map(
                                                                                                                               String) :
                                                                                                                           undefined,
                                                                                                               action: typeof rule.action ===
                                                                                                                       'string' ?
                                                                                                                       rule.action :
                                                                                                                       undefined,
                                                                                                           })) : []
            return <fieldset className='form-group' key={provider} disabled={disabled}>
                <legend>{provider}</legend>
                {kind !== 'errors' ?
                 <>
                     {data[provider].map((rule, index) => <div className='form-group' key={index}>
                         <Input label={t(`config_management.visual.sections.advanced.${kind === 'aliases' ?
                                                                                       'oauth_alias_name' :
                                                                                       'oauth_settings_name'}`)}
                                value={String(rule.name ?? '')} disabled={disabled}
                                onChange={(event) => commit([provider, index, 'name'], event.target.value)} />
                         <Input label={t(`config_management.visual.sections.advanced.${kind === 'aliases' ?
                                                                                       'oauth_alias_alias' :
                                                                                       'oauth_settings_alias'}`)}
                                value={String(rule.alias ?? '')} disabled={disabled} onChange={(event) => commit(
                             [provider, index, 'alias'],
                             kind === 'aliases' ? event.target.value : event.target.value || undefined,
                         )} />
                         {kind === 'aliases' ?
                          <>
                              <Input label={t('ai_providers.model_display_name_label')}
                                     value={typeof rule['display-name'] === 'string' ? rule['display-name'] : ''}
                                     disabled={disabled} onChange={(event) => commit(
                                  [provider, index, 'display-name'], event.target.value || undefined,
                              )} />
                              <label><input type='checkbox' checked={rule.fork === true} disabled={disabled}
                                            onChange={(event) => commit(
                                                [provider, index, 'fork'],
                                                event.target.checked,
                                            )} />
                                  {' '}{t('oauth_model_alias.alias_fork_label')}</label>
                              <label><input type='checkbox' checked={rule['force-mapping'] === true} disabled={disabled}
                                            onChange={(event) => commit(
                                                [provider, index, 'force-mapping'], event.target.checked || undefined,
                                            )} /> {t('ai_providers.model_force_mapping_label')}</label>
                          </> :
                          <Input label={t('config_management.visual.sections.advanced.oauth_settings_context')}
                                 type='number' step={1} placeholder='0'
                                 value={typeof rule['max-context-length'] === 'bigint' ||
                                        (typeof rule['max-context-length'] === 'number' &&
                                         !Number.isNaN(rule['max-context-length'])) ?
                                        String(rule['max-context-length']) : ''} disabled={disabled}
                                 onChange={(event) => {
                                     const raw  = event.target.value.trim()
                                     const next = event.target.validity.badInput || (raw && !/^[+-]?\d+$/.test(raw)) ?
                                                  NaN :
                                                  raw ? Number(raw) : undefined
                                     commit([provider, index, 'max-context-length'], next)
                                 }} />}
                         <Button type='button' variant='danger' size='sm' disabled={disabled}
                                 onClick={() => removeRule(provider, index, rule)}>{t('common.delete')}</Button>
                     </div>)}
                     <Button type='button' variant='secondary' size='sm' disabled={disabled} onClick={() => commit(
                         [provider, data[provider].length],
                         kind === 'aliases' ? { name: '', alias: '' } : { name: '' },
                     )}>{t(`config_management.visual.sections.advanced.${kind === 'aliases' ?
                                                                         'oauth_alias_add' :
                                                                         'oauth_settings_add'}`)}</Button>
                 </> :
                 <RequestScopedErrorsField disabled={disabled} rules={errorRules}
                                           onChange={(rules) => updateErrorRules(provider, errorRules, rules)} />}
                <Button type='button' variant='ghost' size='sm' disabled={disabled}
                        onClick={() => removeProvider(provider)}>
                    {t('config_management.visual.sections.advanced.oauth_rules_remove_provider')}
                </Button>
            </fieldset>
        })}
        <Input label={t('credentials.inspection_provider')} value={channel} placeholder='codex' disabled={disabled}
               onChange={(event) => setChannel(event.target.value)} />
        <Button type='button' variant='secondary' size='sm'
                disabled={disabled || !normalizedChannel || duplicateChannel} onClick={addChannel}>{t(
            'config_management.visual.sections.advanced.oauth_rules_add_provider')}</Button>
    </div>
}
