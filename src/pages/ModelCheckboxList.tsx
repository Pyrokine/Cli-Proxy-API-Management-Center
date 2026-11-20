import {Pagination} from '@/components/ui/Pagination'
import {SelectionCheckbox} from '@/components/ui/SelectionCheckbox'
import {usePagination} from '@/hooks/usePagination'
import type {ModelInfo} from '@/utils/models'
import {useRef} from 'react'
import {useTranslation} from 'react-i18next'
import styles from './ModelDiscovery.module.scss'

interface ModelCheckboxListProps {
    models: ModelInfo[]
    selected: Set<string>
    missingModelNames: Set<string>
    onToggle: (name: string) => void
    disabled?: boolean
}

export function ModelCheckboxList({
                                      models, selected, missingModelNames, onToggle, disabled = false,
                                  }: ModelCheckboxListProps) {
    const { t }                                                          = useTranslation()
    const listRef                                                        = useRef<HTMLDivElement>(null)
    const { currentItems, currentPage, pageSize, goToPage, setPageSize } = usePagination(models, 20)
    return (
        <div>
            <div className={styles.list} ref={listRef}>
                {currentItems.map((model) => {
                    const configured = !missingModelNames.has(model.name)
                    const checked    = configured || selected.has(model.name)
                    return (
                        <div
                            key={model.name}
                            className={[
                                styles.row,
                                checked ? styles.rowSelected : '',
                                configured ? styles.rowConfigured : '',
                            ].filter(Boolean).join(' ')}
                        >
                            <SelectionCheckbox
                                checked={checked}
                                disabled={disabled || !missingModelNames.has(model.name)}
                                onChange={() => onToggle(model.name)}
                                ariaLabel={model.name}
                            />
                            <button
                                type='button'
                                className={styles.model}
                                disabled={disabled || !missingModelNames.has(model.name)}
                                onClick={() => onToggle(model.name)}
                            >
                                <span className={styles.name}>{model.alias || model.name}</span>
                                {model.alias && model.alias !== model.name && (
                                    <span className={styles.alias}>{model.name}</span>
                                )}
                                {model.description && (
                                    <span className={styles.description}>{model.description}</span>
                                )}
                            </button>
                            <span className={styles.status}>
                                {t(configured ? 'ai_providers.models_already_configured' :
                                   'ai_providers.models_available_to_add')}
                            </span>
                        </div>
                    )
                })}
            </div>
            {models.length > pageSize && (
                <Pagination
                    total={models.length}
                    page={currentPage}
                    pageSize={pageSize}
                    pageSizeOptions={[20, 50]}
                    onPageChange={(page) => {
                        goToPage(page)
                        if (listRef.current) {
                            listRef.current.scrollTop = 0
                        }
                    }}
                    onPageSizeChange={(size) => {
                        setPageSize(size)
                        if (listRef.current) {
                            listRef.current.scrollTop = 0
                        }
                    }}
                />
            )}
        </div>
    )
}
