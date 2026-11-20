/**
 * 通知中心：铃铛图标 + 未读计数 + 下拉面板
 */
import {Button} from '@/components/ui/Button'
import {IconBell, IconCheckCheck, IconTrash2} from '@/components/ui/icons'
import {Pagination} from '@/components/ui/Pagination'
import {usePagination} from '@/hooks/usePagination'
import type {PersistentNotification} from '@/stores/useNotificationStore'
import {useNotificationStore} from '@/stores/useNotificationStore'
import {PERSISTENT_NOTIFICATION_SOURCES} from '@/utils/notifications'
import type {TFunction} from 'i18next'
import {useCallback, useEffect, useRef} from 'react'
import {useTranslation} from 'react-i18next'

import styles from './NotificationCenter.module.scss'

function formatRelativeTime(timestamp: number, t: TFunction): string {
    const diff    = Date.now() - timestamp
    const seconds = Math.floor(diff / 1000)
    if (seconds < 60) {
        return t('notifications.just_now')
    }
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) {
        return t('notifications.minutes_ago', { count: minutes })
    }
    const hours = Math.floor(minutes / 60)
    if (hours < 24) {
        return t('notifications.hours_ago', { count: hours })
    }
    const days = Math.floor(hours / 24)
    return t('notifications.days_ago', { count: days })
}

function NotificationItem({
                              item,
                              onClick,
                              t,
                          }: {
    item: PersistentNotification
    onClick: (id: string) => void
    t: TFunction
}) {
    const sourceLabel = t(PERSISTENT_NOTIFICATION_SOURCES[item.source]?.labelKey ?? 'notifications.sources.unknown')
    return (
        <div className={`${styles.item} ${!item.read ? styles.unread : ''}`} onClick={() => onClick(item.id)}>
            <span className={`${styles.itemDot} ${styles[item.type]}`} />
            <div className={styles.itemContent}>
                <div className={styles.itemMessage}>{item.message}</div>
                <div className={styles.itemMeta}>
                    <span className={styles.itemTime}>{formatRelativeTime(item.timestamp, t)}</span>
                    <span className={styles.itemSource}>{sourceLabel}</span>
                </div>
            </div>
        </div>
    )
}

export function NotificationCenter() {
    const { t }                   = useTranslation()
    const panelOpen               = useNotificationStore((s) => s.panelOpen)
    const persistentNotifications = useNotificationStore((s) => s.persistentNotifications)
    const togglePanel             = useNotificationStore((s) => s.togglePanel)
    const closePanel              = useNotificationStore((s) => s.closePanel)
    const markAsRead              = useNotificationStore((s) => s.markAsRead)
    const markAllAsRead           = useNotificationStore((s) => s.markAllAsRead)
    const clearAllPersistent      = useNotificationStore((s) => s.clearAllPersistent)
    const unreadCount             = useNotificationStore((s) => s.unreadCount)

    const { currentItems, currentPage, pageSize, goToPage, setPageSize } = usePagination(persistentNotifications, 5)
    const count                                                          = unreadCount()
    const wrapperRef                                                     = useRef<HTMLDivElement>(null)

    // 点击外部关闭面板
    useEffect(() => {
        if (!panelOpen) {
            return
        }
        const handler = (e: MouseEvent) => {
            if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
                closePanel()
            }
        }
        document.addEventListener('mousedown', handler)
        return () => document.removeEventListener('mousedown', handler)
    }, [panelOpen, closePanel])

    const handleItemClick = useCallback(
        (id: string) => {
            markAsRead(id)
        },
        [markAsRead],
    )

    return (
        <div className={styles.wrapper} ref={wrapperRef}>
            <Button
                variant='ghost'
                size='sm'
                onClick={togglePanel}
                title={t('notifications.title')}
                className={styles.bellButton}
            >
                <IconBell size={16} />
                {count > 0 && <span className={styles.badge}>{count > 99 ? '99+' : count}</span>}
            </Button>

            {panelOpen && (
                <div className={styles.panel}>
                    <div className={styles.panelHeader}>
                        <span className={styles.panelTitle}>{t('notifications.title')}</span>
                        <div className={styles.panelActions}>
                            <Button
                                variant='ghost'
                                size='sm'
                                onClick={markAllAsRead}
                                disabled={count === 0}
                                title={t('notifications.mark_all_read')}
                            >
                                <IconCheckCheck size={14} />
                            </Button>
                            <Button
                                variant='ghost'
                                size='sm'
                                onClick={clearAllPersistent}
                                disabled={persistentNotifications.length === 0}
                                title={t('notifications.clear_all')}
                            >
                                <IconTrash2 size={14} />
                            </Button>
                        </div>
                    </div>
                    <div className={styles.panelBody}>
                        {persistentNotifications.length === 0 ? (
                            <div className={styles.empty}>{t('notifications.empty')}</div>
                        ) : (
                             currentItems.map((item) => (
                                 <NotificationItem key={item.id} item={item} onClick={handleItemClick} t={t} />
                             ))
                         )}
                    </div>
                    {persistentNotifications.length >
                     pageSize &&
                     <Pagination total={persistentNotifications.length} page={currentPage} pageSize={pageSize}
                                 pageSizeOptions={[5, 10, 20]} onPageChange={goToPage}
                                 onPageSizeChange={setPageSize} />}
                </div>
            )}
        </div>
    )
}
