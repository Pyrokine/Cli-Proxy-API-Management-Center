import {Button} from '@/components/ui/Button'
import {IconChevronDown, IconChevronUp, IconKey, IconLogIn, IconPlus, IconUpload} from '@/components/ui/icons'
import {Pagination} from '@/components/ui/Pagination'
import {AuthFilesPrefixProxyEditorModal} from '@/features/authFiles/components/AuthFilesPrefixProxyEditorModal'
import {formatAuthFileDisplayName, formatModified, inferProviderFromAuthFileName} from '@/features/authFiles/constants'
import {useAuthFilesPrefixProxyEditor} from '@/features/authFiles/hooks/useAuthFilesPrefixProxyEditor'
import {useCredentialQuota} from '@/hooks/useCredentialQuota'
import type {OAuthProvider} from '@/services/api/oauth'
import type {SummaryApiKeyStats} from '@/services/api/usage'
import type {GeminiKeyConfig, OpenAIProviderConfig, ProviderKeyConfig} from '@/types'
import type {AuthFileItem} from '@/types/authFile'
import {maskApiKey} from '@/utils/format'
import {normalizePlanType} from '@/utils/quota/parsers'
import {resolveCodexPlanType} from '@/utils/quota/resolvers'
import {calculateStatusBarDataFromRecentRequests} from '@/utils/usage'
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {useNavigate} from 'react-router-dom'
import {CookieAuthFlow} from './CookieAuthFlow'
import {CredentialCard} from './CredentialCard'
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
    searchQuery?: string
    statusFilter?: 'all' | 'available' | 'exhausted' | 'error' | 'disabled'
    typeFilter?: 'all' | 'api-key' | 'auth-file'
    selectedItems?: Set<string>
    onToggleSelect?: (id: string) => void
    onSelectVendorFiles?: (fileNames: string[], selected: boolean) => void
    onVisibleAuthFilesChange?: (vendorId: string, fileNames: string[]) => void
    quotaStatusMap?: Record<string, string>
    apiKeyUsageStats?: Record<string, SummaryApiKeyStats>
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

const PREMIUM_CODEX_PLAN_TYPES = new Set(['pro', 'prolite'])

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

export function VendorSection({
                                  vendor,
                                  data,
                                  aliases = {},
                                  onAliasChange,
                                  disableControls,
                                  onRefresh,
                                  searchQuery = '',
                                  statusFilter = 'all',
                                  typeFilter = 'all',
                                  selectedItems,
                                  onToggleSelect,
                                  onSelectVendorFiles,
                                  onVisibleAuthFilesChange,
                                  quotaStatusMap = {},
                                  apiKeyUsageStats = {},
                                  scheduler,
                              }: VendorSectionProps) {
    const { t }                         = useTranslation()
    const navigate                      = useNavigate()
    const [expanded, setExpanded]       = useState(false)
    const [userToggled, setUserToggled] = useState(false)
    const [activeFlow, setActiveFlow]   = useState<ActiveFlow>(null)
    const fileInputRef                  = useRef<HTMLInputElement>(null)

    type SortField = 'name' | 'type' | 'status' | 'requests' | 'priority'
    type SortDir = 'asc' | 'desc'
    const [sortField, setSortField] = useState<SortField>('name')
    const [sortDir, setSortDir]     = useState<SortDir>('asc')

    const { deleteApiKey, toggleAuthFile, deleteAuthFile, downloadAuthFile, uploadAuthFile } = useVendorActions(
        vendor.id,
        onRefresh,
    )
    const {
              prefixProxyEditor,
              prefixProxyUpdatedText,
              prefixProxyDirty,
              openPrefixProxyEditor,
              closePrefixProxyEditor,
              handlePrefixProxyChange,
              handlePrefixProxySave,
          }                                                                                  = useAuthFilesPrefixProxyEditor(
        { disableControls, loadFiles: onRefresh })

    const VendorIcon    = vendor.icon
    const apiKeyCount   = data.apiKeys.length
    const authFileCount = data.authFiles.length
    const totalCount    = apiKeyCount + authFileCount

    // Search filtering
    const rawQuery        = searchQuery.trim()
    const query           = rawQuery.toLowerCase()
    const wildcardQuery   = useMemo(() => wildcardToRegExp(rawQuery), [rawQuery])
    const filteredApiKeys = useMemo(() => {
        if (typeFilter === 'auth-file' || statusFilter !== 'all') {
            return []
        }
        if (!query) {
            return data.apiKeys
        }
        return data.apiKeys.filter((key) => {
            const pk         = key as SearchableKeyConfig
            const searchable = joinSearchTokens([
                                                    vendor.label,
                                                    vendor.id,
                                                    pk.name,
                                                    pk.baseUrl,
                                                    pk.prefix,
                                                    ...apiKeySearchTokens(pk, aliases),
                                                    ...modelSearchTokens(pk.models),
                                                ])
            return matchesSearchQuery(searchable, query, wildcardQuery)
        })
    }, [data.apiKeys, query, statusFilter, typeFilter, aliases, wildcardQuery, vendor.id, vendor.label])

    const filteredAuthFiles = useMemo(() => {
        if (typeFilter === 'api-key') {
            return []
        }
        let files = data.authFiles
        if (query) {
            files = files.filter((file) => {
                const displayName   = formatAuthFileDisplayName(file.name)
                const providerLabel = authFileProviderLabel(file)
                const searchable    = joinSearchTokens([
                                                           vendor.label,
                                                           vendor.id,
                                                           file.name,
                                                           displayName,
                                                           file.type,
                                                           file.provider,
                                                           providerLabel,
                                                           file.note,
                                                           file.priority,
                                                           file.disabled ?
                                                           t('credentials.filter_disabled') :
                                                           t('credentials.filter_available'),
                                                           quotaStatusMap[file.name] || file.status,
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
                    return file.status === 'quota_exceeded' || quotaStatusMap[file.name] === 'quota_exceeded'
                }
                return true
            })
        }
        return files
    }, [data.authFiles, query, statusFilter, typeFilter, quotaStatusMap, wildcardQuery, t, vendor.id, vendor.label])

    const filteredTotal = filteredApiKeys.length + filteredAuthFiles.length

    // Sort auth files
    const sortedAuthFiles = useMemo(() => {
        const files = [...filteredAuthFiles]
        const dir   = sortDir === 'asc' ? 1 : -1
        files.sort((a, b) => {
            switch (sortField) {
                case 'name':
                    return dir * a.name.localeCompare(b.name)
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

    // Reset page when search query changes
    const [prevQuery, setPrevQuery] = useState(query)
    if (prevQuery !== query) {
        setPrevQuery(query)
        setAuthFilePage(1)
        setApiKeyPage(1)
    }

    const paginatedAuthFiles = useMemo(() => {
        const start = (authFilePage - 1) * authFilePageSize
        return sortedAuthFiles.slice(start, start + authFilePageSize)
    }, [sortedAuthFiles, authFilePage, authFilePageSize])

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
        const start = (apiKeyPage - 1) * apiKeyPageSize
        return filteredApiKeys.slice(start, start + apiKeyPageSize)
    }, [filteredApiKeys, apiKeyPage, apiKeyPageSize])

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

    const hasAnyAction =
              Boolean(vendor.editRoute) ||
              vendor.oauthProviders.length > 0 ||
              vendor.supportsFileUpload ||
              vendor.supportsJsonImport ||
              vendor.supportsCookieAuth

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
        void onRefresh()
    }, [onRefresh])

    const handleFlowSuccess = useCallback(async () => {
        setActiveFlow(null)
        await onRefresh()
    }, [onRefresh])

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

    const resolveApiKeyStats = useCallback(
        (apiKey: string | undefined) => {
            const trimmed = apiKey?.trim()
            if (!trimmed) {
                return undefined
            }
            return apiKeyUsageStats[trimmed] ??
                   apiKeyUsageStats[backendMaskedApiKey(trimmed)] ??
                   apiKeyUsageStats[maskApiKey(trimmed)]
        },
        [apiKeyUsageStats],
    )

    const mergeApiKeyStats = useCallback(
        (apiKeys: Array<string | undefined>) => {
            const merged = apiKeys.reduce(
                (acc, apiKey) => {
                    const stats = resolveApiKeyStats(apiKey)
                    if (!stats) {
                        return acc
                    }
                    acc.success += stats.success
                    acc.failure += stats.failure
                    return acc
                },
                { success: 0, failure: 0 },
            )
            return merged.success || merged.failure ? merged : undefined
        },
        [resolveApiKeyStats],
    )

    // --- Render API key card ---

    const renderApiKeyCard = (key: GeminiKeyConfig | ProviderKeyConfig | OpenAIProviderConfig, index: number) => {
        // OpenAI Compatible
        if (vendor.id === 'openai') {
            const oai   = key as OpenAIProviderConfig
            const stats = mergeApiKeyStats(oai.apiKeyEntries?.map((entry) => entry.apiKey) ?? [])
            return (
                <CredentialCard
                    key={`api-${index}`}
                    category='api-key'
                    title={oai.name || `Provider ${index + 1}`}
                    badge={{ label: 'API', color: 'var(--text-secondary)', bgColor: 'var(--bg-tertiary)' }}
                    fields={[
                        ...(oai.baseUrl ? [{ label: t('common.base_url'), value: oai.baseUrl }] : []),
                        ...(oai.apiKeyEntries?.length
                            ? [
                                {
                                    label: t('common.api_key'),
                                    value: `${oai.apiKeyEntries.length} ${t('credentials.api_key_entries')}`,
                                },
                            ]
                            : []),
                    ]}
                    tags={oai.models?.length ? [`${oai.models.length} ${t('credentials.models')}`] : []}
                    stats={stats}
                    disableControls={disableControls}
                    onEdit={vendor.editRoute ? () => navigate(`${vendor.editRoute}/${index}`) : undefined}
                    onDelete={() => void deleteApiKey(oai.name)}
                />
            )
        }

        // Ampcode
        if (vendor.id === 'ampcode') {
            const amp = key as unknown as { upstreamUrl?: string; upstreamApiKey?: string }
            return (
                <CredentialCard
                    key={`api-${index}`}
                    category='api-key'
                    title='Ampcode'
                    badge={{ label: 'Config', color: 'var(--text-secondary)', bgColor: 'var(--bg-tertiary)' }}
                    fields={[
                        ...(amp.upstreamUrl ? [{ label: 'URL', value: amp.upstreamUrl }] : []),
                        ...(amp.upstreamApiKey
                            ? [{ label: t('common.api_key'), value: maskApiKey(amp.upstreamApiKey) }]
                            : []),
                    ]}
                    disableControls={disableControls}
                    onEdit={vendor.editRoute ? () => navigate(vendor.editRoute!) : undefined}
                />
            )
        }

        // Generic (Gemini, Claude, Codex, Vertex)
        const pk             = key as GeminiKeyConfig & ProviderKeyConfig
        const tags: string[] = []
        const stats          = resolveApiKeyStats(pk.apiKey)
        if (pk.models?.length) {
            tags.push(`${pk.models.length} ${t('credentials.models')}`)
        }
        if (pk.websockets) {
            tags.push('WebSocket')
        }
        if (pk.headers && Object.keys(pk.headers).length) {
            tags.push(t('common.custom_headers_label'))
        }

        return (
            <CredentialCard
                key={`api-${index}`}
                category='api-key'
                title={resolveApiKeyTitle(pk.apiKey)}
                highlightTitle={highlightMatch(resolveApiKeyTitle(pk.apiKey))}
                alias={aliases[pk.apiKey || '']}
                onAliasChange={onAliasChange ? (newAlias) => onAliasChange(pk.apiKey || '', newAlias) : undefined}
                badge={{ label: 'API', color: 'var(--text-secondary)', bgColor: 'var(--bg-tertiary)' }}
                fields={[
                    ...(pk.priority !== undefined ? [{ label: t('common.priority'), value: String(pk.priority) }] : []),
                    ...(pk.prefix ? [{ label: t('common.prefix'), value: pk.prefix }] : []),
                    ...(pk.baseUrl ? [{ label: t('common.base_url'), value: pk.baseUrl }] : []),
                ]}
                tags={tags.length ? tags : undefined}
                stats={stats}
                disableControls={disableControls}
                onEdit={vendor.editRoute ? () => navigate(`${vendor.editRoute}/${index}`) : undefined}
                onDelete={() => void deleteApiKey(pk.apiKey, pk.baseUrl)}
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
                                variant='secondary'
                                size='xs'
                                onClick={() => navigate(vendor.createRoute!)}
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
                                disabled={disableControls}
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
                updatedText={prefixProxyUpdatedText}
                dirty={prefixProxyDirty}
                onClose={closePrefixProxyEditor}
                onChange={handlePrefixProxyChange}
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
                                {paginatedApiKeys.map((key, index) =>
                                                          renderApiKeyCard(
                                                              key,
                                                              (apiKeyPage - 1) * apiKeyPageSize + index,
                                                          ),
                                )}
                            </div>
                            {showApiKeyPagination && (
                                <Pagination
                                    total={filteredApiKeys.length}
                                    page={apiKeyPage}
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
                                {paginatedAuthFiles.map((file) => (
                                    <div key={`af-${file.name}`}>
                                        <AuthFileCardWithQuota
                                            file={file}
                                            scheduler={scheduler}
                                            disableControls={disableControls}
                                            onToggle={toggleAuthFile}
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
                                    page={authFilePage}
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
    scheduler: QuotaSchedulerLike
    disableControls: boolean
    onToggle: (name: string, disabled: boolean) => Promise<void>
    onEdit: (file: AuthFileItem) => void | Promise<void>
    onDelete: (name: string) => void
    onDownload: (name: string) => Promise<void>
    selected?: boolean
    onSelect?: () => void
}

function AuthFileCardWithQuota({
                                   file,
                                   scheduler,
                                   disableControls,
                                   onToggle,
                                   onEdit,
                                   onDelete,
                                   onDownload,
                                   selected,
                                   onSelect,
                               }: AuthFileCardWithQuotaProps) {
    const { t }           = useTranslation()
    const {
              items: quotaItems,
              error: quotaError,
              loading: quotaLoading,
              planType: quotaPlanType,
          }               = useCredentialQuota(file.name)
    const recentStatusBar = useMemo(
        () => calculateStatusBarDataFromRecentRequests(file.recentRequests ?? []),
        [file.recentRequests],
    )
    const success         = Number(file.success ?? 0)
    const failure         = Number(file.failed ?? 0)
    const stats           = success > 0 || failure > 0 ? { success, failure } : undefined
    const statusBar       = recentStatusBar

    const lastRefreshTime = scheduler.getLastRefreshTime(file.name)
    const nextRefreshTime = scheduler.getNextRefreshTime(file.name)
    const isRefreshing    = scheduler.isRefreshing(file.name)
    const schedulerStatus = scheduler.getStatus(file.name)

    const refreshState = {
        lastRefreshTime,
        nextRefreshTime,
        isRefreshing,
        autoRefreshEnabled: scheduler.isAutoRefreshEnabled(),
        status: schedulerStatus,
        onRefresh: () => void scheduler.refreshNow(file.name),
    }

    const modifiedStr                                = formatModified(file)
    const fields: { label: string; value: string }[] = []
    const providerLabel                              = authFileProviderLabel(file)
    const planLabelProvider                          = providerLabel.toLowerCase().includes('codex') ?
                                                       'codex' :
                                                       undefined
    if (providerLabel) {
        fields.push({ label: t('credentials.inspection_provider', { defaultValue: '供应商' }), value: providerLabel })
    }
    if (file.priority !== undefined) {
        fields.push({ label: t('auth_files.priority_display'), value: String(file.priority) })
    }
    if (file.note) {
        fields.push({ label: t('auth_files.note_display'), value: file.note })
    }
    if (file.size) {
        fields.push({ label: t('common.size'), value: formatSize(file.size) })
    }
    if (modifiedStr !== '-') {
        fields.push({ label: t('auth_files.file_modified'), value: modifiedStr })
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
            title={formatAuthFileDisplayName(file.name)}
            badge={(() => {
                const tierColors: Record<string, { color: string; bg: string }> = {
                    pro: { color: '#a855f7', bg: 'rgba(168, 85, 247, 0.15)' },
                    plus: { color: '#3b82f6', bg: 'rgba(59, 130, 246, 0.15)' },
                    team: { color: '#06b6d4', bg: 'rgba(6, 182, 212, 0.15)' },
                    max: { color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.15)' },
                    free: { color: 'var(--text-tertiary)', bg: 'var(--bg-tertiary)' },
                }
                // Priority 0: use plan/tier from quota query
                if (quotaPlanType) {
                    const key                = normalizePlanType(quotaPlanType) ?? quotaPlanType.toLowerCase()
                    const colors             = tierColors[key] ??
                        { color: 'var(--text-secondary)', bg: 'var(--bg-tertiary)' }
                    const isPremiumCodexPlan = PREMIUM_CODEX_PLAN_TYPES.has(key)
                    return {
                        label: formatPlanLabel(quotaPlanType, t, planLabelProvider),
                        color: colors.color,
                        bgColor: colors.bg,
                        ...(isPremiumCodexPlan
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
            stats={stats}
            statusBar={statusBar}
            refreshState={refreshState}
            onToggle={(enabled) => void onToggle(file.name, !enabled)}
            onEdit={() => void onEdit(file)}
            onDelete={() => void onDelete(file.name)}
            onDownload={() => void onDownload(file.name)}
            selected={selected}
            onSelect={onSelect}
        />
    )
}
