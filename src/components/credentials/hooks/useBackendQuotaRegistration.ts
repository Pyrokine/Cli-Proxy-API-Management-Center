/**
 * Backend-driven quota registration.
 *
 * Polls GET /quota/status and maps backend data into the existing QuotaStore
 * so downstream components (CredentialCard, useCredentialQuota) work without changes.
 */

import i18n from '@/i18n'
import {quotaApi} from '@/services/api/quota'
import {useNotificationStore} from '@/stores/useNotificationStore'
import {useQuotaStore} from '@/stores/useQuotaStore'
import type {
    AntigravityQuotaState,
    ClaudeExtraUsage,
    ClaudeQuotaState,
    ClaudeQuotaWindow,
    CodexQuotaState,
    CodexQuotaWindow,
    GeminiCliQuotaBucketState,
    GeminiCliQuotaState,
    KimiQuotaState,
    XaiQuotaState,
} from '@/types'
import type {AuthFileItem} from '@/types/authFile'
import {formatDateTime} from '@/utils/format'
import {useCallback, useEffect, useMemo, useRef, useState} from 'react'

const refreshPollIntervalMs = 1000
const refreshPollTimeoutMs  = 10 * 60 * 1000

interface EntryMeta {
    lastRefresh: Date | null
    nextRefresh: Date | null
    status: string
}

interface RefreshBaseline {
    lastRefreshMs: number | null
    previousStatus: string
    requestedAtMs: number
}

export function useBackendQuotaRegistration(_authFiles: AuthFileItem[]) {
    const mounted                             = useRef(true)
    const timeoutRef                          = useRef<number | null>(null)
    const pendingRefreshRef                   = useRef<Record<string, RefreshBaseline>>({})
    const metaRef                             = useRef<Record<string, EntryMeta>>({})
    const [meta, setMeta]                     = useState<Record<string, EntryMeta>>({})
    const [quotaEnabled, setQuotaEnabled]     = useState(false)
    const [pollIntervalMs, setPollIntervalMs] = useState(0)

    const setAntigravityQuota = useQuotaStore((s) => s.setAntigravityQuota)
    const setClaudeQuota      = useQuotaStore((s) => s.setClaudeQuota)
    const setCodexQuota       = useQuotaStore((s) => s.setCodexQuota)
    const setGeminiCliQuota   = useQuotaStore((s) => s.setGeminiCliQuota)
    const setKimiQuota        = useQuotaStore((s) => s.setKimiQuota)
    const setXaiQuota         = useQuotaStore((s) => s.setXaiQuota)

    const poll = useCallback(async () => {
        try {
            const status = await quotaApi.getStatus()
            if (!mounted.current) {
                return
            }

            setQuotaEnabled(status.enabled)
            setPollIntervalMs(status.enabled ? Math.max(status.interval_seconds, 0) * 1000 : 0)

            const newMeta: Record<string, EntryMeta> = {}
            const setters: Setters                   = {
                setAntigravityQuota,
                setClaudeQuota,
                setCodexQuota,
                setGeminiCliQuota,
                setKimiQuota,
                setXaiQuota,
            }
            for (const [fileName, entry] of Object.entries(status.credentials)) {
                let data: unknown                    = null
                let parseErrorMessage: string | null = null
                const hasData                        = entry.data !== undefined && entry.data !== null
                if (hasData) {
                    try {
                        data = typeof entry.data === 'string' ? JSON.parse(entry.data as string) : entry.data
                    } catch (e) {
                        parseErrorMessage = quotaParseErrorMessage(e)
                        console.warn('[QuotaScheduler] failed to parse entry data:', fileName, e)
                    }
                }
                const entryStatus = parseErrorMessage ? 'error' : resolveEntryStatus(entry.type, entry.status, data)
                newMeta[fileName] = {
                    lastRefresh: entry.last_refresh ? new Date(entry.last_refresh) : null,
                    nextRefresh: status.enabled && entry.next_refresh ? new Date(entry.next_refresh) : null,
                    status: entryStatus,
                }

                if (parseErrorMessage) {
                    mapQuotaError(fileName, entry.type, parseErrorMessage, setters)
                    continue
                }
                if (
                    entryStatus === 'error' ||
                    ((entryStatus === 'banned' || entryStatus === 'quota_exceeded') && entry.error?.trim())
                ) {
                    mapQuotaError(
                        fileName,
                        entry.type,
                        entry.error || i18n.t('credentials.refresh_status_error', { defaultValue: '刷新失败' }),
                        setters,
                    )
                    continue
                }
                if (data === null || data === undefined) {
                    if (entryStatus === 'success') {
                        const errorMessage = quotaParseErrorMessage(invalidQuotaPayload(entry.type || 'unknown'))
                        newMeta[fileName]  = {
                            ...newMeta[fileName],
                            status: 'error',
                        }
                        mapQuotaError(fileName, entry.type, errorMessage, setters)
                    }
                    continue
                }
                try {
                    mapToStore(fileName, entry.type, data, setters)
                } catch (e) {
                    const errorMessage = quotaParseErrorMessage(e)
                    console.warn('[QuotaScheduler] failed to map entry data:', fileName, e)
                    newMeta[fileName] = {
                        ...newMeta[fileName],
                        status: 'error',
                    }
                    mapQuotaError(fileName, entry.type, errorMessage, setters)
                }
            }

            const nextPending: Record<string, RefreshBaseline> = {}
            const timedOutNames: string[]                      = []
            const now                                          = Date.now()
            for (const [fileName, baseline] of Object.entries(pendingRefreshRef.current)) {
                const currentMeta          = newMeta[fileName]
                const currentLastRefreshMs = currentMeta?.lastRefresh?.getTime() ?? null
                const completed            =
                          currentLastRefreshMs !== null &&
                          (baseline.lastRefreshMs === null || currentLastRefreshMs > baseline.lastRefreshMs)
                if (completed) {
                    continue
                }
                if (now - baseline.requestedAtMs >= refreshPollTimeoutMs) {
                    timedOutNames.push(fileName)
                    if (currentMeta) {
                        newMeta[fileName] = {
                            ...currentMeta,
                            status: baseline.previousStatus || 'error',
                        }
                    }
                    continue
                }
                nextPending[fileName] = baseline
            }
            pendingRefreshRef.current = nextPending
            if (timedOutNames.length > 0) {
                useNotificationStore
                    .getState()
                    .showNotification(`Quota refresh timed out for ${timedOutNames.join(', ')}`, 'error')
            }

            metaRef.current = newMeta
            setMeta(newMeta)
        } catch (e) {
            console.warn('[QuotaScheduler] poll failed:', e)
        }
    }, [setAntigravityQuota, setClaudeQuota, setCodexQuota, setGeminiCliQuota, setKimiQuota, setXaiQuota])

    useEffect(() => {
        mounted.current = true
        const initialId = window.setTimeout(() => {
            void poll()
        }, 0)
        const id        = pollIntervalMs > 0 ? window.setInterval(() => void poll(), pollIntervalMs) : null
        return () => {
            mounted.current           = false
            pendingRefreshRef.current = {}
            window.clearTimeout(initialId)
            if (timeoutRef.current !== null) {
                window.clearTimeout(timeoutRef.current)
                timeoutRef.current = null
            }
            if (id !== null) {
                window.clearInterval(id)
            }
        }
    }, [poll, pollIntervalMs])

    const statusMap = useMemo(() => {
        const next: Record<string, string> = {}
        for (const [fileName, entry] of Object.entries(meta)) {
            next[fileName] = entry.status
        }
        return next
    }, [meta])

    const waitForPendingRefreshes = useCallback(async () => {
        while (mounted.current && Object.keys(pendingRefreshRef.current).length > 0) {
            await poll()
            if (!mounted.current || Object.keys(pendingRefreshRef.current).length === 0) {
                break
            }
            await new Promise<void>((resolve) => {
                if (timeoutRef.current !== null) {
                    window.clearTimeout(timeoutRef.current)
                }
                timeoutRef.current = window.setTimeout(() => {
                    timeoutRef.current = null
                    resolve()
                }, refreshPollIntervalMs)
            })
        }
    }, [poll])

    const refreshMany = useCallback(
        async (names: string[]) => {
            const uniqueNames = Array.from(new Set(names.filter((name) => name.trim() !== '')))
            if (uniqueNames.length === 0) {
                return
            }

            const requestedAtMs       = Date.now()
            const baselines           = Object.fromEntries(
                uniqueNames.map((name) => {
                    const currentMeta = metaRef.current[name]
                    return [
                        name,
                        {
                            lastRefreshMs: currentMeta?.lastRefresh?.getTime() ?? null,
                            previousStatus: currentMeta?.status ?? 'idle',
                            requestedAtMs,
                        } satisfies RefreshBaseline,
                    ]
                }),
            )
            pendingRefreshRef.current = {
                ...pendingRefreshRef.current,
                ...baselines,
            }
            setMeta((prev) => {
                const next = { ...prev }
                for (const name of uniqueNames) {
                    next[name] = {
                        lastRefresh: prev[name]?.lastRefresh ?? null,
                        nextRefresh: quotaEnabled ? (prev[name]?.nextRefresh ?? null) : null,
                        status: 'loading',
                    }
                }
                metaRef.current = next
                return next
            })

            try {
                await quotaApi.refresh(uniqueNames)
            } catch (e) {
                console.warn('[useBackendQuotaRegistration] refresh failed for', uniqueNames, e)
                for (const name of uniqueNames) {
                    delete pendingRefreshRef.current[name]
                }
                setMeta((prev) => {
                    const next = { ...prev }
                    for (const name of uniqueNames) {
                        const baseline = baselines[name]
                        next[name]     = {
                            lastRefresh: prev[name]?.lastRefresh ?? null,
                            nextRefresh: quotaEnabled ? (prev[name]?.nextRefresh ?? null) : null,
                            status: baseline?.previousStatus || 'error',
                        }
                    }
                    metaRef.current = next
                    return next
                })
                const message = e instanceof Error ? e.message : ''
                useNotificationStore
                    .getState()
                    .showNotification(
                        `Failed to refresh quota for ${uniqueNames.join(', ')}${message ? `: ${message}` : ''}`,
                        'error',
                    )
                return
            }

            await waitForPendingRefreshes()
        },
        [quotaEnabled, waitForPendingRefreshes],
    )

    return {
        statusMap,
        getLastRefreshTime: (name: string): Date | null => meta[name]?.lastRefresh ?? null,
        getNextRefreshTime: (name: string): Date | null => (quotaEnabled ? (meta[name]?.nextRefresh ?? null) : null),
        getStatus: (name: string): string => meta[name]?.status ?? 'idle',
        isRefreshing: (name: string) => meta[name]?.status === 'loading',
        isAutoRefreshEnabled: () => quotaEnabled,
        refreshNow: async (name: string) => {
            await refreshMany([name])
        },
        refreshMany,
    }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Setter = (updater: any) => void

interface Setters {
    setAntigravityQuota: Setter
    setClaudeQuota: Setter
    setCodexQuota: Setter
    setGeminiCliQuota: Setter
    setKimiQuota: Setter
    setXaiQuota: Setter
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

function mapToStore(fileName: string, type: string, data: unknown, s: Setters) {
    switch (type) {
        case 'antigravity':
            mapAntigravity(fileName, data, s.setAntigravityQuota)
            break
        case 'claude':
            mapClaude(fileName, data, s.setClaudeQuota)
            break
        case 'codex':
            mapCodex(fileName, data, s.setCodexQuota)
            break
        case 'gemini-cli':
            mapGemini(fileName, data, s.setGeminiCliQuota)
            break
        case 'kimi':
            mapKimi(fileName, data, s.setKimiQuota)
            break
        case 'xai':
            mapXai(fileName, data, s.setXaiQuota)
            break
        default:
            throw invalidQuotaPayload(type || 'unknown')
    }
}

function mapQuotaError(fileName: string, type: string, error: string, s: Setters) {
    switch (type) {
        case 'antigravity':
            s.setAntigravityQuota((prev: Record<string, AntigravityQuotaState>) => ({
                ...prev,
                [fileName]: { status: 'error', groups: [], error },
            }))
            break
        case 'claude':
            s.setClaudeQuota((prev: Record<string, ClaudeQuotaState>) => ({
                ...prev,
                [fileName]: { status: 'error', windows: [], error },
            }))
            break
        case 'codex':
            s.setCodexQuota((prev: Record<string, CodexQuotaState>) => ({
                ...prev,
                [fileName]: { status: 'error', windows: [], error },
            }))
            break
        case 'gemini-cli':
            s.setGeminiCliQuota((prev: Record<string, GeminiCliQuotaState>) => ({
                ...prev,
                [fileName]: { status: 'error', buckets: [], error },
            }))
            break
        case 'kimi':
            s.setKimiQuota((prev: Record<string, KimiQuotaState>) => ({
                ...prev,
                [fileName]: { status: 'error', rows: [], error },
            }))
            break
        case 'xai':
            s.setXaiQuota((prev: Record<string, XaiQuotaState>) => ({
                ...prev,
                [fileName]: { status: 'error', billing: null, error },
            }))
            break
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
        buckets.push({
                         id: `${modelId ?? 'unknown'}-${tokenType ?? 'unknown'}`,
                         label: modelId ?? tokenType ?? 'Quota',
                         remainingFraction,
                         remainingAmount: null,
                         resetTime:
                             typeof bucketRecord.resetTime === 'string'
                             ? bucketRecord.resetTime
                             : typeof bucketRecord.reset_time === 'string'
                               ? bucketRecord.reset_time
                               : undefined,
                         tokenType,
                         modelIds: modelId ? [modelId] : undefined,
                     })
    }

    return buckets
}

function mapAntigravity(fileName: string, data: unknown, setter: Setter) {
    const groups = extractCloudCodeBuckets(data)
        .filter((bucket) => bucket.remainingFraction !== null)
        .map((bucket) => ({
            id: bucket.id,
            label: bucket.label,
            models: bucket.modelIds ?? [],
            remainingFraction: bucket.remainingFraction ?? 0,
            resetTime: bucket.resetTime,
        }))
    if (groups.length === 0) {
        throw invalidQuotaPayload('Antigravity')
    }

    const state: AntigravityQuotaState = {
        status: 'success',
        groups,
    }

    setter((prev: Record<string, AntigravityQuotaState>) => ({ ...prev, [fileName]: state }))
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

function mapClaude(fileName: string, data: unknown, setter: Setter) {
    const d = data !== null && typeof data === 'object' ? (data as Record<string, unknown>) : null
    if (!d) {
        throw invalidQuotaPayload('Claude')
    }
    const usageRaw = typeof d.usage === 'string' ? JSON.parse(d.usage) : d.usage
    const usage    = usageRaw !== null && typeof usageRaw === 'object' ? (usageRaw as Record<string, unknown>) : null
    if (!usage) {
        throw invalidQuotaPayload('Claude')
    }

    const windows: ClaudeQuotaWindow[] = []
    const windowDefs                   = [
        { key: 'five_hour', id: 'five-hour', label: '5 小时限额' },
        { key: 'seven_day', id: 'seven-day', label: '7 天限额' },
        { key: 'seven_day_oauth_apps', id: 'seven-day-oauth-apps', label: '7 天 OAuth 应用' },
        { key: 'seven_day_opus', id: 'seven-day-opus', label: '7 天 Opus' },
        { key: 'seven_day_sonnet', id: 'seven-day-sonnet', label: '7 天 Sonnet' },
        { key: 'seven_day_cowork', id: 'seven-day-cowork', label: '7 天 Cowork' },
        { key: 'iguana_necktie', id: 'iguana-necktie', label: 'Iguana Necktie' },
    ]

    for (const def of windowDefs) {
        const w       = usage[def.key]
        const wRecord = w !== null && typeof w === 'object' ? (w as Record<string, unknown>) : null
        if (wRecord && typeof wRecord.utilization === 'number') {
            const resetLabel = typeof wRecord.resets_at === 'string' ? formatDateTime(new Date(wRecord.resets_at)) : ''
            windows.push({
                             id: def.id,
                             label: def.label,
                             labelKey: `claude_quota.${def.key}`,
                             usedPercent: wRecord.utilization,
                             resetLabel,
                         })
        }
    }

    // Extract plan type from profile
    const profileRaw            = typeof d.profile === 'string' ? JSON.parse(d.profile) : d.profile
    const profile               =
              profileRaw !== null && typeof profileRaw === 'object' ? (profileRaw as Record<string, unknown>) : null
    const account               =
              profile?.account !== null && typeof profile?.account === 'object'
              ? (profile?.account as Record<string, unknown>)
              : null
    let planType: string | null = null
    const organization          =
              profile?.organization !== null && typeof profile?.organization === 'object'
              ? (profile.organization as Record<string, unknown>)
              : null
    const organizationType      =
              typeof organization?.organization_type === 'string' ?
              organization.organization_type.trim().toLowerCase() :
              ''
    if (account?.has_claude_max) {
        planType = 'Max'
    } else if (account?.has_claude_pro) {
        planType = 'Pro'
    } else if (organizationType === 'team') {
        planType = 'Team'
    }

    const extraUsage = parseClaudeExtraUsage(usage.extra_usage)
    if (windows.length === 0 && !planType) {
        throw invalidQuotaPayload('Claude')
    }

    const state: ClaudeQuotaState = {
        status: 'success',
        windows,
        extraUsage,
        planType,
    }

    setter((prev: Record<string, ClaudeQuotaState>) => ({ ...prev, [fileName]: state }))
}

function mapCodex(fileName: string, data: unknown, setter: Setter) {
    const d = data !== null && typeof data === 'object' ?
              (data as Record<string, unknown>) :
              null
    if (!d) {
        throw invalidQuotaPayload('Codex')
    }
    const windows: CodexQuotaWindow[] = []
    const planTypeRaw                 = d?.plan_type ?? d?.planType
    const planType                    = typeof planTypeRaw === 'string' && planTypeRaw.trim() !== '' ?
                                        planTypeRaw.trim() :
                                        null

    type RateLimitInfo = Record<string, unknown>

    const formatWindowSpan = (seconds: number | undefined): string => {
        if (typeof seconds !== 'number' || seconds <= 0) {
            return '限额'
        }
        const hours = seconds / 3600
        if (hours < 24) {
            return `${Math.round(hours)} 小时限额`
        }
        const days = hours / 24
        if (days < 7) {
            return `${Math.round(days)} 天限额`
        }
        if (days < 30) {
            return `${Math.round(days / 7)} 周限额`
        }
        return `${Math.round(days)} 天限额`
    }

    const pushFromRateLimit = (rl: RateLimitInfo, idPrefix: string, namePrefix: string) => {
        const defs: Array<{ key: string; idSuffix: string }> = [
            { key: 'primary_window', idSuffix: 'primary' },
            { key: 'secondary_window', idSuffix: 'secondary' },
        ]
        for (const def of defs) {
            const w       = rl[def.key]
            const wRecord = w !== null && typeof w === 'object' ? (w as Record<string, unknown>) : null
            if (wRecord && typeof wRecord.used_percent === 'number') {
                let resetLabel = ''
                if (typeof wRecord.reset_at === 'number') {
                    resetLabel = formatDateTime(new Date(wRecord.reset_at * 1000))
                } else if (typeof wRecord.reset_after_seconds === 'number') {
                    const hours = Math.round(wRecord.reset_after_seconds / 3600)
                    resetLabel  = `${hours}h`
                }
                const span      = typeof wRecord.limit_window_seconds === 'number' ?
                                  wRecord.limit_window_seconds :
                                  undefined
                const spanLabel = formatWindowSpan(span)
                windows.push({
                                 id: `${idPrefix}-${def.idSuffix}`,
                                 label: namePrefix ? `${namePrefix} ${spanLabel}` : spanLabel,
                                 usedPercent: wRecord.used_percent,
                                 resetLabel,
                             })
            }
        }
    }

    // 1) rate_limit (主套餐)
    const rlRaw = d?.rate_limit ?? d?.rateLimit
    if (rlRaw !== null && typeof rlRaw === 'object') {
        pushFromRateLimit(rlRaw as RateLimitInfo, 'main', '')
    }

    // 2) code_review_rate_limit (代码审查)
    const crRaw = d?.code_review_rate_limit ?? d?.codeReviewRateLimit
    if (crRaw !== null && typeof crRaw === 'object') {
        pushFromRateLimit(crRaw as RateLimitInfo, 'cr', '代码审查')
    }

    // 3) additional_rate_limits (附加,如 GPT-5.3-Codex-Spark)
    const additionalRaw = d?.additional_rate_limits ?? d?.additionalRateLimits
    if (Array.isArray(additionalRaw)) {
        additionalRaw.forEach((entry, idx) => {
            const e = entry !== null && typeof entry === 'object' ? (entry as Record<string, unknown>) : null
            if (!e) {
                return
            }
            const name  = (e.limit_name ?? e.limitName ?? e.metered_feature ?? e.meteredFeature) as string | undefined
            const subRl = e.rate_limit ?? e.rateLimit
            if (subRl !== null && typeof subRl === 'object' && name) {
                pushFromRateLimit(subRl as RateLimitInfo, `add-${idx}`, name)
            }
        })
    }

    // Legacy fallback: completions_usage with limit/usage counts
    if (windows.length === 0) {
        const cuRaw = d?.completions_usage
        const cu    =
                  cuRaw !== null && cuRaw !== undefined && typeof cuRaw === 'object'
                  ? (cuRaw as Record<string, unknown>)
                  : null
        if (cu) {
            const used       = numberValue(cu.premium_completions_used ?? cu.completions_used)
            const limit      = numberValue(cu.premium_completions_limit ?? cu.completions_limit)
            const resetLabel = typeof cu.reset_date === 'string' ? formatDateTime(new Date(cu.reset_date)) : ''
            if (used !== null && limit !== null && limit > 0) {
                windows.push({
                                 id: 'completions',
                                 label: 'Completions',
                                 usedPercent: (used / limit) * 100,
                                 resetLabel,
                             })
            }
        }
    }

    if (windows.length === 0 && !planType) {
        throw invalidQuotaPayload('Codex')
    }

    const state: CodexQuotaState = {
        status: 'success',
        windows,
        planType,
    }

    setter((prev: Record<string, CodexQuotaState>) => ({ ...prev, [fileName]: state }))
}

function mapGemini(fileName: string, data: unknown, setter: Setter) {
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
            buckets.push({
                             id: metricName,
                             label: metricName,
                             remainingFraction: remaining / total,
                             remainingAmount: remaining,
                             resetTime:
                                 typeof (c.resetTime ?? c.reset_time) === 'string'
                                 ? ((c.resetTime ?? c.reset_time) as string)
                                 : undefined,
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

    const state: GeminiCliQuotaState = {
        status: 'success',
        buckets,
        tierLabel,
        tierId: tierLabel,
    }

    setter((prev: Record<string, GeminiCliQuotaState>) => ({ ...prev, [fileName]: state }))
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

function pickRecord(sources: Array<Record<string, unknown> | null>, keys: string[]): Record<string, unknown> | null {
    for (const source of sources) {
        if (!source) {
            continue
        }
        for (const key of keys) {
            const record = asRecord(source[key])
            if (record) {
                return record
            }
        }
    }
    return null
}

function numberValue(value: unknown): number | null {
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : null
    }
    if (typeof value === 'string') {
        const normalized = value.trim().replace(/[$,%\s,]/g, '')
        if (!normalized) {
            return null
        }
        const parsed = Number(normalized)
        return Number.isFinite(parsed) ? parsed : null
    }
    return null
}

function pickNumber(sources: Array<Record<string, unknown> | null>, keys: string[]): number | null {
    for (const source of sources) {
        if (!source) {
            continue
        }
        for (const key of keys) {
            const parsed = numberValue(source[key])
            if (parsed !== null) {
                return parsed
            }
        }
    }
    return null
}

function pickString(sources: Array<Record<string, unknown> | null>, keys: string[]): string | null {
    for (const source of sources) {
        if (!source) {
            continue
        }
        for (const key of keys) {
            const value = source[key]
            if (typeof value === 'string' && value.trim() !== '') {
                return value
            }
        }
    }
    return null
}

function normalizePercent(value: number | null): number | null {
    if (value === null) {
        return null
    }
    return value >= 0 && value <= 1 ? value * 100 : value
}

function mapXai(fileName: string, data: unknown, setter: Setter) {
    const root = asRecord(data)
    if (!root) {
        throw invalidQuotaPayload('xAI')
    }

    const usageRecord         = pickRecord([root], ['usage', 'current_usage', 'billing', 'billing_summary']) ?? root
    const configRecord        = pickRecord([root], ['config', 'billing_config', 'limits', 'subscription']) ?? root
    const usedCents           = pickNumber([usageRecord, root], [
        'used_cents',
        'usedCents',
        'usage_cents',
        'usageCents',
        'current_usage_cents',
        'currentUsageCents',
        'total_usage_cents',
        'totalUsageCents',
        'spent_cents',
        'spentCents',
        'used',
        'currentUsage',
        'totalUsage',
    ])
    const monthlyLimitCents   = pickNumber([configRecord, root], [
        'monthly_limit_cents',
        'monthlyLimitCents',
        'monthly_limit',
        'monthlyLimit',
        'spending_limit_cents',
        'spendingLimitCents',
        'hard_limit_cents',
        'hardLimitCents',
        'credit_limit_cents',
        'creditLimitCents',
        'limit_cents',
        'limitCents',
        'limit',
    ])
    const onDemandCapCents    = pickNumber([configRecord, root], [
        'on_demand_cap_cents',
        'onDemandCapCents',
        'on_demand_spend_limit_cents',
        'onDemandSpendLimitCents',
        'on_demand_limit_cents',
        'onDemandLimitCents',
    ])
    const usedPercentRaw      = pickNumber([usageRecord, root], [
        'used_percent',
        'usedPercent',
        'usage_percent',
        'usagePercent',
        'utilization',
    ])
    const remainingPercentRaw = pickNumber([usageRecord, root], ['remaining_percent', 'remainingPercent'])
    const denominator         =
              monthlyLimitCents !== null && monthlyLimitCents > 0
              ? monthlyLimitCents
              : onDemandCapCents !== null && onDemandCapCents > 0
                ? onDemandCapCents
                : null
    const usedPercent         =
              usedPercentRaw !== null
              ? normalizePercent(usedPercentRaw)
              : remainingPercentRaw !== null
                ? 100 - (normalizePercent(remainingPercentRaw) ?? 0)
                : denominator !== null && usedCents !== null
                  ? (usedCents / denominator) * 100
                  : null

    if (usedPercent === null) {
        throw invalidQuotaPayload('xAI')
    }

    const state: XaiQuotaState = {
        status: 'success',
        billing: {
            usedCents,
            monthlyLimitCents,
            onDemandCapCents,
            usedPercent,
            billingPeriodStart: pickString([usageRecord, root], [
                'billing_period_start',
                'billingPeriodStart',
                'period_start',
                'periodStart',
                'start_time',
                'startTime',
            ]),
            billingPeriodEnd: pickString([usageRecord, root], [
                'billing_period_end',
                'billingPeriodEnd',
                'period_end',
                'periodEnd',
                'end_time',
                'endTime',
                'next_reset',
                'nextReset',
                'reset_at',
                'resetAt',
            ]),
        },
    }

    setter((prev: Record<string, XaiQuotaState>) => ({ ...prev, [fileName]: state }))
}

function mapKimi(fileName: string, data: unknown, setter: Setter) {
    const d       = data !== null && typeof data === 'object' ? (data as Record<string, unknown>) : null
    const rowsRaw = Array.isArray(data) ? data : (d?.usages ?? null)
    if (!Array.isArray(rowsRaw)) {
        throw invalidQuotaPayload('Kimi')
    }
    const mapped = rowsRaw.flatMap((row) => {
        const r = asRecord(row)
        if (!r) {
            return []
        }
        const id        = pickString([r], ['id', 'name', 'label'])
        const label     = pickString([r], ['label', 'name', 'id'])
        const used      = numberValue(r.used)
        const limit     = numberValue(r.limit)
        const resetHint = typeof r.reset_hint === 'string' ? r.reset_hint : undefined
        if (!id || !label || used === null || limit === null || limit <= 0) {
            return []
        }
        return [{ id, label, used, limit, resetHint }]
    })

    if (mapped.length === 0) {
        throw invalidQuotaPayload('Kimi')
    }

    const state: KimiQuotaState = {
        status: 'success',
        rows: mapped,
    }

    setter((prev: Record<string, KimiQuotaState>) => ({ ...prev, [fileName]: state }))
}
