import {inferProviderFromAuthFileName} from '@/features/authFiles/constants'
import type {AuthFileFieldsPatch} from '@/services/api/authFiles'
import type {AuthFileItem} from '@/types/authFile'
import {quotaCredentialKey} from '@/utils/quota/credentialKey'
import {getCredentialRetryValidationKey} from '@/utils/credentialOverrides'

export type AuthFileMutation =
    | { kind: 'upload'; names: string[] }
    | { kind: 'delete'; names: string[] }
    | { kind: 'status'; names: string[]; disabled: boolean; authIndex?: string | number | null }
    | { kind: 'fields'; name: string; fields: AuthFileFieldsPatch; authIndex?: string | number | null }
    | { kind: 'reload'; names?: string[] }

interface CredentialsRequestToken {
    id: number
    authGeneration: number
}

interface LatestCredentialsRequestTracker {
    begin: (authGeneration: number) => CredentialsRequestToken
    invalidate: () => void
    isCurrent: (token: CredentialsRequestToken, authGeneration: number) => boolean
}

export const createLatestCredentialsRequestTracker = (): LatestCredentialsRequestTracker => {
    let requestId = 0
    return {
        begin: (authGeneration) => ({ id: ++requestId, authGeneration }),
        invalidate: () => {
            requestId += 1
        },
        isCurrent: (token, authGeneration) =>
            token.id === requestId && token.authGeneration === authGeneration,
    }
}

const normalizedNames = (names: string[]): string[] =>
    Array.from(new Set(names.map((name) => name.trim()).filter(Boolean)))

const normalizeAuthIndex = (value: string | number | null | undefined): string =>
    String(value ?? '').trim()

export const authFileSelectionKey = (file: Pick<AuthFileItem, 'name' | 'authIndex'>): string =>
    JSON.stringify([file.name, normalizeAuthIndex(file.authIndex)])

export const selectedPhysicalFileNames = (
    files: AuthFileItem[],
    selectedKeys: ReadonlySet<string>,
): string[] | null => {
    const names = new Set(files.filter((file) => selectedKeys.has(authFileSelectionKey(file)))
        .map((file) => file.name))
    return files.some((file) => names.has(file.name) && !selectedKeys.has(authFileSelectionKey(file)))
           ? null
           : Array.from(names)
}

const matchesAuthFileIdentity = (
    file: AuthFileItem,
    name: string,
    authIndex?: string | number | null,
): boolean => {
    if (file.name !== name) {
        return false
    }
    const identity = normalizeAuthIndex(authIndex)
    return !identity || normalizeAuthIndex(file.authIndex) === identity
}

const applyFieldsPatch = (file: AuthFileItem, fields: AuthFileFieldsPatch): AuthFileItem => {
    const next: AuthFileItem = { ...file }
    if (fields.prefix !== undefined) {
        if (fields.prefix) {
            next.prefix = fields.prefix
        } else {
            delete next.prefix
        }
    }
    if (fields.proxy_url !== undefined) {
        if (fields.proxy_url) {
            next.proxy_url = fields.proxy_url
        } else {
            delete next.proxy_url
        }
    }
    if (fields.priority !== undefined) {
        if (fields.priority === 0) {
            delete next.priority
        } else {
            next.priority = fields.priority
        }
    }
    if (fields.weight !== undefined) {
        if (fields.weight === null) {
            delete next.weight
        } else {
            next.weight = fields.weight
        }
    }
    if (fields.note !== undefined) {
        if (fields.note) {
            next.note = fields.note
        } else {
            delete next.note
        }
    }
    if (fields.disable_cooling !== undefined) {
        delete next.disableCooling
        delete next.disable_cooling
        delete next['disable-cooling']
        if (fields.disable_cooling !== null) {
            next.disableCooling  = fields.disable_cooling
            next.disable_cooling = fields.disable_cooling
        }
    }
    if (fields.request_retry !== undefined) {
        const errorKey = getCredentialRetryValidationKey(fields.request_retry ?? undefined)
        if (errorKey) {
            throw new Error(errorKey)
        }
        delete next.requestRetry
        delete next.request_retry
        delete next['request-retry']
        if (fields.request_retry !== null && fields.request_retry >= 0) {
            next.requestRetry  = fields.request_retry
            next.request_retry = fields.request_retry
        }
    }
    if (fields.websockets !== undefined) {
        next.websockets = fields.websockets
    }
    if (fields.using_api !== undefined) {
        next.usingApi  = fields.using_api
        next.using_api = fields.using_api
    }
    if (fields.excluded_models !== undefined) {
        next.excludedModels  = [...fields.excluded_models]
        next.excluded_models = [...fields.excluded_models]
        delete next['excluded-models']
    }
    if (fields.model_aliases !== undefined) {
        delete next['model-aliases']
        if (fields.model_aliases.length === 0) {
            delete next.model_aliases
        } else {
            next.model_aliases = fields.model_aliases.map((row) => ({...row}))
        }
    }
    if (fields.request_scoped_errors !== undefined) {
        delete next['request-scoped-errors']
        if (fields.request_scoped_errors.length === 0) {
            delete next.request_scoped_errors
        } else {
            next.request_scoped_errors = fields.request_scoped_errors.map((row) => ({...row}))
        }
    }
    return next
}

export function applyAuthFileMutation(
    files: AuthFileItem[],
    mutation: AuthFileMutation,
): AuthFileItem[] {
    if (mutation.kind === 'reload') {
        return files
    }
    if (mutation.kind === 'upload') {
        const existing = new Set(files.map((file) => file.name))
        const appended = normalizedNames(mutation.names)
            .filter((name) => !existing.has(name))
            .map((name) => ({ name }) satisfies AuthFileItem)
        return appended.length > 0 ? [...files, ...appended] : files
    }
    if (mutation.kind === 'delete') {
        const deleted = new Set(normalizedNames(mutation.names))
        return deleted.size > 0 ? files.filter((file) => !deleted.has(file.name)) : files
    }
    if (mutation.kind === 'status') {
        const updated   = new Set(normalizedNames(mutation.names))
        const authIndex = normalizeAuthIndex(mutation.authIndex)
        return files.map((file) =>
                             updated.has(file.name) &&
                             normalizeAuthIndex(file.authIndex) === authIndex
                             ? { ...file, disabled: mutation.disabled }
                             : file,
        )
    }
    return files.map((file) =>
                         matchesAuthFileIdentity(file, mutation.name, mutation.authIndex)
                         ? applyFieldsPatch(file, mutation.fields)
                         : file,
    )
}

export const authFileMutationNames = (mutation: AuthFileMutation): string[] | undefined =>
    mutation.kind === 'fields'
    ? [mutation.name]
    : mutation.kind === 'reload'
      ? mutation.names
      : mutation.names

const quotaProviderForAuthFile = (file: AuthFileItem): string =>
    String(file.type || file.provider || inferProviderFromAuthFileName(file.name) || '').trim()

export function authFileRefreshIdentifiers(
    files: AuthFileItem[],
    selectedKeys: ReadonlySet<string>,
): { identifiers: string[]; skippedDisabled: number; skippedUnsupported: number; skippedAmbiguous: number } {
    const identifiers = new Set<string>()
    const unselectedQuotaKeys = new Set(files.filter((file) => !selectedKeys.has(authFileSelectionKey(file)))
        .map((file) => quotaCredentialKey(quotaProviderForAuthFile(file), file.name, file.authIndex)))
    const unselectedFileNames = new Set(files.filter((file) => !selectedKeys.has(authFileSelectionKey(file)))
        .map((file) => file.name))
    let skippedDisabled = 0
    let skippedUnsupported = 0
    let skippedAmbiguous = 0
    for (const file of files) {
        if (!selectedKeys.has(authFileSelectionKey(file))) {
            continue
        }
        if (file.disabled) {
            skippedDisabled += 1
            continue
        }
        const provider = quotaProviderForAuthFile(file)
        if (['meta', 'muse', 'kimi-ai'].includes(provider.toLowerCase())) {
            skippedUnsupported += 1
            continue
        }
        const key = quotaCredentialKey(provider, file.name, file.authIndex)
        if (provider ? unselectedQuotaKeys.has(key) : unselectedFileNames.has(file.name)) {
            skippedAmbiguous += 1
            continue
        }
        identifiers.add(provider ? key : file.name)
    }
    return {identifiers: Array.from(identifiers), skippedDisabled, skippedUnsupported, skippedAmbiguous}
}

export const authFileStatusQuotaKeys = (
    files: AuthFileItem[],
    mutation: Extract<AuthFileMutation, {kind: 'status'}>,
): string[] => {
    const names = new Set(normalizedNames(mutation.names))
    const authIndex = normalizeAuthIndex(mutation.authIndex)
    return Array.from(new Set(files.filter((file) =>
        names.has(file.name) && normalizeAuthIndex(file.authIndex) === authIndex,
    ).map((file) => quotaCredentialKey(quotaProviderForAuthFile(file), file.name, file.authIndex))))
}

export const authFileMutationQuotaKeys = (
    files: AuthFileItem[],
    mutation: AuthFileMutation,
): string[] | undefined => {
    if (mutation.kind === 'status' || mutation.kind === 'fields') {
        return []
    }
    const names = authFileMutationNames(mutation)
    if (names === undefined) {
        return undefined
    }
    const keys = new Set<string>()
    for (const name of normalizedNames(names)) {
        const matched = files.filter((file) => file.name === name)
        if (matched.length > 0) {
            for (const file of matched) {
                const provider = quotaProviderForAuthFile(file)
                if (provider) {
                    keys.add(quotaCredentialKey(provider, name, file.authIndex))
                }
            }
            continue
        }
        const provider = inferProviderFromAuthFileName(name)
        if (provider) {
            keys.add(quotaCredentialKey(provider, name))
        }
    }
    return Array.from(keys)
}
