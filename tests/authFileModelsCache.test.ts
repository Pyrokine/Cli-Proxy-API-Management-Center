import {beforeEach, describe, expect, test} from 'bun:test'
import {
    clearAuthFileModelsCache,
    getCachedAuthFileModels,
    invalidateAuthFileModelsCache,
    loadAuthFileModels,
} from '@/features/authFiles/authFileModelsCache'
import {apiClient} from '@/services/api/client'

const deferred = <T>() => {
    let resolve!: (value: T) => void
    const promise = new Promise<T>((res) => {
        resolve = res
    })
    return { promise, resolve }
}

describe('auth-file model cache', () => {
    beforeEach(() => clearAuthFileModelsCache())

    test('deduplicates requests and normalizes model ids', async () => {
        let calls             = 0
        const loader          = async () => {
            calls += 1
            return [{ id: ' Model-B ' }, { id: 'model-a' }, { id: 'MODEL-A' }]
        }
        const [first, second] = await Promise.all([
                                                      loadAuthFileModels('a.json', loader),
                                                      loadAuthFileModels('a.json', loader),
                                                  ])
        expect(calls).toBe(1)
        expect(first).toEqual([{ id: 'model-a' }, { id: 'Model-B' }])
        expect(second).toEqual(first)
    })

    test('an invalidated old request cannot republish stale models', async () => {
        const old     = deferred<Array<{ id: string }>>()
        const request = loadAuthFileModels('a.json', () => old.promise)
        invalidateAuthFileModelsCache(['a.json'])
        old.resolve([{ id: 'old-model' }])
        expect(await request).toBeNull()
        expect(getCachedAuthFileModels('a.json')).toBeNull()
        expect(await loadAuthFileModels('a.json', async () => [{ id: 'new-model' }]))
            .toEqual([{ id: 'new-model' }])
    })

    test('a connection generation change invalidates old requests', async () => {
        const old     = deferred<Array<{ id: string }>>()
        const request = loadAuthFileModels('a.json', () => old.promise)
        apiClient.setConfig({ apiBase: 'http://example.invalid', managementKey: 'new-key' })
        old.resolve([{ id: 'old-model' }])
        expect(await request).toBeNull()
    })
})
