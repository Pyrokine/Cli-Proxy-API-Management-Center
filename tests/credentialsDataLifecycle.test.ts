import {describe, expect, test} from 'bun:test'
import {
    applyAuthFileMutation,
    authFileMutationQuotaKeys,
    authFileRefreshIdentifiers,
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

    test('targets same-file runtime identities without mutating their siblings', () => {
        const files = [
            {name: 'devin-shared.json', provider: 'devin', authIndex: 'devin-a', disabled: false, priority: 1},
            {name: 'devin-shared.json', provider: 'devin', authIndex: 'devin-b', disabled: false, priority: 2},
        ]

        const disabled = applyAuthFileMutation(files, {
            kind: 'status',
            names: ['devin-shared.json'],
            authIndex: 'devin-a',
            disabled: true,
        })
        expect(disabled).toEqual([
            {...files[0], disabled: true},
            files[1],
        ])

        const edited = applyAuthFileMutation(disabled, {
            kind: 'fields',
            name: 'devin-shared.json',
            authIndex: 'devin-b',
            fields: {priority: 7},
        })
        expect(edited).toEqual([
            disabled[0],
            {...files[1], priority: 7},
        ])
    })

    test('refreshes only enabled same-file identities by exact quota key', () => {
        const files = [
            {name: 'devin-shared.json', provider: 'devin', authIndex: 'devin-a', disabled: true},
            {name: 'devin-shared.json', provider: 'devin', authIndex: 'devin-b', disabled: false},
            {name: 'codex.json', provider: 'codex', authIndex: 'legacy-index', disabled: false},
        ]

        expect(authFileRefreshIdentifiers(files, ['devin-shared.json', 'codex.json'])).toEqual({
            identifiers: ['devin::devin-shared.json::devin-b', 'codex::codex.json'],
            skippedDisabled: 1,
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
