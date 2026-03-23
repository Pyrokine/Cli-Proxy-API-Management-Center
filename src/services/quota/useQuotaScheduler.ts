/**
 * React hook for the quota scheduler singleton.
 *
 * Provides a stable scheduler instance shared across the app,
 * with automatic start/stop lifecycle tied to the component tree.
 */

import {useEffect, useRef, useSyncExternalStore} from 'react'
import type {QuotaSchedulerOptions} from './QuotaScheduler'
import {QuotaScheduler} from './QuotaScheduler'

let globalScheduler: QuotaScheduler | null = null
let subscriberCount                        = 0
const listeners                            = new Set<() => void>()
let snapshotVersion                        = 0

function getScheduler(options?: QuotaSchedulerOptions): QuotaScheduler {
    if (!globalScheduler) {
        globalScheduler = new QuotaScheduler({
                                                 ...options,
                                                 onStateChange: () => {
                                                     snapshotVersion++
                                                     listeners.forEach((fn) => fn())
                                                 },
                                             })
    }
    return globalScheduler
}

function subscribe(callback: () => void): () => void {
    listeners.add(callback)
    return () => listeners.delete(callback)
}

function getSnapshot(): number {
    return snapshotVersion
}

/**
 * Access the global quota scheduler.
 * Components using this hook will re-render on schedule state changes.
 */
export function useQuotaScheduler(options?: QuotaSchedulerOptions) {
    const scheduler = useRef(getScheduler(options)).current

    // Re-render when scheduler state changes
    useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

    // Manage lifecycle: start when first consumer mounts, stop when last unmounts
    useEffect(() => {
        subscriberCount++
        if (subscriberCount === 1) {
            scheduler.start()
        }
        return () => {
            subscriberCount--
            if (subscriberCount === 0) {
                scheduler.stop()
            }
        }
    }, [scheduler])

    return scheduler
}
