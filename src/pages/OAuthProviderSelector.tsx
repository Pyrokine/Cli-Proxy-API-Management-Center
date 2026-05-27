import {AutocompleteInput} from '@/components/ui/AutocompleteInput'
import {Card} from '@/components/ui/Card'
import {IconInfo} from '@/components/ui/icons'
import {normalizeProviderKey} from '@/features/authFiles/hooks/useOAuthProviderEditor'
import type {ReactNode} from 'react'
import styles from './OAuthProviderSelector.module.scss'

interface OAuthProviderSelectorProps {
    inputId: string
    title: string
    hint: string
    label: string
    description: string
    placeholder: string
    provider: string
    providerOptions: string[]
    disabled: boolean
    getTypeLabel: (type: string) => string
    onProviderChange: (value: string) => void
    children?: ReactNode
}

export function OAuthProviderSelector({
                                          inputId,
                                          title,
                                          hint,
                                          label,
                                          description,
                                          placeholder,
                                          provider,
                                          providerOptions,
                                          disabled,
                                          getTypeLabel,
                                          onProviderChange,
                                          children,
                                      }: OAuthProviderSelectorProps) {
    return (
        <Card className={styles.settingsCard}>
            <div className={styles.settingsHeader}>
                <div className={styles.settingsHeaderTitle}>
                    <IconInfo size={16} />
                    <span>{title}</span>
                </div>
                <div className={styles.settingsHeaderHint}>{hint}</div>
            </div>

            <div className={styles.settingsSection}>
                <div className={styles.settingsRow}>
                    <div className={styles.settingsInfo}>
                        <div className={styles.settingsLabel}>{label}</div>
                        <div className={styles.settingsDesc}>{description}</div>
                    </div>
                    <div className={styles.settingsControl}>
                        <AutocompleteInput
                            id={inputId}
                            placeholder={placeholder}
                            value={provider}
                            onChange={onProviderChange}
                            options={providerOptions}
                            disabled={disabled}
                            wrapperStyle={{ marginBottom: 0 }}
                        />
                    </div>
                </div>

                {providerOptions.length > 0 && (
                    <div className={styles.tagList}>
                        {providerOptions.map((option) => {
                            const isActive = normalizeProviderKey(provider) === option.toLowerCase()
                            return (
                                <button
                                    key={option}
                                    type='button'
                                    className={`${styles.tag} ${isActive ? styles.tagActive : ''}`}
                                    onClick={() => onProviderChange(option)}
                                    disabled={disabled}
                                >
                                    {getTypeLabel(option)}
                                </button>
                            )
                        })}
                    </div>
                )}

                {children}
            </div>
        </Card>
    )
}
