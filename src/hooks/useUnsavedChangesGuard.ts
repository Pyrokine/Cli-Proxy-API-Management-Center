import {usePageTransitionLayer} from '@/components/common/PageTransitionLayer'
import {useNotificationStore} from '@/stores'
import {createElement, useCallback, useEffect, useMemo, useRef, useSyncExternalStore} from 'react'
import type {BlockerFunction} from 'react-router'
import {useBlocker, useLocation} from 'react-router'

type ConfirmationVariant = 'danger' | 'primary' | 'secondary'

type UnsavedChangesDialog = {
    title: string
    message: string
    confirmText: string
    cancelText: string
    variant?: ConfirmationVariant
}

type UseUnsavedChangesGuardOptions = {
    enabled?: boolean
    shouldBlock: boolean | BlockerFunction
    dialog: UnsavedChangesDialog
}

type GuardEntry = {
    id: number
    shouldBlock: BlockerFunction
    dialog: UnsavedChangesDialog
}

const guardEntries   = new Map<number, GuardEntry>()
const guardListeners = new Set<() => void>()
let nextGuardID      = 0

const subscribeGuards = (listener: () => void) => {
    guardListeners.add(listener)
    return () => guardListeners.delete(listener)
}

const notifyGuards = () => {
    guardListeners.forEach((listener) => listener())
}

const getActiveGuard = (): GuardEntry | null => {
    let activeGuard: GuardEntry | null = null
    for (const entry of guardEntries.values()) {
        activeGuard = entry
    }
    return activeGuard
}

const upsertGuard = (entry: GuardEntry) => {
    guardEntries.set(entry.id, entry)
    notifyGuards()
}

const removeGuard = (id: number) => {
    if (guardEntries.delete(id)) {
        notifyGuards()
    }
}

function UnsavedChangesBlocker({ activeGuard }: { activeGuard: GuardEntry }) {
    const { showConfirmation } = useNotificationStore()
    const lastBlockedRef       = useRef('')
    const blocker              = useBlocker(activeGuard.shouldBlock)

    const blockedKey = useMemo(() => {
        if (blocker.state !== 'blocked' || !blocker.location) {
            return ''
        }
        return `${blocker.location.pathname}${blocker.location.search}${blocker.location.hash}`
    }, [blocker.location, blocker.state])

    useEffect(() => {
        if (blocker.state !== 'blocked') {
            lastBlockedRef.current = ''
            return
        }
        if (!blockedKey || lastBlockedRef.current === blockedKey) {
            return
        }
        lastBlockedRef.current = blockedKey

        showConfirmation({
                             title: activeGuard.dialog.title,
                             message: activeGuard.dialog.message,
                             confirmText: activeGuard.dialog.confirmText,
                             cancelText: activeGuard.dialog.cancelText,
                             variant: activeGuard.dialog.variant ?? 'danger',
                             onConfirm: () => blocker.proceed(),
                             onCancel: () => blocker.reset(),
                         })
    }, [activeGuard, blockedKey, blocker, showConfirmation])

    return null
}

export function UnsavedChangesBlockerHost() {
    const activeGuard = useSyncExternalStore(subscribeGuards, getActiveGuard, getActiveGuard)
    if (!activeGuard) {
        return null
    }
    return createElement(UnsavedChangesBlocker, { activeGuard, key: activeGuard.id })
}

export function useUnsavedChangesGuard(options: UseUnsavedChangesGuardOptions) {
    const { enabled = true, shouldBlock, dialog } = options
    const pageTransitionLayer                     = usePageTransitionLayer()
    const isCurrentLayer                          = pageTransitionLayer ?
                                                    pageTransitionLayer.status === 'current' :
                                                    true
    const guardEnabled                            = enabled && isCurrentLayer
    const guardIDRef                              = useRef(0)
    const shouldBlockRef                          = useRef<BlockerFunction>(() => false)
    const dialogRef                               = useRef(dialog)
    const allowNextNavigationUntilRef             = useRef(0)
    const allowNextNavigationKeyRef               = useRef('')
    const location                                = useLocation()

    if (guardIDRef.current === 0) {
        guardIDRef.current = ++nextGuardID
    }

    const allowNextNavigation = useCallback(() => {
        allowNextNavigationUntilRef.current = Date.now() + 2_000
        allowNextNavigationKeyRef.current   = ''
    }, [])

    const shouldBlockFunction = useCallback<BlockerFunction>(
        (args) => {
            const now = Date.now()

            if (allowNextNavigationUntilRef.current > now) {
                const nextKey = `${args.nextLocation.pathname}${args.nextLocation.search}${args.nextLocation.hash}`
                if (!allowNextNavigationKeyRef.current) {
                    allowNextNavigationKeyRef.current = nextKey
                }
                if (allowNextNavigationKeyRef.current === nextKey) {
                    return false
                }
            } else if (allowNextNavigationUntilRef.current !== 0) {
                allowNextNavigationUntilRef.current = 0
                allowNextNavigationKeyRef.current   = ''
            }

            return typeof shouldBlock === 'function' ? shouldBlock(args) : shouldBlock
        },
        [shouldBlock],
    )

    useEffect(() => {
        shouldBlockRef.current = shouldBlockFunction
        dialogRef.current      = dialog
    }, [dialog, shouldBlockFunction])

    useEffect(() => {
        if (!guardEnabled) {
            removeGuard(guardIDRef.current)
            return
        }

        upsertGuard({
                        id: guardIDRef.current,
                        shouldBlock: (args) => shouldBlockRef.current(args),
                        get dialog() {
                            return dialogRef.current
                        },
                    })
        return () => removeGuard(guardIDRef.current)
    }, [guardEnabled])

    useEffect(() => {
        if (!guardEnabled) {
            return
        }

        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
            e.preventDefault()
        }

        window.addEventListener('beforeunload', handleBeforeUnload)
        return () => window.removeEventListener('beforeunload', handleBeforeUnload)
    }, [guardEnabled])

    useEffect(() => {
        if (allowNextNavigationUntilRef.current === 0) {
            return
        }
        allowNextNavigationUntilRef.current = 0
        allowNextNavigationKeyRef.current   = ''
    }, [location.key])

    return { allowNextNavigation }
}
