import { useMemo } from 'react'

export type DataStatusValue = 'checking' | 'missing' | 'loading' | 'loaded' | 'empty' | 'error' | 'refreshing' | 'ready'

interface UseDataStatusOptions<T> {
    loading: boolean
    error?: unknown
    data: T | null | undefined
    isEmpty: (data: T) => boolean
    refreshing?: boolean
    missing?: boolean
}

interface UseDataStatusResult<T> {
    status: DataStatusValue
    data: T | null
    errorMessage?: string
}

function normalizeErrorMessage(error: unknown): string | undefined {
    if (error instanceof Error) {
        return error.message
    }
    if (typeof error === 'string') {
        return error
    }
    return undefined
}

export function useDataStatus<T>({
    loading,
    error,
    data,
    isEmpty,
    refreshing = false,
    missing = false,
}: UseDataStatusOptions<T>): UseDataStatusResult<T> {
    return useMemo(() => {
        const normalizedData = data ?? null
        if (error) {
            return {
                status: 'error' as const,
                data: normalizedData,
                errorMessage: normalizeErrorMessage(error),
            }
        }
        if (missing) {
            return {
                status: 'missing' as const,
                data: normalizedData,
            }
        }
        if (loading && !normalizedData) {
            return {
                status: 'loading' as const,
                data: normalizedData,
            }
        }
        if (refreshing) {
            return {
                status: 'refreshing' as const,
                data: normalizedData,
            }
        }
        if (!normalizedData || isEmpty(normalizedData)) {
            return {
                status: 'empty' as const,
                data: normalizedData,
            }
        }
        return {
            status: 'ready' as const,
            data: normalizedData,
        }
    }, [data, error, isEmpty, loading, missing, refreshing])
}
