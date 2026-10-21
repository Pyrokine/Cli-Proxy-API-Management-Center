/**
 * Backend-driven quota registration.
 *
 * Polls GET /quota/status and maps backend data into the existing QuotaStore.
 */

import i18n from '@/i18n'
import {apiClient} from '@/services/api/client'
import {quotaApi, type QuotaEntry, type QuotaRefreshTask, type QuotaRefreshTaskTarget} from '@/services/api/quota'
import {useNotificationStore} from '@/stores/useNotificationStore'
import {
    areQuotaSubjectsCurrent,
    captureQuotaRequestClaim,
    commitQuotaSnapshot,
    isQuotaRequestCurrent,
    markQuotaRequestFailed,
    markQuotaSnapshotRejected,
    type QuotaCachePayload,
    quotaRequestClaimSignature,
    reconcileQuotaSubjects,
    useQuotaStore,
} from '@/stores/useQuotaStore'
import type {
    AntigravityQuotaState,
    ClaudeExtraUsage,
    ClaudeQuotaState,
    CodexQuotaState,
    CodexQuotaWindow,
    GeminiCliQuotaBucketState,
    GeminiCliQuotaState,
    KimiQuotaState,
    MetaQuotaState,
    QuotaCacheMetadata,
    QuotaFreshness,
    XaiQuotaState,
} from '@/types'
import type {AuthFileItem} from '@/types/authFile'
import {formatDateTime} from '@/utils/format'
import {buildClaudeQuotaWindows, buildKimiQuotaRows} from '@/utils/quota/builders'
import {parseClaudeResetGrants} from '@/utils/quota/claudeResetGrants'
import {resolveCodexResetCredits} from '@/utils/quota/codexResetCredits'
import {parseDevinQuotaPayload} from '@/utils/quota/devin'
import {quotaCredentialKey} from '@/utils/quota/credentialKey'
import {parseMetaSubscriptionSnapshot} from '@/utils/quota/metaSubscription'
import {normalizeCodexAccountCredits} from '@/utils/quota/parsers'
import {parseOffsetSecondsToMs, resolveResetMs} from '@/utils/quota/resetInstants'
import {resolveClaudePlanType} from '@/utils/quota/resolvers'
import {parseXaiQuotaPayload} from '@/utils/quota/xaiBilling'
import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {waitForQuotaRefreshTask} from './quotaRefreshTask'

interface EntryMeta {
    fileName: string
    type: string
    lastRefresh: Date | null
    nextRefresh: Date | null
    status: string
}

interface QuotaPollRequest {
    claimSignature: string
    promise: Promise<void>
}

const quotaFreshness = (value: string | undefined): QuotaFreshness => {
    switch (value) {
        case 'fresh':
        case 'stale':
        case 'partial':
        case 'outdated':
            return value
        default:
            return 'outdated'
    }
}

const quotaMetadataFromEntry = (fileName: string, entry: QuotaEntry): QuotaCacheMetadata => ({
    fileName,
    type: entry.type,
    backendGeneration: entry.generation,
    backendStateRevision: entry.state_revision,
    status: entry.status,
    freshness: quotaFreshness(entry.freshness),
    source: entry.source?.trim() || undefined,
    observedAt: entry.observed_at ?? null,
    fetchedAt: entry.fetched_at ?? null,
    lastSuccessAt: entry.last_success_at ?? null,
    lastError: entry.last_error?.trim() || entry.error?.trim() || undefined,
    lastErrorAt: entry.last_error_at ?? null,
    retryAt: entry.retry_at ?? null,
    successfulEmpty: entry.successful_empty === true,
    lastRefreshAt: entry.last_refresh,
    nextRefreshAt: entry.next_refresh,
})

const entryMetaFromMetadata = (metadata: QuotaCacheMetadata, quotaEnabled: boolean): EntryMeta => ({
    fileName: metadata.fileName,
    type: metadata.type,
    lastRefresh: metadata.lastRefreshAt ? new Date(metadata.lastRefreshAt) : null,
    nextRefresh: quotaEnabled && metadata.nextRefreshAt ? new Date(metadata.nextRefreshAt) : null,
    status: metadata.status,
})

const quotaMetaSnapshot = (quotaEnabled: boolean): Record<string, EntryMeta> =>
    Object.fromEntries(
        Object.entries(useQuotaStore.getState().quotaMetadata).map(([key, metadata]) => [
            key,
            entryMetaFromMetadata(metadata, quotaEnabled),
        ]),
    )

export function useBackendQuotaRegistration(authFiles: AuthFileItem[]) {
    const cacheGeneration                     = useQuotaStore((state) => state.cacheGeneration)
    const { i18n: translation }               = useTranslation()
    const quotaLanguage                       = translation.resolvedLanguage ?? translation.language
    const mounted                             = useRef(true)
    const pollPromiseRef                      = useRef<QuotaPollRequest | null>(null)
    const refreshControllersRef               = useRef(new Set<AbortController>())
    const metaRef                             = useRef<Record<string, EntryMeta>>({})
    const quotaEnabledRef                     = useRef(false)
    const [meta, setMeta]                     = useState<Record<string, EntryMeta>>({})
    const [quotaEnabled, setQuotaEnabled]     = useState(false)
    const [pollIntervalMs, setPollIntervalMs] = useState(0)

    const poll = useCallback((): Promise<void> => {
        const claim          = captureQuotaRequestClaim(apiClient.getAuthGeneration())
        const claimSignature = quotaRequestClaimSignature(claim)
        const inFlight       = pollPromiseRef.current
        if (inFlight?.claimSignature === claimSignature) {
            return inFlight.promise
        }

        let repollCurrent      = false
        const request          = (async () => {
            try {
                const status               = await quotaApi.getStatus()
                const connectionGeneration = apiClient.getAuthGeneration()
                if (!mounted.current) {
                    return
                }
                if (!isQuotaRequestCurrent(claim, connectionGeneration)) {
                    repollCurrent = true
                    return
                }

                quotaEnabledRef.current = status.enabled
                setQuotaEnabled(status.enabled)
                setPollIntervalMs(status.enabled ? Math.max(status.interval_seconds, 0) * 1000 : 0)

                const seenKeys   = new Set<string>()
                const rejectedAt = new Date().toISOString()
                for (const [credentialKey, entry] of Object.entries(status.credentials)) {
                    const fileName = entry.file_name?.trim() || credentialKey
                    const metaKey  = quotaCredentialKey(entry.type, fileName, entry.auth_index)
                    seenKeys.add(metaKey)

                    let data: unknown
                    let payload: QuotaCachePayload | undefined
                    let parseErrorMessage: string | undefined
                    const hasData         = entry.data !== undefined && entry.data !== null
                    const successfulEmpty =
                              entry.status === 'success' && entry.successful_empty === true && !hasData
                    if (entry.successful_empty === true && !successfulEmpty) {
                        parseErrorMessage = quotaParseErrorMessage(invalidQuotaPayload(entry.type || 'unknown'))
                    } else if (hasData) {
                        try {
                            data    = typeof entry.data === 'string' ? JSON.parse(entry.data) : entry.data
                            payload = mapQuotaPayload(entry.type, data)
                        } catch (e) {
                            parseErrorMessage = quotaParseErrorMessage(e)
                            console.warn('[QuotaScheduler] failed to parse entry data:', metaKey, e)
                        }
                    } else if (entry.status === 'success' && !successfulEmpty) {
                        parseErrorMessage = quotaParseErrorMessage(invalidQuotaPayload(entry.type || 'unknown'))
                    }

                    const metadata           = quotaMetadataFromEntry(fileName, entry)
                    metadata.successfulEmpty = successfulEmpty
                    metadata.status          = parseErrorMessage
                                               ? 'error'
                                               : resolveEntryStatus(entry.type, entry.status, data)
                    const snapshot           = {
                        key: metaKey,
                        metadata,
                        payload,
                        clearData: successfulEmpty,
                        failure: parseErrorMessage,
                    }
                    const result             = commitQuotaSnapshot(claim, connectionGeneration, snapshot)
                    if (result === 'stale_request' || result === 'stale_subject') {
                        repollCurrent = true
                    } else if (result === 'invalid_backend_version' || result === 'older_backend_version') {
                        markQuotaSnapshotRejected(
                            claim,
                            connectionGeneration,
                            snapshot,
                            quotaSnapshotRejectionMessage(result),
                            rejectedAt,
                        )
                    }
                }

                reconcileQuotaSubjects(claim, connectionGeneration, seenKeys)
                if (!isQuotaRequestCurrent(claim, apiClient.getAuthGeneration())) {
                    repollCurrent = true
                    return
                }
                const newMeta   = quotaMetaSnapshot(status.enabled)
                metaRef.current = newMeta
                setMeta(newMeta)
            } catch (e) {
                const connectionGeneration = apiClient.getAuthGeneration()
                if (!mounted.current) {
                    return
                }
                if (!isQuotaRequestCurrent(claim, connectionGeneration)) {
                    repollCurrent = true
                    return
                }
                const message = e instanceof Error ? e.message : String(e ?? '')
                console.warn('[QuotaScheduler] poll failed:', e)
                markQuotaRequestFailed(claim, connectionGeneration, message, new Date().toISOString())
                const newMeta   = quotaMetaSnapshot(quotaEnabledRef.current)
                metaRef.current = newMeta
                setMeta(newMeta)
            }
        })()
        const trackedRequest   = { claimSignature, promise: request }
        pollPromiseRef.current = trackedRequest
        const finishRequest    = () => {
            if (pollPromiseRef.current === trackedRequest) {
                pollPromiseRef.current = null
            }
            if (repollCurrent && mounted.current) {
                queueMicrotask(() => void poll())
            }
        }
        void request.then(finishRequest, finishRequest)
        return request
    }, [])

    const pollLatest = useCallback(async () => {
        const currentSignature = quotaRequestClaimSignature(
            captureQuotaRequestClaim(apiClient.getAuthGeneration()),
        )
        const inFlight         = pollPromiseRef.current
        if (inFlight?.claimSignature === currentSignature) {
            await inFlight.promise
        }
        await poll()
    }, [poll])

    useEffect(() => {
        mounted.current   = true
        const controllers = refreshControllersRef.current
        return () => {
            mounted.current = false
            controllers.forEach((controller) => controller.abort())
            controllers.clear()
        }
    }, [])

    useEffect(() => {
        void pollLatest()
    }, [authFiles, cacheGeneration, quotaLanguage, pollLatest])

    useEffect(() => {
        if (pollIntervalMs <= 0) {
            return
        }
        const id = window.setInterval(() => void poll(), pollIntervalMs)
        return () => window.clearInterval(id)
    }, [poll, pollIntervalMs])

    const statusMap = useMemo(() => {
        const next: Record<string, string> = {}
        for (const [metaKey, entry] of Object.entries(meta)) {
            next[metaKey] = entry.status
        }
        return next
    }, [meta])

    const refreshMany = useCallback(
        async (names: string[]) => {
            const uniqueNames = Array.from(new Set(names.map((name) => name.trim()).filter(Boolean)))
            if (uniqueNames.length === 0) {
                return
            }

            const claim                                               = captureQuotaRequestClaim(apiClient.getAuthGeneration())
            const controller                                          = new AbortController()
            const initialMetaKeys                                     = refreshMetaKeysForIdentifiers(
                uniqueNames,
                metaRef.current,
            )
            const claimedKeys                                         = new Set(initialMetaKeys)
            const isUIClaimCurrent                                    = () =>
                mounted.current && areQuotaSubjectsCurrent(
                                    claim,
                                    apiClient.getAuthGeneration(),
                                    claimedKeys,
                                )
            const previousMeta: Record<string, EntryMeta | undefined> = {}
            for (const metaKey of initialMetaKeys) {
                previousMeta[metaKey] = metaRef.current[metaKey]
            }
            refreshControllersRef.current.add(controller)
            setMeta((prev) => {
                const next      = markQuotaMetaLoading(prev, initialMetaKeys, quotaEnabled)
                metaRef.current = next
                return next
            })

            let taskCreated = false
            try {
                const initialTask = await quotaApi.refresh(uniqueNames, { signal: controller.signal })
                taskCreated       = true
                refreshControllersRef.current.delete(controller)

                const taskMetaKeys = refreshMetaKeysForTask(initialTask, metaRef.current)
                taskMetaKeys.forEach((metaKey) => claimedKeys.add(metaKey))
                for (const metaKey of taskMetaKeys) {
                    if (!(metaKey in previousMeta)) {
                        previousMeta[metaKey] = metaRef.current[metaKey]
                    }
                }
                if (isUIClaimCurrent()) {
                    setMeta((prev) => {
                        const next      = applyQuotaRefreshTaskToMeta(
                            markQuotaMetaLoading(prev, taskMetaKeys, quotaEnabled),
                            initialTask,
                            previousMeta,
                        )
                        metaRef.current = next
                        return next
                    })
                }

                const terminalTask = await waitForQuotaRefreshTask(initialTask, {
                    onProgress: async () => {
                        if (isUIClaimCurrent()) {
                            await pollLatest()
                        }
                    },
                })
                if (isUIClaimCurrent()) {
                    setMeta((prev) => {
                        const next      = applyQuotaRefreshTaskToMeta(prev, terminalTask, previousMeta)
                        metaRef.current = next
                        return next
                    })
                }
                if (mounted.current) {
                    await pollLatest()
                }
                if (isUIClaimCurrent() && terminalTask.status !== 'succeeded') {
                    const message = terminalTask.error || terminalTask.status
                    useNotificationStore.getState().showNotification(
                        i18n.t('auth_files.quota_refresh_failed', {
                            name: uniqueNames.join(', '),
                            message,
                        }),
                        terminalTask.status === 'cancelled' ? 'warning' : 'error',
                    )
                }
            } catch (e) {
                const canPublish = isUIClaimCurrent()
                if (!taskCreated && (controller.signal.aborted || !canPublish)) {
                    if (mounted.current) {
                        await pollLatest()
                    }
                    return
                }

                console.warn('[useBackendQuotaRegistration] refresh failed for', uniqueNames, e)
                if (taskCreated) {
                    if (mounted.current) {
                        await pollLatest()
                    }
                } else if (canPublish) {
                    setMeta((prev) => {
                        const next = { ...prev }
                        for (const metaKey of initialMetaKeys) {
                            const previous = previousMeta[metaKey]
                            if (previous) {
                                next[metaKey] = previous
                            } else {
                                delete next[metaKey]
                            }
                        }
                        metaRef.current = next
                        return next
                    })
                }
                if (isUIClaimCurrent()) {
                    const message = e instanceof Error ? e.message : String(e ?? '')
                    useNotificationStore.getState().showNotification(
                        i18n.t('auth_files.quota_refresh_failed', {
                            name: uniqueNames.join(', '),
                            message,
                        }),
                        'error',
                    )
                }
            } finally {
                refreshControllersRef.current.delete(controller)
            }
        },
        [pollLatest, quotaEnabled],
    )

    return {
        statusMap,
        getLastRefreshTime: (name: string): Date | null => metaForIdentifier(meta, name)?.lastRefresh ?? null,
        getNextRefreshTime: (name: string): Date | null => quotaEnabled ?
                                                           (metaForIdentifier(meta, name)?.nextRefresh ?? null) :
                                                           null,
        getStatus: (name: string): string => metaForIdentifier(meta, name)?.status ?? 'idle',
        isRefreshing: (name: string) => metaForIdentifier(meta, name)?.status === 'loading',
        isAutoRefreshEnabled: () => quotaEnabled,
        refreshNow: async (name: string) => {
            await refreshMany([name])
        },
        refreshMany,
    }
}

function quotaSnapshotRejectionMessage(
    result: 'invalid_backend_version' | 'older_backend_version',
): string {
    return result === 'invalid_backend_version'
           ? i18n.t('credentials.quota_invalid_backend_version')
           : i18n.t('credentials.quota_older_backend_version')
}

function quotaParseErrorMessage(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error ?? '')
    return message ?
           i18n.t(
               'credentials.quota_parse_failed_with_message',
               { defaultValue: '配额数据解析失败: {{message}}', message },
           ) :
           i18n.t('credentials.quota_parse_failed', { defaultValue: '配额数据解析失败' })
}

function invalidQuotaPayload(provider: string): Error {
    return new Error(i18n.t(
        'credentials.quota_invalid_payload',
        { defaultValue: '{{provider}} 配额数据结构无效', provider },
    ))
}

function metaForIdentifier(meta: Record<string, EntryMeta>, identifier: string): EntryMeta | null {
    const direct = meta[identifier]
    if (direct) {
        return direct
    }
    return Object.values(meta).find((entry) => entry.fileName === identifier) ?? null
}

function refreshMetaKeysForIdentifiers(identifiers: string[], meta: Record<string, EntryMeta>): string[] {
    const keys = new Set<string>()
    for (const identifier of identifiers) {
        if (meta[identifier]) {
            keys.add(identifier)
            continue
        }
        let matched = false
        for (const [metaKey, entry] of Object.entries(meta)) {
            if (entry.fileName !== identifier) {
                continue
            }
            keys.add(metaKey)
            matched = true
        }
        if (!matched) {
            keys.add(identifier)
        }
    }
    return Array.from(keys)
}

function refreshMetaKeysForTarget(target: QuotaRefreshTaskTarget, meta: Record<string, EntryMeta>): string[] {
    const keys     = new Set<string>()
    const entryKey = target.entry_key?.trim()
    const fileName = target.file_name?.trim()
    const provider = target.provider?.trim()
    if (entryKey) {
        return [entryKey]
    }
    if (fileName && provider) {
        keys.add(quotaCredentialKey(provider, fileName))
    }
    if (fileName) {
        for (const [metaKey, entry] of Object.entries(meta)) {
            if (entry.fileName === fileName && (!provider || entry.type === provider)) {
                keys.add(metaKey)
            }
        }
    }
    return Array.from(keys)
}

function refreshMetaKeysForTask(task: QuotaRefreshTask, meta: Record<string, EntryMeta>): string[] {
    return Array.from(new Set(task.targets.flatMap((target) => refreshMetaKeysForTarget(target, meta))))
}

function emptyMetaForKey(metaKey: string): EntryMeta {
    const [type = '', fileName = metaKey] = metaKey.split('::')
    return {
        fileName,
        type,
        lastRefresh: null,
        nextRefresh: null,
        status: 'idle',
    }
}

function markQuotaMetaLoading(
    meta: Record<string, EntryMeta>,
    metaKeys: string[],
    quotaEnabled: boolean,
): Record<string, EntryMeta> {
    const next = { ...meta }
    for (const metaKey of metaKeys) {
        const current = next[metaKey] ?? emptyMetaForKey(metaKey)
        next[metaKey] = {
            ...current,
            nextRefresh: quotaEnabled ? current.nextRefresh : null,
            status: 'loading',
        }
    }
    return next
}

function quotaMetaStatusForTarget(
    status: QuotaRefreshTaskTarget['status'],
    previousStatus: string | undefined,
): string {
    switch (status) {
        case 'queued':
        case 'running':
            return 'loading'
        case 'succeeded':
            return 'success'
        case 'failed':
        case 'inconclusive':
        case 'interrupted':
            return 'error'
        case 'skipped':
        case 'cancelled':
            return previousStatus || 'idle'
    }
}

function applyQuotaRefreshTaskToMeta(
    meta: Record<string, EntryMeta>,
    task: QuotaRefreshTask,
    previousMeta: Record<string, EntryMeta | undefined>,
): Record<string, EntryMeta> {
    const next = { ...meta }
    for (const target of task.targets) {
        for (const metaKey of refreshMetaKeysForTarget(target, next)) {
            const current = next[metaKey] ?? previousMeta[metaKey] ?? emptyMetaForKey(metaKey)
            next[metaKey] = {
                ...current,
                status: quotaMetaStatusForTarget(target.status, previousMeta[metaKey]?.status),
            }
        }
    }
    return next
}

function mapQuotaPayload(type: string, data: unknown): QuotaCachePayload {
    switch (type) {
        case 'antigravity':
            return { provider: type, value: mapAntigravity(data) }
        case 'claude':
            return { provider: type, value: mapClaude(data) }
        case 'codex':
            return { provider: type, value: mapCodex(data) }
        case 'devin': {
            const value = parseDevinQuotaPayload(data)
            if (!value) {
                throw invalidQuotaPayload('Devin')
            }
            return { provider: type, value }
        }
        case 'gemini-cli':
            return { provider: type, value: mapGemini(data) }
        case 'kimi':
            return { provider: type, value: mapKimi(data) }
        case 'meta':
            return { provider: type, value: mapMeta(data) }
        case 'xai':
            return { provider: type, value: mapXai(data) }
        default:
            throw invalidQuotaPayload(type || 'unknown')
    }
}

function isCodexQuotaExceeded(data: unknown): boolean {
    const d            = data !== null && typeof data === 'object' ? (data as Record<string, unknown>) : null
    const rateLimitRaw = d?.rate_limit ?? d?.rateLimit
    const rateLimit    =
              rateLimitRaw !== null && typeof rateLimitRaw === 'object' ?
              (rateLimitRaw as Record<string, unknown>) :
              null
    if (!rateLimit) {
        return false
    }
    const allowed      = rateLimit.allowed
    const limitReached = rateLimit.limit_reached ?? rateLimit.limitReached
    return allowed === false || limitReached === true
}

function resolveEntryStatus(type: string, status: string, data: unknown): string {
    if (status === 'success' && type === 'codex' && isCodexQuotaExceeded(data)) {
        return 'quota_exceeded'
    }
    return status
}

function parseFraction(value: unknown): number | null {
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : null
    }
    if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value)
        return Number.isFinite(parsed) ? parsed : null
    }
    return null
}

function extractCloudCodeBuckets(data: unknown): GeminiCliQuotaBucketState[] {
    const d                                    = data !== null && typeof data === 'object' ?
                                                 (data as Record<string, unknown>) :
                                                 null
    const quotaRaw                             = d ?
                                                 (typeof d.quota === 'string' ? JSON.parse(d.quota) : d.quota) :
                                                 null
    const quota                                = quotaRaw !== null && typeof quotaRaw === 'object' ?
                                                 (quotaRaw as Record<string, unknown>) :
                                                 null
    const buckets: GeminiCliQuotaBucketState[] = []

    if (!quota) {
        return buckets
    }

    const bucketsRaw = quota.buckets
    if (!Array.isArray(bucketsRaw)) {
        return buckets
    }

    for (const bucket of bucketsRaw) {
        const bucketRecord = bucket !== null && typeof bucket === 'object' ? (bucket as Record<string, unknown>) : null
        if (!bucketRecord) {
            continue
        }
        const remainingFraction = parseFraction(bucketRecord.remainingFraction ?? bucketRecord.remaining_fraction)
        if (remainingFraction === null) {
            continue
        }
        const modelId   =
                  typeof bucketRecord.modelId === 'string'
                  ? bucketRecord.modelId
                  : typeof bucketRecord.model_id === 'string'
                    ? bucketRecord.model_id
                    : null
        const tokenType =
                  typeof bucketRecord.tokenType === 'string'
                  ? bucketRecord.tokenType
                  : typeof bucketRecord.token_type === 'string'
                    ? bucketRecord.token_type
                    : null
        const resetTime =
                  typeof bucketRecord.resetTime === 'string'
                  ? bucketRecord.resetTime
                  : typeof bucketRecord.reset_time === 'string'
                    ? bucketRecord.reset_time
                    : undefined
        buckets.push({
                         id: `${modelId ?? 'unknown'}-${tokenType ?? 'unknown'}`,
                         label: modelId ?? tokenType ?? 'Quota',
                         remainingFraction,
                         remainingAmount: null,
                         resetTime,
                         resetAtMs: resolveResetMs([resetTime]),
                         tokenType,
                         modelIds: modelId ? [modelId] : undefined,
                     })
    }

    return buckets
}

function stringValueFromRecord(record: Record<string, unknown> | null, ...keys: string[]): string | null {
    if (!record) {
        return null
    }
    for (const key of keys) {
        const value = record[key]
        if (typeof value === 'string' && value.trim() !== '') {
            return value.trim()
        }
    }
    return null
}

function antigravityPlanFromTierId(tierId: string | null): string | null {
    const compact = tierId?.toLowerCase().replace(/[^a-z0-9]+/g, '')
    if (!compact) {
        return null
    }
    if (compact === 'freetier') {
        return 'free'
    }
    if (compact === 'g1protier') {
        return 'pro'
    }
    if (compact === 'g1ultratier') {
        return 'ultra'
    }
    if (compact === 'g1ultralitetier') {
        return 'ultra-lite'
    }
    return null
}

function parseAntigravitySubscription(data: unknown) {
    const d             = asRecord(data)
    const codeAssistRaw = typeof d?.codeAssist === 'string' ? asRecord(d.codeAssist) : asRecord(d?.codeAssist)
    const paidTier      = asRecord(codeAssistRaw?.paidTier ?? codeAssistRaw?.paid_tier)
    const currentTier   = asRecord(codeAssistRaw?.currentTier ?? codeAssistRaw?.current_tier)
    const effectiveTier = stringValueFromRecord(paidTier, 'id') ? paidTier : currentTier
    const tierId        = stringValueFromRecord(effectiveTier, 'id')
    const tierName      = stringValueFromRecord(effectiveTier, 'name')
    const planType      = antigravityPlanFromTierId(tierId)
    return {
        planType: planType ?? tierName ?? tierId,
        tierName,
        tierId,
        premium: planType === 'ultra' || planType === 'ultra-lite',
    }
}

function mapAntigravity(data: unknown): AntigravityQuotaState {
    const dataRecord         = asRecord(data)
    const serverTimeOffsetMs = numberValue(
        dataRecord?.server_time_offset_ms ?? dataRecord?.serverTimeOffsetMs,
    )
    const groups             = extractCloudCodeBuckets(data)
        .filter((bucket) => bucket.remainingFraction !== null)
        .map((bucket) => ({
            id: bucket.id,
            label: bucket.label,
            models: bucket.modelIds ?? [],
            remainingFraction: bucket.remainingFraction ?? 0,
            resetTime: bucket.resetTime,
            resetAtMs: bucket.resetAtMs ?? resolveResetMs([bucket.resetTime]),
        }))
    const subscription       = parseAntigravitySubscription(data)
    if (groups.length === 0 && !subscription.planType) {
        throw invalidQuotaPayload('Antigravity')
    }

    return {
        status: 'success',
        groups,
        serverTimeOffsetMs,
        planType: subscription.planType,
        tierName: subscription.tierName,
        tierId: subscription.tierId,
        premium: subscription.premium,
    }
}

function parseClaudeExtraUsage(value: unknown): ClaudeExtraUsage | null {
    const record = asRecord(value)
    if (!record) {
        return null
    }
    const isEnabled    = record.is_enabled
    const monthlyLimit = numberValue(record.monthly_limit)
    const usedCredits  = numberValue(record.used_credits)
    const utilization  = numberValue(record.utilization)
    if (typeof isEnabled !== 'boolean' || monthlyLimit === null || usedCredits === null) {
        return null
    }
    return {
        is_enabled: isEnabled,
        monthly_limit: monthlyLimit,
        used_credits: usedCredits,
        utilization,
    }
}

function mapClaude(data: unknown): ClaudeQuotaState {
    const d = data !== null && typeof data === 'object' ? (data as Record<string, unknown>) : null
    if (!d) {
        throw invalidQuotaPayload('Claude')
    }
    const usageRaw = typeof d.usage === 'string' ? JSON.parse(d.usage) : d.usage
    const usage    = usageRaw !== null && typeof usageRaw === 'object' ? (usageRaw as Record<string, unknown>) : null
    if (!usage) {
        throw invalidQuotaPayload('Claude')
    }

    const windows    = buildClaudeQuotaWindows(usage, (key) => i18n.t(key))
    const profileRaw = typeof d.profile === 'string' ? JSON.parse(d.profile) : d.profile
    const planType   = resolveClaudePlanType(profileRaw)

    const extraUsage = parseClaudeExtraUsage(usage.extra_usage)
    const resetGrants = parseClaudeResetGrants(usage.cedar_ember)
    if (windows.length === 0 && !planType && resetGrants.state !== 'present') {
        throw invalidQuotaPayload('Claude')
    }

    return {
        status: 'success',
        windows,
        extraUsage,
        resetGrants,
        planType,
    }
}

function mapCodex(data: unknown): CodexQuotaState {
    const d = asRecord(data)
    if (!d) {
        throw invalidQuotaPayload('Codex')
    }
    const windows: CodexQuotaWindow[] = []
    const planTypeRaw                 = d.plan_type ?? d.planType
    const planType                    = typeof planTypeRaw === 'string' && planTypeRaw.trim() !== '' ?
                                        planTypeRaw.trim() :
                                        null
    const accountCredits              = normalizeCodexAccountCredits(d.credits)
    const resetCreditsRaw             = d.rate_limit_reset_credits ?? d.rateLimitResetCredits
    const resetCreditsDetailsRaw      =
              d.rate_limit_reset_credits_details ??
              d.rateLimitResetCreditsDetails ??
              d.rate_limit_reset_credit_details ??
              d.rateLimitResetCreditDetails
    const resetCredits                = resolveCodexResetCredits(resetCreditsRaw, resetCreditsDetailsRaw)
    const resetCreditsErrorRaw        = d.rate_limit_reset_credits_error ?? d.rateLimitResetCreditsError
    const resetCreditsRequestError    =
              typeof resetCreditsErrorRaw === 'string' && resetCreditsErrorRaw.trim() !== '' ?
              resetCreditsErrorRaw.trim() :
              ''
    const resetCreditsDetailsState    = resetCreditsRequestError ? 'error' : resetCredits.detailsState
    const resetCreditsError           = resetCreditsRequestError ||
                                        (resetCreditsDetailsState === 'invalid' ?
                                         i18n.t(
                                             'codex_quota.reset_credits_invalid_payload',
                                             { defaultValue: 'Invalid manual reset expiry response' },
                                         ) :
                                         '')
    const subscriptionErrorRaw        = d.subscription_error
    const subscriptionError           = typeof subscriptionErrorRaw === 'string' ? subscriptionErrorRaw.trim() : ''
    const subscriptionActiveUntil     =
              !subscriptionError && d.subscription_active_until_source === 'codex_subscriptions' &&
              typeof d.subscription_active_until === 'string' ?
              d.subscription_active_until : null

    type RateLimitInfo = Record<string, unknown>

    const formatWindowSpan = (seconds: number | null): string => {
        if (seconds === null || seconds <= 0) {
            return i18n.t('credentials.quota_window_limit')
        }
        const hours = seconds / 3600
        if (hours < 24) {
            return i18n.t('credentials.quota_window_hours', { count: Math.round(hours) })
        }
        const days = hours / 24
        if (days < 7) {
            return i18n.t('credentials.quota_window_days', { count: Math.round(days) })
        }
        if (days < 30) {
            return i18n.t('credentials.quota_window_weeks', { count: Math.round(days / 7) })
        }
        return i18n.t('credentials.quota_window_days', { count: Math.round(days) })
    }

    const windowKind = (seconds: number | null, idSuffix: string): 'primary' | 'weekly' | 'monthly' | 'generic' => {
        if (seconds === null || seconds <= 0) {
            return idSuffix === 'primary' ? 'primary' : 'weekly'
        }
        if (seconds === 18_000) {
            return 'primary'
        }
        if (seconds === 604_800) {
            return 'weekly'
        }
        const days = seconds / 86_400
        if (days >= 28 && days <= 31) {
            return 'monthly'
        }
        return 'generic'
    }

    const windowLabel = (seconds: number | null, idPrefix: string, idSuffix: string, namePrefix: string): string => {
        const kind = windowKind(seconds, idSuffix)
        if (idPrefix === 'main') {
            if (kind === 'primary') {
                return i18n.t('codex_quota.primary_window')
            }
            if (kind === 'monthly') {
                return i18n.t('codex_quota.secondary_window_monthly', { defaultValue: 'Monthly limit' })
            }
            if (kind === 'weekly') {
                return i18n.t('codex_quota.secondary_window')
            }
            return formatWindowSpan(seconds)
        }
        if (idPrefix === 'cr') {
            if (kind === 'primary') {
                return i18n.t('codex_quota.code_review_primary_window')
            }
            if (kind === 'monthly') {
                return i18n.t('codex_quota.code_review_secondary_window_monthly', {
                    defaultValue: 'Code review monthly limit',
                })
            }
            if (kind === 'weekly') {
                return i18n.t('codex_quota.code_review_secondary_window')
            }
            return `${i18n.t('codex_quota.code_review_label', { defaultValue: 'Code review' })} ${formatWindowSpan(
                seconds)}`
        }
        if (kind === 'primary') {
            return i18n.t('codex_quota.additional_primary_window', { name: namePrefix })
        }
        if (kind === 'monthly') {
            return i18n.t('codex_quota.additional_secondary_window_monthly', {
                name: namePrefix,
                defaultValue: '{{name}} monthly limit',
            })
        }
        if (kind === 'weekly') {
            return i18n.t('codex_quota.additional_secondary_window', { name: namePrefix })
        }
        return `${namePrefix} ${formatWindowSpan(seconds)}`
    }

    const pushFromRateLimit = (rl: RateLimitInfo, idPrefix: string, namePrefix: string) => {
        const defs: Array<{ key: string; camelKey: string; idSuffix: string }> = [
            { key: 'primary_window', camelKey: 'primaryWindow', idSuffix: 'primary' },
            { key: 'secondary_window', camelKey: 'secondaryWindow', idSuffix: 'secondary' },
        ]
        const rlAllowed                                                        = rl.allowed
        const rlLimitReached                                                   = rl.limit_reached ?? rl.limitReached
        for (const def of defs) {
            const w       = rl[def.key] ?? rl[def.camelKey]
            const wRecord = asRecord(w)
            if (!wRecord) {
                continue
            }
            const windowUsedPercent = numberValue(wRecord.used_percent ?? wRecord.usedPercent)
            const limitReached      = wRecord.limit_reached ?? wRecord.limitReached ?? rlLimitReached
            const allowed           = wRecord.allowed ?? rlAllowed
            const usedPercent       = windowUsedPercent ?? (limitReached === true || allowed === false ? 100 : null)
            if (usedPercent === null) {
                continue
            }
            let resetLabel               = ''
            let resetAtMs: number | null = resolveResetMs([wRecord.reset_at, wRecord.resetAt])
            if (resetAtMs !== null) {
                resetLabel = formatDateTime(new Date(resetAtMs))
            } else {
                const resetAfterSeconds = numberValue(wRecord.reset_after_seconds ?? wRecord.resetAfterSeconds)
                resetAtMs               = parseOffsetSecondsToMs(resetAfterSeconds, Date.now())
            }
            const span = numberValue(wRecord.limit_window_seconds ?? wRecord.limitWindowSeconds)
            windows.push({
                             id: `${idPrefix}-${def.idSuffix}`,
                             label: windowLabel(span, idPrefix, def.idSuffix, namePrefix),
                             usedPercent,
                             resetLabel,
                             resetAtMs,
                             periodHours: span !== null && span > 0 ? span / 3600 : null,
                         })
        }
    }

    const rlRaw = d.rate_limit ?? d.rateLimit
    if (asRecord(rlRaw)) {
        pushFromRateLimit(rlRaw as RateLimitInfo, 'main', '')
    }

    const crRaw = d.code_review_rate_limit ?? d.codeReviewRateLimit
    if (asRecord(crRaw)) {
        pushFromRateLimit(
            crRaw as RateLimitInfo,
            'cr',
            i18n.t('codex_quota.code_review_label', { defaultValue: 'Code review' }),
        )
    }

    const additionalRaw = d.additional_rate_limits ?? d.additionalRateLimits
    if (Array.isArray(additionalRaw)) {
        additionalRaw.forEach((entry, idx) => {
            const e = asRecord(entry)
            if (!e) {
                return
            }
            const name  = String(e.limit_name ?? e.limitName ?? e.metered_feature ?? e.meteredFeature ?? '').trim()
            const subRl = e.rate_limit ?? e.rateLimit
            if (asRecord(subRl) && name) {
                pushFromRateLimit(subRl as RateLimitInfo, `add-${idx}`, name)
            }
        })
    }

    if (windows.length === 0) {
        const cu = asRecord(d.completions_usage)
        if (cu) {
            const used       = numberValue(cu.premium_completions_used ?? cu.completions_used)
            const limit      = numberValue(cu.premium_completions_limit ?? cu.completions_limit)
            const resetAtMs  = resolveResetMs([cu.reset_date])
            const resetLabel = resetAtMs !== null ? formatDateTime(new Date(resetAtMs)) : ''
            if (used !== null && limit !== null && limit > 0) {
                windows.push({
                                 id: 'completions',
                                 label: 'Completions',
                                 usedPercent: (used / limit) * 100,
                                 resetLabel,
                                 resetAtMs,
                             })
            }
        }
    }

    const hasResetCreditSummary =
              resetCredits.availableCount.state !== 'missing' ||
              resetCredits.applicableAvailableCount.state !== 'missing' ||
              resetCreditsDetailsState !== 'missing'
    if (windows.length === 0 && !planType && !hasResetCreditSummary && subscriptionActiveUntil === null &&
        accountCredits.balance === null && !accountCredits.unlimited) {
        throw invalidQuotaPayload('Codex')
    }

    return {
        status: 'success',
        windows,
        planType,
        subscriptionActiveUntil: subscriptionActiveUntil as string | number | null,
        subscriptionError,
        creditBalance: accountCredits.balance,
        creditsUnlimited: accountCredits.unlimited,
        rateLimitResetCreditsAvailableCount: resetCredits.availableCount,
        rateLimitResetCreditsApplicableAvailableCount: resetCredits.applicableAvailableCount,
        rateLimitResetCredits: resetCredits.credits,
        rateLimitResetCreditDetailsState: resetCreditsDetailsState,
        rateLimitResetCreditsError: resetCreditsError,
    }
}

function mapGemini(data: unknown): GeminiCliQuotaState {
    const d = data !== null && typeof data === 'object' ? (data as Record<string, unknown>) : null
    if (!d) {
        throw invalidQuotaPayload('Gemini')
    }
    const quotaRaw = typeof d.quota === 'string' ? JSON.parse(d.quota) : d.quota
    const quota    = quotaRaw !== null && typeof quotaRaw === 'object' ? (quotaRaw as Record<string, unknown>) : null
    const buckets  = extractCloudCodeBuckets(data)

    if (quota && buckets.length === 0) {
        const creditsRaw = quota.userCredits ?? quota.user_credits
        const credits    = Array.isArray(creditsRaw) ? creditsRaw : []
        for (const credit of credits) {
            const c = credit !== null && typeof credit === 'object' ? (credit as Record<string, unknown>) : null
            if (!c) {
                continue
            }
            const metricName = typeof (c.metricName ?? c.metric_name) === 'string' ?
                               String(c.metricName ?? c.metric_name).trim() :
                               ''
            const remaining  = numberValue(c.remainingValue ?? c.remaining_value)
            const total      = numberValue(c.totalValue ?? c.total_value)
            if (metricName === '' || remaining === null || total === null || total <= 0) {
                continue
            }
            const resetTime =
                      typeof (c.resetTime ?? c.reset_time) === 'string'
                      ? ((c.resetTime ?? c.reset_time) as string)
                      : undefined
            buckets.push({
                             id: metricName,
                             label: metricName,
                             remainingFraction: remaining / total,
                             remainingAmount: remaining,
                             resetTime,
                             resetAtMs: resolveResetMs([resetTime]),
                             tokenType: null,
                         })
        }
    }

    const codeAssistRaw = typeof d.codeAssist === 'string' ? JSON.parse(d.codeAssist) : d.codeAssist
    const codeAssist    =
              codeAssistRaw !== null && typeof codeAssistRaw === 'object' ?
              (codeAssistRaw as Record<string, unknown>) :
              null
    const currentTier   = codeAssist?.currentTier ?? codeAssist?.current_tier
    const tierRecord    =
              currentTier !== null && typeof currentTier === 'object' ? (currentTier as Record<string, unknown>) : null
    const tierLabel     = typeof tierRecord?.id === 'string' ? tierRecord.id : null

    if (!quota && !codeAssist) {
        throw invalidQuotaPayload('Gemini')
    }
    if (buckets.length === 0 && !tierLabel) {
        throw invalidQuotaPayload('Gemini')
    }

    return {
        status: 'success',
        buckets,
        tierLabel,
        tierId: tierLabel,
    }
}

function asRecord(value: unknown): Record<string, unknown> | null {
    if (typeof value === 'string' && value.trim() !== '') {
        try {
            return asRecord(JSON.parse(value))
        } catch {
            return null
        }
    }
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        return value as Record<string, unknown>
    }
    return null
}

function numberValue(value: unknown): number | null {
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : null
    }
    if (typeof value === 'string') {
        const normalized = value.trim().replace(/[$,%\s]/g, '')
        if (!normalized) {
            return null
        }
        const parsed = Number(normalized)
        return Number.isFinite(parsed) ? parsed : null
    }
    const record = asRecord(value)
    if (record && 'val' in record) {
        return numberValue(record.val)
    }
    return null
}

function mapMeta(data: unknown): MetaQuotaState {
    const subscription = parseMetaSubscriptionSnapshot(data)
    if (!subscription) {
        throw invalidQuotaPayload('Meta')
    }
    return {status: 'success', ...subscription}
}

function mapXai(data: unknown): XaiQuotaState {
    const parsed = parseXaiQuotaPayload(data)
    if (!parsed) {
        throw invalidQuotaPayload('xAI')
    }

    return {
        status: 'success',
        billing: parsed.billing,
        planType: parsed.planType,
        planCode: parsed.planCode,
        planName: parsed.planName,
        planTier: parsed.planTier,
    }
}

function mapKimi(data: unknown): KimiQuotaState {
    const rows = buildKimiQuotaRows(data)
    if (rows.length === 0) {
        throw invalidQuotaPayload('Kimi')
    }

    return {
        status: 'success',
        rows,
    }
}
