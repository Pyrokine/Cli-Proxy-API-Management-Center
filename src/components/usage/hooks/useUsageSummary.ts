import { usageApi, type UsageSummary } from '@/services/api/usage'
import { useCallback, useEffect, useRef, useState } from 'react'

type Granularity = 'hourly' | 'daily'

interface UseUsageSummaryReturn {
    summary: UsageSummary | null
    loading: boolean
    error: string
    resolved: boolean
    reload: (params?: {
        from?: string
        to?: string
        granularity?: Granularity
        model?: string
        api_key?: string
        credential?: string
        groups?: 'none' | 'all'
    }) => Promise<UsageSummary | null>
}

interface UseUsageSummaryOptions {
    enabled?: boolean
}

export function useUsageSummary(
    params?: {
        from?: string
        to?: string
        granularity?: Granularity
        model?: string
        api_key?: string
        credential?: string
        groups?: 'none' | 'all'
    },
    options?: UseUsageSummaryOptions
): UseUsageSummaryReturn {
    const enabled = options?.enabled ?? true
    const [summary, setSummary] = useState<UsageSummary | null>(null)
    const [loading, setLoading] = useState(enabled)
    const [error, setError] = useState('')
    const inflightRef = useRef<AbortController | null>(null)
    const visibleSummary = enabled ? summary : null
    const visibleLoading = enabled ? loading : false
    const visibleError = enabled ? error : ''
    const resolved = enabled && !visibleLoading && !visibleError && visibleSummary !== null

    const reload = useCallback(
        async (overrides?: {
            from?: string
            to?: string
            granularity?: Granularity
            model?: string
            api_key?: string
            credential?: string
            groups?: 'none' | 'all'
        }) => {
            if (!enabled) {
                return null
            }
            // Cancel in-flight request — fast filter switching used to stack
            // 3+ concurrent /usage/summary calls and let stale data race the
            // newest one. Last writer wins is the only correct outcome.
            inflightRef.current?.abort()
            const controller = new AbortController()
            inflightRef.current = controller

            setLoading(true)
            setError('')
            try {
                const merged = { ...params, ...overrides }
                const data = await usageApi.getSummary(merged, { signal: controller.signal })
                if (!controller.signal.aborted) {
                    setSummary(data)
                }
                return data
            } catch (err: unknown) {
                if (controller.signal.aborted) {
                    return null
                }
                setSummary(null)
                setError(err instanceof Error ? err.message : 'Failed to load usage summary')
                return null
            } finally {
                if (inflightRef.current === controller) {
                    inflightRef.current = null
                    setLoading(false)
                }
            }
        },
        [enabled, params]
    )

    useEffect(() => {
        if (!enabled) {
            inflightRef.current?.abort()
            inflightRef.current = null
            return
        }
        queueMicrotask(() => {
            void reload()
        })
    }, [enabled, reload])

    useEffect(
        () => () => {
            inflightRef.current?.abort()
        },
        []
    )

    return { summary: visibleSummary, loading: visibleLoading, error: visibleError, resolved, reload }
}
