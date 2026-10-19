import {Button} from '@/components/ui/Button'
import {Input} from '@/components/ui/Input'
import {Select} from '@/components/ui/Select'
import type {CredentialOverrides, RequestScopedErrorRule} from '@/types'
import {
    getCredentialRetryValidationKey,
    getRequestScopedErrorsValidationKey,
    REQUEST_SCOPED_ERROR_ACTIONS,
    updateRequestScopedErrorRule,
} from '@/utils/credentialOverrides'
import {useEffect, useId, useRef} from 'react'
import {useTranslation} from 'react-i18next'

interface CredentialOverrideFieldsProps extends CredentialOverrides {
    disabled: boolean
    onChange: (overrides: CredentialOverrides) => void
}

export function CredentialOverrideFields({
    disableCooling,
    requestRetry,
    disabled,
    onChange,
}: CredentialOverrideFieldsProps) {
    const {t} = useTranslation()
    const coolingId = useId()
    const retryError = getCredentialRetryValidationKey(requestRetry)

    return (
        <>
            <div className='form-group'>
                <label htmlFor={coolingId}>{t('auth_files.cooling_policy_label')}</label>
                <Select
                    id={coolingId}
                    value={disableCooling === undefined ? 'inherit' : String(disableCooling)}
                    options={[
                        {value: 'inherit', label: t('auth_files.cooling_inherit')},
                        {value: 'false', label: t('auth_files.cooling_enable')},
                        {value: 'true', label: t('auth_files.cooling_disable')},
                    ]}
                    onChange={(value) => onChange({disableCooling: value === 'inherit' ? undefined : value === 'true'})}
                    disabled={disabled}
                />
            </div>
            <Input
                label={t('auth_files.request_retry_label')}
                aria-label={t('auth_files.request_retry_label')}
                aria-invalid={Boolean(retryError)}
                hint={t('auth_files.request_retry_hint')}
                placeholder={t('auth_files.cooling_inherit')}
                error={retryError ? t(retryError) : undefined}
                type='number'
                step={1}
                min={Number.MIN_SAFE_INTEGER}
                max={Number.MAX_SAFE_INTEGER}
                value={requestRetry === undefined || Number.isNaN(requestRetry) ? '' : requestRetry}
                onChange={(event) => {
                    const raw = event.target.value.trim()
                    const value = event.target.validity.badInput || (raw !== '' && !/^[+-]?\d+$/.test(raw))
                        ? NaN
                        : raw === '' ? undefined : Number(raw)
                    onChange({requestRetry: value})
                }}
                disabled={disabled}
            />
        </>
    )
}

interface RequestScopedErrorsFieldProps {
    rules?: RequestScopedErrorRule[]
    onChange: (rules: RequestScopedErrorRule[]) => void
    disabled: boolean
}

export function RequestScopedErrorsField({rules, onChange, disabled}: RequestScopedErrorsFieldProps) {
    const {t} = useTranslation()
    const id = useId()
    const root = useRef<HTMLFieldSetElement>(null)
    const pendingFocus = useRef<string | null>(null)
    const current = rules ?? []
    const update = (index: number, patch: Partial<RequestScopedErrorRule>, conditionIndices?: number[]) =>
        onChange(current.map((rule, position) => position === index
            ? updateRequestScopedErrorRule(rule, patch, conditionIndices) : rule))

    useEffect(() => {
        if (!pendingFocus.current) {
            return
        }
        const target = document.getElementById(pendingFocus.current)
        if (target && root.current?.contains(target)) {
            target.focus()
        }
        pendingFocus.current = null
    }, [rules])

    return (
        <fieldset ref={root} className='form-group request-error-rules' disabled={disabled}>
            <legend>{t('ai_providers.error_rules_title')}</legend>
            <div className='hint'>{t('ai_providers.error_rules_hint')}</div>
            {current.map((rule, index) => {
                const statusId = `${id}-status-${index}`
                const actionId = `${id}-action-${index}`
                const textId = `${id}-text-${index}`
                const regexId = `${id}-regex-${index}`
                const validationKey = getRequestScopedErrorsValidationKey([rule])
                const updateConditions = (field: 'match' | 'matchRegex', values: string[], conditionIndices?: number[]) =>
                    update(index, field === 'match' ? {match: values} : {matchRegex: values}, conditionIndices)
                const renderConditions = (field: 'match' | 'matchRegex', labelKey: string, baseId: string) => {
                    const values = rule[field] ?? []
                    return (
                        <fieldset className='request-error-conditions'>
                            <legend>{t(labelKey)}</legend>
                            {values.map((value, conditionIndex) => (
                                <div key={conditionIndex} className='request-error-condition-row'>
                                    <textarea
                                        id={`${baseId}-${conditionIndex}`}
                                        className='input'
                                        rows={2}
                                        spellCheck={false}
                                        aria-label={`${t(labelKey)} ${conditionIndex + 1}`}
                                        value={value}
                                        onChange={(event) => updateConditions(field, values.map((entry, position) =>
                                            position === conditionIndex ? event.target.value : entry))}
                                        disabled={disabled}
                                    />
                                    <Button type='button' variant='ghost' size='sm' disabled={disabled}
                                        aria-label={`${t('ai_providers.error_rules_remove_condition')} ${conditionIndex + 1}`}
                                        onClick={() => {
                                            pendingFocus.current = values.length > 1
                                                ? `${baseId}-${Math.min(conditionIndex, values.length - 2)}`
                                                : `${baseId}-add`
                                            updateConditions(field, values.filter((_, position) =>
                                                position !== conditionIndex), values.map((_, position) => position)
                                                .filter((position) => position !== conditionIndex))
                                        }}>
                                        {t('ai_providers.error_rules_remove_condition')}
                                    </Button>
                                </div>
                            ))}
                            <Button id={`${baseId}-add`} type='button' variant='secondary' size='sm' disabled={disabled}
                                onClick={() => {
                                    pendingFocus.current = `${baseId}-${values.length}`
                                    updateConditions(field, [...values, ''])
                                }}>
                                {t(field === 'match'
                                   ? 'ai_providers.error_rules_add_match_text'
                                   : 'ai_providers.error_rules_add_match_regex')}
                            </Button>
                        </fieldset>
                    )
                }
                return (
                    <div key={index} className='form-group request-error-rule' role='group'
                        aria-label={t('ai_providers.error_rules_rule', {number: index + 1})}>
                        <label htmlFor={statusId}>{t('ai_providers.error_rules_status')}</label>
                        <input
                            id={statusId}
                            className='input'
                            type='number'
                            step={1}
                            min={1}
                            value={Number.isNaN(rule.status) ? '' : rule.status ?? ''}
                            onChange={(event) => {
                                const value = event.target.value.trim()
                                const status = event.target.validity.badInput || !/^\d+$/.test(value) ? NaN : Number(value)
                                update(index, {status})
                            }}
                            disabled={disabled}
                            aria-invalid={validationKey === 'ai_providers.error_rules_invalid_status'}
                        />
                        <label htmlFor={actionId}>{t('ai_providers.error_rules_action')}</label>
                        <Select
                            id={actionId}
                            value={rule.action ?? ''}
                            ariaLabel={t('ai_providers.error_rules_action')}
                            ariaInvalid={validationKey === 'ai_providers.error_rules_invalid_action'}
                            options={[
                                {value: '', label: t('ai_providers.error_rules_select_action')},
                                ...(rule.action && !REQUEST_SCOPED_ERROR_ACTIONS.some((action) => action === rule.action)
                                    ? [{value: rule.action, label: rule.action}] : []),
                                ...REQUEST_SCOPED_ERROR_ACTIONS.map((action) => ({
                                    value: action,
                                    label: t(`ai_providers.error_rules_action_${action.replace(/-/g, '_')}`),
                                })),
                            ]}
                            onChange={(action) => update(index, {action})}
                            disabled={disabled}
                        />
                        {renderConditions('match', 'ai_providers.error_rules_match_text', textId)}
                        {renderConditions('matchRegex', 'ai_providers.error_rules_match_regex', regexId)}
                        <div className='hint'>{t('ai_providers.error_rules_regex_hint')}</div>
                        {validationKey && <div role='status'>{t(validationKey)}</div>}
                        <div className='request-error-actions'>
                            <Button type='button' variant='secondary' size='sm' disabled={disabled || index === 0}
                                onClick={() => {
                                    pendingFocus.current = `${id}-status-${index - 1}`
                                    onChange(current.map((entry, position) =>
                                        position === index - 1 ? current[index] : position === index ? current[index - 1] : entry))
                                }}>
                                {t('ai_providers.error_rules_move_up')}
                            </Button>
                            <Button type='button' variant='secondary' size='sm'
                                disabled={disabled || index === current.length - 1}
                                onClick={() => {
                                    pendingFocus.current = `${id}-status-${index + 1}`
                                    onChange(current.map((entry, position) =>
                                        position === index + 1 ? current[index] : position === index ? current[index + 1] : entry))
                                }}>
                                {t('ai_providers.error_rules_move_down')}
                            </Button>
                            <Button type='button' variant='danger' size='sm' disabled={disabled}
                                onClick={() => {
                                    pendingFocus.current = current.length > 1
                                        ? `${id}-status-${Math.min(index, current.length - 2)}`
                                        : `${id}-add-rule`
                                    onChange(current.filter((_, position) => position !== index))
                                }}>
                                {t('ai_providers.error_rules_remove')}
                            </Button>
                        </div>
                    </div>
                )
            })}
            <Button id={`${id}-add-rule`} type='button' variant='secondary' size='sm' disabled={disabled}
                onClick={() => {
                    pendingFocus.current = `${id}-status-${current.length}`
                    onChange([...current, {status: 429, match: [''], action: 'continue'}])
                }}>
                {t('ai_providers.error_rules_add')}
            </Button>
        </fieldset>
    )
}
