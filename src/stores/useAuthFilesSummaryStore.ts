import {authFilesApi} from '@/services/api/authFiles'
import {apiClient} from '@/services/api/client'
import {create} from 'zustand'

interface AuthFilesSummaryState {
    count: number | null
    loading: boolean
    error: string | null
    setCount: (count: number) => void
    refresh: () => Promise<void>
    clear: () => void
}

let summaryRequestId = 0

export const useAuthFilesSummaryStore = create<AuthFilesSummaryState>((set) => ({
    count: null,
    loading: false,
    error: null,
    setCount: (count) => {
        summaryRequestId += 1
        set({ count: Math.max(0, Math.trunc(count)), loading: false, error: null })
    },
    refresh: async () => {
        const requestId      = ++summaryRequestId
        const authGeneration = apiClient.getAuthGeneration()
        set({ loading: true, error: null })
        try {
            const response = await authFilesApi.list()
            if (
                requestId !== summaryRequestId ||
                authGeneration !== apiClient.getAuthGeneration()
            ) {
                return
            }
            set({ count: response.files.length, loading: false, error: null })
        } catch (error: unknown) {
            if (
                requestId !== summaryRequestId ||
                authGeneration !== apiClient.getAuthGeneration()
            ) {
                return
            }
            set({
                    count: null,
                    loading: false,
                    error: error instanceof Error ? error.message : 'Failed to load credential count',
                })
        }
    },
    clear: () => {
        summaryRequestId += 1
        set({ count: null, loading: false, error: null })
    },
}))
