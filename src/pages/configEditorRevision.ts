export type ConfigRevisionSnapshot = Readonly<{
    authGeneration: number
    serverRevision: number
    draftRevision: number
    draftBaseRevision: number
}>

type ConfigRequestRevision = ConfigRevisionSnapshot & Readonly<{
    kind: 'load' | 'save'
    generation: number
}>

export class ConfigEditorRevisionState {
    private loadGeneration: number    = 0
    private saveGeneration: number    = 0
    private serverRevision: number    = 0
    private draftRevision: number     = 0
    private draftBaseRevision: number = 0
    private sourceBaseYaml = ''
    private sourceText = ''
    private cleanSourceYaml = ''
    private sourceViewBaseline = ''
    private sourceDirtyBeforeView = false
    sourceDirty = false
    sourceNeedsReload = false
    private readonly authGeneration: number

    constructor(private readonly getAuthGeneration: () => number = () => 0) {
        this.authGeneration = getAuthGeneration()
    }

    resetSource(yaml: string): void {
        this.sourceBaseYaml = yaml
        this.sourceText = yaml
        this.cleanSourceYaml = yaml
        this.sourceViewBaseline = yaml
        this.sourceDirtyBeforeView = false
        this.sourceDirty = false
        this.sourceNeedsReload = false
    }

    materializeSource(applyVisualChanges: (yaml: string) => string): string {
        const yaml = applyVisualChanges(this.sourceBaseYaml)
        this.sourceText = yaml
        this.sourceViewBaseline = yaml
        this.sourceDirtyBeforeView = this.sourceDirty
        this.sourceNeedsReload = false
        return yaml
    }

    editSource(yaml: string): boolean {
        if (yaml === this.sourceText) {
            return false
        }
        this.sourceText = yaml
        this.sourceDirty = yaml !== this.cleanSourceYaml && (this.sourceDirtyBeforeView || yaml !== this.sourceViewBaseline)
        this.sourceNeedsReload = yaml !== this.sourceViewBaseline
        return true
    }

    acceptVisualSource(): void {
        this.sourceBaseYaml = this.sourceText
        this.sourceViewBaseline = this.sourceText
        this.sourceDirtyBeforeView = this.sourceDirty
        this.sourceNeedsReload = false
    }

    buildSaveDraft(latestServerYaml: string, mode: 'visual' | 'source', applyVisualChanges: (yaml: string) => string): string {
        if (this.sourceDirty) {
            if (mode !== 'source') {
                throw new Error('Unsaved source edits must be saved or discarded before visual editing')
            }
            return this.sourceText
        }
        if (mode === 'source' && this.sourceNeedsReload) {
            return this.sourceText
        }
        return applyVisualChanges(latestServerYaml)
    }

    snapshot(): ConfigRevisionSnapshot {
        return {
            authGeneration: this.authGeneration,
            serverRevision: this.serverRevision,
            draftRevision: this.draftRevision,
            draftBaseRevision: this.draftBaseRevision,
        }
    }

    beginLoad(): ConfigRequestRevision {
        this.loadGeneration += 1
        return {
            kind: 'load',
            generation: this.loadGeneration,
            ...this.snapshot(),
        }
    }

    beginSave(): ConfigRequestRevision {
        this.loadGeneration += 1
        this.saveGeneration += 1
        return {
            kind: 'save',
            generation: this.saveGeneration,
            ...this.snapshot(),
        }
    }

    isCurrentRequest(request: ConfigRequestRevision): boolean {
        return this.isCurrentGeneration(request) && this.matches(request)
    }

    isCurrentGeneration(request: ConfigRequestRevision): boolean {
        return request.authGeneration === this.authGeneration &&
               this.authGeneration === this.getAuthGeneration() &&
               request.generation === (
                   request.kind === 'load' ? this.loadGeneration : this.saveGeneration
               )
    }

    matches(revision: ConfigRevisionSnapshot): boolean {
        return revision.authGeneration === this.authGeneration &&
               this.authGeneration === this.getAuthGeneration() &&
               revision.serverRevision === this.serverRevision &&
               revision.draftRevision === this.draftRevision &&
               revision.draftBaseRevision === this.draftBaseRevision
    }

    markDraftChanged(): void {
        this.draftRevision += 1
    }

    acceptServerRevision(): ConfigRevisionSnapshot {
        this.serverRevision += 1
        this.draftRevision += 1
        this.draftBaseRevision = this.serverRevision
        return this.snapshot()
    }

    observeServerRevision(): ConfigRevisionSnapshot {
        this.serverRevision += 1
        return this.snapshot()
    }

    resetDraftToServer(): ConfigRevisionSnapshot {
        this.draftRevision += 1
        this.draftBaseRevision = this.serverRevision
        return this.snapshot()
    }

    invalidate(): void {
        this.loadGeneration += 1
        this.saveGeneration += 1
    }
}
