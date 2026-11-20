import {formatAuthFileDisplayName, inferProviderFromAuthFileName} from '@/features/authFiles/constants'
import {authFileIdentitySearchTokens, deriveAuthFileIdentity} from '@/features/authFiles/identity'
import type {useQuotaStore} from '@/stores/useQuotaStore'
import type {AuthFileItem} from '@/types/authFile'
import {quotaCredentialKey} from '@/utils/quota/credentialKey'
import {resolveResetMs} from '@/utils/quota/resetInstants'
import {buildPluginQuotaIdentity, parsePluginQuota} from './pluginQuota'

export const buildAuthFileWildcardSearch = (term: string): RegExp | null => {
    const normalized = term.trim()
    if (!normalized.includes('*') && !normalized.includes('?')) {
        return null
    }
    const escaped = normalized
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.')
    return new RegExp(escaped, 'i')
}

export function matchesAuthFileSearch(
    file: AuthFileItem,
    term: string,
    wildcard = buildAuthFileWildcardSearch(term),
): boolean {
    const query = term.trim().toLowerCase()
    if (!query) {
        return true
    }
    return authFileIdentitySearchTokens(file).some((token) =>
                                                       wildcard ?
                                                       wildcard.test(token) :
                                                       token.toLowerCase().includes(query),
    )
}

export function filterAuthFiles(
    files: AuthFileItem[],
    options: {
        searchQuery: string
        statusFilter: string
        typeFilter: string
        quotaStatusMap: Record<string, string>
        vendorId: string
        vendorLabel: string
        t: (key: string) => string
    },
): AuthFileItem[] {
    if (options.typeFilter === 'api-key') {
        return []
    }
    const query    = options.searchQuery.trim().toLowerCase()
    const wildcard = buildAuthFileWildcardSearch(query)
    return files.filter((file) => {
        const provider      = String(file.provider || file.type || inferProviderFromAuthFileName(file.name) || '')
            .trim()
        const quotaProvider = String(file.type || inferProviderFromAuthFileName(file.name) || file.provider || '')
            .trim()
        const quotaStatus   = options.quotaStatusMap[quotaCredentialKey(quotaProvider, file.name, file.authIndex)]
        if (query && !matchesAuthFileSearch(file, options.searchQuery, wildcard)) {
            const searchable = [
                options.vendorLabel,
                options.vendorId,
                formatAuthFileDisplayName(file.name),
                provider,
                file.priority,
                options.t(file.disabled ? 'credentials.filter_disabled' : 'credentials.filter_available'),
                quotaStatus || file.status,
            ].flatMap((value) => String(value ?? '').split(/\s+/)).filter(Boolean).join(' ')
            if (wildcard ? !wildcard.test(searchable) : !searchable.toLowerCase().includes(query)) {
                return false
            }
        }
        const status   = String(file.status ?? '').trim().toLowerCase()
        const disabled = file.disabled === true || status === 'disabled'
        if (options.statusFilter === 'problem' || options.statusFilter === 'disabled-problem') {
            return Boolean(String(file.statusMessage ?? file['status_message'] ?? '').trim()) &&
                   (options.statusFilter !== 'disabled-problem' || disabled)
        }
        if (options.statusFilter === 'disabled') {
            return disabled
        }
        if (options.statusFilter === 'all') {
            return true
        }
        if (disabled) {
            return false
        }
        const unavailable = file.unavailable === true || status === 'error' || status === 'unavailable'
        const exhausted   = status === 'quota_exceeded' || quotaStatus === 'quota_exceeded'
        switch (options.statusFilter) {
            case 'available':
                return !unavailable && !exhausted
            case 'error':
                return unavailable
            case 'exhausted':
                return exhausted
            default:
                return true
        }
    })
}

export function sortAuthFilesByRecovery(
    files: readonly AuthFileItem[],
    state: ReturnType<typeof useQuotaStore.getState>,
    nowMs: number,
    authGeneration: number,
): AuthFileItem[] {
    return files.map((file, index) => {
        const provider          = String(file.type || inferProviderFromAuthFileName(file.name) || file.provider || '')
            .trim()
        const key               = quotaCredentialKey(provider, file.name, file.authIndex)
        let atMs: number | null = null
        const observe           = (value: number | null | undefined, offset = 0) => {
            if (typeof value !== 'number' || !Number.isFinite(value)) {
                return
            }
            const instant = value - offset
            if (instant > nowMs && (atMs === null || instant < atMs)) {
                atMs = instant
            }
        }
        const quota             = [
            state.antigravityQuota[key], state.claudeQuota[key], state.codexQuota[key],
            state.devinQuota[key], state.geminiCliQuota[key], state.kimiQuota[key], state.xaiQuota[key],
        ]
            .find((value) => value != null)
        if (quota?.status === 'success') {
            if ('windows' in quota) {
                quota.windows.forEach((window) => observe(window.resetAtMs))
            }
            if ('groups' in quota) {
                quota.groups.forEach((group) => observe(group.resetAtMs, quota.serverTimeOffsetMs ?? 0))
            }
            if ('buckets' in quota) {
                quota.buckets.forEach((bucket) => observe(bucket.resetAtMs))
            }
            if ('rows' in quota) {
                quota.rows.forEach((row) => observe(row.resetAtMs))
            }
            if ('rateLimitResetCredits' in quota) {
                quota.rateLimitResetCredits?.forEach((credit) => {
                    if (credit.status === 'available' && credit.expiryState === 'valid') {
                        observe(resolveResetMs([credit.expiresAt]))
                    }
                })
            }
            if ('billing' in quota && quota.billing?.periodType === 'weekly') {
                observe(quota.billing.resetAtMs ?? resolveResetMs([quota.billing.periodEnd]))
            }
        }
        const plugin = state.pluginQuota[key]
        if (file.supportsQuota && plugin?.payload !== undefined && !plugin.error && !plugin.loading) {
            const generation = JSON.stringify([
                                                  state.cacheGeneration,
                                                  state.subjectVersions[key]?.localGeneration ?? 0,
                                                  state.subjectVersions[key]?.backendGeneration ?? 0,
                                              ])
            if (plugin.identity === buildPluginQuotaIdentity(file, authGeneration, generation)) {
                parsePluginQuota(plugin.payload, 'en').items.forEach((item) => observe(item.resetAtMs))
            }
        }
        return { file, index, atMs }
    }).sort((left, right) => {
        if (left.atMs === null && right.atMs === null) {
            return left.index - right.index
        }
        if (left.atMs === null) {
            return 1
        }
        if (right.atMs === null) {
            return -1
        }
        return left.atMs - right.atMs || left.index - right.index
    }).map(({ file }) => file)
}

export const compareAuthFilesBySafeIdentity = (left: AuthFileItem, right: AuthFileItem): number => {
    const leftIdentity  = deriveAuthFileIdentity(left)
    const rightIdentity = deriveAuthFileIdentity(right)
    return leftIdentity.primary.localeCompare(rightIdentity.primary, undefined, { sensitivity: 'base' }) ||
           left.name.localeCompare(right.name)
}
