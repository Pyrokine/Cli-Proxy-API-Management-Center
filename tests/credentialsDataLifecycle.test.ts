import {describe, expect, test} from 'bun:test'
import {
    applyAuthFileMutation,
    authFileMutationQuotaKeys,
    authFileRefreshIdentifiers,
    authFileSelectionKey,
    createLatestCredentialsRequestTracker,
    selectedPhysicalFileNames,
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

    test('projects credential policy edits and clears without restoring stale aliases', () => {
        const original = {
            name: 'shared.json', authIndex: 'a',
            'model-aliases': [{name: 'old', alias: 'legacy'}],
            'request-scoped-errors': [{status: 403, match: ['old'], action: 'stop'}],
        }
        const sibling = {...original, authIndex: 'b'}
        const updated = applyAuthFileMutation([original, sibling], {
            kind: 'fields', name: 'shared.json', authIndex: 'a',
            fields: {
                model_aliases: [{name: 'gpt-5', alias: 'local-gpt'}],
                request_scoped_errors: [{status: 429, match: ['quota'], action: 'continue'}],
            },
        })
        expect(updated[1]).toEqual(sibling)
        expect(updated[0].model_aliases).toEqual([{name: 'gpt-5', alias: 'local-gpt'}])
        expect(updated[0].request_scoped_errors).toEqual([{status: 429, match: ['quota'], action: 'continue'}])
        const cleared = applyAuthFileMutation(updated, {
            kind: 'fields', name: 'shared.json', authIndex: 'a',
            fields: {model_aliases: [], request_scoped_errors: []},
        })
        for (const key of ['model_aliases', 'model-aliases', 'request_scoped_errors', 'request-scoped-errors']) {
            expect(Object.prototype.hasOwnProperty.call(cleared[0], key)).toBe(false)
        }
        expect(cleared[1]).toEqual(sibling)
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

    test('status changes without an auth index leave indexed same-file siblings unchanged', () => {
        const files = [
            {name: 'devin-shared.json', provider: 'devin', disabled: false},
            {name: 'devin-shared.json', provider: 'devin', authIndex: 'a', disabled: false},
        ]
        expect(applyAuthFileMutation(files, {kind: 'status', names: ['devin-shared.json'], disabled: true}))
            .toEqual([{...files[0], disabled: true}, files[1]])
    })

    test('refreshes only enabled same-file identities by exact quota key', () => {
        const files = [
            {name: 'devin-shared.json', provider: 'devin', authIndex: 'devin-a', disabled: true},
            {name: 'devin-shared.json', provider: 'devin', authIndex: 'devin-b', disabled: false},
            {name: 'codex.json', provider: 'codex', authIndex: 'legacy-index', disabled: false},
        ]

        expect(authFileRefreshIdentifiers(files, new Set(files.map(authFileSelectionKey)))).toEqual({
            identifiers: ['devin::devin-shared.json::devin-b', 'codex::codex.json'],
            skippedDisabled: 1,
            skippedUnsupported: 0,
            skippedAmbiguous: 0,
        })
        expect(authFileRefreshIdentifiers(files, new Set([authFileSelectionKey(files[1])]))).toEqual({
            identifiers: ['devin::devin-shared.json::devin-b'],
            skippedDisabled: 0,
            skippedUnsupported: 0,
            skippedAmbiguous: 0,
        })
    })

    test('excludes Meta and international Kimi from quota refresh requests', () => {
        const files = [
            {name: 'meta.json', type: 'meta', authIndex: 'meta-one'},
            {name: 'kimi-international.json', type: 'kimi-ai', authIndex: 'kimi-ai-one'},
            {name: 'kimi-china.json', type: 'kimi', authIndex: 'kimi-one'},
        ]
        expect(authFileRefreshIdentifiers(files, new Set(files.map(authFileSelectionKey)))).toEqual({
            identifiers: ['kimi::kimi-china.json'],
            skippedDisabled: 0,
            skippedUnsupported: 2,
            skippedAmbiguous: 0,
        })
    })

    test('selects same-file runtime identities separately and protects file-wide actions', () => {
        const files = [
            {name: 'shared.json', type: 'devin', authIndex: 'a'},
            {name: 'shared.json', type: 'devin', authIndex: 'b'},
            {name: 'other.json', type: 'codex', authIndex: 'c'},
        ]
        const selected = new Set([authFileSelectionKey(files[0]), authFileSelectionKey(files[2])])
        expect(authFileSelectionKey(files[0])).not.toBe(authFileSelectionKey(files[1]))
        expect(selectedPhysicalFileNames(files, selected)).toBeNull()
        selected.add(authFileSelectionKey(files[1]))
        expect(selectedPhysicalFileNames(files, selected)).toEqual(['shared.json', 'other.json'])
    })

    test('skips a partially selected quota shared across runtime identities', () => {
        const files = [
            {name: 'shared.json', type: 'codex', authIndex: 'a'},
            {name: 'shared.json', type: 'codex', authIndex: 'b'},
            {name: 'other.json', type: 'devin', authIndex: 'c'},
        ]
        expect(authFileRefreshIdentifiers(files, new Set([
            authFileSelectionKey(files[0]), authFileSelectionKey(files[2]),
        ]))).toEqual({
            identifiers: ['devin::other.json::c'],
            skippedDisabled: 0,
            skippedUnsupported: 0,
            skippedAmbiguous: 1,
        })
        expect(authFileRefreshIdentifiers(files, new Set(files.map(authFileSelectionKey)))).toEqual({
            identifiers: ['codex::shared.json', 'devin::other.json::c'],
            skippedDisabled: 0,
            skippedUnsupported: 0,
            skippedAmbiguous: 0,
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
