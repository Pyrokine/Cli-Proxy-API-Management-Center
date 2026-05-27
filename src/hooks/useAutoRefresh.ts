import {useCallback, useEffect, useRef, useState} from 'react'

/**
 * 窗口激活时自动刷新 hook
 *
 * 监听 visibilitychange + focus 事件，
 * 当窗口重新激活且距上次刷新超过 intervalMs 时自动触发刷新
 * intervalMs = 0 则禁用自动刷新
 */
export function useAutoRefresh(refreshFn: () => void | Promise<void>, intervalMs: number) {
    const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null)
    const [isRefreshing, setIsRefreshing]       = useState(false)
    const lastRefreshTimestampRef               = useRef(0)
    const refreshingRef                         = useRef(false)

    const doRefresh = useCallback(async () => {
        if (refreshingRef.current) {
            return
        }
        refreshingRef.current = true
        setIsRefreshing(true)
        try {
            await refreshFn()
            const now                       = Date.now()
            lastRefreshTimestampRef.current = now
            setLastRefreshedAt(new Date(now))
        } finally {
            refreshingRef.current = false
            setIsRefreshing(false)
        }
    }, [refreshFn])

    // 手动刷新（供外部调用）
    const refresh = useCallback(() => void doRefresh(), [doRefresh])

    // 标记初始刷新时间
    const markRefreshed = useCallback(() => {
        const now                       = Date.now()
        lastRefreshTimestampRef.current = now
        setLastRefreshedAt(new Date(now))
    }, [])

    useEffect(() => {
        if (intervalMs <= 0) {
            return
        }

        const handleVisibilityOrFocus = () => {
            if (document.hidden) {
                return
            }
            const elapsed = Date.now() - lastRefreshTimestampRef.current
            if (elapsed >= intervalMs) {
                void doRefresh()
            }
        }

        document.addEventListener('visibilitychange', handleVisibilityOrFocus)
        window.addEventListener('focus', handleVisibilityOrFocus)

        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityOrFocus)
            window.removeEventListener('focus', handleVisibilityOrFocus)
        }
    }, [intervalMs, doRefresh])

    return { lastRefreshedAt, isRefreshing, refresh, markRefreshed }
}
