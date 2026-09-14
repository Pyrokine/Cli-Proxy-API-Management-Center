import {beforeEach, describe, expect, test} from 'bun:test'
import {authFilesApi} from '@/services/api/authFiles'
import {apiClient} from '@/services/api/client'
import {useAuthFilesSummaryStore} from '@/stores/useAuthFilesSummaryStore'

const deferred = <T>() => {
    let resolve!: (value: T) => void
    const promise = new Promise<T>((res) => {
        resolve = res
    })
    return { promise, resolve }
}

describe('auth-files summary store', () => {
    beforeEach(() => useAuthFilesSummaryStore.getState().clear())

    test('loads the count and clamps direct updates', async () => {
        const original    = authFilesApi.list
        authFilesApi.list = async () => ({ files: [{ name: 'a' }, { name: 'b' }] })
        try {
            await useAuthFilesSummaryStore.getState().refresh()
            expect(useAuthFilesSummaryStore.getState()).toMatchObject({ count: 2, loading: false, error: null })
            useAuthFilesSummaryStore.getState().setCount(-4)
            expect(useAuthFilesSummaryStore.getState().count).toBe(0)
        } finally {
            authFilesApi.list = original
        }
    })

    test('a mutation count update prevents an older refresh from overwriting it', async () => {
        const original    = authFilesApi.list
        const pending     = deferred<{ files: Array<{ name: string }> }>()
        authFilesApi.list = () => pending.promise
        try {
            const request = useAuthFilesSummaryStore.getState().refresh()
            useAuthFilesSummaryStore.getState().setCount(3)
            pending.resolve({ files: [{ name: 'stale' }] })
            await request
            expect(useAuthFilesSummaryStore.getState().count).toBe(3)
        } finally {
            authFilesApi.list = original
        }
    })

    test('clear and connection changes block stale publication', async () => {
        const original    = authFilesApi.list
        const pending     = deferred<{ files: Array<{ name: string }> }>()
        authFilesApi.list = () => pending.promise
        try {
            const request = useAuthFilesSummaryStore.getState().refresh()
            useAuthFilesSummaryStore.getState().clear()
            apiClient.setConfig({ apiBase: 'http://example.invalid', managementKey: 'next' })
            pending.resolve({ files: [{ name: 'stale' }] })
            await request
            expect(useAuthFilesSummaryStore.getState()).toMatchObject({ count: null, loading: false })
        } finally {
            authFilesApi.list = original
        }
    })
})
