import {authFilesApi, usageApi, type UsageEvent} from '@/services/api'
import type {AuthFileItem, Config} from '@/types'
import type {CredentialInfo, SourceInfo} from '@/types/sourceInfo'
import {getErrorMessage} from '@/utils/helpers'
import {buildSourceInfoMap, resolveSourceDisplay} from '@/utils/sourceResolver'
import {normalizeAuthIndex, type UsageDetailWithEndpoint} from '@/utils/usage'
import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'
import type {ParsedLogLine} from './logTypes'

type TraceCandidate = {
    detail: UsageDetailWithEndpoint
    modelMatched: boolean
    requestIdMatched: boolean
    timeDeltaMs: number | null
}

const TRACE_AUTH_CACHE_MS    = 60 * 1000
const TRACE_MAX_CANDIDATES   = 5
const TRACE_LOOKUP_WINDOW_MS = 2 * 60 * 1000
const TRACE_EVENT_PAGE_SIZE  = 500

const TRACEABLE_EXACT_PATHS  = new Set(['/v1/chat/completions', '/v1/messages', '/v1/responses'])
const TRACEABLE_PREFIX_PATHS = ['/v1beta/models']

const normalizeTracePath = (value?: string) =>
    String(value ?? '')
        .replace(/^"+|"+$/g, '')
        .split('?')[0]
        .trim()

const normalizeTraceablePath = (value?: string): string => {
    const normalized = normalizeTracePath(value)
    if (!normalized || normalized === '/') {
        return normalized
    }
    return normalized.replace(/\/+$/, '')
}

export const isTraceableRequestPath = (value?: string): boolean => {
    const normalizedPath = normalizeTraceablePath(value)
    if (!normalizedPath) {
        return false
    }
    if (TRACEABLE_EXACT_PATHS.has(normalizedPath)) {
        return true
    }
    return TRACEABLE_PREFIX_PATHS.some((prefix) => normalizedPath.startsWith(prefix))
}

const MODEL_EXTRACT_REGEX = /\bmodel[=:]\s*"?(?<model>[a-zA-Z0-9._\-/]+)"?/i

const extractModelFromMessage = (message?: string): string | undefined => {
    if (!message) {
        return undefined
    }
    const match = message.match(MODEL_EXTRACT_REGEX)
    return match?.groups?.model || undefined
}

const buildEndpointLabel = (line: ParsedLogLine, logPath: string): string => {
    if (line.method && logPath) {
        return `${line.method} ${logPath}`
    }
    return logPath || line.method || '-'
}

const eventToTraceDetail = (event: UsageEvent, line: ParsedLogLine, logPath: string): UsageDetailWithEndpoint => {
    const timestampMs = Date.parse(event.timestamp)
    return {
        timestamp: event.timestamp,
        source: event.source,
        auth_index: event.auth_index,
        request_id: event.request_id,
        latency_ms: event.latency_ms,
        time_to_first_byte_ms: event.time_to_first_byte_ms,
        total_duration_ms: event.total_duration_ms,
        completed: event.completed,
        metadata_recorded: event.metadata_recorded,
        reasoning_effort: event.reasoning_effort,
        thinking: event.thinking,
        tokens: event.tokens,
        failed: event.failed,
        __modelName: event.model,
        __timestampMs: Number.isNaN(timestampMs) ? 0 : timestampMs,
        __apiKey: event.api_key,
        __endpoint: buildEndpointLabel(line, logPath),
        __endpointMethod: line.method,
        __endpointPath: logPath,
    }
}

interface UseTraceResolverOptions {
    traceScopeKey: string
    connectionStatus: string
    config: Config | null
    requestLogDownloading: boolean
}

interface UseTraceResolverReturn {
    traceLogLine: ParsedLogLine | null
    traceLoading: boolean
    traceError: string
    traceCandidates: TraceCandidate[]
    resolveTraceSourceInfo: (sourceRaw: string, authIndex: unknown) => SourceInfo
    loadTraceUsageDetails: () => Promise<void>
    refreshTraceUsageDetails: () => Promise<void>
    openTraceModal: (line: ParsedLogLine) => void
    closeTraceModal: () => void
}

export function useTraceResolver(options: UseTraceResolverOptions): UseTraceResolverReturn {
    const { traceScopeKey, connectionStatus, config, requestLogDownloading } = options
    const { t }                                                              = useTranslation()

    const [traceLogLine, setTraceLogLine]           = useState<ParsedLogLine | null>(null)
    const [traceUsageDetails, setTraceUsageDetails] = useState<UsageDetailWithEndpoint[]>([])
    const [traceAuthFileMap, setTraceAuthFileMap]   = useState<Map<string, CredentialInfo>>(new Map())
    const [traceLoading, setTraceLoading]           = useState(false)
    const [traceError, setTraceError]               = useState('')

    const traceAuthLoadedAtRef = useRef(0)
    const traceScopeKeyRef     = useRef('')
    const traceRequestIdRef    = useRef(0)

    const traceSourceInfoMap = useMemo(() => buildSourceInfoMap(config ?? {}), [config])

    const loadTraceUsageDetailsInternal = useCallback(
        async (line: ParsedLogLine | null) => {
            if (traceScopeKeyRef.current !== traceScopeKey) {
                traceScopeKeyRef.current     = traceScopeKey
                traceAuthLoadedAtRef.current = 0
                setTraceAuthFileMap(new Map())
                setTraceUsageDetails([])
                setTraceError('')
            }

            if (!line) {
                return
            }

            const logTimestampMs = line.timestamp ? Date.parse(line.timestamp) : Number.NaN
            if (Number.isNaN(logTimestampMs)) {
                setTraceUsageDetails([])
                setTraceError(t(
                    'logs.trace_timestamp_required',
                    { defaultValue: '日志时间缺失，不能安全匹配 usage 事件' },
                ))
                return
            }

            const currentRequestId    = traceRequestIdRef.current + 1
            traceRequestIdRef.current = currentRequestId

            const now       = Date.now()
            const authFresh = traceAuthLoadedAtRef.current >
                              0 &&
                              now -
                              traceAuthLoadedAtRef.current <
                              TRACE_AUTH_CACHE_MS
            const from      = new Date(logTimestampMs - TRACE_LOOKUP_WINDOW_MS).toISOString()
            const to        = new Date(logTimestampMs + TRACE_LOOKUP_WINDOW_MS).toISOString()
            const logPath   = normalizeTracePath(line.path)

            setTraceLoading(true)
            setTraceError('')
            try {
                const eventsPromise                       = usageApi.getEvents({
                                                                                   from,
                                                                                   to,
                                                                                   page: 1,
                                                                                   page_size: TRACE_EVENT_PAGE_SIZE,
                                                                                   sort: 'timestamp',
                                                                                   order: 'desc',
                                                                               })
                const authPromise                         = authFresh ?
                                                            Promise.resolve(null) :
                                                            authFilesApi.list().catch(() => null)
                const [eventsResponse, authFilesResponse] = await Promise.all([eventsPromise, authPromise])

                if (traceRequestIdRef.current !== currentRequestId) {
                    return
                }

                const events = Array.isArray(eventsResponse?.events) ? eventsResponse.events : []
                setTraceUsageDetails(events.map((event) => eventToTraceDetail(event, line, logPath)))

                if (authFilesResponse !== null) {
                    const files = Array.isArray(authFilesResponse)
                                  ? authFilesResponse
                                  : (authFilesResponse as { files?: AuthFileItem[] })?.files
                    if (Array.isArray(files)) {
                        const map = new Map<string, CredentialInfo>()
                        files.forEach((file) => {
                            const key = normalizeAuthIndex(file['auth_index'] ?? file.authIndex)
                            if (!key) {
                                return
                            }
                            map.set(key, {
                                name: file.name || key,
                                type: (file.type || file.provider || '').toString(),
                            })
                        })
                        setTraceAuthFileMap(map)
                        traceAuthLoadedAtRef.current = Date.now()
                    }
                }
            } catch (err: unknown) {
                if (traceRequestIdRef.current === currentRequestId) {
                    setTraceUsageDetails([])
                    setTraceError(getErrorMessage(err) || t('logs.trace_usage_load_error'))
                }
            } finally {
                if (traceRequestIdRef.current === currentRequestId) {
                    setTraceLoading(false)
                }
            }
        },
        [t, traceScopeKey],
    )

    const loadTraceUsageDetails = useCallback(async () => {
        await loadTraceUsageDetailsInternal(traceLogLine)
    }, [loadTraceUsageDetailsInternal, traceLogLine])

    const refreshTraceUsageDetails = useCallback(async () => {
        await loadTraceUsageDetailsInternal(traceLogLine)
    }, [loadTraceUsageDetailsInternal, traceLogLine])

    useEffect(() => {
        if (connectionStatus !== 'connected') {
            return
        }
        queueMicrotask(() => {
            traceScopeKeyRef.current     = traceScopeKey
            traceAuthLoadedAtRef.current = 0
            setTraceAuthFileMap(new Map())
            setTraceUsageDetails([])
            setTraceLoading(false)
            setTraceError('')
        })
    }, [connectionStatus, traceScopeKey])

    const traceCandidates = useMemo(() => {
        if (!traceLogLine) {
            return []
        }

        const logTimestampMs = traceLogLine.timestamp ? Date.parse(traceLogLine.timestamp) : Number.NaN
        const requestId      = traceLogLine.requestId?.trim().toLowerCase()
        const requestMatched = requestId
                               ?
                               traceUsageDetails.filter((detail) => detail.request_id?.trim().toLowerCase() ===
                                                                    requestId)
                               :
            []
        const requestScoped  = requestMatched.length > 0 ? requestMatched : traceUsageDetails

        const logModel     = extractModelFromMessage(traceLogLine.message)
        const modelMatched = logModel
                             ? requestScoped.filter((d) => d.__modelName?.toLowerCase() === logModel.toLowerCase())
                             : []
        const useModelSet  = modelMatched.length > 0
        const source       = useModelSet ? modelMatched : requestScoped

        return source
            .map((detail) => {
                const timeDeltaMs =
                          !Number.isNaN(logTimestampMs) && detail.__timestampMs > 0
                          ? Math.abs(logTimestampMs - detail.__timestampMs)
                          : null
                return {
                    detail,
                    modelMatched: useModelSet,
                    requestIdMatched: requestMatched.includes(detail),
                    timeDeltaMs,
                } satisfies TraceCandidate
            })
            .sort((a, b) => {
                if (a.requestIdMatched !== b.requestIdMatched) {
                    return a.requestIdMatched ? -1 : 1
                }
                const aDelta = a.timeDeltaMs ?? Number.MAX_SAFE_INTEGER
                const bDelta = b.timeDeltaMs ?? Number.MAX_SAFE_INTEGER
                if (aDelta !== bDelta) {
                    return aDelta - bDelta
                }
                return (b.detail.__timestampMs || 0) - (a.detail.__timestampMs || 0)
            })
            .slice(0, TRACE_MAX_CANDIDATES)
    }, [traceLogLine, traceUsageDetails])

    const resolveTraceSourceInfo = useCallback(
        (sourceRaw: string, authIndex: unknown): SourceInfo =>
            resolveSourceDisplay(sourceRaw, authIndex, traceSourceInfoMap, traceAuthFileMap),
        [traceAuthFileMap, traceSourceInfoMap],
    )

    const openTraceModal = useCallback(
        (line: ParsedLogLine) => {
            if (!isTraceableRequestPath(line.path)) {
                return
            }
            setTraceError('')
            setTraceUsageDetails([])
            setTraceLogLine(line)
            void loadTraceUsageDetailsInternal(line)
        },
        [loadTraceUsageDetailsInternal],
    )

    const closeTraceModal = useCallback(() => {
        if (requestLogDownloading) {
            return
        }
        setTraceLogLine(null)
        setTraceUsageDetails([])
    }, [requestLogDownloading])

    return {
        traceLogLine,
        traceLoading,
        traceError,
        traceCandidates,
        resolveTraceSourceInfo,
        loadTraceUsageDetails,
        refreshTraceUsageDetails,
        openTraceModal,
        closeTraceModal,
    }
}
