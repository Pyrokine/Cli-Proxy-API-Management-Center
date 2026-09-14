import {beforeEach, describe, expect, test} from 'bun:test'
import {getCachedAuthFileModels, loadAuthFileModels} from '@/features/authFiles/authFileModelsCache'
import {invalidateAuthFileDerivedCaches} from '@/features/authFiles/cacheInvalidation'
import {useQuotaStore} from '@/stores/useQuotaStore'

describe('credential mutation cache invalidation', () => {
    beforeEach(() => {
        invalidateAuthFileDerivedCaches()
    })

    test('clears only the targeted provider and credential subject', async () => {
        await loadAuthFileModels('shared.json', async () => [{ id: 'shared-model' }])
        await loadAuthFileModels('other.json', async () => [{ id: 'other-model' }])
        useQuotaStore.setState({
                                   codexQuota: {
                                       'codex::shared.json': { status: 'success', windows: [] },
                                       'codex::other.json': { status: 'success', windows: [] },
                                   },
                                   xaiQuota: {
                                       'xai::shared.json': { status: 'success', billing: null },
                                   },
                               })
        const generation = useQuotaStore.getState().cacheGeneration

        invalidateAuthFileDerivedCaches(['shared.json'], ['codex::shared.json'])

        expect(getCachedAuthFileModels('shared.json')).toBeNull()
        expect(getCachedAuthFileModels('other.json')).toEqual([{ id: 'other-model' }])
        expect(useQuotaStore.getState().codexQuota['codex::shared.json']).toBeUndefined()
        expect(useQuotaStore.getState().codexQuota['codex::other.json']).toBeDefined()
        expect(useQuotaStore.getState().xaiQuota['xai::shared.json']).toBeDefined()
        expect(useQuotaStore.getState().cacheGeneration).toBe(generation)
    })
})
