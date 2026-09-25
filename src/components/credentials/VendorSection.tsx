import type {AuthFileMutation} from '@/components/credentials/credentialsDataLifecycle'
import {Button} from '@/components/ui/Button'
import {IconChevronDown, IconChevronUp, IconKey, IconLogIn, IconPlus, IconUpload} from '@/components/ui/icons'
import {Pagination} from '@/components/ui/Pagination'
import {AuthFilesPrefixProxyEditorModal} from '@/features/authFiles/components/AuthFilesPrefixProxyEditorModal'
import {formatAuthFileDisplayName, formatModified, inferProviderFromAuthFileName} from '@/features/authFiles/constants'
import {useAuthFilesPrefixProxyEditor} from '@/features/authFiles/hooks/useAuthFilesPrefixProxyEditor'
import {deriveAuthFileIdentity} from '@/features/authFiles/identity'
import {useCredentialQuota} from '@/hooks/useCredentialQuota'
import {createProviderEditModalState, providerEditTriggerId} from '@/hooks/useProviderEditPresentation'
import type {AccountInspectionResult} from '@/services/api/accountInspection'
import {authFilesApi} from '@/services/api/authFiles'
import type {OAuthProvider} from '@/services/api/oauth'
import type {SummaryApiKeyStats, SummaryTimePoint} from '@/services/api/usage'
import {useNotificationStore} from '@/stores/useNotificationStore'
import type {
    CodexRateLimitResetCredit,
    CodexResetCreditCountState,
    CodexResetCreditDetailsState,
    GeminiKeyConfig,
    OpenAIProviderConfig,
    ProviderKeyConfig,
} from '@/types'
import type {AuthFileItem} from '@/types/authFile'
import {formatDateTime, maskApiKey} from '@/utils/format'
import {isModelScopedProviderError, parseProviderError} from '@/utils/providerError'
import {quotaCredentialKey} from '@/utils/quota/credentialKey'
import {normalizePlanType} from '@/utils/quota/parsers'
import {resolveCodexPlanType, resolveCodexSubscriptionActiveUntil} from '@/utils/quota/resolvers'
import {calculateStatusBarDataFromRecentRequests, calculateStatusBarDataFromSummaryPoints} from '@/utils/usage'
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {useLocation, useNavigate} from 'react-router-dom'
import {apiKeyMatchesStatus, buildManualKeyCardItems, type ManualKeyCardItem} from './apiKeyStatus'
import {compareAuthFilesBySafeIdentity, matchesAuthFileSearch} from './authFileListLogic'
import {CookieAuthFlow} from './CookieAuthFlow'
import {CredentialCard, type CredentialField, type CredentialRuntimeState} from './CredentialCard'
import type {VendorData} from './hooks/useCredentialsData'
import {useVendorActions} from './hooks/useVendorActions'
import type {VendorDefinition} from './hooks/useVendorRegistry'
import {OAuthLoginAction} from './OAuthLoginAction'
import styles from './VendorSection.module.scss'
import {VertexImportFlow} from './VertexImportFlow'

interface QuotaSchedulerLike {
    getLastRefreshTime: (name: string) => Date | null
    getNextRefreshTime: (name: string) => Date | null
    getStatus: (name: string) => string
    isRefreshing: (name: string) => boolean
    isAutoRefreshEnabled: () => boolean
    refreshNow: (name: string) => void | Promise<void>
    refreshMany: (names: string[]) => void | Promise<void>
}

interface VendorSectionProps {
    vendor: VendorDefinition
    data: VendorData
    aliases?: Record<string, string>
    onAliasChange?: (apiKey: string, alias: string) => void
    disableControls: boolean
    onRefresh: () => Promise<void>
    onAuthFileMutation: (mutation: AuthFileMutation) => Promise<void>
    searchQuery?: string
    statusFilter?: 'all' | 'available' | 'exhausted' | 'error' | 'disabled'
    typeFilter?: 'all' | 'api-key' | 'auth-file'
    selectedItems?: Set<string>
    onToggleSelect?: (id: string) => void
    onSelectVendorFiles?: (fileNames: string[], selected: boolean) => void
    onVisibleAuthFilesChange?: (vendorId: string, fileNames: string[]) => void
    quotaStatusMap?: Record<string, string>
    authIndexUsageStats?: Record<string, SummaryApiKeyStats>
    authIndexTimeSeries?: Record<string, SummaryTimePoint[]>
    authIndexUsageWindow?: {
        startMs: number
        bucketDurationMs: number
        bucketCount: number
    }
    authIndexUsageLoadFailed?: boolean
    usageStatisticsEnabled?: boolean
    accountHealthByAuthIndex?: Record<string, AccountInspectionResult>
    accountHealthLoadFailed?: boolean
    scheduler: QuotaSchedulerLike
}

type ActiveFlow = { type: 'oauth'; provider: OAuthProvider } | { type: 'cookie' } | { type: 'json-import' } | null

const wildcardToRegExp = (pattern: string): RegExp | null => {
    const normalized = pattern.trim()
    if (!normalized) {
        return null
    }
    const escaped = normalized.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')
    return new RegExp(escaped, 'i')
}

const matchesSearchQuery = (value: string, query: string, wildcard: RegExp | null): boolean => {
    if (!query) {
        return true
    }
    return wildcard ? wildcard.test(value) : value.toLowerCase().includes(query)
}

const joinSearchTokens = (items: Array<string | number | null | undefined | false>): string =>
    items
        .flatMap((item) => String(item ?? '').split(/\s+/))
        .map((item) => item.trim())
        .filter(Boolean)
        .join(' ')

const authFileProviderLabel = (file: AuthFileItem): string =>
    String(file.provider || file.type || inferProviderFromAuthFileName(file.name) || '').trim()

const authFileQuotaProvider = (file: AuthFileItem): string =>
    String(file.type || inferProviderFromAuthFileName(file.name) || file.provider || '').trim()

const authFileQuotaKey = (file: AuthFileItem): string =>
    quotaCredentialKey(authFileQuotaProvider(file), file.name, file.authIndex)

const modelSearchTokens = (models?: GeminiKeyConfig['models']): string[] =>
    Array.isArray(models)
    ? models
        .flatMap((model) => [model.name, model.alias, model.testModel])
        .filter((item): item is string => typeof item === 'string' && item.trim() !== '')
    : []

type SearchableKeyConfig = Partial<GeminiKeyConfig & ProviderKeyConfig & OpenAIProviderConfig> & {
    upstreamApiKey?: string
}

const backendMaskedApiKey = (key: string): string => {
    if (key.length > 8) {
        return `${key.slice(0, 4)}...${key.slice(-4)}`
    }
    if (key.length > 4) {
        return `${key.slice(0, 2)}...${key.slice(-2)}`
    }
    if (key.length > 2) {
        return `${key.slice(0, 1)}...${key.slice(-1)}`
    }
    return key
}

const apiKeyAliasTokens = (apiKey: string | undefined, aliases: Record<string, string>): string[] => {
    const trimmed = apiKey?.trim()
    if (!trimmed) {
        return []
    }
    return [trimmed, maskApiKey(trimmed), backendMaskedApiKey(trimmed), aliases[trimmed]].filter(
        (item): item is string => typeof item === 'string' && item.trim() !== '',
    )
}

const apiKeySearchTokens = (key: SearchableKeyConfig, aliases: Record<string, string>): string[] => [
    ...apiKeyAliasTokens(key.apiKey, aliases),
    ...(Array.isArray(key.apiKeyEntries)
        ? key.apiKeyEntries.flatMap((entry) => apiKeyAliasTokens(entry.apiKey, aliases))
        : []),
    ...apiKeyAliasTokens(key.upstreamApiKey, aliases),
]

const formatSize = (bytes: number): string => {
    if (bytes < 1024) {
        return `${bytes}B`
    }
    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(1)}KB`
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

function parseDateLike(value: string | number | null | undefined): Date | null {
    if (value === null || value === undefined || value === '') {
        return null
    }
    const date = typeof value === 'number' ?
                 new Date(value > 1_000_000_000_000 ? value : value * 1000) :
                 new Date(value)
    return Number.isNaN(date.getTime()) ? null : date
}

function formatDateLike(value: string | number | null | undefined, language: string): string | null {
    const date = parseDateLike(value)
    return date ? formatDateTime(date, language) : null
}

function dateLikeToISOString(value: string | number | null | undefined): string | undefined {
    return parseDateLike(value)?.toISOString()
}

const PREMIUM_CODEX_PLAN_TYPES = new Set(['pro', 'prolite', 'supergrokheavy'])

function formatPlanLabel(plan: string, t: ReturnType<typeof useTranslation>['t'], provider?: string): string {
    const normalized = normalizePlanType(plan)
    if (!normalized) {
        return plan
    }

    if (provider === 'codex') {
        const translated = t(`codex_quota.plan_${normalized}`, { defaultValue: '' })
        if (translated) {
            return translated
        }
    }
    if (provider === 'xai') {
        const translated = t(`xai_quota.plan_${normalized}`, { defaultValue: '' })
        if (translated) {
            return translated
        }
    }
    if (provider === 'antigravity') {
        const translated = t(`antigravity_quota.plan_${normalized}`, { defaultValue: '' }) ||
                           t(`antigravity_quota.plan_${normalized.replace(/lite$/, '_lite')}`, { defaultValue: '' })
        if (translated) {
            return translated
        }
    }

    const translated = t(`gemini_cli_quota.tier_${normalized}`, { defaultValue: '' })
    return translated || normalized.charAt(0).toUpperCase() + normalized.slice(1)
}

function comparePlanRank(current: string, next: string): 'upgrade' | 'downgrade' | null {
    const ranks: Record<string, number> = {
        free: 0,
        standard: 1,
        plus: 2,
        prolite: 3,
        pro: 4,
        team: 5,
        max: 6,
        ultra: 7,
    }
    const currentRank                   = ranks[current]
    const nextRank                      = ranks[next]
    if (currentRank === undefined || nextRank === undefined || currentRank === nextRank) {
        return null
    }
    return nextRank > currentRank ? 'upgrade' : 'downgrade'
}

function formatCodexResetCreditCount(
    count: CodexResetCreditCountState | undefined,
    t: ReturnType<typeof useTranslation>['t'],
): string {
    switch (count?.state) {
        case 'known':
            return String(count.value)
        case 'invalid':
            return t('codex_quota.reset_credits_count_invalid', { defaultValue: 'Invalid value' })
        case 'conflict': {
            const values = count.evidence
                                .map((item) => `${item.source}: ${item.value}`)
                                .join(', ')
            return t('codex_quota.reset_credits_count_conflict', {
                values,
                defaultValue: 'Conflicting values ({{values}})',
            })
        }
        default:
            return t('codex_quota.reset_credits_count_missing', { defaultValue: 'Not returned' })
    }
}

function formatCodexResetCreditExpiry(
    credit: CodexRateLimitResetCredit,
    language: string,
    t: ReturnType<typeof useTranslation>['t'],
): string {
    const formatted = credit.expiresAt ? (formatDateLike(credit.expiresAt, language) ?? '') : ''
    switch (credit.expiryState) {
        case 'valid':
            return formatted
        case 'expired':
            return t('codex_quota.reset_credit_expiry_expired', {
                value: formatted,
                defaultValue: 'Expired on {{value}}',
            })
        case 'invalid':
            return t('codex_quota.reset_credit_expiry_invalid', { defaultValue: 'Invalid expiry time' })
        default:
            return t('codex_quota.reset_credit_expiry_missing', { defaultValue: 'Expiry time not returned' })
    }
}

function codexResetCreditDetailsMessage(
    state: CodexResetCreditDetailsState | undefined,
    error: string | undefined,
    t: ReturnType<typeof useTranslation>['t'],
): string | null {
    switch (state) {
        case 'error':
            return t('codex_quota.reset_credits_expiry_failed', {
                message: error || t('common.unknown_error'),
                defaultValue: 'Failed to load manual reset expiry: {{message}}',
            })
        case 'invalid':
            return t('codex_quota.reset_credits_invalid_payload', {
                defaultValue: 'Invalid manual reset expiry response',
            })
        case 'missing':
            return t('codex_quota.reset_credits_details_missing', {
                defaultValue: 'Manual reset details were not returned',
            })
        case 'empty':
            return t('codex_quota.reset_credits_details_empty', {
                defaultValue: 'No manual reset details are currently available',
            })
        default:
            return null
    }
}

export function VendorSection({
                                  vendor,
                                  data,
                                  aliases = {},
                                  onAliasChange,
                                  disableControls,
                                  onRefresh,
                                  onAuthFileMutation,
                                  searchQuery = '',
                                  statusFilter = 'all',
                                  typeFilter = 'all',
                                  selectedItems,
                                  onToggleSelect,
                                  onSelectVendorFiles,
                                  onVisibleAuthFilesChange,
                                  quotaStatusMap = {},
                                  authIndexUsageStats = {},
                                  authIndexTimeSeries = {},
                                  authIndexUsageWindow,
                                  authIndexUsageLoadFailed = false,
                                  usageStatisticsEnabled = true,
                                  accountHealthByAuthIndex = {},
                                  accountHealthLoadFailed = false,
                                  scheduler,
                              }: VendorSectionProps) {
    const { t }                         = useTranslation()
    const navigate                      = useNavigate()
    const location                      = useLocation()
    const [expanded, setExpanded]       = useState(false)
    const [userToggled, setUserToggled] = useState(false)
    const [activeFlow, setActiveFlow]   = useState<ActiveFlow>(null)
    const fileInputRef                  = useRef<HTMLInputElement>(null)

    type SortField = 'name' | 'type' | 'status' | 'requests' | 'priority'
    type SortDir = 'asc' | 'desc'
    const [sortField, setSortField] = useState<SortField>('name')
    const [sortDir, setSortDir]     = useState<SortDir>('asc')

    const {
              deleteApiKey,
              toggleAuthFile,
              deleteAuthFile,
              downloadAuthFile,
              uploadAuthFile,
              uploadInFlight,
          } = useVendorActions(vendor.id, onRefresh, onAuthFileMutation)
    const {
              prefixProxyEditor,
              prefixProxyDirty,
              openPrefixProxyEditor,
              closePrefixProxyEditor,
              handlePrefixProxyChange,
              handlePrefixProxyBooleanChange,
              handlePrefixProxyOverridesChange,
              handlePrefixProxySave,
          } = useAuthFilesPrefixProxyEditor({
                                                disableControls,
                                                completeMutation: (name, fields, authIndex) => onAuthFileMutation({
                                                                                                                      kind: 'fields',
                                                                                                                      name,
                                                                                                                      authIndex,
                                                                                                                      fields,
                                                                                                                  }),
                                            })

    const VendorIcon     = vendor.icon
    const manualKeyItems = useMemo(
        () => buildManualKeyCardItems(vendor.id, data.apiKeys),
        [data.apiKeys, vendor.id],
    )
    const apiKeyCount    = manualKeyItems.length
    const authFileCount  = data.authFiles.length
    const totalCount     = apiKeyCount + authFileCount

    // Search filtering
    const rawQuery        = searchQuery.trim()
    const query           = rawQuery.toLowerCase()
    const wildcardQuery   = useMemo(() => wildcardToRegExp(rawQuery), [rawQuery])
    const filteredApiKeys = useMemo(() => {
        if (typeFilter === 'auth-file') {
            return []
        }
        return manualKeyItems.filter((item) => {
            const runtimeStatus = item.authIndex ? accountHealthByAuthIndex[item.authIndex] : undefined
            if (!apiKeyMatchesStatus(item, statusFilter, runtimeStatus)) {
                return false
            }
            if (!query) {
                return true
            }

            const config     = item.config as SearchableKeyConfig
            const entry      = vendor.id === 'openai' && item.entryIndex !== undefined
                               ? (item.config as OpenAIProviderConfig).apiKeyEntries[item.entryIndex]
                               : undefined
            const keyTokens  = vendor.id === 'openai'
                               ? apiKeyAliasTokens(item.apiKey, aliases)
                               : apiKeySearchTokens(config, aliases)
            const searchable = joinSearchTokens([
                                                    vendor.label,
                                                    vendor.id,
                                                    config.name,
                                                    config.baseUrl,
                                                    config.prefix,
                                                    entry?.proxyUrl,
                                                    item.entryIndex !== undefined ? item.entryIndex + 1 : undefined,
                                                    ...keyTokens,
                                                    ...modelSearchTokens(config.models),
                                                    runtimeStatus?.status,
                                                    runtimeStatus?.reason,
                                                ])
            return matchesSearchQuery(searchable, query, wildcardQuery)
        })
    }, [
                                        accountHealthByAuthIndex,
                                        aliases,
                                        manualKeyItems,
                                        query,
                                        statusFilter,
                                        typeFilter,
                                        vendor.id,
                                        vendor.label,
                                        wildcardQuery,
                                    ])

    const filteredAuthFiles = useMemo(() => {
        if (typeFilter === 'api-key') {
            return []
        }
        let files = data.authFiles
        if (query) {
            files = files.filter((file) => {
                const displayName   = formatAuthFileDisplayName(file.name)
                const providerLabel = authFileProviderLabel(file)
                const identityMatch = matchesAuthFileSearch(file, rawQuery, wildcardQuery)
                if (identityMatch) {
                    return true
                }
                const searchable = joinSearchTokens([
                                                        vendor.label,
                                                        vendor.id,
                                                        displayName,
                                                        providerLabel,
                                                        file.priority,
                                                        file.disabled ?
                                                        t('credentials.filter_disabled') :
                                                        t('credentials.filter_available'),
                                                        quotaStatusMap[authFileQuotaKey(file)] || file.status,
                                                    ])
                return matchesSearchQuery(searchable, query, wildcardQuery)
            })
        }
        if (statusFilter !== 'all') {
            files = files.filter((file) => {
                if (statusFilter === 'disabled') {
                    return file.disabled === true
                }
                if (file.disabled) {
                    return false
                }
                const success = Number(file.success ?? 0)
                const failure = Number(file.failed ?? 0)
                const total   = success + failure
                if (statusFilter === 'available') {
                    return total === 0 || success > 0
                }
                if (statusFilter === 'error') {
                    return failure > 0 && success === 0
                }
                if (statusFilter === 'exhausted') {
                    return file.status ===
                           'quota_exceeded' ||
                           quotaStatusMap[authFileQuotaKey(file)] ===
                           'quota_exceeded'
                }
                return true
            })
        }
        return files
    }, [
                                          data.authFiles,
                                          query,
                                          rawQuery,
                                          statusFilter,
                                          typeFilter,
                                          quotaStatusMap,
                                          wildcardQuery,
                                          t,
                                          vendor.id,
                                          vendor.label,
                                      ])

    const filteredTotal = filteredApiKeys.length + filteredAuthFiles.length

    // Sort auth files
    const sortedAuthFiles = useMemo(() => {
        const files = [...filteredAuthFiles]
        const dir   = sortDir === 'asc' ? 1 : -1
        files.sort((a, b) => {
            switch (sortField) {
                case 'name':
                    return dir * compareAuthFilesBySafeIdentity(a, b)
                case 'type':
                    return dir * (a.type ?? '').localeCompare(b.type ?? '')
                case 'status': {
                    const sa = a.disabled ? 1 : 0
                    const sb = b.disabled ? 1 : 0
                    return dir * (sa - sb)
                }
                case 'requests': {
                    const ra = Number(a.success ?? 0) + Number(a.failed ?? 0)
                    const rb = Number(b.success ?? 0) + Number(b.failed ?? 0)
                    return dir * (ra - rb)
                }
                case 'priority':
                    return dir * (Number(a.priority ?? 0) - Number(b.priority ?? 0))
                default:
                    return 0
            }
        })
        return files
    }, [filteredAuthFiles, sortField, sortDir])

    // Pagination state (auth files only — API keys are typically few)
    const PAGE_SIZE_OPTIONS                       = [24, 48, 96]
    const [authFilePage, setAuthFilePage]         = useState(1)
    const [authFilePageSize, setAuthFilePageSize] = useState(PAGE_SIZE_OPTIONS[0])
    const [apiKeyPage, setApiKeyPage]             = useState(1)
    const [apiKeyPageSize, setApiKeyPageSize]     = useState(PAGE_SIZE_OPTIONS[0])

    // Reset pagination when a list filter changes
    const filterSignature                                       = JSON.stringify([query, statusFilter, typeFilter])
    const [previousFilterSignature, setPreviousFilterSignature] = useState(filterSignature)
    if (previousFilterSignature !== filterSignature) {
        setPreviousFilterSignature(filterSignature)
        setAuthFilePage(1)
        setApiKeyPage(1)
    }

    const authFilePageCount = Math.max(1, Math.ceil(sortedAuthFiles.length / authFilePageSize))
    const apiKeyPageCount   = Math.max(1, Math.ceil(filteredApiKeys.length / apiKeyPageSize))
    const safeAuthFilePage  = Math.min(authFilePage, authFilePageCount)
    const safeApiKeyPage    = Math.min(apiKeyPage, apiKeyPageCount)

    const paginatedAuthFiles = useMemo(() => {
        const start = (safeAuthFilePage - 1) * authFilePageSize
        return sortedAuthFiles.slice(start, start + authFilePageSize)
    }, [sortedAuthFiles, safeAuthFilePage, authFilePageSize])

    const filteredAuthFileNames = useMemo(() => sortedAuthFiles.map((file) => file.name), [sortedAuthFiles])

    useEffect(() => {
        onVisibleAuthFilesChange?.(vendor.id, filteredAuthFileNames)
        return () => onVisibleAuthFilesChange?.(vendor.id, [])
    }, [onVisibleAuthFilesChange, vendor.id, filteredAuthFileNames])

    const vendorAllSelected = useMemo(() => {
        if (!selectedItems || filteredAuthFileNames.length === 0) {
            return false
        }
        return filteredAuthFileNames.every((name) => selectedItems.has(name))
    }, [selectedItems, filteredAuthFileNames])

    const handleVendorSelectToggle = useCallback(() => {
        if (!onSelectVendorFiles) {
            return
        }
        onSelectVendorFiles(filteredAuthFileNames, !vendorAllSelected)
    }, [onSelectVendorFiles, filteredAuthFileNames, vendorAllSelected])

    const paginatedApiKeys = useMemo(() => {
        const start = (safeApiKeyPage - 1) * apiKeyPageSize
        return filteredApiKeys.slice(start, start + apiKeyPageSize)
    }, [filteredApiKeys, safeApiKeyPage, apiKeyPageSize])

    const showAuthFilePagination = sortedAuthFiles.length > PAGE_SIZE_OPTIONS[0]
    const showApiKeyPagination   = filteredApiKeys.length > PAGE_SIZE_OPTIONS[0]

    // Auto-expand vendors with credentials, collapse empty ones (until user manually toggles)
    const [prevTotalCount, setPrevTotalCount] = useState(totalCount)
    if (prevTotalCount !== totalCount) {
        setPrevTotalCount(totalCount)
        if (!userToggled) {
            setExpanded(totalCount > 0)
        }
    }

    const hasAnyAction   =
              Boolean(vendor.editRoute) ||
              vendor.oauthProviders.length > 0 ||
              vendor.supportsFileUpload ||
              vendor.supportsJsonImport ||
              vendor.supportsCookieAuth
    const createButtonId = providerEditTriggerId(vendor.id, 'new')

    const toggleFlow = useCallback(
        (flow: ActiveFlow) => {
            if (activeFlow?.type === flow?.type) {
                if (flow?.type === 'oauth' && activeFlow?.type === 'oauth' && flow.provider === activeFlow.provider) {
                    setActiveFlow(null)
                    return
                }
                if (flow?.type !== 'oauth') {
                    setActiveFlow(null)
                    return
                }
            }
            setActiveFlow(flow)
        },
        [activeFlow],
    )

    const handleOAuthSuccess = useCallback(() => {
        void onAuthFileMutation({ kind: 'reload' })
    }, [onAuthFileMutation])

    const handleFlowSuccess = useCallback(async () => {
        setActiveFlow(null)
        await onAuthFileMutation({ kind: 'reload' })
    }, [onAuthFileMutation])

    const handleFlowCancel = useCallback(() => setActiveFlow(null), [])

    // --- Highlight matching text ---

    const highlightMatch = useCallback(
        (text: string): React.ReactNode => {
            if (!query || !text || wildcardQuery) {
                return text
            }
            const idx = text.toLowerCase().indexOf(query)
            if (idx === -1) {
                return text
            }
            return (
                <>
                    {text.slice(0, idx)}
                    <mark>{text.slice(idx, idx + query.length)}</mark>
                    {text.slice(idx + query.length)}
                </>
            )
        },
        [query, wildcardQuery],
    )

    // --- Resolve display name for API key (alias > masked key) ---

    const resolveApiKeyTitle = useCallback(
        (apiKey: string | undefined): string => {
            if (!apiKey) {
                return ''
            }
            const alias = aliases[apiKey]
            return alias || maskApiKey(apiKey)
        },
        [aliases],
    )

    const openProviderEditor = useCallback(
        (route: string, returnFocusId: string) => {
            navigate(route, {
                state: createProviderEditModalState(location, returnFocusId),
            })
        },
        [location, navigate],
    )

    const resolveRuntimeState = useCallback(
        (item: ManualKeyCardItem): CredentialRuntimeState => {
            const authIndex = item.authIndex?.trim()
            const health    = authIndex ? accountHealthByAuthIndex[authIndex] : undefined
            const warning   = accountHealthLoadFailed
                              ? t(
                    health ? 'credentials.inspection_data_stale' : 'credentials.inspection_load_failed',
                    {
                        defaultValue: health
                                      ? '巡检数据刷新失败，正在显示上次结果'
                                      : '巡检数据加载失败',
                    },
                )
                              : undefined

            if (item.disabled) {
                return {
                    status: 'disabled',
                    reason: 'disabled',
                    checkedAt: health?.checked_at,
                    warning,
                }
            }
            if (!authIndex) {
                return {
                    status: 'unknown',
                    reason: 'unknown',
                    message: t('credentials.auth_index_unavailable', {
                        defaultValue: '当前配置未返回可关联的运行身份',
                    }),
                    warning,
                }
            }
            if (!health) {
                return {
                    status: 'unknown',
                    reason: 'pending',
                    message: t('credentials.inspection_result_unavailable', {
                        defaultValue: '暂无该凭证的巡检结果',
                    }),
                    warning,
                }
            }

            const advice = health.advice?.trim()
            return {
                status: health.status,
                reason: health.reason || undefined,
                checkedAt: health.checked_at,
                message: advice
                         ? t(`credentials.inspection_advice_${advice}`, { defaultValue: advice })
                         : undefined,
                warning,
            }
        },
        [accountHealthByAuthIndex, accountHealthLoadFailed, t],
    )

    const resolveUsageError = useCallback(
        (item: ManualKeyCardItem): string | undefined => {
            const authIndex = item.authIndex?.trim()
            if (!authIndex) {
                return t('credentials.usage_auth_index_unavailable', {
                    defaultValue: '当前配置未返回可关联的请求统计身份',
                })
            }
            if (!usageStatisticsEnabled) {
                return t('credentials.usage_collection_disabled', {
                    defaultValue: '使用统计已停用，近期请求数据可能不完整',
                })
            }
            if (!authIndexUsageLoadFailed) {
                return undefined
            }
            const hasPreviousData = Boolean(
                authIndexUsageStats[authIndex] || authIndexTimeSeries[authIndex]?.length,
            )
            return t(
                hasPreviousData ? 'credentials.usage_data_stale' : 'credentials.usage_load_failed',
                {
                    defaultValue: hasPreviousData
                                  ? '请求统计刷新失败，正在显示上次结果'
                                  : '请求统计加载失败',
                },
            )
        },
        [authIndexTimeSeries, authIndexUsageLoadFailed, authIndexUsageStats, t, usageStatisticsEnabled],
    )

    // --- Render API key card ---

    const renderApiKeyCard = (item: ManualKeyCardItem) => {
        const authIndex    = item.authIndex?.trim()
        const stats        = authIndex ? authIndexUsageStats[authIndex] : undefined
        const series       = authIndex ? authIndexTimeSeries[authIndex] : undefined
        const statusBar    = authIndex && authIndexUsageWindow &&
                             ((usageStatisticsEnabled && !authIndexUsageLoadFailed) || series !== undefined)
                             ? calculateStatusBarDataFromSummaryPoints(
                series ?? [],
                authIndexUsageWindow.startMs,
                authIndexUsageWindow.bucketDurationMs,
                authIndexUsageWindow.bucketCount,
            )
                             : undefined
        const runtimeState = resolveRuntimeState(item)
        const statsError   = resolveUsageError(item)
        const cardIdentity = [
            item.configIndex,
            item.entryIndex ?? 'root',
        ].join('-')
        const controlLabel = `${vendor.label} ${authIndex || cardIdentity}`
        const editButtonId = providerEditTriggerId(vendor.id, cardIdentity)
        const onEdit       = vendor.editRoute
                             ? () => openProviderEditor(`${vendor.editRoute}/${item.configIndex}`, editButtonId)
                             : undefined

        if (vendor.id === 'openai') {
            const provider       = item.config as OpenAIProviderConfig
            const entry          = item.entryIndex !== undefined
                                   ? provider.apiKeyEntries[item.entryIndex]
                                   : undefined
            const title          = resolveApiKeyTitle(item.apiKey) ||
                                   provider.name ||
                                   t('credentials.api_key_not_configured', {
                                       defaultValue: '未配置 API Key',
                                   })
            const tags: string[] = []
            if (provider.models?.length) {
                tags.push(`${provider.models.length} ${t('credentials.models')}`)
            }
            if ((provider.headers && Object.keys(provider.headers).length) ||
                (entry?.headers && Object.keys(entry.headers).length)) {
                tags.push(t('common.custom_headers_label'))
            }
            return (
                <CredentialCard
                    key={`api-${vendor.id}-${item.configIndex}-${item.entryIndex ?? 'root'}-${authIndex ?? ''}`}
                    category='api-key'
                    title={title}
                    controlLabel={controlLabel}
                    highlightTitle={highlightMatch(title)}
                    alias={aliases[item.apiKey]}
                    onAliasChange={onAliasChange && item.apiKey
                                   ? (newAlias) => onAliasChange(item.apiKey, newAlias)
                                   : undefined}
                    badge={{ label: 'API', color: 'var(--text-secondary)', bgColor: 'var(--bg-tertiary)' }}
                    fields={[
                        ...(provider.name ?
                            [{ id: 'provider-name', label: t('credentials.inspection_provider'), value: provider.name }] :
                            []),
                        ...(provider.baseUrl
                            ? [{ id: 'base-url', label: t('common.base_url'), value: provider.baseUrl }]
                            : []),
                        ...(provider.prefix ? [{ id: 'prefix', label: t('common.prefix'), value: provider.prefix }] : []),
                        ...(entry?.proxyUrl
                            ? [{ id: 'proxy-url', label: t('common.proxy_url'), value: entry.proxyUrl }]
                            : []),
                        ...(entry?.weight !== undefined
                            ? [{ id: 'weight', label: t('ai_providers.weight_label'), value: String(entry.weight) }]
                            : []),
                        ...(provider.priority !== undefined
                            ? [{ id: 'priority', label: t('common.priority'), value: String(provider.priority) }]
                            : []),
                    ]}
                    tags={tags.length ? tags : undefined}
                    disabled={runtimeState.status === 'disabled'}
                    runtimeState={runtimeState}
                    quotaCapability='unsupported'
                    stats={stats}
                    statsError={statsError}
                    statusBar={statusBar}
                    disableControls={disableControls}
                    editButtonId={editButtonId}
                    onEdit={onEdit}
                    onDelete={() => void deleteApiKey(provider.name)}
                />
            )
        }

        const key            = item.config as GeminiKeyConfig & ProviderKeyConfig
        const tags: string[] = []
        if (key.models?.length) {
            tags.push(`${key.models.length} ${t('credentials.models')}`)
        }
        if (key.websockets) {
            tags.push('WebSocket')
        }
        if (vendor.id === 'xai' && key.disableCooling) {
            tags.push(t('ai_providers.xai_disable_cooling_label'))
        }
        if (key.headers && Object.keys(key.headers).length) {
            tags.push(t('common.custom_headers_label'))
        }
        const title = resolveApiKeyTitle(item.apiKey) || t('credentials.api_key_not_configured', {
            defaultValue: '未配置 API Key',
        })

        return (
            <CredentialCard
                key={`api-${vendor.id}-${item.configIndex}-${authIndex ?? ''}`}
                category='api-key'
                title={title}
                controlLabel={controlLabel}
                highlightTitle={highlightMatch(title)}
                alias={aliases[item.apiKey]}
                onAliasChange={onAliasChange && item.apiKey
                               ? (newAlias) => onAliasChange(item.apiKey, newAlias)
                               : undefined}
                badge={{ label: 'API', color: 'var(--text-secondary)', bgColor: 'var(--bg-tertiary)' }}
                fields={[
                    ...(key.priority !== undefined
                        ? [{ id: 'priority', label: t('common.priority'), value: String(key.priority) }]
                        : []),
                    ...(key.weight !== undefined
                        ? [{ id: 'weight', label: t('ai_providers.weight_label'), value: String(key.weight) }]
                        : []),
                    ...(key.prefix ? [{ id: 'prefix', label: t('common.prefix'), value: key.prefix }] : []),
                    ...(key.baseUrl ? [{ id: 'base-url', label: t('common.base_url'), value: key.baseUrl }] : []),
                    ...(key.proxyUrl ? [{ id: 'proxy-url', label: t('common.proxy_url'), value: key.proxyUrl }] : []),
                ]}
                tags={tags.length ? tags : undefined}
                disabled={runtimeState.status === 'disabled'}
                runtimeState={runtimeState}
                quotaCapability='unsupported'
                stats={stats}
                statsError={statsError}
                statusBar={statusBar}
                disableControls={disableControls}
                editButtonId={editButtonId}
                onEdit={onEdit}
                onDelete={() => void deleteApiKey(item.apiKey, key.baseUrl)}
            />
        )
    }

    return (
        <div className={`${styles.section} ${expanded ? styles.expanded : ''}`}>
            {/* Header */}
            <div
                className={styles.header}
                onClick={() => {
                    setUserToggled(true)
                    setExpanded((prev) => !prev)
                }}
            >
                <div className={styles.headerLeft}>
                    <span className={styles.expandIcon}>
                        {expanded ? <IconChevronUp size={12} /> : <IconChevronDown size={12} />}
                    </span>
                    <VendorIcon size={16} />
                    <span className={styles.vendorName}>{vendor.label}</span>
                    {totalCount > 0 && (
                        <span className={styles.countBadge}>
                            {filteredTotal !== totalCount ? `${filteredTotal}/${totalCount}` : totalCount}
                        </span>
                    )}
                </div>

                {hasAnyAction && (
                    <div className={styles.headerActions} onClick={(e) => e.stopPropagation()}>
                        {onSelectVendorFiles && filteredAuthFileNames.length > 0 && (
                            <label className={styles.vendorSelectAll} title={t('credentials.batch_select_vendor')}>
                                <input
                                    type='checkbox'
                                    checked={vendorAllSelected}
                                    onChange={handleVendorSelectToggle}
                                />
                                <span>
                                    {vendorAllSelected
                                     ? t('credentials.batch_deselect_all')
                                     : t('credentials.batch_select_all')}
                                </span>
                            </label>
                        )}
                        {vendor.createRoute && (
                            <Button
                                id={createButtonId}
                                variant='secondary'
                                size='xs'
                                onClick={() => openProviderEditor(vendor.createRoute!, createButtonId)}
                                disabled={disableControls}
                            >
                                <IconPlus size={11} />
                                <span>{t('credentials.manual_config')}</span>
                            </Button>
                        )}
                        {vendor.oauthProviders.map((provider) => (
                            <Button
                                key={provider}
                                variant='secondary'
                                size='xs'
                                onClick={() => toggleFlow({ type: 'oauth', provider })}
                                disabled={disableControls}
                            >
                                <IconLogIn size={11} />
                                <span>OAuth ({provider})</span>
                            </Button>
                        ))}
                        {vendor.supportsFileUpload && (
                            <Button
                                variant='secondary'
                                size='xs'
                                onClick={() => fileInputRef.current?.click()}
                                disabled={disableControls || uploadInFlight}
                            >
                                <IconUpload size={11} />
                                <span>{t('credentials.upload_file')}</span>
                            </Button>
                        )}
                        {vendor.supportsJsonImport && (
                            <Button
                                variant='secondary'
                                size='xs'
                                onClick={() => toggleFlow({ type: 'json-import' })}
                                disabled={disableControls}
                            >
                                <IconUpload size={11} />
                                <span>{t('credentials.import_json')}</span>
                            </Button>
                        )}
                        {vendor.supportsCookieAuth && (
                            <Button
                                variant='secondary'
                                size='xs'
                                onClick={() => toggleFlow({ type: 'cookie' })}
                                disabled={disableControls}
                            >
                                <IconKey size={11} />
                                <span>{t('credentials.cookie_auth')}</span>
                            </Button>
                        )}
                    </div>
                )}
            </div>

            {/* Flow area */}
            {activeFlow?.type === 'oauth' && (
                <div className={styles.flowArea}>
                    <OAuthLoginAction
                        key={activeFlow.provider}
                        provider={activeFlow.provider}
                        disableControls={disableControls}
                        onSuccess={handleOAuthSuccess}
                        onCancel={handleFlowCancel}
                    />
                </div>
            )}

            {activeFlow?.type === 'cookie' && (
                <CookieAuthFlow
                    disableControls={disableControls}
                    onSuccess={handleFlowSuccess}
                    onCancel={handleFlowCancel}
                />
            )}

            {activeFlow?.type === 'json-import' && (
                <VertexImportFlow
                    disableControls={disableControls}
                    onSuccess={handleFlowSuccess}
                    onCancel={handleFlowCancel}
                />
            )}

            {/* Hidden file input */}
            {vendor.supportsFileUpload && (
                <input
                    ref={fileInputRef}
                    type='file'
                    hidden
                    onChange={(e) => {
                        const file = e.target.files?.[0]
                        if (file) {
                            void uploadAuthFile(file)
                        }
                        e.target.value = ''
                    }}
                />
            )}

            {/* Empty state */}
            {expanded && totalCount === 0 && <div className={styles.emptyBody}>{t('credentials.no_credentials')}</div>}

            {/* No search results */}
            {expanded &&
             totalCount > 0 &&
             filteredTotal === 0 &&
             (query || statusFilter !== 'all' || typeFilter !== 'all') && (
                 <div className={styles.emptyBody}>
                     {query
                      ? t('credentials.no_search_results', { query: searchQuery })
                      : t('credentials.no_filter_results')}
                 </div>
             )}

            {/* Credential cards */}
            <AuthFilesPrefixProxyEditorModal
                editor={prefixProxyEditor}
                dirty={prefixProxyDirty}
                onClose={closePrefixProxyEditor}
                onChange={handlePrefixProxyChange}
                onBooleanChange={handlePrefixProxyBooleanChange}
                onOverridesChange={handlePrefixProxyOverridesChange}
                onSave={handlePrefixProxySave}
            />

            {expanded && filteredTotal > 0 && (
                <div className={styles.body}>
                    {filteredApiKeys.length > 0 && (
                        <div className={styles.group}>
                            <div className={styles.groupTitle}>
                                {t('credentials.api_keys')}
                                <span className={styles.groupCount}>{filteredApiKeys.length}</span>
                            </div>
                            <div className={styles.grid}>
                                {paginatedApiKeys.map(renderApiKeyCard)}
                            </div>
                            {showApiKeyPagination && (
                                <Pagination
                                    total={filteredApiKeys.length}
                                    page={safeApiKeyPage}
                                    pageSize={apiKeyPageSize}
                                    pageSizeOptions={PAGE_SIZE_OPTIONS}
                                    onPageChange={setApiKeyPage}
                                    onPageSizeChange={(size) => {
                                        setApiKeyPageSize(size)
                                        setApiKeyPage(1)
                                    }}
                                />
                            )}
                        </div>
                    )}

                    {filteredAuthFiles.length > 0 && (
                        <div className={styles.group}>
                            <div className={styles.groupTitle}>
                                {t('credentials.auth_files')}
                                <span className={styles.groupCount}>{filteredAuthFiles.length}</span>
                                <div className={styles.sortControls}>
                                    {([
                                        'name',
                                        'type',
                                        'status',
                                        'requests',
                                        'priority',
                                    ] as SortField[]).map((field) => (
                                        <button
                                            key={field}
                                            type='button'
                                            className={`${styles.sortButton} ${
                                                sortField === field ? styles.sortActive : ''
                                            }`}
                                            onClick={() => {
                                                if (sortField === field) {
                                                    setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
                                                } else {
                                                    setSortField(field)
                                                    setSortDir(field === 'requests' ? 'desc' : 'asc')
                                                }
                                                setAuthFilePage(1)
                                            }}
                                        >
                                            {t(`credentials.sort_${field}`, { defaultValue: field })}
                                            {sortField === field && (sortDir === 'asc' ? ' \u2191' : ' \u2193')}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div className={styles.grid}>
                                {paginatedAuthFiles.map((file, index) => (
                                    <div key={`af-${file.name}-${String(file.authIndex ?? index)}`}>
                                        <AuthFileCardWithQuota
                                            file={file}
                                            position={(safeAuthFilePage - 1) * authFilePageSize + index + 1}
                                            scheduler={scheduler}
                                            disableControls={disableControls}
                                            onToggle={toggleAuthFile}
                                            onRefresh={onRefresh}
                                            selected={selectedItems?.has(file.name)}
                                            onSelect={onToggleSelect ? () => onToggleSelect(file.name) : undefined}
                                            onEdit={openPrefixProxyEditor}
                                            onDelete={deleteAuthFile}
                                            onDownload={downloadAuthFile}
                                        />
                                    </div>
                                ))}
                            </div>
                            {showAuthFilePagination && (
                                <Pagination
                                    total={filteredAuthFiles.length}
                                    page={safeAuthFilePage}
                                    pageSize={authFilePageSize}
                                    pageSizeOptions={PAGE_SIZE_OPTIONS}
                                    onPageChange={setAuthFilePage}
                                    onPageSizeChange={(size) => {
                                        setAuthFilePageSize(size)
                                        setAuthFilePage(1)
                                    }}
                                />
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}

// --- Wrapper component to inject quota data per auth file (hooks require component boundary) ---

interface AuthFileCardWithQuotaProps {
    file: AuthFileItem
    position: number
    scheduler: QuotaSchedulerLike
    disableControls: boolean
    onToggle: (file: AuthFileItem, disabled: boolean) => Promise<void>
    onRefresh: () => Promise<void>
    onEdit: (file: AuthFileItem) => void | Promise<void>
    onDelete: (name: string) => void
    onDownload: (name: string) => Promise<void>
    selected?: boolean
    onSelect?: () => void
}

function AuthFileCardWithQuota({
                                   file,
                                   position,
                                   scheduler,
                                   disableControls,
                                   onToggle,
                                   onRefresh,
                                   onEdit,
                                   onDelete,
                                   onDownload,
                                   selected,
                                   onSelect,
                               }: AuthFileCardWithQuotaProps) {
    const { t, i18n }                         = useTranslation()
    const showNotification                    = useNotificationStore((s) => s.showNotification)
    const [tokenRefreshing, setTokenRefreshing] = useState(false)
    const quotaProvider             = authFileQuotaProvider(file)
    const authIndex                 = String(file.authIndex ?? file['auth_index'] ?? '').trim()
    const {
              items: quotaItems,
              lastError: quotaError,
              loading: quotaLoading,
              freshness: quotaFreshness,
              observedAt: quotaObservedAt,
              successfulEmpty: quotaSuccessfulEmpty,
              planType: quotaPlanType,
              premium: quotaPremium,
              subscriptionActiveUntil: quotaSubscriptionActiveUntil,
              manualResetCount: quotaManualResetCount,
              applicableManualResetCount: quotaApplicableManualResetCount,
              resetCreditExpiries: quotaResetCreditExpiries,
              resetCreditDetailsState: quotaResetCreditDetailsState,
              resetCreditExpiriesError: quotaResetCreditExpiriesError,
          }                         = useCredentialQuota(quotaProvider, file.name, authIndex)
    const recentStatusBar           = useMemo(
        () => calculateStatusBarDataFromRecentRequests(file.recentRequests ?? []),
        [file.recentRequests],
    )
    const success                   = Number(file.success ?? 0)
    const failure                   = Number(file.failed ?? 0)
    const stats                     = success > 0 || failure > 0 ? { success, failure } : undefined
    const statusBar                 = recentStatusBar

    const quotaKey                             = authFileQuotaKey(file)
    const lastRefreshTime                      = scheduler.getLastRefreshTime(quotaKey)
    const nextRefreshTime                      = scheduler.getNextRefreshTime(quotaKey)
    const isRefreshing                         = scheduler.isRefreshing(quotaKey)
    const schedulerStatus                      = scheduler.getStatus(quotaKey)
    const providerLabel                        = authFileProviderLabel(file)
    const controlLabel                         = `${providerLabel || t('credentials.auth_files')} ${
        authIndex || `#${position}`
    }`
    const isCodexProvider                      = quotaProvider.toLowerCase().includes('codex')
    const isDevinProvider                      = ['devin', 'cognition'].includes(quotaProvider.toLowerCase())
    const providerError                        = parseProviderError(file.runtimeError ?? file.statusMessage)
    const runtimeObservedAt                    = providerError?.observedAt ?? dateLikeToISOString(file.updatedAt)
    const runtimeObservedAtMs                  = parseDateLike(runtimeObservedAt)?.getTime()
    const quotaObservedAtMs                    = parseDateLike(quotaObservedAt)?.getTime()
    const quotaPredatesRuntimeError            =
              isModelScopedProviderError(providerError) &&
              runtimeObservedAtMs !== undefined &&
              quotaObservedAtMs !== undefined &&
              quotaObservedAtMs < runtimeObservedAtMs
    const effectiveQuotaFreshness              = quotaPredatesRuntimeError
                                                 ? quotaItems?.length || quotaSuccessfulEmpty
                                                   ? 'stale'
                                                   : 'outdated'
                                                 : quotaFreshness
    const quotaObservationWarning              = quotaPredatesRuntimeError
                                                 ? t('credentials.quota_older_than_runtime_error', {
            defaultValue: 'This quota snapshot predates the latest model error',
        })
                                                 : undefined
    const runtimeStatus                        = String(file.status ?? '').trim().toLowerCase()
    const runtimeState: CredentialRuntimeState = {
        status:
            file.disabled || runtimeStatus === 'disabled' ?
            'disabled' :
            file.unavailable || runtimeStatus === 'error' || runtimeStatus === 'unavailable' ?
            'unavailable' :
            runtimeStatus === 'active' ?
            'normal' :
            'unknown',
        reason:
            file.disabled || runtimeStatus === 'disabled' ?
            'disabled' :
            file.unavailable || runtimeStatus === 'error' || runtimeStatus === 'unavailable' ?
            'provider_error' :
            runtimeStatus === 'active' ?
            'ok' :
            'unknown',
        checkedAt: runtimeObservedAt,
        nextRetryAfter: providerError?.nextRetryAfter ?? dateLikeToISOString(file.nextRetryAfter),
        message: providerError?.message ?? (file.statusMessage?.trim() || undefined),
        providerError: providerError ?? undefined,
    }

    const handleQuotaRefresh = useCallback(async () => {
        await scheduler.refreshNow(quotaKey)
        await onRefresh()
    }, [onRefresh, quotaKey, scheduler])

    const handleManualTokenRefresh = useCallback(async () => {
        if (!authIndex) {
            showNotification(
                t('credentials.manual_token_refresh_missing_identity', {
                    defaultValue: 'Missing auth_index; token refresh is unavailable',
                }),
                'error',
            )
            return
        }
        setTokenRefreshing(true)
        try {
            await authFilesApi.requestManualRefresh(file.name, authIndex)
            await onRefresh()
            showNotification(
                t('credentials.manual_token_refresh_success', {
                    name: formatAuthFileDisplayName(file.name),
                    defaultValue: 'Token refreshed for "{{name}}"',
                }),
                'success',
            )
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            showNotification(
                t('credentials.manual_token_refresh_failed', {
                    name: formatAuthFileDisplayName(file.name),
                    message,
                    defaultValue: 'Failed to refresh token for "{{name}}": {{message}}',
                }),
                'error',
            )
        } finally {
            setTokenRefreshing(false)
        }
    }, [authIndex, file.name, onRefresh, showNotification, t])

    const refreshState = {
        lastRefreshTime,
        nextRefreshTime,
        isRefreshing,
        autoRefreshEnabled: scheduler.isAutoRefreshEnabled(),
        status: schedulerStatus,
        onRefresh: () => void handleQuotaRefresh(),
    }
    const manualTokenRefreshState = {
        isRefreshing: tokenRefreshing,
        onRefresh: () => void handleManualTokenRefresh(),
        disabled: !authIndex,
        title: authIndex ?
               t('credentials.manual_token_refresh', {defaultValue: 'Refresh token'}) :
               t('credentials.manual_token_refresh_missing_identity', {
                   defaultValue: 'Missing auth_index; token refresh is unavailable',
               }),
    }

    const identity                      = deriveAuthFileIdentity(file)
    const modifiedStr                   = formatModified(file)
    const fields: CredentialField[]     = []
    const planLabelProvider                          = providerLabel.toLowerCase().includes('codex') ?
                                                       'codex' :
                                                       providerLabel.toLowerCase().includes('xai') ||
                                                       providerLabel.toLowerCase().includes('grok') ?
                                                       'xai' :
                                                       providerLabel.toLowerCase().includes('antigravity') ?
                                                       'antigravity' :
                                                       undefined
    if (identity.secondary) {
        fields.push({
                        id: 'file-name',
                        label: t('auth_files.file_name', { defaultValue: 'File' }),
                        value: identity.secondary,
                    })
    }
    if (providerLabel) {
        fields.push({
                        id: 'provider',
                        label: t('credentials.inspection_provider', { defaultValue: '供应商' }),
                        value: providerLabel,
                    })
    }
    if (file.priority !== undefined) {
        fields.push({ id: 'priority', label: t('auth_files.priority_display'), value: String(file.priority) })
    }
    if (file.note) {
        fields.push({ id: 'note', label: t('auth_files.note_display'), value: file.note })
    }
    if (file.size) {
        fields.push({ id: 'size', label: t('common.size'), value: formatSize(file.size) })
    }
    if (modifiedStr !== '-') {
        fields.push({ id: 'modified', label: t('auth_files.file_modified'), value: modifiedStr })
    }
    if (isCodexProvider) {
        const subscriptionActiveUntil = quotaSubscriptionActiveUntil ?? resolveCodexSubscriptionActiveUntil(file)
        const subscriptionLabel       = formatDateLike(subscriptionActiveUntil, i18n.language)
        if (subscriptionLabel) {
            fields.push({
                            id: 'subscription-active-until',
                            label: t('credentials.subscription_active_until', { defaultValue: 'Subscription until' }),
                            value: subscriptionLabel,
                        })
        }
        fields.push({
                        id: 'reset-credits-available',
                        label: t('codex_quota.reset_credits_label', { defaultValue: 'Available manual resets' }),
                        value: formatCodexResetCreditCount(quotaManualResetCount, t),
                    })
        fields.push({
                        id: 'reset-credits-applicable',
                        label: t('codex_quota.reset_credits_applicable_label', {
                            defaultValue: 'Manual resets applicable to this account',
                        }),
                        value: formatCodexResetCreditCount(quotaApplicableManualResetCount, t),
                    })
        quotaResetCreditExpiries?.forEach((credit, index) => {
            const creditLabel    = t('codex_quota.reset_credit_number', {
                index: index + 1,
                defaultValue: 'Reset {{index}}',
            })
            const creditIdentity = credit.id.trim() || 'credit'
            fields.push({
                            id: `reset-credit-expiry-${creditIdentity}-${index}`,
                            label: t('codex_quota.reset_credits_expiry_label', {
                                defaultValue: 'Manual reset expiry',
                            }),
                            value: `${creditLabel} ${formatCodexResetCreditExpiry(credit, i18n.language, t)}`,
                            wrap: true,
                        })
        })
        const resetCreditDetailsMessage = codexResetCreditDetailsMessage(
            quotaResetCreditDetailsState,
            quotaResetCreditExpiriesError,
            t,
        )
        if (resetCreditDetailsMessage) {
            fields.push({
                            id: 'reset-credit-expiry-details',
                            label: t('codex_quota.reset_credits_expiry_label', {
                                defaultValue: 'Manual reset expiry',
                            }),
                            value: resetCreditDetailsMessage,
                            wrap: true,
                        })
        }
    }
    if (isDevinProvider) {
        const planEndLabel = formatDateLike(quotaSubscriptionActiveUntil, i18n.language)
        if (planEndLabel) {
            fields.push({
                            id: 'plan-end',
                            label: t('credentials.subscription_active_until', { defaultValue: 'Plan until' }),
                            value: planEndLabel,
                        })
        }
    }

    const providerKey            = providerLabel.toLowerCase()
    const allowAuthFilePlan      = providerKey.includes('codex')
    const resolvedPlan           = allowAuthFilePlan ? resolveCodexPlanType(file) : null
    const normalizedResolvedPlan = resolvedPlan ? normalizePlanType(resolvedPlan) : null
    const normalizedQuotaPlan    = quotaPlanType ? normalizePlanType(quotaPlanType) : null
    const planChangeDirection    =
              normalizedResolvedPlan && normalizedQuotaPlan
              ? comparePlanRank(normalizedResolvedPlan, normalizedQuotaPlan)
              : null
    const planComparison         =
              resolvedPlan && quotaPlanType && planChangeDirection
              ?
                  {
                      direction: t(`version_history.${planChangeDirection}`),
                      configured: formatPlanLabel(resolvedPlan, t, planLabelProvider),
                      quota: formatPlanLabel(quotaPlanType, t, planLabelProvider),
                  }
              :
              null

    return (
        <CredentialCard
            category='auth-file'
            title={identity.primary || formatAuthFileDisplayName(file.name)}
            controlLabel={controlLabel}
            badge={(() => {
                const tierColors: Record<string, { color: string; bg: string }> = {
                    pro: { color: '#a855f7', bg: 'rgba(168, 85, 247, 0.15)' },
                    plus: { color: '#3b82f6', bg: 'rgba(59, 130, 246, 0.15)' },
                    team: { color: '#06b6d4', bg: 'rgba(6, 182, 212, 0.15)' },
                    max: { color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.15)' },
                    supergrok: { color: '#16a34a', bg: 'rgba(22, 163, 74, 0.15)' },
                    supergrokheavy: { color: '#a855f7', bg: 'rgba(168, 85, 247, 0.15)' },
                    ultra: { color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.15)' },
                    ultralite: { color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.15)' },
                    free: { color: 'var(--text-tertiary)', bg: 'var(--bg-tertiary)' },
                }
                // Priority 0: use plan/tier from quota query
                if (quotaPlanType) {
                    const key           = normalizePlanType(quotaPlanType) ?? quotaPlanType.toLowerCase()
                    const colors        = tierColors[key] ??
                        { color: 'var(--text-secondary)', bg: 'var(--bg-tertiary)' }
                    const isPremiumPlan = quotaPremium ===
                                          true ||
                                          PREMIUM_CODEX_PLAN_TYPES.has(key) ||
                                          key ===
                                          'ultra' ||
                                          key ===
                                          'ultralite'
                    return {
                        label: formatPlanLabel(quotaPlanType, t, planLabelProvider),
                        color: colors.color,
                        bgColor: colors.bg,
                        ...(isPremiumPlan
                            ? { color: '#a855f7', bgColor: 'rgba(168, 85, 247, 0.15)', premium: true }
                            : {}),
                    }
                }
                // Priority 1: resolve from auth file content (JWT token)
                if (resolvedPlan) {
                    const key                = normalizePlanType(resolvedPlan) ?? resolvedPlan.toLowerCase()
                    const colors             = tierColors[key] ??
                        { color: 'var(--text-secondary)', bg: 'var(--bg-tertiary)' }
                    const isPremiumCodexPlan = PREMIUM_CODEX_PLAN_TYPES.has(key)
                    return {
                        label: formatPlanLabel(resolvedPlan, t, planLabelProvider),
                        color: colors.color,
                        bgColor: colors.bg,
                        ...(isPremiumCodexPlan
                            ? { color: '#a855f7', bgColor: 'rgba(168, 85, 247, 0.15)', premium: true }
                            : {}),
                    }
                }
                // Priority 2: unknown plan — show a readable unavailable state instead of a symbolic placeholder
                return {
                    label: t('credentials.plan_unknown', { defaultValue: '上游接口未返回套餐' }),
                    color: 'var(--text-tertiary)',
                    bgColor: 'var(--bg-tertiary)',
                }
            })()}
            fields={fields.length ? fields : undefined}
            planComparison={planComparison ?? undefined}
            disabled={file.disabled}
            disableControls={disableControls}
            quotaItems={quotaItems}
            quotaError={quotaError}
            quotaLoading={quotaLoading}
            quotaFreshness={effectiveQuotaFreshness}
            quotaObservationWarning={quotaObservationWarning}
            quotaSuccessfulEmpty={quotaSuccessfulEmpty}
            stats={stats}
            statusBar={statusBar}
            runtimeState={runtimeState}
            cooldownSnapshot={file.cooldownSnapshot}
            refreshState={refreshState}
            manualTokenRefreshState={manualTokenRefreshState}
            onToggle={(enabled) => void onToggle(file, !enabled)}
            onEdit={() => void onEdit(file)}
            onDelete={() => void onDelete(file.name)}
            onDownload={() => void onDownload(file.name)}
            selected={selected}
            onSelect={onSelect}
        />
    )
}
