import type { ModelInfo } from '@/utils/models'
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
                    <label
                        key={model.name}
                        className={`${styles.modelDiscoveryRow} ${checked ? styles.modelDiscoveryRowSelected : ''}`}
                    >
                        <input type="checkbox" checked={checked} onChange={() => onToggle(model.name)} />
                        <div className={styles.modelDiscoveryMeta}>
                            <div className={styles.modelDiscoveryName}>
                                {model.name}
                                {model.alias && <span className={styles.modelDiscoveryAlias}>{model.alias}</span>}
                            </div>
                            {model.description && <div className={styles.modelDiscoveryDesc}>{model.description}</div>}
                        </div>
                    </label>
                )
            })}
        </div>
    )
}
