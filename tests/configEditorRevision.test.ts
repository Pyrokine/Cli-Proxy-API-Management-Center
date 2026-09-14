import {describe, expect, test} from 'bun:test'

import {ConfigEditorRevisionState} from '@/pages/configEditorRevision'

describe('config editor request revisions', () => {
    test('rejects an older load after a newer load starts', () => {
        const revisions = new ConfigEditorRevisionState()
        const first     = revisions.beginLoad()
        const second    = revisions.beginLoad()

        expect(revisions.isCurrentRequest(first)).toBe(false)
        expect(revisions.isCurrentRequest(second)).toBe(true)
    })

    test('rejects load and save responses after the draft changes', () => {
        const revisions = new ConfigEditorRevisionState()
        revisions.acceptServerRevision()
        const load = revisions.beginLoad()
        const save = revisions.beginSave()

        revisions.markDraftChanged()

        expect(revisions.isCurrentRequest(load)).toBe(false)
        expect(revisions.isCurrentRequest(save)).toBe(false)
    })

    test('starting a save invalidates an older load generation', () => {
        const revisions = new ConfigEditorRevisionState()
        const load      = revisions.beginLoad()
        const save      = revisions.beginSave()

        expect(revisions.isCurrentGeneration(load)).toBe(false)
        expect(revisions.isCurrentRequest(save)).toBe(true)
    })

    test('tracks the server revision used as the draft base', () => {
        const revisions = new ConfigEditorRevisionState()
        expect(revisions.acceptServerRevision()).toEqual({
                                                             serverRevision: 1,
                                                             draftRevision: 1,
                                                             draftBaseRevision: 1,
                                                         })

        revisions.markDraftChanged()
        expect(revisions.observeServerRevision()).toEqual({
                                                              serverRevision: 2,
                                                              draftRevision: 2,
                                                              draftBaseRevision: 1,
                                                          })
        expect(revisions.resetDraftToServer()).toEqual({
                                                           serverRevision: 2,
                                                           draftRevision: 3,
                                                           draftBaseRevision: 2,
                                                       })
    })

    test('rejects an older save after a newer save starts', () => {
        const revisions = new ConfigEditorRevisionState()
        const first     = revisions.beginSave()
        const second    = revisions.beginSave()

        expect(revisions.isCurrentRequest(first)).toBe(false)
        expect(revisions.isCurrentRequest(second)).toBe(true)
    })

    test('observing a newer server snapshot preserves the dirty draft base', () => {
        const revisions = new ConfigEditorRevisionState()
        revisions.acceptServerRevision()
        revisions.markDraftChanged()
        const request = revisions.beginSave()

        expect(revisions.observeServerRevision()).toEqual({
                                                              serverRevision: 2,
                                                              draftRevision: 2,
                                                              draftBaseRevision: 1,
                                                          })
        expect(revisions.isCurrentRequest(request)).toBe(false)
    })

    test('rejects prepared state after another server revision is accepted', () => {
        const revisions = new ConfigEditorRevisionState()
        const prepared  = revisions.acceptServerRevision()

        expect(revisions.matches(prepared)).toBe(true)
        revisions.acceptServerRevision()
        expect(revisions.matches(prepared)).toBe(false)
    })

    test('invalidates active load and save generations on teardown', () => {
        const revisions = new ConfigEditorRevisionState()
        const load      = revisions.beginLoad()
        const save      = revisions.beginSave()

        revisions.invalidate()

        expect(revisions.isCurrentGeneration(load)).toBe(false)
        expect(revisions.isCurrentGeneration(save)).toBe(false)
    })
})
