import {describe, expect, test} from 'bun:test'
import {readFileSync} from 'node:fs'

import {ConfigEditorRevisionState} from '@/pages/configEditorRevision'
import {decodeVisualConfigYaml, encodeVisualConfigYaml} from '@/hooks/visualConfigCodec'
import {parse} from 'yaml'

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
                                                             authGeneration: 0, serverRevision: 1,
                                                             draftRevision: 1,
                                                             draftBaseRevision: 1,
                                                         })

        revisions.markDraftChanged()
        expect(revisions.observeServerRevision()).toEqual({
                                                              authGeneration: 0, serverRevision: 2,
                                                              draftRevision: 2,
                                                              draftBaseRevision: 1,
                                                          })
        expect(revisions.resetDraftToServer()).toEqual({
                                                           authGeneration: 0, serverRevision: 2,
                                                           draftRevision: 3,
                                                           draftBaseRevision: 2,
                                                       })
    })

    test('confirmed reload fetches the latest revision before discarding a dirty draft', () => {
        const page = readFileSync(new URL('../src/pages/ConfigPage.tsx', import.meta.url), 'utf8')
        const load = page.slice(page.indexOf('const loadConfig = useCallback'), page.indexOf('useEffect(() => {\n        queueMicrotask'))
        expect(load).toContain('const snapshot = await configFileApi.fetchConfigYaml()')
        expect(load).toContain('if (isDirtyRef.current && !discardDraft)')
        expect(load.indexOf('const snapshot = await configFileApi.fetchConfigYaml()'))
            .toBeLessThan(load.indexOf('revisionStateRef.current.acceptServerRevision()'))
        expect(page).toContain('void Promise.all([loadConfig(true), loadRuntimeInfo()])')
        expect(page).toContain('enabled: isDirty && !disableControls')

        const revisions = new ConfigEditorRevisionState()
        revisions.acceptServerRevision()
        revisions.resetSource('version: A\n')
        revisions.markDraftChanged()
        const draft = revisions.snapshot()
        const pending = revisions.beginLoad()
        expect(revisions.snapshot()).toEqual(draft)
        expect(revisions.isCurrentRequest(pending)).toBe(true)
        revisions.acceptServerRevision()
        revisions.resetSource('version: B\n')
        expect(revisions.buildSaveDraft('version: B\n', 'source', (yaml) => yaml)).toBe('version: B\n')
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
                                                              authGeneration: 0, serverRevision: 2,
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

    test('visual/source viewing round trips retain visual dirty changes and merge the latest server', () => {
        const source = 'debug: false\nproxy-url: old\n'
        const revisions = new ConfigEditorRevisionState()
        revisions.resetSource(source)
        const decoded = decodeVisualConfigYaml(source)
        const next = { ...decoded.values, debug: true }
        const apply = (yaml: string) => encodeVisualConfigYaml(yaml, next, decoded.values, decoded.apiKeysStorage)
        for (let i = 0; i < 3; i++) {
            const viewed = revisions.materializeSource(apply)
            expect(parse(viewed).debug).toBe(true)
            expect(revisions.editSource(viewed)).toBe(false)
            expect(revisions.sourceDirty).toBe(false)
            expect(revisions.sourceNeedsReload).toBe(false)
        }
        for (const mode of ['source', 'visual'] as const) {
            expect(parse(revisions.buildSaveDraft('debug: false\nproxy-url: remote\n', mode, apply)))
                .toEqual({ debug: true, 'proxy-url': 'remote' })
        }
    })

    test('source edits remain intact across server changes and cannot enter visual-origin saving', () => {
        const source = 'debug: false\nproxy-url: old\n'
        const revisions = new ConfigEditorRevisionState()
        revisions.acceptServerRevision()
        revisions.resetSource(source)
        const draft = source + 'unknown:\n  exact: 9007199254740993 # keep\n'
        expect(revisions.editSource(draft)).toBe(true)
        revisions.markDraftChanged()
        expect(revisions.sourceDirty).toBe(true)
        expect(revisions.sourceNeedsReload).toBe(true)
        const decoded = decodeVisualConfigYaml(draft)
        const next = { ...decoded.values, debug: true }
        const apply = (yaml: string) => encodeVisualConfigYaml(yaml, next, decoded.values, decoded.apiKeysStorage)
        expect(() => revisions.buildSaveDraft('debug: false\nremote: changed\n', 'visual', apply))
            .toThrow('Unsaved source edits must be saved or discarded before visual editing')
        const before = revisions.buildSaveDraft('debug: false\n', 'source', apply)
        const request = revisions.beginSave()
        revisions.observeServerRevision()
        expect(revisions.isCurrentRequest(request)).toBe(false)
        expect(revisions.buildSaveDraft('debug: false\nremote: changed\n', 'source', apply)).toBe(before)
        expect(before).toContain('exact: 9007199254740993 # keep')
        expect(parse(before).debug).toBe(false)
        expect(revisions.sourceDirty).toBe(true)
    })

    test('source edits reverted to the viewed materialization recover visual-origin saving', () => {
        const revisions = new ConfigEditorRevisionState()
        revisions.resetSource('debug: false\n')
        const view = revisions.materializeSource(() => 'debug: true\n')
        revisions.editSource(view + 'unknown: draft\n')
        expect(revisions.sourceDirty).toBe(true)
        revisions.editSource(view)
        expect(revisions.sourceDirty).toBe(false)
        expect(revisions.sourceNeedsReload).toBe(false)
        expect(revisions.buildSaveDraft('latest: true\n', 'source', (yaml) => yaml)).toBe('latest: true\n')
    })

    test('restoring a visual draft after reverting to server source remains dirty', () => {
        const source = 'debug: false\n'
        const state = new ConfigEditorRevisionState()
        state.resetSource(source)
        let decoded = decodeVisualConfigYaml(source)
        let baseline = decoded.values
        let next = {...baseline, debug: true}
        const apply = (yaml: string) => encodeVisualConfigYaml(yaml, next, baseline, decoded.apiKeysStorage)
        const view = state.materializeSource(apply)
        const change = (yaml: string) => {
            state.editSource(yaml)
            state.markDraftChanged()
            if (!state.sourceDirty && state.sourceNeedsReload) {
                decoded = decodeVisualConfigYaml(yaml)
                baseline = structuredClone(decoded.values)
                next = decoded.values
                state.acceptVisualSource()
            }
        }
        change(source)
        change(view)
        expect(state.sourceDirty).toBe(true)
        expect(state.sourceNeedsReload).toBe(true)
        expect(next).toEqual(baseline)
        expect(state.buildSaveDraft(source, 'source', apply)).toBe(view)
        expect(() => state.buildSaveDraft(source, 'visual', apply)).toThrow('Unsaved source edits')
        expect(state.sourceDirty).toBe(true)
    })

    test('invalid source remains available for correction and reset clears source origin', () => {
        const revisions = new ConfigEditorRevisionState()
        revisions.resetSource('debug: false\n')
        revisions.editSource('invalid: [')
        expect(() => decodeVisualConfigYaml(revisions.buildSaveDraft('', 'source', (yaml) => yaml))).toThrow()
        expect(revisions.sourceNeedsReload).toBe(true)
        revisions.editSource('debug: true\nunknown: retained\n')
        expect(revisions.buildSaveDraft('remote: true\n', 'source', (yaml) => yaml)).toContain('unknown: retained')
        expect(() => revisions.buildSaveDraft('remote: true\n', 'visual', (yaml) => yaml))
            .toThrow('Unsaved source edits')
        revisions.resetSource('debug: false\n')
        expect(revisions.sourceDirty).toBe(false)
        expect(revisions.sourceNeedsReload).toBe(false)
    })

    test('keeps source drafts in source mode until saved or discarded', () => {
        const page = readFileSync(new URL('../src/pages/ConfigPage.tsx', import.meta.url), 'utf8')
        expect(page).toContain("if (tab === 'visual' && revisionStateRef.current.sourceDirty)")
        expect(page).toContain("if (activeTab === 'visual' && revisionStateRef.current.sourceDirty)")
        expect(page).toContain("t('config_management.source_changes_before_visual')")
        for (const locale of ['en', 'ru', 'zh-CN', 'zh-TW']) {
            const strings = JSON.parse(readFileSync(new URL(`../src/i18n/locales/${locale}.json`, import.meta.url), 'utf8'))
            expect(strings.config_management.source_changes_before_visual).toBeTruthy()
        }
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
