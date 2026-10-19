import {
    captureQuotaRequestClaim,
    commitQuotaSnapshot,
    markQuotaRequestFailed,
    markQuotaSnapshotRejected,
    quotaRequestClaimSignature,
    reconcileQuotaSubjects,
    useQuotaStore,
} from '@/stores/useQuotaStore'
import type {QuotaCacheMetadata} from '@/types'
import {beforeEach, describe, expect, test} from 'bun:test'

const metadata = (
    fileName: string,
    backendGeneration: number,
    backendStateRevision: number,
    overrides: Partial<QuotaCacheMetadata> = {},
): QuotaCacheMetadata => ({
    fileName,
    type: 'codex',
    backendGeneration,
    backendStateRevision,
    status: 'success',
    freshness: 'fresh',
    successfulEmpty: false,
    ...overrides,
})

const codexPayload = (label: string) => ({
    provider: 'codex' as const,
    value: {
        status: 'success' as const,
        windows: [{ id: label, label, usedPercent: 10, resetLabel: '' }],
    },
})

describe('quota cache session isolation', () => {
    beforeEach(() => {
        useQuotaStore.getState().clearQuotaCache()
    })

    test('rejects a snapshot captured before a connection cache clear', () => {
        const claim = captureQuotaRequestClaim(3)

        useQuotaStore.getState().clearQuotaCache()

        expect(commitQuotaSnapshot(claim, 3, {
            key: 'codex::a.json',
            metadata: metadata('a.json', 1, 1),
            payload: codexPayload('old'),
        })).toBe('stale_request')
        expect(useQuotaStore.getState().codexQuota['codex::a.json']).toBeUndefined()
    })

    test('accepts a current snapshot and preserves last-known-good data on failure', () => {
        const initial = captureQuotaRequestClaim(3)
        expect(commitQuotaSnapshot(initial, 3, {
            key: 'codex::a.json',
            metadata: metadata('a.json', 1, 1),
            payload: codexPayload('first'),
        })).toBe('committed')

        const failed = captureQuotaRequestClaim(3)
        expect(commitQuotaSnapshot(failed, 3, {
            key: 'codex::a.json',
            metadata: metadata('a.json', 1, 2, { fetchedAt: '2026-09-09T01:00:00Z' }),
            failure: 'invalid payload',
        })).toBe('committed')

        const state = useQuotaStore.getState()
        expect(state.codexQuota['codex::a.json']?.windows[0]?.id).toBe('first')
        expect(state.quotaMetadata['codex::a.json']).toMatchObject({
                                                                       status: 'error',
                                                                       freshness: 'stale',
                                                                       lastError: 'invalid payload',
                                                                       backendStateRevision: 2,
                                                                   })
    })

    test('invalidates one subject without cancelling an unrelated snapshot', () => {
        const initial = captureQuotaRequestClaim(3)
        expect(commitQuotaSnapshot(initial, 3, {
            key: 'codex::a.json',
            metadata: metadata('a.json', 1, 1),
            payload: codexPayload('a'),
        })).toBe('committed')
        expect(commitQuotaSnapshot(initial, 3, {
            key: 'codex::b.json',
            metadata: metadata('b.json', 1, 1),
            payload: codexPayload('b'),
        })).toBe('committed')

        const refresh = captureQuotaRequestClaim(3)
        useQuotaStore.getState().clearQuotaSubjects(['codex::a.json'])

        expect(commitQuotaSnapshot(refresh, 3, {
            key: 'codex::a.json',
            metadata: metadata('a.json', 1, 2),
            payload: codexPayload('stale-a'),
        })).toBe('stale_subject')
        expect(commitQuotaSnapshot(refresh, 3, {
            key: 'codex::b.json',
            metadata: metadata('b.json', 1, 2),
            payload: codexPayload('new-b'),
        })).toBe('committed')
        expect(useQuotaStore.getState().codexQuota['codex::b.json']?.windows[0]?.id).toBe('new-b')
    })

    test('status changes reject old claims while preserving payload metadata and backend version bounds', () => {
        const key = 'codex::a.json'
        const sibling = 'codex::b.json'
        const initial = captureQuotaRequestClaim(3)
        const snapshot = {key, metadata: metadata('a.json', 4, 8, {
            observedAt: '2026-10-19T01:00:00Z', freshness: 'partial', lastError: 'subscription: status 403',
        }), payload: codexPayload('retained')}
        expect(commitQuotaSnapshot(initial, 3, snapshot)).toBe('committed')
        expect(commitQuotaSnapshot(initial, 3, {
            key: sibling, metadata: metadata('b.json', 1, 1), payload: codexPayload('sibling'),
        })).toBe('committed')
        const previous = useQuotaStore.getState()
        const oldClaim = captureQuotaRequestClaim(3)
        useQuotaStore.getState().advanceQuotaSubjects([key, key])
        const changed = useQuotaStore.getState()
        expect(changed.codexQuota[key]).toBe(previous.codexQuota[key])
        expect(changed.quotaMetadata[key]).toBe(previous.quotaMetadata[key])
        expect(changed.cacheGeneration).toBe(previous.cacheGeneration)
        expect(changed.subjectVersions[key]).toEqual({
            ...previous.subjectVersions[key], localGeneration: previous.subjectVersions[key].localGeneration + 1,
        })
        expect(changed.subjectVersions[sibling]).toBe(previous.subjectVersions[sibling])
        expect(commitQuotaSnapshot(oldClaim, 3, snapshot)).toBe('stale_subject')
        expect(commitQuotaSnapshot(oldClaim, 3, {
            key: sibling, metadata: metadata('b.json', 1, 2), payload: codexPayload('updated-sibling'),
        })).toBe('committed')
        expect(commitQuotaSnapshot(captureQuotaRequestClaim(3), 3, snapshot)).toBe('committed')
    })

    test('status fencing preserves tombstones and their backend generation floor', () => {
        const key = 'codex::a.json'
        expect(commitQuotaSnapshot(captureQuotaRequestClaim(3), 3, {
            key, metadata: metadata('a.json', 4, 1), payload: codexPayload('removed'),
        })).toBe('committed')
        useQuotaStore.getState().clearQuotaSubjects([key])
        const tombstone = useQuotaStore.getState().subjectVersions[key]
        useQuotaStore.getState().advanceQuotaSubjects([key])
        expect(useQuotaStore.getState().subjectVersions[key]).toEqual({
            ...tombstone, localGeneration: tombstone.localGeneration + 1,
        })
        expect(useQuotaStore.getState().codexQuota[key]).toBeUndefined()
        expect(commitQuotaSnapshot(captureQuotaRequestClaim(3), 3, {
            key, metadata: metadata('a.json', 4, 2), payload: codexPayload('stale-binding'),
        })).toBe('older_backend_version')
    })

    test('requires a newer backend generation after a subject tombstone', () => {
        const initial = captureQuotaRequestClaim(3)
        expect(commitQuotaSnapshot(initial, 3, {
            key: 'codex::a.json',
            metadata: metadata('a.json', 4, 1),
            payload: codexPayload('old-binding'),
        })).toBe('committed')

        useQuotaStore.getState().clearQuotaSubjects(['codex::a.json'])
        const afterDelete = captureQuotaRequestClaim(3)
        expect(commitQuotaSnapshot(afterDelete, 3, {
            key: 'codex::a.json',
            metadata: metadata('a.json', 4, 2),
            payload: codexPayload('same-generation'),
        })).toBe('older_backend_version')
        expect(commitQuotaSnapshot(afterDelete, 3, {
            key: 'codex::a.json',
            metadata: metadata('a.json', 5, 1),
            payload: codexPayload('new-binding'),
        })).toBe('committed')
        expect(useQuotaStore.getState().codexQuota['codex::a.json']?.windows[0]?.id).toBe('new-binding')
    })

    test('rejects older backend generations and state revisions', () => {
        const initial = captureQuotaRequestClaim(3)
        expect(commitQuotaSnapshot(initial, 3, {
            key: 'codex::a.json',
            metadata: metadata('a.json', 5, 3),
            payload: codexPayload('current'),
        })).toBe('committed')

        const claim = captureQuotaRequestClaim(3)
        expect(commitQuotaSnapshot(claim, 3, {
            key: 'codex::a.json',
            metadata: metadata('a.json', 4, 9),
            payload: codexPayload('old-generation'),
        })).toBe('older_backend_version')
        expect(commitQuotaSnapshot(claim, 3, {
            key: 'codex::a.json',
            metadata: metadata('a.json', 5, 2),
            payload: codexPayload('old-revision'),
        })).toBe('older_backend_version')
        expect(useQuotaStore.getState().codexQuota['codex::a.json']?.windows[0]?.id).toBe('current')
    })

    test('successful-empty clears data while retaining authoritative metadata', () => {
        const initial = captureQuotaRequestClaim(3)
        expect(commitQuotaSnapshot(initial, 3, {
            key: 'codex::a.json',
            metadata: metadata('a.json', 1, 1),
            payload: codexPayload('present'),
        })).toBe('committed')

        const empty = captureQuotaRequestClaim(3)
        expect(commitQuotaSnapshot(empty, 3, {
            key: 'codex::a.json',
            metadata: metadata('a.json', 1, 2, { successfulEmpty: true }),
            clearData: true,
        })).toBe('committed')
        expect(useQuotaStore.getState().codexQuota['codex::a.json']).toBeUndefined()
        expect(useQuotaStore.getState().quotaMetadata['codex::a.json']).toMatchObject({
                                                                                          freshness: 'fresh',
                                                                                          successfulEmpty: true,
                                                                                      })
    })

    test('keeps an omitted subject stale and accepts its next state revision', () => {
        const initial = captureQuotaRequestClaim(3)
        expect(commitQuotaSnapshot(initial, 3, {
            key: 'codex::a.json',
            metadata: metadata('a.json', 1, 1),
            payload: codexPayload('a'),
        })).toBe('committed')
        expect(commitQuotaSnapshot(initial, 3, {
            key: 'codex::b.json',
            metadata: metadata('b.json', 1, 1),
            payload: codexPayload('b'),
        })).toBe('committed')

        const claim = captureQuotaRequestClaim(3)
        expect(reconcileQuotaSubjects(
            claim,
            3,
            new Set(['codex::b.json']),
            '2026-09-09T01:30:00Z',
        )).toBe(true)
        let state = useQuotaStore.getState()
        expect(state.codexQuota['codex::a.json']?.windows[0]?.id).toBe('a')
        expect(state.quotaMetadata['codex::a.json']).toMatchObject({
                                                                       freshness: 'stale',
                                                                       lastError: 'Quota status response omitted this credential',
                                                                       lastErrorAt: '2026-09-09T01:30:00Z',
                                                                   })
        expect(state.codexQuota['codex::b.json']).toBeDefined()

        const recovered = captureQuotaRequestClaim(3)
        expect(commitQuotaSnapshot(recovered, 3, {
            key: 'codex::a.json',
            metadata: metadata('a.json', 1, 2),
            payload: codexPayload('recovered'),
        })).toBe('committed')
        state = useQuotaStore.getState()
        expect(state.codexQuota['codex::a.json']?.windows[0]?.id).toBe('recovered')
        expect(state.quotaMetadata['codex::a.json']?.freshness).toBe('fresh')
    })

    test('changes the poll claim signature across connection, cache, and subject generations', () => {
        expect(quotaRequestClaimSignature({
                                              connectionGeneration: 3,
                                              cacheGeneration: 1,
                                              subjectGenerations: { b: 2, a: 1 },
                                          })).toBe(quotaRequestClaimSignature({
                                                                                  connectionGeneration: 3,
                                                                                  cacheGeneration: 1,
                                                                                  subjectGenerations: { a: 1, b: 2 },
                                                                              }))

        const initial = captureQuotaRequestClaim(3)
        expect(commitQuotaSnapshot(initial, 3, {
            key: 'codex::a.json',
            metadata: metadata('a.json', 1, 1),
            payload: codexPayload('present'),
        })).toBe('committed')

        const current          = captureQuotaRequestClaim(3)
        const currentSignature = quotaRequestClaimSignature(current)
        expect(quotaRequestClaimSignature(captureQuotaRequestClaim(4))).not.toBe(currentSignature)

        useQuotaStore.getState().clearQuotaSubjects(['codex::a.json'])
        const afterSubjectInvalidation = captureQuotaRequestClaim(3)
        expect(quotaRequestClaimSignature(afterSubjectInvalidation)).not.toBe(currentSignature)

        useQuotaStore.getState().clearQuotaCache()
        expect(quotaRequestClaimSignature(captureQuotaRequestClaim(3)))
            .not.toBe(quotaRequestClaimSignature(afterSubjectInvalidation))
    })

    test('marks invalid and older backend snapshots stale without replacing accepted data', () => {
        const initial = captureQuotaRequestClaim(3)
        expect(commitQuotaSnapshot(initial, 3, {
            key: 'codex::a.json',
            metadata: metadata('a.json', 5, 3),
            payload: codexPayload('current'),
        })).toBe('committed')

        const invalidClaim    = captureQuotaRequestClaim(3)
        const invalidSnapshot = {
            key: 'codex::a.json',
            metadata: metadata('a.json', 0, 0),
            payload: codexPayload('invalid'),
        }
        expect(commitQuotaSnapshot(invalidClaim, 3, invalidSnapshot)).toBe('invalid_backend_version')
        expect(markQuotaSnapshotRejected(
            invalidClaim,
            3,
            invalidSnapshot,
            'invalid backend version',
            '2026-09-09T01:40:00Z',
        )).toBe(true)

        const olderClaim    = captureQuotaRequestClaim(3)
        const olderSnapshot = {
            key: 'codex::a.json',
            metadata: metadata('a.json', 5, 2),
            payload: codexPayload('older'),
        }
        expect(commitQuotaSnapshot(olderClaim, 3, olderSnapshot)).toBe('older_backend_version')
        expect(markQuotaSnapshotRejected(
            olderClaim,
            3,
            olderSnapshot,
            'older backend version',
            '2026-09-09T01:45:00Z',
        )).toBe(true)

        const state = useQuotaStore.getState()
        expect(state.codexQuota['codex::a.json']?.windows[0]?.id).toBe('current')
        expect(state.quotaMetadata['codex::a.json']).toMatchObject({
                                                                       freshness: 'stale',
                                                                       lastError: 'older backend version',
                                                                       lastErrorAt: '2026-09-09T01:45:00Z',
                                                                       backendGeneration: 5,
                                                                       backendStateRevision: 3,
                                                                   })
    })

    test('does not recreate metadata when an older snapshot targets an explicit tombstone', () => {
        const initial = captureQuotaRequestClaim(3)
        expect(commitQuotaSnapshot(initial, 3, {
            key: 'codex::a.json',
            metadata: metadata('a.json', 2, 1),
            payload: codexPayload('present'),
        })).toBe('committed')
        useQuotaStore.getState().clearQuotaSubjects(['codex::a.json'])

        const claim    = captureQuotaRequestClaim(3)
        const snapshot = {
            key: 'codex::a.json',
            metadata: metadata('a.json', 2, 2),
            payload: codexPayload('stale'),
        }
        expect(commitQuotaSnapshot(claim, 3, snapshot)).toBe('older_backend_version')
        expect(markQuotaSnapshotRejected(
            claim,
            3,
            snapshot,
            'older backend version',
            '2026-09-09T01:50:00Z',
        )).toBe(false)
        expect(useQuotaStore.getState().quotaMetadata['codex::a.json']).toBeUndefined()
    })

    test('poll failure keeps accepted data and marks it stale', () => {
        const initial = captureQuotaRequestClaim(3)
        expect(commitQuotaSnapshot(initial, 3, {
            key: 'codex::a.json',
            metadata: metadata('a.json', 1, 1),
            payload: codexPayload('present'),
        })).toBe('committed')

        const claim = captureQuotaRequestClaim(3)
        expect(markQuotaRequestFailed(claim, 3, 'network failed', '2026-09-09T02:00:00Z')).toBe(true)
        const state = useQuotaStore.getState()
        expect(state.codexQuota['codex::a.json']?.windows[0]?.id).toBe('present')
        expect(state.quotaMetadata['codex::a.json']).toMatchObject({
                                                                       status: 'error',
                                                                       freshness: 'stale',
                                                                       lastError: 'network failed',
                                                                   })
    })
})
