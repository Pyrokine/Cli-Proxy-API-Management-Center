import {Button} from '@/components/ui/Button'
import {Input} from '@/components/ui/Input'
import {Modal} from '@/components/ui/Modal'
import {ToggleSwitch} from '@/components/ui/ToggleSwitch'
import type {ModelInfo} from '@/utils/models'
import {useId, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {ModelCheckboxList} from './ModelCheckboxList'
import styles from './ModelDiscovery.module.scss'

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
    missingModelNames: Set<string>
    onToggleSelection: (name: string) => void
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
                                                  filteredModels: matchingModels,
                                                  fetching,
                                                  error,
                                                  search,
                                                  onSearchChange,
                                                  selected,
                                                  missingModelNames,
                                                  onToggleSelection,
                                                  onRefresh,
                                                  disabled,
                                                  hint,
                                                  loadingLabel,
                                                  emptyLabel,
                                              }: ProviderModelSelectionContentProps) {
    const { t }                           = useTranslation()
    const endpointId                      = useId()
    const [onlySelected, setOnlySelected] = useState(false)
    const filteredModels                  = onlySelected ?
                                            matchingModels.filter((model) => selected.has(model.name)) : matchingModels
    const selectableCount                 = filteredModels.filter((model) => missingModelNames.has(model.name)).length
    const selectMatching                  = (checked: boolean) => {
        if (disabled || fetching) {
            return
        }
        filteredModels.forEach((model) => {
            if (missingModelNames.has(model.name) && selected.has(model.name) !== checked) {
                onToggleSelection(model.name)
            }
        })
    }

    return (
        <div className={styles.content}>
            <div className={styles.hint}>{hint ?? t(`ai_providers.${i18nPrefix}_fetch_hint`)}</div>
            <div className={styles.endpoint}>
                <label htmlFor={endpointId}>{t(`ai_providers.${i18nPrefix}_fetch_url_label`)}</label>
                <div className={styles.endpointControls}>
                    <input id={endpointId} className='input' readOnly value={endpoint} />
                    <Button
                        variant='secondary'
                        size='sm'
                        onClick={() => {
                            setOnlySelected(false)
                            onRefresh()
                        }}
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
            <div className={styles.selectionToolbar}>
                <div className={styles.selectionSummary} role='status'>
                    <span>{t('ai_providers.models_match_count', {
                        matching: filteredModels.length, total: discoveredModels.length,
                    })}</span>
                    <strong>{t('ai_providers.model_discovery_selected_count', { count: selected.size })}</strong>
                </div>
                <div className={styles.selectionActions}>
                    <ToggleSwitch checked={onlySelected} onChange={setOnlySelected}
                                  label={t('ai_providers.models_only_selected')} disabled={fetching} />
                    <Button variant='secondary' size='sm' onClick={() => selectMatching(true)}
                            disabled={disabled || fetching || selectableCount === 0}>
                        {t('ai_providers.models_select_visible', { count: selectableCount })}
                    </Button>
                    <Button variant='secondary' size='sm' onClick={() => selectMatching(false)}
                            disabled={disabled || fetching || selectableCount === 0}>
                        {t('ai_providers.models_clear_visible', { count: selectableCount })}
                    </Button>
                </div>
            </div>
            <div className={styles.hint}>{t('ai_providers.models_append_hint')}</div>
            {error && <div className='error-box' role='alert'>{error}</div>}
            {fetching ? (
                <div className={styles.hint}>
                    {loadingLabel ?? t(`ai_providers.${i18nPrefix}_fetch_loading`)}
                </div>
            ) : discoveredModels.length === 0 ? (
                <div className={styles.hint}>
                    {emptyLabel ?? t(`ai_providers.${i18nPrefix}_fetch_empty`)}
                </div>
            ) : filteredModels.length === 0 ? (
                <div className={styles.hint}>
                    {onlySelected && selected.size === 0 ?
                     t('ai_providers.models_selected_empty') : t(`ai_providers.${i18nPrefix}_search_empty`)}
                </div>
            ) : (
                    <ModelCheckboxList key={`${search}:${onlySelected}`} models={filteredModels} selected={selected}
                                       missingModelNames={missingModelNames} onToggle={onToggleSelection}
                                       disabled={disabled || fetching} />
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
    missingModelNames: Set<string>
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
                                        missingModelNames,
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
                    <Button variant='secondary' size='sm' onClick={onClose}>
                        {t('common.cancel')}
                    </Button>
                    <Button size='sm' onClick={onApply} disabled={!canApply}>
                        {t(`ai_providers.${i18nPrefix}_models_fetch_apply`)}{selected.size > 0 ?
                                                                             ` (${selected.size})` :
                                                                             ''}
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
                missingModelNames={missingModelNames}
                onToggleSelection={onToggleSelection}
                onRefresh={onRefresh}
                disabled={disabled}
            />
        </Modal>
    )
}
