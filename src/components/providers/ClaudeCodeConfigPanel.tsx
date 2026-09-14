import type {ModelEntry} from '@/components/providers/types'
import {Button} from '@/components/ui/Button'
import {Select} from '@/components/ui/Select'
import {useAuthStore, useNotificationStore} from '@/stores'
import {
    CPA_API_KEY_PLACEHOLDER,
    selectClaudeCodeClientModel,
    serializeClaudeCodeClientConfig,
} from '@/utils/claudeCodeConfig'
import {copyToClipboard} from '@/utils/clipboard'
import {useId, useMemo, useState} from 'react'
import {useTranslation} from 'react-i18next'
import styles from './ClaudeCodeConfigPanel.module.scss'

interface ClaudeCodeConfigPanelProps {
    models: ModelEntry[]
    disabled?: boolean
}

const clientModelName = (entry: ModelEntry): string => entry.alias.trim() || entry.name.trim()

export function ClaudeCodeConfigPanel({ models, disabled = false }: ClaudeCodeConfigPanelProps) {
    const { t }                             = useTranslation()
    const idPrefix                          = useId()
    const titleId                           = `${idPrefix}-title`
    const modelId                           = `${idPrefix}-model`
    const apiBase                           = useAuthStore((state) => state.apiBase)
    const showNotification                  = useNotificationStore((state) => state.showNotification)
    const modelOptions                      = useMemo(() => {
        const seen = new Set<string>()
        return models.flatMap((entry) => {
            const model = clientModelName(entry)
            if (!model || seen.has(model.toLowerCase())) {
                return []
            }
            seen.add(model.toLowerCase())
            return [{ value: model, label: model }]
        })
    }, [models])
    const [selectedModel, setSelectedModel] = useState('')
    const resolvedModel                     = selectClaudeCodeClientModel(
        modelOptions.map((option) => option.value),
        selectedModel,
    )

    const serialized = useMemo(
        () => serializeClaudeCodeClientConfig(apiBase, resolvedModel),
        [apiBase, resolvedModel],
    )
    const canCopy    = Boolean(serialized) && !disabled

    const handleCopy = async () => {
        if (!serialized) {
            return
        }
        const copied = await copyToClipboard(serialized)
        showNotification(
            copied ? t('ai_providers.client_config_copy_success') : t('ai_providers.client_config_copy_failed'),
            copied ? 'success' : 'error',
        )
    }

    return (
        <section className={styles.panel} aria-labelledby={titleId}>
            <div className={styles.header}>
                <div>
                    <h3 id={titleId} className={styles.title}>
                        {t('ai_providers.client_config_title')}
                    </h3>
                    <p className={styles.hint}>{t('ai_providers.client_config_hint')}</p>
                </div>
                <Button variant='secondary' size='sm' onClick={() => void handleCopy()} disabled={!canCopy}>
                    {t('ai_providers.client_config_copy')}
                </Button>
            </div>

            {modelOptions.length > 0 ? (
                <div className={styles.modelField}>
                    <label className={styles.label} htmlFor={modelId}>
                        {t('ai_providers.client_config_model')}
                    </label>
                    <Select
                        id={modelId}
                        value={resolvedModel}
                        options={modelOptions}
                        onChange={setSelectedModel}
                        disabled={disabled}
                        ariaLabel={t('ai_providers.client_config_model')}
                    />
                </div>
            ) : (
                 <p className={styles.warning}>{t('ai_providers.client_config_model_required')}</p>
             )}

            {!apiBase.trim() && <p className={styles.warning}>{t('ai_providers.client_config_base_required')}</p>}
            {serialized && <pre className={styles.preview}>{serialized}</pre>}
            <p className={styles.hint}>
                {t('ai_providers.client_config_key_hint', { placeholder: CPA_API_KEY_PLACEHOLDER })}
            </p>
        </section>
    )
}
