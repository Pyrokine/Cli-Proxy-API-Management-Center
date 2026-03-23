import {type ReactNode, useCallback, useState} from 'react'
import styles from './Tabs.module.scss'

export interface TabItem {
    key: string;
    label: string;
    icon?: ReactNode;
}

interface TabsProps {
    items: TabItem[];
    activeKey?: string;
    defaultActiveKey?: string;
    onChange?: (key: string) => void;
    children: (activeKey: string) => ReactNode;
    className?: string;
}

const TABS_STORAGE_KEY = 'cli-proxy-usage-active-tab'

export function Tabs({ items, activeKey: controlledKey, defaultActiveKey, onChange, children, className }: TabsProps) {
    const [internalKey, setInternalKey] = useState(() => {
        if (defaultActiveKey) {
            return defaultActiveKey
        }
        try {
            const stored = localStorage.getItem(TABS_STORAGE_KEY)
            if (stored && items.some((item) => item.key === stored)) {
                return stored
            }
        } catch {
            /* ignore */
        }
        return items[0]?.key ?? ''
    })

    const activeKey = controlledKey ?? internalKey

    const handleTabClick = useCallback(
        (key: string) => {
            if (!controlledKey) {
                setInternalKey(key)
                try {
                    localStorage.setItem(TABS_STORAGE_KEY, key)
                } catch {
                    /* ignore */
                }
            }
            onChange?.(key)
        },
        [controlledKey, onChange],
    )

    return (
        <div className={`${styles.container} ${className ?? ''}`}>
            <div className={styles.tabBar} role='tablist'>
                {items.map((item) => (
                    <button
                        key={item.key}
                        type='button'
                        role='tab'
                        aria-selected={item.key === activeKey}
                        className={`${styles.tab} ${item.key === activeKey ? styles.tabActive : ''}`}
                        onClick={() => handleTabClick(item.key)}
                    >
                        {item.icon && <span className={styles.tabIcon}>{item.icon}</span>}
                        <span>{item.label}</span>
                    </button>
                ))}
            </div>
            <div className={styles.tabContent} role='tabpanel'>
                {children(activeKey)}
            </div>
        </div>
    )
}
