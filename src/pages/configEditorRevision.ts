export type ConfigRevisionSnapshot = Readonly<{
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

    snapshot(): ConfigRevisionSnapshot {
        return {
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
        return request.generation === (
               request.kind === 'load' ? this.loadGeneration : this.saveGeneration
        )
    }

    matches(revision: ConfigRevisionSnapshot): boolean {
        return revision.serverRevision === this.serverRevision &&
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
