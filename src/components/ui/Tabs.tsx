import type {ReactNode} from 'react'
import styles from './Tabs.module.scss'

export type TabItem<T extends string = string> = {
    value: T
    label: ReactNode
    disabled?: boolean
}

type TabsProps<T extends string = string> = {
    items: ReadonlyArray<TabItem<T>>
    activeValue: T
    onChange: (value: T) => void
    ariaLabel?: string
    className?: string
    size?: 'sm' | 'md'
}

export function Tabs<T extends string = string>({
                                                    items,
                                                    activeValue,
                                                    onChange,
                                                    ariaLabel,
                                                    className = '',
                                                    size = 'md',
                                                }: TabsProps<T>) {
    const rootClassName = [styles.root, size === 'sm' ? styles.rootSm : '', className].filter(Boolean).join(' ')

    return (
        <div className={rootClassName} role='tablist' aria-label={ariaLabel}>
            {items.map((item) => {
                const active = item.value === activeValue
                return (
                    <button
                        key={item.value}
                        type='button'
                        role='tab'
                        aria-selected={active}
                        className={`${styles.item} ${active ? styles.active : ''}`}
                        disabled={item.disabled}
                        onClick={() => onChange(item.value)}
                    >
                        {item.label}
                    </button>
                )
            })}
        </div>
    )
}
