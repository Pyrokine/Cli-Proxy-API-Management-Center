import {Button} from '@/components/ui/Button'
import {Input} from '@/components/ui/Input'
import {Modal} from '@/components/ui/Modal'
import type {ModelInfo} from '@/utils/models'
import {useTranslation} from 'react-i18next'
import {ModelCheckboxList} from './ModelCheckboxList'
import styles from './ProviderEditForm.module.scss'

interface ProviderModelSelectionContentProps {
    i18nPrefix: string
    endpoint: string
    discoveredModels: ModelInfo[]
    filteredModels: ModelInfo[]
    fetching: boolean
    error: string
    search: string
    onSearchChange: (value: string) => void
    selected: Set<string>
    missingCount: number
    onToggleSelection: (name: string) => void
    onSelectMissing: () => void
    onRefresh: () => void
    disabled: boolean
    hint?: string
    loadingLabel?: string
    emptyLabel?: string
}

export function ProviderModelSelectionContent({
                                                  i18nPrefix,
                                                  endpoint,
                                                  discoveredModels,
                                                  filteredModels,
                                                  fetching,
                                                  error,
                                                  search,
                                                  onSearchChange,
                                                  selected,
                                                  missingCount,
                                                  onToggleSelection,
                                                  onSelectMissing,
                                                  onRefresh,
                                                  disabled,
                                                  hint,
                                                  loadingLabel,
                                                  emptyLabel,
                                              }: ProviderModelSelectionContentProps) {
    const { t } = useTranslation()

    return (
        <div className={styles.openaiModelsContent}>
            <div className={styles.sectionHint}>{hint ?? t(`ai_providers.${i18nPrefix}_fetch_hint`)}</div>
            <div className={styles.openaiModelsEndpointSection}>
                <label className={styles.openaiModelsEndpointLabel}>
                    {t(`ai_providers.${i18nPrefix}_fetch_url_label`)}
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
                        {t(`ai_providers.${i18nPrefix}_fetch_refresh`)}
                    </Button>
                </div>
            </div>
            <Input
                label={t(`ai_providers.${i18nPrefix}_search_label`)}
                placeholder={t(`ai_providers.${i18nPrefix}_search_placeholder`)}
                value={search}
                onChange={(event) => onSearchChange(event.target.value)}
                disabled={fetching}
            />
            <div className={styles.openaiModelsSelectionActions}>
                <Button
                    variant='secondary'
                    size='sm'
                    onClick={onSelectMissing}
                    disabled={disabled || fetching || missingCount === 0}
                >
                    {t('ai_providers.models_select_missing', { count: missingCount })}
                </Button>
            </div>
            {error && <div className='error-box'>{error}</div>}
            {fetching ? (
                <div className={styles.sectionHint}>
                    {loadingLabel ?? t(`ai_providers.${i18nPrefix}_fetch_loading`)}
                </div>
            ) : discoveredModels.length === 0 ? (
                <div className={styles.sectionHint}>
                    {emptyLabel ?? t(`ai_providers.${i18nPrefix}_fetch_empty`)}
                </div>
            ) : filteredModels.length === 0 ? (
                <div className={styles.sectionHint}>{t(`ai_providers.${i18nPrefix}_search_empty`)}</div>
            ) : (
                    <ModelCheckboxList models={filteredModels} selected={selected} onToggle={onToggleSelection} />
                )}
        </div>
    )
}

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
    missingCount: number
    onToggleSelection: (name: string) => void
    onSelectMissing: () => void
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
                                        missingCount,
                                        onToggleSelection,
                                        onSelectMissing,
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
            <ProviderModelSelectionContent
                i18nPrefix={`${i18nPrefix}_models`}
                endpoint={endpoint}
                discoveredModels={discoveredModels}
                filteredModels={filteredModels}
                fetching={fetching}
                error={error}
                search={search}
                onSearchChange={onSearchChange}
                selected={selected}
                missingCount={missingCount}
                onToggleSelection={onToggleSelection}
                onSelectMissing={onSelectMissing}
                onRefresh={onRefresh}
                disabled={disabled}
            />
        </Modal>
    )
}
