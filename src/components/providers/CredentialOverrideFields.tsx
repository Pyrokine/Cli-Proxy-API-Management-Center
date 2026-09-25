import {Input} from '@/components/ui/Input'
import {Select} from '@/components/ui/Select'
import type {CredentialOverrides} from '@/types'
import {getCredentialRetryValidationKey} from '@/utils/credentialOverrides'
import {useId} from 'react'
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
