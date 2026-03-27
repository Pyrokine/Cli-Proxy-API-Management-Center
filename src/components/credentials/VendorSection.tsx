import {Button} from '@/components/ui/Button'
import {IconChevronDown, IconChevronUp, IconKey, IconLogIn, IconPlus, IconUpload} from '@/components/ui/icons'
import {Pagination} from '@/components/ui/Pagination'
import {formatModified, resolveAuthFileStats} from '@/features/authFiles/constants'
import {useCredentialQuota} from '@/hooks/useCredentialQuota'
import type {OAuthProvider} from '@/services/api/oauth'
import type {QuotaScheduler} from '@/services/quota/QuotaScheduler'
import {useUsageStatsStore} from '@/stores/useUsageStatsStore'
import type {GeminiKeyConfig, OpenAIProviderConfig, ProviderKeyConfig} from '@/types'
import type {AuthFileItem} from '@/types/authFile'
import {maskApiKey} from '@/utils/format'
import {calculateStatusBarData, normalizeAuthIndex} from '@/utils/usage'
import React, {useCallback, useMemo, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {useNavigate} from 'react-router-dom'
import {CookieAuthFlow} from './CookieAuthFlow'
import {CredentialCard} from './CredentialCard'
import type {VendorData} from './hooks/useCredentialsData'
import {useQuotaRegistration} from './hooks/useQuotaRegistration'
import {useVendorActions} from './hooks/useVendorActions'
import type {VendorDefinition} from './hooks/useVendorRegistry'
import {OAuthLoginAction} from './OAuthLoginAction'
import styles from './VendorSection.module.scss'
import {VertexImportFlow} from './VertexImportFlow'

interface VendorSectionProps {
    vendor: VendorDefinition;
    data: VendorData;
    aliases?: Record<string, string>;
    onAliasChange?: (apiKey: string, alias: string) => void;
    disableControls: boolean;
    onRefresh: () => Promise<void>;
    searchQuery?: string;
}

type ActiveFlow = { type: 'oauth'; provider: OAuthProvider } | { type: 'cookie' } | { type: 'json-import' } | null;

const formatSize = (bytes: number): string => {
    if (bytes < 1024) {
        return `${bytes}B`
    }
    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(1)}KB`
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

const formatCompact = (n: number): string => {
    if (n < 1000) {
        return String(n)
    }
    if (n < 1_000_000) {
        return `${(n / 1000).toFixed(1)}K`
    }
    return `${(n / 1_000_000).toFixed(1)}M`
}

export function VendorSection({
                                  vendor,
                                  data,
                                  aliases = {},
                                  onAliasChange,
                                  disableControls,
                                  onRefresh,
                                  searchQuery = '',
                              }: VendorSectionProps) {
    const { t }                         = useTranslation()
    const navigate                      = useNavigate()
    const [expanded, setExpanded]       = useState(false)
    const [userToggled, setUserToggled] = useState(false)
    const [activeFlow, setActiveFlow]   = useState<ActiveFlow>(null)
    const fileInputRef                  = useRef<HTMLInputElement>(null)

    const keyStats  = useUsageStatsStore((s) => s.keyStats)
    const scheduler = useQuotaRegistration(data.authFiles)

    type SortField = 'name' | 'type' | 'status' | 'requests';
    type SortDir = 'asc' | 'desc';
    const [sortField, setSortField] = useState<SortField>('name')
    const [sortDir, setSortDir]     = useState<SortDir>('asc')

    const { deleteApiKey, toggleAuthFile, deleteAuthFile, downloadAuthFile, uploadAuthFile } = useVendorActions(
        vendor.id,
        onRefresh,
    )

    const VendorIcon    = vendor.icon
    const apiKeyCount   = data.apiKeys.length
    const authFileCount = data.authFiles.length
    const totalCount    = apiKeyCount + authFileCount

    // Search filtering
    const query           = searchQuery.toLowerCase().trim()
    const filteredApiKeys = useMemo(() => {
        if (!query) {
            return data.apiKeys
        }
        return data.apiKeys.filter((key) => {
            const pk         = key as GeminiKeyConfig & ProviderKeyConfig & OpenAIProviderConfig
            const searchable = [pk.apiKey, pk.name, pk.baseUrl, pk.prefix].filter(Boolean).join(' ').toLowerCase()
            return searchable.includes(query)
        })
    }, [data.apiKeys, query])

    const filteredAuthFiles = useMemo(() => {
        if (!query) {
            return data.authFiles
        }
        return data.authFiles.filter((file) => {
            const searchable = [file.name, file.type].filter(Boolean).join(' ').toLowerCase()
            return searchable.includes(query)
        })
    }, [data.authFiles, query])

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
                    const sa = resolveAuthFileStats(a, keyStats)
                    const sb = resolveAuthFileStats(b, keyStats)
                    const ra = sa.success + sa.failure
                    const rb = sb.success + sb.failure
                    return dir * (ra - rb)
                }
                default:
                    return 0
            }
        })
        return files
    }, [filteredAuthFiles, sortField, sortDir, keyStats])

    // Pagination state (auth files only — API keys are typically few)
    const PAGE_SIZE_OPTIONS                       = [12, 24, 48]
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

    const handleFlowSuccess = useCallback(async () => {
        setActiveFlow(null)
        await onRefresh()
    }, [onRefresh])

    const handleFlowCancel = useCallback(() => setActiveFlow(null), [])

    // --- Highlight matching text ---

    const highlightMatch = useCallback((text: string): React.ReactNode => {
        if (!query || !text) {
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
    }, [query])

    // --- Resolve display name for API key (alias > masked key) ---

    const resolveApiKeyTitle = useCallback((apiKey: string | undefined): string => {
        if (!apiKey) {
            return ''
        }
        const alias = aliases[apiKey]
        return alias || maskApiKey(apiKey)
    }, [aliases])

    // --- Render API key card ---

    const renderApiKeyCard = (key: GeminiKeyConfig | ProviderKeyConfig | OpenAIProviderConfig, index: number) => {
        // OpenAI Compatible
        if (vendor.id === 'openai') {
            const oai = key as OpenAIProviderConfig
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
                        ...(amp.upstreamApiKey ?
                            [{ label: t('common.api_key'), value: maskApiKey(amp.upstreamApiKey) }] :
                            []),
                    ]}
                    disableControls={disableControls}
                    onEdit={vendor.editRoute ? () => navigate(vendor.editRoute!) : undefined}
                />
            )
        }

        // Generic (Gemini, Claude, Codex, Vertex)
        const pk             = key as GeminiKeyConfig & ProviderKeyConfig
        const tags: string[] = []
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
                disableControls={disableControls}
                onEdit={vendor.editRoute ? () => navigate(`${vendor.editRoute}/${index}`) : undefined}
                onDelete={() => void deleteApiKey(pk.apiKey)}
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
              {query && filteredTotal !== totalCount ? `${filteredTotal}/${totalCount}` : totalCount}
            </span>
                    )}
                    {data.stats.requests > 0 && (
                        <span className={styles.statBadge}>{formatCompact(data.stats.requests)} req</span>
                    )}
                </div>

                {hasAnyAction && (
                    <div className={styles.headerActions} onClick={(e) => e.stopPropagation()}>
                        {vendor.editRoute && (
                            <Button
                                variant='secondary'
                                size='xs'
                                onClick={() => navigate(`${vendor.editRoute}/new`)}
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
                        onSuccess={handleFlowSuccess}
                        onCancel={handleFlowCancel}
                    />
                </div>
            )}

            {activeFlow?.type === 'cookie' && (
                <CookieAuthFlow disableControls={disableControls} onSuccess={handleFlowSuccess}
                                onCancel={handleFlowCancel} />
            )}

            {activeFlow?.type === 'json-import' && (
                <VertexImportFlow disableControls={disableControls} onSuccess={handleFlowSuccess}
                                  onCancel={handleFlowCancel} />
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
            {expanded && totalCount > 0 && filteredTotal === 0 && query && (
                <div className={styles.emptyBody}>{t('credentials.no_search_results', { query: searchQuery })}</div>
            )}

            {/* Credential cards */}
            {expanded && filteredTotal > 0 && (
                <div className={styles.body}>
                    {filteredApiKeys.length > 0 && (
                        <div className={styles.group}>
                            <div className={styles.groupTitle}>
                                {t('credentials.api_keys')}
                                <span className={styles.groupCount}>{filteredApiKeys.length}</span>
                            </div>
                            <div className={styles.grid}>{paginatedApiKeys.map((key, index) => renderApiKeyCard(
                                key,
                                (apiKeyPage - 1) * apiKeyPageSize + index,
                            ))}</div>
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
                                    {(['name', 'type', 'status', 'requests'] as SortField[]).map((field) => (
                                        <button
                                            key={field}
                                            type='button'
                                            className={`${styles.sortButton} ${sortField === field ?
                                                                               styles.sortActive :
                                                                               ''}`}
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
                                    <AuthFileCardWithQuota
                                        key={`af-${file.name}`}
                                        file={file}
                                        scheduler={scheduler}
                                        disableControls={disableControls}
                                        onToggle={toggleAuthFile}
                                        onDelete={deleteAuthFile}
                                        onDownload={downloadAuthFile}
                                    />
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
    file: AuthFileItem;
    scheduler: QuotaScheduler;
    disableControls: boolean;
    onToggle: (name: string, disabled: boolean) => Promise<void>;
    onDelete: (name: string) => void;
    onDownload: (name: string) => Promise<void>;
}

function AuthFileCardWithQuota({
                                   file,
                                   scheduler,
                                   disableControls,
                                   onToggle,
                                   onDelete,
                                   onDownload,
                               }: AuthFileCardWithQuotaProps) {
    const { t }                                                           = useTranslation()
    const { items: quotaItems, error: quotaError, loading: quotaLoading } = useCredentialQuota(file.name)
    const keyStats                                                        = useUsageStatsStore((s) => s.keyStats)
    const usageDetails                                                    = useUsageStatsStore((s) => s.usageDetails)

    const bucket = resolveAuthFileStats(file, keyStats)
    const stats  =
              bucket.success > 0 || bucket.failure > 0 ?
                  { success: bucket.success, failure: bucket.failure } :
              undefined

    const statusBar = useMemo(() => {
        if (!usageDetails.length) {
            return undefined
        }
        const rawAuthIndex   = file['auth_index'] ?? file.authIndex
        const authIdx        = normalizeAuthIndex(rawAuthIndex)
        const fileName       = file.name
        const nameWithoutExt = fileName.replace(/\.[^/.]+$/, '')

        const filtered = usageDetails.filter(
            (d) =>
                (authIdx && normalizeAuthIndex(d.auth_index) === authIdx) ||
                d.source === fileName ||
                (nameWithoutExt !== fileName && d.source === nameWithoutExt),
        )

        if (!filtered.length) {
            return undefined
        }
        return calculateStatusBarData(filtered)
    }, [usageDetails, file])

    const lastRefreshTime = scheduler.getLastRefreshTime(file.name)
    const nextRefreshTime = scheduler.getNextRefreshTime(file.name)
    const isRefreshing    = scheduler.isRefreshing(file.name)

    // noinspection JSUnusedLocalSymbols,JSUnusedGlobalSymbols
    const refreshState =
              lastRefreshTime || nextRefreshTime
              ? {
                      lastRefreshTime,
                      nextRefreshTime,
                      isRefreshing,
                      onRefresh: () => void scheduler.refreshNow(file.name),
                  }
              : undefined

    const modifiedStr                                = formatModified(file)
    const fields: { label: string; value: string }[] = []
    if (file.size) {
        fields.push({ label: t('common.size'), value: formatSize(file.size) })
    }
    if (modifiedStr !== '-') {
        fields.push({ label: t('auth_files.file_modified'), value: modifiedStr })
    }

    return (
        <CredentialCard
            category='auth-file'
            title={file.name}
            badge={
                file.type ?
                    { label: file.type, color: 'var(--text-secondary)', bgColor: 'var(--bg-tertiary)' } :
                undefined
            }
            fields={fields.length ? fields : undefined}
            disabled={file.disabled}
            disableControls={disableControls}
            quotaItems={quotaItems}
            quotaError={quotaError}
            quotaLoading={quotaLoading}
            stats={stats}
            statusBar={statusBar}
            refreshState={refreshState}
            onToggle={(enabled) => void onToggle(file.name, !enabled)}
            onDelete={() => void onDelete(file.name)}
            onDownload={() => void onDownload(file.name)}
        />
    )
}
