/**
 * Quota cache that survives route switches.
 */

import type {
    AntigravityQuotaState,
    ClaudeQuotaState,
    CodexQuotaState,
    DevinQuotaState,
    GeminiCliQuotaState,
    KimiQuotaState,
    MetaQuotaState,
    QuotaCacheMetadata,
    XaiQuotaState,
} from '@/types'
import type {PluginQuotaResult} from '@/components/credentials/pluginQuota'
import {create} from 'zustand'

interface QuotaSubjectVersion {
    localGeneration: number
    backendGeneration: number
    backendStateRevision: number
    minimumBackendGeneration: number
    tombstone: boolean
}

interface QuotaRequestClaim {
    connectionGeneration: number
    cacheGeneration: number
    subjectGenerations: Record<string, number>
}

type QuotaSnapshotCommitResult =
    | 'committed'
    | 'stale_request'
    | 'stale_subject'
    | 'invalid_backend_version'
    | 'older_backend_version'

export const quotaRequestClaimSignature = (claim: QuotaRequestClaim): string => JSON.stringify([
                                                                                                   claim.connectionGeneration,
                                                                                                   claim.cacheGeneration,
                                                                                                   Object.entries(claim.subjectGenerations)
                                                                                                         .sort((
                                                                                                                   [left],
                                                                                                                   [right],
                                                                                                               ) => left.localeCompare(
                                                                                                             right)),
                                                                                               ])

export type QuotaCachePayload =
    | { provider: 'antigravity'; value: AntigravityQuotaState }
    | { provider: 'claude'; value: ClaudeQuotaState }
    | { provider: 'codex'; value: CodexQuotaState }
    | { provider: 'devin'; value: DevinQuotaState }
    | { provider: 'gemini-cli'; value: GeminiCliQuotaState }
    | { provider: 'kimi'; value: KimiQuotaState }
    | { provider: 'meta'; value: MetaQuotaState }
    | { provider: 'xai'; value: XaiQuotaState }

interface QuotaSnapshotCommit {
    key: string
    metadata: QuotaCacheMetadata
    payload?: QuotaCachePayload
    clearData?: boolean
    failure?: string
}

interface QuotaStoreState {
    cacheGeneration: number
    subjectVersions: Record<string, QuotaSubjectVersion>
    quotaMetadata: Record<string, QuotaCacheMetadata>
    antigravityQuota: Record<string, AntigravityQuotaState>
    claudeQuota: Record<string, ClaudeQuotaState>
    codexQuota: Record<string, CodexQuotaState>
    devinQuota: Record<string, DevinQuotaState>
    geminiCliQuota: Record<string, GeminiCliQuotaState>
    kimiQuota: Record<string, KimiQuotaState>
    metaQuota: Record<string, MetaQuotaState>
    xaiQuota: Record<string, XaiQuotaState>
    pluginQuota: Record<string, PluginQuotaResult>
    advanceQuotaSubjects: (keys: string[]) => void
    clearQuotaSubjects: (keys: string[]) => void
    clearQuotaCache: () => void
}

const emptySubjectVersion = (): QuotaSubjectVersion => ({
    localGeneration: 0,
    backendGeneration: 0,
    backendStateRevision: 0,
    minimumBackendGeneration: 0,
    tombstone: false,
})

const withoutKeys = <T>(cache: Record<string, T>, keys: Set<string>): Record<string, T> => {
    let next: Record<string, T> | null = null
    for (const key of keys) {
        if (!(key in cache)) {
            continue
        }
        next ??= { ...cache }
        delete next[key]
    }
    return next ?? cache
}

const quotaDataKeys = (state: QuotaStoreState): Set<string> => new Set([
                                                                           ...Object.keys(state.quotaMetadata),
                                                                           ...Object.keys(state.subjectVersions),
                                                                           ...Object.keys(state.antigravityQuota),
                                                                           ...Object.keys(state.claudeQuota),
                                                                           ...Object.keys(state.codexQuota),
                                                                           ...Object.keys(state.devinQuota),
                                                                           ...Object.keys(state.geminiCliQuota),
                                                                           ...Object.keys(state.kimiQuota),
                                                                           ...Object.keys(state.metaQuota),
                                                                           ...Object.keys(state.xaiQuota),
                                                                           ...Object.keys(state.pluginQuota),
                                                                       ])

const invalidateQuotaSubjects = (state: QuotaStoreState, keys: Set<string>): Partial<QuotaStoreState> => {
    const subjectVersions = { ...state.subjectVersions }
    for (const key of keys) {
        const current        = subjectVersions[key] ?? emptySubjectVersion()
        subjectVersions[key] = {
            ...current,
            localGeneration: current.localGeneration + 1,
            minimumBackendGeneration: current.tombstone
                                      ? current.minimumBackendGeneration
                                      : Math.max(current.minimumBackendGeneration, current.backendGeneration + 1),
            tombstone: true,
        }
    }
    return {
        subjectVersions,
        quotaMetadata: withoutKeys(state.quotaMetadata, keys),
        antigravityQuota: withoutKeys(state.antigravityQuota, keys),
        claudeQuota: withoutKeys(state.claudeQuota, keys),
        codexQuota: withoutKeys(state.codexQuota, keys),
        devinQuota: withoutKeys(state.devinQuota, keys),
        geminiCliQuota: withoutKeys(state.geminiCliQuota, keys),
        kimiQuota: withoutKeys(state.kimiQuota, keys),
        metaQuota: withoutKeys(state.metaQuota, keys),
        xaiQuota: withoutKeys(state.xaiQuota, keys),
        pluginQuota: withoutKeys(state.pluginQuota, keys),
    }
}

export const useQuotaStore = create<QuotaStoreState>((set) => ({
    cacheGeneration: 0,
    subjectVersions: {},
    quotaMetadata: {},
    antigravityQuota: {},
    claudeQuota: {},
    codexQuota: {},
    devinQuota: {},
    geminiCliQuota: {},
    kimiQuota: {},
    metaQuota: {},
    xaiQuota: {},
    pluginQuota: {},
    advanceQuotaSubjects: (keys) => {
        const normalized = new Set(keys.map((key) => key.trim()).filter(Boolean))
        if (normalized.size === 0) {
            return
        }
        set((state) => {
            const subjectVersions = {...state.subjectVersions}
            for (const key of normalized) {
                const current = subjectVersions[key] ?? emptySubjectVersion()
                subjectVersions[key] = {...current, localGeneration: current.localGeneration + 1}
            }
            return {subjectVersions}
        })
    },
    clearQuotaSubjects: (keys) => {
        const normalized = new Set(keys.map((key) => key.trim()).filter(Boolean))
        if (normalized.size === 0) {
            return
        }
        set((state) => invalidateQuotaSubjects(state, normalized))
    },
    clearQuotaCache: () =>
        set((state) => ({
            cacheGeneration: state.cacheGeneration + 1,
            subjectVersions: {},
            quotaMetadata: {},
            antigravityQuota: {},
            claudeQuota: {},
            codexQuota: {},
            devinQuota: {},
            geminiCliQuota: {},
            kimiQuota: {},
            metaQuota: {},
            xaiQuota: {},
            pluginQuota: {},
        })),
}))

export const captureQuotaRequestClaim = (connectionGeneration: number): QuotaRequestClaim => {
    const state                                      = useQuotaStore.getState()
    const subjectGenerations: Record<string, number> = {}
    for (const key of quotaDataKeys(state)) {
        subjectGenerations[key] = state.subjectVersions[key]?.localGeneration ?? 0
    }
    return {
        connectionGeneration,
        cacheGeneration: state.cacheGeneration,
        subjectGenerations,
    }
}

export const isQuotaRequestCurrent = (
    claim: QuotaRequestClaim,
    connectionGeneration: number,
): boolean => {
    const state = useQuotaStore.getState()
    return claim.connectionGeneration === connectionGeneration && claim.cacheGeneration === state.cacheGeneration
}

export const areQuotaSubjectsCurrent = (
    claim: QuotaRequestClaim,
    connectionGeneration: number,
    keys: Iterable<string>,
): boolean => {
    if (!isQuotaRequestCurrent(claim, connectionGeneration)) {
        return false
    }
    const state = useQuotaStore.getState()
    for (const key of keys) {
        const current = state.subjectVersions[key]?.localGeneration ?? 0
        if (current !== (claim.subjectGenerations[key] ?? 0)) {
            return false
        }
    }
    return true
}

const hasQuotaData = (state: QuotaStoreState, key: string): boolean =>
    key in state.antigravityQuota ||
    key in state.claudeQuota ||
    key in state.codexQuota ||
    key in state.devinQuota ||
    key in state.geminiCliQuota ||
    key in state.kimiQuota ||
    key in state.metaQuota ||
    key in state.xaiQuota ||
    key in state.pluginQuota

export const commitQuotaSnapshot = (
    claim: QuotaRequestClaim,
    connectionGeneration: number,
    snapshot: QuotaSnapshotCommit,
): QuotaSnapshotCommitResult => {
    let result: QuotaSnapshotCommitResult = 'stale_request'
    useQuotaStore.setState((state) => {
        if (!isQuotaRequestCurrent(claim, connectionGeneration)) {
            return state
        }
        const current                 = state.subjectVersions[snapshot.key] ?? emptySubjectVersion()
        const expectedLocalGeneration = claim.subjectGenerations[snapshot.key] ?? 0
        if (current.localGeneration !== expectedLocalGeneration) {
            result = 'stale_subject'
            return state
        }
        const backendGeneration    = snapshot.metadata.backendGeneration
        const backendStateRevision = snapshot.metadata.backendStateRevision
        if (
            !Number.isSafeInteger(backendGeneration) || backendGeneration <= 0 ||
            !Number.isSafeInteger(backendStateRevision) || backendStateRevision <= 0
        ) {
            result = 'invalid_backend_version'
            return state
        }
        if (
            backendGeneration < current.minimumBackendGeneration ||
            backendGeneration < current.backendGeneration ||
            backendGeneration === current.backendGeneration && backendStateRevision < current.backendStateRevision
        ) {
            result = 'older_backend_version'
            return state
        }

        const bindingChanged = backendGeneration > current.backendGeneration
        const lastKnownGood  = !bindingChanged && (
            hasQuotaData(state, snapshot.key) || (state.quotaMetadata[snapshot.key]?.successfulEmpty ?? false)
        )
        const metadata       = snapshot.failure ? {
            ...(lastKnownGood && state.quotaMetadata[snapshot.key]
                ? state.quotaMetadata[snapshot.key]
                : snapshot.metadata),
            fileName: snapshot.metadata.fileName,
            type: snapshot.metadata.type,
            backendGeneration,
            backendStateRevision,
            status: 'error',
            freshness: lastKnownGood ? 'stale' as const : 'outdated' as const,
            lastError: snapshot.failure,
            lastErrorAt: snapshot.metadata.fetchedAt ?? snapshot.metadata.lastErrorAt,
            fetchedAt: snapshot.metadata.fetchedAt,
            retryAt: snapshot.metadata.retryAt,
            lastRefreshAt: snapshot.metadata.lastRefreshAt,
            nextRefreshAt: snapshot.metadata.nextRefreshAt,
        } : snapshot.metadata
        const replaceData    = bindingChanged || snapshot.clearData === true || snapshot.payload !== undefined
        const keys           = new Set([snapshot.key])
        let antigravityQuota = replaceData ? withoutKeys(state.antigravityQuota, keys) : state.antigravityQuota
        let claudeQuota      = replaceData ? withoutKeys(state.claudeQuota, keys) : state.claudeQuota
        let codexQuota       = replaceData ? withoutKeys(state.codexQuota, keys) : state.codexQuota
        let devinQuota       = replaceData ? withoutKeys(state.devinQuota, keys) : state.devinQuota
        let geminiCliQuota   = replaceData ? withoutKeys(state.geminiCliQuota, keys) : state.geminiCliQuota
        let kimiQuota        = replaceData ? withoutKeys(state.kimiQuota, keys) : state.kimiQuota
        let metaQuota        = replaceData ? withoutKeys(state.metaQuota, keys) : state.metaQuota
        let xaiQuota         = replaceData ? withoutKeys(state.xaiQuota, keys) : state.xaiQuota
        const pluginQuota    = replaceData ? withoutKeys(state.pluginQuota, keys) : state.pluginQuota
        switch (snapshot.payload?.provider) {
            case 'antigravity':
                antigravityQuota = { ...antigravityQuota, [snapshot.key]: snapshot.payload.value }
                break
            case 'claude':
                claudeQuota = { ...claudeQuota, [snapshot.key]: snapshot.payload.value }
                break
            case 'codex':
                codexQuota = { ...codexQuota, [snapshot.key]: snapshot.payload.value }
                break
            case 'devin':
                devinQuota = { ...devinQuota, [snapshot.key]: snapshot.payload.value }
                break
            case 'gemini-cli':
                geminiCliQuota = { ...geminiCliQuota, [snapshot.key]: snapshot.payload.value }
                break
            case 'kimi':
                kimiQuota = { ...kimiQuota, [snapshot.key]: snapshot.payload.value }
                break
            case 'meta':
                metaQuota = { ...metaQuota, [snapshot.key]: snapshot.payload.value }
                break
            case 'xai':
                xaiQuota = { ...xaiQuota, [snapshot.key]: snapshot.payload.value }
                break
        }

        result = 'committed'
        return {
            subjectVersions: {
                ...state.subjectVersions,
                [snapshot.key]: {
                    localGeneration: current.localGeneration,
                    backendGeneration,
                    backendStateRevision,
                    minimumBackendGeneration: Math.max(current.minimumBackendGeneration, backendGeneration),
                    tombstone: false,
                },
            },
            quotaMetadata: { ...state.quotaMetadata, [snapshot.key]: metadata },
            antigravityQuota,
            claudeQuota,
            codexQuota,
            devinQuota,
            geminiCliQuota,
            kimiQuota,
            metaQuota,
            xaiQuota,
            pluginQuota,
        }
    })
    return result
}

export const markQuotaSnapshotRejected = (
    claim: QuotaRequestClaim,
    connectionGeneration: number,
    snapshot: QuotaSnapshotCommit,
    error: string,
    failedAt: string,
): boolean => {
    let changed = false
    useQuotaStore.setState((state) => {
        if (!isQuotaRequestCurrent(claim, connectionGeneration)) {
            return state
        }
        const current                 = state.subjectVersions[snapshot.key] ?? emptySubjectVersion()
        const expectedLocalGeneration = claim.subjectGenerations[snapshot.key] ?? 0
        if (current.localGeneration !== expectedLocalGeneration || current.tombstone) {
            return state
        }
        const previous      = state.quotaMetadata[snapshot.key]
        const lastKnownGood = hasQuotaData(state, snapshot.key) || (previous?.successfulEmpty ?? false)
        changed             = true
        return {
            quotaMetadata: {
                ...state.quotaMetadata,
                [snapshot.key]: {
                    ...(previous ?? snapshot.metadata),
                    status: 'error',
                    freshness: lastKnownGood ? 'stale' : 'outdated',
                    lastError: error,
                    lastErrorAt: failedAt,
                },
            },
        }
    })
    return changed
}

export const markQuotaRequestFailed = (
    claim: QuotaRequestClaim,
    connectionGeneration: number,
    error: string,
    failedAt: string,
): boolean => {
    let changed = false
    useQuotaStore.setState((state) => {
        if (!isQuotaRequestCurrent(claim, connectionGeneration)) {
            return state
        }
        const quotaMetadata = { ...state.quotaMetadata }
        for (const [key, localGeneration] of Object.entries(claim.subjectGenerations)) {
            const current  = state.subjectVersions[key] ?? emptySubjectVersion()
            const metadata = quotaMetadata[key]
            if (current.localGeneration !== localGeneration || current.tombstone || !metadata) {
                continue
            }
            const lastKnownGood = hasQuotaData(state, key) || metadata.successfulEmpty
            quotaMetadata[key]  = {
                ...metadata,
                status: 'error',
                freshness: lastKnownGood ? 'stale' : 'outdated',
                lastError: error,
                lastErrorAt: failedAt,
            }
            changed             = true
        }
        return changed ? { quotaMetadata } : state
    })
    return changed
}

export const reconcileQuotaSubjects = (
    claim: QuotaRequestClaim,
    connectionGeneration: number,
    seenKeys: Set<string>,
    omittedAt = new Date().toISOString(),
): boolean => {
    let changed = false
    useQuotaStore.setState((state) => {
        if (!isQuotaRequestCurrent(claim, connectionGeneration)) {
            return state
        }
        const quotaMetadata = { ...state.quotaMetadata }
        for (const [key, localGeneration] of Object.entries(claim.subjectGenerations)) {
            const current  = state.subjectVersions[key] ?? emptySubjectVersion()
            const metadata = quotaMetadata[key]
            if (seenKeys.has(key) || current.localGeneration !== localGeneration || current.tombstone || !metadata) {
                continue
            }
            const lastKnownGood = hasQuotaData(state, key) || metadata.successfulEmpty
            quotaMetadata[key]  = {
                ...metadata,
                status: 'error',
                freshness: lastKnownGood ? 'stale' : 'outdated',
                lastError: 'Quota status response omitted this credential',
                lastErrorAt: omittedAt,
            }
            changed            = true
        }
        return changed ? { quotaMetadata } : state
    })
    return changed
}
