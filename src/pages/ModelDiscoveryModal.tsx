import {Button} from '@/components/ui/Button'
import {Input} from '@/components/ui/Input'
import {Modal} from '@/components/ui/Modal'
import type {ModelInfo} from '@/utils/models'
import {useTranslation} from 'react-i18next'
import {ModelCheckboxList} from './ModelCheckboxList'
import styles from './ProviderEditForm.module.scss'

interface ModelDiscoveryModalProps {
    open: boolean
    onClose: () => void
    endpoint: string
    discoveredModels: ModelInfo[]
    filteredModels: ModelInfo[]
    fetching: boolean
    error: string
    search: string
    onSearchChange: (value: string) => void
    selected: Set<string>
    onToggleSelection: (name: string) => void
    onApply: () => void
    onRefresh: () => void
    canApply: boolean
    disabled: boolean
    /** Translation key prefix (e.g. 'codex', 'gemini') */
    i18nPrefix: string
}

export function ModelDiscoveryModal({
                                        open,
                                        onClose,
                                        endpoint,
                                        discoveredModels,
                                        filteredModels,
                                        fetching,
                                        error,
                                        search,
                                        onSearchChange,
                                        selected,
                                        onToggleSelection,
                                        onApply,
                                        onRefresh,
                                        canApply,
                                        disabled,
                                        i18nPrefix,
                                    }: ModelDiscoveryModalProps) {
    const { t } = useTranslation()

    return (
        <Modal
            open={open}
            title={t(`ai_providers.${i18nPrefix}_models_fetch_title`)}
            onClose={onClose}
            width={720}
            footer={
                <>
                    <Button variant='secondary' size='sm' onClick={onClose} disabled={fetching}>
                        {t('common.cancel')}
                    </Button>
                    <Button size='sm' onClick={onApply} disabled={!canApply}>
                        {t(`ai_providers.${i18nPrefix}_models_fetch_apply`)}
                    </Button>
                </>
            }
        >
            <div className={styles.openaiModelsContent}>
                <div className={styles.sectionHint}>{t(`ai_providers.${i18nPrefix}_models_fetch_hint`)}</div>
                <div className={styles.openaiModelsEndpointSection}>
                    <label className={styles.openaiModelsEndpointLabel}>
                        {t(`ai_providers.${i18nPrefix}_models_fetch_url_label`)}
                    </label>
                    <div className={styles.openaiModelsEndpointControls}>
                        <input className={`input ${styles.openaiModelsEndpointInput}`} readOnly value={endpoint} />
                        <Button
                            variant='secondary'
                            size='sm'
                            onClick={onRefresh}
                            loading={fetching}
                            disabled={disabled}
                        >
                            {t(`ai_providers.${i18nPrefix}_models_fetch_refresh`)}
                        </Button>
                    </div>
                </div>
                <Input
                    label={t(`ai_providers.${i18nPrefix}_models_search_label`)}
                    placeholder={t(`ai_providers.${i18nPrefix}_models_search_placeholder`)}
                    value={search}
                    onChange={(e) => onSearchChange(e.target.value)}
                    disabled={fetching}
                />
                {error && <div className='error-box'>{error}</div>}
                {fetching ? (
                    <div className={styles.sectionHint}>{t(`ai_providers.${i18nPrefix}_models_fetch_loading`)}</div>
                ) : discoveredModels.length === 0 ? (
                    <div className={styles.sectionHint}>{t(`ai_providers.${i18nPrefix}_models_fetch_empty`)}</div>
                ) : filteredModels.length === 0 ? (
                    <div className={styles.sectionHint}>{t(`ai_providers.${i18nPrefix}_models_search_empty`)}</div>
                ) : (
                        <ModelCheckboxList models={filteredModels} selected={selected} onToggle={onToggleSelection} />
                    )}
            </div>
        </Modal>
    )
}
