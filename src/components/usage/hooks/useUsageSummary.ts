import {usageApi, type UsageSummary} from '@/services/api/usage'
import {useCallback, useEffect, useState} from 'react'

interface UseUsageSummaryReturn {
    summary: UsageSummary | null;
    loading: boolean;
    error: string;
    reload: (params?: { from?: string; to?: string; granularity?: 'hourly' | 'daily' }) => Promise<void>;
}

export function useUsageSummary(params?: {
    from?: string;
    to?: string;
    granularity?: 'hourly' | 'daily';
}): UseUsageSummaryReturn {
    const [summary, setSummary] = useState<UsageSummary | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError]     = useState('')

    const reload = useCallback(
        async (overrides?: { from?: string; to?: string; granularity?: 'hourly' | 'daily' }) => {
            setLoading(true)
            setError('')
            try {
                const merged = { ...params, ...overrides }
                const data   = await usageApi.getSummary(merged)
                setSummary(data)
            } catch (err: unknown) {
                setError(err instanceof Error ? err.message : 'Failed to load usage summary')
            } finally {
                setLoading(false)
            }
        },
        [params],
    )

    useEffect(() => {
        void reload()
    }, [reload])

    return { summary, loading, error, reload }
}
