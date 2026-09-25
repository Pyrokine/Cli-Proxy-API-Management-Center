import {IconX} from '@/components/ui/icons'
import {useNotificationStore} from '@/stores'
import type {Notification} from '@/types'
import {NOTIFICATION_DURATION_MS} from '@/utils/constants'
import {useCallback, useEffect, useRef, useState, type RefObject} from 'react'
import {useTranslation} from 'react-i18next'
import {createNotificationTimer} from './notificationTimer'

interface AnimatedNotification extends Notification {
    isExiting?: boolean
}

const ANIMATION_DURATION = 300 // ms

function NotificationCard({notification, onExited, returnFocusRef}: {
    notification: AnimatedNotification
    onExited: (id: string) => void
    returnFocusRef: RefObject<HTMLElement | null>
}) {
    const {t} = useTranslation()
    const removeNotification = useNotificationStore((state) => state.removeNotification)
    const {id, type, message, duration = NOTIFICATION_DURATION_MS, isExiting} = notification
    const cardRef = useRef<HTMLDivElement>(null)
    const [readableTimer] = useState(() => createNotificationTimer(duration, () => removeNotification(id)))

    useEffect(() => {
        if (isExiting) {
            readableTimer.dispose()
            const exitTimer = setTimeout(() => onExited(id), ANIMATION_DURATION)
            return () => clearTimeout(exitTimer)
        }
        const syncVisibility = () => readableTimer.setPaused('hidden', document.hidden)
        syncVisibility()
        readableTimer.setPaused('hover', Boolean(cardRef.current?.matches(':hover')))
        readableTimer.setPaused('focus', Boolean(cardRef.current?.contains(document.activeElement)))
        readableTimer.start()
        document.addEventListener('visibilitychange', syncVisibility)
        return () => {
            document.removeEventListener('visibilitychange', syncVisibility)
            readableTimer.stop()
        }
    }, [id, isExiting, onExited, readableTimer])

    const dismiss = (immediate: boolean) => {
        const card = cardRef.current
        if (card?.contains(document.activeElement)) {
            const buttons = Array.from(card.parentElement?.querySelectorAll<HTMLButtonElement>(
                '.notification:not(.exiting) .close-btn:not(:disabled)',
            ) ?? [])
            const index = buttons.indexOf(card.querySelector<HTMLButtonElement>('.close-btn')!)
            const target = buttons[index + 1] ?? buttons[index - 1] ?? returnFocusRef.current
            if (target?.isConnected && !target.closest('[inert]') && !target.matches(':disabled')) {
                target.focus({preventScroll: true})
            }
        }
        readableTimer.dispose()
        removeNotification(id)
        if (immediate) {
            onExited(id)
        }
    }

    return (
        <div
            ref={cardRef}
            className={`notification ${type} ${isExiting ? 'exiting' : 'entering'}`}
            aria-hidden={isExiting || undefined}
            inert={isExiting || undefined}
            onPointerEnter={(event) => {
                if (event.pointerType !== 'touch') {
                    readableTimer.setPaused('hover', true)
                }
            }}
            onPointerLeave={() => readableTimer.setPaused('hover', false)}
            onFocusCapture={() => readableTimer.setPaused('focus', true)}
            onBlurCapture={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) {
                    readableTimer.setPaused('focus', false)
                }
            }}
            onKeyDown={(event) => {
                if (event.key === 'Escape') {
                    event.preventDefault()
                    event.stopPropagation()
                    dismiss(true)
                }
            }}
        >
            <div className='message' role={type === 'error' ? 'alert' : 'status'} aria-atomic='true'>{message}</div>
            <button
                type='button'
                className='close-btn'
                onClick={(event) => dismiss(event.detail === 0)}
                disabled={isExiting}
                aria-label={t('common.close')}
            >
                <IconX size={16} />
            </button>
        </div>
    )
}

export function NotificationContainer() {
    const {t} = useTranslation()
    const notifications = useNotificationStore((state) => state.notifications)
    const [rendered, setRendered] = useState<{source: Notification[]; items: AnimatedNotification[]}>({
        source: notifications, items: notifications,
    })
    const returnFocusRef = useRef<HTMLElement | null>(null)

    if (rendered.source !== notifications) {
        const current = new Map(notifications.map((notification) => [notification.id, notification]))
        const previousIds = new Set(rendered.items.map((notification) => notification.id))
        setRendered({
            source: notifications,
            items: [
                ...rendered.items.map((notification) => current.get(notification.id) ?? {...notification, isExiting: true}),
                ...notifications.filter((notification) => !previousIds.has(notification.id)),
            ],
        })
    }

    const handleExited = useCallback((id: string) => {
        if (!useNotificationStore.getState().notifications.some((notification) => notification.id === id)) {
            setRendered((previous) => ({...previous, items: previous.items.filter((notification) => notification.id !== id)}))
        }
    }, [])

    return (
        <section
            className='notification-container'
            aria-label={t('notifications.title')}
            onFocusCapture={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) {
                    returnFocusRef.current = event.relatedTarget instanceof HTMLElement ? event.relatedTarget : null
                }
            }}
        >
            {rendered.items.map((notification) => (
                <NotificationCard key={notification.id} notification={notification} onExited={handleExited} returnFocusRef={returnFocusRef} />
            ))}
        </section>
    )
}
