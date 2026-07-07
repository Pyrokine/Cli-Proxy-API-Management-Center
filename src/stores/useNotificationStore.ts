/**
 * 通知状态管理
 * Toast 通知 + 确认弹窗 + 持久通知中心
 */

import type {Notification, NotificationType} from '@/types'
import {NOTIFICATION_DURATION_MS} from '@/utils/constants'
import {generateId} from '@/utils/helpers'
import type {NotificationSourceId} from '@/utils/notifications'
import type {ReactNode} from 'react'
import {create} from 'zustand'

interface ConfirmationOptions {
    title?: string
    message: ReactNode
    confirmText?: string
    cancelText?: string
    variant?: 'danger' | 'primary' | 'secondary'
    confirmDisabled?: boolean
    onConfirm: () => void | Promise<void>
    onCancel?: () => void
}

/** 持久通知（通知中心面板） */
export interface PersistentNotification {
    id: string
    message: string
    type: NotificationType
    timestamp: number
    read: boolean
    /** 来源标识，见 utils/notifications.ts NotificationSourceId */
    source: NotificationSourceId
    dedupeKey?: string
}

interface PersistentNotificationOptions {
    dedupeKey?: string
}

interface NotificationState {
    // Toast 通知
    notifications: Notification[]
    showNotification: (message: string, type?: NotificationType, duration?: number) => void
    removeNotification: (id: string) => void

    // 确认弹窗
    confirmation: {
        isOpen: boolean
        isLoading: boolean
        options: ConfirmationOptions | null
    }
    showConfirmation: (options: ConfirmationOptions) => void
    hideConfirmation: () => void
    setConfirmationLoading: (loading: boolean) => void

    // 持久通知中心
    persistentNotifications: PersistentNotification[]
    panelOpen: boolean
    addPersistentNotification: (
        message: string,
        type: NotificationType,
        source: NotificationSourceId,
        options?: PersistentNotificationOptions,
    ) => void
    markAsRead: (id: string) => void
    markAllAsRead: () => void
    clearAllPersistent: () => void
    togglePanel: () => void
    closePanel: () => void
    unreadCount: () => number
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
    notifications: [],
    confirmation: {
        isOpen: false,
        isLoading: false,
        options: null,
    },
    persistentNotifications: [],
    panelOpen: false,

    showNotification: (message, type = 'info', duration = NOTIFICATION_DURATION_MS) => {
        const id                         = generateId()
        const notification: Notification = {
            id,
            message,
            type,
            duration,
        }

        set((state) => ({
            notifications: [...state.notifications, notification],
        }))

        // 自动移除通知
        if (duration > 0) {
            setTimeout(() => {
                set((state) => ({
                    notifications: state.notifications.filter((n) => n.id !== id),
                }))
            }, duration)
        }
    },

    removeNotification: (id) => {
        set((state) => ({
            notifications: state.notifications.filter((n) => n.id !== id),
        }))
    },

    showConfirmation: (options) => {
        set({
                confirmation: {
                    isOpen: true,
                    isLoading: false,
                    options,
                },
            })
    },

    hideConfirmation: () => {
        set((state) => ({
            confirmation: {
                ...state.confirmation,
                isOpen: false,
                options: null, // Cleanup
            },
        }))
    },

    setConfirmationLoading: (loading) => {
        set((state) => ({
            confirmation: {
                ...state.confirmation,
                isLoading: loading,
            },
        }))
    },

    // 持久通知中心
    addPersistentNotification: (message, type, source, options) => {
        const notification: PersistentNotification = {
            id: generateId(),
            message,
            type,
            timestamp: Date.now(),
            read: false,
            source,
            dedupeKey: options?.dedupeKey,
        }
        set((state) => {
            if (options?.dedupeKey) {
                const index = state.persistentNotifications.findIndex((item) => item.dedupeKey === options.dedupeKey)
                if (index >= 0) {
                    const next  = [...state.persistentNotifications]
                    next[index] = {
                        ...next[index],
                        ...notification,
                        id: next[index].id,
                        read: next[index].read,
                        timestamp: next[index].timestamp,
                    }
                    return { persistentNotifications: next }
                }
            }
            return {
                persistentNotifications: [notification, ...state.persistentNotifications].slice(0, 100),
            }
        })
    },

    markAsRead: (id) => {
        set((state) => ({
            persistentNotifications: state.persistentNotifications.map((n) => (n.id === id ? { ...n, read: true } : n)),
        }))
    },

    markAllAsRead: () => {
        set((state) => ({
            persistentNotifications: state.persistentNotifications.map((n) => ({ ...n, read: true })),
        }))
    },

    clearAllPersistent: () => {
        set({ persistentNotifications: [] })
    },

    togglePanel: () => {
        set((state) => ({ panelOpen: !state.panelOpen }))
    },

    closePanel: () => {
        set({ panelOpen: false })
    },

    unreadCount: () => {
        return get().persistentNotifications.filter((n) => !n.read).length
    },
}))
