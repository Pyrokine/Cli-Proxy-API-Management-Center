import {describe, expect, test} from 'bun:test'
import {
    applyAuthFileMutation,
    authFileMutationQuotaKeys,
    createLatestCredentialsRequestTracker,
} from '@/components/credentials/credentialsDataLifecycle'

describe('credentials data lifecycle', () => {
    test('only the latest request from the current auth generation can publish', () => {
        const tracker = createLatestCredentialsRequestTracker()
        const first   = tracker.begin(3)
        const second  = tracker.begin(3)
        expect(tracker.isCurrent(first, 3)).toBe(false)
        expect(tracker.isCurrent(second, 3)).toBe(true)
        expect(tracker.isCurrent(second, 4)).toBe(false)
        tracker.invalidate()
        expect(tracker.isCurrent(second, 3)).toBe(false)
    })

    test('applies successful upload, delete, status, and field mutations locally', () => {
        const files    = [{ name: 'a.json' }, { name: 'b.json', disabled: false }]
        const uploaded = applyAuthFileMutation(files, { kind: 'upload', names: ['c.json', 'c.json'] })
        expect(uploaded.map((file) => file.name)).toEqual(['a.json', 'b.json', 'c.json'])
        expect(applyAuthFileMutation(uploaded, { kind: 'delete', names: ['a.json'] }).map((file) => file.name))
            .toEqual(['b.json', 'c.json'])
        expect(applyAuthFileMutation(files, { kind: 'status', names: ['b.json'], disabled: true })[1]?.disabled)
            .toBe(true)
        expect(applyAuthFileMutation(files, {
            kind: 'fields',
            name: 'a.json',
            fields: {
                using_api: true,
                disable_cooling: true,
                excluded_models: [],
                weight: 0,
            },
        })[0]).toMatchObject({
                                 usingApi: true,
                                 disableCooling: true,
                                 excludedModels: [],
                                 weight: 0,
                             })
    })

    test('derives provider-specific quota subjects without invalidating status or field updates', () => {
        const files = [
            { name: 'shared.json', provider: 'codex' },
            { name: 'shared.json', provider: 'xai' },
        ]

        expect(authFileMutationQuotaKeys(files, { kind: 'delete', names: ['shared.json'] })).toEqual([
                                                                                                         'codex::shared.json',
                                                                                                         'xai::shared.json',
                                                                                                     ])
        expect(authFileMutationQuotaKeys(files, {
            kind: 'status',
            names: ['shared.json'],
            disabled: true,
        })).toEqual([])
        expect(authFileMutationQuotaKeys(files, {
            kind: 'fields',
            name: 'shared.json',
            fields: { priority: 1 },
        })).toEqual([])
        expect(authFileMutationQuotaKeys(files, { kind: 'reload' })).toBeUndefined()
    })
})
