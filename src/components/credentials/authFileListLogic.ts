import {authFileIdentitySearchTokens, deriveAuthFileIdentity} from '@/features/authFiles/identity'
import type {AuthFileItem} from '@/types/authFile'

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

export const compareAuthFilesBySafeIdentity = (left: AuthFileItem, right: AuthFileItem): number => {
    const leftIdentity  = deriveAuthFileIdentity(left)
    const rightIdentity = deriveAuthFileIdentity(right)
    return leftIdentity.primary.localeCompare(rightIdentity.primary, undefined, { sensitivity: 'base' }) ||
           left.name.localeCompare(right.name)
}
