import {SelectionCheckbox} from '@/components/ui/SelectionCheckbox'
import type {ModelInfo} from '@/utils/models'
import styles from './ProviderEditForm.module.scss'

interface ModelCheckboxListProps {
    models: ModelInfo[]
    selected: Set<string>
    onToggle: (name: string) => void
}

export function ModelCheckboxList({ models, selected, onToggle }: ModelCheckboxListProps) {
    return (
        <div className={styles.modelDiscoveryList}>
            {models.map((model) => {
                const checked = selected.has(model.name)
                return (
                    <div
                        key={model.name}
                        className={`${styles.modelDiscoveryRow} ${checked ? styles.modelDiscoveryRowSelected : ''}`}
                    >
                        <SelectionCheckbox
                            checked={checked}
                            onChange={() => onToggle(model.name)}
                            ariaLabel={model.name}
                        />
                        <button
                            type='button'
                            className={styles.modelDiscoveryMeta}
                            onClick={() => onToggle(model.name)}
                        >
                            <span className={styles.modelDiscoveryName}>
                                {model.name}
                                {model.alias && <span className={styles.modelDiscoveryAlias}>{model.alias}</span>}
                            </span>
                            {model.description &&
                             <span className={styles.modelDiscoveryDesc}>{model.description}</span>}
                        </button>
                    </div>
                )
            })}
        </div>
    )
}
